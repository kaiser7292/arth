# Artha (अर्थ) — Version 4 Feature Backlog

**Version:** 4.0 (Planning)
**Author:** Sourav Baid
**Date:** 2026-04-13
**Status:** Ready to implement (V3 Phases 3-6 deferred; V4 prioritized)
**Predecessor:** V3 at `docs/V3/`

---

## 1. Executive Summary

V4 focuses on **data quality, flexibility, and accuracy**. Three pillars:

1. **Master Data Management** — Editable mappings for merchant names, accounts, and payment modes. SMS parser auto-detects both account AND payment mode from the SMS text itself. User corrects via master data if needed.
2. **Insights Flexibility** — Week-on-week and custom date range comparisons for deeper spending analysis
3. **Transaction Precision** — Timestamps on expense detail pages for audit-quality records

**Key data model insight:** An **account** is *where* money comes from (HDFC Savings, SBI Current). A **payment mode** is *how* the payment was made (debit card, UPI, net banking). One account can have multiple payment modes — e.g., HDFC Savings may have a linked debit card, a UPI ID, and net banking access. This is a **one-to-many relationship** (account → payment modes).

**Auto-detection approach:** The SMS parser detects payment mode from the SMS text itself (Card+CreditLimit=CreditCard, UPI/P2M=UPI, A/c debit=NetBanking, etc.). No `is_default` flag — the SMS tells us how the payment was made. The `account_payment_modes` link table is auto-populated as new account-mode combinations are detected, and serves as the master data the user can view/correct.

---

## 2. Feature Inventory

| # | Feature | Size (est.) | Phase |
|---|---------|-------------|-------|
| F1 | SMS Parser: Payment Mode Detection | L | 1 |
| F2 | Master Data: Merchant Name Mappings | M | 1 |
| F3 | Master Data: Account-Payment Mode Linking | L | 1 |
| F4 | Account & Mode Editing on Expenses | M | 1 |
| F5 | Insights: Week-on-Week Comparison | M | 2 |
| F6 | Insights: Custom Date Range Comparison | L | 2 |
| F7 | Transaction Timestamps | M | 3 |
| F8 | Testing, Documentation & Build | M | 4 |

---

## 3. Version History

| Version | Date | Change |
|---------|------|--------|
| 4.0 | 2026-04-13 | Initial V4 feature backlog — 8 features across 4 phases |
| 4.0.1 | 2026-04-13 | Removed `is_default` flag; aligned with SMS-parser-driven payment mode detection |
