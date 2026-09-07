import { flatten, folderPath, candidates, activityDate, safeUrl, matches, eligibleAt, startSession, startReminderSession, markShown, decide, finish, undo } from './domain.js';
import { createStore, fingerprintUrl } from './store.js';
import { createRemoval } from './removal.js';

const $ = id => document.getElementById(id);
const store = createStore(chrome.storage.local);
const removal=createRemoval({bookmarks:chrome.bookmarks,read:()=>state,write:save});
let state, nodes = [], current, busy = false, screen = 'loading', returnScreen = 'home', decisionLimit = 30;
let reminderTarget=null, reminderRequested=false;
let bookmarkTree=[], currentFolder=[];
const sections = ['loading','welcome','home','review','summary','decisions','help','locked','fatal'];

function show(name) {
  sections.forEach(id => { $(id).hidden = id !== name; }); screen = name;
}
function message(text, retry, label='Retry') {
  $('notice').replaceChildren(document.createTextNode(text));
  if (retry) { const button = document.createElement('button'); button.textContent=label; button.addEventListener('click',retry); $('notice').append(button); }
}
function clearMessage() { $('notice').replaceChildren(); }
async function run(action) {
  if (busy) return;
  busy = true; document.querySelectorAll('button').forEach(b => {b.disabled=true;});
  try { await action(); }
  catch { message('That didn’t finish. If you were removing or restoring, check Removed bookmarks in Review decisions before retrying. Recovery copies are kept; do not uninstall to troubleshoot.',()=>run(renderDecisions),'Check recovery'); }
  finally {
    busy=false; document.querySelectorAll('button').forEach(b => {b.disabled=false;});
    if(reminderRequested && state) {
      reminderRequested=false;
      queueMicrotask(()=>runReminder(showReminder));
    }
  }
}
async function save(transform) { state = await store.update(transform); }
async function refreshNodes() {
  const tree=await chrome.bookmarks.getTree(), bookmarks=flatten(tree);
  // Batch hashing avoids thousands of simultaneous crypto tasks on large trees.
  const result=[];
  for(let i=0; i<bookmarks.length; i+=100) {
    result.push(...await Promise.all(bookmarks.slice(i,i+100).map(async n => ({...n, fingerprint:await fingerprintUrl(n.url)}))));
  }
  nodes=result;bookmarkTree=tree;
}
function dateLabel(value) { return new Intl.DateTimeFormat(undefined,{month:'short',year:'numeric'}).format(value); }

async function renderReview() {
  if (!state.session) return renderHome();
  await refreshNodes();
  const byId = new Map(nodes.map(n => [n.id,n]));
  const queue = state.session.queue;
  let cursor=state.session.cursor;
  while(cursor<queue.length && (!byId.has(queue[cursor].id) || eligibleAt(state,byId.get(queue[cursor].id))>Date.now())) cursor++;
  if(cursor !== state.session.cursor) {
    await save(s => {s.session.cursor=cursor;return s;});
    message('A bookmark is no longer ready for review. We skipped it.');
  }
  if(cursor >= queue.length) {await save(finish);return renderSummary();}
  current=byId.get(queue[cursor].id);
  if(current.fingerprint !== queue[cursor].fingerprint) {
    if(state.session.reminder) {
      await save(finish);
      renderSummary();
      message('This reminded bookmark changed its address. The reminder ended without substituting another destination.');
      return;
    }
    await save(s => {s.session.queue[cursor].fingerprint=current.fingerprint;return s;});
    message('This bookmark’s address changed in Chrome. Take a fresh look before deciding.');
  }
  await save(s => markShown(s,current));
  show('review');
  $('progress').textContent=state.session.reminder ? `Bookmark ${cursor+1} of ${queue.length}` : `${state.session.reviewed} reviewed`;
  $('progress-detail').textContent=state.session.reminder ? 'One bookmark from your reminder' : 'Finish whenever it feels enough';
  const url=new URL(current.url);
  $('domain-mark').textContent=url.hostname[0] || '↗';
  $('domain').textContent=url.hostname;
  $('saved-date').textContent=activityDate(current) ? `Recorded ${dateLabel(activityDate(current))}` : 'Date unknown';
  $('bookmark-title').textContent=current.title || url.hostname;
  $('bookmark-url').textContent=current.url;
  currentFolder=folderPath(bookmarkTree,current.id);
  $('bookmark-folder').title=currentFolder.join(' / ');
  $('folder-ancestors').hidden=currentFolder.length<2;
  $('folder-ancestors').textContent=currentFolder.slice(0,-1).join(' / ');
  $('folder-leaf').textContent=(currentFolder.length>1?' / ':'')+currentFolder.at(-1);
  $('selection-reason').textContent=state.session.reminder ? 'Reminder rotation · not a relevance score' :
    activityDate(current) ? 'Random mix · older recorded dates get a gentle preference' : 'Random mix · date unknown, not necessarily unused';
  const entry=state.entries[current.id];
  $('deferrals').textContent=matches(entry,current) && entry.deferrals>0 ? `You’ve chosen Later ${entry.deferrals} ${entry.deferrals===1?'time':'times'}. No rush.` : '';
  $('bookmark-title').focus({preventScroll:true});
}

