// Stockage local : IndexedDB (navigateur) + MemStore (tests Node), même interface.

const RECORD_STORES = ['audits', 'utilities', 'links', 'notes', 'photos'];

export class MemStore {
  constructor() { this.d = Object.fromEntries(RECORD_STORES.map((s) => [s, new Map()])); this.blobs = new Map(); this.meta = new Map(); }
  async all(s) { return [...this.d[s].values()].map((r) => structuredClone(r)); }
  async byAudit(s, id) { return (await this.all(s)).filter((r) => r.auditId === id); }
  async get(s, id) { const r = this.d[s].get(id); return r ? structuredClone(r) : undefined; }
  async put(s, r) { this.d[s].set(r.id, structuredClone(r)); }
  async putMany(s, rs) { for (const r of rs) await this.put(s, r); }
  async hasBlob(id) { return this.blobs.has(id); }
  async getBlob(id) { return this.blobs.get(id); }
  async putBlob(id, b) { this.blobs.set(id, b); }
  async delBlob(id) { this.blobs.delete(id); }
  async metaGet(k, dflt) { return this.meta.has(k) ? structuredClone(this.meta.get(k)) : dflt; }
  async metaSet(k, v) { this.meta.set(k, structuredClone(v)); }
}

export class IdbStore {
  constructor(name = 'audit-energie') { this.name = name; this.db = null; }

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of RECORD_STORES) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s !== 'audits') os.createIndex('auditId', 'auditId');
        }
        db.createObjectStore('blobs');
        db.createObjectStore('meta');
      };
      req.onsuccess = () => { this.db = req.result; resolve(this); };
      req.onerror = () => reject(req.error);
    });
  }

  _tx(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(tx)).then((r) => { result = r; }).catch((e) => { try { tx.abort(); } catch {} reject(e); });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    });
  }
  _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  all(s) { return this._tx(s, 'readonly', (tx) => this._req(tx.objectStore(s).getAll())); }
  byAudit(s, id) {
    if (s === 'audits') return this.all(s);
    return this._tx(s, 'readonly', (tx) => this._req(tx.objectStore(s).index('auditId').getAll(id)));
  }
  get(s, id) { return this._tx(s, 'readonly', (tx) => this._req(tx.objectStore(s).get(id))); }
  put(s, r) { return this._tx(s, 'readwrite', (tx) => { tx.objectStore(s).put(r); }); }
  putMany(s, rs) { return this._tx(s, 'readwrite', (tx) => { const os = tx.objectStore(s); for (const r of rs) os.put(r); }); }

  hasBlob(id) { return this._tx('blobs', 'readonly', async (tx) => (await this._req(tx.objectStore('blobs').count(id))) > 0); }
  getBlob(id) { return this._tx('blobs', 'readonly', (tx) => this._req(tx.objectStore('blobs').get(id))); }
  putBlob(id, b) { return this._tx('blobs', 'readwrite', (tx) => { tx.objectStore('blobs').put(b, id); }); }
  delBlob(id) { return this._tx('blobs', 'readwrite', (tx) => { tx.objectStore('blobs').delete(id); }); }

  async metaGet(k, dflt) { const v = await this._tx('meta', 'readonly', (tx) => this._req(tx.objectStore('meta').get(k))); return v === undefined ? dflt : v; }
  metaSet(k, v) { return this._tx('meta', 'readwrite', (tx) => { tx.objectStore('meta').put(v, k); }); }
}
