// SVG renderer for structural models and results. Produces publication-style
// figures (geometry/supports/loads, mesh, deformed shape, N/V/M diagrams,
// stress & strain maps, built-in vs CalculiX overlays) directly from the same
// model data that is exported to FreeCAD and CalculiX.

const VIRIDIS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];

function lerpColor(c1, c2, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const a = p(c1), b = p(c2);
  const v = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${v[0]},${v[1]},${v[2]})`;
}
function colormap(t) {
  t = Math.min(1, Math.max(0, t));
  const seg = Math.min(VIRIDIS.length - 2, Math.floor(t * (VIRIDIS.length - 1)));
  return lerpColor(VIRIDIS[seg], VIRIDIS[seg + 1], t * (VIRIDIS.length - 1) - seg);
}

function fmtEng(v, unit) {
  if (!Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toPrecision(3) + ' G' + unit;
  if (a >= 1e6) return (v / 1e6).toPrecision(3) + ' M' + unit;
  if (a >= 1e3) return (v / 1e3).toPrecision(3) + ' k' + unit;
  if (a >= 1) return v.toPrecision(3) + ' ' + unit;
  if (a >= 1e-3) return (v * 1e3).toPrecision(3) + ' m' + unit;
  return v.toExponential(2) + ' ' + unit;
}

export class SvgScene {
  constructor(model, opts = {}) {
    this.model = model;
    this.W = opts.width ?? 1180;
    this.H = opts.height ?? 760;
    this.margin = 62;
    const bb = model.bbox();
    const planar = Math.abs(bb.max[1] - bb.min[1]) < 1e-6;
    this.view = opts.view ?? (planar ? 'xz' : 'iso');
    this.parts = [];
    this._fit();
  }

  raw(x, y, z) {
    if (this.view === 'xz') return [x, -z];
    if (this.view === 'xy') return [x, -y];
    const c = Math.cos(Math.PI / 6), s = 0.5;
    return [(x - y) * c, -(z + (x + y) * s)];
  }

  _fit() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of this.model.nodes.values()) {
      const [X, Y] = this.raw(n.x, n.y, n.z);
      minX = Math.min(minX, X); maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
    }
    const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
    const m = this.margin;
    this.scale = Math.min((this.W - 2 * m) / spanX, (this.H - 2 * m - 40) / spanY);
    this.ox = m + ((this.W - 2 * m) - spanX * this.scale) / 2 - minX * this.scale;
    this.oy = m + 30 + ((this.H - 2 * m - 40) - spanY * this.scale) / 2 - minY * this.scale;
    this.msize = Math.max(spanX, spanY); // model size in projected meters
  }

  p(x, y, z) {
    const [X, Y] = this.raw(x, y, z);
    return [X * this.scale + this.ox, Y * this.scale + this.oy];
  }
  pn(node) { const n = this.model.nodes.get(node); return this.p(n.x, n.y, n.z); }

  add(s) { this.parts.push(s); }

  line(a, b, attrs) { this.add(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" ${attrs}/>`); }
  poly(pts, attrs) { this.add(`<polyline points="${pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" ${attrs}/>`); }
  polygon(pts, attrs) { this.add(`<polygon points="${pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" ${attrs}/>`); }
  circle(c, r, attrs) { this.add(`<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${r}" ${attrs}/>`); }
  text(c, str, attrs = 'font-size="11" fill="#333"') { this.add(`<text x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" ${attrs}>${str}</text>`); }

  arrow(tip, dir, len, color = '#d62728', width = 1.6) {
    const n = Math.hypot(dir[0], dir[1]) || 1;
    const u = [dir[0] / n, dir[1] / n];
    const tail = [tip[0] - u[0] * len, tip[1] - u[1] * len];
    this.line(tail, tip, `stroke="${color}" stroke-width="${width}"`);
    const w = Math.min(6, len * 0.35);
    const px = [-u[1], u[0]];
    this.polygon([
      tip,
      [tip[0] - u[0] * w * 1.8 + px[0] * w * 0.6, tip[1] - u[1] * w * 1.8 + px[1] * w * 0.6],
      [tip[0] - u[0] * w * 1.8 - px[0] * w * 0.6, tip[1] - u[1] * w * 1.8 - px[1] * w * 0.6],
    ], `fill="${color}"`);
  }

  drawMembers(colorFn, widthFn) {
    for (const m of this.model.members.values()) {
      const a = this.pn(m.from), b = this.pn(m.to);
      const c = colorFn ? colorFn(m) : (m.type === 'truss' ? '#8c8c8c' : '#1f77b4');
      const w = widthFn ? widthFn(m) : (m.type === 'truss' ? 1.6 : 2.6);
      this.line(a, b, `stroke="${c}" stroke-width="${w}" stroke-linecap="round"`);
    }
  }

  drawSupports() {
    for (const [nid, dofs] of this.model.supports) {
      const trans = dofs[0] + dofs[1] + dofs[2];
      const isPlanarOnly = trans <= 1 && dofs[1] === 1 && dofs[0] === 0 && dofs[2] === 0;
      const c = this.pn(nid);
      if (isPlanarOnly) continue; // out-of-plane restraint marker would clutter planar views
      const s = 9;
      if (dofs.slice(0, 3).every((v) => v) && dofs.slice(3).every((v) => v)) {
        this.polygon([[c[0] - s, c[1] + s * 1.4], [c[0] + s, c[1] + s * 1.4], c], 'fill="#333"');
        this.line([c[0] - s * 1.3, c[1] + s * 1.4], [c[0] + s * 1.3, c[1] + s * 1.4], 'stroke="#333" stroke-width="2"');
      } else if (trans === 3) {
        this.polygon([[c[0] - s, c[1] + s * 1.4], [c[0] + s, c[1] + s * 1.4], c], 'fill="none" stroke="#333" stroke-width="1.6"');
        this.line([c[0] - s * 1.3, c[1] + s * 1.4], [c[0] + s * 1.3, c[1] + s * 1.4], 'stroke="#333" stroke-width="1.6"');
      } else {
        this.polygon([[c[0] - s, c[1] + s * 1.1], [c[0] + s, c[1] + s * 1.1], c], 'fill="none" stroke="#333" stroke-width="1.4"');
        this.circle([c[0] - s * 0.5, c[1] + s * 1.55], 3, 'fill="none" stroke="#333"');
        this.circle([c[0] + s * 0.5, c[1] + s * 1.55], 3, 'fill="none" stroke="#333"');
      }
    }
  }

  drawLoads() {
    const model = this.model;
    let maxP = 0, maxW = 0;
    for (const l of model.loads.nodal) maxP = Math.max(maxP, Math.hypot(l.f[0], l.f[1], l.f[2]));
    for (const l of model.loads.udl) maxW = Math.max(maxW, Math.hypot(...l.w));
    for (const l of model.loads.udl) {
      const m = model.members.get(l.member);
      const geo = model.memberGeometry(m);
      const wg = l.sys === 'global' ? l.w : null;
      const wmag = Math.hypot(...l.w);
      if (!wg || wmag === 0) continue;
      const u = [wg[0] / wmag, wg[1] / wmag, wg[2] / wmag];
      const len = 12 + 14 * (wmag / (maxW || 1));
      const narr = Math.max(3, Math.round(geo.L * this.scale / 26));
      const heads = [];
      for (let i = 0; i <= narr; i++) {
        const t = i / narr;
        const px = geo.a.x + (geo.b.x - geo.a.x) * t;
        const py = geo.a.y + (geo.b.y - geo.a.y) * t;
        const pz = geo.a.z + (geo.b.z - geo.a.z) * t;
        const tip = this.p(px, py, pz);
        const dirScreen = [this.p(px + u[0], py + u[1], pz + u[2])[0] - tip[0], this.p(px + u[0], py + u[1], pz + u[2])[1] - tip[1]];
        this.arrow(tip, dirScreen, len, '#d62728', 1.1);
        heads.push([tip[0] - dirScreen[0] / (Math.hypot(...dirScreen) || 1) * len, tip[1] - dirScreen[1] / (Math.hypot(...dirScreen) || 1) * len]);
      }
      this.poly(heads, 'stroke="#d62728" stroke-width="1" fill="none"');
    }
    for (const l of model.loads.nodal) {
      const mag = Math.hypot(l.f[0], l.f[1], l.f[2]);
      if (mag === 0) continue;
      const u = [l.f[0] / mag, l.f[1] / mag, l.f[2] / mag];
      const n = model.nodes.get(l.node);
      const tip = this.p(n.x, n.y, n.z);
      const q = this.p(n.x + u[0], n.y + u[1], n.z + u[2]);
      const dirScreen = [q[0] - tip[0], q[1] - tip[1]];
      this.arrow(tip, dirScreen, 18 + 18 * (mag / (maxP || 1)), '#9467bd', 2);
    }
  }

  // polyline of a member's deformed shape from beam-engine stations
  deformedMember(memberRes, defScale) {
    const m = this.model.members.get(memberRes.member);
    const geo = this.model.memberGeometry(m);
    return memberRes.stations.map((st) => {
      const t = st.x / geo.L;
      const x = geo.a.x + (geo.b.x - geo.a.x) * t + st.disp[0] * defScale;
      const y = geo.a.y + (geo.b.y - geo.a.y) * t + st.disp[1] * defScale;
      const z = geo.a.z + (geo.b.z - geo.a.z) * t + st.disp[2] * defScale;
      return this.p(x, y, z);
    });
  }

  legendGradient(min, max, unit, label) {
    const x = this.W - 210, y = this.H - 46, w = 150, h = 12;
    for (let i = 0; i < 40; i++) {
      this.add(`<rect x="${x + (i * w) / 40}" y="${y}" width="${w / 40 + 0.7}" height="${h}" fill="${colormap(i / 39)}"/>`);
    }
    this.text([x, y - 6], label, 'font-size="11" fill="#333"');
    this.text([x, y + h + 13], fmtEng(min, unit), 'font-size="10" fill="#333"');
    this.text([x + w - 34, y + h + 13], fmtEng(max, unit), 'font-size="10" fill="#333"');
  }

  title(main, sub) {
    this.text([16, 24], main, 'font-size="16" font-weight="bold" fill="#111"');
    if (sub) this.text([16, 42], sub, 'font-size="12" fill="#555"');
  }

  axesTriad() {
    const o = [30, this.H - 26];
    const axes = this.view === 'xz' ? [['X', 1, 0, 0], ['Z', 0, 0, 1]] : [['X', 1, 0, 0], ['Y', 0, 1, 0], ['Z', 0, 0, 1]];
    for (const [nm, x, y, z] of axes) {
      const d = this.raw(x, y, z);
      const n = Math.hypot(d[0], d[1]) || 1;
      const tip = [o[0] + (d[0] / n) * 24, o[1] + (d[1] / n) * 24];
      this.line(o, tip, 'stroke="#666" stroke-width="1.4"');
      this.text([tip[0] + 2, tip[1] + 3], nm, 'font-size="10" fill="#666"');
    }
  }

  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.W} ${this.H}" font-family="Segoe UI, Arial, sans-serif">\n` +
      `<rect width="${this.W}" height="${this.H}" fill="white"/>\n` +
      this.parts.join('\n') + '\n</svg>\n';
  }
}

