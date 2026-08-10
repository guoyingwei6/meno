type RequestHandler = ((event: Event) => void) | null;

interface FixtureRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: RequestHandler;
  onerror: RequestHandler;
}

interface FixtureOpenRequest<T> extends FixtureRequest<T> {
  onupgradeneeded: RequestHandler;
}

interface StoreData {
  values: Map<string, unknown>;
  indexes: Map<string, IDBObjectStoreParameters['keyPath']>;
}

interface FixtureMetrics {
  objectStoreGetAll: number;
  indexGetAll: number;
}

const fixtureMetrics: FixtureMetrics = {
  objectStoreGetAll: 0,
  indexGetAll: 0,
};

const isBlobValue = (value: unknown): value is Blob => (
  typeof value === 'object'
  && value !== null
  && (value instanceof Blob || value.constructor?.name === 'Blob')
);

const cloneValue = <T>(value: T): T => {
  if (value === undefined || value === null || typeof value !== 'object' || isBlobValue(value)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) copy[key] = cloneValue(item);
  return copy as T;
};

const toDomError = (error: unknown): DOMException => (
  error instanceof DOMException ? error : new DOMException(error instanceof Error ? error.message : 'IndexedDB fixture operation failed')
);

class FixtureRequestObject<T> implements FixtureRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: RequestHandler = null;
  onerror: RequestHandler = null;
}

const readKeyPath = (value: unknown, keyPath: IDBObjectStoreParameters['keyPath']): unknown => {
  if (typeof keyPath !== 'string') return undefined;
  return keyPath.split('.').reduce<unknown>((current, segment) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined
  ), value);
};

class FixtureSchemaObjectStore {
  constructor(
    protected readonly database: FixtureDatabase,
    protected readonly name: string,
  ) {}

  get indexNames(): DOMStringList {
    const names = this.database.indexNamesFor(this.name);
    return {
      contains: (name: string) => names.includes(name),
    } as unknown as DOMStringList;
  }

  createIndex(name: string, keyPath: IDBObjectStoreParameters['keyPath']): IDBIndex {
    this.database.createIndex(this.name, name, keyPath);
    return {} as IDBIndex;
  }
}

class FixtureIndex {
  constructor(
    private readonly transaction: FixtureTransaction,
    private readonly database: FixtureDatabase,
    private readonly storeName: string,
    private readonly indexName: string,
  ) {}

  getAll(query?: IDBValidKey | IDBKeyRange | null): IDBRequest<unknown[]> {
    fixtureMetrics.indexGetAll += 1;
    return this.transaction.addRequest(() => {
      const keyPath = this.database.indexKeyPath(this.storeName, this.indexName);
      const values = Array.from(this.database.store(this.storeName).values.values());
      if (query === undefined || query === null) return values.map(cloneValue);
      return values.filter((value) => readKeyPath(value, keyPath) === query).map(cloneValue);
    });
  }
}

class FixtureTransaction {
  readonly oncomplete: RequestHandler = null;
  readonly onerror: RequestHandler = null;
  readonly onabort: RequestHandler = null;
  error: DOMException | null = null;

  private started = false;
  private finished = false;
  private completionScheduled = false;
  private pendingRequests = 0;
  private readonly queuedOperations: Array<() => void> = [];

  constructor(
    private readonly database: FixtureDatabase,
    private readonly storeName: string,
    private readonly mode: IDBTransactionMode,
  ) {}

  objectStore(name: string): FixtureObjectStore {
    if (name !== this.storeName) throw new Error(`Unknown fixture object store: ${name}`);
    return new FixtureObjectStore(this, this.database, name);
  }

  start() {
    if (this.started || this.finished) return;
    this.started = true;
    while (this.queuedOperations.length > 0) this.queuedOperations.shift()?.();
  }

  addRequest<T>(operation: () => T): IDBRequest<T> {
    const request = new FixtureRequestObject<T>();
    this.pendingRequests += 1;
    const run = () => {
      queueMicrotask(() => {
        if (this.finished) return;
        try {
          request.result = cloneValue(operation());
          request.onsuccess?.(new Event('success'));
          this.pendingRequests -= 1;
          this.maybeComplete();
        } catch (error) {
          this.error = toDomError(error);
          request.error = this.error;
          request.onerror?.(new Event('error'));
          this.abort();
        }
      });
    };
    if (this.started) run();
    else this.queuedOperations.push(run);
    return request as unknown as IDBRequest<T>;
  }

  private maybeComplete() {
    if (!this.started || this.finished || this.pendingRequests !== 0 || this.completionScheduled) return;
    this.completionScheduled = true;
    queueMicrotask(() => {
      this.completionScheduled = false;
      if (this.finished || this.pendingRequests !== 0) return;
      this.finished = true;
      (this as unknown as { oncomplete: RequestHandler }).oncomplete?.(new Event('complete'));
      if (this.mode === 'readwrite') this.database.releaseWrite(this);
    });
  }

  private abort() {
    if (this.finished) return;
    this.finished = true;
    (this as unknown as { onabort: RequestHandler }).onabort?.(new Event('abort'));
    if (this.mode === 'readwrite') this.database.releaseWrite(this);
  }
}

class FixtureObjectStore extends FixtureSchemaObjectStore {
  constructor(
    private readonly transaction: FixtureTransaction,
    database: FixtureDatabase,
    name: string,
  ) {
    super(database, name);
  }

