import type { SQLiteDatabase } from "expo-sqlite";
import { reconcileSettlementKinds } from "../credit-kind-backfill";
import type { Migration } from "./index";

/**
 * Migration 092 — credits linked to a Hisaab settlement get the "settlement" type. No schema change.
 * Safe to repeat.
 */
export const migration: Migration = {
  version: 92,
  name: "credit_kind_settlement",
  up: async (db: SQLiteDatabase) => {
    await reconcileSettlementKinds(db);
  },
};

export default migration;