// ---------------- high-level figure builders ----------------

export function figGeometry(model, title) {
  const s = new SvgScene(model);
  s.drawMembers();
  s.drawSupports();
  s.drawLoads();
  let maxW = 0, maxP = 0;
  for (const l of model.loads.udl) maxW = Math.max(maxW, Math.hypot(...l.w));
  for (const l of model.loads.nodal) maxP = Math.max(maxP, Math.hypot(l.f[0], l.f[1], l.f[2]));
  const loadTxt = [
    maxW ? `max UDL ${fmtEng(maxW, 'N/m')}` : null,
    maxP ? `max point load ${fmtEng(maxP, 'N')}` : null,
    model.loads.selfWeightFactor ? `self-weight ×${model.loads.selfWeightFactor}` : null,
  ].filter(Boolean).join('   ·   ');
  s.title(title, `${model.nodes.size} nodes, ${model.members.size} members  ·  ${loadTxt}`);
  s.axesTriad();
  s.text([16, s.H - 10], 'beam members: blue · truss members: grey · UDL: red arrows · point loads: violet arrows', 'font-size="10" fill="#777"');
  return s.toString();
}

export function figMesh(model, mesh, title) {
  const s = new SvgScene(model);
  s.drawMembers(() => '#bbb', () => 1.4);
  for (const n of mesh.nodes) {
    const c = s.p(n.x, n.y, n.z);
    if (n.modelId !== null) s.circle(c, 3, 'fill="#1f77b4"');
    else s.circle(c, 1.6, 'fill="#e377c2"');
  }
  s.drawSupports();
  s.title(title, `CalculiX B32R mesh: ${mesh.nodes.length} nodes, ${mesh.elements.length} elements (blue: model nodes · pink: generated subdivision/midside nodes)`);
  s.axesTriad();
  return s.toString();
}

