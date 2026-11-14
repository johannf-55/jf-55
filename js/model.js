// Modèle de données : constantes métier et fabriques d'enregistrements.
// Aucune dépendance au DOM (importable depuis Node pour les tests).

export const SCHEMA_VERSION = 1;

export const FAMILIES = {
  production:   { label: 'Production',   long: 'Production d’énergie',      prefix: 'P', color: '#004993' }, // bleu foncé Carbone
  distribution: { label: 'Distribution', long: 'Réseaux de distribution',   prefix: 'R', color: '#54788B' }, // gris-bleu
  consommation: { label: 'Consommation', long: 'Utilités consommatrices',   prefix: 'C', color: '#2E9B78' }, // vert Carbone (foncé pour le contraste)
};

// Vecteurs énergétiques : adaptés aux sites industriels de l'océan Indien (GPL/butane plutôt que gaz naturel, bagasse, fioul lourd, charbon)
export const CARRIERS = {
  electricite:  { label: 'Électricité',            color: '#D4A200' },
  gpl:          { label: 'GPL / butane',           color: '#7C5CBF' },
  gaz:          { label: 'Gaz naturel / biogaz',   color: '#9775FA' },
  fioul:        { label: 'Fioul / gazole',         color: '#6B4F3A' },
  fioul_lourd:  { label: 'Fioul lourd (HFO)',      color: '#3D2B1F' },
  charbon:      { label: 'Charbon',                color: '#212529' },
  biomasse:     { label: 'Biomasse / bagasse',     color: '#5B8C2A' },
  solaire:      { label: 'Solaire',                color: '#F08C00' },
  vapeur:       { label: 'Vapeur',                 color: '#E03131' },
  eau_chaude:   { label: 'Eau chaude',             color: '#E8590C' },
  eau_glacee:   { label: 'Eau glacée',             color: '#1C7ED6' },
  eau_tour:     { label: 'Eau de refroidissement', color: '#0CA678' },
  air_comprime: { label: 'Air comprimé',           color: '#0B7285' },
  eau:          { label: 'Eau (process)',          color: '#3B9AE1' },
  carburant:    { label: 'Carburant (transport)',  color: '#495057' },
  autre:        { label: 'Autre',                  color: '#868E96' },
};

// Catégories de commentaires : alimentent directement la rédaction du rapport (anomalies, AAPE, mesures, données à demander)
export const NOTE_CATS = {
  observation: { label: 'Observation',              color: '#44546A' },
  anomalie:    { label: 'Anomalie',                 color: '#C92A2A' },
  aape:        { label: 'Piste d’économie (AAPE)',  color: '#2E9B78' },
  mesure:      { label: 'Mesure à prévoir',         color: '#1C7ED6' },
  donnee:      { label: 'Donnée à demander',        color: '#E67700' },
};

export const TERRITORIES = ['La Réunion', 'Mayotte', 'Madagascar', 'Maurice', 'Autre territoire tropical', 'Hors zone tropicale'];
export const GRIDS = ['EDF SEI (La Réunion)', 'EDM (Mayotte)', 'JIRAMA (Madagascar)', 'CEB (Maurice)', 'Réseau privé / autoproduction', 'Autre'];

export const STATUSES = ['En service', 'À l’arrêt', 'Projet', 'À vérifier'];
export const AUDIT_TYPES = { industrie: 'Industrie / procédé (16247-3)', multi: 'Industrie + bâtiments', batiment: 'Bâtiment (16247-2)', transport: 'Transport (16247-4)' };

// Champs spécifiques par type d'utilité. Les valeurs sont stockées dans `specs{clé:valeur}`.
const f = (k, label, unit = '', num = !!unit) => ({ k, label, unit, num });
const n = (k, label, unit = '') => f(k, label, unit, true); // champ numérique sans unité (COP, nombre…)

