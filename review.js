import { flatten, candidates, activityDate, safeUrl, matches, startSession, markShown, decide, finish, undo, DEFAULT_BATCH_SIZE } from './domain.js';
import { createStore, fingerprintUrl } from './store.js';

const $ = id => document.getElementById(id);
const store = createStore(chrome.storage.local);
let state, nodes = [], current, busy = false, screen = 'loading', returnScreen = 'home', decisionLimit = 30;
const sections = ['loading','welcome','home','review','summary','decisions','help','locked','fatal'];

function show(name) {
  sections.forEach(id => { $(id).hidden = id !== name; }); screen = name;
}
function message(text, retry) {
  $('notice').replaceChildren(document.createTextNode(text));
  if (retry) { const button = document.createElement('button'); button.textContent='Retry'; button.addEventListener('click',retry); $('notice').append(button); }
}
function clearMessage() { $('notice').replaceChildren(); }
async function run(action) {
  if (busy) return;
  busy = true; document.querySelectorAll('button').forEach(b => {b.disabled=true;});
  try { await action(); }
  catch { message('That didn’t finish. Your Chrome bookmarks are unchanged. Try again; if saving keeps failing, reload or contact support.',()=>location.reload()); }
  finally { busy=false; document.querySelectorAll('button').forEach(b => {b.disabled=false;}); }
}
async function save(transform) { state = await store.update(transform); }
async function refreshNodes() {
  const bookmarks = flatten(await chrome.bookmarks.getTree());
  // Batch hashing avoids thousands of simultaneous crypto tasks on large trees.
  const result=[];
  for(let i=0; i<bookmarks.length; i+=100) {
    result.push(...await Promise.all(bookmarks.slice(i,i+100).map(async n => ({...n, fingerprint:await fingerprintUrl(n.url)}))));
  }
  nodes=result;
}
function dateLabel(value) { return new Intl.DateTimeFormat(undefined,{month:'short',year:'numeric'}).format(value); }

async function renderReview() {
  if (!state.session) return renderHome();
  await refreshNodes();
  const byId = new Map(nodes.map(n => [n.id,n]));
  const queue = state.session.queue;
  let cursor=state.session.cursor;
  while(cursor<queue.length && !byId.has(queue[cursor].id)) cursor++;
  if(cursor !== state.session.cursor) {
    await save(s => {s.session.cursor=cursor;return s;});
    message('A bookmark is no longer available. We skipped it.');
  }
  if(cursor >= queue.length) {await save(finish);return renderSummary();}
  current=byId.get(queue[cursor].id);
  if(current.fingerprint !== queue[cursor].fingerprint) {
    await save(s => {s.session.queue[cursor].fingerprint=current.fingerprint;return s;});
    message('This bookmark’s address changed in Chrome. Take a fresh look before deciding.');
  }
  await save(s => markShown(s,current));
  show('review');
  $('progress').textContent=state.session.calibration ? `${state.session.reviewed} reviewed · first look` : `Bookmark ${cursor+1} of ${queue.length}`;
  $('progress-detail').textContent=state.session.calibration ? 'Finish whenever it feels enough' : 'One small session';
  const url=new URL(current.url);
  $('domain-mark').textContent=url.hostname[0] || '↗';
  $('domain').textContent=url.hostname;
  $('saved-date').textContent=activityDate(current) ? `Recorded ${dateLabel(activityDate(current))}` : 'Date unknown';
  $('bookmark-title').textContent=current.title || url.hostname;
  $('bookmark-url').textContent=current.url;
  $('selection-reason').textContent=current.dateLastUsed ? 'Older recorded bookmark activity · not full browsing history' : current.dateAdded ? 'Selected from earlier saves · last use unknown' : 'No date recorded · not necessarily unused';
  const entry=state.entries[current.id];
  $('deferrals').textContent=matches(entry,current) && entry.deferrals>0 ? `You’ve chosen Later ${entry.deferrals} ${entry.deferrals===1?'time':'times'}. No rush.` : '';
  $('bookmark-title').focus({preventScroll:true});
}

