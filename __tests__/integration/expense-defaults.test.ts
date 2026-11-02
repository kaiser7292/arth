import { DatabaseSync } from "node:sqlite";
import { FILL_MODE_FROM_ACCOUNT_SQL, FOLLOW_CATEGORY_SQL } from "../../services/expense-defaults";

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE categories (id TEXT PRIMARY KEY, is_unavoidable INTEGER NOT NULL);
    CREATE TABLE account_payment_modes (account_id TEXT, payment_mode_id TEXT);
    CREATE TABLE expenses (id TEXT PRIMARY KEY, category_id TEXT, is_right_spend INTEGER, payment_mode_id TEXT, nature TEXT);
    INSERT INTO categories VALUES ('rent', 1), ('food', 0);
    INSERT INTO account_payment_modes VALUES ('one', 'upi'), ('two', 'upi'), ('two', 'card');
  `);
});

const add = (id: string, category: string | null, flag: number | null, nature = "realized", mode: string | null = null) =>
  db.prepare("INSERT INTO expenses VALUES (?, ?, ?, ?, ?)").run(id, category, flag, mode, nature);
const row = (id: string) => db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as { is_right_spend: number | null; payment_mode_id: string | null };
const setCategory = (id: string, category: string) =>
  db.prepare(`UPDATE expenses SET category_id = ?, ${FOLLOW_CATEGORY_SQL} WHERE id = ?`).run(category, category, id);
const setAccount = (id: string, account: string) =>
  db.prepare(`UPDATE expenses SET ${FILL_MODE_FROM_ACCOUNT_SQL} WHERE id = ?`).run(account, account, id);

describe("a spend follows its category's discretionary / unavoidable setting", () => {
  it("fills a blank flag", () => {
    add("a", null, null);
    setCategory("a", "rent");
    expect(row("a").is_right_spend).toBe(1);
  });

  it("follows the new category when the flag was just the old category's setting", () => {
    add("a", "food", 0);
    setCategory("a", "rent");
    expect(row("a").is_right_spend).toBe(1);
  });

  it("keeps a flag the user set against the old category", () => {
    add("a", "food", 1);
    setCategory("a", "rent");
    expect(row("a").is_right_spend).toBe(1);
    add("b", "rent", 0);
    setCategory("b", "food");
    expect(row("b").is_right_spend).toBe(0);
    add("c", null, 0);
    setCategory("c", "rent");
    expect(row("c").is_right_spend).toBe(0);
  });

  it("leaves money coming in alone", () => {
    add("a", null, null, "credit");
    setCategory("a", "rent");
    expect(row("a").is_right_spend).toBeNull();
  });
});

describe("a spend with no payment mode takes its account's", () => {
  it("fills in the account's only linked mode", () => {
    add("a", null, null);
    setAccount("a", "one");
    expect(row("a").payment_mode_id).toBe("upi");
  });

  it("doesn't guess between several, or with none linked", () => {
    add("a", null, null);
    setAccount("a", "two");
    expect(row("a").payment_mode_id).toBeNull();
    setAccount("a", "none");
    expect(row("a").payment_mode_id).toBeNull();
  });

  it("keeps a mode already detected or chosen", () => {
    add("a", null, null, "realized", "card");
    setAccount("a", "one");
    expect(row("a").payment_mode_id).toBe("card");
  });

  it("leaves money coming in alone", () => {
    add("a", null, null, "credit");
    setAccount("a", "one");
    expect(row("a").payment_mode_id).toBeNull();
  });
});
