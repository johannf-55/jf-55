// Base par défaut des points de contrôle (checklists) par type d'utilité.
// Chaque point : id stable, kind (id de type d'utilité, « * » = toutes les utilités), q (question),
// type de réponse (check | oui_non | choix | nombre | texte), opts (choix), unit (nombre), why (intérêt énergétique).
// Les ordres de grandeur indiqués sont des repères usuels de terrain, à confirmer par la mesure.
// Cette base est modifiable dans l'application (Réglages -> Base de checklists) ; les modifications sont synchronisées.

const C = [];
let kindCur = '*', ord = 0;
const K = (kind) => { kindCur = kind; ord = 0; };
const add = (id, type, q, why, extra = {}) => C.push({ id, kind: kindCur, order: (ord += 10), type, q, why, opts: [], unit: '', ...extra });
const ck = (id, q, why) => add(id, 'check', q, why);
const yn = (id, q, why) => add(id, 'oui_non', q, why);
const ch = (id, q, opts, why) => add(id, 'choix', q, why, { opts });
const nb = (id, q, unit, why) => add(id, 'nombre', q, why, { unit });
const tx = (id, q, why) => add(id, 'texte', q, why);
const ETAT = ['Bon', 'Moyen', 'Dégradé', 'Absent'];
const PROPRE = ['Propre', 'Encrassé', 'Très encrassé'];

// ---------------------------------------------------------------- Points communs à toutes les utilités
K('*');
ck('all-plaque', 'Plaque signalétique photographiée', 'Puissance, rendement nominal et année : base des calculs et de l’inventaire.');
ch('all-comptage', 'Comptage de l’énergie consommée par cette utilité', ['Aucun', 'Compteur non relevé', 'Relevé manuel', 'Télérelevé / GTC'], 'Sans comptage, la consommation est estimée (puissance × heures × charge) : incertitude élevée. Piste de plan de comptage.');
yn('all-hors-prod', 'Fonctionne-t-elle hors production (nuits, week-ends, intercampagne) ?', 'Consommation sans valeur ajoutée : arrêt programmé ou asservi à la production, souvent sans investissement.');
tx('all-heures-source', 'Source des heures de fonctionnement (compteur horaire, exploitant, estimation)', 'Les heures/an pèsent directement sur toutes les consommations calculées : en documenter l’origine (mesuré / estimé).');
tx('all-maintenance', 'Dernier entretien / contrat de maintenance', 'Un équipement mal entretenu perd du rendement (encrassement, réglages dérivés).');

// ---------------------------------------------------------------- Chaudière / générateur de vapeur
K('vapeur_gen');
yn('vg-analyse', 'Analyse de combustion récente disponible (O2, CO, T° fumées) ?', 'Indispensable pour calculer le rendement de combustion et l’excès d’air.');
nb('vg-tfumees', 'T° des fumées en sortie chaudière', '°C', 'Fumées chaudes = chaleur perdue. Repère : environ 1 % de rendement par tranche de 20 °C de fumées en moins. Au-delà de ~200 °C, étudier un économiseur.');
yn('vg-eco', 'Économiseur sur les fumées (préchauffage de l’eau alimentaire) ?', 'Récupère couramment 4 à 6 % de l’énergie du combustible.');
yn('vg-rechair', 'Réchauffeur d’air de combustion ?', 'Autre voie de récupération sur les fumées, fréquente sur les chaudières bagasse.');
ch('vg-regul', 'Régulation de la combustion', ['Manuelle / fixe', 'Came mécanique', 'Régulation O2 (trim)', 'Non applicable'], 'Une régulation O2 maintient l’excès d’air au minimum quelle que soit la charge.');
nb('vg-humid', 'Humidité du combustible (bagasse, biomasse)', '%', 'Chaque point d’humidité réduit le PCI et le rendement ; la bagasse sort souvent autour de 50 %. Séchage par les fumées possible.');
ch('vg-purge', 'Purge de déconcentration', ['Manuelle', 'Automatique sans récupération', 'Automatique avec récupération (flash / échangeur)'], 'La chaleur de la purge continue est récupérable (souvent 1 à 3 % du combustible).');
nb('vg-taux-purge', 'Taux de purge (ou TDS chaudière)', '%', 'Une purge excessive jette de l’eau chaude traitée ; à ajuster sur la conductivité.');
yn('vg-bache', 'Bâche alimentaire et dégazeur calorifugés ?', 'Pertes thermiques permanentes ; repère : environ 1 % de combustible par 6 °C d’eau alimentaire en plus.');
ch('vg-calo', 'Calorifugeage de la chaudière (façade, portes, vannes, brides)', ETAT, 'Parois et accessoires nus : pertes permanentes, y compris en veille.');
yn('vg-veille', 'Chaudière maintenue en pression sans besoin (veille chaude) ?', 'Pertes à l’arrêt et purges : à limiter hors campagne / hors production.');
yn('vg-pression', 'Pression de production supérieure au besoin le plus exigeant ?', 'Une pression plus basse réduit les pertes (fuites, revaporisation, rayonnement).');
ch('vg-nb', 'Nombre de chaudières en service par rapport au besoin', ['Adapté', 'Une chaudière de trop (faible charge)', 'À vérifier'], 'Une chaudière à faible charge a un rendement dégradé ; mieux vaut moins de chaudières bien chargées.');