export function figDeformed(model, res, title, opts = {}) {
  const s = new SvgScene(model);
  const maxD = res.maxDisplacement.value || 1e-9;
  const defScale = opts.defScale ?? niceScale(0.12 * s.msize / maxD);
  s.drawMembers(() => '#ccc', () => 1.2);
  for (const mr of res.members) {
    s.poly(s.deformedMember(mr, defScale), 'stroke="#d62728" stroke-width="2" fill="none"');
  }
  // ccx overlay from chain displacements
  if (opts.ccx) {
    for (const [, chainPts] of opts.ccx.chains) {
      s.poly(chainPts.map(([x, y, z, d]) => s.p(x + d[0] * defScale, y + d[1] * defScale, z + d[2] * defScale)),
        'stroke="#1f77b4" stroke-width="1.4" stroke-dasharray="5,3" fill="none"');
    }
  }
  s.drawSupports();
  const cmp = opts.ccx ? `  ·  CalculiX max ${(opts.ccx.maxDisp * 1e3).toFixed(2)} mm (blue dashed)` : '';
  s.title(title, `deformed shape ×${defScale}  ·  built-in solver max ${(maxD * 1e3).toFixed(2)} mm (red)${cmp}`);
  s.axesTriad();
  return s.toString();
}

export function figDiagram(model, res, comp, title, unit = 'N·m') {
  // comp: station property name ('My','Mz','Vy','Vz','N')
  const s = new SvgScene(model);
  let gmax = 0;
  for (const mr of res.members) for (const st of mr.stations) gmax = Math.max(gmax, Math.abs(st[comp]));
  gmax = gmax || 1;
  const off = 34; // px at gmax
  s.drawMembers(() => '#999', () => 1.4);
  for (const mr of res.members) {
    const m = model.members.get(mr.member);
    const geo = model.memberGeometry(m);
    const a = s.pn(m.from), b = s.pn(m.to);
    const d = [b[0] - a[0], b[1] - a[1]];
    const n = Math.hypot(...d) || 1;
    const perp = [-d[1] / n, d[0] / n];
    const pts = mr.stations.map((st) => {
      const t = st.x / geo.L;
      const base = [a[0] + d[0] * t, a[1] + d[1] * t];
      const v = (st[comp] / gmax) * off;
      return [base[0] + perp[0] * v, base[1] + perp[1] * v];
    });
    const poly = [a, ...pts, b];
    const pos = mr.stations.some((st) => st[comp] > gmax * 1e-4);
    const neg = mr.stations.some((st) => st[comp] < -gmax * 1e-4);
    const fill = pos && neg ? '#b8860b' : pos ? '#2ca02c' : '#d62728';
    s.polygon(poly, `fill="${fill}" fill-opacity="0.28" stroke="${fill}" stroke-width="1"`);
  }
  s.drawSupports();
  s.title(title, `${comp} diagram · max |${comp}| = ${fmtEng(gmax, unit)} (green: positive, red: negative, offsets ∝ value)`);
  s.axesTriad();
  return s.toString();
}

