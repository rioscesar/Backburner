import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createContext,runInContext} from 'node:vm';
import * as domain from '../domain.js';
import {createStore,fingerprintUrl,STATE_KEY} from '../store.js';
import {createRemoval} from '../removal.js';

function findings(manifest, source, recovery=false) {
  const hits=[];
  if(JSON.stringify([...(manifest.permissions??[])].sort())!==JSON.stringify(['bookmarks','storage']))hits.push('permissions');
  for(const field of ['host_permissions','optional_host_permissions','optional_permissions','content_scripts','externally_connectable','web_accessible_resources'])if(manifest[field]?.length || (manifest[field] && !Array.isArray(manifest[field])))hits.push(field);
  if(/chrome\.bookmarks\s*\.\s*(create|update|move|remove|removeTree)\s*\(/.test(source) || (!recovery && /bookmarks\.(remove|create)\(/.test(source)))hits.push('bookmark mutation');
  if(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(source))hits.push('network');
  if(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|\beval\s*\(/.test(source))hits.push('unsafe DOM');
  return hits;
}
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
test('safety controls catch broadened permissions, mutations, network and unsafe DOM',()=>{
  assert.deepEqual(findings(manifest,'chrome.bookmarks.getTree(); title.textContent = text;'),[]);
  assert.ok(findings({...manifest,permissions:['bookmarks','storage','history']},'').length);
  for(const bad of ['chrome.bookmarks.remove(id)','fetch(url)','element.innerHTML = title'])assert.ok(findings(manifest,bad).length);
});
test('review UI stays nonmutating; runtime remains local-only and safely rendered',()=>{
  const source=['background.js','review.js','store.js','domain.js'].map(f=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8')).join('\n');
  assert.deepEqual(findings(manifest,source),[]);
  assert.equal(manifest.manifest_version,3);
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
});

function sensitive(text) {
  const withoutSynthetic=text.replaceAll('https://name:pass@example.com','SYNTHETIC_URL');
  return /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]+|BEGIN [A-Z ]*PRIVATE KEY/.test(withoutSynthetic) ||
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/.test(withoutSynthetic);
}
test('sensitive-data controls flag credential/contact shapes and accept synthetic code',()=>{
  assert.equal(sensitive('AKIA'+'A'.repeat(16)),true);
  assert.equal(sensitive('person'+'@'+'private.example'),true);
  assert.equal(sensitive('url.password; https://name:pass@example.com'),false);
});
test('tracked-source candidates contain no high-signal credentials or personal contacts',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const visit=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    if(['.git','dist','node_modules'].includes(e.name))return [];
    const file=path.join(dir,e.name);return e.isDirectory()?visit(file):[file];
  });
  for(const file of visit(root).filter(f=>!f.endsWith('.png')))assert.equal(sensitive(readFileSync(file,'utf8')),false,path.relative(root,file));
});