function renderHome() {
  show('home'); const available=candidates(nodes,state).length;
  $('start').hidden=!available;
  $('home-copy').textContent=available ? `${available.toLocaleString()} ${available===1?'bookmark is':'bookmarks are'} ready for another look. Finish whenever it feels enough.` : nodes.length ? 'Nothing ready for review now. Later waits at least 14 days; Keep as reference waits 365 days. Stop suggesting has no expiry. You can check reminder settings in Privacy & help or undo a choice in Review decisions.' : 'No web bookmarks to revisit yet. Save a page in Chrome, then come back. Folders and non-web links aren’t included.';
}

function renderSummary() {
  show('summary'); const report=state.lastSession;
  $('summary-copy').textContent=report ? `${report.reviewed} ${report.reviewed===1?'bookmark':'bookmarks'} considered. Removed bookmarks have local recovery copies in Review decisions.` : 'You can come back whenever you like.';
  $('summary-counts').replaceChildren();
  for(const [key,label] of [['reference','Kept as reference'],['removed','Removed'],['later','Left for later'],['dismissed','Stopped suggesting']]) {
    const block=document.createElement('div'), count=document.createElement('strong'), caption=document.createElement('span');
    count.textContent=report?.counts[key] ?? 0; caption.textContent=label;block.append(count,caption);$('summary-counts').append(block);
  }
}

