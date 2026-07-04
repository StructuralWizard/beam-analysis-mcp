// CalculiX (ccx) backend: writes a B32R beam-element input deck, runs the solver,
// and parses displacements/reactions from the .dat output.
//
// ccx is auto-detected: CCX_PATH env var, `ccx` on PATH, or the copy bundled with
// FreeCAD (e.g. C:\Program Files\FreeCAD x.y\bin\ccx.exe) — no separate install needed.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { m3tv } from './linalg.js';

const execFileP = promisify(execFile);
const G = 9.80665;

let cachedCcx;
export function findCcx() {
  if (cachedCcx !== undefined) return cachedCcx;
  cachedCcx = null;
  const candidates = [];
  if (process.env.CCX_PATH) candidates.push(process.env.CCX_PATH);
  const exe = process.platform === 'win32' ? 'ccx.exe' : 'ccx';
  // PATH lookup
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, exe));
  }
  // FreeCAD bundles ccx with its FEM workbench
  if (process.platform === 'win32') {
    for (const pf of ['C:\\Program Files', 'C:\\Program Files (x86)', path.join(os.homedir(), 'AppData', 'Local', 'Programs')]) {
      try {
        for (const d of fs.readdirSync(pf)) {
          if (/freecad/i.test(d)) candidates.push(path.join(pf, d, 'bin', 'ccx.exe'));
        }
      } catch { /* directory missing */ }
    }
  } else {
    candidates.push('/usr/bin/ccx', '/usr/local/bin/ccx', '/usr/bin/ccx_static');
    candidates.push('/Applications/FreeCAD.app/Contents/Resources/bin/ccx');
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) { cachedCcx = c; break; } } catch { /* skip */ }
  }
  return cachedCcx;
}

function fmt(v) {
  if (Object.is(v, -0)) v = 0;
  return v.toExponential(8);
}

// Subdivide members into B32R (3-node quadratic) beam elements. B32R is required
// by ccx for BOX sections and is also what FreeCAD's FEM workbench uses.
function buildMesh(model, nseg) {
  const nodes = [];            // {ccxId, x, y, z, modelId|null}
  const nodeIdOf = new Map();  // model node id -> ccx id
  let nid = 0;
  for (const n of model.nodes.values()) {
    nid++;
    nodes.push({ ccxId: nid, x: n.x, y: n.y, z: n.z, modelId: n.id });
    nodeIdOf.set(n.id, nid);
  }
  const elements = [];         // {id, n1, n2, member}
  const memberSegNodes = new Map(); // member id -> [ccx node ids along member]
  let eid = 0;
  for (const m of model.members.values()) {
    const a = model.nodes.get(m.from);
    const b = model.nodes.get(m.to);
    const chain = [nodeIdOf.get(m.from)];
    const segs = m.type === 'truss' ? 1 : nseg;
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      nid++;
      nodes.push({ ccxId: nid, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, modelId: null });
      chain.push(nid);
    }
    chain.push(nodeIdOf.get(m.to));
    for (let s = 0; s < chain.length - 1; s++) {
      const na = nodes[chain[s] - 1];
      const nb = nodes[chain[s + 1] - 1];
      nid++;
      nodes.push({ ccxId: nid, x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2, z: (na.z + nb.z) / 2, modelId: null });
      eid++;
      elements.push({ id: eid, n1: chain[s], nm: nid, n2: chain[s + 1], member: m.id });
    }
    memberSegNodes.set(m.id, chain);
  }
  return { nodes, elements, nodeIdOf, memberSegNodes };
}

