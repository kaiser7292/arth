import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 085 — what a picture template was taught on, so it can be edited later.
 *
 * image_templates.sample_lines: JSON {pieces, picks} - the sample picture's text with each piece's
 * position (not the picture itself), and which piece the user linked to each field. The edit screen
 * re-links fields against it (services/receipt/image-templates.ts). NULL for templates saved before
 * 085: those can be renamed and have fields removed, and re-taught with a new picture.
 *
 * Idempotent: the column add is guarded.
 */
export const migration: Migration = {
  version: 85,
  name: "image_template_sample",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(image_templates);`);
    if (!columns.some((c) => c.name === "sample_lines")) {
      await db.execAsync(`ALTER TABLE image_templates ADD COLUMN sample_lines TEXT;`);
    }
  },
};

export default migration;
