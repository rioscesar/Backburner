# Release verification — 0.1.4

Use synthetic bookmarks in a clean profile. No account needed.

Verify current folder context below the review URL using nested native folders.
Check direct root leaves, untitled/missing/cyclic ancestry with controlled fixtures,
and native rename/move followed by action revalidation/reload. A changed context
must be shown before accepting the action. At desktop and narrow widths, long
ancestry must ellipsize before the leaf; long leaf names must wrap without
horizontal overflow. Full text stays in the DOM/tooltip, with no links or controls.
Hostile folder names render literally. Confirm no new path persistence, permission,
notification content, selection or recovery behavior.

Run npm run package and npm test; load dist/unpacked, the exact extracted ZIP, and record its SHA256 and Chrome version.

Verify first run, Open, Keep, Later, secondary Stop suggesting and Undo. These must not modify Chrome. Verify Remove presents title/URL/folder and sync/recovery limitations, focuses Cancel, and cancels without mutation. Confirm removal of one leaf; unrelated and same-URL siblings remain. Verify factual completion with no survey.

Restart Chrome and restore from Removed bookmarks. Verify new native ID, destination/position and cleared recovery copy. Missing/unwritable parent must require an explicit destination. Forget-copy cancellation must retain the copy; confirmed forgetting must remove only the local backup. Uninstall loss must be clear in UI and policy.

Inject failure before backup save (no remove), on native remove (copy retained), after remove before final save (pending record survives), on create (pending restore), and after create before final save (inspect candidate before retry; no blind duplicates). Test double clicks, stale/managed/folder rejection, corrupt data, v1 migration without survey fields, reload, exclusive tab writer, empty states, literal hostile titles and narrow keyboard-accessible UI. Never treat simulated events as proof of actual multi-device sync behavior.

Before public launch, complete founder session calibration and non-builder walkthrough. Finalize policy/support, publisher declarations and store fields. Submit only tested package after owner review; don't infer store approval or usefulness from unit tests. No downgrade/uninstall as an operation-recovery strategy.

Verify All done closes only the current review tab and reopening preserves saved decisions/recovery. Other tabs stay open.

Verify Review more bookmarks starts another session directly in the same tab with the existing selection and batch size. With no eligible bookmarks, show the empty state.

## Proactive reminder acceptance

Use a fresh synthetic profile. Decline notification permission and verify manual review still works. Enable through the actual user-gesture prompt; never grant it by changing the shipped required permissions. Default off, no immediate toast, fixed seven-day maximum, 09:00-18:00 local window, fourteen-day Later snooze, and no configurable schedule.

With the review page closed, cross a due boundary in a synthetic clock harness and let the native alarm wake the worker. Stop/restart the worker, remove its alarm, restart Chrome and verify reconstruction from persistent state and no catch-up burst. Check exact boundaries, delayed wake/outside window, clock/DST changes, permission denial/revocation, storage failures before/after reservation, failed notification creation, corrupt records, concurrent events, and cap preservation across off/on. A saved/background review tab must not disable reminders; a currently visible own review suppresses redundant toasts.

Verify notification title/message/identifier contain no bookmark title, URL or folder. Observe an actual headful OS notification and click separately from API/getAll/headless assertions. Record platform-specific suppression and Focus/Do Not Disturb limitations truthfully. Do not claim a notification was displayed, seen or useful from API success.

Click reaches the selected live ID/fingerprint; resolved, missing, snoozed or changed targets must not substitute another bookmark. A reminder uses the existing decision UI and a non-calibrating one-item session. If another session is unfinished, neither arrival nor click may overwrite it: test resume, explicit switch and failed switch-save. Keep/Stop suggesting/Remove stop reminders; Later restarts fourteen days; ignored notifications neither resolve nor escalate. Reminder metadata must never overwrite the page-owned decision/recovery store.

Native and automated clock advancement establish mechanism behavior only. A real Later-return observation takes at least fourteen days plus its weekly slot; do not compress policy or claim a one-week experiment proved it. Founder/newcomer usefulness, visible OS delivery and final store declarations remain distinct evidence.
