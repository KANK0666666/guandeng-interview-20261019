import * as sqlite from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function createStore(directory) {
  if (directory !== ":memory:") mkdirSync(directory, { recursive: true });
  const Database = sqlite.Database ?? sqlite.DatabaseSync;
  const db = new Database(
    directory === ":memory:"
      ? ":memory:"
      : resolve(directory, "workspace.sqlite"),
  );
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS datasets (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (dataset TEXT NOT NULL, rowid TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(dataset, rowid));`);
  return {
    save: (data) =>
      db
        .prepare("INSERT OR REPLACE INTO datasets (id, body) VALUES (?, ?)")
        .run(data.id, JSON.stringify(data)),
    get: (id) => {
      const row = db.prepare("SELECT body FROM datasets WHERE id = ?").get(id);
      return row ? JSON.parse(row.body) : null;
    },
    list: () =>
      db
        .prepare("SELECT body FROM datasets ORDER BY rowid DESC")
        .all()
        .map((r) => JSON.parse(r.body)),
    notes: (dataset) =>
      Object.fromEntries(
        db
          .prepare("SELECT rowid, body FROM notes WHERE dataset = ?")
          .all(dataset)
          .map((r) => [r.rowid, JSON.parse(r.body)]),
      ),
    setNote: (dataset, rowid, note) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO notes (dataset, rowid, body) VALUES (?, ?, ?)",
        )
        .run(dataset, rowid, JSON.stringify(note)),
    close: () => db.close(),
  };
}
