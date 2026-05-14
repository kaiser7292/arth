# Sync Artha to Artha-Build Repository

This plan outlines the steps to delete the old artha git repo, initialize a new one in CascadeProjects\artha, push to staging, then sync to artha-build.

## Steps

1. **Delete old artha git repository**
   - Delete C:\Users\soura\artha directory

2. **Initialize git in CascadeProjects\artha**
   - Initialize git repository in C:\Users\soura\CascadeProjects\artha
   - Add remote origin pointing to https://github.com/kaiser7292/artha.git
   - Create staging branch
   - Add all files and commit
   - Force push to staging branch

3. **Clone artha-build repository**
   - Clone from https://github.com/kaiser7292/artha-build.git to C:\Users\soura\artha-build
   - Switch to staging branch if it exists

4. **Sync files from CascadeProjects\artha to artha-build**
   - Copy the following files from C:\Users\soura\CascadeProjects\artha to C:\Users\soura\artha-build:
     - services/account-transfer.ts
     - app/(tabs)/expenses.tsx
   - Also copy any build-related files:
     - .github/workflows/build-apk.yml
     - build-apk.bat
     - build-eas.bat
     - configure-android.bat

5. **Commit and push artha-build**
   - Add and commit the synced files
   - Push to staging branch

## Notes
- The modified files are in C:\Users\soura\CascadeProjects\artha
- The old git repo at C:\Users\soura\artha will be deleted
- A new git repo will be initialized in C:\Users\soura\CascadeProjects\artha
- Both repositories will be pushed to their respective staging branches
