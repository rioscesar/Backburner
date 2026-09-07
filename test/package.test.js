import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const required=['manifest.json','background.js','review.html','review.css','review.js','domain.js','store.js','removal.js','reminders.js','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png'].sort();
function check(names){return JSON.stringify([...names].sort())===JSON.stringify(required);}
function namesFromZip(buffer) {
  const names=[];
  for(let i=0;i<buffer.length-46;i++)if(buffer.readUInt32LE(i)===0x02014b50){const n=buffer.readUInt16LE(i+28),extra=buffer.readUInt16LE(i+30),comment=buffer.readUInt16LE(i+32);names.push(buffer.subarray(i+46,i+46+n).toString());i+=45+n+extra+comment;}
  return names;
}
test('package inventory controls reject leakage and missing files',()=>{
  assert.equal(check(required),true);assert.equal(check([...required,'STATE.md']),false);assert.equal(check(required.slice(1)),false);
});
test('release ZIP contains only runtime files and manifest at root',()=>{
  const zip=new URL('../dist/backburner.zip',import.meta.url);
  assert.ok(existsSync(zip),'Run npm run package before testing.');
  assert.equal(check(namesFromZip(readFileSync(zip))),true);
  const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
  for(const icon of Object.values(manifest.icons))assert.ok(required.includes(icon));
});
