# Gradle Build Optimization

Enable Gradle configuration cache and add performance optimizations to reduce GitHub Actions build time.

## Changes

1. **Enable Gradle Configuration Cache in GitHub workflow** (`.github/workflows/build-apk.yml`)
   - Add `--configuration-cache` flag to Gradle build command
   - Skips configuration phase on subsequent builds

2. **Add Gradle optimizations** (`android/gradle.properties`)
   - Enable build caching
   - Enable parallel execution
   - Enable configure on demand
   - Increase JVM heap size
   - Enable configuration cache

## Expected Impact
- Configuration cache: saves 2-5 minutes per build
- Gradle optimizations: saves 3-5 minutes per build
- Total potential reduction: 5-10 minutes from 25-minute build
