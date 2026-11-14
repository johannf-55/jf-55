// Exports : CSV (format Excel FR : séparateur « ; », UTF-8 avec BOM, virgule décimale),
// sauvegarde complète (data.json + photos) et restauration par fusion.
import { writeZip, readZip } from './zip.js';
import { FAMILIES, CARRIERS, NOTE_CATS, kindById, AUDIT_TYPES, SCHEMA_VERSION, uncertainty, uncSuffix, basisText, hoursFromBasis } from './model.js';
import { effectiveBase, answerRows, progress, ANSWER_TYPES, targetLabel } from './checklist.js';
import { mergeList } from './sync-core.js';
import { buildDoc, mergeDocs, applyDoc } from './sync-core.js';
import { buildXlsx } from './xlsx.js';

const BOM = '﻿';
const fmtVal = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  const s = String(v);
  return /^-?\d+\.\d+$/.test(s) ? s.replace('.', ',') : s;
};
const cell = (v) => { const s = fmtVal(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (cols, rows) => BOM + [cols.map(cell).join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n') + '\r\n';
const dt = (ts) => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const catLabel = (n) => (NOTE_CATS[n.category] || NOTE_CATS.observation).label;
const slug = (s) => String(s || 'audit').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'audit';

export async function loadBundle(store, auditId) {
  const doc = await buildDoc(store, auditId);
  const live = (a) => a.filter((r) => !r.deleted);
  return { audit: doc.audit, utilities: live(doc.utilities), links: live(doc.links), notes: live(doc.notes), photos: live(doc.photos), checkBase: effectiveBase(await store.metaGet('checkBase', [])) };
}

const uncOf = (u, key, value, unit) => uncertainty(value, u.unc?.[key], unit);
const basisOf = (u) => (u.hoursBasis && hoursFromBasis(u.hoursBasis) === u.hours ? basisText(u.hoursBasis) : '');
const ckStatus = (r) => (r.answered ? 'Renseigné' : r.a?.note ? 'Remarque seule' : 'À renseigner');

/** Construit les tables CSV d'un audit (retourne aussi le plan de nommage des photos). */
export function buildTables({ audit, utilities, links, notes, photos, checkBase = effectiveBase([]) }) {
  const byId = new Map(utilities.map((u) => [u.id, u]));
  const tag = (id) => byId.get(id)?.tag || '';
  const famRank = (f) => Object.keys(FAMILIES).indexOf(f);
  const byTagOrder = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true });
  utilities = [...utilities].sort((a, b) => famRank(a.family) - famRank(b.family) || byTagOrder(a.tag, b.tag));
  links = [...links].sort((a, b) => byTagOrder(tag(a.fromId), tag(b.fromId)) || byTagOrder(tag(a.toId), tag(b.toId)));
  // Caractéristiques : format « long » (une ligne par valeur) pour éviter les collisions de libellés entre types
  // (ex. « Débit » = t/h pour la vapeur, m³/h pour l'air). Résumé lisible aussi dans utilites.csv.
  const specsOf = (u) => Object.entries(u.specs || {}).filter(([, v]) => String(v).trim() !== '').map(([k, v]) => {
    const f = kindById(u.kind).fields.find((x) => x.k === k);
    const unit = f?.unit || '', un = f?.num ? uncOf(u, 's:' + k, v, unit) : null;
    return { champ: f ? f.label : k, unite: unit, valeur: String(v).trim(), incertitude: un ? un.saisie : '', unite_incertitude: un ? uncSuffix(unit) : '', incertitude_abs: un?.abs ?? '', incertitude_rel_pct: un?.rel ?? '' };
  });

  const uCols = ['audit', 'repere', 'famille', 'type', 'nom', 'localisation', 'statut', 'vecteur_entree', 'vecteur_sortie', 'puissance_kW', 'puissance_incert_pct', 'annee', 'marque', 'modele', 'heures_an', 'heures_incert_pct', 'base_heures', 'comptage', 'checklist',
    'caracteristiques', 'alimente_par', 'alimente', 'nb_photos', 'nb_notes', 'notes'];
  const uRows = utilities.map((u) => ({ audit: audit.name, repere: u.tag, famille: FAMILIES[u.family].label, type: kindById(u.kind).label, nom: u.name, localisation: u.location, statut: u.status,
    vecteur_entree: CARRIERS[u.carrierIn]?.label || '', vecteur_sortie: CARRIERS[u.carrierOut]?.label || '', puissance_kW: u.powerKw, puissance_incert_pct: u.unc?.powerKw ?? 0, annee: u.year, marque: u.brand, modele: u.model, heures_an: u.hours, heures_incert_pct: u.unc?.hours ?? 0, base_heures: basisOf(u), comptage: u.metering,
    checklist: (({ done, total }) => `${done}/${total}`)(progress(checkBase, u)),
    caracteristiques: specsOf(u).map((x) => `${x.champ}${x.unite ? ' (' + x.unite + ')' : ''} : ${x.valeur}`).join(' ; '),
    alimente_par: links.filter((l) => l.toId === u.id).map((l) => tag(l.fromId)).sort(byTagOrder).join(', '),
    alimente: links.filter((l) => l.fromId === u.id).map((l) => tag(l.toId)).sort(byTagOrder).join(', '),
    nb_photos: photos.filter((p) => p.utilityId === u.id).length,
    nb_notes: notes.filter((n) => n.utilityId === u.id).length,
    notes: notes.filter((n) => n.utilityId === u.id).sort((a, b) => a.createdAt - b.createdAt).map((n) => `[${catLabel(n)}] ` + n.text.replace(/\s+/g, ' ')).join(' | ') }));

  const cCols = ['audit', 'repere', 'nom', 'type', 'champ', 'valeur', 'unite', 'incertitude', 'unite_incertitude', 'incertitude_abs', 'incertitude_rel_pct'];
  const cRows = utilities.flatMap((u) => specsOf(u).map((x) => ({ audit: audit.name, repere: u.tag, nom: u.name, type: kindById(u.kind).label, ...x })));

  const lCols = ['audit', 'de_repere', 'de_nom', 'vers_repere', 'vers_nom', 'vecteur', 'commentaire'];
  const lRows = links.map((l) => ({ audit: audit.name, de_repere: tag(l.fromId), de_nom: byId.get(l.fromId)?.name || '', vers_repere: tag(l.toId), vers_nom: byId.get(l.toId)?.name || '', vecteur: CARRIERS[l.carrier]?.label || l.carrier, commentaire: l.comment }));

  const nCols = ['audit', 'portee', 'repere', 'utilite', 'categorie', 'date', 'texte'];
  const nRows = [...notes].sort((a, b) => a.createdAt - b.createdAt).map((n) => ({ audit: audit.name, portee: n.utilityId ? 'Utilité' : 'Général', repere: tag(n.utilityId), utilite: byId.get(n.utilityId)?.name || '', categorie: catLabel(n), date: dt(n.createdAt), texte: n.text }));

  const counters = new Map();
  const photoPlan = photos.sort((a, b) => a.takenAt - b.takenAt).map((p) => {
    const t = p.utilityId ? tag(p.utilityId) || 'sans_repere' : 'general';
    const i = (counters.get(t) || 0) + 1; counters.set(t, i);
    return { p, file: `photos/${slug(t)}_${String(i).padStart(2, '0')}.jpg`, tag: p.utilityId ? tag(p.utilityId) : '' };
  });
  const pCols = ['audit', 'fichier', 'repere', 'legende', 'date', 'taille_ko'];
  const pRows = photoPlan.map(({ p, file, tag: t }) => ({ audit: audit.name, fichier: file, repere: t, legende: p.caption, date: dt(p.takenAt), taille_ko: p.size ? Math.round(p.size / 1024) : '' }));

  const aCols = ['nom', 'client', 'site', 'adresse', 'territoire', 'activite', 'reseau_electrique', 'T_ambiante_moy_C', 'HR_moy_pct', 'saisonnalite', 'auditeur', 'date', 'perimetre', 'referentiel', 'commentaire_general'];
  const aRows = [{ nom: audit.name, client: audit.client, site: audit.site, adresse: audit.address, territoire: audit.territory, activite: audit.activity, reseau_electrique: audit.grid, T_ambiante_moy_C: audit.tAmb, HR_moy_pct: audit.rh, saisonnalite: audit.seasonality,
    auditeur: audit.auditor, date: audit.date, perimetre: AUDIT_TYPES[audit.type] || audit.type, referentiel: audit.norm,
    commentaire_general: notes.filter((n) => !n.utilityId).sort((a, b) => a.createdAt - b.createdAt).map((n) => `[${catLabel(n)}] ` + n.text.replace(/\s+/g, ' ')).join(' | ') }];

  const kCols = ['audit', 'repere', 'utilite', 'type', 'id_point', 'point', 'type_reponse', 'statut', 'reponse', 'unite', 'incertitude', 'unite_incertitude', 'remarque', 'interet_energetique'];
  const kRows = answerRows(checkBase, utilities).map((r) => ({ audit: audit.name, repere: r.u.tag, utilite: r.u.name, type: kindById(r.u.kind).label, id_point: r.item.id, point: r.item.q, type_reponse: ANSWER_TYPES[r.item.type] || r.item.type,
    statut: ckStatus(r), reponse: r.text, unite: r.item.unit || '', incertitude: r.item.type === 'nombre' && r.answered ? r.a.unc ?? 0 : '', unite_incertitude: r.item.type === 'nombre' && r.answered ? uncSuffix(r.item.unit) : '', remarque: r.a?.note || '', interet_energetique: r.item.why || '' }));

  return { files: [['audit.csv', toCsv(aCols, aRows)], ['utilites.csv', toCsv(uCols, uRows)], ['caracteristiques.csv', toCsv(cCols, cRows)], ['liens.csv', toCsv(lCols, lRows)], ['notes.csv', toCsv(nCols, nRows)], ['photos.csv', toCsv(pCols, pRows)], ['checklist.csv', toCsv(kCols, kRows)]], photoPlan };
}

export async function exportCsvZip(store, auditId, { withPhotos = true } = {}) {
  const bundle = await loadBundle(store, auditId);
  const { files, photoPlan } = buildTables(bundle);
  const entries = files.map(([name, data]) => ({ name, data }));
  if (withPhotos) for (const { p, file } of photoPlan) { const b = await store.getBlob(p.id); if (b) entries.push({ name: file, data: b }); }
  return { blob: await writeZip(entries), name: `${slug(bundle.audit.name)}_export_csv.zip` };
}

// ------------------------------------------------------------------ XLSX multi-feuilles
const num = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return v;
  const t = v.trim().replace(/\s/g, '');
  return /^-?\d+([.,]\d+)?$/.test(t) && t.replace(/^-?0+(?=\d)/, '').length < 16 && !/^0\d/.test(t.replace(/^-/, '')) ? Number(t.replace(',', '.')) : v;
};