export function writeInpContent(model, opts = {}) {
  model.validate();
  const nseg = opts.subdivisions ?? 4;
  const mesh = buildMesh(model, nseg);
  const L = [];
  const notes = [];
  if (model.sections.size > 1) {
    notes.push(
      'model mixes cross-sections: CalculiX expands joints between members of different sections into "knots", ' +
      'which are more flexible than the rigid joints of ideal beam theory — displacements of statically ' +
      'indeterminate 3D frames can exceed the built-in solver\'s (both are internally consistent)'
    );
  }
  L.push('*HEADING');
  L.push(`beam-analysis-mcp model: ${model.name}`);
  L.push('*NODE, NSET=NALL');
  for (const n of mesh.nodes) L.push(`${n.ccxId}, ${fmt(n.x)}, ${fmt(n.y)}, ${fmt(n.z)}`);

  // one element set per member (own section + orientation)
  const byMember = new Map();
  for (const e of mesh.elements) {
    if (!byMember.has(e.member)) byMember.set(e.member, []);
    byMember.get(e.member).push(e);
  }
  for (const [mid, elems] of byMember) {
    L.push(`*ELEMENT, TYPE=B32R, ELSET=EM${mid}`);
    for (const e of elems) L.push(`${e.id}, ${e.n1}, ${e.nm}, ${e.n2}`);
  }
  L.push(`*ELSET, ELSET=EALL, GENERATE`);
  L.push(`1, ${mesh.elements.length}`);

  const matName = (n) => 'M' + n.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  for (const mat of model.materials.values()) {
    L.push(`*MATERIAL, NAME=${matName(mat.name)}`);
    L.push('*ELASTIC');
    L.push(`${fmt(mat.E)}, ${fmt(mat.nu)}`);
    if (mat.density > 0) {
      L.push('*DENSITY');
      L.push(`${fmt(mat.density)}`);
    }
  }

  for (const [mid] of byMember) {
    const m = model.members.get(mid);
    const sec = model.sections.get(m.section);
    const mat = model.materials.get(m.material);
    const geo = model.memberGeometry(m);
    if (sec.ccx.approx) notes.push(`member ${mid}: section "${m.section}" (${sec.shape}) approximated as equivalent rectangle for CalculiX`);
    if (m.type === 'truss') notes.push(`member ${mid}: truss modeled as B31 beam in CalculiX (adds small bending stiffness)`);
    L.push(`*BEAM SECTION, ELSET=EM${mid}, MATERIAL=${matName(mat.name)}, SECTION=${sec.ccx.section}`);
    L.push(sec.ccx.line.map(fmt).join(', '));
    // direction of the cross-section 1-axis = member local y
    L.push(geo.yl.map(fmt).join(', '));
  }

  // supports
  const suppCcxIds = [];
  L.push('*BOUNDARY');
  for (const [nid, dofs] of model.supports) {
    const cid = mesh.nodeIdOf.get(nid);
    suppCcxIds.push(cid);
    dofs.forEach((v, i) => { if (v) L.push(`${cid}, ${i + 1}, ${i + 1}`); });
  }
  L.push('*NSET, NSET=NSUPP');
  for (let i = 0; i < suppCcxIds.length; i += 12) {
    L.push(suppCcxIds.slice(i, i + 12).join(', '));
  }

  // loads
  L.push('*STEP');
  L.push('*STATIC');
  const cload = new Map(); // ccx node -> [fx..mz]
  const addC = (cid, i, v) => {
    if (!cload.has(cid)) cload.set(cid, [0, 0, 0, 0, 0, 0]);
    cload.get(cid)[i] += v;
  };
  for (const l of model.loads.nodal) {
    const cid = mesh.nodeIdOf.get(l.node);
    l.f.forEach((v, i) => { if (v) addC(cid, i, v); });
  }
  // member UDLs -> equivalent nodal loads on the subdivided chain
  for (const l of model.loads.udl) {
    const m = model.members.get(l.member);
    const geo = model.memberGeometry(m);
    const wGlobal = l.sys === 'global' ? l.w : m3tv(geo.R, l.w);
    const chain = mesh.memberSegNodes.get(m.id);
    const segLen = geo.L / (chain.length - 1);
    for (let s = 0; s < chain.length - 1; s++) {
      for (let i = 0; i < 3; i++) {
        if (wGlobal[i]) {
          addC(chain[s], i, wGlobal[i] * segLen / 2);
          addC(chain[s + 1], i, wGlobal[i] * segLen / 2);
        }
      }
    }
  }
  if (cload.size) {
    L.push('*CLOAD');
    for (const [cid, f] of cload) {
      f.forEach((v, i) => { if (v) L.push(`${cid}, ${i + 1}, ${fmt(v)}`); });
    }
  }
  if (model.loads.selfWeightFactor) {
    const noDensity = [...model.materials.values()].filter((m) => !(m.density > 0));
    if (noDensity.length) notes.push(`self-weight requested but materials without density: ${noDensity.map((m) => m.name).join(', ')}`);
    L.push('*DLOAD');
    L.push(`EALL, GRAV, ${fmt(G * model.loads.selfWeightFactor)}, 0., 0., -1.`);
  }
  L.push('*NODE PRINT, NSET=NALL');
  L.push('U');
  L.push('*NODE PRINT, NSET=NSUPP');
  L.push('RF');
  L.push('*END STEP');
  return { content: L.join('\n') + '\n', mesh, notes };
}

