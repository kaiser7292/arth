# Splash Screen Stuck on Fresh Install - Bug Report

## Bug Description
On fresh install, the app gets stuck on the splash screen forever. The splash shows "Setting Up Workspace..." and "Almost Ready..." glitching super fast, then stays stuck and never reaches the home screen. The user cannot proceed past the loader.

## Initial Investigation

### Symptom Analysis
- Splash steps change rapidly between "Setting Up Workspace..." and "Almost Ready..."
- This indicates the `Promise.all` containing seed operations completes quickly
- But splash never dismisses - app stays stuck on loader forever

### Splash Dismissal Condition
The splash screen stays visible when any of these is false:
```typescript
if (!dbReady || !minSplashDone || !lockEvaluated) {
  return <SplashScreen step={initStep} />;
}
```

Three conditions must be true for splash to dismiss:
1. `dbReady` - set to true at line 240 (outside try/catch, should always run)
2. `minSplashDone` - set by 800ms timer at line 328
3. `lockEvaluated` - depends on biometric lock evaluation

## Attempts and Fixes

### Attempt 1: Bulk INSERT for Seed Operations
**Hypothesis:** The seed operations were slow, causing the splash to appear stuck.

**What I tried:**
- Converted `seedPublicData` from 2864 individual `await db.runAsync()` calls to 5 bulk INSERT statements
- Converted `seedDefaultCategories` from 14 individual inserts to 1 bulk INSERT
- Converted `seedDefaultPaymentModes` to bulk INSERT
- Wrapped `seedMerchantMappings` (259 inserts) in a single transaction

**Result:** Splash still stuck. The Promise.all completes quickly now, but splash never dismisses.

**Files changed:**
- `services/public-data/index.ts`
- `services/category.ts`
- `services/payment-mode.ts`
- `services/smart-categorizer.ts`

### Attempt 2: Fix lockEvaluated when biometric lock flag is false
**Hypothesis:** When `v15_biometric_lock` flag is false, `setLockEvaluated(true)` was never called, causing splash to stay stuck.

**What I tried:**
```typescript
// Before:
useEffect(() => {
  if (!dbReady || !minSplashDone) return;
  if (!getFlag("v15_biometric_lock")) return;  // Early return without setting lockEvaluated
  // ...
}, [dbReady, minSplashDone]);

// After:
useEffect(() => {
  if (!dbReady || !minSplashDone) return;
  if (!getFlag("v15_biometric_lock")) {
    setLockEvaluated(true);  // Explicitly set it
    return;
  }
  // ...
}, [dbReady, minSplashDone]);
```

**Result:** Splash still stuck. Fix was insufficient.

**Files changed:**
- `app/_layout.tsx`

### Attempt 3: Fix router check blocking lockEvaluated
**Hypothesis:** The `evaluateLock()` function had an early return if `!routerRef.current`, preventing `setLockEvaluated(true)` from being called when the router wasn't ready.

**What I tried:**
```typescript
// Before:
const evaluateLock = () => {
  if (!routerRef.current) return;  // Early return - lockEvaluated never set
  if (shouldShowLock()) {
    routerRef.current.replace({ pathname: "/(lock)/lock" as never, params: {} });
  }
  setLockEvaluated(true);
};

// After:
const evaluateLock = () => {
  if (shouldShowLock() && routerRef.current) {  // Moved router check inside conditional
    routerRef.current.replace({ pathname: "/(lock)/lock" as never, params: {} });
  }
  setLockEvaluated(true);  // Always executes now
};
```

**Result:** Not yet tested.

**Files changed:**
- `app/_layout.tsx`

## Root Cause Analysis

The root cause is the biometric lock evaluation logic in `app/_layout.tsx`:

```typescript
useEffect(() => {
  if (!dbReady || !minSplashDone) return;
  if (!getFlag("v15_biometric_lock")) return;  // PROBLEM: returns without setting lockEvaluated

  const evaluateLock = () => {
    if (!routerRef.current) return;  // PROBLEM: returns without setting lockEvaluated
    if (shouldShowLock()) {
      routerRef.current.replace({ pathname: "/(lock)/lock" as never, params: {} });
    }
    setLockEvaluated(true);
  };

  evaluateLock();
  // ...
}, [dbReady, minSplashDone]);
```

Two issues:
1. When `v15_biometric_lock` flag is false, the useEffect returns early without calling `setLockEvaluated(true)`
2. When the router isn't ready (`!routerRef.current`), the `evaluateLock()` function returns early without calling `setLockEvaluated(true)`

Either case causes `lockEvaluated` to stay false forever, blocking splash dismissal.

## Final Fix Applied

```typescript
useEffect(() => {
  if (!dbReady || !minSplashDone) return;
  if (!getFlag("v15_biometric_lock")) {
    setLockEvaluated(true);  // FIX: Always set when flag is false
    return;
  }

  const evaluateLock = () => {
    if (shouldShowLock() && routerRef.current) {  // FIX: Moved router check inside
      routerRef.current.replace({ pathname: "/(lock)/lock" as never, params: {} });
    }
    setLockEvaluated(true);  // FIX: Always executes now
  };

  evaluateLock();

  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") evaluateLock();
  });
  return () => sub.remove();
}, [dbReady, minSplashDone]);
```

This ensures `setLockEvaluated(true)` is always called regardless of:
- Whether the biometric lock flag is enabled
- Whether the router is ready at that moment

## Files Modified

1. `app/_layout.tsx` - Fixed lockEvaluated logic
2. `services/public-data/index.ts` - Bulk INSERT for public data seed
3. `services/category.ts` - Bulk INSERT for categories
4. `services/payment-mode.ts` - Bulk INSERT for payment modes
5. `services/smart-categorizer.ts` - Transaction wrapper for merchant mappings

## Commits

- `Fix splash stuck forever: ensure lockEvaluated always set even if router not ready` (staging 7e7ea5a)
- `Fix splash stuck forever: ensure lockEvaluated always set` (staging 7932c5c)
- `Fix slow fresh install: use bulk INSERT for all seed operations` (staging 413c77a)
- `Fix splash logo, fast fresh-install seed, logger handler, and validation types` (staging d29dac3)
- `Splash: use splash-icon.png instead of drawn circle` (staging 59305b7)

## Status

Final fix applied and APK uploaded to `v17.6.12-staging`. Awaiting user testing to verify splash dismisses and app reaches home screen on fresh install.
