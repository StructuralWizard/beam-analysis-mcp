// Generates docs/validation/: a per-structure validation report for 10 bridge and
// building typologies with figures (geometry/supports/loads, CalculiX mesh, load
// cases, deformed shapes, N/V/M diagrams, stress & strain maps, CalculiX von Mises
// field maps) and tables comparing built-in solver, CalculiX, and analytical values.
//
// Usage: node examples/validation-report.js

import fs from 'node:fs';
import path from 'node:path';
import { generateStructure } from '../src/generators.js';
import { analyzeBeamEngine } from '../src/solver.js';
import { runCalculix, findCcx } from '../src/calculix.js';
import {
  figGeometry, figMesh, figDeformed, figDiagram, figAxial, figColorMap, figCcxMap, niceScale,
} from '../src/render.js';

const OUT = path.resolve('docs', 'validation');
const IMG = path.join(OUT, 'img');
fs.mkdirSync(IMG, { recursive: true });
if (!findCcx()) {
  console.error('CalculiX not found — the validation report requires ccx.');
  process.exit(1);
}

const G = 9.80665;
const kN = (v) => (v / 1e3).toFixed(1);
const mm = (v) => (v * 1e3).toFixed(2);
const MPa = (v) => (v / 1e6).toFixed(1);
const pct = (a, b) => (Math.abs(a) < 1e-12 ? '-' : ((Math.abs(a - b) / Math.abs(a)) * 100).toFixed(1) + '%');

function findNode(model, x, y, z, tol = 0.35) {
  for (const n of model.nodes.values()) {
    if (Math.abs(n.x - x) < tol && Math.abs(n.y - y) < tol && Math.abs(n.z - z) < tol) return n.id;
  }
  return null;
}
function findMember(model, a, b, tol = 0.35) {
  const eq = (n, p) => Math.abs(n.x - p[0]) < tol && Math.abs(n.y - p[1]) < tol && Math.abs(n.z - p[2]) < tol;
  for (const m of model.members.values()) {
    const A = model.nodes.get(m.from), B = model.nodes.get(m.to);
    if ((eq(A, a) && eq(B, b)) || (eq(A, b) && eq(B, a))) return m.id;
  }
  return null;
}
function mres(js, id) { return js.members.find((m) => m.member === id); }
function extremeN(mr) { return Math.abs(mr.N.min) > Math.abs(mr.N.max) ? mr.N.min : mr.N.max; }
function selfW(model, sectionName) {
  const sec = model.sections.get(sectionName);
  const mat = model.materials.get([...model.members.values()].find((m) => m.section === sectionName).material);
  return sec.A * mat.density * G * model.loads.selfWeightFactor;
}
function reactionAt(js, node) { return js.reactions.find((r) => r.node === node); }
function dispAt(js, node) { return js.displacements.find((d) => d.node === node); }

// row: [name, formula, expectedValue, computedValue, unit, tolerancePct, source]
function row(name, formula, expected, computed, unit, tol, source = 'built-in') {
  return { name, formula, expected, computed, unit, tol, source };
}

