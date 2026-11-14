// Moteur de fusion et de synchronisation, indépendant du stockage et du service distant.
//
// Principe : un fichier JSON « document d'audit » par audit côté distant, plus un fichier par photo.
// Fusion enregistrement par enregistrement (dernier écrit gagne, via updatedAt), suppressions = pierres tombales.
// Un seul utilisateur : pas de résolution de conflit fine, mais la fusion reste commutative et idempotente.

import { SCHEMA_VERSION } from './model.js';

export const COLLECTIONS = ['utilities', 'links', 'notes', 'photos'];

const sameVersion = (a, b) => a.updatedAt === b.updatedAt && (a.deviceId || '') === (b.deviceId || '');
const isNewer = (a, b) => (a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : (a.deviceId || '') > (b.deviceId || ''));

/** Fusionne deux listes d'enregistrements. localChanged : le local doit être mis à jour ; remoteChanged : le distant est en retard. */
export function mergeList(local, remote) {
  const out = new Map(local.map((r) => [r.id, r]));
  const remoteIds = new Set(remote.map((r) => r.id));
  let localChanged = false, remoteChanged = false;
  for (const r of remote) {
    const l = out.get(r.id);
    if (!l) { out.set(r.id, r); localChanged = true; }
    else if (sameVersion(l, r)) continue;
    else if (isNewer(r, l)) { out.set(r.id, r); localChanged = true; }
    else remoteChanged = true;
  }
  for (const l of local) if (!remoteIds.has(l.id)) remoteChanged = true;
  return { merged: [...out.values()], localChanged, remoteChanged };
}

export function mergeDocs(local, remote) {
  if (!local && !remote) throw new Error('mergeDocs: rien à fusionner');
  if (!remote) return { doc: local, localChanged: false, remoteChanged: true };
  if (!local) return { doc: remote, localChanged: true, remoteChanged: false };
  const a = mergeList([local.audit], [remote.audit]);
  const doc = { schema: SCHEMA_VERSION, auditId: local.auditId, audit: a.merged[0] };
  let localChanged = a.localChanged, remoteChanged = a.remoteChanged;
  for (const c of COLLECTIONS) {
    const m = mergeList(local[c] || [], remote[c] || []);
    doc[c] = m.merged; localChanged ||= m.localChanged; remoteChanged ||= m.remoteChanged;
  }
  return { doc, localChanged, remoteChanged };
}

// ---- Passerelles avec le stockage ------------------------------------------------
// Interface store attendue : all(name), byAudit(name, auditId), get(name,id), putMany(name, recs),
// hasBlob/getBlob/putBlob/delBlob(id), metaGet(key, dflt)/metaSet(key, val)

export async function buildDoc(store, auditId) {
  const audit = await store.get('audits', auditId);
  if (!audit) return null;
  const doc = { schema: SCHEMA_VERSION, auditId, audit };
  for (const c of COLLECTIONS) doc[c] = await store.byAudit(c, auditId);
  return doc;
}

export async function applyDoc(store, doc) {
  await store.putMany('audits', [doc.audit]);
  for (const c of COLLECTIONS) if (doc[c]?.length) await store.putMany(c, doc[c]);
}

