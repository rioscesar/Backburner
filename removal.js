import {safeUrl} from './domain.js';

// Only this module may mutate Chrome bookmarks. All callers hold the review lock.
const leaf = n => n && safeUrl(n.url) && !n.unmodifiable && !n.children && n.parentId;
const same = (a,b) => a && b && a.id===b.id && a.title===b.title && a.url===b.url && a.parentId===b.parentId && a.index===b.index;
function allNodes(tree) {
  const output=[], stack=[...tree];
  while(stack.length){const n=stack.pop();output.push(n);if(n.children)for(const child of n.children)stack.push(child);}
  return output;
}

export function createRemoval({bookmarks,read,write,newId=()=>crypto.randomUUID()}) {
  let active=false;
  async function exclusive(action) {
    if(active)throw new Error('An operation is already in progress.');
    active=true;try{return await action();}finally{active=false;}
  }
  const tree=async()=>allNodes(await bookmarks.getTree());
  const record=key=>{const r=read().recovery[key];if(!r)throw new Error('Recovery copy no longer exists.');return r;};
  const count=(s,key)=>{
    const r=s.recovery[key];if(r.counted)return s;
    r.counted=true;s.totals.removed++;
    const session=s.session, current=session?.queue[session.cursor];
    if(current?.id===r.id && current.fingerprint===r.fingerprint){session.cursor++;session.reviewed++;session.counts.removed++;}
    delete s.entries[r.id];return s;
  };
  return {
    remove(expected,confirmed=false) {return exclusive(async()=>{
      if(!confirmed)throw new Error('Removal requires confirmation.');
      if(Object.values(read().recovery).some(r=>r.status!=='removed'))throw new Error('Resolve pending recovery operations before removing another bookmark.');
      const [node]=await bookmarks.get(expected.id);
      if(!leaf(node) || !same(node,expected))throw new Error('Bookmark changed or cannot be removed. Review its current details.');
      const key=newId();
      await write(s=>{s.recovery[key]={id:node.id,title:node.title,url:node.url,parentId:node.parentId,index:node.index,fingerprint:expected.fingerprint,at:Date.now(),status:'prepared',counted:false};return s;});
      const [fresh]=await bookmarks.get(node.id);
      if(!leaf(fresh)||!same(fresh,node))throw new Error('Bookmark changed. No removal was attempted; check recovery.');
      // The API has no atomic compare-and-delete. Never retry this automatically.
      await bookmarks.remove(node.id);
      await write(s=>{s.recovery[key].status='removed';return count(s,key);});
      return key;
    });},
    async inspect(key) {
      const r=record(key), nodes=await tree();
      // The restoring journal was saved only after the original ID was absent.
      // Chrome may reuse that ID for the newly created restore across restart.
      const original=r.status==='restoring' ? undefined : nodes.find(n=>n.id===r.id);
      const parent=nodes.find(n=>n.id===(r.restoreParent??r.parentId) && !n.url && !n.unmodifiable);
      const matches=nodes.filter(n=>n.url===r.url && n.title===r.title && (!r.beforeIds || !r.beforeIds.includes(n.id)) && (r.status!=='restoring'||n.parentId===r.restoreParent));
      return {original,parent,matches,folders:nodes.filter(n=>!n.url && n.id!=='0' && !n.unmodifiable)};
    },
    restore(key,parentId,confirmed=false) {return exclusive(async()=>{
      if(!confirmed)throw new Error('Restoration requires confirmation.');
      const r=record(key);
      if(r.status==='restoring')throw new Error('Previous restoration is uncertain. Check recovery before retrying.');
      const nodes=await tree();
      if(nodes.some(n=>n.id===r.id))throw new Error('The original bookmark still exists. Check recovery before restoring.');
      const parent=nodes.find(n=>n.id===parentId && n.id!=='0' && !n.url && !n.unmodifiable);
      if(!parent)throw new Error('Choose an available folder before restoring.');
      const beforeIds=nodes.filter(n=>n.url===r.url && n.title===r.title).map(n=>n.id);
      await write(s=>{Object.assign(s.recovery[key],{status:'restoring',restoreParent:parent.id,beforeIds});return s;});
      const children=await bookmarks.getChildren(parent.id);
      const restored=await bookmarks.create({title:r.title,url:r.url,parentId:parent.id,index:Math.min(r.index,children.length)});
      // If this write fails, keep the restoring journal. Inspection must precede retry.
      await write(s=>{delete s.recovery[key];delete s.entries[restored.id];return s;});
      return restored;
    });},
    resolveRestore(key,existingId,confirmed=false) {return exclusive(async()=>{
      if(!confirmed)throw new Error('Confirmation required.');
      const r=record(key);if(r.status!=='restoring')throw new Error('No pending restore.');
      const nodes=await tree();
      if(existingId) {
        const match=nodes.find(n=>n.id===existingId && n.title===r.title && n.url===r.url && n.parentId===r.restoreParent && !r.beforeIds.includes(n.id));
        if(!match)throw new Error('Matching bookmark changed. Check again.');
        await write(s=>{delete s.recovery[key];return s;});
      } else {
        if(nodes.some(n=>n.title===r.title && n.url===r.url && !r.beforeIds.includes(n.id)))throw new Error('A possible restored bookmark exists. Inspect it before retrying.');
        await write(s=>{s.recovery[key].status='removed';delete s.recovery[key].beforeIds;delete s.recovery[key].restoreParent;return s;});
      }
    });},
    forget(key,confirmed=false) {return exclusive(async()=>{
      if(!confirmed)throw new Error('Forgetting a recovery copy requires confirmation.');
      record(key);await write(s=>{delete s.recovery[key];return s;});
    });}
  };
}