  put(value: unknown): IDBRequest<unknown> {
    return this.transaction.addRequest(() => {
      const id = this.database.keyFor(value);
      this.database.store(this.name).values.set(id, cloneValue(value));
      return value;
    });
  }

  get(key: IDBValidKey): IDBRequest<unknown> {
    return this.transaction.addRequest(() => cloneValue(this.database.store(this.name).values.get(String(key))));
  }

  getAll(): IDBRequest<unknown[]> {
    fixtureMetrics.objectStoreGetAll += 1;
    return this.transaction.addRequest(() => Array.from(this.database.store(this.name).values.values(), cloneValue));
  }

  index(name: string): IDBIndex {
    this.database.indexKeyPath(this.name, name);
    return new FixtureIndex(this.transaction, this.database, this.name, name) as unknown as IDBIndex;
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.transaction.addRequest(() => {
      this.database.store(this.name).values.delete(String(key));
      return undefined;
    });
  }
}

class FixtureDatabase {
  readonly objectStoreNames: DOMStringList;
  version: number;

  private readonly stores = new Map<string, StoreData>();
  private writeActive = false;
  private readonly queuedWrites: FixtureTransaction[] = [];

  constructor(version: number) {
    this.version = version;
    this.objectStoreNames = {
      contains: (name: string) => this.stores.has(name),
    } as unknown as DOMStringList;
  }

  createObjectStore(name: string): IDBObjectStore {
    if (!this.stores.has(name)) this.stores.set(name, { values: new Map(), indexes: new Map() });
    return new FixtureSchemaObjectStore(this, name) as unknown as IDBObjectStore;
  }

  transaction(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBTransaction {
    if (!this.stores.has(storeName)) throw new Error(`Unknown fixture object store: ${storeName}`);
    const transaction = new FixtureTransaction(this, storeName, mode);
    if (mode === 'readwrite') {
      if (this.writeActive) this.queuedWrites.push(transaction);
      else {
        this.writeActive = true;
        transaction.start();
      }
    } else {
      transaction.start();
    }
    return transaction as unknown as IDBTransaction;
  }

  store(name: string): StoreData {
    const store = this.stores.get(name);
    if (!store) throw new Error(`Unknown fixture object store: ${name}`);
    return store;
  }

  indexNamesFor(storeName: string): string[] {
    return Array.from(this.store(storeName).indexes.keys());
  }

  createIndex(storeName: string, indexName: string, keyPath: IDBObjectStoreParameters['keyPath']) {
    this.store(storeName).indexes.set(indexName, keyPath);
  }

  indexKeyPath(storeName: string, indexName: string): IDBObjectStoreParameters['keyPath'] {
    const keyPath = this.store(storeName).indexes.get(indexName);
    if (keyPath === undefined) throw new Error(`Unknown fixture index: ${indexName}`);
    return keyPath;
  }

  keyFor(value: unknown): string {
    if (!value || typeof value !== 'object' || !('id' in value)) throw new Error('Fixture object store requires an id key');
    const id = (value as { id?: unknown }).id;
    if (typeof id !== 'string') throw new Error('Fixture object store only supports string ids');
    return id;
  }

  releaseWrite(transaction: FixtureTransaction) {
    if (!this.writeActive) return;
    this.writeActive = false;
    if (this.queuedWrites.length > 0) {
      this.writeActive = true;
      this.queuedWrites.shift()?.start();
    }
    void transaction;
  }

  close() {}
}

class FixtureUpgradeTransaction {
  constructor(private readonly database: FixtureDatabase) {}

  objectStore(name: string): IDBObjectStore {
    if (!this.database.objectStoreNames.contains(name)) throw new Error(`Unknown fixture object store: ${name}`);
    return new FixtureSchemaObjectStore(this.database, name) as unknown as IDBObjectStore;
  }
}

class FixtureIndexedDbFactory {
  private readonly databases = new Map<string, FixtureDatabase>();

  open(name: string, version = 1): IDBOpenDBRequest {
    const request = new FixtureRequestObject<FixtureDatabase>() as FixtureOpenRequest<FixtureDatabase>;
    request.onupgradeneeded = null;
    Object.assign(request, { transaction: null });
    queueMicrotask(() => {
      let database = this.databases.get(name);
      const needsUpgrade = !database || version > database.version;
      if (!database) {
        database = new FixtureDatabase(version);
        this.databases.set(name, database);
      } else if (needsUpgrade) {
        database.version = version;
      }
      request.result = database;
      if (needsUpgrade) {
        Object.assign(request, { transaction: new FixtureUpgradeTransaction(database) as unknown as IDBTransaction });
        request.onupgradeneeded?.(new Event('upgradeneeded'));
      }
      queueMicrotask(() => request.onsuccess?.(new Event('success')));
    });
    return request as unknown as IDBOpenDBRequest;
  }

  clear() {
    this.databases.clear();
  }
}

const fixtureFactory = new FixtureIndexedDbFactory();

export const installIndexedDbFixture = () => {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: fixtureFactory,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      writable: true,
      value: fixtureFactory,
    });
  }
};

export const resetIndexedDbFixture = () => {
  fixtureFactory.clear();
  fixtureMetrics.objectStoreGetAll = 0;
  fixtureMetrics.indexGetAll = 0;
};

export const getIndexedDbFixtureMetrics = (): Readonly<FixtureMetrics> => ({ ...fixtureMetrics });
