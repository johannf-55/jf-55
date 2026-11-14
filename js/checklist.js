// Checklists par utilité : base de points de contrôle (par défaut + modifications locales synchronisées),
// sélection des points applicables à une utilité, réponses, import / export CSV (format Excel France).
import { DEFAULT_CHECKS } from './checklist-base.js';
import { KINDS, FAMILIES, kindById, uid } from './model.js';
import { mergeList } from './sync-core.js';

export const ANSWER_TYPES = {
  check:   'Case à cocher',
  oui_non: 'Oui / Non / N.A.',
  choix:   'Choix dans une liste',
  nombre:  'Valeur chiffrée',
  texte:   'Texte libre',
};
export const YES_NO = ['Oui', 'Non', 'N.A.'];

/** Libellé de la cible d'un point : « * » = toutes les utilités, sinon type d'utilité. */
export const targetLabel = (kind) => (kind === '*' ? 'Toutes les utilités' : kind?.startsWith('@') ? `Famille ${FAMILIES[kind.slice(1)]?.label || kind}` : kindById(kind).label);

/** Base effective = base par défaut fusionnée avec les modifications (overrides : enregistrements datés, suppressions incluses). */
export function effectiveBase(overrides = []) {
  return mergeList(DEFAULT_CHECKS, overrides).merged;
}
const live = (base) => base.filter((x) => !x.deleted);

/** Points applicables à une utilité : ceux de son type, puis ceux de sa famille, puis les points communs. */
export function itemsFor(base, u) {
  const b = live(base), byOrder = (a, c) => (a.order || 0) - (c.order || 0);
  return [...b.filter((x) => x.kind === u.kind).sort(byOrder), ...b.filter((x) => x.kind === '@' + u.family).sort(byOrder), ...b.filter((x) => x.kind === '*').sort(byOrder)];
}

export const isAnswered = (item, a) => !!a && (item.type === 'check' ? a.v === true : a.v !== undefined && a.v !== null && String(a.v).trim() !== '');
export function progress(base, u) {
  const items = itemsFor(base, u);
  return { done: items.filter((i) => isAnswered(i, u.checks?.[i.id])).length, total: items.length };
}
export function answerText(item, a) {
  if (!a) return '';
  if (item.type === 'check') return a.v === true ? 'Vérifié' : '';
  return a.v === undefined || a.v === null ? '' : String(a.v);
}

/** Change un point de la base : renvoie le nouvel override (horodaté) à enregistrer. */
export function editItem(item, changes, deviceId) {
  return { ...item, ...changes, updatedAt: Date.now(), deviceId };
}
export function newItem(kind, deviceId, base) {
  const max = Math.max(0, ...live(base).filter((x) => x.kind === kind).map((x) => x.order || 0));
  return { id: 'u-' + uid().slice(0, 8), kind, order: max + 10, type: 'oui_non', q: '', why: '', opts: [], unit: '', createdAt: Date.now(), updatedAt: Date.now(), deviceId, deleted: false };
}
/** Revenir à la base par défaut : chaque point modifié reprend sa version d'origine, les points ajoutés sont supprimés. */
export function resetOverrides(overrides, deviceId) {
  const now = Date.now();
  return overrides.map((o) => {
    const d = DEFAULT_CHECKS.find((x) => x.id === o.id);
    return d ? { ...d, updatedAt: now, deviceId } : { ...o, deleted: true, updatedAt: now, deviceId };
  });
}
/** Ajoute / remplace des overrides dans la liste (par id). */
export function upsert(overrides, recs) {
  const m = new Map(overrides.map((o) => [o.id, o]));
  for (const r of recs) m.set(r.id, r);
  return [...m.values()];
}

// ---------------------------------------------------------------- CSV (Excel France : « ; », UTF-8 BOM)
const COLS = ['id', 'type_utilite', 'libelle_type', 'ordre', 'question', 'reponse', 'options', 'unite', 'interet_energetique'];
const cell = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function baseToCsv(base) {
  const kindIdx = (k) => (k === '*' ? 999 : KINDS.findIndex((x) => x.id === k));
  const rows = live(base).sort((a, b) => kindIdx(a.kind) - kindIdx(b.kind) || (a.order || 0) - (b.order || 0));
  return '﻿' + [COLS.join(';'), ...rows.map((x) => [x.id, x.kind, targetLabel(x.kind), x.order, x.q, x.type, (x.opts || []).join(' | '), x.unit, x.why].map(cell).join(';'))].join('\r\n') + '\r\n';
}

