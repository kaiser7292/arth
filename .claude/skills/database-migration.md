---
description: Manage SQLite database migrations for Artha
---

# Database Migration Skill

Handles creating, registering, and managing SQLite database migrations for the Artha project.

## Migration File Structure

Create migration files in `database/migrations/` with naming pattern: `XXX_migration_name.ts`

Example: `043_settings_table.ts`

## Migration File Template

```typescript
import type { Migration } from "./index";

const migrationXXX: Migration = {
  version: XXX,
  name: "migration_name",
  up: async (db) => {
    // Migration SQL goes here
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS table_name (
        column1 INTEGER NOT NULL,
        column2 TEXT,
        PRIMARY KEY (column1)
      );
    `);
    
    // Create indexes if needed
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_table_name_column
      ON table_name(column);
    `);
  },
};

export default migrationXXX;
```

## Registration Process

1. Add import to `database/migrations/index.ts`:
```typescript
import migrationXXX from "./XXX_migration_name";
```

2. Add to migrations array in `database/migrations/index.ts`:
```typescript
const migrations: Migration[] = [migration001, ..., migrationXXX];
```

## Common Patterns

**Always use IF NOT EXISTS for tables:**
```typescript
await db.execAsync(`
  CREATE TABLE IF NOT EXISTS table_name (...)
`);
```

**Always use IF NOT EXISTS for indexes:**
```typescript
await db.execAsync(`
  CREATE INDEX IF NOT EXISTS idx_table_name_column
  ON table_name(column);
`);
```

**Primary key with composite key:**
```typescript
PRIMARY KEY (user_id, key)
```

**Default values:**
```typescript
column INTEGER NOT NULL DEFAULT 1,
column TEXT NOT NULL DEFAULT (datetime('now'))
```

## Migration Numbering

- Use sequential numbering: 001, 002, 003, etc.
- Next available number is the highest existing number + 1
- Check `database/migrations/index.ts` for current highest number

## Sync to artha-builds

After creating migration in artha repo:
1. Copy migration file to artha-builds/database/migrations/
2. Update artha-builds/database/migrations/index.ts (import + array)
3. This ensures both repos have the same migrations

## Testing

Run tests after creating migration:
```bash
npm test
```

## Key Files

- Migrations directory: database/migrations/
- Index file: database/migrations/index.ts
- Schema reference: .context/DATABASE_SCHEMA.md
