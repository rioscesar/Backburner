import {createReminders,ALARM_NAME,NOTIFICATION_ID} from './reminders.js';
import {STATE_KEY} from './store.js';

let launching = Promise.resolve();
async function launch(reminder=false) {
  const url = chrome.runtime.getURL(reminder?'review.html#reminder':'review.html');
  const {reviewTabId} = await chrome.storage.session.get('reviewTabId');
  if (Number.isInteger(reviewTabId)) {
    try {
      const tab = await chrome.tabs.get(reviewTabId);
      // An ID can now refer to a tab navigated away from Backburner. Restoring the
      // extension URL is safe but would disrupt that page; require a live owner.
      const reply = await chrome.runtime.sendMessage({type:'review-alive'});
      if(reply?.tabId===reviewTabId) {
        await chrome.tabs.update(tab.id, {active:true});
        await chrome.windows.update(tab.windowId, {focused:true});
        if(reminder)await chrome.runtime.sendMessage({type:'reminder-handoff'});
        return;
      }
    } catch { /* Closed/navigated tab or no listener. Create a fresh review. */ }
  }
  const tab=await chrome.tabs.create({url});
  await chrome.storage.session.set({reviewTabId:tab.id});
}
export function openReview(reminder=false) {
  launching=launching.catch(()=>{}).then(()=>launch(reminder));
  return launching;
}

// Notification Promises require Chrome 116; callbacks retain our Chrome 114 floor.
const notificationCall=(method,...args)=>new Promise((resolve,reject)=>{
  if(typeof chrome.notifications?.[method]!=='function')return reject(new Error('Notification permission is unavailable.'));
  chrome.notifications[method](...args,result=>{
    const error=chrome.runtime.lastError;
    if(error)reject(new Error(error.message));else resolve(result);
  });
});

async function isReviewVisible() {
  const {reviewTabId}=await chrome.storage.session.get('reviewTabId');
  if(!Number.isInteger(reviewTabId))return false;
  let tab,reply;
  try {
    tab=await chrome.tabs.get(reviewTabId);
    reply=await chrome.runtime.sendMessage({type:'review-alive'});
  } catch(error) {
    if(/No tab with id|Receiving end does not exist|message port closed/i.test(error.message))return false;
    throw error;
  }
  if(reply?.tabId!==reviewTabId || !tab.active)return false;
  return (await chrome.windows.get(tab.windowId)).focused;
}

// The launcher is reusable from an extension page; reminder writes belong only to the worker.
if(typeof document==='undefined') {
chrome.action.onClicked.addListener(() => {
  openReview().catch(() => console.error('Backburner could not open. Please try the toolbar button again.'));
});
const reminders=createReminders({
  storage:chrome.storage.local,bookmarks:chrome.bookmarks,alarms:chrome.alarms,
  notifications:{
    create:(...args)=>notificationCall('create',...args),
    clear:(...args)=>notificationCall('clear',...args),
    getAll:()=>notificationCall('getAll'),
    getPermissionLevel:()=>notificationCall('getPermissionLevel')
  },
  permissions:chrome.permissions,action:chrome.action,isReviewVisible,now:()=>Date.now()
});
const checkReminders=()=>reminders.check().catch(()=>console.error('Backburner reminders could not be checked. Open Privacy & help for reminder status.'));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM_NAME)checkReminders();});
chrome.runtime.onStartup.addListener(checkReminders);
chrome.runtime.onInstalled.addListener(checkReminders);
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local' && changes[STATE_KEY])checkReminders();
});
for(const event of ['onCreated','onRemoved','onChanged','onMoved','onImportEnded']) {
  chrome.bookmarks[event].addListener(checkReminders);
}
chrome.permissions.onAdded.addListener(()=>{
  listenForNotificationClicks();
  checkReminders();
});
chrome.permissions.onRemoved.addListener(checkReminders);
const notificationClicked=id=>{
  if(id!==NOTIFICATION_ID)return;
  reminders.click().then(snapshot=>{
    if(snapshot.enabled)return openReview(true);
  }).catch(()=>console.error('Backburner could not open this reminder. Use the toolbar to check reminder status.'));
};
function listenForNotificationClicks() {
  const event=chrome.notifications?.onClicked;
  if(event && !event.hasListener(notificationClicked))event.addListener(notificationClicked);
}
listenForNotificationClicks();
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('review.html')) || new URL(sender.url).pathname!=='/review.html')return;
  let task;
  if(request.type==='reminders-status')task=()=>reminders.status();
  if(request.type==='reminders-enable' && typeof request.enabled==='boolean')task=()=>reminders.setEnabled(request.enabled);
  if(request.type==='reminders-ack')task=()=>reminders.acknowledge(request.target);
  if(!task)return;
  task().then(value=>respond({ok:true,value}),()=>respond({ok:false,error:'Reminders could not be updated. Saved decisions and recovery copies have not been cleared. Try again from Privacy & help.'}));
  return true;
});
checkReminders();
}
