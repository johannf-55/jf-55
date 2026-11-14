// Adaptateur Google Drive (REST v3) pour le moteur de synchro.
// Portée OAuth : drive.file (non sensible) -> l'app ne voit que les fichiers qu'elle a elle-même créés.
// Arborescence créée dans le Drive de l'utilisateur :
//   AuditEnergie/audits/audit-<id>.json      (un document par audit)
//   AuditEnergie/photos/<photoId>.jpg        (une photo = un fichier)
//   AuditEnergie/checklists.json             (modifications de la base des checklists)

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

const authError = (msg) => Object.assign(new Error(msg), { code: 'AUTH' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Authentification (Google Identity Services, flux implicite : jeton de 1 h, pas de refresh token) ----
export function makeAuth(clientId, { onConnected } = {}) {
  let token = null, expires = 0;
  const loadGis = () => new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(authError('Impossible de joindre Google (hors ligne ?)'));
    document.head.appendChild(s);
  });
  return {
    get connected() { return !!token && Date.now() < expires - 60000; },
    invalidate() { token = null; expires = 0; },
    async getToken() {
      if (token && Date.now() < expires - 60000) return token;
      if (!clientId) throw authError('Identifiant client Google non renseigné');
      await loadGis();
      const returning = localStorage.getItem('drive_connected') === '1';
      return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId, scope: SCOPE,
          callback: (r) => {
            if (r.error) return reject(authError(r.error_description || r.error));
            token = r.access_token; expires = Date.now() + (Number(r.expires_in) || 3600) * 1000;
            localStorage.setItem('drive_connected', '1'); onConnected?.();
            resolve(token);
          },
          error_callback: (e) => reject(authError(e?.type === 'popup_closed' ? 'Connexion annulée' : (e?.message || e?.type || 'Échec de connexion'))),
        });
        client.requestAccessToken({ prompt: returning ? '' : 'consent' });
      });
    },
  };
}

// ---- Adaptateur de stockage distant ----
export class DriveRemote {
  constructor({ auth, store }) { this.auth = auth; this.store = store; this.ids = null; }

  async req(url, opts = {}, attempt = 0) {
    const token = await this.auth.getToken();
    let res;
    try { res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } }); }
    catch (e) { throw new Error('Réseau indisponible'); }
    if (res.status === 401) { this.auth.invalidate(); if (attempt < 1) return this.req(url, opts, attempt + 1); throw authError('Session Google expirée'); }
    const retriable = res.status === 429 || res.status >= 500 ||
      (res.status === 403 && /rate|quota/i.test(await res.clone().text().catch(() => '')));
    if (retriable && attempt < 4) { await sleep(500 * 2 ** attempt + Math.random() * 250); return this.req(url, opts, attempt + 1); }
    if (!res.ok) throw new Error(`Drive ${res.status} : ${(await res.text().catch(() => '')).slice(0, 160)}`);
    return res;
  }

  async list(parentId, extraQuery = '') {
    const files = []; let pageToken = '';
    do {
      const q = encodeURIComponent(`'${parentId}' in parents and trashed=false${extraQuery}`);
      const url = `${API}/files?q=${q}&pageSize=1000&orderBy=createdTime&fields=nextPageToken,files(id,name,mimeType,modifiedTime)` + (pageToken ? `&pageToken=${pageToken}` : '');
      const j = await (await this.req(url)).json();
      files.push(...(j.files || [])); pageToken = j.nextPageToken || '';
    } while (pageToken);
    return files;
  }

  async ensureFolder(name, parentId) {
    const found = await this.list(parentId, ` and mimeType='${FOLDER}' and name='${name}'`);
    if (found.length) return found[0].id; // le plus ancien si doublons (course entre appareils)
    const res = await this.req(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
    return (await res.json()).id;
  }

  async ensureLayout() {
    if (this.ids) return this.ids;
    const root = await this.ensureFolder('AuditEnergie', 'root');
    this.ids = { root, audits: await this.ensureFolder('audits', root), photos: await this.ensureFolder('photos', root) };
    await this.store.metaSet('driveRoot', root);
    return this.ids;
  }

  async listAudits() {
    const { audits } = await this.ensureLayout();
    return (await this.list(audits)).filter((f) => /^audit-.+\.json$/.test(f.name))
      .map((f) => ({ auditId: f.name.slice(6, -5), fileId: f.id, modifiedTime: f.modifiedTime }));
  }

  async getAudit(fileId) { return (await this.req(`${API}/files/${fileId}?alt=media`)).json(); }

  async upload({ fileId, name, parentId, mime, body }) {
    const boundary = 'b' + Math.random().toString(36).slice(2);
    const meta = fileId ? { name } : { name, parents: [parentId] };
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
    const payload = new Blob([head, body, `\r\n--${boundary}--`]);
    const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,modifiedTime` : `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`;
    const res = await this.req(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: payload });
    return res.json();
  }

  async putAudit(auditId, doc, fileId) {
    const { audits } = await this.ensureLayout();
    return this.upload({ fileId, name: `audit-${auditId}.json`, parentId: audits, mime: 'application/json', body: JSON.stringify(doc) });
  }

  // Fichiers de configuration partagés entre appareils (ex. base des checklists), à la racine AuditEnergie/
  async findConfig(name) {
    const { root } = await this.ensureLayout();
    const f = (await this.list(root, ` and name='${name}'`)).find((x) => x.mimeType !== FOLDER);
    return f ? { fileId: f.id, modifiedTime: f.modifiedTime } : null;
  }
  async getConfig(fileId) { return (await this.req(`${API}/files/${fileId}?alt=media`)).json(); }
  async putConfig(name, obj, fileId) {
    const { root } = await this.ensureLayout();
    return this.upload({ fileId, name, parentId: root, mime: 'application/json', body: JSON.stringify(obj) });
  }

  async listPhotos() {
    const { photos } = await this.ensureLayout();
    return new Map((await this.list(photos)).filter((f) => f.name.endsWith('.jpg')).map((f) => [f.name.slice(0, -4), f.id]));
  }
  async putPhoto(photoId, blob) {
    const { photos } = await this.ensureLayout();
    return this.upload({ name: `${photoId}.jpg`, parentId: photos, mime: 'image/jpeg', body: blob });
  }
  async getPhoto(fileId) { return (await this.req(`${API}/files/${fileId}?alt=media`)).blob(); }
  async trashPhoto(fileId) {
    await this.req(`${API}/files/${fileId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
}
