// Adaptateur SharePoint (Microsoft Graph v1.0) pour le moteur de synchro.
// Même interface que l'ancien adaptateur Google Drive : sync-core.js n'a pas changé.
//
// Arborescence créée dans la bibliothèque de documents du site SharePoint :
//   <dossier>/audits/audit-<id>.json      (un document par audit)       — <dossier> = AuditEnergie par défaut
//   <dossier>/photos/<photoId>.jpg        (une photo = un fichier)
//   <dossier>/checklists.json             (modifications de la base des checklists)
//
// Authentification : Microsoft Entra ID, flux « code d'autorisation + PKCE » pour application web monopage (SPA),
// sans serveur et sans secret. Le jeton d'accès dure environ 1 h ; un jeton de renouvellement (≈ 24 h, lié à l'origine)
// permet de le renouveler sans geste de l'utilisateur. Au-delà, un nouveau passage par la page de connexion Microsoft
// est nécessaire (touchez ⟳).

// Portée déléguée : l'application n'accède qu'à ce que l'utilisateur connecté peut déjà ouvrir. Selon la politique du
// locataire Microsoft 365, un administrateur doit accorder le consentement une fois (voir le guide de déploiement).
export const SCOPES = 'Sites.ReadWrite.All offline_access';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';
const KEY_TOKENS = 'ms_tokens';
const KEY_PENDING = 'ms_pending';

/** Erreur d'authentification. login = true : une nouvelle connexion interactive (redirection) est nécessaire. */
const authError = (msg, login = false) => Object.assign(new Error(msg), { code: 'AUTH', login });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const enc = (path) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/** Normalise la configuration saisie (valeurs par défaut, espaces, barres obliques). */
export function normalizeConfig(c = {}) {
  const t = (v) => String(v ?? '').trim();
  return {
    clientId: t(c.clientId), tenant: t(c.tenant), siteUrl: t(c.siteUrl),
    library: c.library === undefined ? 'Documents' : t(c.library),
    folder: t(c.folder === undefined ? 'AuditEnergie' : c.folder).replace(/^\/+|\/+$/g, '') || 'AuditEnergie',
  };
}
export const isConfigured = (c) => !!(c && c.clientId && c.tenant && c.siteUrl);

/** « https://x.sharepoint.com/sites/Audits/Shared Documents/Forms/AllItems.aspx » -> { host, path: '/sites/Audits' } */
export function parseSiteUrl(u) {
  let url;
  try { url = new URL(String(u).trim()); } catch { throw new Error('Adresse du site SharePoint invalide (attendu : https://…sharepoint.com/sites/…)'); }
  const m = url.pathname.match(/^\/(sites|teams)\/[^/]+/i);
  return { host: url.hostname, path: m ? m[0] : '' };
}

