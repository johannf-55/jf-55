// Audit de démonstration : distillerie fictive à La Réunion (campagne sucrière, bagasse, groupes froids, tours, secours).
import { newAudit, newUtility, newLink, newNote, newPhoto, hoursFromBasis } from './model.js';
import { DEFAULT_CHECKS } from './checklist-base.js';

function fakePhoto(label, hue) {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1200, 900); grad.addColorStop(0, `hsl(${hue},35%,38%)`); grad.addColorStop(1, `hsl(${hue + 30},30%,22%)`);
  g.fillStyle = grad; g.fillRect(0, 0, 1200, 900);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 14;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, 150 + i * 120); g.bezierCurveTo(400, 60 + i * 120, 800, 260 + i * 120, 1200, 120 + i * 120); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.92)'; g.font = 'bold 64px system-ui,sans-serif'; g.fillText(label, 60, 810); g.font = '34px system-ui'; g.fillText('Photo de démonstration', 60, 860);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
}

export async function loadDemo(store, deviceId, save) {
  const audit = newAudit(deviceId, { name: 'Démo — Distillerie du Sud (exemple fictif)', client: 'Distillerie du Sud (fictif)', site: 'Saint-Pierre', address: 'ZI Les Cannes, La Réunion', auditor: 'J. Francou',
    type: 'industrie', territory: 'La Réunion', grid: 'EDF SEI (La Réunion)', activity: 'Distillerie de rhum', tAmb: 24, rh: 75, seasonality: 'Campagne juillet–décembre, arrêt technique de janvier à juin' });
  await save('audits', audit);
  const all = [];
  const mk = (kind, name, loc, extra = {}, specs = {}) => { const u = newUtility(deviceId, audit.id, kind, all); Object.assign(u, { name, location: loc, ...extra, specs }); all.push(u); return u; };
  const chaud = mk('vapeur_gen', 'Chaudière bagasse n°1', 'Chaufferie', { powerKw: 8000, hours: 3500, year: 2008, brand: 'Babcock', carrierIn: 'biomasse', metering: 'Débitmètre vapeur HS' }, { combustible: 'Bagasse', pression: '20', debit: '12', t_eau: '105', retour_cond: '55', rendement: '68', o2: '8' });
  const froid = mk('groupe_froid', 'Groupe d’eau glacée fermentation', 'Local froid', { powerKw: 420, hours: 6000, year: 2015, brand: 'Carrier' }, { fluide: 'R134a', cop: '3,4', t_depart: '7', t_retour: '12', condenseur: 'À eau (tour)', compresseur: 'Vis', regulation: 'Étagée, sans VEV', t_ext: '33' });
  const comp = mk('compresseur', 'Compresseurs d’air 2×90 kW', 'Local compresseurs', { powerKw: 180, hours: 5500, year: 2012 }, { pression: '7,5', debit: '2×1000', regulation: 'Charge/vide', recup: 'Non', t_aspiration: '38' });
  const pelec = mk('poste_elec', 'Poste de livraison HTA', 'Entrée site', { powerKw: 1500, hours: 8760 }, { tension: '20', ps: '1800', tarif: 'Tarif vert A5', cosphi: '0,92' });
  const ge = mk('groupe_elec', 'Groupe électrogène de secours', 'Local GE', { powerKw: 800, year: 2005 }, { p_elec: '1000', conso: '18000', coupures: '12', h_fct: '150', usage: 'Secours (coupures SEI)' });
  const pv = mk('pv', 'Ombrières PV parking', 'Parking', { powerKw: 250, year: 2021 }, { kwc: '250', surface: '1500', autoconso: '85', productible: '1500', stockage: 'Non' });
  const tour = mk('tour', 'Tour aéroréfrigérante', 'Toiture technique', { powerKw: 55, hours: 6000, year: 2015 }, { puissance_therm: '2000', t_entree: '35', t_sortie: '30', approche: '6', ventilateurs: '2 × 22 kW, sans VEV' });
  const rel = mk('r_elec', 'Distribution BT / TGBT', 'TGBT', {}, { tension: '400', cosphi: '0,92', comptage: 'Sous-comptage chaufferie seulement' });
  const rv = mk('r_vapeur', 'Réseau vapeur 8 bar', 'Chaufferie → distillerie', {}, { pression: '8', dn: '150', longueur: '320', isolation: 'Vannes et brides non calorifugées', purgeurs: '24, état inconnu', retour_cond: 'Partiel' });
  const rg = mk('r_eau_glacee', 'Boucle eau glacée', 'Fermentation', {}, { t_depart: '7', t_retour: '12', pompes: '2 × 15 kW, sans VEV', isolation: 'Condensation visible sur vannes' });
  const ra = mk('r_air', 'Réseau air comprimé 7 bar', 'Ateliers', {}, { pression: '7', fuites: '30 (estimé)', longueur: '450' });
  const rt = mk('r_tour', 'Boucle d’eau de refroidissement', 'Toiture / process', {}, { t_depart: '30', t_retour: '35', debit: '350', pompes: '2 × 30 kW, sans VEV' });
  const col = mk('process_th', 'Colonnes de distillation', 'Distillerie', { powerKw: 5000, hours: 3500 }, { produit: 'Rhum agricole', t_process: '95', regime: 'Campagne, 3×8', conso_spec: '12 kg vapeur / L alcool pur' });
  const ferm = mk('process', 'Fermentation (cuves)', 'Fermentation', { powerKw: 150, hours: 3500, carrierIn: 'eau_glacee' }, { produit: 'Jus de canne', regime: 'Campagne, 3×8' });
  const mot = mk('moteurs', 'Pompes et ventilateurs process', 'Distillerie', { powerKw: 380, hours: 4500 }, { nb: '48', vev: 'Non (6 sur 48)', classe: 'IE1 majoritaire' });
  const clim = mk('clim', 'Climatisation bureaux et laboratoire', 'Bâtiment administratif', { powerKw: 60, hours: 3000, carrierIn: 'electricite' }, { surface: '450', consigne: '22', systeme: 'Splits', regulation: 'Manuelle' });
  const ecl = mk('eclairage', 'Éclairage ateliers', 'Ateliers', { powerKw: 40, hours: 5000 }, { techno: 'Fluo T8', nb: '380', w_point: '108', lux: '320' });
  const eff = mk('eau_traitement', 'Station de traitement des effluents', 'Station', { powerKw: 75, hours: 8760 }, { debit: '150', aeration: 'Surpresseurs, sans VEV', biogaz: 'Non' });
  // Incertitudes, base des heures et réponses de checklist (exemples)
  const ck = (u, answers) => {
    u.checks = {};
    for (const [id, v, extra = {}] of answers) { const it = DEFAULT_CHECKS.find((x) => x.id === id); u.checks[id] = { v, ...extra, q: it.q, unit: it.unit, at: Date.now() }; }
  };
  const campagne = { hpd: 24, dpw: 7, wpy: 21, note: 'campagne juillet–décembre' };
  for (const u of [chaud, col]) { u.hoursBasis = campagne; u.hours = hoursFromBasis(campagne); }
  comp.hoursBasis = { hpd: 24, dpw: 5.5, wpy: 42, note: 'arrêt le dimanche, intercampagne réduite' }; comp.hours = hoursFromBasis(comp.hoursBasis);
  chaud.unc = { powerKw: 10, hours: 5, 's:debit': 10, 's:rendement': 3, 's:o2': 0.5, 's:t_eau': 2 };
  froid.unc = { powerKw: 5, hours: 15, 's:cop': 15, 's:t_depart': 0.5, 's:t_retour': 0.5 };
  comp.unc = { powerKw: 0, hours: 10, 's:pression': 3, 's:t_aspiration': 1 };
  tour.unc = { 's:t_entree': 0.5, 's:t_sortie': 0.5 };
  ck(chaud, [['all-plaque', true], ['all-comptage', 'Aucun', { note: 'Débitmètre vapeur hors service' }], ['vg-analyse', 'Oui'], ['vg-tfumees', '245', { unc: 5 }], ['vg-eco', 'Non'], ['vg-regul', 'Manuelle / fixe'],
    ['vg-humid', '52', { unc: 3, note: 'Valeur exploitant, non mesurée' }], ['vg-purge', 'Manuelle'], ['vg-calo', 'Dégradé', { note: 'Vannes et brides du collecteur nues' }]]);
  ck(comp, [['all-plaque', true], ['ca-vev', 'Non', { note: 'Deux machines à vitesse fixe' }], ['ca-regul', 'Charge / vide'], ['ca-vide', '35', { unc: 10, note: 'Compteurs heures en charge / totales' }],
    ['ca-pbesoin', '6,5', { unc: 3 }], ['ca-recup', 'Non'], ['ca-aspiration', 'Non', { note: 'Aspiration dans le local à 38 °C' }], ['ca-arret', 'Non'], ['ca-purgeurs', 'Temporisés']]);
  ck(froid, [['gf-consigne', 'Oui', { note: 'Besoin fermentation à 10 °C : consigne relevable de 7 à 9 °C' }], ['gf-dt', '5', { unc: 0.5 }], ['gf-vev', 'Non'], ['gf-condenseur', 'Encrassé']]);
  await Promise.all(all.map((u) => save('utilities', u)));

  const L = [[pelec, rel, 'electricite'], [pv, rel, 'electricite'], [ge, rel, 'electricite'], [chaud, rv, 'vapeur'], [rv, col, 'vapeur'], [froid, rg, 'eau_glacee'], [rg, ferm, 'eau_glacee'], [rg, clim, 'eau_glacee'],
    [comp, ra, 'air_comprime'], [ra, col, 'air_comprime'], [tour, rt, 'eau_tour'], [rt, froid, 'eau_tour'], [rt, col, 'eau_tour'],
    [rel, froid, 'electricite'], [rel, comp, 'electricite'], [rel, tour, 'electricite'], [rel, mot, 'electricite'], [rel, clim, 'electricite'], [rel, ecl, 'electricite'], [rel, eff, 'electricite']];
  for (const [a, b, c] of L) await save('links', newLink(deviceId, audit.id, a.id, b.id, c));

  await save('notes', newNote(deviceId, audit.id, chaud.id, 'Rendement combustion mesuré à 68 % avec 8 % d’O₂ : excès d’air important. Purgeurs et brides non isolés sur le collecteur vapeur.', 'anomalie'));
  await save('notes', newNote(deviceId, audit.id, chaud.id, 'Piste : réglage de la combustion + économiseur sur fumées + calorifugeage des vannes et brides.', 'aape'));
  await save('notes', newNote(deviceId, audit.id, comp.id, 'Fuites audibles sur la distribution atelier B ; consigne 7,5 bar pour un besoin réel proche de 6,5 bar. Pas de récupération de chaleur.', 'aape'));
  await save('notes', newNote(deviceId, audit.id, ge.id, 'Environ 12 coupures SEI par an. Demander le relevé des coupures et la consommation de gazole des 3 dernières années.', 'donnee'));
  await save('notes', newNote(deviceId, audit.id, froid.id, 'Poser un wattmètre sur le groupe froid pendant 1 semaine en campagne pour valider le COP réel (T° ext. 33 °C).', 'mesure'));
  await save('notes', newNote(deviceId, audit.id, null, 'Visite en production nominale (campagne). Compteurs divisionnaires uniquement sur la chaufferie. Climat : 24 °C et 75 % d’humidité en moyenne, pointes à 33 °C.', 'observation'));

  for (const [u, label, hue, cap] of [[chaud, 'Chaudière bagasse', 20, 'Plaque signalétique'], [comp, 'Compresseurs', 200, 'Local compresseurs'], [null, 'Vue du site', 150, 'Vue générale']]) {
    const blob = await fakePhoto(label, hue);
    const p = newPhoto(deviceId, audit.id, u?.id, { caption: cap, width: 1200, height: 900, size: blob.size });
    await store.putBlob(p.id, blob); await save('photos', p);
  }
  return audit.id;
}
