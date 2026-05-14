# DevOps & Software Development Lifecycle (SDLC)

**Version:** 0.1 (Draft)
**Author:** Sourav Baid + Claude
**Date:** 2026-04-12
**Related:** [PRD](PRD.md) | [Technical Design](TDD.md) | [Test Strategy](TEST_STRATEGY.md) | [Security](SECURITY.md)

---

## 1. SDLC Overview

This project follows a **phased, skill-assisted development lifecycle**. Each phase has a clear entry gate, deliverables, exit criteria, and Claude Code skills that assist at each step.

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  1. PLAN    │───>│  2. BUILD    │───>│  3. TEST     │───>│  4. PACKAGE  │
│  & DESIGN   │    │  & CODE      │    │  & REVIEW    │    │  & DELIVER   │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       │                  │                   │                    │
       v                  v                   v                    v
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ PRD, TDD,   │    │ Feature      │    │ Unit, E2E,   │    │ APK build,   │
│ CLAUDE.md,  │    │ branches,    │    │ security     │    │ email to     │
│ GitHub      │    │ TDD cycle,   │    │ audit, code  │    │ phone,       │
│ issues      │    │ local dev    │    │ review       │    │ install,     │
│             │    │ server       │    │              │    │ manual test  │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       │                                                         │
       └────────────────────── FEEDBACK LOOP ────────────────────┘
                    (User tests on Android, shares feedback)
```

---

## 2. SDLC Phases — Detail

### Phase 1: Plan & Design

| Activity | Deliverable | Tool/Skill |
|----------|-------------|------------|
| Define requirements | PRD (exists) | Manual + Claude |
| Technical architecture | TDD (this doc set) | Manual + Claude |
| Break into GitHub issues | Issues with acceptance criteria | `/wizard` creates issues |
| Set up project skeleton | Expo project, folder structure, CLAUDE.md | `arc-skill`, `skill-mobile-mt` |
| Define test strategy | TEST_STRATEGY.md | Manual + Claude |
| Security threat model | SECURITY.md | `claude-code-owasp` |

**Entry gate:** Product idea approved
**Exit gate:** PRD approved, TDD written, GitHub issues created, project skeleton running on dev server

### Phase 2: Build & Code

| Activity | Deliverable | Tool/Skill |
|----------|-------------|------------|
| Pick a GitHub issue | Feature branch created | `/wizard` |
| Explore existing code | Understanding before coding | `/wizard` Phase 1-3 |
| Write failing tests first | Test files (TDD) | `/wizard` Phase 4, `insight-to-quality` |
| Implement feature | Working code | `skill-mobile-mt`, `arc-skill` |
| Run test suite | All tests passing | Jest + React Native Testing Library |
| Self-review | Adversarial review for edge cases | `/wizard` Phase 7 |
| Security scan | No secrets, no vulnerabilities | `security-audit`, `claude-code-owasp` |

**Entry gate:** GitHub issue with acceptance criteria
**Exit gate:** Tests pass, security scan clean, self-review done

### Phase 3: Test & Review

| Activity | Deliverable | Tool/Skill |
|----------|-------------|------------|
| Unit tests | Component-level coverage | Jest |
| E2E tests | User flow coverage | Maestro (`maestro-skill`) |
| Security audit | Vulnerability report | `security-audit` |
| Code quality check | Quality score | `claude-impl-tools` `/quality-auditor` |
| Build verification | APK builds without errors | `codora-app-build` |

**Entry gate:** Feature code complete, tests written
**Exit gate:** All tests pass, security audit clean, APK builds successfully

### Phase 4: Package & Deliver

| Activity | Deliverable | Tool/Skill |
|----------|-------------|------------|
| Build Android APK | `.apk` file on Desktop | `codora-app-build` `/build android` |
| Send APK to phone | Email with APK attachment | Manual (email to self) |
| Install on Android | App installed on device | Manual (download + install) |
| Manual testing | User feedback | Manual (test on real device) |
| Report feedback | Issues/improvements noted | User shares with Claude |

**Entry gate:** All automated tests pass, APK builds
**Exit gate:** User has tested on phone and provided feedback

### Feedback Loop

```
User tests on Android phone
        │
        ├── Bugs found ──────────> New GitHub issue (bug label) ──> Phase 2
        │
        ├── Feature feedback ───> Update PRD / create new issue ──> Phase 1
        │
        ├── UX issues ──────────> New GitHub issue (UX label) ───> Phase 2
        │
        └── Approved ───────────> Move to next feature ──────────> Phase 1
