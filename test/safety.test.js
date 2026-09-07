import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

function findings(manifest, source) {
  const hits=[];
  if(JSON.stringify([...(manifest.permissions??[])].sort())!==JSON.stringify(['bookmarks','storage']))hits.push('permissions');
  for(const field of ['host_permissions','optional_host_permissions','optional_permissions','content_scripts','externally_connectable','web_accessible_resources'])if(manifest[field]?.length || (manifest[field] && !Array.isArray(manifest[field])))hits.push(field);
  if(/chrome\.bookmarks\s*\.\s*(create|update|move|remove|removeTree)\s*\(/.test(source))hits.push('bookmark mutation');
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
test('runtime source passes read-only, local-only, safe-rendering fence',()=>{
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
