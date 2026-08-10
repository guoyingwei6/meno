import { describe, expect, it } from 'vitest';
import { createMemo, listPublicMemos } from '../db/memo-repository';
import { applySchema } from '../db/schema';
import { createTestD1 } from './d1-test-helpers';

const observeQueryCount = (database: D1Database) => {
  let queryCount = 0;
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === 'bind') {
        return (...values: unknown[]) => {
          const bind = value as (...args: unknown[]) => D1PreparedStatement;
          return wrapStatement(bind.apply(target, values));
        };
      }
      if (property === 'all' || property === 'first' || property === 'run' || property === 'raw') {
        return (...args: unknown[]) => {
          queryCount += 1;
          const execute = value as (...executeArgs: unknown[]) => unknown;
          return execute.apply(target, args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return {
    db: new Proxy(database, {
      get(target, property, receiver) {
        if (property === 'prepare') {
          return (sql: string) => wrapStatement(target.prepare(sql));
        }
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database,
    get queryCount() {
      return queryCount;
    },
  };
};

describe('feed relation query rounds', () => {
  it('loads a 20-memo feed with set-based tag and voice-note reads', async () => {
    const db = createTestD1();
    applySchema(db);

    for (let index = 0; index < 20; index += 1) {
      await createMemo(db, {
        slug: `feed-query-count-${index}`,
        content: `Memo ${index} #feed`,
        visibility: 'public',
        displayDate: '2026-08-10',
      });
    }

    const observed = observeQueryCount(db);
    const memos = await listPublicMemos(observed.db, { limit: 20 });

    expect(memos).toHaveLength(20);
    // One memo query plus one set-based tag query and one set-based voice query.
    expect(observed.queryCount).toBe(3);
  });
});
