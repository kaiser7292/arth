# Merge Staging to Main and Release v18

This plan outlines the steps to merge staging changes to main branch and create a v18 release with an APK build for Pixel 9 and Samsung S8 (ARM 64 v8), along with risk analysis.

## Risk Analysis

**High Risks:**
1. **Transfer reclassification changes are significant** - This is a core functionality change that affects how expenses are reclassified as transfers
2. **Database schema migration (migration 046)** - Adds `reclassified_as_transfer` and `linked_transfer_id` columns to expenses table
3. **Data integrity concerns** - If there's a bug, users could lose visibility of their expenses/credits
4. **No device testing** - Changes haven't been tested on actual devices (Pixel 9, Samsung S8)

**Medium Risks:**
1. **Backward compatibility logic** - Fallback logic for migration 046 might not cover all edge cases
2. **Transfers filter changes** - Changes to `getTransfersForUser` might affect the transfers filter UI
3. **Release without beta testing** - Going directly to release v18 without beta testing

**Questions to Consider:**
- Has the transfer reclassification been tested on a device with real data?
- Are there any known issues with the reclassification logic?
- Should we do a beta release first?
- What's the typical release process for this project?

## Steps

1. **Merge staging to main** (artha)
   - Checkout main branch in C:\Users\soura\CascadeProjects\artha
   - Merge staging into main
   - Push to origin/main

2. **Merge staging to main** (artha-builds)
   - Checkout main branch in C:\Users\soura\artha-builds
   - Merge staging into main
   - Push to origin/main

3. **Create release v18** (artha)
   - Create GitHub release for v18
   - Tag the commit as v18.0.0

4. **Build APK for ARM 64 v8**
   - Run build-apk.bat with ARM 64 v8 configuration
   - Test on Pixel 9 and Samsung S8 if possible
   - Attach APK to GitHub release

## Recommendation
Given the significant nature of the transfer reclassification changes, I recommend:
1. Do a beta release first
2. Test the reclassification logic on a device with real data
3. Verify the migration 046 works correctly
4. Then proceed with v18 release

Should I proceed with the merge and release, or do a beta release first?
