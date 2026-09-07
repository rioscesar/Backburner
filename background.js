let launching = Promise.resolve();
async function launch() {
  const url = chrome.runtime.getURL('review.html');
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
        return;
      }
    } catch { /* Closed/navigated tab or no listener. Create a fresh review. */ }
  }
  const tab=await chrome.tabs.create({url});
  await chrome.storage.session.set({reviewTabId:tab.id});
}
export function openReview() {
  launching=launching.catch(()=>{}).then(launch);
  return launching;
}
chrome.action.onClicked.addListener(() => {
  openReview().catch(() => console.error('Backburner could not open. Please try the toolbar button again.'));
});
