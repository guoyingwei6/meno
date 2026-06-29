export interface AppSettings {
  siteTitle: string;
  defaultVisibility: 'public' | 'private';
}

const defaultSettings: AppSettings = {
  siteTitle: 'Meno',
  defaultVisibility: 'private',
};

const allowedKeys = new Set<keyof AppSettings>(['siteTitle', 'defaultVisibility']);

const normalizeSetting = (key: keyof AppSettings, value: unknown): string | null => {
  if (key === 'siteTitle') {
    const title = String(value ?? '').trim();
    return title ? title.slice(0, 80) : null;
  }
  if (key === 'defaultVisibility') {
    return value === 'public' || value === 'private' ? value : null;
  }
  return null;
};

export const getAppSettings = async (db: D1Database): Promise<AppSettings> => {
  const { results } = await db.prepare('SELECT key, value FROM app_settings').all<{ key: string; value: string }>();
  const settings = { ...defaultSettings };
  for (const row of results ?? []) {
    if (row.key === 'siteTitle') settings.siteTitle = row.value;
    if (row.key === 'defaultVisibility' && (row.value === 'public' || row.value === 'private')) {
      settings.defaultVisibility = row.value;
    }
  }
  return settings;
};

export const updateAppSettings = async (db: D1Database, input: Record<string, unknown>): Promise<AppSettings> => {
  const now = new Date().toISOString();
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (!allowedKeys.has(rawKey as keyof AppSettings)) continue;
    const key = rawKey as keyof AppSettings;
    const value = normalizeSetting(key, rawValue);
    if (value === null) continue;
    await db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, value, now)
      .run();
  }
  return getAppSettings(db);
};
