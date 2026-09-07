# Backburner support

[Report a problem](https://github.com/rioscesar/Backburner/issues). Reports are public and require a GitHub account. Include versions and steps with made-up bookmarks. Never include personal URLs, recovery copies, storage dumps or private screenshots. No guaranteed response time.

## Restore a removed bookmark

Choose **Review decisions → Removed bookmarks → Restore**. Confirm the destination. Restoration creates a new native bookmark; original IDs/dates are lost. Missing folders require another confirmed destination. Chrome may sync removal and restoration.

Recovery copies persist across browser restarts until restored or explicitly forgotten. **Do not uninstall or clear extension data if you need a copy: that erases local recovery.** Disabling preserves it. Do not downgrade to an older version to troubleshoot.

## Pending operations

An unconfirmed removal can mean Chrome still has the bookmark or that removal completed before its result was saved. Inspect recovery; Backburner never automatically retries deletion. If the original bookmark exists, it will not create a duplicate. You can inspect Chrome and explicitly forget an unneeded copy.

An uncertain restore requires Check restore. A possible match requires your confirmation that it is the restored bookmark. If none is found, you can explicitly allow another attempt, then restore. If a match moved or changed, cancel and inspect Chrome rather than blindly creating another copy. A failed operation preserves its recovery record.

## Keep, Later and Stop suggesting

These leave Chrome intact. Undo them in Review decisions to make a bookmark eligible again. Managed bookmarks cannot be removed. Non-web URLs are not suggested. Duplicates are separate native entries; removing one does not remove the others.

## Saving errors

If backing up fails, removal is not attempted. If a native operation succeeded but its final save failed, it may need recovery inspection. Read the pending state; do not assume an error means nothing changed.
