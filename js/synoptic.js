// Synoptique : rendu SVG en 3 colonnes (Production → Distribution → Consommation).
// Ordre des nœuds optimisé par barycentre pour limiter les croisements. Sans dépendance.
import { FAMILIES, CARRIERS, kindById } from './model.js';

const NODE_W = 200, NODE_H = 60, GAP_X = 170, GAP_Y = 24, PAD = 24, LEGEND_H = 34;
const COLS = ['production', 'distribution', 'consommation'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function layout(utilities, links) {
  const nodes = utilities.map((u) => ({ u, col: COLS.indexOf(u.family), y: 0 }));
  const byId = new Map(nodes.map((n) => [n.u.id, n]));
  const edges = links.filter((l) => byId.has(l.fromId) && byId.has(l.toId));
  const cols = COLS.map((_, c) => nodes.filter((n) => n.col === c).sort((a, b) => a.u.tag.localeCompare(b.u.tag)));
  const place = () => cols.forEach((col) => col.forEach((n, i) => { n.y = PAD + LEGEND_H + i * (NODE_H + GAP_Y); }));
  place();
  const neighbours = (n) => edges.filter((e) => e.fromId === n.u.id || e.toId === n.u.id).map((e) => byId.get(e.fromId === n.u.id ? e.toId : e.fromId));
  for (const c of [1, 2, 0, 1, 2]) {
    const col = cols[c];
    const key = new Map(col.map((n) => { const nb = neighbours(n); return [n, nb.length ? nb.reduce((s, m) => s + m.y, 0) / nb.length : n.y]; }));
    col.sort((a, b) => key.get(a) - key.get(b) || a.u.tag.localeCompare(b.u.tag));
    place();
  }
  const x = (c) => PAD + c * (NODE_W + GAP_X);
  nodes.forEach((n) => { n.x = x(n.col); });
  const rows = Math.max(1, ...cols.map((c) => c.length));
  return { nodes, byId, edges, width: PAD * 2 + 3 * NODE_W + 2 * GAP_X, height: PAD * 2 + LEGEND_H + rows * (NODE_H + GAP_Y) };
}

export function renderSynoptic(utilities, links, { selectedId = null } = {}) {
  const { nodes, byId, edges, width, height } = layout(utilities, links);
  const used = [...new Set(edges.map((e) => e.carrier))];
  // Répartition des points d'ancrage le long de chaque bord d'un nœud
  const slots = new Map();
  const side = (e) => {
    const a = byId.get(e.fromId), b = byId.get(e.toId);
    if (a.col < b.col) return ['R', 'L']; if (a.col > b.col) return ['L', 'R']; return ['R', 'R'];
  };
  edges.forEach((e) => { const [s, t] = side(e); for (const [id, sd] of [[e.fromId, s], [e.toId, t]]) { const k = id + sd; (slots.get(k) || slots.set(k, []).get(k)).push(e.id); } });
  const anchor = (id, sd, eid) => {
    const n = byId.get(id), arr = slots.get(id + sd), i = arr.indexOf(eid);
    return { x: sd === 'R' ? n.x + NODE_W : n.x, y: n.y + (NODE_H * (i + 1)) / (arr.length + 1) };
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Century Gothic,CenturyGothic,Adventor,URW Gothic,Avant Garde,sans-serif">`;
  svg += `<defs>${used.map((c) => `<marker id="ar-${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${(CARRIERS[c] || CARRIERS.autre).color}"/></marker>`).join('')}</defs>`;
  svg += `<rect width="${width}" height="${height}" fill="#fff"/>`;
  COLS.forEach((c, i) => {
    svg += `<text x="${PAD + i * (NODE_W + GAP_X) + NODE_W / 2}" y="${PAD + 12}" text-anchor="middle" font-size="13" font-weight="700" fill="${FAMILIES[c].color}">${esc(FAMILIES[c].long.toUpperCase())}</text>`;
  });

  const labelled = new Set();
  for (const e of edges) {
    const [s, t] = side(e), A = anchor(e.fromId, s, e.id), B = anchor(e.toId, t, e.id);
    const col = (CARRIERS[e.carrier] || CARRIERS.autre).color;
    let c1, c2, tl;
    if (s === t) { const bx = Math.max(A.x, B.x) + 90; c1 = { x: bx, y: A.y }; c2 = { x: bx, y: B.y }; tl = 0.5; }
    else { const dx = Math.max(40, Math.abs(B.x - A.x) / 2) * (s === 'R' ? 1 : -1); c1 = { x: A.x + dx, y: A.y }; c2 = { x: B.x - dx, y: B.y }; tl = 0.4; }
    const d = `M${A.x},${A.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${B.x},${B.y}`;
    svg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.4" marker-end="url(#ar-${e.carrier in CARRIERS ? e.carrier : 'autre'})" opacity=".9"/>`;
    // Un libellé par couple (source, vecteur) pour éviter l'empilement quand une source alimente plusieurs utilités
    const key = e.fromId + '|' + e.carrier;
    if (!labelled.has(key)) {
      labelled.add(key);
      const u = 1 - tl, bz = (k) => u * u * u * A[k] + 3 * u * u * tl * c1[k] + 3 * u * tl * tl * c2[k] + tl * tl * tl * B[k];
      svg += `<text x="${bz('x')}" y="${bz('y') - 5}" text-anchor="middle" font-size="10.5" fill="${col}" stroke="#fff" stroke-width="3" paint-order="stroke" font-weight="600">${esc((CARRIERS[e.carrier] || CARRIERS.autre).label)}</text>`;
    }
  }

  for (const n of nodes) {
    const u = n.u, c = FAMILIES[u.family].color, sel = u.id === selectedId;
    const title = clip(u.name || kindById(u.kind).label, 26);
    const sub = [u.powerKw ? `${String(u.powerKw).replace('.', ',')} kW` : '', u.location].filter(Boolean).join(' · ');
    svg += `<g class="node" data-uid="${u.id}" style="cursor:pointer" tabindex="0"><rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="#fff" stroke="${c}" stroke-width="${sel ? 4 : 2}"/>`
      + `<rect x="${n.x}" y="${n.y}" width="8" height="${NODE_H}" rx="4" fill="${c}"/>`
      + `<text x="${n.x + 18}" y="${n.y + 22}" font-size="12.5" font-weight="700" fill="${c}">${esc(u.tag)}</text>`
      + `<text x="${n.x + 18}" y="${n.y + 39}" font-size="13" fill="#1b2430">${esc(title)}</text>`
      + `<text x="${n.x + 18}" y="${n.y + 54}" font-size="10.5" fill="#6b7280">${esc(clip(sub || kindById(u.kind).label, 34))}</text></g>`;
  }
  // Légende
  let lx = PAD;
  for (const c of used) { const cc = CARRIERS[c] || CARRIERS.autre; svg += `<rect x="${lx}" y="${height - 20}" width="18" height="4" rx="2" fill="${cc.color}"/><text x="${lx + 24}" y="${height - 14}" font-size="11" fill="#444">${esc(cc.label)}</text>`; lx += 40 + cc.label.length * 6.2; }
  return svg + '</svg>';
}
