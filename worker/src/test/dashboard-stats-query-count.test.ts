import { beforeEach, describe, expect, it } from 'vitest';
import { applySchema } from '../db/schema';
import { createMemo, getDashboardStats, getPublicStats, getRecordStats, trashMemo } from '../db/memo-repository';
import { createTestD1 } from './d1-test-helpers';

const dateDaysAgo = (days: number): string => {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

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

  const observed = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          return wrapStatement(target.prepare(sql));
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return {
    db: observed as D1Database,
    get queryCount() {
      return queryCount;
    },
  };
};

describe('dashboard stats query rounds', () => {
  let db: D1Database;
  let recentDate: string;
  let previousDate: string;

  beforeEach(async () => {
    db = createTestD1();
    applySchema(db);
    recentDate = dateDaysAgo(2);
    previousDate = dateDaysAgo(3);

    const publicOne = await createMemo(db, { slug: 'public-1', content: 'alpha #a', visibility: 'public', displayDate: recentDate });
    const publicTwo = await createMemo(db, { slug: 'public-2', content: 'beta #a #b', visibility: 'public', displayDate: recentDate });
    const privateOne = await createMemo(db, { slug: 'private-1', content: 'gamma #c', visibility: 'private', displayDate: previousDate });
    const trashed = await createMemo(db, { slug: 'trash-1', content: 'delta #d', visibility: 'public', displayDate: recentDate });
    await trashMemo(db, trashed.id);
    await db.prepare('INSERT INTO memo_tags (memo_id, tag) VALUES (?, ?), (?, ?), (?, ?), (?, ?)')
      .bind(publicOne.id, 'a', publicTwo.id, 'a', publicTwo.id, 'b', privateOne.id, 'c')
      .run();
  });

  it('keeps public/author values while reducing stats statements', async () => {
    const publicRecord = observeQueryCount(db);
    await expect(getRecordStats(publicRecord.db, false)).resolves.toEqual({
      totalMemos: 2,
      totalWords: 15,
      maxDailyMemos: 2,
      maxDailyWords: 15,
      activeDays: 1,
      yearMemos: 2,
      heatmap: [{ date: recentDate, count: 2 }],
    });
    expect(publicRecord.queryCount).toBe(1);

    const authorRecord = observeQueryCount(db);
    await expect(getRecordStats(authorRecord.db, true)).resolves.toEqual({
      totalMemos: 3,
      totalWords: 22,
      maxDailyMemos: 2,
      maxDailyWords: 15,
      activeDays: 2,
      yearMemos: 3,
      heatmap: [
        { date: previousDate, count: 1 },
        { date: recentDate, count: 2 },
      ],
    });
    expect(authorRecord.queryCount).toBe(1);

    const dashboard = observeQueryCount(db);
    await expect(getDashboardStats(dashboard.db)).resolves.toEqual({
      total: 3,
      public: 2,
      private: 1,
      trash: 1,
      tags: 3,
      streakDays: 1,
    });
    expect(dashboard.queryCount).toBe(1);

    const publicStats = observeQueryCount(db);
    await expect(getPublicStats(publicStats.db)).resolves.toEqual({
      total: 2,
      tags: 2,
      streakDays: 1,
    });
    expect(publicStats.queryCount).toBe(1);
  });
});
