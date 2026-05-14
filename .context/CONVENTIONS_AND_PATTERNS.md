# Conventions & Patterns

This document provides explicit, detailed patterns for any LLM or developer working on Artha. Follow these exactly.

## File Creation Rules

### Where to put new files

| What you're creating | Location | Example |
|---------------------|----------|---------|
| New screen/page | `app/<domain>/filename.tsx` | `app/loans/add.tsx` |
| Reusable component | `components/<domain>/ComponentName.tsx` | `components/loans/PrepaymentSheet.tsx` |
| Generic UI component | `components/ui/ComponentName.tsx` | `components/ui/Card.tsx` |
| Business logic | `services/domain-name.ts` | `services/loan-engine.ts` |
| Pure utility function | `utils/name.ts` | `utils/format.ts` |
| Database migration | `database/migrations/NNN_descriptive_name.ts` | `database/migrations/042_new_feature.ts` |
| Constants/config | `constants/name.ts` | `constants/currencies.ts` |
| Custom hook | `hooks/use-name.ts` | `hooks/use-debounced-value.ts` |
| Unit test | `__tests__/unit/name.test.ts` | `__tests__/unit/loan-engine.test.ts` |
| Integration test | `__tests__/integration/name.test.ts` | `__tests__/integration/expense.test.ts` |
| Help article | `assets/docs/articles/slug.md` | `assets/docs/articles/simulator.md` |
| Build script | `bin/name.sh` | `bin/build-apk.sh` |
| Expo config plugin | `plugins/withName.js` | `plugins/withDisableBackup.js` |

### Naming Conventions
- **Screen files:** kebab-case, match the URL: `account-ledger.tsx`, `[id].tsx`
- **Component files:** PascalCase: `PrepaymentSheet.tsx`, `DonutChart.tsx`
- **Service files:** kebab-case: `expense-crud.ts`, `loan-engine.ts`
- **Hook files:** kebab-case with `use-` prefix: `use-data-refresh.ts`
- **Migration files:** `NNN_descriptive_name.ts` where NNN is zero-padded number
- **Test files:** match source name + `.test.ts`

## Screen Template (Copy This for New Screens)

```typescript
import { useState, useCallback } from "react";
import { View, Text, ScrollView } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

export default function ScreenName() {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const { dataVersion } = useDataRefresh();
  
  const [data, setData] = useState<DataType | null>(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [dataVersion])
  );

  async function loadData() {
    try {
      const result = await someService.getData();
      setData(result);
    } finally {
      setLoaded(true);
    }
  }

  if (!loaded) {
    return (
      <>
        <Stack.Screen options={{ title: "Screen Title" }} />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary dark:text-text-dark-secondary">
            Loading...
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Screen Title" }} />
      <ScrollView
        className="flex-1 bg-surface-light dark:bg-surface-dark"
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Screen content here */}
      </ScrollView>
    </>
  );
}
```

## Service Template (Copy This for New Services)

```typescript
import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/hooks/use-data-refresh";

// Types
export interface MyEntity {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

// Read operations (no bumpDataVersion needed)
export async function getEntity(id: string): Promise<MyEntity | null> {
  const db = getDatabase();
  return db.getFirstAsync<MyEntity>(
    `SELECT * FROM my_table WHERE id = ?`,
    [id]
  );
}

export async function listEntities(userId: string): Promise<MyEntity[]> {
  const db = getDatabase();
  return db.getAllAsync<MyEntity>(
    `SELECT * FROM my_table WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
}

// Write operations (MUST call bumpDataVersion)
export async function createEntity(data: Omit<MyEntity, "id" | "created_at">): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO my_table (id, user_id, name, created_at) VALUES (?, ?, ?, datetime('now'))`,
    [id, data.user_id, data.name]
  );
  bumpDataVersion();
  return id;
}

export async function updateEntity(id: string, updates: Partial<MyEntity>): Promise<void> {
  const db = getDatabase();
  // Build dynamic SET clause
  const sets: string[] = [];
  const values: any[] = [];
  if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name); }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(
    `UPDATE my_table SET ${sets.join(", ")} WHERE id = ?`,
    values
  );
  bumpDataVersion();
}

export async function deleteEntity(id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    // Clear FK references first
    await db.runAsync(`UPDATE child_table SET entity_id = NULL WHERE entity_id = ?`, [id]);
    // Then delete
    await db.runAsync(`DELETE FROM my_table WHERE id = ?`, [id]);
  });
  bumpDataVersion();
}
```

## Migration Template (Copy This for New Migrations)