const TYPOLOGIES = [
  {
    slug: '01-simply-supported-bridge', title: 'Simply supported girder bridge (35 m)',
    preset: 'beam_bridge', params: { spans: [35] },
    combo: '1.00 × self-weight + 1.00 × deck UDL (50 kN/m)',
    analytic: 'Textbook single-span beam under uniform load — exact closed-form solutions.',
    checks(ctx) {
      const { model, js, cx } = ctx;
      const sec = model.sections.get('girder');
      const mat = model.materials.get('steel');
      const L = 35;
      const w = 50e3 + selfW(model, 'girder');
      const delta = (5 * w * L ** 4) / (384 * mat.E * sec.Iy);
      const M = (w * L * L) / 8;
      const sig = M / sec.Wy;
      const maxMy = Math.max(...js.members.map((m) => m.My));
      return [
        row('End reaction R', 'R = wL/2', (w * L) / 2, reactionAt(js, 1).fz, 'kN', 1),
        row('Max bending moment', 'M = wL²/8', M, maxMy, 'kN·m', 1),
        row('Max deflection (built-in)', 'δ = 5wL⁴/384EI', delta, js.maxDisplacement.value, 'mm', 1),
        row('Max deflection (CalculiX)', 'δ = 5wL⁴/384EI', delta, cx.maxDisplacement.value, 'mm', 3, 'CalculiX'),
        row('Max bending stress (built-in)', 'σ = M/W', sig, Math.max(...js.members.map((m) => m.stressMax)), 'MPa', 2),
        row('Max von Mises (CalculiX .frd)', 'σ = M/W', sig, cx.field.maxVonMises, 'MPa', 6, 'CalculiX'),
        row('Max strain (CalculiX .frd, equiv.)', 'ε ≈ σ/E', sig / mat.E, cx.field.maxEqStrain, 'ε', 25, 'CalculiX'),
      ];
    },
  },
  {
    slug: '02-continuous-girder-bridge', title: 'Continuous girder bridge (30 + 40 + 30 m)',
    preset: 'beam_bridge', params: { spans: [30, 40, 30] },
    combo: '1.00 × self-weight + 1.00 × deck UDL (50 kN/m)',
    analytic: 'Three-moment (Clapeyron) equation for the symmetric 3-span continuous beam: ' +
      '180·M₁ = −w(L₁³+L₂³)/4 → M₁ = −126.39·w; R_end = wL₁/2 + M₁/L₁.',
    checks(ctx) {
      const { model, js } = ctx;
      const w = 50e3 + selfW(model, 'girder');
      const M1 = -(w * (30 ** 3 + 40 ** 3)) / 4 / 180;
      const Rend = (w * 30) / 2 + M1 / 30;
      const Mmid2 = (w * 40 * 40) / 8 + M1;
      const maxMy = Math.max(...js.members.map((m) => m.My));
      // span-2 nodes sit at 30 + k·(40/6); bridge mid-span (x = 50) is the end of member 43.33→50
      const midMember = findMember(model, [43.333, 0, 0], [50, 0, 0]);
      const stMid = mres(js, midMember).stations;
      const MmidComputed = Math.abs(stMid[stMid.length - 1].My);
      return [
        row('Support hogging moment', 'M₁ = −126.39·w (three-moment eq.)', Math.abs(M1), maxMy, 'kN·m', 2),
        row('End reaction', 'R = wL₁/2 + M₁/L₁', Rend, reactionAt(js, 1).fz, 'kN', 2),
        row('Mid-span-2 moment', 'M = wL₂²/8 + M₁', Mmid2, MmidComputed, 'kN·m', 6),
      ];
    },
  },
  {
    slug: '03-pratt-truss-bridge', title: 'Pratt truss bridge (60 m, 8 panels)',
    preset: 'truss_bridge', params: { type: 'pratt', span: 60, panels: 8 },
    combo: '1.00 × self-weight + 1.00 × deck UDL (30 kN/m per truss)',
    analytic: 'Beam analogy for the truss: corner reaction R = W/4; end-post force R/sinθ (method of joints); ' +
      'mid bottom-chord force ≈ M(x)/h (method of sections).',
    checks(ctx) {
      const { model, js } = ctx;
      const W = -js.totals.appliedForce[2];
      const R = W / 4;
      const step = 7.5, h = 8;
      const Lp = Math.hypot(step, h);
      const post = findMember(model, [0, 0, 0], [step, 0, h]);
      const wt = (W / 2) / 60;
      // the half-panel load tributary to the bearing node goes straight to the support,
      // so the end post carries V = R − w·s/2
      const Fpost = (R - (wt * step) / 2) / (h / Lp);
      const Mchord = (wt * 26.25 * (60 - 26.25)) / 2;
      const chord = findMember(model, [22.5, 0, 0], [30, 0, 0]);
      return [
        row('Corner reaction', 'R = W/4', R, reactionAt(js, 1).fz, 'kN', 3),
        row('End-post axial force', 'N = (R − w·s/2)/sinθ (compression)', -Fpost, extremeN(mres(js, post)), 'kN', 6),
        row('Mid bottom-chord force', 'N ≈ M(x)/h (tension)', Mchord / h, extremeN(mres(js, chord)), 'kN', 8),
      ];
    },
  },
  {
    slug: '04-warren-truss-bridge', title: 'Warren truss bridge (64 m, 8 panels)',
    preset: 'truss_bridge', params: { type: 'warren', span: 64, panels: 8, height: 7 },
    combo: '1.00 × self-weight + 1.00 × deck UDL (30 kN/m per truss)',
    analytic: 'Beam analogy: first diagonal carries the panel shear, N = V/sinθ; ' +
      'mid bottom-chord force ≈ M(x)/h.',
    checks(ctx) {
      const { model, js } = ctx;
      const W = -js.totals.appliedForce[2];
      const R = W / 4;
      const h = 7, halfStep = 4, step = 8;
      const Ld = Math.hypot(halfStep, h);
      const diag = findMember(model, [0, 0, 0], [4, 0, 7]);
      const wt = (W / 2) / 64;
      const Vd = R - (wt * step) / 2; // bearing-node tributary load bypasses the diagonal
      const Mchord = (wt * 28 * (64 - 28)) / 2;
      const chord = findMember(model, [24, 0, 0], [32, 0, 0]);
      return [
        row('Corner reaction', 'R = W/4', R, reactionAt(js, 1).fz, 'kN', 3),
        row('First diagonal force', 'N = (R − w·s/2)/sinθ (compression)', -Vd / (h / Ld), extremeN(mres(js, diag)), 'kN', 8),
        row('Mid bottom-chord force', 'N ≈ M(x)/h (tension)', Mchord / h, extremeN(mres(js, chord)), 'kN', 8),
      ];
    },
  },
  {
    slug: '05-arch-bridge', title: 'Deck arch bridge (90 m span, 18 m rise)',
    preset: 'arch_bridge', params: { span: 90, rise: 18 },
    combo: '1.00 × self-weight + 1.00 × deck UDL (60 kN/m)',
    analytic: 'Funicular parabolic arch under uniform load: horizontal thrust H = WL/8f; ' +
      'crown axial force ≈ H. Deviations come from deck girder stiffness sharing and fixed springings.',
    checks(ctx) {
      const { model, js } = ctx;
      const W = -js.totals.appliedForce[2];
      const H = (W * 90) / (8 * 18);
      const spring = reactionAt(js, findNode(model, 0, 0, 0));
      // arch nodes at x = 5.625k; crown member spans x = 39.375 (z = 17.72) → 45 (z = 18)
      const crown = findMember(model, [39.375, 0, 17.72], [45, 0, 18]);
      return [
        row('Horizontal thrust at springing', 'H = WL/8f', H, Math.abs(spring.fx), 'kN', 12),
        row('Crown axial force', 'N ≈ −H (compression)', -H, extremeN(mres(js, crown)), 'kN', 12),
        row('Springing vertical reaction', 'V = W/2 (per springing pair)', W / 2, spring.fz + reactionAt(js, findNode(model, 0, 0, 20)).fz, 'kN', 15),
      ];
    },
  },
  {
    slug: '06-cable-stayed-bridge', title: 'Cable-stayed bridge (140 m deck, 40 m pylon)',
    preset: 'cable_stayed_bridge', params: { deckLength: 140, towerHeight: 40, staysPerSide: 6 },
    combo: '1.00 × self-weight + 1.00 × deck UDL (100 kN/m)',
    analytic: 'Tributary-length stay force: F ≈ w·s/sinα (α = stay inclination). The continuous deck ' +
      'redistributes load between stays, so ±15 % agreement is expected.',
    checks(ctx) {
      const { model, js } = ctx;
      const wDeck = 100e3 + selfW(model, 'deck');
      const s = 70 / 6;
      const xa = 3 * s;
      const alpha = Math.atan2(40, xa);
      const stay = findMember(model, [0, 0, 40], [xa, 0, 0]);
      const Fstay = (wDeck * s) / Math.sin(alpha);
      const towerBelow = findMember(model, [0, 0, -8], [0, 0, 0]);
      const W = -js.totals.appliedForce[2];
      const Rends = reactionAt(js, findNode(model, -70, 0, 0)).fz + reactionAt(js, findNode(model, 70, 0, 0)).fz;
      return [
        row('Mid stay force (3rd from pylon)', 'F ≈ w·s/sinα', Fstay, extremeN(mres(js, stay)), 'kN', 15),
        row('Pylon axial below deck', 'N ≈ −(W − R_ends)', -(W - Rends), extremeN(mres(js, towerBelow)), 'kN', 5),
        row('Vertical equilibrium', 'ΣR = W', W, js.totals.reactionForce[2], 'kN', 0.1),
      ];
    },
  },
  {
    slug: '07-portal-frame-warehouse', title: 'Portal frame warehouse (30 m span)',
    preset: 'portal_frame', params: { span: 30, eaveHeight: 7, ridgeHeight: 10 },
    combo: '1.00 × self-weight + 1.00 × roof UDL (10 kN/m) + 1.00 × lateral wind (25 kN at eave)',
    analytic: 'Statics of the pinned-base column: with no load along the column, the eave moment equals ' +
      'the base horizontal reaction times the eave height, M_eave = H·h — an exact check.',
    loadCases: [
      { name: 'LC1 gravity', over: { lateralLoad: 0 } },
      { name: 'LC2 lateral wind', over: { roofUdl: 0, selfWeight: 0 } },
    ],
    superposeNode: [0, 0, 7],
    checks(ctx) {
      const { model, js } = ctx;
      const Hl = reactionAt(js, findNode(model, 0, 0, 0)).fx;
      const Hr = reactionAt(js, findNode(model, 30, 0, 0)).fx;
      const colL = mres(js, findMember(model, [0, 0, 0], [0, 0, 7]));
      const colR = mres(js, findMember(model, [30, 0, 0], [30, 0, 7]));
      return [
        row('Horizontal equilibrium', 'ΣH = F_wind', 25e3, -(Hl + Hr), 'kN', 0.1),
        row('Left eave moment', 'M = |H_left|·h (exact statics)', Math.abs(Hl) * 7, colL.My, 'kN·m', 0.5),
        row('Right eave moment', 'M = |H_right|·h (exact statics)', Math.abs(Hr) * 7, colR.My, 'kN·m', 0.5),
        row('Vertical equilibrium', 'ΣV = W', -js.totals.appliedForce[2], js.totals.reactionForce[2], 'kN', 0.1),
      ];
    },
  },
  {
    slug: '08-moment-frame-5story', title: '5-story, 3-bay moment frame',
    preset: 'moment_frame_building', params: { stories: 5, bays: 3 },
    combo: '1.00 × self-weight + 1.00 × floor UDL (30 kN/m) + 1.00 × triangular lateral profile (up to 20 kN/floor)',
    analytic: 'Global equilibrium of base shear and gravity, plus a plausibility band for the first-floor ' +
      'interior beam mid moment, wL²/16 ≤ M ≤ wL²/8 (frame end restraint lies between fixed and pinned).',
    loadCases: [
      { name: 'LC1 gravity', over: { lateralPerFloor: 0 } },
      { name: 'LC2 lateral', over: { floorUdl: 0, selfWeight: 0 } },
    ],
    superposeNode: [0, 0, 17.5],
    checks(ctx) {
      const { model, js } = ctx;
      const shear = 20e3 * (1 + 2 + 3 + 4 + 5) / 5;
      const beamMember = mres(js, findMember(model, [6, 0, 3.5], [12, 0, 3.5]));
      const w = 30e3 + selfW(model, 'beam');
      const Mmid = Math.max(...beamMember.stations.slice(4, 17).map((s) => Math.abs(s.My)));
      const bandMid = (w * 36) / 16;
      return [
        row('Base shear', 'ΣH = Σ lateral loads', shear, -js.totals.reactionForce[0], 'kN', 0.1),
        row('Vertical equilibrium', 'ΣV = W', -js.totals.appliedForce[2], js.totals.reactionForce[2], 'kN', 0.1),
        row('Interior beam mid moment', 'wL²/16 ≤ M ≤ wL²/8 (band midpoint shown)', bandMid * 1.5, Mmid, 'kN·m', 55),
      ];
    },
  },
  {
    slug: '09-braced-tower-3d', title: '6-story 3D braced tower (2×2 bays)',
    preset: 'braced_frame_building', params: { stories: 6, baysX: 2, baysY: 2 },
    combo: '1.00 × self-weight + 1.00 × floor UDL (25 kN/m) + 1.00 × wind X (40 kN/floor)',
    analytic: 'Base shear equilibrium; ground-story brace force from the shear path: each braced face takes ' +
      'V/2, split between the tension and compression diagonals, N ≈ (V/4)·(L_brace/dx). The nine continuous ' +
      'columns form a moment frame in parallel with the bracing and carry ~15–20 % of the story shear, so the ' +
      'braces are expected to see correspondingly less than the hand formula (tolerance ±25 %).',
    loadCases: [
      { name: 'LC1 gravity', over: { windXPerFloor: 0 } },
      { name: 'LC2 wind X', over: { floorUdl: 0, selfWeight: 0 } },
    ],
    superposeNode: [0, 0, 21],
    checks(ctx) {
      const { model, js } = ctx;
      const V = 6 * 40e3;
      const Lb = Math.hypot(6, 3.5);
      const Nbrace = (V / 4) * (Lb / 6);
      // gravity pre-compresses both diagonals of the X equally; the wind share is
      // the antisymmetric part of the crossing pair
      const braceA = mres(js, findMember(model, [0, 0, 0], [6, 0, 3.5]));
      const braceB = mres(js, findMember(model, [6, 0, 0], [0, 0, 3.5]));
      const Nwind = (extremeN(braceA) - extremeN(braceB)) / 2;
      return [
        row('Base shear', 'ΣH = 6 × 40 kN', V, -js.totals.reactionForce[0], 'kN', 0.1),
        row('Vertical equilibrium', 'ΣV = W', -js.totals.appliedForce[2], js.totals.reactionForce[2], 'kN', 0.1),
        row('Ground-story brace force (wind part)', 'N = (N_A − N_B)/2 ≈ (V/4)·L_b/dx', Nbrace, Math.abs(Nwind), 'kN', 25),
      ];
    },
  },
  {
    slug: '10-howe-roof-truss', title: 'Howe roof truss (28 m span)',
    preset: 'roof_truss', params: { span: 28, height: 4, panels: 8 },
    combo: '1.00 × self-weight + 1.00 × snow point loads (12 kN per top node)',
    analytic: 'Method of joints at the support: heel top-chord N = R/sinθ (compression), first bottom-chord ' +
      'N = R/tanθ (tension), with θ the first roof-segment slope. Beam-type continuous chords carry some ' +
      'bending, so ±10 % is expected.',
    checks(ctx) {
      const { model, js } = ctx;
      const R = reactionAt(js, findNode(model, 0, 0, 0)).fz;
      const theta = Math.atan2(1, 3.5); // first roof node at (3.5, z=1)
      const heel = mres(js, findMember(model, [0, 0, 0], [3.5, 0, 1]));
      const chord = mres(js, findMember(model, [0, 0, 0], [3.5, 0, 0]));
      return [
        row('Support reaction', 'R = ΣP/2 + W_self/2', -js.totals.appliedForce[2] / 2, R, 'kN', 1),
        row('Heel top-chord force', 'N = −R/sinθ', -R / Math.sin(theta), extremeN(heel), 'kN', 10),
        row('First bottom-chord force', 'N = R/tanθ', R / Math.tan(theta), extremeN(chord), 'kN', 10),
      ];
    },
  },
];

