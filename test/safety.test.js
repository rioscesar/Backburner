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
  if(JSON.stringify([...(manifest.permissions??[])].sort())!==JSON.stringify(['alarms','bookmarks','storage']))hits.push('permissions');
  if(JSON.stringify([...(manifest.optional_permissions??[])].sort())!==JSON.stringify(['notifications']))hits.push('optional permissions');
  for(const field of ['host_permissions','optional_host_permissions','content_scripts','externally_connectable','web_accessible_resources','chrome_url_overrides'])if(manifest[field]?.length || (manifest[field] && !Array.isArray(manifest[field])))hits.push(field);
  if(/chrome\.bookmarks\s*\.\s*(create|update|move|remove|removeTree)\s*\(/.test(source) || (!recovery && /bookmarks\.(remove|create)\(/.test(source)))hits.push('bookmark mutation');
  if(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(source))hits.push('network');
  if(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|\beval\s*\(/.test(source))hits.push('unsafe DOM');
  return hits;
}
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
test('safety controls catch broadened permissions, mutations, network and unsafe DOM',()=>{
  assert.deepEqual(findings(manifest,'chrome.bookmarks.getTree(); title.textContent = text;'),[]);
  assert.ok(findings({...manifest,permissions:['bookmarks','storage','history']},'').length);
  assert.ok(findings({...manifest,permissions:['alarms','bookmarks','storage','notifications'],optional_permissions:[]},'').length);
  assert.ok(findings({...manifest,optional_permissions:['notifications','history']},'').length);
  assert.ok(findings({...manifest,chrome_url_overrides:{newtab:'review.html'}},'').length);
  for(const bad of ['chrome.bookmarks.remove(id)','fetch(url)','element.innerHTML = title'])assert.ok(findings(manifest,bad).length);
});
test('review UI stays nonmutating; runtime remains local-only and safely rendered',()=>{
  const source=['background.js','review.js','store.js','domain.js','reminders.js'].map(f=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8')).join('\n');
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
  let reminder={enabled:false,status:'off',permission:false,nextAt:null,pending:null};
  const closed=[], tabs={getCurrent:async()=>({id:7}),remove:async id=>{closed.push(id);}};
  const context=createContext({...domain,createStore,fingerprintUrl,createRemoval,structuredClone,URL,Intl,queueMicrotask,
    document:{getElementById:id=>{assert.ok(elements.has(id),`Missing control: ${id}`);return elements.get(id);},
      querySelectorAll:()=>buttons,createElement:element,createTextNode:text=>({textContent:text})},
    chrome:{tabs,permissions:{request:async()=>false},runtime:{sendMessage:async request=>{
      if(request.type==='reminders-ack')reminder.pending=null;
      return {ok:true,value:structuredClone(reminder)};
    }},bookmarks:{getTree:async()=>structuredClone(nodes)},storage:{local:{
      get:async()=>structuredClone(saved),set:async value=>{if(failSave)throw Error('Synthetic storage failure');saved=structuredClone(value);}
    }}},
    navigator:{locks:{request:async()=>{}}}
  });
  const source=readFileSync(new URL('../review.js',import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
  runInContext(source,context);
  await runInContext('(async()=>{state=await store.load();await refreshNodes();renderSummary();})()',context);
  return {elements,tabs,closed,click:id=>elements.get(id).handlers.click(),read:()=>structuredClone(saved[STATE_KEY]),
    evaluate:code=>runInContext(code,context),failSave:value=>{failSave=value;},
    setReminder:value=>{reminder=structuredClone(value);},reminder:()=>structuredClone(reminder)};
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

test('Review more includes every eligible bookmark despite a legacy batch size and repeated clicks preserve one session',async()=>{
  const nodes=[1,2,3].map(id=>({id:String(id),url:`https://example.com/${id}`,title:`Synthetic ${id}`,dateAdded:id}));
  const h=await completionHarness(nodes), before=h.read();
  await Promise.all([h.click('review-more'),h.click('review-more')]);
  const saved=h.read(), ids=saved.session.queue.map(n=>n.id);
  assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
  assert.ok(ids.every(id=>nodes.some(n=>n.id===id)));
  assert.equal(h.elements.get('bookmark-title').textContent,`Synthetic ${ids[0]}`);
  assert.match(h.elements.get('selection-reason').textContent,/Random mix/);
  assert.equal(h.elements.get('progress').textContent,'0 reviewed');
  assert.equal(h.elements.get('progress-detail').textContent,'Finish whenever it feels enough');
  assert.equal(saved.session.calibration,false);
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

test('manual UI can review beyond ten, finish freely and continue without learning a quota',async()=>{
  const nodes=Array.from({length:15},(_,i)=>({id:String(i+1),url:`https://example.com/self-paced/${i}`,title:`Synthetic ${i}`}));
  const h=await completionHarness(nodes);
  await h.evaluate("chrome.bookmarks.get=async id=>[nodes.find(n=>n.id===id)];renderHome()");
  assert.match(h.elements.get('home-copy').textContent,/Finish whenever it feels enough/);
  assert.doesNotMatch(h.elements.get('home-copy').textContent,/Up to|first look/);
  await h.click('start');
  assert.equal(h.read().session.queue.length,15);
  for(let i=0;i<11;i++)await h.click('keep');
  assert.equal(h.read().session.reviewed,11);
  assert.equal(h.elements.get('progress').textContent,'11 reviewed');
  assert.equal(h.elements.get('progress-detail').textContent,'Finish whenever it feels enough');
  await h.click('finish');
  assert.equal(h.read().lastSession.reviewed,11);
  assert.equal(h.read().batchSize,2,'legacy data is retained but must not become a learned quota');
  const entries=h.read().entries;
  await h.click('review-more');
  assert.equal(h.read().session.queue.length,4);
  assert.deepEqual(h.read().entries,entries);
  assert.equal(h.elements.get('progress').textContent,'0 reviewed');
  assert.equal(h.elements.get('progress-detail').textContent,'Finish whenever it feels enough');
});

test('review folder metadata is literal, preserves its leaf, refreshes, and is not persisted',async()=>{
  const leaf={id:'3',parentId:'2',url:'https://example.com/context',title:'Synthetic context'};
  const folder={id:'2',parentId:'1',title:'<img src=x onerror=alert(1)>',children:[leaf]};
  const tree=[{id:'0',children:[{id:'1',parentId:'0',title:'Bookmarks Bar',children:[folder]}]}];
  const h=await completionHarness(tree);
  await h.click('review-more');
  assert.equal(h.elements.get('bookmark-folder').title,'Bookmarks Bar / <img src=x onerror=alert(1)>');
  assert.equal(h.elements.get('folder-ancestors').textContent,'Bookmarks Bar');
  assert.equal(h.elements.get('folder-leaf').textContent,' / <img src=x onerror=alert(1)>');
  assert.equal(h.elements.get('folder-leaf').children.length,0);
  assert.equal(JSON.stringify(h.read()).includes(folder.title),false);
  const before=h.read();
  folder.title='Renamed folder';
  await h.evaluate("chrome.bookmarks.get=async()=>[{id:'3',parentId:'2',url:'https://example.com/context',title:'Synthetic context'}]");
  await h.click('keep');
  assert.deepEqual(h.read(),before);
  assert.equal(h.elements.get('bookmark-folder').title,'Bookmarks Bar / Renamed folder');
  assert.match(h.elements.get('notice').children[0].textContent,/folder changed/);
  await h.click('keep');assert.equal(h.read().entries['3'].disposition,'reference');
});

test('root and unavailable folder metadata replace the previous context rather than retaining it',async()=>{
  const leaf={id:'1',parentId:'0',url:'https://example.com/root',title:'Synthetic root'};
  const tree=[{id:'0',children:[leaf]}],h=await completionHarness(tree);
  await h.click('review-more');
  assert.equal(h.elements.get('folder-leaf').textContent,'Bookmarks root');
  assert.equal(h.elements.get('folder-ancestors').hidden,true);
  leaf.parentId='missing';
  await h.evaluate('renderReview()');
  assert.equal(h.elements.get('bookmark-folder').title,'Folder unavailable');
  assert.equal(h.elements.get('folder-leaf').textContent,'Folder unavailable');
  assert.equal(h.elements.get('folder-ancestors').textContent,'');
});

test('forget copy warns about permanent recovery loss, respects cancel, and gives focused feedback',async()=>{
  const h=await completionHarness();
  await h.evaluate(`save(asyncState=>{
    asyncState.recovery['11111111-1111-4111-8111-111111111111']={id:'1',parentId:'2',index:0,
      title:'Synthetic recovery',url:'https://example.com/recovery',fingerprint:'a'.repeat(64),
      at:1,status:'removed',counted:true};
    return asyncState;
  })`);
  await h.evaluate("confirmAction=async(title,detail)=>{globalThis.confirmDetail=detail;return {accepted:false};};renderRecovery()");
  const before=h.read();
  const forget=()=>h.elements.get('recovery-list').children[0].children[1].children[1].handlers.click();
  await forget();assert.deepEqual(h.read(),before);
  assert.match(h.evaluate('confirmDetail'),/permanently erases.*no longer be able to restore/s);
  assert.doesNotMatch(h.evaluate('confirmDetail'),/does not change Chrome bookmarks/);
  await h.evaluate("confirmAction=async()=>({accepted:true})");
  await forget();
  assert.equal(Object.keys(h.read().recovery).length,0);
  assert.equal(h.elements.get('notice').children[0].textContent,'Recovery copy forgotten.');
  assert.deepEqual(h.read().entries,before.entries);
});

test('Check restore offers reused-ID reconciliation, preserves cancellation and never creates another bookmark',async()=>{
  const nodes=[{id:'1',title:'Synthetic folder'},
    {id:'10',parentId:'1',index:0,title:'Synthetic restored bookmark',url:'https://example.com/restored'},
    {id:'11',parentId:'1',index:1,title:'Synthetic restored bookmark',url:'https://example.com/restored'}];
  const h=await completionHarness(nodes);
  await h.evaluate(`save(s=>{
    s.recovery['11111111-1111-4111-8111-111111111111']={id:'10',parentId:'1',index:0,
      title:'Synthetic restored bookmark',url:'https://example.com/restored',
      fingerprint:nodes.find(n=>n.id==='10').fingerprint,at:1,status:'restoring',
      counted:true,restoreParent:'1',beforeIds:['11']};
    return s;
  })`);
  await h.evaluate(`chrome.bookmarks.create=async()=>{throw Error('Unexpected duplicate creation');};
    confirmAction=async(title,detail,action,folders)=>{globalThis.restorePrompt={title,detail,action,folders};return {accepted:false};};
    renderRecovery()`);
  const before=h.read();
  const check=()=>h.elements.get('recovery-list').children[0].children[1].children[0].handlers.click();
  await check();
  assert.match(h.evaluate('restorePrompt.title'),/already be restored/);
  assert.deepEqual(Array.from(h.evaluate('restorePrompt.folders'),n=>n.id),['10']);
  assert.deepEqual(h.read(),before);
  assert.equal(h.elements.get('notice').children.length,0);
  await h.evaluate("confirmAction=async()=>({accepted:true,parentId:'10'})");
  h.failSave(true);await check();
  assert.deepEqual(h.read(),before);
  h.failSave(false);await check();
  assert.deepEqual(h.read().recovery,{});
  assert.deepEqual(h.read().entries,before.entries);
  assert.equal(h.elements.get('recovery-list').children.length,0);
  assert.equal(nodes.filter(n=>n.url).length,2);
});

test('Keep and Stop handlers report annual versus permanent suppression without requesting permission',async()=>{
  for(const [button,disposition,copy] of [['keep','reference',/365 days/],['dismiss','dismissed',/no expiry/]]) {
    const h=await completionHarness([{id:'1',url:'https://example.com/policy',title:'Synthetic policy'}]);
    await h.click('review-more');
    await h.evaluate("chrome.bookmarks.get=async id=>[nodes.find(n=>n.id===id)];chrome.permissions.request=async()=>{throw Error('Unexpected permission request')}");
    await h.click(button);
    const saved=h.read(),entry=saved.entries['1'];
    assert.equal(entry.disposition,disposition);
    assert.match(h.elements.get('notice').children[0].textContent,copy);
    assert.equal(await h.evaluate('eligibleAt(state,nodes[0])'),button==='keep'?entry.at+domain.REFERENCE_DELAY:Infinity);
    await h.click('review-more');assert.equal(h.read().session,null);
  }
});

test('reminder handoff preserves an unfinished review until explicit switch and uses the selected item',async()=>{
  const h=await completionHarness([1,2].map(id=>({id:String(id),url:`https://example.com/${id}`,title:`Synthetic ${id}`})));
  await h.evaluate('save(s=>startSession(s,nodes,Date.now(),()=>0))');
  const before=h.read(),target=await h.evaluate('nodes[1]');
  h.setReminder({enabled:true,status:'pending',permission:true,nextAt:null,pending:{id:target.id,fingerprint:target.fingerprint,attemptAt:1000,pool:'other',clicked:true}});
  await h.evaluate('runReminder(showReminder)');
  assert.deepEqual(h.read(),before);assert.equal(h.elements.get('reminder-handoff').hidden,false);
  assert.equal(h.elements.get('reminder-title').textContent,'Synthetic 2');
  await h.click('reminder-switch');
  assert.equal(h.read().session.queue[0].id,'2');assert.equal(h.read().session.queue.length,1);
  assert.equal(h.read().session.calibration,false);assert.equal(h.read().batchSize,before.batchSize);
  assert.equal(h.read().lastSession.reviewed,0);assert.equal(h.reminder().pending,null);
  assert.deepEqual(h.closed,[]);
});

test('reminder resume, stale target and save failure cannot erase the current session',async()=>{
  for(const mode of ['resume','stale','failure']) {
    const h=await completionHarness([1,2].map(id=>({id:String(id),url:`https://example.com/${id}`,title:'Synthetic'})));
    await h.evaluate('save(s=>startSession(s,nodes,Date.now(),()=>0))');
    const before=h.read(),target=await h.evaluate('nodes[1]');
    h.setReminder({enabled:true,status:'pending',permission:true,nextAt:null,pending:{id:target.id,fingerprint:mode==='stale'?'b'.repeat(64):target.fingerprint,attemptAt:1000,pool:'other',clicked:true}});
    await h.evaluate('runReminder(showReminder)');
    if(mode==='resume')await h.click('reminder-resume');
    if(mode==='failure'){h.failSave(true);await h.click('reminder-switch');}
    const after=h.read();
    assert.deepEqual(after.session.queue,before.session.queue);assert.equal(after.session.cursor,before.session.cursor);
    assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.recovery,before.recovery);
    assert.deepEqual(after.lastSession,before.lastSession);
    if(mode==='failure')assert.ok(h.reminder().pending);
    else assert.equal(h.reminder().pending,null);
  }
});

test('manual review never requests notification permission; an explicit denial preserves saved state',async()=>{
  const h=await completionHarness([{id:'1',url:'https://example.com/1',title:'Synthetic'}]);
  h.evaluate('globalThis.permissionCalls=0;chrome.permissions.request=async()=>{permissionCalls++;return false;}');
  await h.click('review-more');assert.equal(h.evaluate('permissionCalls'),0);
  const before=h.read();
  await h.click('reminders-enable');
  assert.equal(h.evaluate('permissionCalls'),1);assert.deepEqual(h.read(),before);
  assert.equal(h.reminder().enabled,false);
  assert.match(h.elements.get('notice').children[0].textContent,/not granted/);
});

test('changed destinations end a reminder rather than substitute a URL; ordinary review retains its refresh behavior',async()=>{
  for(const reminder of [true,false]) {
    const raw=[{id:'1',title:'Synthetic',url:'https://example.com/original'}];
    const h=await completionHarness(raw);
    await h.evaluate(reminder?'save(s=>startReminderSession(s,nodes[0]))':'save(s=>startSession(s,nodes))');
    raw[0].url='https://example.com/changed';
    await h.evaluate('renderReview()');
    if(reminder) {
      assert.equal(h.read().session,null);
      assert.equal(h.read().lastSession.reviewed,0);
      assert.match(h.elements.get('notice').children[0].textContent,/without substituting/);
    } else {
      assert.equal(h.read().session.queue[0].fingerprint,await fingerprintUrl(raw[0].url));
      assert.equal(h.elements.get('review').hidden,false);
    }
  }
});