function parseDat(dat) {
  const lines = dat.split(/\r?\n/);
  const result = { displacements: new Map(), reactions: new Map() };
  let mode = null;
  for (const line of lines) {
    const header = line.match(/^\s*(displacements|forces)\s*\(/);
    if (header) {
      mode = header[1] === 'displacements' ? 'displacements' : 'reactions';
      continue;
    }
    if (!line.trim()) continue;
    const row = line.match(/^\s*(\d+)\s+([-+0-9.Ee]+)\s+([-+0-9.Ee]+)\s+([-+0-9.Ee]+)\s*$/);
    if (row && mode) {
      result[mode].set(Number(row[1]), [Number(row[2]), Number(row[3]), Number(row[4])]);
    } else if (!row) {
      // non-numeric, non-header line ends the block
      if (!/^\s*$/.test(line)) mode = mode; // headers repeated per time step are caught above
    }
  }
  return result;
}

export async function runCalculix(model, opts = {}) {
  const ccx = findCcx();
  if (!ccx) {
    throw new Error(
      'CalculiX (ccx) not found. Install FreeCAD (which bundles ccx), install CalculiX, ' +
      'or set the CCX_PATH environment variable to the ccx executable.'
    );
  }
  const { content, mesh, notes } = writeInpContent(model, opts);
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-mcp-ccx-'));
  const job = 'job';
  fs.writeFileSync(path.join(jobDir, job + '.inp'), content);
  let stdout = '';
  try {
    const res = await execFileP(ccx, ['-i', job], {
      cwd: jobDir,
      timeout: opts.timeoutMs ?? 180000,
      env: { ...process.env, OMP_NUM_THREADS: '2' },
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = res.stdout || '';
  } catch (err) {
    stdout = (err.stdout || '') + (err.stderr || '');
    if (!fs.existsSync(path.join(jobDir, job + '.dat'))) {
      throw new Error(`CalculiX failed: ${extractCcxError(stdout) || err.message}`);
    }
  }
  const ccxErr = extractCcxError(stdout);
  const datPath = path.join(jobDir, job + '.dat');
  if (!fs.existsSync(datPath)) throw new Error(`CalculiX produced no results: ${ccxErr || 'unknown error'}`);
  const dat = fs.readFileSync(datPath, 'utf8');
  const parsed = parseDat(dat);
  if (parsed.displacements.size === 0) {
    throw new Error(`CalculiX ran but no displacements were found in .dat. ${ccxErr || ''}`);
  }

  // map back to model nodes
  const modelIdOf = new Map();
  for (const n of mesh.nodes) if (n.modelId !== null) modelIdOf.set(n.ccxId, n.modelId);
  let maxDisp = { value: 0, node: null, vector: [0, 0, 0] };
  const displacements = [];
  for (const [cid, d] of parsed.displacements) {
    const mag = Math.hypot(d[0], d[1], d[2]);
    const entry = { node: modelIdOf.get(cid) ?? `mesh:${cid}`, ux: d[0], uy: d[1], uz: d[2], mag };
    if (modelIdOf.has(cid)) displacements.push(entry);
    if (mag > maxDisp.value) maxDisp = { value: mag, node: entry.node, vector: d };
  }
  const reactions = [];
  const sumR = [0, 0, 0];
  for (const [cid, r] of parsed.reactions) {
    if (!modelIdOf.has(cid)) continue;
    reactions.push({ node: modelIdOf.get(cid), fx: r[0], fy: r[1], fz: r[2] });
    sumR[0] += r[0]; sumR[1] += r[1]; sumR[2] += r[2];
  }
  return {
    engine: 'calculix',
    ccxPath: ccx,
    jobDir,
    mesh: { nodes: mesh.nodes.length, elements: mesh.elements.length },
    notes,
    maxDisplacement: maxDisp,
    displacements,
    reactions,
    totals: { reactionForce: sumR },
  };
}

function extractCcxError(stdout) {
  const m = stdout.match(/\*ERROR[\s\S]{0,300}/);
  return m ? m[0].split('\n').slice(0, 4).join(' ').trim() : null;
}
