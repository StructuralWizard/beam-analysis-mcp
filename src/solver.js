// Built-in linear-static 3D frame solver (direct stiffness method).
//
// - 6 DOF per node (ux,uy,uz,rx,ry,rz), Euler-Bernoulli beam elements.
// - Member UDLs handled via consistent fixed-end forces, so nodal results are exact.
// - Internal deflections/forces recovered with Hermite shape functions plus the
//   quartic UDL correction term, so mid-span deflections and moments are exact too
//   (one element per member is enough for linear static analysis).
// - Truss members contribute axial stiffness only. Rotational (or other) DOFs that
//   end up with zero stiffness are automatically restrained and reported.

import { solveDense, m3v, m3tv, zeros } from './linalg.js';

const G = 9.80665;

function beamLocalStiffness(E, Gm, A, Iy, Iz, J, L) {
  const k = zeros(12, 12);
  const set = (i, j, v) => { k[i][j] = v; k[j][i] = v; };
  const ea = (E * A) / L;
  const gj = (Gm * J) / L;
  set(0, 0, ea); set(6, 6, ea); set(0, 6, -ea);
  set(3, 3, gj); set(9, 9, gj); set(3, 9, -gj);
  // bending about local z (displacement along local y), inertia Iz
  const az = (12 * E * Iz) / L ** 3, bz = (6 * E * Iz) / L ** 2, cz = (4 * E * Iz) / L, dz = (2 * E * Iz) / L;
  set(1, 1, az); set(1, 5, bz); set(1, 7, -az); set(1, 11, bz);
  set(5, 5, cz); set(5, 7, -bz); set(5, 11, dz);
  set(7, 7, az); set(7, 11, -bz);
  set(11, 11, cz);
  // bending about local y (displacement along local z), inertia Iy — mirrored signs
  const ay = (12 * E * Iy) / L ** 3, by = (6 * E * Iy) / L ** 2, cy = (4 * E * Iy) / L, dy = (2 * E * Iy) / L;
  set(2, 2, ay); set(2, 4, -by); set(2, 8, -ay); set(2, 10, -by);
  set(4, 4, cy); set(4, 8, by); set(4, 10, dy);
  set(8, 8, ay); set(8, 10, by);
  set(10, 10, cy);
  return k;
}

function trussLocalStiffness(E, A, L) {
  const k = zeros(12, 12);
  const ea = (E * A) / L;
  k[0][0] = ea; k[6][6] = ea; k[0][6] = -ea; k[6][0] = -ea;
  return k;
}

// Consistent nodal loads (local coords) for a full-length UDL wl = [wx,wy,wz] N/m.
function udlEquivalentLocal(wl, L, isTruss) {
  const eq = new Float64Array(12);
  eq[0] = wl[0] * L / 2; eq[6] = wl[0] * L / 2;
  eq[1] = wl[1] * L / 2; eq[7] = wl[1] * L / 2;
  eq[2] = wl[2] * L / 2; eq[8] = wl[2] * L / 2;
  if (!isTruss) {
    eq[5] = wl[1] * L * L / 12; eq[11] = -wl[1] * L * L / 12;
    eq[4] = -wl[2] * L * L / 12; eq[10] = wl[2] * L * L / 12;
  }
  return eq;
}

// Transform a 12-vector between local and global using rotation matrix R (rows = local axes).
function toGlobal12(R, v) {
  const out = new Float64Array(12);
  for (let blk = 0; blk < 4; blk++) {
    const g = m3tv(R, [v[blk * 3], v[blk * 3 + 1], v[blk * 3 + 2]]);
    out[blk * 3] = g[0]; out[blk * 3 + 1] = g[1]; out[blk * 3 + 2] = g[2];
  }
  return out;
}
function toLocal12(R, v) {
  const out = new Float64Array(12);
  for (let blk = 0; blk < 4; blk++) {
    const l = m3v(R, [v[blk * 3], v[blk * 3 + 1], v[blk * 3 + 2]]);
    out[blk * 3] = l[0]; out[blk * 3 + 1] = l[1]; out[blk * 3 + 2] = l[2];
  }
  return out;
}