// ---------------------------------------------------------------- Chaudière eau chaude / fluide thermique
K('chaudiere');
yn('ch-analyse', 'Analyse de combustion récente disponible ?', 'Base du calcul de rendement de combustion.');
nb('ch-tfumees', 'T° des fumées', '°C', 'Repère : environ 1 % de rendement par tranche de 20 °C en moins.');
ch('ch-bruleur', 'Type de brûleur', ['Tout ou rien', '2 allures', 'Modulant'], 'Un brûleur tout ou rien cycle beaucoup (pertes à chaque démarrage, balayage).');
nb('ch-cycles', 'Nombre de démarrages par heure observés', 'nb/h', 'Cyclage court = surdimensionnement ou régulation inadaptée.');
yn('ch-consigne', 'T° de départ supérieure au besoin réel ?', 'Réduire la T° de départ diminue les pertes de distribution et améliore le rendement.');
ch('ch-calo', 'Calorifugeage chaudière, vannes et brides', ETAT, 'Pertes permanentes évitables.');
yn('ch-pompe-vev', 'Pompes de circulation à vitesse variable ?', 'Le débit suit le besoin ; puissance de pompage fortement réduite à charge partielle.');

// ---------------------------------------------------------------- Groupe froid / eau glacée
K('groupe_froid');
nb('gf-tcond', 'T° (ou pression) de condensation relevée', '°C', 'Chaque kelvin de condensation en moins réduit la consommation du compresseur d’environ 2 à 3 %.');
nb('gf-tevap', 'T° (ou pression) d’évaporation relevée', '°C', 'Chaque kelvin d’évaporation en plus réduit la consommation d’environ 2 à 3 %.');
yn('gf-consigne', 'Consigne d’eau glacée relevable (besoin réel moins froid) ?', 'Remonter la consigne de 1 K fait gagner de l’ordre de 2 à 3 % ; vérifier le besoin des utilisateurs.');
nb('gf-dt', 'Écart départ / retour d’eau glacée observé', 'K', 'Un faible écart (< 4 K) signale un débit excessif : pompage inutile et groupes mal chargés.');
ch('gf-condenseur', 'État du condenseur (ailettes, tubes)', PROPRE, 'Encrassement, poussière ou corrosion saline (zone littorale tropicale) font monter la condensation.');
yn('gf-soleil', 'Condenseur à air exposé au soleil ou recyclant son air chaud ?', 'Air d’entrée plus chaud = condensation plus haute = surconsommation, surtout en saison chaude.');
yn('gf-vev', 'Compresseur(s) à vitesse variable ?', 'Meilleur rendement à charge partielle, qui représente l’essentiel des heures.');
ch('gf-sequence', 'Gestion des groupes multiples', ['Un seul groupe', 'Aucune (tous en marche)', 'Manuelle', 'Séquenceur automatique'], 'Faire tourner le bon nombre de groupes à bonne charge.');
yn('gf-recup', 'Récupération de chaleur (désurchauffe / condenseur) pour ECS ou procédé ?', 'Chaleur gratuite pour l’eau chaude, à proximité de besoins de lavage ou de préchauffage.');
yn('gf-fluide', 'Fluide interdit ou à fort PRG (R22, R404A…) à remplacer ?', 'Le remplacement est une occasion de passer à un groupe plus performant.');
tx('gf-etancheite', 'Dernier contrôle d’étanchéité / charge en fluide', 'Un manque de fluide dégrade fortement le COP.');
nb('gf-charge', 'Taux de charge moyen estimé', '%', 'Pour estimer la consommation et le dimensionnement réel.');

