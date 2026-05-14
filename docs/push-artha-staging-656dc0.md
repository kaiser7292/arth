# Push Artha Staging and Sync to Build Repo

Push the 2 local commits from artha repo to origin/staging, then sync those changes to artha-builds repo.

## Steps

1. **Push to artha staging branch**
   - Push 2 commits (4f4a222 and d02577c) from artha to origin/staging
   - Command: `git push origin staging`

2. **Sync to artha-builds**
   - Pull latest changes in artha-builds from origin/staging
   - Command: `git pull origin staging`