async function renderDecisions() {
  await refreshNodes();show('decisions');$('decisions-list').replaceChildren();
  renderRecovery();
  const rows=nodes.filter(n=>matches(state.entries[n.id],n)).sort((a,b)=>state.entries[b.id].at-state.entries[a.id].at);
  $('decisions-empty').hidden=rows.length>0 || Object.keys(state.recovery).length>0; $('more-decisions').hidden=rows.length<=decisionLimit;
  for(const node of rows.slice(0,decisionLimit)) {
    const entry=state.entries[node.id], row=document.createElement('article'), copy=document.createElement('div'), title=document.createElement('h2'), caption=document.createElement('p'), button=document.createElement('button');
    row.className='decision-row'; title.textContent=node.title || new URL(node.url).hostname;
    caption.textContent=`${new URL(node.url).hostname} · ${{reference:'Kept as reference for a year',dismissed:'Stopped suggesting — no expiry',later:'Left for later'}[entry.disposition]}`;
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
  const latestFolder=folderPath(await chrome.bookmarks.getTree(),node.id);
  if(node.url!==current.url || node.title!==current.title || node.parentId!==current.parentId || JSON.stringify(latestFolder)!==JSON.stringify(currentFolder)) {
    await renderReview();message('This bookmark or its folder changed in Chrome. Review the updated details before deciding.');return false;
  }
  return true;
}

async function choose(disposition) {
  clearMessage(); if(!await revalidate())return;
  await save(s=>decide(s,current,disposition));
  message(disposition==='later'?'Saved for at least 14 days. Automatic reminders require enabled notifications; eligibility does not promise an immediate reminder.':
    disposition==='reference'?'Kept as reference for 365 days. It becomes eligible again after that; automatic reminders require enabled notifications.':
    'Suggestions stopped with no expiry. Your Chrome bookmark stays intact.');
  await renderReview();
}

async function closeFinishedReview() {
  // This control is only available on the completion screen. Keep it inert if a
  // stale event reaches it while a review is active.
  if (state?.session || !state?.lastSession || screen !== 'summary') return;
  clearMessage();
  try {
    const tab = await chrome.tabs.getCurrent();
    if (!Number.isInteger(tab?.id)) throw new Error('Current review tab is unavailable.');
    await chrome.tabs.remove(tab.id);
  } catch {
    message('We couldn’t close this tab. Try again or close it manually.',()=>run(closeFinishedReview),'Try again');
  }
}

async function startReview() {
  clearMessage();
  await refreshNodes();
  await save(s=>startSession(s,nodes));
  await renderReview();
}

$('welcome-start').addEventListener('click',()=>run(async()=>{
  clearMessage();await save(s=>{s.onboarded=true;return s;});await startReview();
}));
$('start').addEventListener('click',()=>run(startReview));
$('finish').addEventListener('click',()=>run(async()=>{clearMessage();await save(finish);renderSummary();}));
$('done').addEventListener('click',()=>run(closeFinishedReview));
$('review-more').addEventListener('click',()=>run(async()=>{
  if (state?.session || !state?.lastSession || screen !== 'summary') return;
  await startReview();
}));
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
$('help-nav').addEventListener('click',()=>{returnScreen=screen;show('help');refreshReminders();});
$('decisions-back').addEventListener('click',()=>run(returnToReview));
$('help-back').addEventListener('click',()=>run(async()=>{if(!state)return show('fatal');await returnToReview();}));
$('more-decisions').addEventListener('click',()=>run(async()=>{decisionLimit+=30;await renderDecisions();}));
$('reload-locked').addEventListener('click',()=>location.reload());$('reload-fatal').addEventListener('click',()=>location.reload());

// The lock spans tabs as well as reloads; a second tab cannot race storage writes.
navigator.locks.request('backburner-review-writer',{ifAvailable:true},async lock=>{
  if(!lock){show('locked');return;}
  try {
    const tab=await chrome.tabs.getCurrent();
    await chrome.storage.session.set({reviewTabId:tab.id});
    chrome.runtime.onMessage.addListener((request,sender,respond)=>{
      if(sender.id===chrome.runtime.id && request.type==='review-alive')respond({tabId:tab.id});
      if(sender.id===chrome.runtime.id && request.type==='reminder-handoff') {
        respond({ok:true});
        if(busy || !state)reminderRequested=true;
        else runReminder(showReminder);
      }
    });
    state=await store.load();
    if(Object.keys(state.recovery).length)message('Recovery copies are available in Review decisions. Check any pending operation before removing another bookmark.');
    await refreshNodes();
    // Remove only obsolete extension records, never native bookmarks.
    const valid = new Map(nodes.map(n=>[n.id,n]));
    if(Object.keys(state.entries).some(id=>!valid.has(id)||!matches(state.entries[id],valid.get(id)))) {
      await save(s=>{for(const id of Object.keys(s.entries))if(!valid.has(id)||!matches(s.entries[id],valid.get(id)))delete s.entries[id];return s;});
    }
    if(!state.onboarded)show('welcome');else if(state.session)await renderReview();else renderHome();
    await refreshReminders();
    if(location.hash==='#reminder' || reminderRequested) {
      reminderRequested=false;
      await runReminder(showReminder);
    }
  } catch { show('fatal'); }
  await new Promise(()=>{});
}).catch(()=>show('fatal'));

async function reminderRequest(type,details={}) {
  const result=await chrome.runtime.sendMessage({type,...details});
  if(!result?.ok)throw new Error(result?.error || 'Reminder service did not respond.');
  return result.value;
}
function reminderStatus(text) {
  $('reminders-status').textContent=text;
  $('welcome-reminder-status').textContent=text;
}
function renderReminderStatus(snapshot) {
  const enabled=snapshot.enabled;
  $('reminders-enable').hidden=enabled && snapshot.permission;
  $('welcome-reminders').hidden=enabled && snapshot.permission;
  $('reminders-disable').hidden=!enabled;
  if(!enabled)return reminderStatus('Reminders off - manual review only.');
  if(!snapshot.permission)return reminderStatus('Reminders blocked by notification permission or settings. Manual review still works. Enable notifications here and check Chrome/OS notification settings.');
  if(snapshot.status==='error' || snapshot.status==='uncertain')return reminderStatus('Reminder delivery could not be confirmed. No extra notification will bypass the weekly limit. Your saved decisions and recovery copies are kept.');
  const next=snapshot.nextAt ? ` Next opportunity no earlier than ${new Date(snapshot.nextAt).toLocaleString()}.` : '';
  reminderStatus(`Quiet reminders enabled: at most once per 7 days, between 09:00 and 18:00. Chrome or your operating system may delay or suppress them.${next}`);
}
async function refreshReminders() {
  try {renderReminderStatus(await reminderRequest('reminders-status'));}
  catch {reminderStatus('Reminder status could not be loaded. Manual review still works; open Privacy & help to try again.');}
}
function runReminder(action) {
  return run(async()=>{
    try {await action();}
    catch {message('The reminder action did not finish. Saved decisions and recovery copies are kept. Try again from Privacy & help or the reminder.');}
  });
}
function enableReminders() {
  return runReminder(async()=>{
    const granted=await chrome.permissions.request({permissions:['notifications']});
    if(!granted) {
      await refreshReminders();
      message('Notification permission was not granted. You can keep reviewing manually; Later will not promise an automatic reminder.');
      return;
    }
    renderReminderStatus(await reminderRequest('reminders-enable',{enabled:true}));
  });
}
$('welcome-reminders').addEventListener('click',enableReminders);
$('reminders-enable').addEventListener('click',enableReminders);
$('reminders-disable').addEventListener('click',()=>runReminder(async()=>{
  renderReminderStatus(await reminderRequest('reminders-enable',{enabled:false}));
  reminderTarget=null;$('reminder-handoff').hidden=true;
}));

async function reminderNode(target) {
  await refreshNodes();
  const node=nodes.find(n=>n.id===target.id && n.fingerprint===target.fingerprint);
  return node && eligibleAt(state,node)<=Date.now() && !Object.values(state.recovery).some(r=>r.id===node.id) ? node : null;
}
async function acknowledgeReminder(target) {
  await reminderRequest('reminders-ack',{target:{id:target.id,fingerprint:target.fingerprint,attemptAt:target.attemptAt}});
}
async function startRemindedBookmark(target,replace=false) {
  const node=await reminderNode(target);
  if(!node || target.stale) {
    await acknowledgeReminder(target);
    reminderTarget=null;$('reminder-handoff').hidden=true;
    message('This reminded bookmark is no longer waiting. Nothing was substituted or changed.');
    return;
  }
  if(state.session && !replace)throw new Error('An unfinished session needs an explicit handoff.');
  await save(s=>startReminderSession(s.session?finish(s):s,node));
  reminderTarget=null;$('reminder-handoff').hidden=true;
  await renderReview();
  $('bookmark-title').focus();
  await acknowledgeReminder(target);
}
async function showReminder() {
  const snapshot=await reminderRequest('reminders-status');
  renderReminderStatus(snapshot);
  const target=snapshot.pending;
  if(!snapshot.enabled || !target?.clicked) {
    message('This reminder is no longer available. Your current review is unchanged.');
    return;
  }
  const node=await reminderNode(target);
  if(!node || target.stale)return startRemindedBookmark(target);
  const queued=state.session?.queue[state.session.cursor];
  if(queued?.id===node.id && queued.fingerprint===node.fingerprint) {
    await renderReview();await acknowledgeReminder(target);
    $('bookmark-title').focus();
    message('Here is the bookmark from your reminder.');return;
  }
  if(!state.session)return startRemindedBookmark(target);
  reminderTarget=target;
  $('reminder-title').textContent=node.title || new URL(node.url).hostname;
  $('reminder-url').textContent=node.url;
  $('reminder-handoff').hidden=false;
  $('reminder-title').focus();
}
$('reminder-resume').addEventListener('click',()=>runReminder(async()=>{
  if(!reminderTarget)throw new Error('No reminder handoff is pending.');
  await acknowledgeReminder(reminderTarget);
  reminderTarget=null;$('reminder-handoff').hidden=true;
  await returnToReview();
}));
$('reminder-switch').addEventListener('click',()=>runReminder(async()=>{
  if(!reminderTarget)throw new Error('No reminder handoff is pending.');
  await startRemindedBookmark(reminderTarget,true);
}));

function confirmAction(title, detail, action, folders=[], preferred) {
  const dialog=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-detail').textContent=detail;$('confirm-yes').textContent=action;
  const select=$('restore-folder');select.replaceChildren();$('restore-folder-label').hidden=!folders.length;
  for(const folder of folders){const option=document.createElement('option');option.value=folder.id;option.textContent=folder.title || 'Unnamed folder';select.append(option);}
  if(preferred && folders.some(f=>f.id===preferred))select.value=preferred;
  dialog.querySelectorAll('button').forEach(b=>{b.disabled=false;});
  dialog.returnValue='cancel';dialog.showModal();$('confirm-cancel').focus();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve({accepted:dialog.returnValue==='confirm',parentId:select.value}),{once:true}));
}