function renderHome() {
  show('home'); const available=candidates(nodes,state).length;
  $('start').hidden=!available;
  $('home-copy').textContent=available ? `${available.toLocaleString()} ${available===1?'bookmark is':'bookmarks are'} ready for another look. ${state.batchSize ? `Up to ${state.batchSize} in your next session.` : 'Finish your first look whenever you like.'}` : nodes.length ? 'Nothing waiting for your attention. Come back after saving something new, or undo a choice in Review decisions.' : 'No web bookmarks to revisit yet. Save a page in Chrome, then come back. Folders and non-web links aren’t included.';
}

function renderSummary() {
  show('summary'); const report=state.lastSession;
  $('summary-copy').textContent=report ? `${report.reviewed} ${report.reviewed===1?'bookmark':'bookmarks'} considered. Your Chrome bookmarks are right where you left them.` : 'You can come back whenever you like.';
  $('summary-counts').replaceChildren();
  for(const [key,label] of [['reference','Kept as reference'],['dismissed','Stopped suggesting'],['later','Left for later']]) {
    const block=document.createElement('div'), count=document.createElement('strong'), caption=document.createElement('span');
    count.textContent=report?.counts[key] ?? 0; caption.textContent=label;block.append(count,caption);$('summary-counts').append(block);
  }
  document.querySelectorAll('[data-feeling]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.feeling===report?.feeling)));
  document.querySelectorAll('[data-meaningful]').forEach(b=>b.setAttribute('aria-pressed',String(report?.meaningful=== (b.dataset.meaningful==='true'))));
}

async function renderDecisions() {
  await refreshNodes();show('decisions');$('decisions-list').replaceChildren();
  const rows=nodes.filter(n=>matches(state.entries[n.id],n)).sort((a,b)=>state.entries[b.id].at-state.entries[a.id].at);
  $('decisions-empty').hidden=rows.length>0; $('more-decisions').hidden=rows.length<=decisionLimit;
  for(const node of rows.slice(0,decisionLimit)) {
    const entry=state.entries[node.id], row=document.createElement('article'), copy=document.createElement('div'), title=document.createElement('h2'), caption=document.createElement('p'), button=document.createElement('button');
    row.className='decision-row'; title.textContent=node.title || new URL(node.url).hostname;
    caption.textContent=`${new URL(node.url).hostname} · ${{reference:'Kept as reference',dismissed:'Stopped suggesting',later:'Left for later'}[entry.disposition]}`;
    button.className='open-button';button.textContent='Undo';button.setAttribute('aria-label',`Undo decision for ${node.title || new URL(node.url).hostname}`);
    button.addEventListener('click',()=>run(async()=>{await save(s=>undo(s,node.id));message('Decision undone. This bookmark can appear in a future session.');await renderDecisions();}));
    copy.append(title,caption);row.append(copy,button);$('decisions-list').append(row);
  }
}

async function returnToReview() {
  clearMessage();
  if (!state.onboarded) show('welcome');
  else if(state.session) await renderReview();
  else if(returnScreen==='summary' && state.lastSession) renderSummary();
  else {await refreshNodes();renderHome();}
}

async function revalidate() {
  if(!current || !state.session) return false;
  let node;
  try {[node]=await chrome.bookmarks.get(current.id);} catch {
    // Distinguish a removed node from transient permission/API errors.
    const available=flatten(await chrome.bookmarks.getTree());
    if(available.some(n=>n.id===current.id)) throw new Error('Bookmark could not be checked.');
  }
  if(!node || !safeUrl(node.url)) {await renderReview();message('This bookmark is no longer available. Nothing was opened or decided.');return false;}
  if(node.url!==current.url || node.title!==current.title) {await renderReview();message('This bookmark changed in Chrome. Review the updated details before deciding.');return false;}
  return true;
}

async function choose(disposition) {
  clearMessage(); if(!await revalidate())return;
  await save(s=>decide(s,current,disposition));
  message(disposition==='later'?'Saved for a later session.':'Decision saved. Your Chrome bookmark stays intact.');
  await renderReview();
}

$('welcome-start').addEventListener('click',()=>run(async()=>{
  clearMessage();await save(s=>{s.onboarded=true;return s;});await refreshNodes();await save(s=>startSession(s,nodes));await renderReview();
}));
$('start').addEventListener('click',()=>run(async()=>{clearMessage();await refreshNodes();await save(s=>startSession(s,nodes));await renderReview();}));
$('finish').addEventListener('click',()=>run(async()=>{clearMessage();await save(finish);renderSummary();}));
$('done').addEventListener('click',()=>run(async()=>{clearMessage();await refreshNodes();renderHome();}));
$('keep').addEventListener('click',()=>run(()=>choose('reference')));
$('later').addEventListener('click',()=>run(()=>choose('later')));
$('dismiss').addEventListener('click',()=>run(()=>choose('dismissed')));
$('open').addEventListener('click',()=>run(async()=>{
  clearMessage();if(!await revalidate())return;
  await chrome.tabs.create({url:current.url});
  try {await save(s=>{s.session.opened++;s.totals.opened++;return s;});message('Opened in a new tab. Come back here when you’re ready to decide.');}
  catch {message('The bookmark opened, but its open count couldn’t be saved. Your decision is still waiting here.');}
}));
$('decisions-nav').addEventListener('click',()=>run(async()=>{if(!state)return;returnScreen=screen;clearMessage();decisionLimit=30;await renderDecisions();}));
$('help-nav').addEventListener('click',()=>{returnScreen=screen;show('help');});
$('decisions-back').addEventListener('click',()=>run(returnToReview));
$('help-back').addEventListener('click',()=>run(async()=>{if(!state)return show('fatal');await returnToReview();}));
$('more-decisions').addEventListener('click',()=>run(async()=>{decisionLimit+=30;await renderDecisions();}));
document.querySelectorAll('[data-feeling]').forEach(b=>b.addEventListener('click',()=>run(async()=>{await save(s=>{s.lastSession.feeling=b.dataset.feeling;return s;});renderSummary();})));
document.querySelectorAll('[data-meaningful]').forEach(b=>b.addEventListener('click',()=>run(async()=>{await save(s=>{s.lastSession.meaningful=b.dataset.meaningful==='true';return s;});renderSummary();})));
$('reload-locked').addEventListener('click',()=>location.reload());$('reload-fatal').addEventListener('click',()=>location.reload());

// The lock spans tabs as well as reloads; a second tab cannot race storage writes.
navigator.locks.request('backburner-review-writer',{ifAvailable:true},async lock=>{
  if(!lock){show('locked');return;}
  try {
    const tab=await chrome.tabs.getCurrent();
    await chrome.storage.session.set({reviewTabId:tab.id});
    chrome.runtime.onMessage.addListener((request,sender,respond)=>{
      if(sender.id===chrome.runtime.id && request.type==='review-alive')respond({tabId:tab.id});
    });
    state=await store.load();
    await refreshNodes();
    // Remove only obsolete extension records, never native bookmarks.
    const valid = new Map(nodes.map(n=>[n.id,n]));
    if(Object.keys(state.entries).some(id=>!valid.has(id)||!matches(state.entries[id],valid.get(id)))) {
      await save(s=>{for(const id of Object.keys(s.entries))if(!valid.has(id)||!matches(s.entries[id],valid.get(id)))delete s.entries[id];return s;});
    }
    $('calibration-note').hidden=DEFAULT_BATCH_SIZE!==null;
    if(!state.onboarded)show('welcome');else if(state.session)await renderReview();else renderHome();
  } catch { show('fatal'); }
  await new Promise(()=>{});
}).catch(()=>show('fatal'));