export const KINDS = [
  // --- Production d'énergie
  { id: 'vapeur_gen', family: 'production', label: 'Chaudière / générateur de vapeur', in: 'biomasse', out: 'vapeur',
    fields: [f('combustible', 'Combustible (bagasse, fioul, GPL, charbon…)'), f('pression', 'Pression', 'bar'), f('debit', 'Débit vapeur', 't/h'), f('t_eau', 'T° eau d’alimentation', '°C'), f('retour_cond', 'Retour condensats', '%'), f('rendement', 'Rendement', '%'), f('o2', 'O₂ fumées', '%')] },
  { id: 'chaudiere', family: 'production', label: 'Chaudière eau chaude / fluide thermique', in: 'gpl', out: 'eau_chaude',
    fields: [f('combustible', 'Combustible'), f('t_depart', 'T° départ', '°C'), f('t_retour', 'T° retour', '°C'), f('rendement', 'Rendement', '%'), f('bruleur', 'Brûleur (type, modulant ?)')] },
  { id: 'groupe_froid', family: 'production', label: 'Groupe froid / production d’eau glacée', in: 'electricite', out: 'eau_glacee',
    fields: [f('fluide', 'Fluide frigorigène'), n('cop', 'COP / EER'), f('t_depart', 'T° départ', '°C'), f('t_retour', 'T° retour', '°C'), f('condenseur', 'Condenseur (air / eau / évaporatif)'), f('compresseur', 'Compresseur (vis, scroll, piston, centrifuge)'), f('regulation', 'Régulation (VEV, étagée…)'), f('t_ext', 'T° extérieure de dimensionnement', '°C')] },
  { id: 'tour', family: 'production', label: 'Tour aéroréfrigérante / condenseur évaporatif', in: 'electricite', out: 'eau_tour',
    fields: [f('puissance_therm', 'Puissance évacuée', 'kW'), f('t_entree', 'T° eau entrée', '°C'), f('t_sortie', 'T° eau sortie', '°C'), f('approche', 'Approche (T° eau – T° humide)', 'K'), f('ventilateurs', 'Ventilateurs (nb, VEV)'), f('traitement', 'Traitement d’eau / purges')] },
  { id: 'compresseur', family: 'production', label: 'Compresseur d’air', in: 'electricite', out: 'air_comprime',
    fields: [f('pression', 'Pression', 'bar'), f('debit', 'Débit FAD', 'm³/h'), f('regulation', 'Régulation (charge/vide, VEV…)'), f('recup', 'Récupération de chaleur ?'), f('charge', 'Taux de charge moyen', '%'), f('t_aspiration', 'T° d’aspiration', '°C')] },
  { id: 'poste_elec', family: 'production', label: 'Poste de livraison électrique', in: 'electricite', out: 'electricite',
    fields: [f('tension', 'Tension', 'kV'), f('ps', 'Puissance souscrite', 'kVA'), f('tarif', 'Option tarifaire'), f('transfos', 'Transformateurs (nb × kVA)'), f('cosphi', 'cos φ / compensation')] },
  { id: 'groupe_elec', family: 'production', label: 'Groupe électrogène / secours', in: 'fioul', out: 'electricite',
    fields: [f('p_elec', 'Puissance', 'kVA'), f('conso', 'Consommation annuelle', 'L/an'), f('coupures', 'Coupures réseau', 'nb/an'), f('h_fct', 'Heures de fonctionnement', 'h/an'), f('usage', 'Usage (secours, écrêtage, autoproduction)')] },
  { id: 'cogen', family: 'production', label: 'Cogénération / turbo-alternateur', in: 'biomasse', out: 'electricite',
    fields: [f('p_elec', 'Puissance électrique', 'kW'), f('p_therm', 'Puissance thermique', 'kW'), f('rend_elec', 'Rendement électrique', '%'), f('rend_therm', 'Rendement thermique', '%'), f('contrat', 'Contrat de rachat / autoconsommation')] },
  { id: 'pv', family: 'production', label: 'Centrale photovoltaïque', in: 'solaire', out: 'electricite',
    fields: [f('kwc', 'Puissance crête', 'kWc'), f('surface', 'Surface', 'm²'), f('orientation', 'Orientation / inclinaison'), f('autoconso', 'Taux d’autoconsommation', '%'), f('productible', 'Productible', 'kWh/kWc/an'), f('stockage', 'Stockage (batterie)'), f('onduleur', 'Onduleur(s)')] },
  { id: 'solaire_th', family: 'production', label: 'Solaire thermique / chauffe-eau solaire', in: 'solaire', out: 'eau_chaude',
    fields: [f('surface', 'Surface de capteurs', 'm²'), f('volume', 'Volume de stockage', 'L'), f('t_cons', 'T° de consigne', '°C'), f('appoint', 'Appoint (élec, GPL…)')] },
  { id: 'poste_gaz', family: 'production', label: 'Stockage / poste de livraison GPL ou gaz', in: 'gpl', out: 'gpl',
    fields: [f('stockage', 'Stockage (citerne, bouteilles)', 'm³'), f('pression', 'Pression aval', 'bar'), f('debit', 'Débit max', 'kg/h'), f('comptage', 'Comptage (type)')] },
  { id: 'autre_prod', family: 'production', label: 'Autre production', in: 'autre', out: 'autre', fields: [] },

  // --- Distribution
  { id: 'r_elec', family: 'distribution', label: 'Réseau électrique (HTA / BT)', in: 'electricite', out: 'electricite',
    fields: [f('tension', 'Tension', 'V'), f('tableau', 'Tableau / TGBT'), f('cosphi', 'cos φ'), f('harmoniques', 'Harmoniques / qualité'), f('comptage', 'Sous-comptage')] },
  { id: 'r_vapeur', family: 'distribution', label: 'Réseau vapeur et condensats', in: 'vapeur', out: 'vapeur',
    fields: [f('pression', 'Pression', 'bar'), f('dn', 'Diamètre', 'DN'), f('longueur', 'Longueur', 'm'), f('isolation', 'État de l’isolation'), f('purgeurs', 'Purgeurs (nb / état)'), f('retour_cond', 'Retour condensats ?')] },
  { id: 'r_eau_chaude', family: 'distribution', label: 'Réseau eau chaude', in: 'eau_chaude', out: 'eau_chaude',
    fields: [f('t_depart', 'T° départ', '°C'), f('t_retour', 'T° retour', '°C'), f('pompes', 'Pompes (nb, puissance, VEV)'), f('isolation', 'État de l’isolation'), f('longueur', 'Longueur', 'm')] },
  { id: 'r_eau_glacee', family: 'distribution', label: 'Réseau eau glacée', in: 'eau_glacee', out: 'eau_glacee',
    fields: [f('t_depart', 'T° départ', '°C'), f('t_retour', 'T° retour', '°C'), f('pompes', 'Pompes (nb, puissance, VEV)'), f('isolation', 'Isolation / condensation'), f('longueur', 'Longueur', 'm')] },
  { id: 'r_tour', family: 'distribution', label: 'Boucle d’eau de refroidissement', in: 'eau_tour', out: 'eau_tour',
    fields: [f('t_depart', 'T° départ', '°C'), f('t_retour', 'T° retour', '°C'), f('debit', 'Débit', 'm³/h'), f('pompes', 'Pompes (nb, puissance, VEV)'), f('appoint', 'Appoint d’eau', 'm³/an')] },
  { id: 'r_air', family: 'distribution', label: 'Réseau air comprimé', in: 'air_comprime', out: 'air_comprime',
    fields: [f('pression', 'Pression de réseau', 'bar'), f('fuites', 'Fuites estimées', '%'), f('longueur', 'Longueur', 'm'), f('secheur', 'Sécheur / filtration'), f('ballon', 'Volume de stockage', 'L')] },
  { id: 'r_gaz', family: 'distribution', label: 'Réseau GPL / gaz', in: 'gpl', out: 'gpl',
    fields: [f('pression', 'Pression', 'bar'), f('dn', 'Diamètre', 'DN'), f('longueur', 'Longueur', 'm'), f('comptage', 'Sous-comptage')] },
  { id: 'autre_dist', family: 'distribution', label: 'Autre réseau', in: 'autre', out: 'autre', fields: [] },

  // --- Consommation
  { id: 'process_th', family: 'consommation', label: 'Procédé thermique (cuisson, évaporation, distillation, séchage)', in: 'vapeur', out: null,
    fields: [f('produit', 'Produit / opération'), f('t_process', 'T° de procédé', '°C'), f('cadence', 'Cadence / production annuelle'), f('regime', 'Régime (campagne, 3×8, 2×8…)'), f('conso_spec', 'Consommation spécifique')] },
  { id: 'process', family: 'consommation', label: 'Procédé électrique / ligne de production', in: 'electricite', out: null,
    fields: [f('produit', 'Produit fabriqué'), f('cadence', 'Cadence / production annuelle'), f('regime', 'Régime (campagne, 3×8, 2×8…)'), f('conso_spec', 'Consommation spécifique')] },
  { id: 'froid', family: 'consommation', label: 'Froid industriel (chambres, tunnels, cuves)', in: 'electricite', out: null,
    fields: [f('temperature', 'T° de consigne', '°C'), f('volume', 'Volume', 'm³'), f('fluide', 'Fluide'), f('degivrage', 'Dégivrage (type)'), f('portes', 'Étanchéité (portes, rideaux)')] },
  { id: 'moteurs', family: 'consommation', label: 'Moteurs / pompes / ventilateurs / convoyeurs', in: 'electricite', out: null,
    fields: [n('nb', 'Nombre'), f('classe', 'Classe de rendement (IE)'), f('vev', 'Variateur ?'), f('charge', 'Charge moyenne', '%'), f('debit', 'Débit / HMT')] },
  { id: 'cta', family: 'consommation', label: 'CTA / ventilation / extraction', in: 'electricite', out: null,
    fields: [f('debit', 'Débit', 'm³/h'), f('recup', 'Récupération de chaleur (type, rendement)'), f('vev', 'Variateur ?'), f('plage', 'Plage de fonctionnement'), f('deshum', 'Déshumidification (charge latente)')] },
  { id: 'clim', family: 'consommation', label: 'Climatisation / confort thermique des locaux', in: 'electricite', out: null,
    fields: [f('surface', 'Surface desservie', 'm²'), f('consigne', 'Consigne', '°C'), f('systeme', 'Système (split, DRV, groupe d’eau glacée)'), f('regulation', 'Régulation / programmation'), f('envelope', 'Enveloppe (isolation, protections solaires)')] },
  { id: 'eclairage', family: 'consommation', label: 'Éclairage', in: 'electricite', out: null,
    fields: [f('techno', 'Technologie (LED, fluo, sodium…)'), n('nb', 'Nombre de points'), f('w_point', 'Puissance unitaire', 'W'), f('pilotage', 'Pilotage (détection, gradation)'), f('lux', 'Niveau mesuré', 'lux')] },
  { id: 'eau_traitement', family: 'consommation', label: 'Traitement d’eau / effluents (aération, pompage)', in: 'electricite', out: null,
    fields: [f('debit', 'Débit traité', 'm³/j'), f('aeration', 'Aération (type, VEV)'), f('charge', 'Charge (DCO)', 'kg/j'), f('biogaz', 'Valorisation biogaz ?')] },
  { id: 'ecs', family: 'consommation', label: 'Eau chaude sanitaire', in: 'solaire', out: null,
    fields: [f('volume', 'Volume de stockage', 'L'), f('t_stock', 'T° de stockage', '°C'), f('bouclage', 'Bouclage ?'), f('appoint', 'Appoint')] },
  { id: 'it', family: 'consommation', label: 'Informatique / salle serveurs / bureaux', in: 'electricite', out: null,
    fields: [n('baies', 'Nombre de baies'), n('pue', 'PUE estimé'), f('clim', 'Refroidissement')] },
  { id: 'vehicules', family: 'consommation', label: 'Flotte / engins / transport interne', in: 'carburant', out: null,
    fields: [f('type', 'Type de véhicules'), n('nb', 'Nombre'), f('km', 'Distance annuelle', 'km/an'), f('conso', 'Consommation moyenne', 'L/100 km')] },
  { id: 'autre_conso', family: 'consommation', label: 'Autre consommateur', in: 'electricite', out: null, fields: [] },
];

