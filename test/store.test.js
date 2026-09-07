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
