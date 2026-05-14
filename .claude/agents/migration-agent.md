---
description: Dedicated agent for managing database migrations
---

# Migration Agent

Specialized agent for creating, registering, and managing SQLite database migrations for the Artha project.

## Capabilities

- Creates new migration files with proper structure
- Registers migrations in the index
- Syncs migrations to artha-builds repo
- Follows naming conventions and best practices
- Validates migration syntax and structure

## When to Use

Use this agent when:
- You need to add a new database table
- You need to modify an existing table structure
- You need to create an index
- You need to add a new column
- Any database schema change is required

## Workflow

1. **Determine migration number**
   - Check `database/migrations/index.ts` for highest existing number
   - Next number = highest + 1
   - Use 3-digit format: 001, 002, 003, etc.

2. **Create migration file**
   - Location: `database/migrations/XXX_migration_name.ts`
   - Follow the standard template
   - Use IF NOT EXISTS for tables and indexes
   - Include proper type definitions

3. **Register in index**
   - Add import: `import migrationXXX from "./XXX_migration_name";`
   - Add to migrations array: `const migrations: Migration[] = [..., migrationXXX];`

4. **Sync to artha-builds**
   - Copy migration file to artha-builds/database/migrations/
   - Update artha-builds/database/migrations/index.ts (import + array)

## Migration File Template

```typescript
import type { Migration } from "./index";

const migrationXXX: Migration = {
  version: XXX,
  name: "migration_name",
  up: async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS table_name (
        column1 INTEGER NOT NULL,
        column2 TEXT,
        PRIMARY KEY (column1)
      );
    `);
    
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_table_name_column
      ON table_name(column);
    `);
  },
};

export default migrationXXX;
```

## Common Patterns

**Create table with composite key:**
```typescript
PRIMARY KEY (user_id, key)
```

**Default values:**
```typescript
column INTEGER NOT NULL DEFAULT 1,
column TEXT NOT NULL DEFAULT (datetime('now'))
```

**Foreign key references:**
```typescript
FOREIGN KEY (user_id) REFERENCES users(id)
```

**Timestamp columns:**
```typescript
created_at TEXT NOT NULL DEFAULT (datetime('now')),
updated_at TEXT NOT NULL DEFAULT (datetime('now'))
```

## Naming Conventions

- File name: `XXX_descriptive_name.ts` (lowercase, underscores)
- Migration name: `"descriptive_name"` (lowercase, underscores)
- Index names: `idx_table_name_column` (idx_ prefix)

## Testing

After creating migration:
```bash
npm test
```

Ensure all tests pass before committing.

## Key Files

- Migrations directory: database/migrations/
- Index file: database/migrations/index.ts
- Schema reference: .context/DATABASE_SCHEMA.md
- Migration type definition: database/migrations/index.ts (Migration interface)

## Related Skills

- Database Migration Skill (detailed migration process)
- Two-Repo Sync Skill (syncing migrations to artha-builds)
