import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDate, candidates, emptyState, finish, LATER_DELAY, randomOrder, REFERENCE_DELAY, startSession, validateState } from '../domain.js';
import { fp, node, otherFp, seededRandom } from './fixtures.js';

const at=Date.UTC(2025,0,15), week=7*86400000;
const old=node('1',{dateAdded:Date.UTC(2013,0,1)});
const recent=node('2',{dateAdded:at-week});
const sequence=values=>()=>{assert.ok(values.length,'unexpected random draw');return values.shift();};

test('weighted draws can lead with old or recent saves, without a chronological or year quota',()=>{
  assert.deepEqual(randomOrder([old,recent],at,sequence([.5,.4])).map(n=>n.id),['1','2']);
  assert.deepEqual(randomOrder([old,recent],at,sequence([.8,.4])).map(n=>n.id),['2','1']);
  const brandNew={...recent,dateAdded:at};
  assert.deepEqual(randomOrder([old,brandNew],at,sequence([.8,.4])).map(n=>n.id),['2','1'],
    'an excessive 4x weight would incorrectly put the old bookmark first');
  assert.deepEqual(randomOrder([old,brandNew],at,sequence([.5,.4])).map(n=>n.id),['1','2'],
    'uniform-only selection would incorrectly put the new bookmark first');
});

test('unknown and invalid dates keep baseline chances without being treated as unused',()=>{
  for(const dateAdded of [undefined,NaN,0,-1,Infinity,Date.now()+60000]) {
    const unknown=node('2',{dateAdded});
    assert.equal(activityDate(unknown),0);
    assert.equal(randomOrder([old,unknown],at,sequence([.5,.4]))[0].id,'1');
    assert.equal(randomOrder([old,unknown],at,sequence([.8,.1]))[0].id,'2');
  }
  const unknowns=[node('9',{dateAdded:undefined}),node('2',{dateAdded:undefined})];
  assert.deepEqual(randomOrder(unknowns,at,sequence([.1,.8])).map(n=>n.id),['9','2']);
  assert.deepEqual(randomOrder(unknowns,at,sequence([.8,.1])).map(n=>n.id),['2','9']);
});

test('equal dates have equal weight; recent recorded use and clock changes do not get an old-age boost',()=>{
  const used={...old,dateLastUsed:at};
  assert.equal(activityDate(used),at);
  assert.equal(randomOrder([used,node('2',{dateAdded:old.dateAdded})],at,sequence([.4,.5]))[0].id,'2');
  for(const dateAdded of [1000,at,at+week,undefined]) {
    const nodes=[node('1',{dateAdded}),node('2',{dateAdded})];
    assert.equal(randomOrder(nodes,at,sequence([.1,.8]))[0].id,'1');
    assert.equal(randomOrder(nodes,at,sequence([.8,.1]))[0].id,'2');
  }
});

test('a draw is a reproducible nonmutating permutation, not a random comparator or repeat sampling',()=>{
  const nodes=Array.from({length:1000},(_,i)=>node(String(i+1),{dateAdded:i%3?1000+i:undefined}));
  const before=structuredClone(nodes), first=randomOrder(nodes,at,seededRandom(17));
  assert.deepEqual(nodes,before);
  assert.equal(first.length,nodes.length);
  assert.equal(new Set(first.map(n=>n.id)).size,nodes.length);
  assert.ok(first.every(n=>nodes.includes(n)));
  assert.deepEqual(randomOrder(nodes,at,seededRandom(17)),first);
  assert.notDeepEqual(randomOrder(nodes,at,seededRandom(18)),first);
  assert.notDeepEqual(first,nodes);
  assert.deepEqual(randomOrder([],at,()=>{throw Error('unnecessary draw');}),[]);
  assert.deepEqual(randomOrder([old],at,()=>{throw Error('unnecessary draw');}),[old]);
});

test('random endpoints are finite and invalid randomness fails without altering inputs',()=>{
  const nodes=[old,recent],before=structuredClone(nodes);
  assert.deepEqual(randomOrder(nodes,at,sequence([0,1-Number.EPSILON])),nodes);
  for(const bad of [NaN,Infinity,-.1,1,undefined])assert.throws(()=>randomOrder(nodes,at,()=>bad),/randomness/);
  assert.deepEqual(nodes,before);
});

test('seeded first-draw distribution favors age gently while recent saves still surface',()=>{
  function counts(select) {
    const random=seededRandom(12345), result={'1':0,'2':0};
    for(let i=0;i<12000;i++)result[select(random).id]++;
    return result;
  }
  function gentle(result) {
    assert.ok(result['2']>0,'recent items must have a chance');
    assert.ok(result['1']>result['2']*1.8 && result['1']<result['2']*2.2,'expected approximately 2:1, not 1:1 or 4:1');
  }
  const observed=counts(random=>randomOrder([old,recent],at,random)[0]);
  gentle(observed);
  assert.throws(()=>gentle(counts(()=>old)),/recent items/);
  assert.throws(()=>gentle(counts(random=>random()<.5?old:recent)),/2:1/);
  assert.throws(()=>gentle(counts(random=>random()<.8?old:recent)),/2:1/);
});

test('only eligible bookmarks enter the draw, including due Later and annual references',()=>{
  const nodes=[old,recent,...[3,4,5,6,7,8,9].map(id=>node(String(id)))],state=emptyState();
  state.batchSize=3;
  const entry=(disposition,time,fingerprint=fp)=>({disposition,at:time,fingerprint,deferrals:disposition==='later'?1:0});
  state.entries={
    3:entry('later',at-LATER_DELAY+1),4:entry('reference',at-REFERENCE_DELAY+1),
    5:entry('dismissed',1),6:entry('later',at-LATER_DELAY),
    7:entry('reference',at-REFERENCE_DELAY),8:entry('dismissed',1,otherFp)
  };
  const before=structuredClone(state),eligible=candidates(nodes,state,at);
  assert.deepEqual(eligible.map(n=>n.id),['1','2','6','7','8','9']);
  const draws=[.8,.1,.2,.3,.4,.5];
  const next=startSession(state,nodes,at,sequence(draws));
  assert.deepEqual(next.session.queue.map(n=>n.id),['2','6','7','8','9','1']);
  assert.equal(draws.length,0);
  assert.deepEqual(state,before);assert.deepEqual(next.entries,state.entries);
  assert.doesNotThrow(()=>validateState(next));
  for(const target of ['6','7']) {
    const order=eligible.map(n=>n.id===target?0:.9);
    assert.equal(startSession(state,nodes,at,sequence(order)).session.queue[0].id,target);
  }
});

test('saved queues survive reload without drawing again; only a new session reshuffles',()=>{
  const state=emptyState();state.batchSize=2;
  const first=startSession(state,[old,recent],at,sequence([.5,.4]));
  const resumed=validateState(JSON.parse(JSON.stringify(first)));
  assert.strictEqual(startSession(resumed,[recent,old,node('3')],at+week,()=>{throw Error('rerolled queue');}),resumed);
  assert.deepEqual(resumed.session.queue,first.session.queue);
  const next=startSession(finish(resumed,at+1),[old,recent],at+2,sequence([.8,.1]));
  assert.deepEqual(next.session.queue.map(n=>n.id),['2','1']);
  assert.equal(next.batchSize,2);
  assert.deepEqual(next.entries,first.entries);
});
