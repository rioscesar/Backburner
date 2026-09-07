# Backburner support

[Report a problem](https://github.com/rioscesar/Backburner/issues). Reports are public and require a GitHub account. Include versions and steps with made-up bookmarks. Never include personal URLs, recovery copies, storage dumps or private screenshots. No guaranteed response time.

## Restore a removed bookmark

Choose **Review decisions → Removed bookmarks → Restore**. Confirm the destination. Restoration creates a new native bookmark with new dates. Chrome assigns the ID and may reuse a removed ID after restart. Missing folders require another confirmed destination. Chrome may sync removal and restoration.

Recovery copies persist across browser restarts until restored or explicitly forgotten. **Do not uninstall or clear extension data if you need a copy: that erases local recovery.** Disabling preserves it. Do not downgrade to an older version to troubleshoot.

## Pending operations

An unconfirmed removal can mean Chrome still has the bookmark or that removal completed before its result was saved. Inspect recovery; Backburner never automatically retries deletion. If the original bookmark exists, it will not create a duplicate. You can inspect Chrome and explicitly forget an unneeded copy.

An uncertain restore requires Check restore. A possible match requires your confirmation that it is the restored bookmark. If none is found, you can explicitly allow another attempt, then restore. If a match moved or changed, cancel and inspect Chrome rather than blindly creating another copy. A failed operation preserves its recovery record.

An interrupted restore can leave a restored bookmark with the same ID as the
removed one. Backburner uses the saved restoration phase and pre-restore matching
IDs to offer **Confirm already restored**, rather than mistaking it for an
original that was never removed. Check the matching title, URL and destination
before confirming. Cancel retains the recovery copy; confirmation does not create
another bookmark. Existing matching bookmarks from before the attempt are excluded.

## Keep, Later and Stop suggesting

These leave Chrome intact. Undo them in Review decisions to make a bookmark eligible again. Managed bookmarks cannot be removed. Non-web URLs are not suggested. Duplicates are separate native entries; removing one does not remove the others.

Keep as reference pauses eligibility for 365 elapsed days from the saved decision,
including records saved before the annual policy was added. Choosing Keep again
starts another year. Later waits fourteen days. Stop suggesting never expires
for a matching bookmark identity; Undo or a changed URL can make it eligible
again. Title/folder changes do not reset decisions. Annual eligibility does not
bypass opt-in, the weekly attention limit or Chrome/OS delivery settings.

## Saving errors

If backing up fails, removal is not attempted. If a native operation succeeded but its final save failed, it may need recovery inspection. Read the pending state; do not assume an error means nothing changed.

## Selection and appearance

Manual reviews are self-paced: **Finish whenever it feels enough.** There is no
fixed or learned batch limit or daily quota. Finish early or keep going while
eligible bookmarks remain; Review more starts another eligible queue. Stopping
does not determine future session size, and previously learned limits are ignored.
Unfinished saved queues retain their original contents/order until finished;
new reviews use the self-paced policy. Reminder reviews remain one selected item.

New sessions use weighted randomness, with older recorded activity getting at
most twice the weight of a new or unknown-date bookmark. Recent saves remain
eligible; there are no year quotas or guarantees against repeats across sessions.
Later and Keep still wait for their deadlines, and Stop remains excluded.
Existing unfinished sessions retain their original order. Finish for now, then
Review more bookmarks to start a new randomized session without resetting data.

Light/dark appearance follows the preference reported by Chrome, usually from
your system, and changes live. An installed Chrome theme does not necessarily
change that preference or expose its palette to extension pages. After updating
an unpacked installation in its existing directory, reload the extension and
reopen the review page. Do not uninstall or clear storage to change appearance.

## Reminders and Later

Reminders are opt-in through the welcome screen or Privacy & help. Without permission, manual review still works. After enabling, the first opportunity is no earlier than one week later. There is at most one attempt per seven elapsed days, during 09:00-18:00 local time. Later is not eligible again for fourteen elapsed days, including in Review more; it then shares future reminder slots with other eligible bookmarks. Ignored reminders do not escalate.

If nothing appears, check reminder status in Privacy & help, Chrome notification permission and OS notification/Focus/Do Not Disturb settings. Chrome must be able to run; a sleeping device or fully quit browser cannot guarantee delivery. Restart repairs the schedule, not missed notifications in a burst. Delivery interrupted around a storage/API boundary may skip a slot to avoid duplicates. A granted permission or successful notification API call does not establish that the OS displayed it.

Turning reminders off cancels future reminders without clearing decisions or recovery. Do not uninstall, clear local data or toggle settings repeatedly as a notification retry strategy. Notification content contains no bookmark titles/URLs; clicking opens the selected item in Backburner. If it changed or was resolved, Backburner reports that instead of substituting another item. An unfinished session requires your explicit choice before switching.
