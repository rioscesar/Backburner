# Backburner

**A fresh look at the bookmarks you meant to come back to.**

Backburner brings existing Chrome bookmarks into a small review. Open something that catches your eye, keep it as a reference, leave it for later, or stop suggesting it. Your Chrome bookmarks stay intact. Every decision is reversible.

![Backburner review](release/screenshot-review.png)

## Status: developer preview

This is a working extension candidate, not a Chrome Web Store release. Public launch is pending founder calibration, a newcomer usability walkthrough, and store submission/review. The initial preview learns session size when you finish your first review. That calibration flow is not yet the final public first-run experience.

## Try the preview locally

1. Download this implementation branch or clone the repository and check out `experiment/first-review`.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select this repository folder (the one containing `manifest.json`).
4. Open **Backburner** from Chrome’s Extensions menu. Pin it if you want it within reach.

For the release package, run `npm run package` on Windows and load `dist/unpacked`. This contains exactly the runtime files from `dist/backburner.zip`. The ZIP is a store-upload artifact; it is not a one-click consumer installation.

## A small review, without reorganizing everything

- **Open bookmark** visits the page in a new tab. Your review waits here.
- **Keep as reference** means it’s useful and doesn’t need another suggestion.
- **Stop suggesting** removes it from Backburner’s future reviews, keeping the Chrome bookmark.
- **Later** makes it eligible in a future session, behind bookmarks you haven’t reviewed.
- **Review decisions → Undo** puts a bookmark back in consideration.

Finish early whenever you like. An unfinished session resumes after a reload or browser restart. There are no reminders, streaks, folders to build, or tags to maintain.

Selection starts with older recorded bookmark activity, mixing in items with unknown dates. This is a transparent starting point, not a judgment about your interests. Bookmark dates are incomplete clues. Backburner does not read browser history or know whether you read a page.

## Privacy

No account, server, AI service, content scanning, or telemetry. The bookmarks permission is used to read your existing bookmarks; the extension does not modify them. Storage keeps local decisions and session summaries. Uninstalling removes this local state. Chrome’s own bookmark sync is separate.

Read the [privacy policy](PRIVACY.md) and [support information](SUPPORT.md). Opening a bookmark or support link visits that website normally.

## Development and verification

Node 22 or newer. No npm dependencies or build step for the extension.

```powershell
npm run package
npm test
```

The package allowlist excludes tests, documentation, and development files. Tests cover selection, decision recovery, persistence failure, URL handling, permissions, safe rendering patterns, and ZIP contents, with positive and negative controls. CI runs the same commands on Windows.

Browser integration is separately exercised in an isolated Chrome for Testing profile using synthetic bookmarks. Mocked tests alone do not establish browser compatibility. Before release, validate the exact ZIP contents in Chrome and complete the usability and publication checks in [reviewer instructions](release/reviewer-instructions.md).

## Limits

Decisions stay on one device and do not sync. Bookmarks with non-HTTP(S) or credential-bearing URLs are excluded. Local suppression belongs to an individual bookmark, so duplicate URLs in different bookmark entries are separate. Changed destinations become eligible again. A local record reset or uninstall loses decisions but never removes your Chrome bookmarks.
