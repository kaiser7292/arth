---
description: Sync files between artha (dev) and artha-builds (build) repos
---

# Two-Repo Sync Skill

Handles syncing files between the main development repo (artha) and the build repo (artha-builds).

## Repository Structure

**Main Development Repo:** C:\Users\soura\OneDrive\Documents\artha
- All source code development happens here
- Contains app code, database migrations, services, UI components

**Build Repo:** C:\Users\soura\OneDrive\Documents\artha-builds
- Dedicated for local APK builds to avoid CNG conflicts
- android/ directory is committed here (not gitignored)
- No GitHub Actions or automated builds

## Sync Workflow

1. **Identify files that need syncing**
   - Source code changes (services, app, components, etc.)
   - Database migrations
   - Plugins (affect native code)
   - Configuration files

2. **Copy files maintaining directory structure**
   ```powershell
   Copy-Item "services\file.ts" -Destination "..\artha-builds\services\file.ts" -Force
   Copy-Item "app\file.tsx" -Destination "..\artha-builds\app\file.tsx" -Force
   ```

3. **Special handling for Kotlin files**
   - Kotlin plugin changes in `plugins/withNotificationListener.js` regenerate native code
   - Since android/ is committed in artha-builds, manually patch the .kt file
   - Location: `artha-builds/android/app/src/main/java/com/souravbaid/artha/NotificationListenerService.kt`

## Common Sync Patterns

**Sync service file:**
```powershell
Copy-Item "services\file.ts" -Destination "..\artha-builds\services\file.ts" -Force
```

**Sync UI file:**
```powershell
Copy-Item "app\settings\file.tsx" -Destination "..\artha-builds\app\settings\file.tsx" -Force
```

**Sync migration file:**
```powershell
Copy-Item "database\migrations\XXX_file.ts" -Destination "..\artha-builds\database\migrations\XXX_file.ts" -Force
```

**Sync plugin file:**
```powershell
Copy-Item "plugins\file.js" -Destination "..\artha-builds\plugins\file.js" -Force
```

**Sync migrations index (requires manual edit):**
- Add import line
- Add to migrations array

## Files That Typically Need Syncing

After making changes to:
- `services/*` → sync to artha-builds/services/
- `app/*` → sync to artha-builds/app/
- `components/*` → sync to artha-builds/components/
- `database/migrations/*` → sync to artha-builds/database/migrations/
- `plugins/*` → sync to artha-builds/plugins/
- `app.json` → sync to artha-builds/app.json

## Files That Don't Need Syncing

- `__tests__/` (not used in build)
- `.context/` (documentation only)
- `docs/` (documentation only)
- `scripts/` (local dev scripts)
- `bin/` (local dev scripts)

## Manual Patching

For Kotlin plugin changes:
1. Copy the plugin file to artha-builds
2. Manually edit the generated .kt file in artha-builds/android/app/src/main/java/com/souravbaid/artha/
3. Match the new plugin output template

## Key Paths

- Main repo: C:\Users\soura\OneDrive\Documents\artha
- Build repo: C:\Users\soura\OneDrive\Documents\artha-builds
- Kotlin service: artha-builds/android/app/src/main/java/com/souravbaid/artha/NotificationListenerService.kt