// ---- Incertitudes -----------------------------------------------------------
// Saisie en % de la valeur (relative), sauf pour les températures (°C, K) et les pourcentages (en points) : absolue.
// Valeur par défaut : 0 (incertitude nulle). Stockage : u.unc = { powerKw: 5, hours: 10, 's:debit': 3 } (clé 's:' = caractéristique).
export const uncAbsolute = (unit) => ['°C', 'K', '%'].includes(unit);
export const uncSuffix = (unit) => (unit === '%' ? 'pts' : uncAbsolute(unit) ? unit : '%');
export const parseNum = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
/** Incertitude d'une valeur : { saisie, mode, abs, rel } (abs dans l'unité de la valeur, rel en %). */
export function uncertainty(value, unc, unit) {
  const u = parseNum(unc) ?? 0, v = parseNum(value);
  if (uncAbsolute(unit)) return { saisie: u, mode: 'absolue', abs: u, rel: v ? Math.round((u / Math.abs(v)) * 1e4) / 100 : null };
  return { saisie: u, mode: 'relative', rel: u, abs: v === null ? null : Math.round(Math.abs(v) * u) / 100 };
}

// ---- Heures de fonctionnement --------------------------------------------------
/** Base de calcul des heures/an : h/jour × jours/semaine × semaines/an (traçabilité de l'hypothèse). */
export const hoursFromBasis = (b) => (b && b.hpd && b.dpw && b.wpy ? Math.round(b.hpd * b.dpw * b.wpy) : null);
export const basisText = (b) => (b && b.hpd ? `${String(b.hpd).replace('.', ',')} h/j × ${String(b.dpw).replace('.', ',')} j/sem × ${String(b.wpy).replace('.', ',')} sem/an${b.note ? ' — ' + b.note : ''}` : '');