// ---- Authentification --------------------------------------------------------------------------
export function makeAuth(cfg, { onConnected } = {}) {
  const redirectUri = () => location.origin + location.pathname;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY_TOKENS) || 'null') || {}; } catch { return {}; } };
  const write = (t) => { try { localStorage.setItem(KEY_TOKENS, JSON.stringify(t)); } catch { /* stockage indisponible */ } };
  const endpoint = (p) => `${LOGIN}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/${p}`;

  async function tokenRequest(params) {
    let res;
    try {
      res = await fetch(endpoint('token'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId, scope: SCOPES, ...params }) });
    } catch { throw new Error('Réseau indisponible'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const relogin = ['invalid_grant', 'interaction_required', 'login_required', 'consent_required'].includes(j.error);
      throw authError((j.error_description || j.error || `Microsoft ${res.status}`).split('\r')[0], relogin);
    }
    const prev = read();
    write({ access: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000, refresh: j.refresh_token || prev.refresh || '' });
    onConnected?.();
    return j.access_token;
  }

  return {
    get connected() { const t = read(); return !!(t.access && Date.now() < t.expires - 60000) || !!t.refresh; },
    invalidate() { const t = read(); write({ ...t, access: '', expires: 0 }); },
    logout() { try { localStorage.removeItem(KEY_TOKENS); } catch { /* rien */ } },

    async getToken() {
      const t = read();
      if (t.access && Date.now() < t.expires - 60000) return t.access;
      if (!cfg.clientId || !cfg.tenant) throw authError('Configuration Microsoft incomplète (⚙ Réglages)');
      if (t.refresh) {
        try { return await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }); }
        catch (e) { if (e.login) write({}); throw e; }
      }
      throw authError('Connexion Microsoft nécessaire', true);
    },

    /** Redirige vers la page de connexion Microsoft (à appeler sur un geste de l'utilisateur). */
    async login() {
      const verifier = rand(48), state = rand(16);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      try { localStorage.setItem(KEY_PENDING, JSON.stringify({ verifier, state, hash: location.hash, at: Date.now() })); } catch { /* rien */ }
      const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
        scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
      location.assign(`${endpoint('authorize')}?${q}`);
      return new Promise(() => {}); // la page est quittée
    },

    /** À appeler au démarrage : termine la connexion si on revient de Microsoft. -> null | { ok } | { error } */
    async handleRedirect() {
      const q = new URLSearchParams(location.search);
      if (!q.has('state') || !(q.has('code') || q.has('error'))) return null;
      let pending = null;
      try { pending = JSON.parse(localStorage.getItem(KEY_PENDING) || 'null'); localStorage.removeItem(KEY_PENDING); } catch { /* rien */ }
      history.replaceState(null, '', location.pathname + (pending?.hash || ''));
      if (!pending || pending.state !== q.get('state')) return { error: 'Retour de connexion Microsoft non reconnu — recommencez avec ⟳' };
      if (q.has('error')) return { error: (q.get('error_description') || q.get('error')).split('\n')[0] };
      try {
        await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pending.verifier });
        return { ok: true };
      } catch (e) { return { error: e.message }; }
    },
  };
}

// ---- Adaptateur de stockage distant ------------------------------------------------------------
export class SharePointRemote {
  constructor({ auth, store, config }) { this.auth = auth; this.store = store; this.cfg = normalizeConfig(config); this.lay = null; }