// ---------------------------------------------------------------- Tour aéroréfrigérante
K('tour');
ch('to-vent', 'Pilotage des ventilateurs', ['Tout ou rien', 'Étagé (plusieurs vitesses)', 'Vitesse variable'], 'Ventilateurs à vitesse variable : la puissance varie comme le cube de la vitesse.');
ch('to-garnissage', 'État du garnissage, des buses et des bassins', ['Bon', 'Entartré / encrassé', 'Dégradé'], 'Garnissage encrassé = approche dégradée = condensation plus haute des groupes froids.');
nb('to-cycles', 'Taux de concentration (cycles)', 'nb', 'Un faible nombre de cycles surconsomme de l’eau et des produits de traitement.');
yn('to-purge', 'Purge asservie à la conductivité ?', 'Évite les purges excessives (eau et énergie de pompage).');
yn('to-appoint', 'Compteur d’eau d’appoint relevé ?', 'Suivi de l’eau évaporée et des purges.');
yn('to-flottante', 'Consigne d’eau de tour flottante (la plus basse utile) ?', 'Une eau de tour plus froide abaisse la condensation des groupes : gain sur les compresseurs supérieur au surcoût des ventilateurs.');

// ---------------------------------------------------------------- Compresseur d'air
K('compresseur');
yn('ca-vev', 'Compresseur(s) à vitesse variable ?', 'Un compresseur à vitesse variable suit la demande sans marche à vide ; gain souvent de 15 à 30 % sur un profil variable.');
ch('ca-regul', 'Mode de régulation', ['Charge / vide', 'Tout ou rien', 'Vitesse variable', 'Modulation à l’aspiration'], 'En charge / vide, un compresseur à vide consomme encore 20 à 40 % de sa puissance.');
nb('ca-vide', 'Part du temps de marche à vide', '%', 'Relevé sur les compteurs heures en charge / heures totales. Énergie perdue.');
nb('ca-pbesoin', 'Pression requise par l’utilisateur le plus exigeant', 'bar', 'Repère : environ 7 % d’énergie par bar de pression en moins.');
yn('ca-sequenceur', 'Séquenceur / gestion centralisée des compresseurs ?', 'Évite que plusieurs machines tournent à faible charge ou à vide.');
yn('ca-recup', 'Récupération de chaleur (eau chaude, préchauffage) ?', 'Jusqu’à 70-90 % de l’électricité absorbée est récupérable sous forme de chaleur.');
yn('ca-aspiration', 'Aspiration d’air frais (extérieur, à l’ombre) ?', 'Air aspiré plus frais : environ 1 % gagné par 3 °C en moins ; en local chaud tropical l’écart dépasse souvent 10 °C.');
nb('ca-tlocal', 'T° du local compresseurs', '°C', 'Local surchauffé : air plus chaud, pannes, sécheurs surchargés.');
yn('ca-arret', 'Arrêt automatique hors production (nuits, week-ends) ?', 'Les fuites et la marche à vide continuent sinon toute la nuit.');
ch('ca-purgeurs', 'Purgeurs de condensats', ['Électroniques sans perte d’air', 'Temporisés', 'Flotteur', 'Vanne manuelle ouverte'], 'Une purge temporisée ou une vanne ouverte rejette de l’air comprimé en continu.');
nb('ca-ratio', 'Ratio spécifique mesuré ou constructeur', 'kWh/m³', 'Indicateur de performance de la production (repère : ~0,10 à 0,12 kWh/m³ à 7 bar pour une installation performante).');
ch('ca-filtres', 'Filtres d’aspiration', PROPRE, 'Filtres colmatés : perte de charge et surconsommation.');

