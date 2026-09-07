// Set only after observed founder calibration. A null default is a preview gate.
export const DEFAULT_BATCH_SIZE = null;
export const DISPOSITIONS = ['reference', 'dismissed', 'later'];
export const emptyState = () => ({ version: 1, onboarded: false, batchSize: DEFAULT_BATCH_SIZE,
  entries: {}, session: null, lastSession: null, totals: { shown: 0, opened: 0, reference: 0, dismissed: 0, later: 0, sessions: 0 } });

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

export function candidates(nodes, state) {
  const eligible = nodes.filter(n => !matches(state.entries[n.id], n) || state.entries[n.id].disposition === 'later');
  const deferred = n => matches(state.entries[n.id], n) && state.entries[n.id].disposition === 'later';
  const later = eligible.filter(deferred).sort((a,b)=>state.entries[a.id].at-state.entries[b.id].at || a.id.localeCompare(b.id));
  return [...interleave(eligible.filter(n => !deferred(n))), ...later];
}

export function startSession(state, nodes, now = Date.now()) {
  if (state.session) return state;
  const next = structuredClone(state);
  const selected = candidates(nodes, state).slice(0, state.batchSize ?? nodes.length);
  if (!selected.length) return next;
  next.session = { started: now, queue: selected.map(n => ({ id:n.id, fingerprint:n.fingerprint })),
    cursor: 0, reviewed: 0, opened: 0, shown: [], counts: {reference:0, dismissed:0, later:0}, calibration: state.batchSize === null };
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
    counts:session.counts, feeling:null, meaningful:null };
  next.totals.sessions++; next.session = null;
  return next;
}

export function undo(state, id) {
  const next = structuredClone(state);
  delete next.entries[id];
  return next;
}

export function validateState(state) {
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  const fingerprint = f => typeof f === 'string' && /^[a-f0-9]{64}$/.test(f);
  if (!state || state.version !== 1 || typeof state.onboarded !== 'boolean' ||
      !(state.batchSize === null || (integer(state.batchSize) && state.batchSize > 0)) ||
      !state.entries || Array.isArray(state.entries) || typeof state.entries !== 'object') throw new Error('Saved data is not compatible. Nothing has been changed.');
  for (const [id, e] of Object.entries(state.entries)) {
    if (!/^\d+$/.test(id) || !e || !fingerprint(e.fingerprint) || !DISPOSITIONS.includes(e.disposition) || !integer(e.deferrals) || !integer(e.at)) throw new Error('Saved decisions could not be read. Nothing has been changed.');
  }
  for (const key of Object.keys(emptyState().totals)) if (!integer(state.totals?.[key])) throw new Error('Saved counts could not be read.');
  if (state.session) {
    const s = state.session;
    if (!Array.isArray(s.queue) || !integer(s.cursor) || s.cursor > s.queue.length || !integer(s.started) || !integer(s.reviewed) || !integer(s.opened) || typeof s.calibration !== 'boolean' || !Array.isArray(s.shown) || s.shown.some(id => typeof id !== 'string') ||
      s.queue.some(n => !/^\d+$/.test(n.id) || !fingerprint(n.fingerprint)) || new Set(s.queue.map(n=>n.id)).size !== s.queue.length ||
      DISPOSITIONS.some(d => !integer(s.counts?.[d]))) throw new Error('Saved session could not be read. Nothing has been changed.');
  }
  if (state.lastSession) {
    const s = state.lastSession;
    if (![s.started,s.ended,s.reviewed,s.opened].every(integer) || DISPOSITIONS.some(d => !integer(s.counts?.[d])) ||
      ![null,'useful','neutral','chore'].includes(s.feeling) || ![null,true,false].includes(s.meaningful)) throw new Error('Saved summary could not be read.');
  }
  return state;
}
