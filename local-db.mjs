import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function localDb(file = ":memory:") {
  const sqlite = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  sqlite.exec("PRAGMA busy_timeout=5000");
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products'").get()) {
    sqlite.exec(readFileSync(new URL("./drizzle/0001_store.sql", import.meta.url), "utf8"));
  }
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='store_owner'").get()) {
    sqlite.exec(readFileSync(new URL("./drizzle/0002_owner_and_reservations.sql", import.meta.url), "utf8"));
  }
  if (!sqlite.prepare("SELECT 1 FROM pragma_table_info('products') WHERE name='position'").get()) {
    sqlite.exec(readFileSync(new URL("./drizzle/0003_display_order.sql", import.meta.url), "utf8"));
  }
  if (!sqlite.prepare("SELECT 1 FROM pragma_table_info('products') WHERE name='size_chart'").get()) {
    sqlite.exec(readFileSync(new URL("./drizzle/0004_size_chart.sql", import.meta.url), "utf8"));
  }
  const db = {
    prepare(sql) {
      return { bind(...values) {
        return {
          first: async () => sqlite.prepare(sql).get(...values) ?? null,
          all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
          execute: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
          async run() { return this.execute(); }
        };
      } };
    },
    async batch(commands) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = commands.map(command => command.execute());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  };
  return db;
}