// ---------------------------------------------------------------- Poste de livraison électrique
K('poste_elec');
yn('pe-cdc', 'Courbe de charge 10 min disponible (12 mois) ?', 'Base de l’analyse de la puissance souscrite, des talons nocturnes et des profils.');
nb('pe-pmax', 'Puissance maximale atteinte sur 12 mois', 'kVA', 'À comparer à la puissance souscrite : optimisation tarifaire.');
yn('pe-depassements', 'Dépassements de puissance facturés ?', 'Pénalités évitables par ajustement de la puissance souscrite ou délestage.');
yn('pe-reactif', 'Énergie réactive facturée ?', 'Vérifier le seuil contractuel (souvent tan phi 0,4) et la batterie de condensateurs.');
ch('pe-condensateurs', 'Batterie de condensateurs', ['Absente', 'Présente, en service', 'Présente, hors service', 'À vérifier'], 'Une batterie défaillante entraîne des pénalités de réactif et des pertes.');
yn('pe-transfos', 'Transformateur(s) faiblement chargé(s) laissé(s) sous tension ?', 'Pertes à vide permanentes, même sans consommation.');
nb('pe-talon', 'Talon de puissance nocturne / hors production', 'kW', 'Consommation résiduelle à expliquer : gisement fréquent.');

// ---------------------------------------------------------------- Groupe électrogène
K('groupe_elec');
nb('ge-csp', 'Consommation spécifique', 'L/kWh', 'Un groupe sous-chargé consomme beaucoup plus par kWh produit.');
nb('ge-charge', 'Taux de charge en fonctionnement', '%', 'Rendement dégradé sous ~50 % de charge.');
yn('ge-prechauffage', 'Préchauffage permanent du moteur (résistance) ?', 'Consommation électrique permanente souvent oubliée ; asservir à la température.');
yn('ge-ecretage', 'Utilisé en écrêtage / effacement de pointe ?', 'À évaluer selon le coût du gazole et le tarif (pointe, dépassements).');

// ---------------------------------------------------------------- Cogénération / turbo-alternateur
K('cogen');
ch('co-type', 'Type de turbine', ['Contre-pression', 'Condensation', 'Soutirage-condensation', 'Moteur'], 'Détermine la part de chaleur valorisable.');
nb('co-dispo', 'Taux de disponibilité sur la campagne / l’année', '%', 'Les arrêts imposent d’acheter l’électricité ou de démarrer le secours.');
yn('co-dissipation', 'Chaleur dissipée sans valorisation (aéroréfrigérant, condenseur) ?', 'Chaleur perdue : piste de valorisation (procédé, froid à absorption…).');
yn('co-comptage', 'Comptage électricité produite et vapeur consommée ?', 'Nécessaire pour suivre le rendement global.');
tx('co-export', 'Excédents exportés / contrat', 'Valorisation des excédents et cohérence avec l’autoconsommation.');

// ---------------------------------------------------------------- Photovoltaïque
K('pv');
yn('pv-monitoring', 'Suivi de production (monitoring) en place ?', 'Sans suivi, une panne d’onduleur peut passer inaperçue des mois.');
nb('pv-ecart', 'Écart production réelle / productible attendu', '%', 'Révèle salissure, ombrage, défauts d’onduleurs.');
ch('pv-salissure', 'Ombrages et salissures des modules', ['Aucun', 'Léger', 'Important'], 'Poussière, dépôts salins et végétation réduisent la production.');
yn('pv-defaut', 'Onduleur(s) en défaut ou alarmes ?', 'Production perdue.');
yn('pv-bridage', 'Bridage ou injection limitée (surplus perdu) ?', 'Recaler les usages (froid, pompage, eau chaude) sur la production solaire.');

// ---------------------------------------------------------------- Solaire thermique
K('solaire_th');
ch('st-etat', 'État des capteurs et du calorifuge des circuits', ETAT, 'Calorifuge dégradé par les UV : pertes importantes.');
yn('st-regul', 'Circulateur et régulation différentielle fonctionnels ?', 'Installation souvent à l’arrêt sans que personne ne le remarque.');
yn('st-appoint', 'Appoint en marche permanente (court-circuite le solaire) ?', 'L’appoint doit intervenir après le solaire, pas avant.');
yn('st-surchauffe', 'Surchauffe / stagnation constatée ?', 'Surdimensionnement ou besoin réduit : dégradation du fluide et des capteurs.');
yn('st-comptage', 'Comptage de l’énergie solaire produite ?', 'Contrôle de la performance (et condition de certaines aides).');