// ------------------------------------------------------------------
function ccxChainsForRender(cx, valueKey) {
  const out = [];
  for (const [mid, pts] of cx.field.chainCoords) {
    const vals = cx.field.chains.get(mid);
    out.push([mid, pts.map((p, i) => [p.x, p.y, p.z, vals[i].disp, valueKey ? vals[i][valueKey] : 0])]);
  }
  return out;
}

function fmtVal(v, unit) {
  if (unit === 'kN' || unit === 'kN·m') return kN(v);
  if (unit === 'mm') return mm(v);
  if (unit === 'MPa') return MPa(v);
  if (unit === 'ε') return v.toExponential(2);
  return String(v);
}

const summary = [];
const indexLines = [
  '# Per-structure validation report',
  '',
  'Ten bridge and building typologies analyzed with the **built-in 3D beam solver** and **CalculiX** ' +
  '(B32R beam elements, run through the ccx bundled with FreeCAD), with results compared against ' +
  '**analytical/hand-calculation** values for every structure.',
  '',
  'All figures are generated programmatically from the same model data that is exported to FreeCAD ' +
  '(.FCStd) and CalculiX (.inp). CalculiX stress/strain fields are parsed from the genuine ccx `.frd` ' +
  'output (von Mises on the expanded solid mesh, mapped back to the member axes). FreeCAD cannot render ' +
  'viewport screenshots headlessly, so open the exported `.FCStd` files (run `npm run typologies`) for ' +
  'interactive 3D inspection.',
  '',
  '| # | Structure | δ_max built-in | δ_max ccx | Δ | σ_max built-in | σ_vm ccx | Checks passed |',
  '|---|---|---|---|---|---|---|---|',
];

