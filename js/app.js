// Application : routage, vues, saisie, photos, synchro. Aucune dépendance, aucun build.
import { IdbStore } from './db.js';
import { FAMILIES, CARRIERS, STATUSES, AUDIT_TYPES, NOTE_CATS, TERRITORIES, GRIDS, KINDS, kindById, kindsOf, uid, newAudit, newUtility, newLink, newNote, newPhoto, utilityLabel, uncSuffix, hoursFromBasis, basisText } from './model.js';
import { ANSWER_TYPES, YES_NO, effectiveBase, itemsFor, progress, isAnswered, targetLabel, editItem, newItem, resetOverrides, upsert, baseToCsv, decodeCsv, importBaseCsv } from './checklist.js';
import { makeAuth, SharePointRemote, normalizeConfig, isConfigured } from './sharepoint.js';
import { syncAll } from './sync-core.js';
import { renderSynoptic } from './synoptic.js';
import { exportXlsx, exportCsvZip, exportBackupZip, importBackup, download } from './export.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const store = new IdbStore();
const S = { audit: null, utilities: [], links: [], notes: [], photos: [] };
const F = { q: '', fam: '', cat: '' };
let deviceId, auth = null, remote = null, authFor = '', syncing = false, autoTimer = null, syncMsg = '', syncPending = null, zoom = null, installEvt = null;

const FAM_ORDER = Object.keys(FAMILIES);
const byTag = (a, b) => FAM_ORDER.indexOf(a.family) - FAM_ORDER.indexOf(b.family) || a.tag.localeCompare(b.tag, 'fr', { numeric: true });
const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')));

// ------------------------------------------------------------------ données
async function load(id) {
  const audit = await store.get('audits', id);
  if (!audit || audit.deleted) { S.audit = null; return; }
  const live = (a) => a.filter((r) => !r.deleted);
  S.audit = audit;
  S.utilities = live(await store.byAudit('utilities', id)).sort(byTag);
  S.links = live(await store.byAudit('links', id));
  S.notes = live(await store.byAudit('notes', id)).sort((a, b) => b.createdAt - a.createdAt);
  S.photos = live(await store.byAudit('photos', id)).sort((a, b) => a.takenAt - b.takenAt);
}
const U = (id) => S.utilities.find((u) => u.id === id);

// Base des checklists (défaut + modifications synchronisées)
let CB = effectiveBase([]);
const reloadBase = async () => { CB = effectiveBase(await store.metaGet('checkBase', [])); };
async function saveBaseOverrides(recs) {
  const ov = upsert(await store.metaGet('checkBase', []), recs);
  await store.metaSet('checkBase', ov); await store.metaSet('checkBaseDirty', Date.now());
  await reloadBase(); scheduleAutoSync();
}

async function save(coll, rec) {
  rec.updatedAt = Date.now(); rec.deviceId = deviceId;
  await store.put(coll, rec);
  const dirty = await store.metaGet('dirty', {});
  dirty[coll === 'audits' ? rec.id : rec.auditId] = Date.now();
  await store.metaSet('dirty', dirty);
  updatePill(); scheduleAutoSync();
}
const tombstone = (coll, rec) => { rec.deleted = true; return save(coll, rec); };

const urls = new Map();
async function photoUrl(p) {
  if (urls.has(p.id)) return urls.get(p.id);
  const b = await store.getBlob(p.id); if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(p.id, u); return u;
}

// ------------------------------------------------------------------ UI de base
let toastT;
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

function dialog(html, onMount, id = 'dlg') {
  const d = document.getElementById(id); d.innerHTML = `<div class="dlg-body">${html}</div>`;
  d.onclick = (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); };
  if (!d.open) d.showModal();
  onMount?.(d); return d;
}
// La confirmation utilise sa propre boîte (dlg2) pour ne pas se mélanger aux événements de fermeture de la boîte principale
const confirmDlg = (msg, okLabel = 'Supprimer') => new Promise((resolve) => {
  const d = dialog(`<h2>Confirmation</h2><p>${msg}</p><div class="row end"><button class="btn" data-close>Annuler</button><button class="btn danger" id="ok">${okLabel}</button></div>`,
    (dl) => { $('#ok', dl).onclick = () => { resolve(true); dl.close(); }; }, 'dlg2');
  d.addEventListener('close', () => resolve(false), { once: true });
});

