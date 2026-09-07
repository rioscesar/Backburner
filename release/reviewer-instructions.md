# Release verification and store reviewer instructions

No account or credentials are required. Use synthetic bookmarks, never a personal dataset for debugging or screenshots.

## Core journey

1. Save several HTTP(S) pages as Chrome bookmarks.
2. Install the extension and open Backburner from its toolbar action.
3. Read the first-run explanation; begin a review.
4. Open a bookmark. Return to the review and choose Keep as reference.
5. Choose Later on the next item and Stop suggesting on another.
6. Finish the session. Inspect the optional reflection and completion state.
7. Open Review decisions; undo a decision. Start another session.
8. Verify the original Chrome bookmarks are intact.

The current developer preview calibrates session length from the number reviewed in the first finished session. Public release requires an observed founder-derived default and a subsequent first-use check; do not submit this calibration candidate as if that gate passed.

## Required engineering checks

Run `npm run package` and `npm test`. Load `dist/unpacked`, extracted from the exact ZIP, into a clean Chrome profile. Record package SHA-256 and runtime version. Verify reload and browser restart, duplicate tabs, finite completion, empty and all-reviewed states, changed/deleted bookmarks, unsupported URL handling, literal rendering of malicious-looking titles, and keyboard/narrow-window usability. Inject storage failure only in a synthetic test context; confirm no decision advances and retry works.

Inspect network activity: no extension telemetry or content fetches. User-triggered navigation is expected. Check archive inventory and manifest permissions. No private data in screenshots, package, repository, or logs.

## Public launch gates

- Founder observed value and comfortable session size recorded.
- A non-builder can explain choices, start, finish and undo without coaching.
- Live policy/support links checked; disclosures match actual behavior.
- Publisher account and listing fields complete.
- Submit only the tested package. Store approval timing is external.
- Public install link verified after approval before sharing “try it here.”

Publication readiness, submission, approval and longer-term usefulness are different outcomes. Do not mark one complete based on another.