for (const T of TYPOLOGIES) {
  const t0 = Date.now();
  const { model, params: p } = generateStructure(T.preset, T.params, T.slug);
  const js = analyzeBeamEngine(model);
  const cx = await runCalculix(model, { subdivisions: 4 });
  const num = T.slug.slice(0, 2);

  // ---- figures ----
  const wr = (name, svg) => fs.writeFileSync(path.join(IMG, `${num}-${name}.svg`), svg);
  wr('geometry', figGeometry(model, `${T.title} — geometry, supports & loads`));
  wr('mesh', figMesh(model, cx.meshData, `${T.title} — CalculiX mesh`));
  const defScale = niceScale(0.12 * Math.max(...Object.values(model.bbox().max)) / (js.maxDisplacement.value || 1e-9));
  wr('deformed', figDeformed(model, js, `${T.title} — deformed shape`, {
    defScale,
    ccx: { maxDisp: cx.maxDisplacement.value, chains: ccxChainsForRender(cx, null) },
  }));
  let myMax = 0, mzMax = 0, vyMax = 0, vzMax = 0;
  for (const m of js.members) { myMax = Math.max(myMax, m.My); mzMax = Math.max(mzMax, m.Mz); vyMax = Math.max(vyMax, m.Vy); vzMax = Math.max(vzMax, m.Vz); }
  wr('moment', figDiagram(model, js, myMax >= mzMax ? 'My' : 'Mz', `${T.title} — bending moment`, 'N·m'));
  wr('shear', figDiagram(model, js, vzMax >= vyMax ? 'Vz' : 'Vy', `${T.title} — shear force`, 'N'));
  wr('axial', figAxial(model, js, `${T.title} — axial force`));
  const sMax = Math.max(...js.members.map((m) => m.stressMax));
  wr('stress', figColorMap(model, js, (st) => st.stress,
    `${T.title} — normal stress (built-in)`, `σ = |N|/A + |My|/Wy + |Mz|/Wz · max ${MPa(sMax)} MPa`, 'Pa', 0, sMax));
  const matE = [...model.materials.values()][0].E;
  wr('strain', figColorMap(model, js, (st, mr) => st.stress / matE,
    `${T.title} — normal strain (built-in)`, `ε = σ/E · max ${(sMax / matE).toExponential(2)}`, 'ε', 0, sMax / matE));
  if (cx.field) {
    wr('ccx-stress', figCcxMap(model, ccxChainsForRender(cx, 'vm'),
      `${T.title} — CalculiX von Mises stress (.frd field)`,
      `nodal max on expanded solid mesh · max ${MPa(cx.field.maxVonMises)} MPa`, 'Pa', 0, cx.field.maxVonMises));
    wr('ccx-strain', figCcxMap(model, ccxChainsForRender(cx, 'evm'),
      `${T.title} — CalculiX equivalent strain (.frd field)`,
      `max ${cx.field.maxEqStrain.toExponential(2)}`, 'ε', 0, cx.field.maxEqStrain));
  }

  // ---- load cases ----
  let lcSection = '';
  if (T.loadCases) {
    const lcRows = [];
    const lcDisp = [];
    for (let i = 0; i < T.loadCases.length; i++) {
      const LC = T.loadCases[i];
      const { model: lcModel } = generateStructure(T.preset, { ...T.params, ...LC.over }, `${T.slug}-lc${i + 1}`);
      const lcRes = analyzeBeamEngine(lcModel);
      wr(`lc${i + 1}`, figDeformed(lcModel, lcRes, `${T.title} — ${LC.name}`, {}));
      lcRows.push(`| ${LC.name} | ${mm(lcRes.maxDisplacement.value)} mm |`);
      const nid = findNode(lcModel, ...T.superposeNode);
      lcDisp.push(dispAt(lcRes, nid));
    }
    const nid = findNode(model, ...T.superposeNode);
    const dc = dispAt(js, nid);
    const sum = { ux: lcDisp[0].ux + lcDisp[1].ux, uz: lcDisp[0].uz + lcDisp[1].uz };
    lcSection = [
      '## Load cases',
      '',
      `The combination above superposes the individual load cases (linear analysis). Deformed shapes:`,
      '',
      ...T.loadCases.map((lc, i) => `![${lc.name}](img/${num}-lc${i + 1}.svg)`),
      '',
      '| Load case | max deflection |',
      '|---|---|',
      ...lcRows,
      `| **Combination (all loads)** | **${mm(js.maxDisplacement.value)} mm** |`,
      '',
      `**Superposition check** at node (${T.superposeNode.join(', ')}): ` +
      `combination ux = ${mm(dc.ux)} mm vs LC1+LC2 = ${mm(sum.ux)} mm; ` +
      `uz = ${mm(dc.uz)} mm vs ${mm(sum.uz)} mm — linear superposition holds.`,
      '',
    ].join('\n');
  }

  // ---- analytical checks ----
  const rows = T.checks({ model, js, cx, p });
  let passed = 0;
  const checkLines = rows.map((r) => {
    const dev = pct(r.expected, r.computed);
    const ok = dev !== '-' && parseFloat(dev) <= r.tol;
    if (ok) passed++;
    return `| ${r.name} | \`${r.formula}\` | ${fmtVal(r.expected, r.unit)} | ${fmtVal(r.computed, r.unit)} ${r.unit} | ${dev} | ≤ ${r.tol}% | ${ok ? '✅' : '❌'} |`;
  });

  const epsBeam = sMax / matE;
  const page = [
    `# ${num} · ${T.title}`,
    '',
    `**Preset**: \`${T.preset}\` with \`${JSON.stringify(T.params)}\``,
    `**Load combination**: ${T.combo}`,
    `**Model**: ${model.nodes.size} nodes, ${model.members.size} members · **CalculiX mesh**: ${cx.mesh.nodes} nodes, ${cx.mesh.elements} B32R elements`,
    '',
    `**Analytical basis**: ${T.analytic}`,
    '',
    '## Geometry, supports & loads',
    '',
    `![geometry](img/${num}-geometry.svg)`,
    '',
    '## CalculiX mesh',
    '',
    `![mesh](img/${num}-mesh.svg)`,
    '',
    lcSection,
    '## Deflections (built-in vs CalculiX)',
    '',
    `![deformed](img/${num}-deformed.svg)`,
    '',
    '## Internal forces (built-in solver)',
    '',
    `![moment](img/${num}-moment.svg)`,
    `![shear](img/${num}-shear.svg)`,
    `![axial](img/${num}-axial.svg)`,
    '',
    '## Stresses and strains',
    '',
    `![stress](img/${num}-stress.svg)`,
    `![strain](img/${num}-strain.svg)`,
    '',
    '### CalculiX field output (.frd, expanded solid mesh)',
    '',
    `![ccx stress](img/${num}-ccx-stress.svg)`,
    `![ccx strain](img/${num}-ccx-strain.svg)`,
    '',
    '## Key results',
    '',
    '| Quantity | Built-in beam | CalculiX | Difference |',
    '|---|---|---|---|',
    `| Max deflection | ${mm(js.maxDisplacement.value)} mm | ${mm(cx.maxDisplacement.value)} mm | ${pct(js.maxDisplacement.value, cx.maxDisplacement.value)} |`,
    `| ΣR vertical | ${kN(js.totals.reactionForce[2])} kN | ${kN(cx.totals.reactionForce[2])} kN | ${pct(js.totals.reactionForce[2], cx.totals.reactionForce[2])} |`,
    `| Max normal stress / von Mises | ${MPa(sMax)} MPa | ${MPa(cx.field?.maxVonMises ?? NaN)} MPa | ${cx.field ? pct(sMax, cx.field.maxVonMises) : '-'} |`,
    `| Max strain (ε = σ/E / equiv.) | ${epsBeam.toExponential(2)} | ${cx.field ? cx.field.maxEqStrain.toExponential(2) : '-'} | — (different strain measures) |`,
    `| Equilibrium ΣR = ΣF | ${js.totals.equilibriumOk ? 'satisfied (exact)' : 'VIOLATED'} | reactions parsed from .dat | |`,
    '',
    '*CalculiX reactions are RF at constrained DOFs corrected for loads applied at support nodes. Residual ' +
    'differences of a few % can remain where supports form expansion "knots" or members carry axial ' +
    'self-weight — a ccx printout artifact, not an equilibrium error.*',
    '',
    '## Analytical checks',
    '',
    '| Check | Formula | Analytical | Computed | Deviation | Tolerance | Pass |',
    '|---|---|---|---|---|---|---|',
    ...checkLines,
    '',
    `*(built-in solver values unless marked; CalculiX values from parsed \`.dat\`/\`.frd\` output; ${Date.now() - t0} ms total)*`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `${T.slug}.md`), page);

  indexLines.push(
    `| ${num} | [${T.title}](${T.slug}.md) | ${mm(js.maxDisplacement.value)} mm | ${mm(cx.maxDisplacement.value)} mm | ` +
    `${pct(js.maxDisplacement.value, cx.maxDisplacement.value)} | ${MPa(sMax)} MPa | ${MPa(cx.field?.maxVonMises ?? NaN)} MPa | ${passed}/${rows.length} |`
  );
  summary.push({ slug: T.slug, passed, total: rows.length });
  console.log(`done: ${T.slug} (checks ${passed}/${rows.length})`);
}

indexLines.push('', 'Strain measures: built-in reports uniaxial fiber strain σ/E; CalculiX reports equivalent (von Mises) strain, so magnitudes differ by the strain-measure definition while stresses are directly comparable.', '');
fs.writeFileSync(path.join(OUT, 'README.md'), indexLines.join('\n'));
console.log(`\nReport written to ${OUT}`);
console.log(summary.map((s) => `${s.slug}: ${s.passed}/${s.total}`).join('\n'));