const shortKind = (l) => l.split(' / ')[0].replace(/\s*[(（].*$/, '').trim() || l;

/** Construit les feuilles du classeur : Synthèse, Utilités, une feuille par type d'utilité, Liens, Commentaires, Photos, Caractéristiques. */
export function buildSheets(bundle) {
  const { audit, utilities: us0, links: ls0, notes, photos, checkBase = effectiveBase([]) } = bundle;
  const { photoPlan } = buildTables({ ...bundle, photos: [...photos] });
  const byId = new Map(us0.map((u) => [u.id, u]));
  const tag = (id) => byId.get(id)?.tag || '';
  const famKeys = Object.keys(FAMILIES);
  const byTagOrder = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true });
  const utilities = [...us0].sort((a, b) => famKeys.indexOf(a.family) - famKeys.indexOf(b.family) || byTagOrder(a.tag, b.tag));
  const links = [...ls0].sort((a, b) => byTagOrder(tag(a.fromId), tag(b.fromId)) || byTagOrder(tag(a.toId), tag(b.toId)));
  const sortedNotes = [...notes].sort((a, b) => a.createdAt - b.createdAt);
  const col = (key, label, width) => ({ key, label, width });
  const fromTo = (u) => ({
    par: links.filter((l) => l.toId === u.id).map((l) => tag(l.fromId)).sort(byTagOrder).join(', '),
    vers: links.filter((l) => l.fromId === u.id).map((l) => tag(l.toId)).sort(byTagOrder).join(', '),
  });
  const notesOf = (u) => sortedNotes.filter((n) => n.utilityId === u.id).map((n) => `[${catLabel(n)}] ` + n.text.replace(/\s+/g, ' ')).join(' | ');
  const specsOf = (u) => Object.entries(u.specs || {}).filter(([, v]) => String(v).trim() !== '').map(([k, v]) => {
    const f = kindById(u.kind).fields.find((x) => x.k === k);
    const unit = f?.unit || '';
    return { k, champ: f ? f.label : k, unite: unit, valeur: String(v).trim(), un: f?.num ? uncOf(u, 's:' + k, v, unit) : null };
  });
  const ckRows = answerRows(checkBase, utilities);

  const sheets = [];
  const stamp = new Date().toLocaleDateString('fr-FR');

  // 1. Synthèse
  const famPower = famKeys.map((f) => [f, utilities.filter((u) => u.family === f)]);
  const rows = [];
  const kv = (rubrique, valeur) => rows.push({ rubrique, valeur: num(valeur) });
  kv('Audit', audit.name); kv('Client', audit.client); kv('Site', audit.site); kv('Adresse', audit.address);
  kv('Territoire', audit.territory); kv('Activité', audit.activity); kv('Réseau électrique', audit.grid);
  kv('Température ambiante moyenne (°C)', audit.tAmb); kv('Humidité relative moyenne (%)', audit.rh); kv('Saisonnalité', audit.seasonality);
  kv('Auditeur', audit.auditor); kv('Date de l’audit', audit.date); kv('Périmètre', AUDIT_TYPES[audit.type] || audit.type); kv('Référentiel', audit.norm);
  kv('', ''); kv('Nombre d’utilités', utilities.length);
  for (const [f, list] of famPower) {
    kv(`  dont ${FAMILIES[f].label.toLowerCase()}`, list.length);
    const kw = list.reduce((a, u) => a + (Number(String(u.powerKw ?? '').replace(',', '.')) || 0), 0);
    kv(`  puissance déclarée — ${FAMILIES[f].label.toLowerCase()} (kW)`, Math.round(kw * 10) / 10);
  }
  kv('Nombre de liens', links.length); kv('Nombre de commentaires', notes.length); kv('Nombre de photos', photos.length);
  kv('Points de checklist renseignés', `${ckRows.filter((r) => r.answered).length} / ${ckRows.length}`);
  kv('Convention d’incertitude', '± en % de la valeur ; absolue pour les températures (°C, K) et en points pour les pourcentages. 0 = non renseignée.');
  kv('', ''); kv('Commentaire général', sortedNotes.filter((n) => !n.utilityId).map((n) => `[${catLabel(n)}] ` + n.text.replace(/\s+/g, ' ')).join('\n'));
  kv('Export généré le', stamp); kv('Source', 'Outil de relevé terrain — Carbone Ingénierie');
  sheets.push({ name: 'Synthèse', columns: [col('rubrique', 'Rubrique', 42), col('valeur', 'Valeur', 80)], rows, keyColumn: 'rubrique', noFilter: true });

  // 2. Utilités
  sheets.push({
    name: 'Utilités',
    columns: [col('repere', 'Repère', 9), col('famille', 'Famille'), col('type', 'Type', 26), col('nom', 'Nom', 30), col('localisation', 'Localisation', 22), col('statut', 'Statut', 14), col('ve', 'Vecteur entrée', 16), col('vs', 'Vecteur sortie', 16),
      col('kw', 'Puissance (kW)', 12), col('kwu', 'Puissance ± %', 10), col('annee', 'Année', 8), col('marque', 'Marque', 16), col('modele', 'Modèle', 16), col('h', 'Heures/an', 10), col('hu', 'Heures ± %', 10), col('hb', 'Base heures/an', 34), col('comptage', 'Comptage', 18),
      col('par', 'Alimenté par', 14), col('vers', 'Alimente', 14), col('ph', 'Photos', 8), col('nn', 'Commentaires', 12), col('ck', 'Checklist', 10)],
    rows: utilities.map((u) => ({ repere: u.tag, famille: FAMILIES[u.family].label, type: kindById(u.kind).label, nom: u.name, localisation: u.location, statut: u.status,
      ve: CARRIERS[u.carrierIn]?.label || '', vs: CARRIERS[u.carrierOut]?.label || '', kw: num(u.powerKw), kwu: u.unc?.powerKw ?? 0, annee: num(u.year), marque: u.brand, modele: u.model, h: num(u.hours), hu: u.unc?.hours ?? 0, hb: basisOf(u), comptage: u.metering,
      par: fromTo(u).par, vers: fromTo(u).vers, ph: photos.filter((p) => p.utilityId === u.id).length, nn: notes.filter((n) => n.utilityId === u.id).length, ck: (({ done, total }) => `${done}/${total}`)(progress(checkBase, u)) })),
    keyColumn: 'repere',
  });

  // 3. Une feuille par type d'utilité présent (colonnes = champs propres au type, avec unités)
  const kinds = [];
  for (const u of utilities) if (!kinds.includes(u.kind)) kinds.push(u.kind);
  for (const kid of kinds) {
    const kind = kindById(kid);
    const list = utilities.filter((u) => u.kind === kid);
    const extra = []; // champs libres hors définition du type
    for (const u of list) for (const k of Object.keys(u.specs || {})) if (!kind.fields.some((f) => f.k === k) && !extra.includes(k)) extra.push(k);
    const fieldCols = [...kind.fields.flatMap((f) => [{ key: 'f_' + f.k, k: f.k, label: f.label + (f.unit ? ` (${f.unit})` : '') },
      ...(f.num ? [{ key: 'u_' + f.k, k: f.k, unc: true, unit: f.unit, label: `± ${uncSuffix(f.unit)}`, width: 8 }] : [])]), ...extra.map((k) => ({ key: 'f_' + k, k, label: k }))];
    sheets.push({
      name: `${FAMILIES[kind.family].prefix} ${shortKind(kind.label)}`,
      columns: [col('repere', 'Repère', 9), col('nom', 'Nom', 28), col('localisation', 'Localisation', 20), col('statut', 'Statut', 13), col('kw', 'Puissance (kW)', 12), col('annee', 'Année', 8), col('marque', 'Marque', 14), col('modele', 'Modèle', 14),
        col('h', 'Heures/an', 10), ...fieldCols.map((c) => col(c.key, c.label, c.width)), col('par', 'Alimenté par', 14), col('vers', 'Alimente', 14), col('com', 'Commentaires', 60)],
      rows: list.map((u) => ({ repere: u.tag, nom: u.name, localisation: u.location, statut: u.status, kw: num(u.powerKw), annee: num(u.year), marque: u.brand, modele: u.model,
        h: num(u.hours), ...Object.fromEntries(fieldCols.map((c) => [c.key, c.unc ? (u.unc?.['s:' + c.k] ?? 0) : num(String((u.specs || {})[c.k] ?? '').trim())])), par: fromTo(u).par, vers: fromTo(u).vers, com: notesOf(u) })),
      keyColumn: 'repere',
    });
  }

  // 4. Checklists (tous les points applicables, renseignés ou non : filtre sur « Statut »)
  sheets.push({
    name: 'Checklists',
    columns: [col('repere', 'Repère', 9), col('utilite', 'Utilité', 26), col('point', 'Point de contrôle', 52), col('statut', 'Statut', 13), col('rep', 'Réponse', 22), col('unite', 'Unité', 9), col('inc', '±', 7), col('incu', 'Unité ±', 8), col('rem', 'Remarque', 36), col('why', 'Intérêt énergétique', 60), col('cible', 'Portée du point', 22)],
    rows: ckRows.map((r) => ({ repere: r.u.tag, utilite: r.u.name || kindById(r.u.kind).label, point: r.item.q, statut: ckStatus(r), rep: r.item.type === 'nombre' ? num(r.text) : r.text, unite: r.item.unit || '',
      inc: r.item.type === 'nombre' && r.answered ? r.a.unc ?? 0 : '', incu: r.item.type === 'nombre' && r.answered ? uncSuffix(r.item.unit) : '', rem: r.a?.note || '', why: r.item.why || '', cible: r.item.kind ? targetLabel(r.item.kind) : 'Point retiré de la base' })),
    keyColumn: 'repere',
  });

  // 5. Liens
  sheets.push({
    name: 'Liens',
    columns: [col('a', 'De (repère)', 12), col('an', 'De (nom)', 30), col('b', 'Vers (repère)', 12), col('bn', 'Vers (nom)', 30), col('v', 'Vecteur', 20), col('c', 'Commentaire', 50)],
    rows: links.map((l) => ({ a: tag(l.fromId), an: byId.get(l.fromId)?.name || '', b: tag(l.toId), bn: byId.get(l.toId)?.name || '', v: CARRIERS[l.carrier]?.label || l.carrier, c: l.comment })),
    keyColumn: 'a',
  });

  // 5. Commentaires
  sheets.push({
    name: 'Commentaires',
    columns: [col('portee', 'Portée', 11), col('repere', 'Repère', 9), col('utilite', 'Utilité', 28), col('cat', 'Catégorie', 24), col('date', 'Date', 16), col('texte', 'Commentaire', 90)],
    rows: sortedNotes.map((n) => ({ portee: n.utilityId ? 'Utilité' : 'Général', repere: tag(n.utilityId), utilite: byId.get(n.utilityId)?.name || '', cat: catLabel(n), date: dt(n.createdAt), texte: n.text })),
    keyColumn: 'cat',
  });

  // 6. Photos
  sheets.push({
    name: 'Photos',
    columns: [col('f', 'Fichier (dans le ZIP CSV)', 28), col('repere', 'Repère', 9), col('l', 'Légende', 50), col('d', 'Date', 16), col('t', 'Taille (ko)', 11)],
    rows: photoPlan.map(({ p, file, tag: t }) => ({ f: file, repere: t, l: p.caption, d: dt(p.takenAt), t: p.size ? Math.round(p.size / 1024) : '' })),
    keyColumn: 'f',
  });

  // 7. Caractéristiques (format long, pratique pour les tableaux croisés dynamiques)
  sheets.push({
    name: 'Caractéristiques',
    columns: [col('repere', 'Repère', 9), col('nom', 'Nom', 30), col('type', 'Type', 26), col('champ', 'Champ', 34), col('valeur', 'Valeur', 14), col('unite', 'Unité', 10),
      col('inc', 'Incertitude saisie', 12), col('incu', 'Unité incertitude', 12), col('abs', 'Incertitude absolue', 12), col('rel', 'Incertitude relative (%)', 13)],
    rows: utilities.flatMap((u) => [
      ...[['powerKw', 'Puissance', 'kW', u.powerKw], ['hours', 'Temps de fonctionnement', 'h/an', u.hours]].filter((x) => x[3] !== null && x[3] !== undefined && x[3] !== '')
        .map(([key, champ, unite, v]) => { const un = uncOf(u, key, v, unite); return { repere: u.tag, nom: u.name, type: kindById(u.kind).label, champ, valeur: num(v), unite, inc: un.saisie, incu: uncSuffix(unite), abs: un.abs ?? '', rel: un.rel ?? '' }; }),
      ...specsOf(u).map((x) => ({ repere: u.tag, nom: u.name, type: kindById(u.kind).label, champ: x.champ, valeur: num(x.valeur), unite: x.unite,
        inc: x.un ? x.un.saisie : '', incu: x.un ? uncSuffix(x.unite) : '', abs: x.un?.abs ?? '', rel: x.un?.rel ?? '' }))]),
    keyColumn: 'repere',
  });
  return sheets;
}