export function figColorMap(model, res, valueFn, title, sub, unit, min, max) {
  const s = new SvgScene(model);
  const span = (max - min) || 1;
  for (const mr of res.members) {
    const m = model.members.get(mr.member);
    const geo = model.memberGeometry(m);
    for (let i = 0; i < mr.stations.length - 1; i++) {
      const s1 = mr.stations[i], s2 = mr.stations[i + 1];
      const v = (valueFn(s1, mr) + valueFn(s2, mr)) / 2;
      const t1 = s1.x / geo.L, t2 = s2.x / geo.L;
      const p1 = s.p(geo.a.x + (geo.b.x - geo.a.x) * t1, geo.a.y + (geo.b.y - geo.a.y) * t1, geo.a.z + (geo.b.z - geo.a.z) * t1);
      const p2 = s.p(geo.a.x + (geo.b.x - geo.a.x) * t2, geo.a.y + (geo.b.y - geo.a.y) * t2, geo.a.z + (geo.b.z - geo.a.z) * t2);
      s.line(p1, p2, `stroke="${colormap((v - min) / span)}" stroke-width="4" stroke-linecap="round"`);
    }
  }
  s.drawSupports();
  s.title(title, sub);
  s.legendGradient(min, max, unit, '');
  s.axesTriad();
  return s.toString();
}

