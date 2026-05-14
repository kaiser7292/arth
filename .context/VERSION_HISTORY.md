# Version History

## Release Timeline

| Version | App Version | Key Features | Docs Location |
|---------|-------------|--------------|---------------|
| **MVP** | 0.x | Core expense tracking, budget, goals, SMS auto-detection, hisaab, salary calculator | `docs/MVP/` |
| **V1** | 1.0.0 | Expense split, merchant bucketing, Axio-style detail, forecast workflow | `docs/V1/` |
| **V2** | 2.0.0 | Bug fixes, income tax rework, UX improvements, tags, insights dashboard | `docs/V2/` |
| **V3** | 3.0.0 | Export, notifications, date pickers, salary FY isolation (partial) | `docs/V3/` |
| **V4** | 4.0.0 | Master data, payment mode detection, insights comparison, timestamps | `docs/V4/` |
| **V5** | 5.0.0 | Audit remediation: security, bugs, architecture, UI, performance | `docs/V5/` |
| **V6** | 6.0.0 | 5 color themes + Gen Z visual overhaul | `docs/V6/` |
| **V7** | 7.x | (plan + TDD only) | `docs/V7/` |
| **V11** | 11.x | (plan only) | `docs/V11/` |
| **V12** | 12.0.0–12.6.0 | Stabilization, CC ledger redesign, IDFC FIRST SMS | `docs/V12/` |
| **V13** | 13.0.0–13.5.4 | CC utilized model, fund snapshots, YoY balance sheet, EPF/pension SMS, perf | `docs/V13/` |
| **V14** | 14.0.0–14.8.0 | Credits view, Mark-as-Transfer, split-tender, demat transfers, recurring expenses, stabilization | `docs/V14/` |
| **V15** | 15.0.0–15.13.1 | PSU bank SMS, user SMS templates, min-balance alerts, biometric lock, smart rules, locale preferences, hisaab settlement, audit log, balance sheet indicator | `docs/V15/` |
| **V16** | 16.0.0–16.0.8 | Cash-flow Simulator (scenarios, entries, fulfillment, hisaab integration, trajectory), export fixes, help center grouping | `docs/V16/` |
| **V17** | 17.0.0–17.6.5 | Loans & investments (full amortization engine, prepayments, corrections, schedule import), monthly summary, bulk actions, audit log enhancements, saved filters, notifications rewrite, Kite Connect | `docs/V17/` |

## Current Version: 17.6.5

### Recent Releases (v17.5.x – v17.6.x highlights)

- **v17.6.5** — Kite Connect integration
- **v17.6.4** — Hisaab multi-split description fix
- **v17.6.3** — Help docs language cleanup
- **v17.6.2** — Audit log row overflow, simulator entry dates, help doc cleanup
- **v17.6.1** — Center-align headers on sub-stack screens
- **v17.6.0** — Audit timestamps, SMS scan widget, home card config, home nav shortcut
- **v17.5.44** — Merchant filter, searchable pickers, bulk actions, audit log with undo
- **v17.5.26** — Saved filter views, per-day demat chart, clear SMS button
- **v17.5.10** — Data safety (transaction wrappers), cold-start perf, UX cleanup batch
- **v17.5.2** — Loan math correctness, rupee rounding, N+1 fixes, code safety pass
- **v17.5.0** — Full loan management: amortization, prepayments, corrections, debt visibility in yearly plan + YoY comparison

## Documentation Convention

Each major version should have:
```
docs/V<n>/
├── PRD_V<n>.md           # Product requirements
├── TDD_V<n>.md           # Technical design
└── MASTER_PLAN_V<n>.md   # Task tracker with session log
```

Not all versions have complete sets (V7, V11, V13, V14 are partial).
