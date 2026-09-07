# Release verification — 0.1.2

Use synthetic bookmarks in a clean profile. No account needed.

Run npm run package and npm test; load dist/unpacked, the exact extracted ZIP, and record its SHA256 and Chrome version.

Verify first run, Open, Keep, Later, secondary Stop suggesting and Undo. These must not modify Chrome. Verify Remove presents title/URL/folder and sync/recovery limitations, focuses Cancel, and cancels without mutation. Confirm removal of one leaf; unrelated and same-URL siblings remain. Verify factual completion with no survey.

Restart Chrome and restore from Removed bookmarks. Verify new native ID, destination/position and cleared recovery copy. Missing/unwritable parent must require an explicit destination. Forget-copy cancellation must retain the copy; confirmed forgetting must remove only the local backup. Uninstall loss must be clear in UI and policy.

Inject failure before backup save (no remove), on native remove (copy retained), after remove before final save (pending record survives), on create (pending restore), and after create before final save (inspect candidate before retry; no blind duplicates). Test double clicks, stale/managed/folder rejection, corrupt data, v1 migration without survey fields, reload, exclusive tab writer, empty states, literal hostile titles and narrow keyboard-accessible UI. Never treat simulated events as proof of actual multi-device sync behavior.

Before public launch, complete founder session calibration and non-builder walkthrough. Finalize policy/support, publisher declarations and store fields. Submit only tested package after owner review; don't infer store approval or usefulness from unit tests. No downgrade/uninstall as an operation-recovery strategy.

Verify All done closes only the current review tab and reopening preserves saved decisions/recovery. Other tabs stay open.

Verify Review more bookmarks starts another session directly in the same tab with the existing selection and batch size. With no eligible bookmarks, show the empty state.
