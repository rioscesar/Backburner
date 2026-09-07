// Set only after observed founder calibration. A null default is a preview gate.
export const DEFAULT_BATCH_SIZE = null;
export const LATER_DELAY = 14 * 24 * 60 * 60 * 1000;
export const DISPOSITIONS = ['reference', 'dismissed', 'later'];
export const emptyState = () => ({ version: 2, onboarded: false, batchSize: DEFAULT_BATCH_SIZE,
  entries: {}, recovery: {}, session: null, lastSession: null, totals: { shown: 0, opened: 0, reference: 0, dismissed: 0, later: 0, removed: 0, sessions: 0 } });

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function flatten(tree) {
  const nodes = [], stack = [...tree].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (node.url && safeUrl(node.url)) nodes.push(node);
    if (Array.isArray(node.children)) for(let i=node.children.length-1;i>=0;i--)stack.push(node.children[i]);
  }
  return nodes;
}

export function folderPath(tree, bookmarkId) {
  const byId=new Map(), visited=new Set(), stack=[...tree];
  while(stack.length) {
    const node=stack.pop();
    if(visited.has(node))continue;
    visited.add(node);byId.set(node.id,node);
    if(Array.isArray(node.children))for(const child of node.children)stack.push(child);
  }
  const bookmark=byId.get(bookmarkId), names=[], parents=new Set();
  if(!bookmark?.url)return ['Folder unavailable'];
  let id=bookmark.parentId;
  while(true) {
    const parent=byId.get(id);
    if(!parent || parent.url)return ['Folder unavailable',...names.reverse()];
    if(parents.has(id))return ['Folder unavailable',...(names.length?[names[0]]:[])];
    if(id==='0' && parent.parentId===undefined)return names.length?names.reverse():['Bookmarks root'];
    parents.add(id);names.push(parent.title || 'Unnamed folder');id=parent.parentId;
  }
}

const validDate = value => Number.isFinite(value) && value > 0 && value <= Date.now() ? value : 0;
export const activityDate = node => Math.max(validDate(node.dateAdded), validDate(node.dateLastUsed));
export const matches = (entry, node) => entry?.fingerprint === node.fingerprint;

function interleave(nodes) {
  const dated = nodes.filter(n => activityDate(n)).sort((a,b) => activityDate(a)-activityDate(b) || a.id.localeCompare(b.id));
  const unknown = nodes.filter(n => !activityDate(n)).sort((a,b) => a.id.localeCompare(b.id));
  const result = [];
  for (let i=0; i<Math.max(dated.length, unknown.length); i++) {
    if (dated[i]) result.push(dated[i]);
    if (unknown[i]) result.push(unknown[i]);
  }
  return result;
}

export function eligibleAt(state, node) {
  const entry=state.entries[node.id];
  if(!matches(entry,node))return 0;
  return entry.disposition==='later' ? entry.at+LATER_DELAY : Infinity;
}

export function candidates(nodes, state, now = Date.now()) {
  const eligible = nodes.filter(n => eligibleAt(state,n)<=now);
  const deferred = n => matches(state.entries[n.id], n) && state.entries[n.id].disposition === 'later';
  const later = eligible.filter(deferred).sort((a,b)=>state.entries[a.id].at-state.entries[b.id].at || a.id.localeCompare(b.id));
  return [...interleave(eligible.filter(n => !deferred(n))), ...later];
}

export function startSession(state, nodes, now = Date.now()) {
  if (state.session) return state;
  const next = structuredClone(state);
  const selected = candidates(nodes, state, now).slice(0, state.batchSize ?? nodes.length);
  if (!selected.length) return next;
  next.session = { started: now, queue: selected.map(n => ({ id:n.id, fingerprint:n.fingerprint })),
    cursor: 0, reviewed: 0, opened: 0, shown: [], counts: {reference:0, dismissed:0, later:0, removed:0}, calibration: state.batchSize === null };
  return next;
}

export function startReminderSession(state, node, now = Date.now()) {
  if(state.session)throw new Error('Finish or resume the existing review before starting a reminder.');
  if(!safeUrl(node.url) || eligibleAt(state,node)>now || Object.values(state.recovery).some(r=>r.id===node.id)) {
    throw new Error('This bookmark is no longer waiting for a reminder.');
  }
  const next=structuredClone(state);
  next.session={started:now,queue:[{id:node.id,fingerprint:node.fingerprint}],cursor:0,
    reviewed:0,opened:0,shown:[],counts:{reference:0,dismissed:0,later:0,removed:0},calibration:false,reminder:true};
  return next;
}

export function markShown(state, node) {
  const next = structuredClone(state), session = next.session;
  if (!session || session.queue[session.cursor]?.id !== node.id) throw new Error('Bookmark is no longer current.');
  if (!session.shown.includes(node.id)) { session.shown.push(node.id); next.totals.shown++; }
  return next;
}