export async function exportXlsx(store, auditId) {
  const bundle = await loadBundle(store, auditId);
  const blob = await buildXlsx(buildSheets(bundle), { title: `Relevé d’audit énergétique — ${bundle.audit.name}` });
  return { blob, name: `${slug(bundle.audit.name)}_export.xlsx` };
}

export async function exportBackupZip(store, auditIds, { onProgress } = {}) {
  const docs = [];
  const entries = [];
  for (const id of auditIds) {
    const doc = await buildDoc(store, id); if (!doc) continue;
    docs.push(doc);
    for (const p of doc.photos) { if (p.deleted) continue; const b = await store.getBlob(p.id); if (b) entries.push({ name: `photos/${p.id}.jpg`, data: b }); onProgress?.(); }
  }
  entries.unshift({ name: 'data.json', data: JSON.stringify({ app: 'audit-energie', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), audits: docs, checkBase: await store.metaGet('checkBase', []) }, null, 1) });
  const stamp = new Date().toISOString().slice(0, 10);
  return { blob: await writeZip(entries), name: docs.length === 1 ? `${slug(docs[0].audit.name)}_sauvegarde_${stamp}.zip` : `audits_sauvegarde_${stamp}.zip` };
}

/** Restaure une sauvegarde par fusion (les données existantes plus récentes sont conservées). */
export async function importBackup(store, file) {
  const entries = await readZip(file);
  const dataEntry = entries.find((e) => e.name === 'data.json');
  if (!dataEntry) throw new Error('Ce fichier n’est pas une sauvegarde de l’application (data.json introuvable).');
  const data = JSON.parse(await dataEntry.text());
  if (data.app !== 'audit-energie') throw new Error('Sauvegarde non reconnue.');
  if (data.schema > SCHEMA_VERSION) throw new Error('Sauvegarde créée par une version plus récente de l’application.');
  const dirty = await store.metaGet('dirty', {});
  let imported = 0, photos = 0;
  for (const remoteDoc of data.audits) {
    const { doc } = mergeDocs(await buildDoc(store, remoteDoc.auditId), remoteDoc);
    await applyDoc(store, doc); dirty[remoteDoc.auditId] = Date.now(); imported++;
  }
  for (const e of entries) {
    const m = /^photos\/(.+)\.jpg$/.exec(e.name);
    if (m && !(await store.hasBlob(m[1]))) { await store.putBlob(m[1], await e.blob('image/jpeg')); photos++; }
  }
  await store.metaSet('dirty', dirty);
  if (data.checkBase?.length) {
    const m = mergeList(await store.metaGet('checkBase', []), data.checkBase);
    if (m.localChanged) { await store.metaSet('checkBase', m.merged); await store.metaSet('checkBaseDirty', Date.now()); }
  }
  return { audits: imported, photos };
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