export const kindById = (id) => KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];
export const kindsOf = (family) => KINDS.filter((k) => k.family === family);

export const uid = () => (globalThis.crypto?.randomUUID?.() ?? 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---- Fabriques -------------------------------------------------------------
const base = (deviceId) => ({ id: uid(), createdAt: Date.now(), updatedAt: Date.now(), deviceId, deleted: false });

export function newAudit(deviceId, p = {}) {
  return { ...base(deviceId), name: p.name || 'Nouvel audit', client: '', site: '', address: '', auditor: '',
    territory: 'La Réunion', activity: '', grid: 'EDF SEI (La Réunion)', tAmb: null, rh: null, seasonality: '',
    date: new Date().toISOString().slice(0, 10), type: 'industrie', norm: 'NF EN 16247', ...p };
}

export function newUtility(deviceId, auditId, kindId, existing = []) {
  const k = kindById(kindId);
  const n = existing.filter((u) => u.family === k.family && !u.deleted).length + 1;
  return { ...base(deviceId), auditId, family: k.family, kind: kindId,
    tag: `${FAMILIES[k.family].prefix}-${String(n).padStart(2, '0')}`, name: '', location: '', status: 'En service',
    carrierIn: k.in, carrierOut: k.out, powerKw: null, year: null, brand: '', model: '', hours: null, metering: '', specs: {} };
}

export const newLink = (deviceId, auditId, fromId, toId, carrier, comment = '') => ({ ...base(deviceId), auditId, fromId, toId, carrier, comment });
export const newNote = (deviceId, auditId, utilityId, text, category = 'observation') => ({ ...base(deviceId), auditId, utilityId: utilityId || null, text, category });
export const newPhoto = (deviceId, auditId, utilityId, p) => ({ ...base(deviceId), auditId, utilityId: utilityId || null, caption: '', takenAt: Date.now(), mime: 'image/jpeg', ...p });

export const utilityLabel = (u) => `${u.tag}${u.name ? ' · ' + u.name : ''}`;
