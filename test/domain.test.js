import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,safeUrl,flatten,candidates,startSession,markShown,decide,finish,undo,validateState} from '../domain.js';
import {node,fp,otherFp} from './fixtures.js';

test('URL controls accept web destinations and reject executable/local/credential URLs',()=>{
  for(const url of ['https://example.com/a','http://example.com']) assert.equal(safeUrl(url),true);
  for(const url of ['javascript:alert(1)','data:text/html,x','file:///a','chrome://bookmarks','https://name:pass@example.com','not a URL']) assert.equal(safeUrl(url),false);
});
test('tree controls include only eligible leaves, even deeply nested',()=>{
  assert.deepEqual(flatten([{id:'0',children:[node(),node('2',{url:'javascript:alert(1)'})]}]).map(n=>n.id),['1']);
  let tree=[node()];for(let i=0;i<2000;i++)tree=[{children:tree}];assert.equal(flatten(tree).length,1);
});
test('selection interleaves unknown dates, orders dated records and does not equate unknown with unused',()=>{
  const nodes=[node('1',{dateAdded:3000}),node('2',{dateAdded:undefined}),node('3',{dateAdded:1000}),node('4',{dateAdded:2000})];
  assert.deepEqual(candidates(nodes,emptyState()).map(n=>n.id),['3','2','4','1']);
});
test('all decisions preserve input nodes; suppression, undo, and changed URL fingerprint controls',()=>{
  for(const disposition of ['reference','dismissed','later']) {
    const n=node(), before=structuredClone(n);let s=startSession(emptyState(),[n]);s=decide(s,n,disposition);
    assert.deepEqual(n,before);assert.equal(candidates([n],s).length,disposition==='later'?1:0);
    assert.equal(candidates([node('1',{fingerprint:otherFp})],s).length,1);
    assert.equal(candidates([n],undo(s,'1')).length,1);
  }
});
test('deferred entries come after unseen ones and repeat count increases only for matching URL',()=>{
  const a=node(),b=node('2');let s=startSession(emptyState(),[a]);s=finish(decide(s,a,'later'));
  assert.deepEqual(candidates([a,b],s).map(n=>n.id),['2','1']);
  s=decide(startSession(s,[a]),a,'later');assert.equal(s.entries['1'].deferrals,2);
});
test('session freezes its queue, records impressions once, and learns size only on finish',()=>{
  const a=node(),b=node('2');let s=startSession(emptyState(),[a,b]);
  s=markShown(markShown(s,a),a);assert.equal(s.totals.shown,1);assert.equal(s.batchSize,null);
  assert.deepEqual(startSession(s,[node('3')]),s);
  s=finish(decide(s,a,'reference'));assert.equal(s.batchSize,1);assert.equal(s.lastSession.reviewed,1);
  assert.equal(startSession(s,[b,node('3')]).session.queue.length,1);
});
test('stale decision and unknown action controls fail without changing state',()=>{
  const s=startSession(emptyState(),[node()]);const before=structuredClone(s);
  assert.throws(()=>decide(s,node('2'),'reference'));
  assert.throws(()=>decide(s,node('1',{fingerprint:otherFp}),'reference'));
  assert.throws(()=>decide(s,node(),'delete'));assert.deepEqual(s,before);
  assert.doesNotThrow(()=>decide(s,node(),'reference'));
});
test('repeated deferral rotates behind older deferred items instead of starving them',()=>{
  const a=node(),b=node('2');let s=startSession(emptyState(),[a,b]);
  s=decide(s,a,'later',100);s=decide(s,b,'later',200);s=finish(s);s.batchSize=1;
  s=decide(startSession(s,[a,b]),a,'later',300);s=finish(s);
  assert.deepEqual(candidates([a,b],s).map(n=>n.id),['2','1']);
});
test('schema checker accepts real transitions and rejects damaged/future state',()=>{
  let s=decide(startSession(emptyState(),[node()]),node(),'reference');
  assert.doesNotThrow(()=>validateState(s));assert.doesNotThrow(()=>validateState(finish(s)));
  for(const bad of [{...s,version:999},{...s,batchSize:0},{...s,entries:{'1':{fingerprint:fp,disposition:'delete',at:1,deferrals:0}}},{...s,session:{...s.session,cursor:99}},{...s,totals:{}}])assert.throws(()=>validateState(bad));
});