function updatePill() {
  store.metaGet('dirty', {}).then(async (dirty) => {
    const pill = $('#pill'), n = Object.keys(dirty).length, last = await store.metaGet('lastSync', 0);
    const online = navigator.onLine;
    pill.className = 'pill ' + (!online ? 'off' : n ? 'warn' : last ? 'ok' : '');
    pill.textContent = syncing ? (syncMsg || 'Synchro…') : !online ? (n ? `Hors ligne · ${n} en attente` : 'Hors ligne') : n ? `${n} audit(s) à synchroniser` : last ? `✓ Synchronisé ${new Date(last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Jamais synchronisé';
    $('#btnSync').classList.toggle('spin', syncing);
  });
}

function setHeader(title, back, home = false) {
  $('#title').textContent = title; $('#title').hidden = home; $('#logo').hidden = !home;
  const b = $('#back'); b.hidden = !back; b.onclick = () => { location.hash = back; };
  document.title = `${title} — Audit énergie`;
}

function renderNav(id, tab) {
  const nav = $('#nav'), app = $('#app');
  if (!id) { nav.hidden = true; app.classList.add('no-nav'); return; }
  const items = [['inv', '☰', 'Inventaire'], ['syn', '⛓', 'Synoptique'], ['com', '✎', 'Commentaires'], ['export', '⇩', 'Export'], ['info', 'ⓘ', 'Audit']];
  nav.innerHTML = items.map(([k, ic, l]) => `<a href="#/a/${id}/${k}" class="${tab === k ? 'on' : ''}"><b>${ic}${k === 'com' && S.notes.length ? `<i>${S.notes.length}</i>` : ''}</b>${l}</a>`).join('');
  nav.hidden = false; app.classList.remove('no-nav');
}

// ------------------------------------------------------------------ routage
async function route(opts) {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  if (!(opts && opts.keep)) window.scrollTo(0, 0);
  if (parts[0] === 'base') { renderNav(null); return viewBase(); }
  if (parts[0] !== 'a') { renderNav(null); return viewAudits(); }
  await load(parts[1]);
  if (!S.audit) { location.hash = '#/'; return; }
  const tab = parts[2] === 'notes' ? 'com' : (parts[2] || 'inv');
  renderNav(S.audit.id, tab === 'u' ? 'inv' : tab);
  setHeader(S.audit.name, '#/');
  ({ inv: () => viewInv(null), u: () => viewInv(parts[3], parts[4] === 'check'), syn: viewSyn, com: viewComments, export: viewExport, info: viewInfo }[tab] || (() => viewInv(null)))();
}

// ------------------------------------------------------------------ vue : liste des audits
async function viewAudits() {
  setHeader('Mes audits', null, true);
  const audits = (await store.all('audits')).filter((a) => !a.deleted).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const [us, ph] = await Promise.all([store.all('utilities'), store.all('photos')]);
  const cnt = (arr, id) => arr.filter((r) => r.auditId === id && !r.deleted).length;
  main.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <button class="btn primary grow" data-act="newAudit">＋ Nouvel audit</button>
      <label class="btn">⇧ Importer<input type="file" accept=".zip" hidden data-import></label>
    </div>
    ${audits.length ? audits.map((a) => `
      <a class="card audit-card" href="#/a/${a.id}/inv">
        <h3>${esc(a.name)}</h3>
        <div class="muted small">${esc([a.client, a.site].filter(Boolean).join(' · ') || 'Client / site à renseigner')}</div>
        <div style="margin-top:8px"><span class="badge">${esc(a.territory || '')}</span><span class="badge">${esc(AUDIT_TYPES[a.type] || a.type)}</span><span class="badge">${esc(a.date || '')}</span>
        <span class="badge">${cnt(us, a.id)} utilités</span><span class="badge">${cnt(ph, a.id)} photos</span></div>
      </a>`).join('') : `
      <div class="card empty"><p><b>Aucun audit pour l’instant.</b></p><p>Créez un audit, ou chargez un exemple pour découvrir l’outil.</p>
      <button class="btn" data-act="demo">Charger un audit de démonstration</button></div>`}
    <p class="muted small" style="text-align:center">Les données sont enregistrées sur cet appareil et fonctionnent sans réseau. Touchez ⟳ pour les synchroniser avec votre SharePoint.</p>`;
}

// ------------------------------------------------------------------ vue : inventaire + fiche
function listItems() {
  const q = F.q.toLowerCase();
  const rows = S.utilities.filter((u) => (!F.fam || u.family === F.fam) && (!q || `${u.tag} ${u.name} ${u.location} ${kindById(u.kind).label}`.toLowerCase().includes(q)));
  if (!rows.length) return `<div class="empty">${S.utilities.length ? 'Aucun résultat.' : 'Aucune utilité. Touchez « ＋ Utilité » pour commencer le relevé.'}</div>`;
  let html = '', cur = '';
  for (const u of rows) {
    if (u.family !== cur) { cur = u.family; html += `<div class="fam-h ${cur}">${FAMILIES[cur].long}</div>`; }
    const nl = S.links.filter((l) => l.fromId === u.id || l.toId === u.id).length, np = S.photos.filter((p) => p.utilityId === u.id).length, nn = S.notes.filter((n) => n.utilityId === u.id).length, pg = progress(CB, u);
    html += `<a class="u-item ${u.id === currentUid ? 'sel' : ''}" href="#/a/${S.audit.id}/u/${u.id}"><span class="tag ${u.family}">${esc(u.tag)}</span>
      <span class="t"><b>${esc(u.name || kindById(u.kind).label)}</b><span class="muted small">${esc([u.name ? kindById(u.kind).label : '', u.location].filter(Boolean).join(' · ') || '—')}</span></span>
      <span class="small muted">${nl ? '⛓' + nl + ' ' : ''}${np ? '📷' + np + ' ' : ''}${nn ? '✎' + nn + ' ' : ''}${pg.done ? `☑${pg.done}/${pg.total}` : ''}</span></a>`;
  }
  return html;
}
let currentUid = null;

function viewInv(uidParam, checkMode = false) {
  currentUid = uidParam && U(uidParam) ? uidParam : null;
  main.innerHTML = `<div class="split wide ${currentUid ? 'has-detail' : ''}">
    <section class="list card" style="padding:8px 8px 4px">
      <div class="row" style="margin-bottom:4px"><input type="text" id="q" class="grow" placeholder="Rechercher (repère, nom, local…)" value="${esc(F.q)}" style="width:auto"><button class="btn primary" data-act="newUtility" aria-label="Nouvelle utilité">＋</button></div>
      <div class="chips">${[['', 'Toutes'], ...FAM_ORDER.map((f) => [f, FAMILIES[f].label])].map(([f, l]) => `<button class="chip ${F.fam === f ? 'on' : ''}" data-act="fam" data-fam="${f}">${l}</button>`).join('')}</div>
      <div id="ulist">${listItems()}</div>
    </section>
    <section class="detail" id="detail">${currentUid ? (checkMode ? checklistView(U(currentUid)) : fiche(U(currentUid))) : `<div class="card empty">Sélectionnez une utilité dans la liste, ou créez-en une.</div>`}</section>
  </div>
  ${currentUid ? '' : '<button class="fab" data-act="newUtility">＋ Utilité</button>'}`;
  $('#q').oninput = (e) => { F.q = e.target.value; $('#ulist').innerHTML = listItems(); };
  if (currentUid) { hydratePhotos(main); setHeader(utilityLabel(U(currentUid)) + (checkMode ? ' · Checklist' : ''), checkMode ? `#/a/${S.audit.id}/u/${currentUid}` : `#/a/${S.audit.id}/inv`); }
  else setHeader(S.audit.name, '#/');
}

const specFieldsOf = (u) => {
  const k = kindById(u.kind), keys = new Set(k.fields.map((f) => f.k));
  const extras = Object.keys(u.specs || {}).filter((x) => !keys.has(x)).map((x) => ({ k: x, label: x, unit: '', extra: true }));
  return [...k.fields, ...extras];
};

const carrierOpts = (sel) => Object.entries(CARRIERS).map(([k, c]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${c.label}</option>`).join('');

function linksBlock(u, dir) {
  const rows = S.links.filter((l) => (dir === 'in' ? l.toId === u.id : l.fromId === u.id));
  return rows.length ? rows.map((l) => { const o = U(dir === 'in' ? l.fromId : l.toId); if (!o) return ''; const c = CARRIERS[l.carrier] || CARRIERS.autre;
    return `<div class="link-row"><span class="vec" style="background:${c.color}"></span><span class="grow"><a href="#/a/${S.audit.id}/u/${o.id}"><b>${esc(o.tag)}</b> ${esc(o.name || kindById(o.kind).label)}</a><br><span class="muted small">${c.label}${l.comment ? ' · ' + esc(l.comment) : ''}</span></span>
    <button class="btn small danger" data-act="delLink" data-id="${l.id}" aria-label="Supprimer le lien">✕</button></div>`; }).join('') : '<div class="muted small">Aucun lien renseigné.</div>';
}

function noteHtml(n) {
  const u = n.utilityId ? U(n.utilityId) : null, c = NOTE_CATS[n.category] || NOTE_CATS.observation;
  return `<div class="note" style="--nc:${c.color}"><div class="meta"><span class="cat">${esc(c.label)}</span><span>${fmtDate(n.createdAt)}</span>${u ? `<a href="#/a/${S.audit.id}/u/${u.id}"><span class="tag ${u.family}">${esc(u.tag)}</span> ${esc(u.name || '')}</a>` : '<span>· Général</span>'}<span class="grow"></span>
    <button class="btn small" data-act="editNote" data-id="${n.id}" aria-label="Modifier">✎</button><button class="btn small danger" data-act="delNote" data-id="${n.id}" aria-label="Supprimer">✕</button></div>${esc(n.text)}</div>`;
}

const catOpts = (sel = 'observation') => Object.entries(NOTE_CATS).map(([k, c]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${c.label}</option>`).join('');
const composer = (utilityId, placeholder) => `<label class="field"><span>Catégorie</span><select id="newNoteCat">${catOpts()}</select></label>
  <textarea id="newNote" placeholder="${placeholder}"></textarea>
  <button class="btn primary block" style="margin-top:8px" data-act="addNote" data-uid="${utilityId || ''}">Ajouter le commentaire</button>`;

function photosBlock(utilityId) {
  const ps = S.photos.filter((p) => (p.utilityId || null) === (utilityId || null));
  return `<div class="row"><label class="btn primary grow">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" hidden data-photo data-uid="${utilityId || ''}"></label>
    <label class="btn grow">🖼 Depuis la galerie<input type="file" accept="image/*" multiple hidden data-photo data-uid="${utilityId || ''}"></label></div>
    <div class="gallery">${ps.map((p) => `<div class="thumb" data-act="openPhoto" data-id="${p.id}"><img alt="" data-pid="${p.id}">${p.caption ? `<div class="cap">${esc(p.caption)}</div>` : ''}</div>`).join('')}</div>
    ${ps.length ? '' : '<div class="muted small" style="margin-top:8px">Aucune photo.</div>'}`;
}

// Incertitude d'une valeur chiffrée (défaut 0) : % de la valeur, ou absolue pour °C / K / % (en points)
const uncBox = (attr, unit, val) => `<span class="unc ${Number(val) ? 'set' : ''}" title="Incertitude (${uncSuffix(unit) === '%' ? 'en % de la valeur' : 'absolue, en ' + uncSuffix(unit)})"><b>±</b><input type="number" step="any" min="0" inputmode="decimal" ${attr} value="${esc(val ?? 0)}" aria-label="Incertitude"><i>${esc(uncSuffix(unit))}</i></span>`;
const subTabs = (u, on) => {
  const pg = progress(CB, u);
  return `<div class="subtabs"><a href="#/a/${S.audit.id}/u/${u.id}" class="${on === 'fiche' ? 'on' : ''}">Fiche</a><a href="#/a/${S.audit.id}/u/${u.id}/check" class="${on === 'check' ? 'on' : ''}" id="ckTab">☑ Checklist <b class="pg">${pg.done}/${pg.total}</b></a></div>`;
};

function fiche(u) {
  const k = kindById(u.kind), fam = FAMILIES[u.family];
  const input = (f, label, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} data-f="${f}" value="${esc(u[f] ?? '')}" ${extra}></label>`;
  const numU = (f, label, unit, after = '') => `<label class="field"><span>${label}</span><div class="vu"><input type="number" step="any" inputmode="decimal" data-f="${f}" value="${esc(u[f] ?? '')}">${uncBox(`data-unc="${f}"`, unit, u.unc?.[f])}${after}</div></label>`;
  const basisOk = u.hoursBasis && hoursFromBasis(u.hoursBasis) === u.hours;
  return `<div data-uid="${u.id}">
    <a class="back-link mobile-only" href="#/a/${S.audit.id}/inv">← Inventaire</a>
    ${subTabs(u, 'fiche')}
    <div class="card"><h2><span class="tag ${u.family}">${esc(u.tag)}</span> ${esc(fam.long)}</h2>
      <div class="grid2">${input('tag', 'Repère')}<label class="field"><span>Statut</span><select data-f="status">${STATUSES.map((s) => `<option ${s === u.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <label class="field"><span>Type</span><select data-f="kind">${kindsOf(u.family).map((x) => `<option value="${x.id}" ${x.id === u.kind ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      ${input('name', 'Désignation (ex. Chaudière n°1 – Viessmann Vitomax)')}
      ${input('location', 'Localisation (bâtiment / local)')}</div>

    <div class="card"><h2>Énergie et exploitation</h2>
      <div class="grid2"><label class="field"><span>Vecteur entrant</span><select data-f="carrierIn">${carrierOpts(u.carrierIn)}</select></label>
      ${u.family === 'consommation' ? '' : `<label class="field"><span>Vecteur sortant</span><select data-f="carrierOut">${carrierOpts(u.carrierOut)}</select></label>`}</div>
      <div class="grid2 stack">${numU('powerKw', 'Puissance <i>(kW)</i>', 'kW')}${numU('hours', 'Temps de fonctionnement <i>(h/an)</i>', 'h/an', '<button class="btn icon-btn" data-act="hoursCalc" title="Calculer à partir du régime" aria-label="Calculer les heures">⏱</button>')}</div>
      ${basisOk ? `<div class="small muted" style="margin:-4px 0 10px">Base : ${esc(basisText(u.hoursBasis))}</div>` : ''}
      <div class="grid3">${input('year', 'Année', 'number')}${input('brand', 'Marque')}${input('model', 'Modèle')}</div>
      ${input('metering', 'Comptage / mesure existante')}
      <div class="small muted">± : incertitude de la valeur (0 par défaut), en % sauf températures (°C) et pourcentages (points).</div></div>

    <div class="card"><h2>Caractéristiques — ${esc(k.label)}</h2>
      <div class="grid2">${specFieldsOf(u).map((f) => `<label class="field"><span>${esc(f.label)}${f.unit ? ` <i>(${esc(f.unit)})</i>` : ''}</span>${f.num
        ? `<div class="vu"><input type="text" inputmode="decimal" data-spec="${esc(f.k)}" value="${esc(u.specs?.[f.k] ?? '')}">${uncBox(`data-unc="s:${esc(f.k)}"`, f.unit, u.unc?.['s:' + f.k])}</div>`
        : `<input type="text" data-spec="${esc(f.k)}" value="${esc(u.specs?.[f.k] ?? '')}">`}</label>`).join('')}</div>
      <button class="btn small" data-act="addSpec">＋ Champ libre</button></div>

    <div class="card"><h2>Liens (alimentations)</h2>
      <div class="small" style="font-weight:600;margin-bottom:2px">Alimenté par</div>${linksBlock(u, 'in')}
      <div class="small" style="font-weight:600;margin:12px 0 2px">Alimente</div>${linksBlock(u, 'out')}
      <button class="btn" style="margin-top:10px" data-act="addLink">⛓ Ajouter un lien</button></div>

    <div class="card"><h2>Photos</h2><div id="photos">${photosBlock(u.id)}</div></div>

    <div class="card" id="comments"><h2>Commentaires (${S.notes.filter((n) => n.utilityId === u.id).length})</h2>
      ${composer(u.id, 'Observation, mesure, anomalie, piste d’économie…')}
      <div id="notes">${S.notes.filter((n) => n.utilityId === u.id).map(noteHtml).join('')}</div></div>

    <button class="btn danger block" data-act="delUtility">Supprimer cette utilité</button></div>`;
}

// ------------------------------------------------------------------ checklist d'une utilité
let ckFilter = 'all';
function ckInput(it, a) {
  const v = a?.v;
  if (it.type === 'check') return `<label class="ck-check"><input type="checkbox" data-ckf="v" ${v === true ? 'checked' : ''}> Vérifié</label>`;
  if (it.type === 'oui_non' || it.type === 'choix') return `<div class="chips">${(it.type === 'oui_non' ? YES_NO : it.opts || []).map((o) => `<button class="chip ${v === o ? 'on' : ''}" data-act="ckSet" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  if (it.type === 'nombre') return `<div class="vu"><input type="text" inputmode="decimal" data-ckf="v" value="${esc(v ?? '')}" placeholder="Valeur">${it.unit ? `<span class="unit">${esc(it.unit)}</span>` : ''}${uncBox('data-ckf="unc"', it.unit, a?.unc)}</div>`;
  return `<input type="text" data-ckf="v" value="${esc(v ?? '')}" placeholder="Réponse">`;
}
function ckItem(it, u) {
  const a = u.checks?.[it.id];
  return `<div class="ck ${isAnswered(it, a) ? 'done' : ''}" data-ck="${esc(it.id)}">
    <div class="ck-q">${esc(it.q)}</div>${it.why ? `<div class="ck-why">${esc(it.why)}</div>` : ''}
    ${ckInput(it, a)}
    <input type="text" class="ck-note" data-ckf="note" value="${esc(a?.note ?? '')}" placeholder="Remarque (facultatif)"></div>`;
}
function checklistView(u) {
  const items = itemsFor(CB, u), pg = progress(CB, u);
  const show = (it) => ckFilter === 'all' || !isAnswered(it, u.checks?.[it.id]);
  const spec = items.filter((i) => i.kind !== '*' && show(i)), common = items.filter((i) => i.kind === '*' && show(i));
  return `<div data-uid="${u.id}">
    <a class="back-link mobile-only" href="#/a/${S.audit.id}/inv">← Inventaire</a>
    ${subTabs(u, 'check')}
    <div class="card"><h2>Points à vérifier — ${esc(kindById(u.kind).label)}</h2>
      <div class="small"><span id="ckCount">${pg.done}/${pg.total}</span> points renseignés</div><div class="bar"><i id="ckBar" style="width:${pg.total ? Math.round((100 * pg.done) / pg.total) : 0}%"></i></div>
      <div class="row" style="margin-top:10px"><div class="chips" style="margin:0"><button class="chip ${ckFilter === 'all' ? 'on' : ''}" data-act="ckFilter" data-v="all">Tous</button><button class="chip ${ckFilter === 'todo' ? 'on' : ''}" data-act="ckFilter" data-v="todo">À renseigner</button></div>
      <span class="grow"></span><button class="btn small" data-act="openBase" data-kind="${u.kind}">⚙ Modifier la base</button></div></div>
    ${spec.length ? `<h3 class="ck-h">Spécifique à ce type d’utilité</h3>${spec.map((i) => ckItem(i, u)).join('')}` : ''}
    ${common.length ? `<h3 class="ck-h">Points communs à toutes les utilités</h3>${common.map((i) => ckItem(i, u)).join('')}` : ''}
    ${!spec.length && !common.length ? `<div class="card empty">${ckFilter === 'todo' ? 'Tous les points sont renseignés.' : 'Aucun point dans la base pour ce type : ajoutez-en via « Modifier la base ».'}</div>` : ''}
  </div>`;
}
async function saveCheck(u, itemId, field, value) {
  const it = CB.find((x) => x.id === itemId); if (!it) return;
  const cur = { ...(u.checks?.[itemId] || {}) };
  if (value === '' || value === null || value === undefined || value === false || (field === 'unc' && !Number(value))) delete cur[field]; else cur[field] = value;
  const checks = { ...(u.checks || {}) };
  if (cur.v === undefined && !cur.note && !cur.unc) delete checks[itemId];
  else checks[itemId] = { ...cur, q: it.q, unit: it.unit || '', at: Date.now() };
  u.checks = checks; await save('utilities', u);
  const box = $(`.ck[data-ck="${CSS.escape(itemId)}"]`); box?.classList.toggle('done', isAnswered(it, checks[itemId]));
  const pg = progress(CB, u);
  if ($('#ckCount')) { $('#ckCount').textContent = `${pg.done}/${pg.total}`; $('#ckBar').style.width = `${pg.total ? Math.round((100 * pg.done) / pg.total) : 0}%`; }
  if ($('#ckTab .pg')) $('#ckTab .pg').textContent = `${pg.done}/${pg.total}`;
  if ($('#ulist')) $('#ulist').innerHTML = listItems();
}

// ------------------------------------------------------------------ base des checklists (éditeur)
let baseKind = null, baseBack = '#/';
function viewBase() {
  setHeader('Base de checklists', baseBack);
  if (!baseKind) baseKind = KINDS[0].id;
  const live = CB.filter((x) => !x.deleted);
  const count = (k) => live.filter((x) => x.kind === k).length;
  const items = live.filter((x) => x.kind === baseKind).sort((a, b) => (a.order || 0) - (b.order || 0));
  const opt = (k, l) => `<option value="${k}" ${k === baseKind ? 'selected' : ''}>${esc(l)} (${count(k)})</option>`;
  main.innerHTML = `<div class="base-wrap">
    <div class="card"><h2>Points de contrôle par type d’utilité</h2>
      <p class="small muted">Cette base alimente l’onglet « Checklist » de chaque utilité. Vos modifications sont enregistrées sur cet appareil et synchronisées avec votre SharePoint (fichier <code>AuditEnergie/checklists.json</code>). Pour une mise à jour en masse : exportez en CSV, modifiez dans Excel, enregistrez au format <b>« CSV UTF-8 »</b>, puis réimportez (gardez la colonne <code>id</code> pour que les réponses existantes restent liées).</p>
      <label class="field"><span>Type d’utilité</span><select id="baseKind">${opt('*', 'Toutes les utilités (points communs)')}${FAM_ORDER.map((f) => `<optgroup label="${FAMILIES[f].long}">${kindsOf(f).map((k) => opt(k.id, k.label)).join('')}</optgroup>`).join('')}</select></label>
      <div class="row"><button class="btn primary" data-act="baseAdd">＋ Ajouter un point</button><span class="grow"></span>
        <button class="btn" data-act="baseExport">⇩ Exporter (CSV)</button><label class="btn">⇧ Importer (CSV)<input type="file" accept=".csv,text/csv" hidden data-baseimport></label><button class="btn danger" data-act="baseReset">↺ Base par défaut</button></div></div>
    <div class="card"><h2>${esc(targetLabel(baseKind))} — ${items.length} point(s)</h2>
      ${items.length ? items.map((x, i) => `<div class="base-item"><div class="ord"><button class="btn small" data-act="baseMove" data-id="${esc(x.id)}" data-d="-1" ${i ? '' : 'disabled'} aria-label="Monter">↑</button><button class="btn small" data-act="baseMove" data-id="${esc(x.id)}" data-d="1" ${i < items.length - 1 ? '' : 'disabled'} aria-label="Descendre">↓</button></div>
        <div class="grow"><b>${esc(x.q)}</b><div class="small muted">${esc(ANSWER_TYPES[x.type] || x.type)}${x.type === 'choix' ? ' : ' + esc((x.opts || []).join(' / ')) : ''}${x.unit ? ' · ' + esc(x.unit) : ''}${x.updatedAt ? ' · <span class="badge">modifié</span>' : ''}</div>${x.why ? `<div class="small muted">${esc(x.why)}</div>` : ''}</div>
        <button class="btn small" data-act="baseEdit" data-id="${esc(x.id)}" aria-label="Modifier">✎</button><button class="btn small danger" data-act="baseDel" data-id="${esc(x.id)}" aria-label="Supprimer">✕</button></div>`).join('') : '<div class="muted small">Aucun point pour ce type.</div>'}</div></div>`;
  $('#baseKind').onchange = (e) => { baseKind = e.target.value; viewBase(); };
}
function baseItemDialog(item, isNew) {
  const kindOpts = `<option value="*" ${item.kind === '*' ? 'selected' : ''}>Toutes les utilités</option>` + FAM_ORDER.map((f) => `<optgroup label="${FAMILIES[f].long}">${kindsOf(f).map((k) => `<option value="${k.id}" ${k.id === item.kind ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</optgroup>`).join('');
  dialog(`<h2>${isNew ? 'Nouveau point de contrôle' : 'Modifier le point'}</h2>
    <label class="field"><span>Question / élément à vérifier</span><textarea id="bq" style="min-height:70px">${esc(item.q)}</textarea></label>
    <div class="grid2"><label class="field"><span>Type de réponse</span><select id="bt">${Object.entries(ANSWER_TYPES).map(([k, l]) => `<option value="${k}" ${k === item.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Type d’utilité</span><select id="bk">${kindOpts}</select></label></div>
    <label class="field" id="boW"><span>Choix proposés (un par ligne)</span><textarea id="bo">${esc((item.opts || []).join('\n'))}</textarea></label>
    <label class="field" id="buW"><span>Unité</span><input type="text" id="bu" value="${esc(item.unit || '')}" placeholder="Ex. bar, °C, kW, %"></label>
    <label class="field"><span>Intérêt énergétique (pourquoi le vérifier)</span><textarea id="bw" style="min-height:70px">${esc(item.why || '')}</textarea></label>
    <div class="row end"><button class="btn" data-close>Annuler</button><button class="btn primary" id="bok">Enregistrer</button></div>`, (d) => {
    const vis = () => { const t = $('#bt', d).value; $('#boW', d).hidden = t !== 'choix'; $('#buW', d).hidden = t !== 'nombre'; };
    $('#bt', d).onchange = vis; vis();
    $('#bok', d).onclick = async () => {
      const q = $('#bq', d).value.trim(); if (!q) return $('#bq', d).focus();
      const t = $('#bt', d).value, opts = $('#bo', d).value.split(/\n/).map((x) => x.trim()).filter(Boolean);
      if (t === 'choix' && opts.length < 2) return toast('Indiquez au moins deux choix.');
      const kind = $('#bk', d).value;
      await saveBaseOverrides([editItem(item, { q, type: t, kind, opts: t === 'choix' ? opts : [], unit: t === 'nombre' ? $('#bu', d).value.trim() : '', why: $('#bw', d).value.trim() }, deviceId)]);
      baseKind = kind; d.close(); toast(isNew ? 'Point ajouté à la base' : 'Point modifié'); viewBase();
    };
  });
}
function hoursDialog(u) {
  const b = u.hoursBasis || { hpd: 24, dpw: 7, wpy: 52, note: '' };
  const presets = [['24 h/24, 7 j/7, toute l’année', 24, 7, 52], ['3×8, 5 j/7', 24, 5, 47], ['2×8, 5 j/7', 16, 5, 47], ['Journée, 5 j/7', 8, 5, 47], ['Campagne 3×8, 7 j/7, 24 semaines', 24, 7, 24]];
  dialog(`<h2>Temps de fonctionnement — ${esc(u.tag)}</h2>
    <div class="chips">${presets.map((p, i) => `<button class="chip" data-p="${i}">${esc(p[0])}</button>`).join('')}</div>
    <div class="grid3"><label class="field"><span>Heures / jour</span><input type="number" step="any" inputmode="decimal" id="hh" value="${b.hpd}"></label>
    <label class="field"><span>Jours / semaine</span><input type="number" step="any" inputmode="decimal" id="hd" value="${b.dpw}"></label>
    <label class="field"><span>Semaines / an</span><input type="number" step="any" inputmode="decimal" id="hw" value="${b.wpy}"></label></div>
    <label class="field"><span>Précision (facultatif)</span><input type="text" id="hn" value="${esc(b.note || '')}" placeholder="Ex. campagne juillet–décembre, arrêt dimanche"></label>
    <div class="hint">Résultat : <b id="hr">—</b> h/an</div>
    <div class="row end" style="margin-top:10px"><button class="btn" data-close>Annuler</button><button class="btn primary" id="hok">Appliquer</button></div>`, (d) => {
    const val = () => ({ hpd: num($('#hh', d).value), dpw: num($('#hd', d).value), wpy: num($('#hw', d).value), note: $('#hn', d).value.trim() });
    const upd = () => { const h = hoursFromBasis(val()); $('#hr', d).textContent = h ? h.toLocaleString('fr-FR') : '—'; };
    d.querySelectorAll('[data-p]').forEach((c) => { c.onclick = () => { const p = presets[c.dataset.p]; $('#hh', d).value = p[1]; $('#hd', d).value = p[2]; $('#hw', d).value = p[3]; upd(); }; });
    ['#hh', '#hd', '#hw'].forEach((x) => { $(x, d).oninput = upd; }); upd();
    $('#hok', d).onclick = async () => {
      const v = val(), h = hoursFromBasis(v); if (!h || h > 8784) return toast('Valeurs incohérentes (maximum 8 784 h/an).');
      u.hoursBasis = v; u.hours = h; await save('utilities', u); d.close(); viewInv(u.id);
    };
  });
}

async function hydratePhotos(root) {
  for (const img of $$('img[data-pid]', root)) {
    const p = S.photos.find((x) => x.id === img.dataset.pid); if (!p) continue;
    const u = await photoUrl(p);
    if (u) img.src = u; else img.closest('.thumb')?.classList.add('missing');
  }
}

// Édition en place des champs de la fiche (enregistrement automatique)
async function onField(e) {
  const el = e.target, wrap = el.closest('[data-uid]');
  if (!wrap) return;
  if (el.dataset.ckf) {
    const u = U(wrap.dataset.uid), box = el.closest('.ck'); if (!u || !box) return;
    const v = el.type === 'checkbox' ? el.checked : el.dataset.ckf === 'unc' ? num(el.value) : el.value.trim();
    if (el.dataset.ckf === 'unc') el.closest('.unc')?.classList.toggle('set', !!v);
    return saveCheck(u, box.dataset.ck, el.dataset.ckf, v);
  }
  if (el.dataset.unc !== undefined) {
    const u = U(wrap.dataset.uid); if (!u) return;
    const v = num(el.value) ?? 0, key = el.dataset.unc;
    if ((u.unc?.[key] ?? 0) === v) return;
    if (v < 0) { el.value = 0; return toast('L’incertitude doit être positive.'); }
    u.unc = { ...(u.unc || {}) }; if (v) u.unc[key] = v; else delete u.unc[key];
    el.closest('.unc')?.classList.toggle('set', !!v);
    return save('utilities', u);
  }
  if (!(el.dataset.f || el.dataset.spec)) return;
  const u = U(wrap.dataset.uid); if (!u) return;
  if (el.dataset.spec !== undefined) {
    const v = el.value.trim(); if ((u.specs[el.dataset.spec] ?? '') === v) return;
    u.specs = { ...u.specs }; if (v) u.specs[el.dataset.spec] = v; else delete u.specs[el.dataset.spec];
  } else {
    const f = el.dataset.f, v = el.type === 'number' ? num(el.value) : el.value.trim();
    if ((u[f] ?? (el.type === 'number' ? null : '')) === v) return;
    if (f === 'kind') { const o = kindById(u.kind), n = kindById(v); if (u.carrierIn === o.in) u.carrierIn = n.in; if (u.carrierOut === o.out) u.carrierOut = n.out; }
    u[f] = v;
    if (f === 'kind') { await save('utilities', u); return viewInv(u.id); }
  }
  await save('utilities', u);
  if ($('#ulist')) $('#ulist').innerHTML = listItems();
  if (el.dataset.f === 'tag' || el.dataset.f === 'name') setHeader(utilityLabel(u), `#/a/${S.audit.id}/inv`);
}

// ------------------------------------------------------------------ vue : synoptique
function viewSyn() {
  setHeader('Synoptique', '#/');
  main.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted small grow">${S.utilities.length} utilités · ${S.links.length} liens. Touchez une utilité pour ouvrir sa fiche.</span>
    <button class="btn small" data-act="zoom" data-d="-0.15">−</button><button class="btn small" data-act="zoom" data-d="0.15">＋</button><button class="btn small" data-act="zoom" data-d="fit">Ajuster</button><button class="btn small" data-act="exportSvg">SVG</button></div>
    <div class="syn-wrap" id="syn">${S.utilities.length ? '' : '<div class="empty">Ajoutez des utilités et des liens pour construire le synoptique.</div>'}</div>`;
  if (!S.utilities.length) return;
  const wrap = $('#syn'); wrap.innerHTML = renderSynoptic(S.utilities, S.links);
  const svg = $('svg', wrap), w = Number(svg.getAttribute('width'));
  const fit = Math.min(1, (wrap.clientWidth - 4) / w);
  zoom = innerWidth < 900 ? 0.8 : fit; applyZoom();
  wrap.onclick = (e) => { const n = e.target.closest('.node'); if (n) location.hash = `#/a/${S.audit.id}/u/${n.dataset.uid}`; };
}
function applyZoom() { const svg = $('#syn svg'); if (!svg) return; svg.style.width = Number(svg.getAttribute('width')) * zoom + 'px'; svg.style.height = Number(svg.getAttribute('height')) * zoom + 'px'; }

// ------------------------------------------------------------------ vue : commentaires (onglet)
function viewComments() {
  setHeader('Commentaires', '#/');
  const counts = Object.fromEntries(Object.keys(NOTE_CATS).map((k) => [k, S.notes.filter((n) => (n.category || 'observation') === k).length]));
  const shown = S.notes.filter((n) => !F.cat || (n.category || 'observation') === F.cat);
  const uopts = '<option value="">Commentaire général de l’audit</option>' + FAM_ORDER.map((f) => `<optgroup label="${FAMILIES[f].long}">${S.utilities.filter((u) => u.family === f).map((u) => `<option value="${u.id}">${esc(utilityLabel(u))}</option>`).join('')}</optgroup>`).join('');
  main.innerHTML = `<div class="grid-pc2"><div class="card"><h2>Nouveau commentaire</h2>
      <label class="field"><span>Concerne</span><select id="newNoteU">${uopts}</select></label>${composer('', 'Contexte, conditions de visite, anomalie, piste d’économie, mesure à prévoir, donnée à demander…')}
      <p class="small muted" style="margin:8px 0 0">Les catégories servent à préparer le rapport : <b>anomalies</b> (constats), <b>pistes d’économie</b> (futures AAPE), <b>mesures à prévoir</b> (plan de mesurage), <b>données à demander</b> au client.</p></div>
    <div class="card"><h2>Tous les commentaires (${S.notes.length})</h2>
      <div class="chips"><button class="chip ${F.cat ? '' : 'on'}" data-act="cat" data-cat="">Tous<span class="n">${S.notes.length}</span></button>${Object.entries(NOTE_CATS).map(([k, c]) => `<button class="chip ${F.cat === k ? 'on' : ''}" data-act="cat" data-cat="${k}">${c.label}<span class="n">${counts[k]}</span></button>`).join('')}</div>
      <div id="notes">${shown.length ? shown.map(noteHtml).join('') : '<div class="muted small">Aucun commentaire dans cette catégorie.</div>'}</div></div></div>`;
}

// ------------------------------------------------------------------ vue : export
function viewExport() {
  setHeader('Export', '#/');
  const live = { u: S.utilities.length, l: S.links.length, n: S.notes.length, p: S.photos.length };
  main.innerHTML = `<div class="grid-pc2"><div>
    <div class="card"><h2>Excel (.xlsx)</h2>
      <p class="small muted">Un classeur, une feuille par rubrique : <b>Synthèse</b>, <b>Utilités</b>, une feuille par type d’équipement (chaudières, pompes…), <b>Liens</b>, <b>Commentaires</b>, <b>Photos</b>, <b>Caractéristiques</b>. Valeurs numériques typées, filtres et en-têtes figés. Les photos restent dans l’export ZIP.</p>
      <button class="btn primary block" data-act="exportXlsx">⇩ Exporter le classeur Excel</button></div>
    <div class="card"><h2>CSV pour Excel</h2>
      <p class="small muted">ZIP contenant <code>audit.csv</code>, <code>utilites.csv</code>, <code>caracteristiques.csv</code>, <code>liens.csv</code>, <code>notes.csv</code>, <code>photos.csv</code> (séparateur « ; », accents et virgules décimales compatibles Excel France) et, au choix, les photos renommées par repère.</p>
      <label class="row small" style="margin-bottom:10px"><input type="checkbox" id="withPhotos" checked> Inclure les photos (${live.p})</label>
      <button class="btn primary block" data-act="exportCsv">⇩ Exporter le CSV (ZIP)</button></div>
    <div class="card"><h2>Synoptique</h2><p class="small muted">Image vectorielle du synoptique, à insérer dans le rapport.</p><button class="btn block" data-act="exportSvg">⇩ Exporter le synoptique (SVG)</button></div></div><div>
    <div class="card"><h2>Sauvegarde complète</h2><p class="small muted">Toutes les données et les photos de l’audit dans un seul fichier, restaurable sur n’importe quel appareil.</p>
      <div class="row"><button class="btn block grow" data-act="exportBackup">⇩ Cet audit</button><button class="btn block grow" data-act="exportBackupAll">⇩ Tous les audits</button></div>
      <label class="btn block" style="margin-top:10px">⇧ Restaurer une sauvegarde<input type="file" accept=".zip" hidden data-import></label>
      <p class="small muted" style="margin-bottom:0">La restauration fusionne : les données plus récentes déjà présentes sont conservées.</p></div>
    <div class="card"><h2>Contenu de l’audit</h2><div class="small">${live.u} utilités · ${live.l} liens · ${live.n} commentaires · ${live.p} photos</div></div></div></div>`;
}

// ------------------------------------------------------------------ vue : informations de l’audit
function viewInfo() {
  setHeader('Audit — informations', '#/');
  const a = S.audit, inp = (f, l, t = 'text', extra = '') => `<label class="field"><span>${l}</span><input type="${t}" ${t === 'number' ? 'step="any" inputmode="decimal"' : ''} data-a="${f}" value="${esc(a[f] ?? '')}" ${extra}></label>`;
  const sel = (f, l, opts) => `<label class="field"><span>${l}</span><select data-a="${f}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${a[f] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  main.innerHTML = `<div class="grid-pc2"><div><div class="card" id="auditForm"><h2>Identification</h2>${inp('name', 'Nom de l’audit')}<div class="grid2">${inp('client', 'Client')}${inp('site', 'Site')}</div>${inp('address', 'Adresse')}
    <div class="grid2">${inp('auditor', 'Auditeur')}${inp('date', 'Date de visite', 'date')}</div>
    <div class="grid2">${sel('type', 'Périmètre', Object.entries(AUDIT_TYPES))}${inp('norm', 'Référentiel')}</div></div>
    <div class="card" id="auditForm2"><h2>Contexte du site (zone tropicale)</h2>
      <div class="grid2">${sel('territory', 'Territoire', TERRITORIES.map((t) => [t, t]))}${sel('grid', 'Réseau / fournisseur d’électricité', GRIDS.map((t) => [t, t]))}</div>
      ${inp('activity', 'Activité (ex. distillerie, sucrerie, agroalimentaire, carrière…)')}
      <div class="grid2">${inp('tAmb', 'T° ambiante moyenne <i>(°C)</i>', 'number')}${inp('rh', 'Humidité relative moyenne <i>(%)</i>', 'number')}</div>
      ${inp('seasonality', 'Saisonnalité / campagne (ex. campagne juillet–décembre)')}</div></div>
    <div><div class="card"><h2>Photos générales du site</h2><div id="photos">${photosBlock(null)}</div></div>
    <button class="btn danger block" data-act="deleteAudit">Supprimer cet audit</button></div></div>`;
  hydratePhotos(main);
}
async function onAuditField(e) {
  const el = e.target; if (!el.dataset.a) return;
  const v = el.type === 'number' ? num(el.value) : el.value;
  if ((S.audit[el.dataset.a] ?? (el.type === 'number' ? null : '')) === v) return;
  S.audit[el.dataset.a] = v; await save('audits', S.audit);
  if (el.dataset.a === 'name') setHeader(S.audit.name, '#/');
}

// ------------------------------------------------------------------ photos
async function compress(file, max = 1600, quality = 0.82) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const w0 = bmp.width, h0 = bmp.height, r = Math.min(1, max / Math.max(w0, h0)), w = Math.round(w0 * r), h = Math.round(h0 * r);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  return { blob, width: w, height: h };
}

async function addPhotos(files, utilityId) {
  let n = 0;
  for (const f of files) {
    try {
      toast(`Enregistrement de la photo ${++n}/${files.length}…`, 8000);
      const { blob, width, height } = await compress(f);
      const p = newPhoto(deviceId, S.audit.id, utilityId, { width, height, size: blob.size, takenAt: f.lastModified || Date.now() });
      await store.putBlob(p.id, blob); await save('photos', p); S.photos.push(p);
    } catch (e) { toast('Photo illisible : ' + e.message); }
  }
  toast(`${n} photo(s) ajoutée(s)`);
  const box = $('#photos'); if (box) { box.innerHTML = photosBlock(utilityId); hydratePhotos(box); }
  if (!currentUid && location.hash.includes('/inv')) $('#ulist').innerHTML = listItems();
}

function openPhoto(id) {
  const p = S.photos.find((x) => x.id === id); if (!p) return;
  photoUrl(p).then((url) => {
    const opts = `<option value="">Photo générale du site</option>` + S.utilities.map((u) => `<option value="${u.id}" ${u.id === p.utilityId ? 'selected' : ''}>${esc(utilityLabel(u))}</option>`).join('');
    dialog(`${url ? `<img class="photo-big" src="${url}" alt="">` : '<div class="empty">Photo pas encore téléchargée depuis SharePoint — synchronisez.</div>'}
      <label class="field" style="margin-top:10px"><span>Légende</span><input type="text" id="pcap" value="${esc(p.caption)}" placeholder="Ex. plaque signalétique, fuite bride…"></label>
      <label class="field"><span>Associée à</span><select id="pu">${opts}</select></label>
      <div class="small muted">${fmtDate(p.takenAt)} · ${p.width}×${p.height} · ${Math.round((p.size || 0) / 1024)} Ko</div>
      <div class="row end" style="margin-top:12px"><button class="btn danger" id="pdel">Supprimer</button><button class="btn primary" data-close>Fermer</button></div>`, (d) => {
      const commit = async () => { const cap = $('#pcap', d).value.trim(), uidv = $('#pu', d).value || null; if (cap !== p.caption || uidv !== p.utilityId) { p.caption = cap; p.utilityId = uidv; await save('photos', p); } };
      d.addEventListener('close', async () => { await commit(); await refreshView(); }, { once: true });
      $('#pdel', d).onclick = async () => { d.close(); if (await confirmDlg('Supprimer cette photo ?')) { await tombstone('photos', p); await refreshView(); } };
    });
  });
}

// ------------------------------------------------------------------ actions
const refreshView = () => route({ keep: true });

const actions = {
  async newAudit() {
    dialog(`<h2>Nouvel audit</h2><label class="field"><span>Nom de l’audit</span><input type="text" id="an" placeholder="Ex. Audit site de Saint-Pierre 2026"></label>
      <div class="grid2"><label class="field"><span>Client</span><input type="text" id="ac"></label><label class="field"><span>Site</span><input type="text" id="as"></label></div>
      <div class="grid2"><label class="field"><span>Territoire</span><select id="aterr">${TERRITORIES.map((t) => `<option>${t}</option>`).join('')}</select></label><label class="field"><span>Activité</span><input type="text" id="aact" placeholder="Ex. distillerie"></label></div>
      <label class="field"><span>Périmètre</span><select id="at">${Object.entries(AUDIT_TYPES).map(([k, v]) => `<option value="${k}" ${k === 'industrie' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="row end"><button class="btn" data-close>Annuler</button><button class="btn primary" id="aok">Créer</button></div>`, (d) => {
      $('#aok', d).onclick = async () => {
        const a = newAudit(deviceId, { name: $('#an', d).value.trim() || 'Nouvel audit', client: $('#ac', d).value.trim(), site: $('#as', d).value.trim(), type: $('#at', d).value, territory: $('#aterr', d).value, activity: $('#aact', d).value.trim(),
          grid: { 'La Réunion': GRIDS[0], Mayotte: GRIDS[1], Madagascar: GRIDS[2], Maurice: GRIDS[3] }[$('#aterr', d).value] || GRIDS[5] });
        await save('audits', a); d.close(); location.hash = `#/a/${a.id}/inv`;
      };
    });
  },
  fam(t) { F.fam = t.dataset.fam; viewInv(currentUid); },
  newUtility() {
    let fam = F.fam || 'production';
    const draw = (d) => {
      d.querySelector('.dlg-body').innerHTML = `<h2>Nouvelle utilité</h2><div class="chips">${FAM_ORDER.map((f) => `<button class="chip ${f === fam ? 'on' : ''}" data-fam="${f}">${FAMILIES[f].label}</button>`).join('')}</div>
        <div class="kind-btns">${kindsOf(fam).map((k) => `<button class="btn" data-kind="${k.id}"><span class="tag ${fam}">${FAMILIES[fam].prefix}</span> ${esc(k.label)}</button>`).join('')}</div>
        <div class="row end"><button class="btn" data-close>Annuler</button></div>`;
    };
    const d = dialog('', (dl) => {
      draw(dl);
      dl.onclick = async (e) => {
        if (e.target === dl || e.target.closest('[data-close]')) return dl.close();
        const fb = e.target.closest('[data-fam]'), kb = e.target.closest('[data-kind]');
        if (fb) { fam = fb.dataset.fam; draw(dl); }
        if (kb) { const u = newUtility(deviceId, S.audit.id, kb.dataset.kind, S.utilities); await save('utilities', u); dl.onclick = null; dl.close(); location.hash = `#/a/${S.audit.id}/u/${u.id}`; setTimeout(() => $('[data-f=name]')?.focus(), 250); }
      };
    });
  },
  async delUtility() {
    const u = U(currentUid); const np = S.photos.filter((p) => p.utilityId === u.id).length;
    if (!(await confirmDlg(`Supprimer <b>${esc(utilityLabel(u))}</b>, ses liens, ses commentaires${np ? ` et ses ${np} photo(s)` : ''} ?`))) return;
    for (const l of S.links.filter((l) => l.fromId === u.id || l.toId === u.id)) await tombstone('links', l);
    for (const n of S.notes.filter((n) => n.utilityId === u.id)) await tombstone('notes', n);
    for (const p of S.photos.filter((p) => p.utilityId === u.id)) await tombstone('photos', p);
    await tombstone('utilities', u); location.hash = `#/a/${S.audit.id}/inv`;
  },
  addSpec() {
    dialog(`<h2>Champ libre</h2><label class="field"><span>Libellé (ex. « Volume du ballon (L) »)</span><input type="text" id="sl"></label><div class="row end"><button class="btn" data-close>Annuler</button><button class="btn primary" id="sok">Ajouter</button></div>`, (d) => {
      $('#sok', d).onclick = async () => { const l = $('#sl', d).value.trim(); if (!l) return; const u = U(currentUid); u.specs = { ...u.specs, [l]: ' ' }; await save('utilities', u); d.close(); viewInv(u.id); setTimeout(() => $(`[data-spec="${CSS.escape(l)}"]`)?.focus(), 200); };
    });
  },
  addLink() {
    const u = U(currentUid), others = S.utilities.filter((x) => x.id !== u.id);
    if (!others.length) return toast('Créez d’abord une autre utilité à relier.');
    const opts = FAM_ORDER.map((f) => `<optgroup label="${FAMILIES[f].long}">${others.filter((o) => o.family === f).map((o) => `<option value="${o.id}">${esc(utilityLabel(o))}</option>`).join('')}</optgroup>`).join('');
    dialog(`<h2>Ajouter un lien — ${esc(u.tag)}</h2>
      <label class="field"><span>Sens</span><select id="ld"><option value="in">${esc(u.tag)} est alimenté par…</option><option value="out">${esc(u.tag)} alimente…</option></select></label>
      <label class="field"><span>Utilité</span><select id="lo">${opts}</select></label>
      <label class="field"><span>Vecteur énergétique</span><select id="lc"></select></label>
      <label class="field"><span>Commentaire (facultatif)</span><input type="text" id="lm" placeholder="Ex. DN100, 8 bar"></label>
      <div class="row end"><button class="btn" data-close>Annuler</button><button class="btn primary" id="lok">Ajouter</button></div>`, (d) => {
      const refresh = () => { const o = U($('#lo', d).value), src = $('#ld', d).value === 'in' ? o : u; const def = src.carrierOut || src.carrierIn || 'autre'; $('#lc', d).innerHTML = carrierOpts(def); };
      $('#lo', d).onchange = refresh; $('#ld', d).onchange = refresh; refresh();
      $('#lok', d).onclick = async () => {
        const o = $('#lo', d).value, inbound = $('#ld', d).value === 'in', c = $('#lc', d).value;
        const [from, to] = inbound ? [o, u.id] : [u.id, o];
        if (S.links.some((l) => l.fromId === from && l.toId === to && l.carrier === c)) return toast('Ce lien existe déjà.');
        await save('links', newLink(deviceId, S.audit.id, from, to, c, $('#lm', d).value.trim())); d.close(); viewInv(u.id);
      };
    });
  },
  async delLink(t) { const l = S.links.find((x) => x.id === t.dataset.id); if (l) { await tombstone('links', l); viewInv(currentUid); } },
  async addNote(t) {
    const ta = $('#newNote'), text = ta.value.trim(); if (!text) return ta.focus();
    const target = t.dataset.uid || $('#newNoteU')?.value || null;
    await save('notes', newNote(deviceId, S.audit.id, target, text, $('#newNoteCat').value)); toast('Commentaire ajouté'); await refreshView();
  },
  cat(t) { F.cat = t.dataset.cat; viewComments(); },
  editNote(t) {
    const n = S.notes.find((x) => x.id === t.dataset.id);
    dialog(`<h2>Modifier le commentaire</h2><label class="field"><span>Catégorie</span><select id="nc">${catOpts(n.category || 'observation')}</select></label><textarea id="nt" style="min-height:160px">${esc(n.text)}</textarea><div class="row end" style="margin-top:10px"><button class="btn" data-close>Annuler</button><button class="btn primary" id="nok">Enregistrer</button></div>`, (d) => {
      $('#nok', d).onclick = async () => { const v = $('#nt', d).value.trim(); if (v) { n.text = v; n.category = $('#nc', d).value; await save('notes', n); } d.close(); refreshView(); };
    });
  },
  async delNote(t) { const n = S.notes.find((x) => x.id === t.dataset.id); if (n && await confirmDlg('Supprimer ce commentaire ?')) { await tombstone('notes', n); refreshView(); } },
  openPhoto(t) { openPhoto(t.dataset.id); },
  zoom(t) { zoom = t.dataset.d === 'fit' ? Math.min(1, ($('#syn').clientWidth - 4) / Number($('#syn svg').getAttribute('width'))) : Math.min(2.5, Math.max(0.25, zoom + Number(t.dataset.d))); applyZoom(); },
  exportSvg() {
    download(new Blob([renderSynoptic(S.utilities, S.links)], { type: 'image/svg+xml' }), `${S.audit.name.replace(/[^\w-]+/g, '_')}_synoptique.svg`);
  },
  async exportXlsx() {
    toast('Préparation du classeur…', 20000);
    const { blob, name } = await exportXlsx(store, S.audit.id);
    download(blob, name); toast('Export prêt : ' + name);
  },
  async exportCsv() {
    toast('Préparation de l’export…', 20000);
    const { blob, name } = await exportCsvZip(store, S.audit.id, { withPhotos: $('#withPhotos')?.checked !== false });
    download(blob, name); toast('Export prêt : ' + name);
  },
  async exportBackup() { toast('Préparation de la sauvegarde…', 20000); const { blob, name } = await exportBackupZip(store, [S.audit.id]); download(blob, name); toast('Sauvegarde prête'); },
  async exportBackupAll() { toast('Préparation de la sauvegarde…', 20000); const ids = (await store.all('audits')).filter((a) => !a.deleted).map((a) => a.id); const { blob, name } = await exportBackupZip(store, ids); download(blob, name); toast('Sauvegarde prête'); },
  async deleteAudit() {
    if (!(await confirmDlg(`Supprimer l’audit <b>${esc(S.audit.name)}</b> et toutes ses données ? (Il sera aussi marqué supprimé sur SharePoint à la prochaine synchro.)`))) return;
    await tombstone('audits', S.audit); location.hash = '#/';
  },
  hoursCalc(t, e) { e.preventDefault(); hoursDialog(U(currentUid)); },
  async ckSet(t) {
    const u = U(currentUid), box = t.closest('.ck'); if (!u || !box) return;
    const on = t.classList.contains('on');
    box.querySelectorAll('[data-act=ckSet]').forEach((c) => c.classList.remove('on'));
    if (!on) t.classList.add('on');
    await saveCheck(u, box.dataset.ck, 'v', on ? '' : t.dataset.v);
  },
  ckFilter(t) { ckFilter = t.dataset.v; viewInv(currentUid, true); },
  openBase(t) { baseBack = location.hash || '#/'; if (t?.dataset?.kind) baseKind = t.dataset.kind; location.hash = '#/base'; },
  baseAdd() { baseItemDialog(newItem(baseKind, deviceId, CB), true); },
  baseEdit(t) { baseItemDialog(CB.find((x) => x.id === t.dataset.id), false); },
  async baseDel(t) {
    const it = CB.find((x) => x.id === t.dataset.id);
    if (!(await confirmDlg(`Retirer de la base le point « ${esc(it.q)} » ? Les réponses déjà saisies restent dans les audits et les exports.`, 'Retirer'))) return;
    await saveBaseOverrides([editItem(it, { deleted: true }, deviceId)]); viewBase();
  },
  async baseMove(t) {
    const items = CB.filter((x) => !x.deleted && x.kind === baseKind).sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = items.findIndex((x) => x.id === t.dataset.id), j = i + Number(t.dataset.d); if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    await saveBaseOverrides(items.map((x, k) => ((x.order || 0) === (k + 1) * 10 ? null : editItem(x, { order: (k + 1) * 10 }, deviceId))).filter(Boolean)); viewBase();
  },
  baseExport() { download(new Blob([baseToCsv(CB)], { type: 'text/csv;charset=utf-8' }), `base_checklists_${new Date().toISOString().slice(0, 10)}.csv`); },
  async baseReset() {
    const ov = await store.metaGet('checkBase', []);
    if (!ov.length) return toast('La base est déjà la base par défaut.');
    if (!(await confirmDlg('Revenir à la base par défaut ? Vos points ajoutés seront retirés et vos modifications annulées (sur tous vos appareils après synchro).', 'Revenir au défaut'))) return;
    await saveBaseOverrides(resetOverrides(ov, deviceId)); toast('Base par défaut restaurée'); viewBase();
  },
  async demo() { const { loadDemo } = await import('./demo.js'); const id = await loadDemo(store, deviceId, save); location.hash = `#/a/${id}/inv`; },
};

// ------------------------------------------------------------------ synchronisation SharePoint (Microsoft Graph)
const spConfig = () => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('cfg_sp') || '{}'); } catch { /* valeurs par défaut */ }
  return normalizeConfig({ ...(window.APP_CONFIG?.microsoft || {}), ...saved });
};
function getRemote() {
  const cfg = spConfig(), key = JSON.stringify(cfg);
  if (!remote || authFor !== key) { auth = makeAuth(cfg, { onConnected: updatePill }); remote = new SharePointRemote({ auth, store, config: cfg }); authFor = key; }
  return remote;
}
async function doSync({ silent = false } = {}) {
  if (syncing) return;
  if (!isConfigured(spConfig())) { if (!silent) { toast('Renseignez d’abord la connexion SharePoint (⚙ Réglages).'); openSettings(); } return; }
  if (!navigator.onLine) { if (!silent) toast('Hors ligne : vos données restent sur l’appareil et seront synchronisées plus tard.'); return; }
  syncing = true; updatePill();
  try {
    // Changement de service distant (ex. ancien Google Drive) : on repart d'un état « jamais vu » pour tout comparer
    if ((await store.metaGet('remoteKind', '')) !== 'sharepoint') { await store.metaSet('seen', {}); await store.metaSet('checkBaseSeen', ''); await store.metaSet('remoteKind', 'sharepoint'); }
    const st = await syncAll(store, getRemote(), { onProgress: (m) => { syncMsg = m; updatePill(); } });
    const parts = [st.pulled && `${st.pulled} audit(s) reçu(s)`, st.pushed && `${st.pushed} envoyé(s)`, st.photosUp && `${st.photosUp} photo(s) envoyée(s)`, st.photosDown && `${st.photosDown} photo(s) reçue(s)`].filter(Boolean);
    toast(st.errors.length ? `Synchro partielle : ${st.errors[0]}` : parts.length ? 'Synchronisé — ' + parts.join(', ') : 'Tout est à jour');
  } catch (e) {
    if (e.code === 'AUTH' && e.login) {
      if (!silent) { toast('Connexion Microsoft nécessaire — ouverture de la page de connexion…', 3000); syncing = false; updatePill(); return auth.login(); }
    } else if (!silent || e.code !== 'AUTH') toast(e.code === 'AUTH' ? `Connexion Microsoft : ${e.message}` : `Échec de la synchro : ${e.message}`, 6000);
  }
  finally { syncing = false; syncMsg = ''; await reloadBase(); updatePill(); if (!$('#dlg').open) await refreshViewSafe(); }
}
// Évite de détruire une saisie en cours : on ne recharge la vue que si aucun champ n'a le focus
const refreshViewSafe = async () => { const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return; await route({ keep: true }); };
function scheduleAutoSync() {
  clearTimeout(autoTimer);
  if (!isConfigured(spConfig()) || !navigator.onLine) return;
  getRemote();
  if (!auth.connected) return; // pas de passage par la page de connexion Microsoft sans geste de l'utilisateur
  autoTimer = setTimeout(() => doSync({ silent: true }), 20000);
}

const theme = () => (localStorage.getItem('cfg_theme') === 'light' ? 'light' : 'dark');
function setTheme(t) {
  try { localStorage.setItem('cfg_theme', t); } catch { /* stockage indisponible */ }
  if (t === 'light') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
}

async function openSettings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const root = await store.metaGet('remoteRoot', '');
  const c = spConfig();
  dialog(`<div class="brand-card" style="margin-bottom:12px"><img src="icons/logo-couleur.png" alt="Carbone Ingénierie"></div><h2>Réglages</h2>
    <div class="card"><h2>Synchronisation SharePoint</h2>
      <label class="field"><span>ID d’application (client)</span><input type="text" id="spc" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${esc(c.clientId)}"></label>
      <label class="field"><span>ID de l’annuaire (tenant) ou domaine</span><input type="text" id="spt" placeholder="carbone-ingenierie.fr" value="${esc(c.tenant)}"></label>
      <label class="field"><span>Adresse du site SharePoint</span><input type="text" id="sps" placeholder="https://…sharepoint.com/sites/…" value="${esc(c.siteUrl)}"></label>
      <label class="field"><span>Bibliothèque de documents</span><input type="text" id="spl" placeholder="Documents" value="${esc(c.library)}"></label>
      <label class="field"><span>Dossier de l’application</span><input type="text" id="spf" placeholder="AuditEnergie" value="${esc(c.folder)}"></label>
      <p class="small muted">Créés une fois dans Microsoft Entra (voir le guide de déploiement). Adresse de redirection à déclarer : <code>${esc(location.origin + location.pathname)}</code>. Les données sont écrites dans le dossier <code>${esc(c.folder)}</code> de la bibliothèque${root ? ` — <a href="${esc(root)}" target="_blank" rel="noopener">ouvrir</a>` : ''}.</p>
      <button class="btn primary block" id="sg">Enregistrer et synchroniser</button>
      ${auth?.connected ? '<button class="btn small" id="sout" style="margin-top:8px">Se déconnecter de Microsoft</button>' : ''}</div>
    <div class="card"><h2>Affichage</h2>
      <div class="row"><button class="chip ${theme() === 'dark' ? 'on' : ''}" data-theme="dark">🌙 Sombre</button><button class="chip ${theme() === 'light' ? 'on' : ''}" data-theme="light">☀ Clair</button></div></div>
    <div class="card"><h2>Base de checklists</h2><p class="small muted">Points de contrôle proposés pour chaque type d’utilité : ajout, modification, import / export Excel.</p><button class="btn block" id="baseBtn">☑ Modifier la base de checklists</button></div>
    <div class="card"><h2>Stockage sur cet appareil</h2>
      <div class="small">${persisted ? '✅ Stockage persistant accordé (le navigateur ne purgera pas vos données).' : '⚠️ Stockage non persistant : installez l’app sur l’écran d’accueil et synchronisez régulièrement.'}</div>
      ${est ? `<div class="small muted" style="margin-top:4px">Utilisé : ${(est.usage / 1048576).toFixed(1)} Mo sur ${(est.quota / 1073741824).toFixed(1)} Go disponibles.</div>` : ''}
      ${persisted ? '' : '<button class="btn small" id="persist" style="margin-top:8px">Demander le stockage persistant</button>'}
      ${installEvt ? '<button class="btn small" id="install" style="margin-top:8px">Installer l’application</button>' : ''}</div>
    <div class="row"><button class="btn" id="demoBtn">Charger l’audit de démonstration</button><span class="grow"></span><button class="btn primary" data-close>Fermer</button></div>
    <p class="small muted">Appareil <code>${deviceId.slice(0, 8)}</code> · version prototype 0.4</p>`, (d) => {
    d.querySelectorAll('[data-theme]').forEach((b) => { b.onclick = () => { setTheme(b.dataset.theme); d.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x === b)); }; });
    $('#baseBtn', d).onclick = () => { d.close(); actions.openBase(); };
    $('#sg', d).onclick = () => {
      const v = (id) => $(id, d).value;
      localStorage.setItem('cfg_sp', JSON.stringify({ clientId: v('#spc'), tenant: v('#spt'), siteUrl: v('#sps'), library: v('#spl'), folder: v('#spf') }));
      d.close(); doSync();
    };
    $('#sout', d)?.addEventListener('click', () => { auth.logout(); toast('Déconnecté de Microsoft'); d.close(); updatePill(); });
    $('#persist', d)?.addEventListener('click', async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Stockage persistant accordé' : 'Refusé par le navigateur : installez d’abord l’application'); d.close(); });
    $('#install', d)?.addEventListener('click', async () => { installEvt.prompt(); installEvt = null; d.close(); });
    $('#demoBtn', d).onclick = () => { d.close(); actions.demo(); };
  });
}

// ------------------------------------------------------------------ démarrage
main.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]'); if (!t || !actions[t.dataset.act]) return;
  try { await actions[t.dataset.act](t, e); } catch (err) { console.error(err); toast('Erreur : ' + err.message, 5000); }
});
main.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('input[data-photo]')) { const files = [...el.files]; el.value = ''; await addPhotos(files, el.dataset.uid || null); }
  else if (el.matches('input[data-baseimport]')) {
    const f = el.files[0]; el.value = ''; if (!f) return;
    try {
      const r = importBaseCsv(decodeCsv(await f.arrayBuffer()), CB, deviceId);
      if (r.errors.length) { toast(`Import refusé : ${r.errors.slice(0, 2).join(' ; ')}`, 7000); return; }
      if (!(await confirmDlg(`Importer la base ? ${r.created} point(s) ajouté(s), ${r.changed} modifié(s), ${r.deleted} retiré(s) (les points absents du fichier sont retirés).`, 'Importer'))) return;
      await saveBaseOverrides(r.overrides); toast('Base importée'); viewBase();
    } catch (err) { toast(err.message, 6000); }
  }
  else if (el.matches('input[data-import]')) {
    const f = el.files[0]; el.value = ''; if (!f) return;
    try { const r = await importBackup(store, f); toast(`Sauvegarde restaurée : ${r.audits} audit(s), ${r.photos} photo(s)`); await route(); } catch (err) { toast(err.message, 6000); }
  } else if (el.closest('#detail')) onField(e);
  else if (el.closest('#auditForm, #auditForm2')) onAuditField(e);
});
main.addEventListener('input', debounce((e) => { if (e.target.closest('#detail') && e.target.matches('input[type=text],input[type=number]')) onField(e); else if (e.target.closest('#auditForm, #auditForm2')) onAuditField(e); }, 600));

$('#btnSync').onclick = () => doSync();
$('#btnSettings').onclick = openSettings;
addEventListener('hashchange', () => route());
addEventListener('online', () => { updatePill(); toast('Réseau rétabli — touchez ⟳ pour synchroniser'); });
addEventListener('offline', () => { updatePill(); toast('Hors ligne — la saisie continue normalement'); });
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
addEventListener('pagehide', () => { /* IndexedDB est déjà écrit à chaque modification */ });

(async function boot() {
  await store.open();
  deviceId = await store.metaGet('deviceId', null);
  if (!deviceId) { deviceId = uid(); await store.metaSet('deviceId', deviceId); }
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  await reloadBase();
  updatePill(); setInterval(updatePill, 60000);
  await route();
  if (isConfigured(spConfig())) { // retour de la page de connexion Microsoft ?
    const r = await getRemote() && await auth.handleRedirect();
    if (r?.error) toast(`Connexion Microsoft : ${r.error}`, 8000);
    else if (r?.ok) { toast('Connecté à Microsoft'); doSync(); }
  }
  window.__app = { store, doSync, S, base: () => CB }; // utile pour les tests automatisés
})();
