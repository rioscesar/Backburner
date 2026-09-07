# Chrome Web Store listing material

Status: draft for version 0.1.0. Not submitted. Finish calibration and usability validation before using public-ready claims.

## Name
Backburner

## Short description
Revisit forgotten bookmarks. Keep what matters, leave the rest behind. Your Chrome bookmarks stay intact.

## Detailed description
Saved for later doesn’t have to mean forgotten forever.

Backburner gives your existing Chrome bookmarks another moment of attention. Take a small review, open something that catches your eye, and decide what happens next:

• Keep as reference — useful, without repeated suggestions.
• Later — another chance in a future session.
• Stop suggesting — let it leave your attention.

Every option keeps the original Chrome bookmark. Review decisions lets you undo a choice whenever you change your mind.

No new organization system. No accounts, tags, folders to maintain, or infinite feed. Finish when you’ve had enough and return from the toolbar when you want another look.

Local by design: bookmark data and decisions are processed on your device. No history permission, AI service, page scanning, or analytics server. Chrome’s bookmarks permission includes modification capabilities, but Backburner only reads your bookmarks.

Suggestions use available bookmark dates, which can be incomplete. Backburner does not know everything you visit or whether you’ve read a page. Decisions stay on this device and are lost when the extension is uninstalled.

## Single purpose
Help users revisit existing Chrome bookmarks and make reversible decisions about future review suggestions.

## Permission justifications
- bookmarks: read the existing bookmark tree and revalidate current bookmark details for review.
- storage: persist local decisions/session state and remember the extension’s own tab temporarily.

## Privacy declarations for owner verification
No remote code. No transfer of bookmark data or decision records to the developer or third parties. No sale, advertising use, or unrelated data use. The extension locally handles website URLs and user decisions; do not claim it processes no user data. Match the exact dashboard data-category questions to this implementation and privacy policy before certifying.

Privacy URL candidate: https://github.com/rioscesar/Backburner/blob/experiment/first-review/PRIVACY.md
Support URL: https://github.com/rioscesar/Backburner/issues
Category proposal: Productivity. Language: English.

## Assets
- icons/icon128.png: store icon.
- release/screenshot-review.png and screenshot-decisions.png: actual packaged UI with synthetic bookmarks, 1280 × 800.
- release/promo-tile.png: 440 × 280 tile.

Publisher identity, account access, distribution regions and certifications must be completed by the owner in the dashboard. Verify final URLs and required graphic fields there. A marketing site and demo video are not part of the initial release.