// ---------------------------------------------------------------- Stockage / poste GPL ou gaz
K('poste_gaz');
yn('pg-comptage', 'Comptage par usage (chaufferie, procédé, cuisine…) ?', 'Répartition de la consommation de combustible.');
yn('pg-vaporiseur', 'Vaporiseur / réchauffeur électrique ?', 'Consommation électrique associée au GPL.');
tx('pg-prix', 'Prix d’achat et fournisseur (€/t ou €/kg)', 'Donnée nécessaire au chiffrage des actions.');

// ---------------------------------------------------------------- Réseau électrique
K('r_elec');
yn('re-thermo', 'Thermographie des tableaux réalisée ?', 'Échauffements = pertes et risques.');
nb('re-thd', 'Taux de distorsion harmonique en courant (THDi)', '%', 'Harmoniques : pertes, échauffements, déclenchements.');
yn('re-desequilibre', 'Déséquilibre de phases constaté ?', 'Pertes et échauffements dans les câbles et transformateurs.');
tx('re-souscomptage', 'Points de sous-comptage à créer', 'Plan de comptage pour le suivi des usages significatifs.');

// ---------------------------------------------------------------- Réseau vapeur et condensats
K('r_vapeur');
nb('rv-nonisole', 'Longueur de tuyauterie non calorifugée', 'm', 'Une tuyauterie vapeur nue perd plusieurs centaines de W par mètre.');
nb('rv-singul', 'Nombre de vannes, brides et singularités non calorifugées', 'nb', 'Matelas isolants démontables : retour rapide.');
yn('rv-purg-prog', 'Programme de contrôle des purgeurs (ultrasons, thermographie) ?', 'Un purgeur fuyard laisse passer de la vapeur vive en continu.');
nb('rv-purg-def', 'Part de purgeurs défectueux estimée', '%', 'Souvent 15 à 30 % sans programme de contrôle.');
nb('rv-fuites', 'Nombre de fuites de vapeur visibles', 'nb', 'Chaque panache visible représente une perte permanente.');
yn('rv-flash', 'Récupération de la vapeur de revaporisation (flash) ?', 'Valorise l’énergie des condensats haute pression.');
yn('rv-antennes', 'Antennes mortes ou tronçons inutilisés maintenus en pression ?', 'Pertes sans usage : isoler ou supprimer.');
nb('rv-retour', 'Taux de retour des condensats estimé', '%', 'Condensats perdus = eau traitée et chaleur perdues.');

// ---------------------------------------------------------------- Réseau eau chaude
K('r_eau_chaude');
ch('rc-calo', 'Calorifugeage du réseau', ETAT, 'Pertes en ligne.');
nb('rc-nonisole', 'Longueur non calorifugée', 'm', 'Pour chiffrer les pertes.');
nb('rc-dt', 'Écart départ / retour observé', 'K', 'Faible écart = débit excessif.');
yn('rc-nuit', 'Circulation maintenue la nuit sans besoin ?', 'Pertes de distribution et pompage inutiles.');

// ---------------------------------------------------------------- Réseau eau glacée
K('r_eau_glacee');
yn('rg-condensation', 'Condensation / ruissellement visible sur les tuyauteries ?', 'Pare-vapeur défaillant : apports de chaleur et dégradation de l’isolant (climat humide).');
nb('rg-nonisole', 'Longueur non isolée', 'm', 'Apports de chaleur à compenser par le groupe froid.');
nb('rg-dt', 'Écart départ / retour', 'K', 'Faible écart : débit excessif, pompage inutile.');
yn('rg-vev', 'Pompes à vitesse variable ?', 'La puissance de pompage varie comme le cube du débit.');
ch('rg-vannes', 'Vannes des émetteurs', ['3 voies (débit constant)', '2 voies (débit variable)', 'Mixte'], 'Les vannes 3 voies imposent un débit constant : pas d’économie de pompage possible.');
yn('rg-bypass', 'By-pass ouvert entre départ et retour ?', 'Mélange qui dégrade l’écart de température et le rendement des groupes.');

