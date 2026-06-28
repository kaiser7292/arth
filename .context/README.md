# .context/ — LLM Knowledge Base

This folder contains comprehensive project knowledge files designed for any LLM (Claude, GPT, Gemini, Copilot, etc.) to quickly understand and work with the Artha codebase.

## How to Use These Files

**For LLMs:** Read these files at the start of a session to understand the project. They provide everything needed to make informed code changes without guessing.

**For humans:** These serve as a quick-reference guide to the project's architecture, conventions, and processes.

## File Index

| File | What It Covers | Read When... |
|------|---------------|--------------|
| [FEATURE_MAP.md](FEATURE_MAP.md) | Symptom/screen → feature area → files, in plain English | **A bug is reported — read this first** |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Verified, still-open bugs from the May 2026 audit, plain-English + technical | Before reporting something as new — it may already be cataloged here |
| [features/*.md](features/) | Deep dives (functional + technical) on the 5 historically buggiest areas: ledger/balances, SMS pipeline, loans, hisaab, backup/restore | The symptom matches one of those 5 areas |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | What Arth is, feature set, core philosophy | Starting any session |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Tech stack, directory structure, data flow, patterns | Understanding how code is organized |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | All tables, columns, migrations, backup system | Working with data/DB changes |
| [SERVICES_MAP.md](SERVICES_MAP.md) | Every service file and its purpose | Finding where logic lives |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Colors, typography, spacing, component library | Building/editing UI |
| [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md) | Build commands, signing, release pipeline, versioning | Building APKs or releasing |
| [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) | Session workflow, testing, code style, checklists | Day-to-day development |
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | Test structure, running tests, what's covered | Writing or debugging tests |
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | From-scratch environment setup, dependencies | Setting up on a new machine |
| [CONVENTIONS_AND_PATTERNS.md](CONVENTIONS_AND_PATTERNS.md) | Templates, patterns, invariants, gotchas | Writing new code (copy-paste templates) |

## Quick Start for a New LLM Session

1. Read `PROJECT_OVERVIEW.md` (2 min) — understand what the app does
2. Read `ARCHITECTURE.md` (3 min) — understand how it's built
3. Read `CONVENTIONS_AND_PATTERNS.md` (3 min) — understand the rules
4. For specific tasks:
   - Adding a feature → also read `SERVICES_MAP.md` + `DATABASE_SCHEMA.md`
   - UI work → also read `DESIGN_SYSTEM.md`
   - Bug fix → also read `TESTING_STRATEGY.md`
   - Building → read `BUILD_AND_RELEASE.md`
   - New machine → read `SETUP_GUIDE.md`

## Important: CLAUDE.md Still Exists

The repo root has a `CLAUDE.md` file with even more detailed session-by-session notes. It's optimized for Claude Code specifically. These `.context/` files are the LLM-agnostic equivalent — covering the same ground in a structured, referenceable format that works with any model.

## Keeping These Files Updated

When significant changes happen:
- New major feature → update `PROJECT_OVERVIEW.md` feature table
- New service added → update `SERVICES_MAP.md`
- New migration → update `DATABASE_SCHEMA.md`
- Build process changes → update `BUILD_AND_RELEASE.md`
- New design tokens → update `DESIGN_SYSTEM.md`
- New convention established → update `CONVENTIONS_AND_PATTERNS.md`