  async req(url, opts = {}, attempt = 0) {
    const token = await this.auth.getToken();
    let res;
    try { res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } }); }
    catch { throw new Error('Réseau indisponible'); }
    if (res.status === 401) {
      this.auth.invalidate();
      if (attempt < 1) return this.req(url, opts, attempt + 1);
      throw authError('Session Microsoft expirée', true);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const ra = Number(res.headers.get('Retry-After'));
      await sleep(ra > 0 ? Math.min(ra, 30) * 1000 : 500 * 2 ** attempt + Math.random() * 250);
      return this.req(url, opts, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let msg = body.slice(0, 160);
      try { msg = JSON.parse(body).error?.message || msg; } catch { /* texte brut */ }
      throw Object.assign(new Error(`SharePoint ${res.status} : ${msg}`), { status: res.status });
    }
    return res;
  }

  async json(url, opts) { return (await this.req(url, opts)).json(); }
  async jsonOrNull(url) { try { return await this.json(url); } catch (e) { if (e.status === 404) return null; throw e; } }

  async children(path) {
    const out = [];
    let url = `${GRAPH}/drives/${this.lay.drive}/root:/${enc(path)}:/children?$select=id,name,lastModifiedDateTime,folder&$top=200`;
    while (url) { const j = await this.json(url); out.push(...(j.value || [])); url = j['@odata.nextLink'] || ''; }
    return out.filter((f) => !f.folder);
  }

  async ensureFolder(path) {
    const item = `${GRAPH}/drives/${this.lay.drive}/root:/${enc(path)}`;
    const found = await this.jsonOrNull(item);
    if (found) return found;
    const segs = path.split('/'), name = segs.pop(), parent = segs.join('/');
    try {
      return await this.json(parent ? `${GRAPH}/drives/${this.lay.drive}/root:/${enc(parent)}:/children` : `${GRAPH}/drives/${this.lay.drive}/root/children`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      });
    } catch (e) { if (e.status === 409) return this.json(item); throw e; } // créé entre-temps par un autre appareil
  }

  async ensureLayout() {
    if (this.lay) return this.lay;
    const { host, path } = parseSiteUrl(this.cfg.siteUrl);
    const site = await this.json(path ? `${GRAPH}/sites/${host}:${path}` : `${GRAPH}/sites/root`);
    let drive;
    if (this.cfg.library) {
      const j = await this.json(`${GRAPH}/sites/${site.id}/drives?$select=id,name,webUrl`);
      const want = this.cfg.library.toLowerCase();
      drive = (j.value || []).find((d) => d.name.toLowerCase() === want || decodeURIComponent(d.webUrl.split('/').pop()).toLowerCase() === want);
      if (!drive) throw new Error(`Bibliothèque « ${this.cfg.library} » introuvable sur ce site. Disponibles : ${(j.value || []).map((d) => d.name).join(', ') || 'aucune'}`);
    } else drive = await this.json(`${GRAPH}/sites/${site.id}/drive?$select=id,name,webUrl`);
    this.lay = { drive: drive.id, root: this.cfg.folder, audits: `${this.cfg.folder}/audits`, photos: `${this.cfg.folder}/photos` };
    const root = await this.ensureFolder(this.lay.root);
    await this.ensureFolder(this.lay.audits);
    await this.ensureFolder(this.lay.photos);
    await this.store.metaSet('remoteRoot', root.webUrl || '');
    return this.lay;
  }

  async listAudits() {
    await this.ensureLayout();
    return (await this.children(this.lay.audits)).filter((f) => /^audit-.+\.json$/.test(f.name))
      .map((f) => ({ auditId: f.name.slice(6, -5), fileId: f.id, modifiedTime: f.lastModifiedDateTime }));
  }

  // Téléchargement : adresse pré-authentifiée fournie par Graph (sans en-tête Authorization), repli sur /content
  async download(fileId) {
    const base = `${GRAPH}/drives/${this.lay.drive}/items/${fileId}`;
    const meta = await this.json(`${base}?$select=id,@microsoft.graph.downloadUrl`);
    const direct = meta['@microsoft.graph.downloadUrl'];
    if (direct) { try { const r = await fetch(direct); if (r.ok) return r; } catch { /* repli ci-dessous */ } }
    return this.req(`${base}/content`);
  }

  async getAudit(fileId) { await this.ensureLayout(); return (await this.download(fileId)).json(); }

  async upload({ fileId, dir, name, mime, body }) {
    await this.ensureLayout();
    const url = fileId ? `${GRAPH}/drives/${this.lay.drive}/items/${fileId}/content`
      : `${GRAPH}/drives/${this.lay.drive}/root:/${enc(`${dir}/${name}`)}:/content?@microsoft.graph.conflictBehavior=replace`;
    const j = await this.json(url, { method: 'PUT', headers: { 'Content-Type': mime }, body });
    return { id: j.id, modifiedTime: j.lastModifiedDateTime };
  }

  putAudit(auditId, doc, fileId) {
    return this.upload({ fileId, dir: this.cfg.folder + '/audits', name: `audit-${auditId}.json`, mime: 'application/json', body: JSON.stringify(doc) });
  }

  // Fichiers de configuration partagés entre appareils (ex. base des checklists), à la racine du dossier
  async findConfig(name) {
    await this.ensureLayout();
    const f = await this.jsonOrNull(`${GRAPH}/drives/${this.lay.drive}/root:/${enc(`${this.lay.root}/${name}`)}?$select=id,lastModifiedDateTime,folder`);
    return f && !f.folder ? { fileId: f.id, modifiedTime: f.lastModifiedDateTime } : null;
  }
  async getConfig(fileId) { await this.ensureLayout(); return (await this.download(fileId)).json(); }
  putConfig(name, obj, fileId) { return this.upload({ fileId, dir: this.cfg.folder, name, mime: 'application/json', body: JSON.stringify(obj) }); }

  async listPhotos() {
    await this.ensureLayout();
    return new Map((await this.children(this.lay.photos)).filter((f) => f.name.endsWith('.jpg')).map((f) => [f.name.slice(0, -4), f.id]));
  }
  putPhoto(photoId, blob) { return this.upload({ dir: this.cfg.folder + '/photos', name: `${photoId}.jpg`, mime: 'image/jpeg', body: blob }); }
  async getPhoto(fileId) { await this.ensureLayout(); return (await this.download(fileId)).blob(); }
  async trashPhoto(fileId) { await this.ensureLayout(); await this.req(`${GRAPH}/drives/${this.lay.drive}/items/${fileId}`, { method: 'DELETE' }); } // corbeille SharePoint
}