$('remove').addEventListener('click',()=>run(async()=>{
  clearMessage();if(!await revalidate())return;
  if(current.unmodifiable){message('This bookmark is managed and cannot be removed.');return;}
  const [parent]=await chrome.bookmarks.get(current.parentId);
  const expected=structuredClone(current);
  const answer=await confirmAction('Remove this Chrome bookmark?',`${expected.title}\n${expected.url}\nFolder: ${parent.title || 'Unnamed folder'}\n\nChrome may sync removal to other devices. Backburner saves a local title and URL recovery copy. Uninstalling removes that copy. Restoring creates a new bookmark; original dates are not recovered.`,'Remove bookmark');
  if(!answer.accepted)return;
  const key=await removal.remove(expected,true);
  await renderReview();message('Bookmark removed. A recovery copy is saved on this device.',()=>run(()=>restoreRecovery(key)),'Undo removal');
}));

async function restoreRecovery(key) {
  const record=state.recovery[key];if(!record){message('This recovery copy has already been resolved.');return;}
  const info=await removal.inspect(key);
  if(info.original){message('The original bookmark still exists. No duplicate was created. You can keep or explicitly forget this recovery copy.');return;}
  if(record.status==='restoring') {
    if(info.matches.length) {
      const answer=await confirmAction('A bookmark may already be restored',`${record.title}\n${record.url}\n\nA matching bookmark exists in the restore destination. Confirm it is the restored copy to finish recovery without creating another. If unsure, cancel and inspect Chrome bookmarks.`,'Confirm already restored',info.matches.map(n=>({id:n.id,title:n.title})),info.matches[0].id);
      if(answer.accepted)await removal.resolveRestore(key,answer.parentId,true);
    } else {
      const answer=await confirmAction('Previous restore is uncertain','No new matching bookmark was found. Allow a new restore attempt? This step does not create a bookmark.','Allow another attempt');
      if(answer.accepted)await removal.resolveRestore(key,null,true);
    }
    await renderDecisions();return;
  }
  if(!info.folders.length){message('No writable destination is available. Your recovery copy is kept.');return;}
  const answer=await confirmAction('Restore bookmark',`${record.title}\n${record.url}\n\n${info.parent?'The original folder is selected.':'The original folder is unavailable. Choose a destination.'} Restore creates a new bookmark with new dates. Chrome may sync it. Confirm the destination below.`,'Restore bookmark',info.folders,info.parent?.id);
  if(!answer.accepted)return;
  await removal.restore(key,answer.parentId,true);await renderDecisions();message('Bookmark restored. Its recovery copy has been cleared.');
}

