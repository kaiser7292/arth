# Commit & Sync: Remove Notification Listener

Commit the notification listener removal (and related changes) in artha, then sync all affected files to artha-builds.

## Changes to commit in artha (22 files, net -1043 lines)

**Deletions (notification listener removal):**
- `plugins/withNotificationListener.js`
- `app/settings/notification-collector.tsx`
- `services/notification-collector.ts`
- `database/migrations/041_notification_collector.ts`

**Modified (cleanup references):**
- `app/_layout.tsx` — remove notification collector init
- `app/(tabs)/settings.tsx` — remove nav link
- `app/settings/_layout.tsx` — remove route
- `app.json` — remove plugin reference
- `database/migrations/index.ts` — remove migration import
- `database/TABLE_SCHEMAS.ts` — remove table schema
- `services/backup.ts` — remove notification table from backup
- `.context/` docs updates (4 files)

**Other modifications in same working tree:**
- `app/hisaab/persons.tsx`
- `app/settings/help/index.tsx`
- `__tests__/` (5 test files adjusted)

## Steps

1. Stage all changes and commit in artha with message like:  
   `"Remove notification collector feature and clean up references"`
2. Copy changed files from artha → artha-builds (delete removed files, overwrite modified ones)
3. Commit in artha-builds with matching message
