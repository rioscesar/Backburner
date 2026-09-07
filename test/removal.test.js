import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoval} from '../removal.js';
import {emptyState,startSession,validateState} from '../domain.js';
import {node} from './fixtures.js';

const key='11111111-1111-4111-8111-111111111111';
function fixture() {
  const original=node('10',{parentId:'1',index:0}), sibling=node('11',{parentId:'1',index:1});
  let state=startSession(emptyState(),[original,sibling]);
  const native=new Map([['1',{id:'1',title:'Synthetic folder',children:[]}],['2',{id:'2',title:'Alternative',children:[]}],['10',original],['11',sibling]]);
  let writes=0,removes=0,creates=0;
  const f={native,original,failWrite:0,failRemove:false,failCreate:false,
    read:()=>state,
    write:async transform=>{writes++;if(writes===f.failWrite)throw Error('Synthetic storage rejection');state=validateState(transform(structuredClone(state)));},
    bookmarks:{
      get:async id=>{if(!native.has(id))throw Error('Missing');return [structuredClone(native.get(id))];},
      getTree:async()=>[...native.values()].map(n=>structuredClone(n)),
      getChildren:async parent=>[...native.values()].filter(n=>n.parentId===parent),
      remove:async id=>{removes++;if(f.failRemove)throw Error('Synthetic native rejection');native.delete(id);},
      create:async data=>{creates++;if(f.failCreate)throw Error('Synthetic native rejection');const n={...data,id:String(100+creates)};native.set(n.id,n);return n;}
    },
    counts:()=>({writes,removes,creates}),
    restart:()=>createRemoval({bookmarks:f.bookmarks,read:f.read,write:f.write,newId:()=>key})
  };
  f.service=f.restart();return f;
}
test('confirmed removal targets one leaf and leaves identical-URL siblings alone',async()=>{
  const f=fixture();await assert.rejects(f.service.remove(f.original,false));assert.equal(f.counts().removes,0);
  await f.service.remove(f.original,true);assert.equal(f.native.has('10'),false);assert.equal(f.native.has('11'),true);
  assert.equal(f.read().recovery[key].url,f.original.url);assert.equal(f.read().session.counts.removed,1);
});
test('managed/folder/stale selection controls reject before native mutation',async()=>{
  for(const extra of [{unmodifiable:'managed'},{children:[]},{title:'Changed'},{url:'https://example.com/changed'}]) {
    const f=fixture();f.native.set('10',{...f.original,...extra});await assert.rejects(f.service.remove(f.original,true));assert.equal(f.counts().removes,0);
  }
});
test('backup persistence failure prevents removal; native failure preserves backup',async()=>{
  const a=fixture();a.failWrite=1;await assert.rejects(a.service.remove(a.original,true));assert.equal(a.counts().removes,0);
  const b=fixture();b.failRemove=true;await assert.rejects(b.service.remove(b.original,true));assert.equal(b.native.has('10'),true);assert.equal(b.read().recovery[key].status,'prepared');
  await assert.rejects(b.service.restore(key,'1',true));assert.equal(b.counts().creates,0);
});
test('removal success followed by storage failure survives restart without destructive retry',async()=>{
  const f=fixture();f.failWrite=2;await assert.rejects(f.service.remove(f.original,true));assert.equal(f.native.has('10'),false);
  const resumed=f.restart();assert.equal((await resumed.inspect(key)).original,undefined);assert.equal(f.counts().removes,1);
  const restored=await resumed.restore(key,'1',true);assert.notEqual(restored.id,'10');assert.equal(restored.url,f.original.url);assert.deepEqual(f.read().recovery,{});
});
test('restore failure keeps copy and requires explicit inspection before another attempt',async()=>{
  const f=fixture();await f.service.remove(f.original,true);f.failCreate=true;
  await assert.rejects(f.service.restore(key,'1',true));assert.equal(f.read().recovery[key].status,'restoring');
  await assert.rejects(f.service.restore(key,'1',true));assert.equal(f.counts().creates,1);
  await f.service.resolveRestore(key,null,true);f.failCreate=false;await f.service.restore(key,'1',true);assert.equal(f.counts().creates,2);
});
test('interrupted restore finds new-ID candidates and never blindly duplicates',async()=>{
  const f=fixture();await f.service.remove(f.original,true);f.failWrite=4;
  await assert.rejects(f.service.restore(key,'1',true));assert.equal(f.counts().creates,1);
  const resumed=f.restart(), info=await resumed.inspect(key);assert.equal(info.matches.length,1);assert.notEqual(info.matches[0].id,'11');
  await assert.rejects(resumed.restore(key,'1',true));await assert.rejects(resumed.resolveRestore(key,null,true));assert.equal(f.counts().creates,1);
  await resumed.resolveRestore(key,info.matches[0].id,true);assert.deepEqual(f.read().recovery,{});
});
test('missing destination rejects; explicit alternate restoration succeeds; forget needs confirmation',async()=>{
  const f=fixture();await f.service.remove(f.original,true);f.native.delete('1');
  await assert.rejects(f.service.restore(key,'1',true));assert.equal(f.counts().creates,0);
  const n=await f.service.restore(key,'2',true);assert.equal(n.parentId,'2');
  const g=fixture();await g.service.remove(g.original,true);await assert.rejects(g.service.forget(key,false));assert.ok(g.read().recovery[key]);
  await g.service.forget(key,true);assert.deepEqual(g.read().recovery,{});assert.equal(g.native.has('10'),false);
});
test('concurrent duplicate removal calls mutate only once',async()=>{
  const f=fixture();const results=await Promise.allSettled([f.service.remove(f.original,true),f.service.remove(f.original,true)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.counts().removes,1);
});