function renderRecovery() {
  const list=$('recovery-list');list.replaceChildren();
  const records=Object.entries(state.recovery).sort((a,b)=>b[1].at-a[1].at);
  $('recovery-empty').hidden=records.length>0;
  for(const [key,r]of records) {
    const row=document.createElement('article');row.className='decision-row';
    const copy=document.createElement('div'),title=document.createElement('h3'),detail=document.createElement('p');
    title.textContent=r.title || r.url;detail.textContent=`${r.url} · ${r.status==='removed'?'Removed — recovery copy saved':r.status==='restoring'?'Restore uncertain — check before retrying':'Removal unconfirmed — inspect before retrying'}`;
    copy.append(title,detail);
    const actions=document.createElement('div');actions.className='recovery-actions';
    const restore=document.createElement('button');restore.className='open-button';restore.textContent=r.status==='restoring'?'Check restore':'Restore';restore.addEventListener('click',()=>run(()=>restoreRecovery(key)));
    const forget=document.createElement('button');forget.className='text-button';forget.textContent='Forget recovery copy';forget.addEventListener('click',()=>run(async()=>{
      const answer=await confirmAction('Forget this recovery copy?',`${r.title}\n${r.url}\n\nThis permanently erases Backburner’s local recovery copy. If the bookmark is removed, Backburner will no longer be able to restore it.`,'Forget recovery copy');
      if(answer.accepted){await removal.forget(key,true);await renderDecisions();message('Recovery copy forgotten.');}
    }));actions.append(restore,forget);row.append(copy,actions);list.append(row);
  }
}
