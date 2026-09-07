# Backburner privacy policy

Applies to version 0.1.8. Maintained through [rioscesar/Backburner](https://github.com/rioscesar/Backburner).

## What stays on your device

Backburner reads Chrome bookmark IDs, titles, URLs, hierarchy and available dates to show suggestions and check the current bookmark before an action. It stores local decisions, URL fingerprints, deferral counts, current session, latest factual session summary and aggregate action counts. It does not collect completion survey responses. Updating from 0.1.0 removes obsolete survey fields while preserving other valid local state.

For each confirmed removal, Backburner first stores a **recovery copy with the bookmark title, URL, original location and identity, and operation status**. Pending restoration also records identifiers used to check whether creation already occurred. These copies are not anonymized. Ordinary decision records use URL fingerprints rather than copying titles and URLs.

Recovery copies remain locally until the bookmark is restored or you explicitly confirm forgetting the copy. There is no automatic expiry or silent quota-based eviction. If a backup cannot be saved, Backburner does not attempt removal. Interrupted operations can leave copies pending until you resolve them.

Optional reminders use a separate local record: enablement, scheduling/attempt times, selection rotation, bookmark IDs and URL fingerprints, and one pending notification target. This record does not copy bookmark titles or URLs. The worker reads the current local lifecycle state and bookmark tree to select an eligible unresolved item; it does not modify decisions or recovery. Stale ordinary reminder metadata is pruned when bookmarks disappear or their URL identity changes. Turning reminders off retains scheduling history to prevent bypassing the frequency limit, but cancels the owned schedule/pending reminder. These records are operational state, not surveys, impression tracking or an analytics history.

## Permissions and native changes

- **Bookmarks:** reads bookmarks, removes one bookmark only after explicit confirmation, and creates a bookmark when you explicitly restore it. No bulk, folder or automatic deletion.
- **Storage:** saves decisions, recovery and session records locally, plus its own tab ID temporarily for returning to the review.
- **Alarms:** schedules local reminder checks and restores the schedule after Chrome restarts. No network scheduler or background-running permission.
- **Notifications (optional):** requested only when you explicitly enable quiet reminders. Notification text and its opaque identifier do not expose bookmark titles, URLs or folders. Chrome/your operating system handles presentation and may retain generic notifications according to its settings.

No browser-history permission, broad website access, content scanning, application backend, remote code, analytics service or account. Selecting Keep, Later or Stop suggesting does not modify native bookmarks. Selecting Remove does. Chrome may sync native removal/restoration according to its own settings; Backburner's local recovery copies do not sync.

## Sharing

Backburner does not transmit bookmark data, recovery content or decision records to its maintainer or other parties. It does not sell data or use it for advertising. Opening a bookmark visits that site normally; its practices apply. Privacy/support links open GitHub, whose privacy practices apply. Information you choose to put in a support issue is public. Never include personal bookmarks, recovery copies or storage dumps.

## Your controls and recovery limits

Review decisions lets you undo suppression, restore removed bookmarks, or explicitly forget a recovery copy. Restore creates a new native bookmark; original IDs and dates cannot be restored. If the original folder is unavailable, confirm a replacement destination. Pending/ambiguous results require inspection to avoid duplicate creation.

Quiet reminders can be enabled or turned off in Privacy & help without uninstalling. Declining notification permission leaves manual review working. The fixed policy is no more than one proactive attempt per seven elapsed days; Later suppresses a bookmark for fourteen elapsed days and Keep as reference for 365 elapsed days from its saved decision, including existing records. Repeating either choice resets its wait. Stop suggesting has no expiry for the matching bookmark identity; Undo or a changed URL restores eligibility. No new deadline records or data collection are required. Native notification delivery may be delayed or blocked by Chrome/OS settings, browser shutdown or device sleep. We do not infer that a notification was seen, that an opened bookmark was read, or that an ignored reminder resolves a bookmark.

**Uninstalling Backburner or clearing extension storage erases all remaining recovery copies and decisions.** Disabling the extension retains them. There is no developer-held or server-side backup. Local recovery cannot reverse every Chrome sync effect or guarantee exact original metadata. Old versions cannot safely interpret the new recovery schema; do not downgrade as a recovery method.

## Contact

Use [Backburner support](https://github.com/rioscesar/Backburner/issues) for non-sensitive questions. Policy and in-product disclosures will be updated if handling changes.
