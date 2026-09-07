import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,STATE_KEY,fingerprintUrl} from '../store.js';
test('failed storage write does not advance memory and retry succeeds',async()=>{
  let fail=true, saved;
  const store=createStore({get:async()=>({}),set:async value=>{if(fail)throw Error('synthetic quota');saved=structuredClone(value);}});
  await store.load();await assert.rejects(store.update(s=>{s.onboarded=true;return s;}));
  fail=false;const next=await store.update(s=>{assert.equal(s.onboarded,false);s.onboarded=true;return s;});
  assert.equal(next.onboarded,true);assert.equal(saved[STATE_KEY].onboarded,true);
});
test('concurrent queued writes retain both changes and survive a fresh store',async()=>{
  let saved={};const storage={get:async()=>structuredClone(saved),set:async value=>{saved=structuredClone(value);}};
  const store=createStore(storage);await store.load();
  await Promise.all([store.update(s=>{s.totals.opened++;return s;}),store.update(s=>{s.totals.opened++;return s;})]);
  assert.equal((await createStore(storage).load()).totals.opened,2);
});
test('invalid state is preserved and not silently reset',async()=>{
  let writes=0;const store=createStore({get:async()=>({[STATE_KEY]:{version:999}}),set:async()=>{writes++;}});
  await assert.rejects(store.load());assert.equal(writes,0);
});
test('URL identity is stable and detects changed destinations',async()=>{
  const a=await fingerprintUrl('https://example.com/a');assert.match(a,/^[a-f0-9]{64}$/);
  assert.equal(a,await fingerprintUrl('https://example.com/a'));assert.notEqual(a,await fingerprintUrl('https://example.com/b'));
});
test('v1 migration preserves unrelated state and deletes only obsolete survey fields',async()=>{
  const {emptyState}=await import('../domain.js');const original=emptyState();original.version=1;delete original.recovery;delete original.totals.removed;original.batchSize=4;
  original.lastSession={started:1,ended:2,reviewed:0,opened:0,counts:{reference:0,dismissed:0,later:0},feeling:'useful',meaningful:true};
  let saved;const s=createStore({get:async()=>({[STATE_KEY]:original}),set:async v=>{saved=v;}});const migrated=await s.load();
  assert.equal(migrated.version,2);assert.equal(migrated.batchSize,4);assert.equal('feeling' in migrated.lastSession,false);assert.equal('meaningful' in migrated.lastSession,false);assert.equal(saved[STATE_KEY].version,2);
  const failed=createStore({get:async()=>({[STATE_KEY]:original}),set:async()=>{throw Error('Failure');}});await assert.rejects(failed.load());assert.equal(original.version,1);
});