/** Synchronise les modifications de la base des checklists (meta 'checkBase' = liste d'overrides datés). */
export async function syncChecklistBase(store, remote, stats = {}) {
  const NAME = 'checklists.json';
  const found = await remote.findConfig(NAME);
  const dirty = await store.metaGet('checkBaseDirty', 0);
  if (found && !dirty && (await store.metaGet('checkBaseSeen', '')) === found.modifiedTime) return;
  const local = await store.metaGet('checkBase', []);
  const remoteDoc = found ? await remote.getConfig(found.fileId) : null;
  const m = mergeList(local, remoteDoc?.items || []);
  if (m.localChanged) { await store.metaSet('checkBase', m.merged); stats.basePulled = true; }
  let mt = found?.modifiedTime;
  if (m.remoteChanged || (!found && local.length)) {
    const res = await remote.putConfig(NAME, { app: 'audit-energie', kind: 'checklists', items: m.merged }, found?.fileId);
    mt = res.modifiedTime; stats.basePushed = true;
  }
  if (mt) await store.metaSet('checkBaseSeen', mt);
  if ((await store.metaGet('checkBaseDirty', 0)) === dirty) await store.metaSet('checkBaseDirty', 0);
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

/**
 * Synchronisation complète.
 * remote : { ensureLayout(), listAudits(), getAudit(fileId), putAudit(auditId, doc, fileId?),
 *            listPhotos() -> Map(photoId -> fileId), putPhoto(photoId, blob), getPhoto(fileId), trashPhoto(fileId) }
 */
export async function syncAll(store, remote, { onProgress = () => {} } = {}) {
  const stats = { pulled: 0, pushed: 0, photosUp: 0, photosDown: 0, photosTrashed: 0, errors: [] };
  const authError = (e) => e && e.code === 'AUTH';

  onProgress('Préparation du dossier distant…');
  await remote.ensureLayout();

  // 0) Base des checklists (fichier AuditEnergie/checklists.json, fusion point par point)
  if (remote.findConfig) {
    try { await syncChecklistBase(store, remote, stats); }
    catch (e) { if (authError(e)) throw e; stats.errors.push(`Base des checklists : ${e.message}`); }
  }

  // 1) Audits (métadonnées, utilités, liens, notes, méta des photos)
  onProgress('Synchronisation des audits…');
  const remoteAudits = await remote.listAudits();
  const rmap = new Map(remoteAudits.map((x) => [x.auditId, x]));
  const localAudits = await store.all('audits');
  const ids = new Set([...localAudits.map((a) => a.id), ...rmap.keys()]);
  const dirty = await store.metaGet('dirty', {});
  const seen = await store.metaGet('seen', {});
  const dirtyAtStart = { ...dirty };

  for (const id of ids) {
    try {
      const r = rmap.get(id);
      if (r && !dirty[id] && seen[id] === r.modifiedTime) continue; // déjà à jour
      const localDoc = await buildDoc(store, id);
      const remoteDoc = r ? await remote.getAudit(r.fileId) : null;
      const { doc, localChanged, remoteChanged } = mergeDocs(localDoc, remoteDoc);
      if (localChanged) { await applyDoc(store, doc); stats.pulled++; }
      if (remoteChanged || !r) {
        const res = await remote.putAudit(id, doc, r?.fileId);
        seen[id] = res.modifiedTime; stats.pushed++;
      } else seen[id] = r.modifiedTime;
      if (dirty[id] === dirtyAtStart[id]) delete dirty[id]; // ne pas effacer une modif faite pendant la synchro
    } catch (e) {
      if (authError(e)) throw e;
      stats.errors.push(`Audit ${id.slice(0, 8)} : ${e.message}`);
    }
  }
  await store.metaSet('seen', seen);
  await store.metaSet('dirty', dirty);

  // 2) Photos (fichiers binaires, immuables : nom = id de la photo)
  onProgress('Synchronisation des photos…');
  const remotePhotos = await remote.listPhotos();
  const photos = await store.all('photos');
  const todo = [];
  for (const p of photos) {
    const onRemote = remotePhotos.has(p.id);
    const hasBlob = await store.hasBlob(p.id);
    if (p.deleted) {
      if (onRemote) todo.push({ p, act: 'trash' });
      else if (hasBlob) await store.delBlob(p.id);
    } else if (hasBlob && !onRemote) todo.push({ p, act: 'up' });
    else if (!hasBlob && onRemote) todo.push({ p, act: 'down' });
  }
  let done = 0;
  await pool(todo, 3, async ({ p, act }) => {
    try {
      if (act === 'up') { await remote.putPhoto(p.id, await store.getBlob(p.id)); stats.photosUp++; }
      else if (act === 'down') { await store.putBlob(p.id, await remote.getPhoto(remotePhotos.get(p.id))); stats.photosDown++; }
      else { await remote.trashPhoto(remotePhotos.get(p.id)); await store.delBlob(p.id); stats.photosTrashed++; }
    } catch (e) {
      if (authError(e)) throw e;
      stats.errors.push(`Photo ${p.id.slice(0, 8)} : ${e.message}`);
    }
    onProgress(`Photos : ${++done}/${todo.length}`);
  });

  await store.metaSet('lastSync', Date.now());
  return stats;
}