export function decide(state, node, disposition, now = Date.now()) {
  if (!DISPOSITIONS.includes(disposition)) throw new Error('Unknown decision.');
  const next = structuredClone(state), session = next.session;
  const current = session?.queue[session.cursor];
  if (!current || current.id !== node.id || current.fingerprint !== node.fingerprint) throw new Error('Bookmark changed. Review it again.');
  const old = next.entries[node.id];
  next.entries[node.id] = { fingerprint:node.fingerprint, disposition, at:now,
    deferrals: (matches(old, node) ? old.deferrals : 0) + (disposition === 'later' ? 1 : 0) };
  session.cursor++; session.reviewed++; session.counts[disposition]++; next.totals[disposition]++;
  return next;
}

export function finish(state, now = Date.now()) {
  const next = structuredClone(state), session = next.session;
  if (!session) return next;
  if (session.calibration && session.reviewed > 0) next.batchSize = session.reviewed;
  next.lastSession = { started:session.started, ended:now, reviewed:session.reviewed, opened:session.opened,
    counts:session.counts };
  next.totals.sessions++; next.session = null;
  return next;
}

export function undo(state, id) {
  const next = structuredClone(state);
  delete next.entries[id];
  return next;
}

export function validateState(state, legacy = false) {
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  const fingerprint = f => typeof f === 'string' && /^[a-f0-9]{64}$/.test(f);
  if (!state || state.version !== (legacy ? 1 : 2) || typeof state.onboarded !== 'boolean' ||
      !(state.batchSize === null || (integer(state.batchSize) && state.batchSize > 0)) ||
      !state.entries || Array.isArray(state.entries) || typeof state.entries !== 'object') throw new Error('Saved data is not compatible. Nothing has been changed.');
  for (const [id, e] of Object.entries(state.entries)) {
    if (!/^\d+$/.test(id) || !e || !fingerprint(e.fingerprint) || !DISPOSITIONS.includes(e.disposition) || !integer(e.deferrals) || !integer(e.at)) throw new Error('Saved decisions could not be read. Nothing has been changed.');
  }
  for (const key of Object.keys(emptyState().totals).filter(k=>!legacy || k!=='removed')) if (!integer(state.totals?.[key])) throw new Error('Saved counts could not be read.');
  if (state.session) {
    const s = state.session;
    if(s.reminder!==undefined && (s.reminder!==true || s.calibration || s.queue?.length!==1))throw new Error('Saved reminder session could not be read.');
    if (!Array.isArray(s.queue) || !integer(s.cursor) || s.cursor > s.queue.length || !integer(s.started) || !integer(s.reviewed) || !integer(s.opened) || typeof s.calibration !== 'boolean' || !Array.isArray(s.shown) || s.shown.some(id => typeof id !== 'string') ||
      s.queue.some(n => !/^\d+$/.test(n.id) || !fingerprint(n.fingerprint)) || new Set(s.queue.map(n=>n.id)).size !== s.queue.length ||
      [...DISPOSITIONS,...(legacy?[]:['removed'])].some(d => !integer(s.counts?.[d]))) throw new Error('Saved session could not be read. Nothing has been changed.');
  }
  if (state.lastSession) {
    const s = state.lastSession;
    if (![s.started,s.ended,s.reviewed,s.opened].every(integer) || [...DISPOSITIONS,...(legacy?[]:['removed'])].some(d => !integer(s.counts?.[d])) ||
      (legacy && (![null,'useful','neutral','chore'].includes(s.feeling) || ![null,true,false].includes(s.meaningful)))) throw new Error('Saved summary could not be read.');
  }
  if(!legacy) {
    if(!state.recovery || typeof state.recovery!=='object' || Array.isArray(state.recovery))throw new Error('Recovery data could not be read.');
    for(const [key,r]of Object.entries(state.recovery)) {
      if(!/^[a-f0-9-]{36}$/.test(key) || !r || !/^\d+$/.test(r.id) || !/^\d+$/.test(r.parentId) || !integer(r.index) || typeof r.title!=='string' || !safeUrl(r.url) || !fingerprint(r.fingerprint) || !integer(r.at) || !['prepared','removed','restoring'].includes(r.status) || typeof r.counted!=='boolean')throw new Error('Recovery copy could not be read. Nothing has been discarded.');
      if(r.status==='restoring' && (!/^\d+$/.test(r.restoreParent) || !Array.isArray(r.beforeIds) || r.beforeIds.some(id=>!/^\d+$/.test(id))))throw new Error('Pending restore could not be read.');
    }
  }
  return state;
}

export function migrateState(value) {
  if(value.version!==1)return validateState(value);
  validateState(value,true);
  const next=structuredClone(value);next.version=2;next.recovery={};next.totals.removed=0;
  if(next.session)next.session.counts.removed=0;
  if(next.lastSession) {next.lastSession.counts.removed=0;delete next.lastSession.feeling;delete next.lastSession.meaningful;}
  return validateState(next);
}
