import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import DatabaseConstructor from "better-sqlite3";
import { RuntimeStorePersistence, RuntimeStoreStateSnapshot } from "./store.js";

const STATE_KEY = "runtime";

export class SqliteRuntimeStorePersistence implements RuntimeStorePersistence {
  private readonly db: InstanceType<typeof DatabaseConstructor>;

  constructor(private readonly databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseConstructor(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS runtime_state (",
        "  id TEXT PRIMARY KEY,",
        "  payload TEXT NOT NULL,",
        "  updatedAt TEXT NOT NULL",
        ");"
      ].join("\n")
    );
  }

  load(): RuntimeStoreStateSnapshot | null {
    const row = this.db
      .prepare("SELECT payload FROM runtime_state WHERE id = ? LIMIT 1")
      .get(STATE_KEY) as { payload: string } | undefined;

    if (!row?.payload) {
      return null;
    }

    try {
      return JSON.parse(row.payload) as RuntimeStoreStateSnapshot;
    } catch {
      return null;
    }
  }

  save(snapshot: RuntimeStoreStateSnapshot): void {
    this.db
      .prepare(
        [
          "INSERT INTO runtime_state (id, payload, updatedAt)",
          "VALUES (?, ?, ?)",
          "ON CONFLICT(id) DO UPDATE SET",
          "  payload = excluded.payload,",
          "  updatedAt = excluded.updatedAt"
        ].join("\n")
      )
      .run(STATE_KEY, JSON.stringify(snapshot), new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }

  getPath(): string {
    return this.databasePath;
  }
}
