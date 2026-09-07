import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,safeUrl,flatten,folderPath,candidates,startSession,startReminderSession,eligibleAt,LATER_DELAY,markShown,decide,finish,undo,validateState} from '../domain.js';
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
test('folder context follows native ancestry without including the invisible root or mutating data',()=>{
  const leaf=node('4',{parentId:'3'});
  const tree=[{id:'0',title:'Invisible root',children:[
    {id:'1',parentId:'0',title:'Bookmarks Bar',children:[
      {id:'2',parentId:'1',title:'Work',children:[{id:'3',parentId:'2',title:'Kubernetes',children:[leaf]}]},
      node('6',{parentId:'1'})
    ]},node('5',{parentId:'0'})
  ]}];
  const before=structuredClone(tree);
  assert.deepEqual(folderPath(tree,'4'),['Bookmarks Bar','Work','Kubernetes']);
  assert.deepEqual(folderPath(tree,'5'),['Bookmarks root']);
  assert.deepEqual(folderPath(tree,'6'),['Bookmarks Bar']);
  assert.deepEqual(tree,before);
  tree[0].children[0].title='Localized folder';
  assert.equal(folderPath(tree,'4')[0],'Localized folder');
});
test('folder context reports missing/stale parents and cycles without inventing a complete path',()=>{
  const leaf=node('4',{parentId:'3'}), folder={id:'3',parentId:'missing',title:'Kubernetes',children:[leaf]};
  assert.deepEqual(folderPath([folder],'4'),['Folder unavailable','Kubernetes']);
  assert.deepEqual(folderPath([leaf],'4'),['Folder unavailable']);
  assert.deepEqual(folderPath([folder],'missing'),['Folder unavailable']);
  folder.parentId='3';
  assert.deepEqual(folderPath([folder],'4'),['Folder unavailable','Kubernetes']);
  folder.children.push(folder);
  assert.deepEqual(folderPath([folder],'4'),['Folder unavailable','Kubernetes']);
  assert.deepEqual(folderPath([node('3'),leaf],'4'),['Folder unavailable']);
});
test('folder context supports untitled folders and deep ancestry without recursion',()=>{
  let child=node('2001',{parentId:'2000'});
  for(let i=2000;i>0;i--)child={id:String(i),parentId:String(i-1),title:i===2000?'':`Folder ${i}`,children:[child]};
  const path=folderPath([{id:'0',children:[child]}],'2001');
  assert.equal(path.length,2000);assert.equal(path[0],'Folder 1');assert.equal(path.at(-1),'Unnamed folder');
});
test('all decisions preserve input nodes; suppression, undo, and changed URL fingerprint controls',()=>{
  for(const disposition of ['reference','dismissed','later']) {
    const n=node(), before=structuredClone(n);let s=startSession(emptyState(),[n]);s=decide(s,n,disposition);
    assert.deepEqual(n,before);assert.equal(candidates([n],s).length,0);
    assert.equal(candidates([n],s,Date.now()+LATER_DELAY).length,disposition==='later'?1:0);
    assert.equal(candidates([node('1',{fingerprint:otherFp})],s).length,1);
    assert.equal(candidates([n],undo(s,'1')).length,1);
  }
});
test('deferred entries come after unseen ones and repeat count increases only for matching URL',()=>{
  const a=node(),b=node('2');let s=startSession(emptyState(),[a]);s=finish(decide(s,a,'later'));
  const due=s.entries['1'].at+LATER_DELAY;
  assert.deepEqual(candidates([a,b],s,due-1).map(n=>n.id),['2']);
  assert.deepEqual(candidates([a,b],s,due).map(n=>n.id),['2','1']);
  s=decide(startSession(s,[a],due),a,'later',due);assert.equal(s.entries['1'].deferrals,2);
  assert.equal(eligibleAt(s,a),due+LATER_DELAY);
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
  s=decide(startSession(s,[a,b],200+LATER_DELAY),a,'later',300+LATER_DELAY);s=finish(s);
  assert.deepEqual(candidates([a,b],s,300+2*LATER_DELAY).map(n=>n.id),['2','1']);
});

test('Later is a fourteen-day not-before policy across restart and manual review-more sessions',()=>{
  const n=node(),at=1000;
  let s=finish(decide(startSession(emptyState(),[n],at),n,'later',at),at);
  s=validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(startSession(s,[n],at+LATER_DELAY-1).session,null);
  assert.equal(startSession(s,[n],at+LATER_DELAY).session.queue[0].id,n.id);
  assert.equal(candidates([node('1',{fingerprint:otherFp})],s,at+1).length,1);
});

test('targeted reminder reviews preserve state and batch calibration, and never overwrite a session',()=>{
  const n=node(),s=emptyState();s.onboarded=true;
  const next=startReminderSession(s,n,1000);
  assert.equal(next.session.calibration,false);assert.equal(next.session.queue.length,1);
  assert.equal(next.session.reminder,true);assert.doesNotThrow(()=>validateState(next));
  assert.throws(()=>validateState({...next,session:{...next.session,calibration:true}}));
  assert.throws(()=>validateState({...next,session:{...next.session,reminder:'yes'}}));
  assert.equal(finish(decide(next,n,'reference',1001),1002).batchSize,null);
  assert.deepEqual(s,emptyStateWithOnboarding());
  assert.throws(()=>startReminderSession(next,n,1001),/existing review/);
  const later=finish(decide(next,n,'later',1001),1002);
  assert.throws(()=>startReminderSession(later,n,1002),/no longer waiting/);
  const resolved=finish(decide(next,n,'reference',1001),1002);
  assert.throws(()=>startReminderSession(resolved,n,2000),/no longer waiting/);
  assert.throws(()=>startReminderSession({...s,recovery:{copy:{id:n.id}}},n,2000),/no longer waiting/);
  function emptyStateWithOnboarding(){return {...emptyState(),onboarded:true};}
});
test('schema checker accepts real transitions and rejects damaged/future state',()=>{
  let s=decide(startSession(emptyState(),[node()]),node(),'reference');
  assert.doesNotThrow(()=>validateState(s));assert.doesNotThrow(()=>validateState(finish(s)));
  for(const bad of [{...s,version:999},{...s,batchSize:0},{...s,entries:{'1':{fingerprint:fp,disposition:'delete',at:1,deferrals:0}}},{...s,session:{...s.session,cursor:99}},{...s,totals:{}}])assert.throws(()=>validateState(bad));
});