// CalculiX field map: polylines through member chains colored by a ccx nodal field
export function figCcxMap(model, ccxChains, title, sub, unit, min, max, defScale = 0) {
  const s = new SvgScene(model);
  const span = (max - min) || 1;
  for (const [, pts] of ccxChains) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1, z1, d1, v1] = pts[i];
      const [x2, y2, z2, d2, v2] = pts[i + 1];
      const p1 = s.p(x1 + d1[0] * defScale, y1 + d1[1] * defScale, z1 + d1[2] * defScale);
      const p2 = s.p(x2 + d2[0] * defScale, y2 + d2[1] * defScale, z2 + d2[2] * defScale);
      s.line(p1, p2, `stroke="${colormap((((v1 + v2) / 2) - min) / span)}" stroke-width="4" stroke-linecap="round"`);
    }
  }
  s.drawSupports();
  s.title(title, sub);
  s.legendGradient(min, max, unit, '');
  s.axesTriad();
  return s.toString();
}

export function figAxial(model, res, title) {
  const s = new SvgScene(model);
  let gmax = 0;
  for (const mr of res.members) gmax = Math.max(gmax, Math.abs(mr.N.min), Math.abs(mr.N.max));
  gmax = gmax || 1;
  s.drawMembers(() => '#eee', () => 1);
  for (const mr of res.members) {
    const m = model.members.get(mr.member);
    const N = Math.abs(mr.N.min) > Math.abs(mr.N.max) ? mr.N.min : mr.N.max;
    const a = s.pn(m.from), b = s.pn(m.to);
    const w = 1 + 5 * Math.abs(N) / gmax;
    s.line(a, b, `stroke="${N < 0 ? '#d62728' : '#1f77b4'}" stroke-width="${w}" stroke-linecap="round"`);
  }
  s.drawSupports();
  s.title(title, `axial force · max |N| = ${fmtEng(gmax, 'N')} (red: compression, blue: tension, width ∝ |N|)`);
  s.axesTriad();
  return s.toString();
}

export function niceScale(v) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
}

export { colormap, fmtEng };
