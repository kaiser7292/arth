import type { SQLiteDatabase } from "expo-sqlite";
import { backfillCreditKinds } from "../credit-kind-backfill";
import type { Migration } from "./index";

/**
 * Migration 091 — credits are described by their type instead of a category, so older credits get
 * the type they show (see backfillCreditKinds). No schema change. Safe to repeat: it only touches
 * credits that have no type.
 */
export const migration: Migration = {
  version: 91,
  name: "credit_kinds_backfill",
  up: async (db: SQLiteDatabase) => {
    await backfillCreditKinds(db);
  },
};

export default migration;