```

---

## 3. Android APK Build & Test Workflow

Since you have an Android phone and will test directly on it, here is the exact workflow:

### 3.1 Building the APK

**Option A — Local build (no account needed, slower):**
```bash
cd ~/accounts-manager-app
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
# APK output: android/app/build/outputs/apk/release/app-release.apk
```

**Option B — EAS Build (free Expo account, faster, recommended):**
```bash
cd ~/accounts-manager-app
npm install -g eas-cli
eas login                          # Create free Expo account
eas build:configure
eas build --platform android --profile preview
# Downloads APK from Expo's build servers
```

**Option C — Using `/build` skill (simplest):**
```
/build android
# codora-app-build handles everything, saves APK to ~/Desktop/
```

### 3.2 Getting the APK to Your Phone

| Method | Steps |
|--------|-------|
| **Email (recommended)** | Email the `.apk` file to yourself as attachment. Open email on phone. Download attachment. Tap to install. |
| **Google Drive** | Upload APK to Google Drive. Open Drive app on phone. Download. Install. |
| **USB Cable** | Connect phone via USB. Copy APK to phone's Downloads folder. Use file manager to install. |
| **ADB (developer)** | `adb install path/to/app.apk` from terminal (requires USB debugging enabled) |

### 3.3 Installing on Android

1. **Enable "Install from Unknown Sources"** — Settings > Security > Unknown sources (or Settings > Apps > Special access > Install unknown apps > Allow for your email/file manager app)
2. **Tap the downloaded APK file**
3. **Tap "Install"** when prompted
4. **Open the app**

### 3.4 Testing & Feedback Cycle

```
You (on phone)                          Claude (on Mac)
     │                                        │
     │  1. Install APK                        │
     │  2. Test features                      │
     │  3. Note bugs/feedback                 │
     │                                        │
     │──── Share feedback via chat ──────────>│
     │     (screenshots, descriptions,        │
     │      what works, what doesn't)         │
     │                                        │
     │                         4. Claude fixes │
     │                         5. Rebuilds APK │
     │                                        │
     │<──── New APK sent via email ───────────│
     │                                        │
     │  6. Install updated APK                │
     │  7. Verify fixes                       │
     │  ... repeat ...                        │
```

### 3.5 Build Profiles

| Profile | When to Use | Size | Build Time |
|---------|-------------|------|------------|
| **Development** | Daily coding, hot reload | N/A (runs via Expo Go) | Instant |
| **Preview** | Testing new features on phone | ~30-50 MB | 5-10 min |
| **Production** | Final release-ready build | ~20-40 MB | 10-15 min |

For our workflow, **Preview** builds are what you'll test most often. Production builds are for final polished versions.

---

## 4. Claude Code Skills — Complete Inventory

### 4.1 Skills We Will Use (Selected)

| # | Skill | GitHub | Stars | SDLC Phase | What It Does For Us |
|---|-------|--------|-------|------------|---------------------|
| 1 | **`buivietphi/skill-mobile-mt`** | [repo](https://github.com/buivietphi/skill-mobile-mt) | 0 | Build | Master mobile engineer — auto-detects React Native/Expo, Clean Architecture, 45+ bug patterns, security protocol, performance prediction, UI/UX design system. **Primary coding skill.** |
| 2 | **`vlad-ko/claude-wizard`** | [repo](https://github.com/vlad-ko/claude-wizard) | 31 | All phases | 8-phase development methodology: understand → issue → explore → TDD → implement → test → self-review → PR. **Our SDLC backbone.** |
| 3 | **`Daniel4SE/codora-app-build`** | [repo](https://github.com/Daniel4SE/codora-app-build) | 1 | Package | One-command APK/IPA builds: `/build android` → APK on Desktop. `/build preview` for dev server. **Our build pipeline.** |
| 4 | **`agamm/claude-code-owasp`** | [repo](https://github.com/agamm/claude-code-owasp) | 109 | Test & Review | OWASP Top 10:2025, ASVS 5.0, 20+ language security quirks. Auto-activates during code review. **Our security baseline.** |
| 5 | **`YangKuoshih/security-audit`** | [repo](https://github.com/YangKuoshih/security-audit) | 3 | Test & Review | Secret scanner + vulnerability detection. 60 regex patterns, OWASP mapping, Markdown/SARIF reports. **Our pre-release security gate.** |
| 6 | **`eagleisbatman/maestro-skill`** | [repo](https://github.com/eagleisbatman/maestro-skill) | 1 | Test | Generates Maestro E2E test flows from specs/stories. React Native selectors, CI/CD config. **Our E2E test generator.** |
| 7 | **`art9mid/arc-skill`** | [repo](https://github.com/art9mid/arc-skill) | 7 | Plan & Build | Architecture scaffolding for React Native/Expo: project init, API layer, theme system, mobile UX design system. **Our architecture foundation.** |
| 8 | **`devsemih/appstore-review-skill`** | [repo](https://github.com/devsemih/appstore-review-skill) | 39 | Package | Checks app against App Store/Play Store review guidelines before submission. Works with React Native/Expo. **Our pre-publish checklist.** |

### 4.2 Skills We May Add Later (Evaluated, Not Selected Yet)

| Skill | Stars | Why We Might Need It | When |
|-------|-------|---------------------|------|
| `insightflo/claude-impl-tools` | 17 | 28 skills covering full lifecycle — `/quality-auditor`, `/coverage`, `/architecture`, `/security-review`. Very comprehensive but heavy. | If project complexity grows beyond what `/wizard` handles |
| `class83108/insight-to-quality` | 1 | Rigorous TDD: spec → Gherkin → Red/Green/Refactor with verification ledger. | If we want stricter TDD discipline |
| `zaferayan/skills` | 110 | Expo monetization patterns (paywall, ads, subscriptions). | Phase 5+ if the app goes public |
| `tannermares/react-native-audit-claude-skill` | 0 | Read-only audit scoring (0-100) for accessibility, security, performance. | Before any public release |
| `coinangel-kr/claude-pre-push-skill` | 1 | Pre-push security gate — blocks hardcoded credentials. | When we set up CI/CD |

### 4.3 Skills Mapped to SDLC Phases

```
PLAN & DESIGN          BUILD & CODE           TEST & REVIEW          PACKAGE & DELIVER
─────────────          ────────────           ─────────────          ─────────────────
arc-skill              skill-mobile-mt        maestro-skill          codora-app-build
  (architecture)         (coding)               (E2E tests)            (APK build)

claude-wizard          claude-wizard          claude-code-owasp      appstore-review-skill
  (Phase 1-2)            (Phase 3-6)            (security)             (store guidelines)

                                              security-audit
                                                (secrets scan)

                                              claude-wizard
                                                (Phase 7-8)
```

---

## 5. Installation Plan

### 5.1 One-Time Setup (Before Starting Development)

```bash
# 1. Project already created at ~/accounts-manager-app/

# 2. Install Claude Code skills (global — available in all projects)
# Skill 1: Mobile master skill
npx @buivietphi/skill-mobile-mt

# Skill 2: SDLC wizard (8-phase workflow)
mkdir -p ~/accounts-manager-app/.claude/skills/wizard
curl -sL https://raw.githubusercontent.com/vlad-ko/claude-wizard/main/skill/SKILL.md \
  -o ~/accounts-manager-app/.claude/skills/wizard/SKILL.md
curl -sL https://raw.githubusercontent.com/vlad-ko/claude-wizard/main/skill/CHECKLISTS.md \
  -o ~/accounts-manager-app/.claude/skills/wizard/CHECKLISTS.md
curl -sL https://raw.githubusercontent.com/vlad-ko/claude-wizard/main/skill/PATTERNS.md \
  -o ~/accounts-manager-app/.claude/skills/wizard/PATTERNS.md

# Skill 3: APK build
curl -fsSL https://raw.githubusercontent.com/Daniel4SE/codora-app-build/main/install.sh | bash

# Skill 4: OWASP security (global)
curl -sL https://raw.githubusercontent.com/agamm/claude-code-owasp/main/.claude/skills/owasp-security/SKILL.md \
  -o ~/.claude/skills/owasp-security/SKILL.md --create-dirs

# Skill 5: Security audit
npx skills add YangKuoshih/security-audit -g --all

# Skill 6: Maestro E2E testing
# (Install Maestro itself first)
curl -fsSL "https://get.maestro.mobile.dev" | bash
# Then the Claude skill
claude plugin add https://github.com/eagleisbatman/maestro-skill.git

# Skill 7: Architecture scaffolding
# (Reference — copy to project)
mkdir -p ~/accounts-manager-app/.claude/skills/arc
curl -sL https://raw.githubusercontent.com/art9mid/arc-skill/main/SKILL.md \
  -o ~/accounts-manager-app/.claude/skills/arc/SKILL.md

# Skill 8: App Store review
# (Reference — install when ready for store submission)

# 3. Install EAS CLI for APK builds
npm install -g eas-cli

# 4. Install Maestro for E2E testing
# (Already done above)
```

### 5.2 Verification

After installation, verify all skills are recognized:
```bash
cd ~/accounts-manager-app
claude
# Then type: /wizard (should show WIZARD MODE)
# Then type: /build preview (should show build options)
# Then type: /security-audit (should show scan options)
```

---

## 6. Development Environment

### 6.1 Required Software

| Software | Purpose | Install Command |
|----------|---------|-----------------|
| Node.js 20+ | Runtime | `brew install node` |
| Expo CLI | React Native framework | `npm install -g expo-cli` |
| EAS CLI | Cloud builds (APK) | `npm install -g eas-cli` |
| Watchman | File watcher (dev server) | `brew install watchman` |
| Java 17+ | Android builds + Maestro | `brew install openjdk@17` |
| Android Studio | Emulator (optional) | Download from developer.android.com |
| Maestro | E2E testing | `curl -fsSL "https://get.maestro.mobile.dev" \| bash` |
| Git | Version control | Pre-installed on Mac |
| Claude Code | AI-assisted development | Already installed |

### 6.2 Project Structure (Target)

```
~/accounts-manager-app/
├── .claude/
│   └── skills/                    # Project-specific skills
│       ├── wizard/                # SDLC wizard
│       └── arc/                   # Architecture scaffolding
├── docs/
│   ├── PRD.md                     # Product Requirements
│   ├── TDD.md                     # Technical Design
│   ├── DEVOPS.md                  # This document
│   ├── TEST_STRATEGY.md           # Test Strategy
│   └── SECURITY.md                # Security & Vulnerability
├── app/                           # Expo Router pages
├── components/                    # Reusable UI components
├── services/                      # Business logic (SMS parser, email parser, etc.)
├── database/                      # SQLite schema, migrations, queries
├── utils/                         # Helpers, formatters, validators
├── constants/                     # Theme, config, category defaults
├── hooks/                         # Custom React hooks
├── assets/                        # Images, fonts
├── __tests__/                     # Jest unit tests
├── .maestro/                      # Maestro E2E test flows
├── CLAUDE.md                      # Project-specific Claude instructions
├── app.json                       # Expo config
├── package.json                   # Dependencies
├── eas.json                       # EAS Build profiles
└── tsconfig.json                  # TypeScript config
```

---

## 7. Git Workflow

### Branch Strategy

```
main ──────────────────────────────────────────────────────>
  │                                          │
  ├── feature/F1-manual-expense-entry ──────>│ (merge when tested on phone)
  │                                          │
  ├── feature/F2-sms-auto-detection ────────>│
  │                                          │
  ├── bugfix/approve-queue-crash ───────────>│
  │
  └── feature/F3-email-auto-detection ──────>
```

- **`main`** — always buildable, always tested
- **`feature/*`** — one branch per feature (mapped to GitHub issue)
- **`bugfix/*`** — bug fixes found during phone testing
- Merge to `main` only after: tests pass + security scan clean + tested on phone

### Commit Convention

```
feat(expense): add manual expense entry with category selection
fix(sms): handle HDFC SMS format with missing merchant name
test(budget): add unit tests for budget calculation logic
docs(prd): update Phase 1B goal engine features
chore(deps): upgrade expo-sqlite to v15
```

---

## 8. Typical Development Session

Here's what a typical session looks like when building a feature:

```
1. Pick the next feature from PRD (e.g., F1: Manual Expense Entry)

2. /wizard implement F1 — Manual Expense Entry
   → Claude reads CLAUDE.md
   → Creates/finds GitHub issue with acceptance criteria
   → Explores existing codebase
   → Writes failing tests
   → Implements the feature
   → Runs test suite
   → Self-reviews for edge cases
   → Opens PR (local — no push to remote per restrictions)

3. /security-audit
   → Scans for hardcoded secrets
   → Checks for OWASP vulnerabilities
   → Reports any findings

4. /build android
   → Builds APK
   → Saves to ~/Desktop/artha.apk

5. Email APK to yourself → Install on Android phone → Test

6. Share feedback with Claude
   → "The category picker is too small on my phone"
   → "Expense amount doesn't save when I press back"
   → "Everything else works great"

7. Claude fixes issues → Repeat from step 3
```

---

## 9. Release Versioning

Following semantic versioning adapted for this app:

| Change Type | Version Bump | Example |
|-------------|-------------|---------|
| Bug fix, UI tweak | PATCH (0.1.X) | 0.1.0 → 0.1.1 |
| New feature (1-5 features) | MINOR (0.X.0) | 0.1.1 → 0.2.0 |
| Major phase completion (>5 features) | MAJOR (X.0.0) | 0.9.0 → 1.0.0 |

**Milestone versions:**
- **v0.1.0** — Project skeleton running on phone
- **v0.5.0** — Phase 1 MVP complete (expense tracking + budget)
- **v0.7.0** — Phase 1B complete (goal engine added)
- **v0.9.0** — Phase 2 complete (hisaab)
- **v1.0.0** — Full app with Phase 1 + 1B + 2 polished and stable
