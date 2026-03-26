import Database from 'better-sqlite3';

class TestStatement {
  constructor(private db: Database.Database, private sql: string, private values: unknown[] = []) {}

  bind(...values: unknown[]) {
    return new TestStatement(this.db, this.sql, values);
  }

  async all<T = Record<string, unknown>>() {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...this.values) as T[];
    return { results };
  }

  async first<T = Record<string, unknown>>() {
    const stmt = this.db.prepare(this.sql);
    return (stmt.get(...this.values) as T | undefined) ?? null;
  }

  async run() {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.values);
    return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
  }
}

export class TestD1Database {
  constructor(private db: Database.Database) {}

  prepare(sql: string) {
    return new TestStatement(this.db, sql);
  }

  exec(sql: string) {
    this.db.exec(sql);
  }
}

export const createTestD1 = () => {
  const sqlite = new Database(':memory:');
  return new TestD1Database(sqlite) as unknown as D1Database;
};