// ---------------------------------------------------------------- Boucle d'eau de refroidissement
K('r_tour');
yn('rt-vev', 'Pompes à vitesse variable ?', 'Adapter le débit au besoin.');
yn('rt-laminage', 'Débit réglé par vanne partiellement fermée (laminage) ?', 'Énergie de pompage dissipée dans la vanne : rognage de roue ou variateur.');
ch('rt-echangeurs', 'État des échangeurs (encrassement, perte de charge)', PROPRE, 'Encrassement : moins d’échange, plus de pompage.');
yn('rt-appoint', 'Consommation d’eau d’appoint suivie ?', 'Détection des fuites et des purges excessives.');

// ---------------------------------------------------------------- Réseau air comprimé
K('r_air');
ch('ra-detection', 'Dernière campagne de détection de fuites (ultrasons)', ['Jamais', 'Plus d’un an', 'Moins d’un an'], 'Les fuites représentent souvent 20 à 30 % du débit produit.');
nb('ra-vide', 'Puissance absorbée production à l’arrêt (mesure de fuites)', 'kW', 'Méthode simple pour quantifier les fuites : compresseurs en marche, ateliers à l’arrêt.');
nb('ra-dp', 'Chute de pression entre production et point le plus éloigné', 'bar', 'Une perte de charge élevée oblige à surélever la consigne.');
yn('ra-abus', 'Usages abusifs (soufflettes, refroidissement, nettoyage, agitation) ?', 'L’air comprimé est l’énergie la plus chère du site : substituer par soufflante, ventilateur, brosse.');
yn('ra-isolement', 'Vannes d’isolement des ateliers à l’arrêt ?', 'Couper les zones inutilisées supprime leurs fuites.');
yn('ra-purges', 'Purges manuelles laissées ouvertes ?', 'Perte d’air permanente.');
ch('ra-secheur', 'Sécheur', ['Aucun', 'Frigorifique', 'Adsorption sans pilotage', 'Adsorption piloté par point de rosée'], 'Un sécheur à adsorption non piloté consomme 15 à 20 % du débit pour sa régénération.');

// ---------------------------------------------------------------- Réseau GPL / gaz
K('r_gaz');
yn('rz-comptage', 'Sous-comptage par usage ?', 'Répartition des consommations.');
yn('rz-fuites', 'Contrôle d’étanchéité récent ?', 'Sécurité et pertes.');

// ---------------------------------------------------------------- Procédé thermique
K('process_th');
ch('pt-calo', 'Calorifugeage des équipements chauds (cuves, colonnes, échangeurs)', ETAT, 'Pertes permanentes pendant toute la campagne.');
yn('pt-recup', 'Chaleur récupérable sur effluents chauds (vinasses, buées, condensats) ?', 'Préchauffage de l’alimentation ou de l’eau : gisement majeur en distillerie et sucrerie.');
yn('pt-condensats', 'Condensats du procédé récupérés ?', 'Retour à la bâche : eau traitée et chaleur.');
yn('pt-couvercles', 'Bacs ou cuves chaudes ouverts (évaporation) ?', 'Les pertes par évaporation d’une surface libre chaude sont très élevées.');
yn('pt-marge', 'T° de procédé supérieure au besoin (marge de sécurité) ?', 'Chaque degré superflu se paie en vapeur.');
yn('pt-csp', 'Consommation spécifique suivie (vapeur ou kWh par unité produite) ?', 'Indicateur de performance énergétique (IPÉ) du procédé.');
yn('pt-vide', 'Chauffes à vide / maintien en température entre lots ?', 'Énergie consommée sans production.');
tx('pt-integration', 'Opportunités d’intégration énergétique (préchauffage alimentation par sortie chaude…)', 'Analyse de pincement : chaleur disponible à rapprocher des besoins.');

