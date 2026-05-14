# Restore Settings Card Organization

Restore settings to use Card components with section titles (like before drawer implementation), but keep all sections always visible without collapsible drawer behavior.

## Current State
- Flat list of all settings items with no section grouping
- Search filters items, clear search shows all

## Target State (from commit 7211950)
- Card components with titles for each section
- All sections always visible (no collapsible/drawer)
- Search filters items within sections
- Sections: Data Management, Automation, Backup & Storage, Help & Support, SMS Detection, Preferences, About

## Implementation Steps
1. Add Card components back with section titles
2. Group related settings items under their respective sections
3. Keep all sections always expanded (no CollapsibleSection)
4. Maintain search filtering logic (visibleItems)
5. Keep export logs removed
6. Keep DB init timeout fix

## Section Organization
- **Data Management**: Categories, Payment Modes, Accounts, Tags, Budget Configuration, Import from Excel
- **Automation**: Reminders, Smart Rules, Smart SMS Templates, Merchant Aliases, Audit Log
- **Backup & Storage**: Backup & Restore, Recycle Bin, Dismissed Duplicate Groups, Clean Up Data
- **Help & Support**: Help Center, Redo Onboarding
- **SMS Detection** (Android only): Enable SMS Reading, Scan Date Range, Scan Now, Duplicate scan
- **Preferences**: Region, Notifications, Home Cards, Theme
- **About**: App Name, Version