```typescript
import type { SQLiteDatabase } from "expo-sqlite";

export async function migrate(db: SQLiteDatabase): Promise<void> {
  // Create new table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS new_table (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add column to existing table (use PRAGMA check for idempotency)
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(expenses)`
  );
  const hasNewColumn = columns.some((c) => c.name === "new_column");
  if (!hasNewColumn) {
    await db.execAsync(`ALTER TABLE expenses ADD COLUMN new_column TEXT`);
  }

  // Create index
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_new_table_user 
    ON new_table(user_id);
  `);
}
```

**After creating a migration:**
1. Register it in `database/migrations/index.ts`
2. Add columns to `database/TABLE_SCHEMAS.ts`
3. Add table to `services/backup.ts` BACKUP_TABLES (if user data)
4. Update test mocks in `__tests__/integration/database.test.ts`

## Component Template (Bottom Sheet)

```typescript
import { useState } from "react";
import { View, Text, Modal, Pressable, ScrollView } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Colors } from "@/constants/theme";
import { Button } from "@/components/ui";

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (data: SubmitData) => void;
}

export function MySheet({ visible, onDismiss, onSubmit }: Props) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const [value, setValue] = useState("");

  function handleSubmit() {
    onSubmit({ value });
    onDismiss();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View className="flex-1 justify-end">
        <Pressable className="flex-1" onPress={onDismiss} />
        <View
          className="bg-surface-light dark:bg-surface-dark rounded-t-3xl"
          style={{ maxHeight: "90%", paddingBottom: 32 }}
        >
          <View className="items-center pt-3 pb-4">
            <View className="w-10 h-1 rounded-full bg-border-light dark:bg-border-dark" />
          </View>
          <ScrollView className="px-4">
            <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary mb-4">
              Sheet Title
            </Text>
            {/* Form content */}
          </ScrollView>
          <View className="px-4 pt-4">
            <Button title="Save" onPress={handleSubmit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

## SQL Safety Rules

**ALWAYS:**
```typescript
// Parameterized queries (safe)
db.runAsync(`SELECT * FROM expenses WHERE id = ? AND user_id = ?`, [id, userId]);
```

**NEVER:**
```typescript
// String interpolation (SQL INJECTION VULNERABILITY)
db.runAsync(`SELECT * FROM expenses WHERE id = '${id}'`);
```

## Critical Invariants (Break These = Bugs)

1. **Every write MUST call `bumpDataVersion()`** — otherwise screens won't refresh
2. **Every delete MUST clear FK references first** — otherwise SQLite throws
3. **Every multi-step delete MUST use `db.withTransactionAsync`** — otherwise crashes leave orphans
4. **Every new table MUST be added to TABLE_SCHEMAS** — otherwise backup restore drops it
5. **Every new user-data table MUST be in BACKUP_TABLES** — otherwise data is lost on device migration
6. **Every new migration MUST be registered in `migrations/index.ts`** — otherwise it never runs
7. **Never use `new Date()` without timezone awareness** — use `todayIso()` from `utils/date.ts`
8. **Never hardcode colors** — always use theme tokens or NativeWind dark: classes
9. **Never block the UI thread** — all DB operations are async
10. **Never trust user input in SQL** — always use parameterized `?` placeholders

## Git Workflow

```bash
# Feature
git checkout -b feature/F1-description
# Work...
git add specific-files.ts
git commit -m "feat(scope): description"
git push origin feature/F1-description
# Usually merge to main directly (solo dev)

# Typical commit (main branch)
git add app/expense/add.tsx services/expense-crud.ts
git commit -m "feat(expense): add split-tender purchase flow"
git push origin main
```

## Common Gotchas

1. **`expo prebuild --clean` wipes android/** — You must re-apply: local.properties, tailwind symlink, signing config
2. **MMKV not available in tests** — Tests mock it; never import MMKV at module level in testable code
3. **`useFocusEffect` vs `useEffect`** — Use `useFocusEffect` for screen data loading (re-fetches on tab switch)
4. **`router.back()` after create** — Don't navigate back to the old screen; use `router.dismissAll()` + `router.replace()`
5. **Dark mode** — Always test both themes; use `dark:` NativeWind prefix or `Colors[colorScheme]`
6. **React hooks order** — Never put hooks after early returns (crashes: "Rendered more hooks than previous render")
7. **SQLite REAL precision** — Use 1-paise epsilon (0.01) for amount comparisons, not strict equality
8. **Backup compat** — New columns need defaults; old backups without the column must still restore cleanly