test('native mutation is confined to the confirmed recovery boundary',()=>{
 const source=readFileSync(new URL('../removal.js',import.meta.url),'utf8');
 assert.deepEqual(findings(manifest,source,true),[]);
 assert.ok(findings(manifest,'bookmarks.remove(id)').length);
 assert.doesNotMatch(source,/bookmarks\.(removeTree|move|update)\(/);
 assert.match(source,/if\(!confirmed\)/);
});

// Exercise the real event handlers with isolated DOM/Chrome boundaries.
async function completionHarness(nodes=[]) {
  const html=readFileSync(new URL('../review.html',import.meta.url),'utf8');
  const elements=new Map(), buttons=[];
  function element(tagName) {
    const e={hidden:false,disabled:false,children:[],textContent:'',handlers:{},
      addEventListener(name,handler){this.handlers[name]=handler;},
      replaceChildren(...children){this.children=children;},
      append(...children){this.children.push(...children);},
      focus(){},setAttribute(){}};
    if(tagName==='button')buttons.push(e);
    return e;
  }
  for(const [,tag,id]of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g))elements.set(id,element(tag));
  const initial=domain.emptyState();initial.onboarded=true;initial.batchSize=2;
  initial.lastSession={started:1,ended:2,reviewed:0,opened:0,counts:{reference:0,dismissed:0,later:0,removed:0}};
  let saved={[STATE_KEY]:initial}, failSave=false;
  const closed=[], tabs={getCurrent:async()=>({id:7}),remove:async id=>{closed.push(id);}};
  const context=createContext({...domain,createStore,fingerprintUrl,createRemoval,structuredClone,URL,Intl,
    document:{getElementById:id=>{assert.ok(elements.has(id),`Missing control: ${id}`);return elements.get(id);},
      querySelectorAll:()=>buttons,createElement:element,createTextNode:text=>({textContent:text})},
    chrome:{tabs,bookmarks:{getTree:async()=>structuredClone(nodes)},storage:{local:{
      get:async()=>structuredClone(saved),set:async value=>{if(failSave)throw Error('Synthetic storage failure');saved=structuredClone(value);}
    }}},
    navigator:{locks:{request:async()=>{}}}
  });
  const source=readFileSync(new URL('../review.js',import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
  runInContext(source,context);
  await runInContext('(async()=>{state=await store.load();await refreshNodes();renderSummary();})()',context);
  return {elements,tabs,closed,click:id=>elements.get(id).handlers.click(),read:()=>structuredClone(saved[STATE_KEY]),
    evaluate:code=>runInContext(code,context),failSave:value=>{failSave=value;}};
}

test('All done closes only the current tab without changing saved state; stale controls are inert',async()=>{
  const h=await completionHarness(), before=h.read();
  await h.click('done');assert.deepEqual(h.closed,[7]);assert.deepEqual(h.read(),before);
  h.evaluate("show('home')");
  await h.click('done');await h.click('review-more');assert.deepEqual(h.closed,[7]);assert.deepEqual(h.read(),before);
  h.evaluate("show('summary');state.session={}");
  await h.click('done');await h.click('review-more');assert.deepEqual(h.closed,[7]);assert.deepEqual(h.read(),before);
  h.evaluate('state.session=null;state.lastSession=null');
  await h.click('done');await h.click('review-more');assert.deepEqual(h.closed,[7]);assert.deepEqual(h.read(),before);
});

test('All done handles missing tab IDs and Chrome failures locally, with a working retry',async()=>{
  for(const failure of ['missing','lookup','close']) {
    const h=await completionHarness(), before=h.read();
    if(failure==='missing')h.tabs.getCurrent=async()=>({});
    if(failure==='lookup')h.tabs.getCurrent=async()=>{throw Error('Synthetic lookup failure');};
    if(failure==='close')h.tabs.remove=async()=>{throw Error('Synthetic close failure');};
    await h.click('done');
    assert.deepEqual(h.closed,[]);assert.deepEqual(h.read(),before);
    assert.equal(h.elements.get('summary').hidden,false);
    const [notice,retry]=h.elements.get('notice').children;
    assert.match(notice.textContent,/close this tab.*manually/);assert.doesNotMatch(notice.textContent,/recovery/i);
    assert.equal(retry.textContent,'Try again');
    h.tabs.getCurrent=async()=>({id:7});h.tabs.remove=async id=>{h.closed.push(id);};
    await retry.handlers.click();assert.deepEqual(h.closed,[7]);assert.deepEqual(h.read(),before);
  }
});

test('Review more reuses selection and batch policy in place, while repeated clicks preserve one session',async()=>{
  const nodes=[1,2,3].map(id=>({id:String(id),url:`https://example.com/${id}`,title:`Synthetic ${id}`,dateAdded:id}));
  const h=await completionHarness(nodes), before=h.read();
  await Promise.all([h.click('review-more'),h.click('review-more')]);
  const saved=h.read();assert.deepEqual(saved.session.queue.map(n=>n.id),['1','2']);
  assert.equal(saved.batchSize,2);assert.deepEqual(saved.entries,before.entries);
  assert.deepEqual(saved.recovery,before.recovery);assert.deepEqual(saved.lastSession,before.lastSession);
  assert.equal(saved.totals.sessions,before.totals.sessions);assert.equal(saved.totals.shown,1);
  assert.equal(h.elements.get('review').hidden,false);assert.deepEqual(h.closed,[]);
  await h.click('review-more');await h.click('done');assert.deepEqual(h.read(),saved);assert.deepEqual(h.closed,[]);
});

test('Review more shows the existing empty state and preserves completion on save failure',async()=>{
  const empty=await completionHarness(), before=empty.read();
  await empty.click('review-more');assert.equal(empty.elements.get('home').hidden,false);
  assert.match(empty.elements.get('home-copy').textContent,/No web bookmarks/);
  assert.deepEqual(empty.read(),before);
  const h=await completionHarness([{id:'1',url:'https://example.com/1',title:'Synthetic'}]), saved=h.read();
  h.failSave(true);await h.click('review-more');
  assert.deepEqual(h.read(),saved);assert.equal(h.elements.get('summary').hidden,false);
  assert.ok(h.elements.get('notice').children.length);
  h.failSave(false);await h.click('review-more');
  assert.equal(h.elements.get('review').hidden,false);assert.equal(h.read().session.queue.length,1);
});