// ---------------------------------------------------------------- Procédé électrique
K('process');
yn('pr-vide', 'Machines en marche à vide hors production ?', 'Consommation sans valeur ajoutée.');
yn('pr-vev', 'Entraînements à vitesse variable ?', 'Adaptation de la vitesse à la cadence.');
yn('pr-csp', 'Consommation spécifique suivie (kWh par unité produite) ?', 'Indicateur de performance énergétique (IPÉ).');
yn('pr-demarrages', 'Démarrages simultanés provoquant des pointes de puissance ?', 'Échelonner les démarrages réduit la puissance appelée.');

// ---------------------------------------------------------------- Froid industriel
K('froid');
ch('fr-portes', 'Portes (fermeture automatique, rideaux à lanières, joints)', ETAT, 'Les entrées d’air chaud et humide sont la première charge des chambres froides en climat tropical.');
yn('fr-givre', 'Givre excessif sur les évaporateurs ?', 'Échange dégradé, évaporation plus basse ; signe d’entrées d’air humide.');
ch('fr-degivrage', 'Dégivrage', ['Horaire fixe', 'À la demande', 'Naturel'], 'Un dégivrage à la demande évite les dégivrages inutiles.');
ch('fr-isolation', 'Isolation (panneaux, ponts thermiques)', ETAT, 'Apports de chaleur permanents.');
yn('fr-consigne', 'Consigne plus froide que nécessaire ?', 'Chaque kelvin plus froid coûte environ 2 à 3 % de consommation.');
yn('fr-hpflottante', 'Haute pression flottante ?', 'Laisser baisser la condensation la nuit et par temps frais.');
yn('fr-recup', 'Récupération de chaleur de condensation ?', 'Eau chaude de lavage gratuite.');
yn('fr-ec', 'Ventilateurs d’évaporateurs à moteurs EC / variation ?', 'Les ventilateurs chauffent aussi la chambre : double gain.');

// ---------------------------------------------------------------- Moteurs / pompes / ventilateurs
K('moteurs');
yn('mo-surdim', 'Moteurs surdimensionnés (charge < 50 %) ?', 'Rendement et cos phi dégradés à faible charge.');
yn('mo-laminage', 'Débit réglé par vanne ou registre partiellement fermé ?', 'Une variation de vitesse réduit fortement la puissance : -20 % de vitesse ~ -50 % de puissance (loi de similitude).');
ch('mo-courroies', 'Transmissions par courroies', ['Sans objet', 'Bon état', 'Usées / mal tendues', 'Courroies crantées'], 'Patinage et usure : quelques % de pertes.');
yn('mo-rebobines', 'Moteurs rebobinés plusieurs fois ?', 'Chaque rebobinage dégrade le rendement : remplacement par IE3 / IE4.');
nb('mo-pmes', 'Puissance absorbée mesurée', 'kW', 'Mesure plus fiable que la puissance plaque × taux de charge supposé.');
tx('mo-bep', 'Point de fonctionnement des pompes (écart au rendement optimal)', 'Pompe loin de son meilleur rendement : rognage de roue ou remplacement.');

// ---------------------------------------------------------------- CTA / ventilation
K('cta');
yn('ct-occupation', 'Débit adapté à l’occupation (horaires, sonde CO2) ?', 'Débits excessifs : ventilation et traitement d’air inutiles.');
ch('ct-filtres', 'État des filtres', PROPRE, 'Filtres colmatés : surconsommation des ventilateurs.');
yn('ct-recup', 'Récupération d’énergie sur l’air extrait (froid et humidité) ?', 'En climat tropical, pré-refroidir et déshumidifier l’air neuf est un gisement important.');
yn('ct-ec', 'Ventilateurs EC ou à vitesse variable ?', 'Puissance proportionnelle au cube de la vitesse.');
yn('ct-postchauffe', 'Déshumidification par surrefroidissement + réchauffage ?', 'Double consommation (froid puis chaud) : récupération ou autre stratégie.');

