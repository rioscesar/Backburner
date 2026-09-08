import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
const required=['manifest.json','background.js','review.html','review.css','review.js','domain.js','store.js','removal.js','reminders.js','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png'].sort();
const RELEASE_WEEK_LITERAL='export const WEEK = 7 * 86400000;';
const LATER_DELAY_LITERAL='export const LATER_DELAY = 14 * 24 * 60 * 60 * 1000;';
const REFERENCE_DELAY_LITERAL='export const REFERENCE_DELAY = 365 * 24 * 60 * 60 * 1000;';
function check(names){return JSON.stringify([...names].sort())===JSON.stringify(required);}
function namesFromZip(buffer) {
  const names=[];
  for(let i=0;i<buffer.length-46;i++)if(buffer.readUInt32LE(i)===0x02014b50){const n=buffer.readUInt16LE(i+28),extra=buffer.readUInt16LE(i+30),comment=buffer.readUInt16LE(i+32);names.push(buffer.subarray(i+46,i+46+n).toString());i+=45+n+extra+comment;}
  return names;
}
function contentFromZip(buffer,name) {
  for(let i=0;i<buffer.length-46;i++)if(buffer.readUInt32LE(i)===0x02014b50) {
    const length=buffer.readUInt16LE(i+28),extra=buffer.readUInt16LE(i+30),comment=buffer.readUInt16LE(i+32);
    if(buffer.subarray(i+46,i+46+length).toString()===name) {
      const offset=buffer.readUInt32LE(i+42),method=buffer.readUInt16LE(i+10);
      assert.equal(buffer.readUInt32LE(offset),0x04034b50);
      const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
      const compressed=buffer.subarray(start,start+buffer.readUInt32LE(i+20));
      assert.ok(method===0 || method===8,'unsupported ZIP compression');
      return method===8?inflateRawSync(compressed):compressed;
    }
    i+=45+length+extra+comment;
  }
  assert.fail(`Missing ZIP entry: ${name}`);
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
test('release unpacked runtime matches source bytes for every packaged file',()=>{
  const unpacked=new URL('../dist/unpacked/',import.meta.url);
  assert.ok(existsSync(unpacked),'Run npm run package before testing.');
  const zip=readFileSync(new URL('../dist/backburner.zip',import.meta.url));
  for(const relative of required) {
    const source=readFileSync(new URL(`../${relative}`,import.meta.url));
    const built=readFileSync(new URL(`../dist/unpacked/${relative}`,import.meta.url));
    assert.deepEqual(built,source,`${relative} should match the production source exactly`);
    assert.deepEqual(contentFromZip(zip,relative),source,`${relative} ZIP entry should match production source exactly`);
  }
});
test('default release artifact stays production-only without test cadence markers or bypasses',()=>{
  const unpacked=new URL('../dist/unpacked/',import.meta.url);
  assert.ok(existsSync(unpacked),'Run npm run package before testing.');
  const manifest=JSON.parse(readFileSync(new URL('../dist/unpacked/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.name,'Backburner');
  assert.equal(manifest.minimum_chrome_version,'114');
  assert.equal(Object.hasOwn(manifest,'version_name'),false);
  assert.deepEqual([...(manifest.permissions??[])].sort(),['alarms','bookmarks','storage']);
  assert.deepEqual([...(manifest.optional_permissions??[])].sort(),['notifications']);
  const review=readFileSync(new URL('../dist/unpacked/review.html',import.meta.url),'utf8');
  assert.doesNotMatch(review,/NOT FOR PUBLICATION|30 seconds|notification-test-banner/);
  const reviewJs=readFileSync(new URL('../dist/unpacked/review.js',import.meta.url),'utf8');
  assert.doesNotMatch(reviewJs,/30-second test-build limit|at most once every 30 seconds, at any hour in this test build/);
  const reminders=readFileSync(new URL('../dist/unpacked/reminders.js',import.meta.url),'utf8');
  assert.ok(reminders.includes(RELEASE_WEEK_LITERAL));
  assert.match(reminders,/const RETRY = 3600000;/);
  assert.match(reminders,/date\.getHours\(\) < 9/);
  assert.match(reminders,/offer\.at \+ LATER_DELAY/);
  assert.doesNotMatch(reminders,/UNANSWERED_COOLDOWN|30000|TEST ONLY|NOT FOR PUBLICATION/);
  const domain=readFileSync(new URL('../dist/unpacked/domain.js',import.meta.url),'utf8');
  assert.ok(domain.includes(LATER_DELAY_LITERAL));
  assert.ok(domain.includes(REFERENCE_DELAY_LITERAL));
});