export function analyzeBeamEngine(model, opts = {}) {
  model.validate();
  const samples = opts.samples ?? 21;
  const nodeIds = [...model.nodes.keys()];
  const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
  const ndof = nodeIds.length * 6;
  const K = zeros(ndof, ndof);
  const F = new Float64Array(ndof);
  const warnings = [];

  // member UDLs grouped by member id
  const udlByMember = new Map();
  for (const l of model.loads.udl) {
    if (!udlByMember.has(l.member)) udlByMember.set(l.member, []);
    udlByMember.get(l.member).push(l);
  }

  const elems = [];
  for (const m of model.members.values()) {
    const sec = model.sections.get(m.section);
    const mat = model.materials.get(m.material);
    const geo = model.memberGeometry(m);
    const { L, R } = geo;
    const isTruss = m.type === 'truss';
    const kloc = isTruss
      ? trussLocalStiffness(mat.E, sec.A, L)
      : beamLocalStiffness(mat.E, mat.G, sec.A, sec.Iy, sec.Iz, sec.J, L);

    // total distributed load on this member, in local coords
    let wg = [0, 0, 0]; // global part
    let wlSum = [0, 0, 0];
    for (const l of udlByMember.get(m.id) || []) {
      if (l.sys === 'global') wg = [wg[0] + l.w[0], wg[1] + l.w[1], wg[2] + l.w[2]];
      else wlSum = [wlSum[0] + l.w[0], wlSum[1] + l.w[1], wlSum[2] + l.w[2]];
    }
    if (model.loads.selfWeightFactor && mat.density > 0) {
      wg = [wg[0], wg[1], wg[2] - mat.density * sec.A * G * model.loads.selfWeightFactor];
    }
    const wgLocal = m3v(R, wg);
    const wl = [wlSum[0] + wgLocal[0], wlSum[1] + wgLocal[1], wlSum[2] + wgLocal[2]];
    const eqLoc = udlEquivalentLocal(wl, L, isTruss);
    const eqGlob = toGlobal12(R, eqLoc);

    const ia = nodeIndex.get(m.from) * 6;
    const ib = nodeIndex.get(m.to) * 6;
    const map = [];
    for (let i = 0; i < 6; i++) map.push(ia + i);
    for (let i = 0; i < 6; i++) map.push(ib + i);

    // k_global = T' k_local T computed column-block-wise
    const kg = zeros(12, 12);
    // build T as 12x12 from R
    const T = zeros(12, 12);
    for (let blk = 0; blk < 4; blk++) {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[blk * 3 + i][blk * 3 + j] = R[i][j];
    }
    const tmp = zeros(12, 12);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let r = 0; r < 12; r++) s += kloc[i][r] * T[r][j];
      tmp[i][j] = s;
    }
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let r = 0; r < 12; r++) s += T[r][i] * tmp[r][j];
      kg[i][j] = s;
    }

    for (let i = 0; i < 12; i++) {
      F[map[i]] += eqGlob[i];
      for (let j = 0; j < 12; j++) K[map[i]][map[j]] += kg[i][j];
    }
    elems.push({ m, sec, mat, geo, kloc, T, R, wl, eqLoc, eqGlob, map, isTruss, L });
  }

  for (const l of model.loads.nodal) {
    const base = nodeIndex.get(l.node) * 6;
    for (let i = 0; i < 6; i++) F[base + i] += l.f[i];
  }

  // constraints
  const constrained = new Array(ndof).fill(false);
  for (const [nid, dofs] of model.supports) {
    const base = nodeIndex.get(nid) * 6;
    dofs.forEach((v, i) => { if (v) constrained[base + i] = true; });
  }
  // auto-restrain zero-stiffness DOFs (e.g. rotations at pure truss nodes)
  let maxDiag = 0;
  for (let i = 0; i < ndof; i++) maxDiag = Math.max(maxDiag, K[i][i]);
  let autoFixed = 0;
  for (let i = 0; i < ndof; i++) {
    if (!constrained[i] && K[i][i] <= maxDiag * 1e-10) { constrained[i] = true; autoFixed++; }
  }
  if (autoFixed) warnings.push(`${autoFixed} zero-stiffness DOFs auto-restrained (typically rotations at truss-only nodes)`);

  const freeIdx = [];
  for (let i = 0; i < ndof; i++) if (!constrained[i]) freeIdx.push(i);
  if (freeIdx.length === 0) throw new Error('All DOFs are constrained — nothing to solve');
  const nf = freeIdx.length;
  const Kff = new Array(nf);
  const Ff = new Array(nf);
  for (let i = 0; i < nf; i++) {
    Kff[i] = new Array(nf);
    for (let j = 0; j < nf; j++) Kff[i][j] = K[freeIdx[i]][freeIdx[j]];
    Ff[i] = F[freeIdx[i]];
  }
  const uf = solveDense(Kff, Ff);
  const u = new Float64Array(ndof);
  for (let i = 0; i < nf; i++) u[freeIdx[i]] = uf[i];

  // reactions: sum of element nodal forces minus applied nodal loads, at supported nodes
  const nodeForce = new Float64Array(ndof); // sum over elements of (kg*u - eqGlob)
  const memberResults = [];
  let maxDisp = { value: 0, node: null, member: null, at: 0, vector: [0, 0, 0] };

  for (const e of elems) {
    const ue = new Float64Array(12);
    for (let i = 0; i < 12; i++) ue[i] = u[e.map[i]];
    const uloc = toLocal12(e.R, ue);
    // f_local = k_local * u_local - eq_local  (forces exerted by nodes on element)
    const floc = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      let s = 0;
      for (let j = 0; j < 12; j++) s += e.kloc[i][j] * uloc[j];
      floc[i] = s - e.eqLoc[i];
    }
    const fglob = toGlobal12(e.R, floc);
    for (let i = 0; i < 12; i++) nodeForce[e.map[i]] += fglob[i];

    // internal action envelopes + deflection sampling
    const { L, sec, mat, wl } = e;
    const EIy = mat.E * sec.Iy, EIz = mat.E * sec.Iz;
    let env = {
      Nmin: Infinity, Nmax: -Infinity, VyMax: 0, VzMax: 0,
      MyMax: 0, MzMax: 0, T: Math.abs(floc[3]), stressMax: 0, deflMax: 0, deflAt: 0,
    };
    const stations = [];
    for (let s = 0; s < samples; s++) {
      const x = (L * s) / (samples - 1);
      const N = -(floc[0] + wl[0] * x);
      // truss members carry axial force only; transverse loads lump to their end nodes
      const Vy = e.isTruss ? 0 : -(floc[1] + wl[1] * x);
      const Vz = e.isTruss ? 0 : -(floc[2] + wl[2] * x);
      const Mz = e.isTruss ? 0 : -floc[5] + floc[1] * x + (wl[1] * x * x) / 2;
      const My = e.isTruss ? 0 : -(floc[4] + floc[2] * x + (wl[2] * x * x) / 2);
      env.Nmin = Math.min(env.Nmin, N); env.Nmax = Math.max(env.Nmax, N);
      env.VyMax = Math.max(env.VyMax, Math.abs(Vy));
      env.VzMax = Math.max(env.VzMax, Math.abs(Vz));
      env.MyMax = Math.max(env.MyMax, Math.abs(My));
      env.MzMax = Math.max(env.MzMax, Math.abs(Mz));
      const stress = Math.abs(N) / sec.A + Math.abs(My) / sec.Wy + Math.abs(Mz) / sec.Wz;
      env.stressMax = Math.max(env.stressMax, stress);

      // deflection: Hermite interpolation + quartic UDL correction (exact for E-B beams)
      const xi = x / L;
      const H1 = 1 - 3 * xi ** 2 + 2 * xi ** 3;
      const H2 = L * (xi - 2 * xi ** 2 + xi ** 3);
      const H3 = 3 * xi ** 2 - 2 * xi ** 3;
      const H4 = L * (xi ** 3 - xi ** 2);
      const ux = uloc[0] * (1 - xi) + uloc[6] * xi;
      let vy, vz;
      if (e.isTruss) {
        vy = uloc[1] * (1 - xi) + uloc[7] * xi;
        vz = uloc[2] * (1 - xi) + uloc[8] * xi;
      } else {
        vy = H1 * uloc[1] + H2 * uloc[5] + H3 * uloc[7] + H4 * uloc[11]
          + (EIz > 0 ? (wl[1] * x * x * (L - x) * (L - x)) / (24 * EIz) : 0);
        vz = H1 * uloc[2] - H2 * uloc[4] + H3 * uloc[8] - H4 * uloc[10]
          + (EIy > 0 ? (wl[2] * x * x * (L - x) * (L - x)) / (24 * EIy) : 0);
      }
      const dg = m3tv(e.R, [ux, vy, vz]);
      const mag = Math.hypot(dg[0], dg[1], dg[2]);
      stations.push({ x, N, Vy, Vz, My, Mz, stress, disp: dg });
      if (mag > env.deflMax) { env.deflMax = mag; env.deflAt = x; }
      if (mag > maxDisp.value) {
        maxDisp = { value: mag, node: null, member: e.m.id, at: +x.toFixed(3), vector: dg };
      }
    }
    const util = mat.fy > 0 ? env.stressMax / mat.fy : null;
    memberResults.push({
      member: e.m.id, from: e.m.from, to: e.m.to, type: e.m.type, L,
      N: { min: env.Nmin, max: env.Nmax },
      Vy: env.VyMax, Vz: env.VzMax, My: env.MyMax, Mz: env.MzMax, T: env.T,
      endForcesLocal: Array.from(floc),
      stressMax: env.stressMax, utilization: util,
      deflMax: env.deflMax,
      stations,
    });
  }

  // nodal displacements
  const displacements = [];
  for (const [nid, i] of nodeIndex) {
    const base = i * 6;
    const d = Array.from(u.slice(base, base + 6));
    const mag = Math.hypot(d[0], d[1], d[2]);
    displacements.push({ node: nid, ux: d[0], uy: d[1], uz: d[2], rx: d[3], ry: d[4], rz: d[5], mag });
    if (mag > maxDisp.value) maxDisp = { value: mag, node: nid, member: null, at: null, vector: [d[0], d[1], d[2]] };
  }

  // reactions at supported nodes
  const applied = new Float64Array(ndof);
  for (const l of model.loads.nodal) {
    const base = nodeIndex.get(l.node) * 6;
    for (let i = 0; i < 6; i++) applied[base + i] += l.f[i];
  }
  const reactions = [];
  const sumR = [0, 0, 0];
  for (const [nid] of model.supports) {
    const base = nodeIndex.get(nid) * 6;
    const r = [];
    for (let i = 0; i < 6; i++) r.push(nodeForce[base + i] - applied[base + i]);
    reactions.push({ node: nid, fx: r[0], fy: r[1], fz: r[2], mx: r[3], my: r[4], mz: r[5] });
    sumR[0] += r[0]; sumR[1] += r[1]; sumR[2] += r[2];
  }
  // total applied load (nodal + distributed equivalents)
  const sumF = [0, 0, 0];
  for (const [nid, i] of nodeIndex) {
    void nid;
    const base = i * 6;
    sumF[0] += F[base]; sumF[1] += F[base + 1]; sumF[2] += F[base + 2];
  }
  const eqErr = Math.hypot(sumR[0] + sumF[0], sumR[1] + sumF[1], sumR[2] + sumF[2]);
  const eqRef = Math.max(1, Math.hypot(...sumF));

  return {
    engine: 'beam',
    dofs: { total: ndof, free: nf },
    warnings,
    maxDisplacement: maxDisp,
    displacements,
    reactions,
    totals: {
      appliedForce: sumF,
      reactionForce: sumR,
      equilibriumError: eqErr,
      equilibriumOk: eqErr < 1e-6 * eqRef + 1e-4,
    },
    members: memberResults,
  };
}