// ---------------------------------------------------------------- Climatisation
K('clim');
yn('cl-consigne', 'Consigne inférieure à 24-25 °C ?', 'Chaque degré de consigne en moins augmente sensiblement la consommation.');
yn('cl-ouvrants', 'Portes ou fenêtres ouvertes pendant la climatisation ?', 'Entrée d’air chaud et humide : surconsommation importante.');
yn('cl-programmation', 'Arrêt automatique hors occupation (programmation, détection) ?', 'Unités souvent laissées en marche la nuit et le week-end.');
ch('cl-unites-ext', 'Unités extérieures', ['Bien placées et propres', 'Au soleil', 'Encrassées / corrodées', 'Recyclage d’air chaud'], 'Condensation plus chaude = COP dégradé.');
yn('cl-r22', 'Équipements au R22 ou très anciens ?', 'Remplacement à prévoir : occasion d’installer des équipements performants.');
ch('cl-solaire', 'Protections solaires (brise-soleil, films, toiture isolée ou réfléchissante)', ETAT, 'Les apports solaires sont la principale charge des locaux en zone tropicale.');
yn('cl-brasseurs', 'Brasseurs d’air présents ?', 'Permettent de relever la consigne de plusieurs degrés à confort égal.');

// ---------------------------------------------------------------- Éclairage
K('eclairage');
yn('ec-jour', 'Éclairage allumé en plein jour ou dans des zones inoccupées ?', 'Détection de présence et gradation selon la lumière du jour.');
yn('ec-naturel', 'Apport de lumière naturelle possible (translucides, puits de lumière) ?', 'Réduit les heures d’allumage.');
yn('ec-exterieur', 'Éclairage extérieur piloté (horloge astronomique, crépusculaire) ?', 'Évite l’allumage diurne.');
yn('ec-surec', 'Sur-éclairement constaté par rapport au besoin ?', 'Réduction du nombre de points ou de la puissance.');

// ---------------------------------------------------------------- Traitement d'eau / effluents
K('eau_traitement');
yn('te-o2', 'Aération pilotée par sonde O2 dissous ?', 'L’aération est souvent le premier poste électrique d’une station : piloter au besoin.');
yn('te-vev', 'Surpresseurs d’aération à vitesse variable ?', 'Adapter le débit d’air au besoin.');
ch('te-diffuseurs', 'Système d’aération', ['Fines bulles', 'Moyennes bulles', 'Turbines de surface'], 'Les fines bulles transfèrent mieux l’oxygène par kWh.');
yn('te-relevage', 'Pompes de relevage asservies aux niveaux ?', 'Évite le fonctionnement inutile.');
tx('te-methanisation', 'Potentiel de méthanisation des effluents (vinasses…)', 'Production de biogaz substituable aux combustibles fossiles.');

// ---------------------------------------------------------------- Eau chaude sanitaire
K('ecs');
nb('es-besoin', 'Besoin journalier estimé', 'L/j', 'Pour vérifier le dimensionnement du stockage et de l’appoint.');
ch('es-bouclage', 'Calorifugeage du bouclage', ETAT, 'Les pertes de bouclage dépassent souvent le besoin utile.');
yn('es-appoint', 'Appoint électrique en marche permanente ?', 'Programmer l’appoint après les heures d’ensoleillement.');

// ---------------------------------------------------------------- Informatique / salle serveurs
K('it');
yn('it-confinement', 'Confinement allées chaudes / froides ?', 'Évite le mélange d’air : consigne relevable.');
nb('it-consigne', 'T° de consigne de la salle', '°C', 'Les serveurs tolèrent généralement 24 à 27 °C en entrée.');
yn('it-redondance', 'Climatiseurs redondants en marche simultanée sans pilotage ?', 'Doublement de la consommation de froid.');
yn('it-postes', 'Postes et écrans laissés allumés la nuit ?', 'Consommation résiduelle.');

// ---------------------------------------------------------------- Flotte / engins
K('vehicules');
yn('ve-suivi', 'Suivi de consommation par véhicule ?', 'Base d’un indicateur (L/100 km, L/h, L/t transportée).');
yn('ve-ralenti', 'Ralenti moteur prolongé (attentes, chargement) ?', 'Carburant consommé sans déplacement.');
yn('ve-ecoconduite', 'Formation éco-conduite réalisée ?', 'Gain usuel de quelques % à 10 %.');
yn('ve-electrif', 'Engins électrifiables (chariots thermiques…) ?', 'Substitution par l’électrique, à coupler au photovoltaïque.');

export const DEFAULT_CHECKS = C.map((x) => ({ ...x, createdAt: 0, updatedAt: 0, deviceId: 'base', deleted: false }));
