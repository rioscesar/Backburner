# Backburner privacy policy

Effective date: September 6, 2026. Applies to Backburner version 0.1.0.

Backburner helps you revisit existing Chrome bookmarks and decide which ones should receive your attention. It is maintained through the public [rioscesar/Backburner repository](https://github.com/rioscesar/Backburner).

## Information processed on your device

Backburner reads your Chrome bookmark tree, including bookmark IDs, titles, URLs, and available date metadata, to show review suggestions. Titles and URLs are displayed in the extension and are not copied into its saved decision records.

The extension stores bookmark IDs, SHA-256 URL fingerprints used to recognize a changed destination, decisions, deferral counts, session state, aggregate action counts, and optional session feedback in Chrome extension local storage. Fingerprints are identifiers, not anonymization. Session records include timestamps and counts; they do not establish that a page was read. Only the latest session summary is retained, alongside aggregate totals and current per-bookmark decisions. Obsolete decision records are pruned when the extension starts.

The extension also keeps its own review tab ID in temporary session storage so the toolbar button can return you to an open review.

## Permissions and data use

- **Bookmarks:** required to read existing bookmarks. Although Chrome grants bookmark modification capabilities with this permission, Backburner does not create, change, move, or delete your bookmarks.
- **Storage:** required to remember local decisions and sessions.

Backburner does not request browser-history access, broad website access, or content-script access. It does not scan page contents, send analytics, execute remotely hosted code, or connect to an application backend. No account is required.

## Sharing and external websites

Backburner does not transmit bookmark or decision data to its maintainer or any third party. It does not sell data or use it for advertising. When you choose to open a bookmark, Chrome navigates to that website normally, and that site’s data practices apply. Chrome may independently sync your native bookmarks according to your Chrome settings; Backburner’s decisions do not use Chrome sync storage.

Privacy and support links open GitHub. GitHub’s own privacy policy applies there. If you submit a support issue, information you choose to include is public and hosted by GitHub. Do not include personal bookmark URLs, browsing data, or other sensitive information.

## Your controls and retention

You can undo a local decision in **Review decisions**. Disabling the extension stops it from running and retains local state; uninstalling removes extension storage and loses decisions. Your native Chrome bookmarks remain unchanged. There is no server-side copy maintained by Backburner to delete or recover.

## Questions and changes

Ask questions through [Backburner support](https://github.com/rioscesar/Backburner/issues). Changes to data handling will be reflected in this policy and the extension’s disclosures. This policy describes this version’s behavior; it is not a claim about third-party websites or Chrome’s independent services.