/** Décode un fichier CSV enregistré par Excel (UTF-8 ou Windows-1252). */
export function decodeCsv(buf) {
  const u8 = new Uint8Array(buf);
  const utf = new TextDecoder('utf-8').decode(u8);
  return utf.includes('�') ? new TextDecoder('windows-1252').decode(u8) : utf.replace(/^﻿/, '');
}
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9*@]+/g, ' ').trim();
function resolveKind(code, label) {
  const c = String(code || '').trim();
  if (c === '*' || (c.startsWith('@') && FAMILIES[c.slice(1)]) || KINDS.some((k) => k.id === c)) return c;
  const l = norm(label || code);
  if (!l || l === norm('Toutes les utilités')) return '*';
  return KINDS.find((k) => norm(k.label) === l)?.id || null;
}
function resolveType(t) {
  const s = norm(t);
  if (!s) return 'oui_non';
  for (const [k, l] of Object.entries(ANSWER_TYPES)) if (s === norm(k) || s === norm(l)) return k;
  if (/coch|check/.test(s)) return 'check';
  if (/oui|non/.test(s)) return 'oui_non';
  if (/choix|liste/.test(s)) return 'choix';
  if (/nombre|valeur|chiffr/.test(s)) return 'nombre';
  return 'texte';
}

/**
 * Importe un CSV de base (remplacement) : renvoie les overrides à enregistrer et un compte rendu.
 * Les points absents du fichier sont supprimés ; les lignes sans id sont créées.
 */
export function importBaseCsv(text, base, deviceId) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('Fichier vide.');
  const head = rows[0].map((h) => norm(h).replace(/ /g, '_'));
  const ix = (name) => head.indexOf(name);
  if (ix('question') < 0) throw new Error('Colonne « question » introuvable : partez d’un export de la base.');
  const get = (r, name) => (ix(name) >= 0 ? (r[ix(name)] ?? '').trim() : '');
  const byId = new Map(live(base).map((x) => [x.id, x]));
  const now = Date.now(), seen = new Set(), out = [], errors = [];
  let created = 0, changed = 0, deleted = 0;
  rows.slice(1).forEach((r, i) => {
    const q = get(r, 'question'); if (!q) return;
    const kind = resolveKind(get(r, 'type_utilite'), get(r, 'libelle_type'));
    if (!kind) { errors.push(`ligne ${i + 2} : type d’utilité inconnu (« ${get(r, 'type_utilite') || get(r, 'libelle_type')} »)`); return; }
    const rec = { kind, q, type: resolveType(get(r, 'reponse')), opts: get(r, 'options').split(/\s*\|\s*/).filter(Boolean), unit: get(r, 'unite'), why: get(r, 'interet_energetique'),
      order: Number(get(r, 'ordre').replace(',', '.')) || (i + 1) * 10 };
    const id = get(r, 'id'); const old = id && byId.get(id);
    if (old) {
      seen.add(id);
      const same = ['kind', 'q', 'type', 'unit', 'why', 'order'].every((k) => String(old[k] ?? '') === String(rec[k] ?? '')) && (old.opts || []).join('|') === rec.opts.join('|');
      if (!same) { out.push({ ...old, ...rec, updatedAt: now, deviceId }); changed++; }
    } else {
      const nid = id && !seen.has(id) ? id : 'u-' + uid().slice(0, 8);
      seen.add(nid); out.push({ id: nid, ...rec, createdAt: now, updatedAt: now, deviceId, deleted: false }); created++;
    }
  });
  for (const x of byId.values()) if (!seen.has(x.id)) { out.push({ ...x, deleted: true, updatedAt: now, deviceId }); deleted++; }
  return { overrides: out, created, changed, deleted, errors };
}

/** Lignes d'export des réponses d'un audit (une ligne par point renseigné, y compris points retirés de la base). */
export function answerRows(base, utilities) {
  const byId = new Map(base.map((x) => [x.id, x]));
  const rows = [];
  for (const u of utilities) {
    const items = itemsFor(base, u), ids = new Set(items.map((i) => i.id));
    const orphans = Object.keys(u.checks || {}).filter((id) => !ids.has(id)).map((id) => byId.get(id) || { id, q: u.checks[id].q || id, type: 'texte', unit: u.checks[id].unit || '', why: '' });
    for (const it of [...items, ...orphans]) {
      const a = u.checks?.[it.id];
      rows.push({ u, item: it, a, answered: isAnswered(it, a), text: answerText(it, a) });
    }
  }
  return rows;
}
