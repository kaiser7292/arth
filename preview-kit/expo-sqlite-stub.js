// Preview harness only (ARTH_PREVIEW=1, web): expo-sqlite's web build needs a wasm file Metro
// can't resolve here, and the harness never touches a database. Any call fails loudly.
function unavailable() {
  throw new Error("No database in the preview harness");
}
module.exports = {
  openDatabaseSync: unavailable,
  openDatabaseAsync: unavailable,
  deleteDatabaseSync: unavailable,
  deleteDatabaseAsync: unavailable,
  SQLiteDatabase: function SQLiteDatabase() {},
};
