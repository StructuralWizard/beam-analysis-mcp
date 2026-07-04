#!/usr/bin/env node
// beam-analysis-mcp — MCP server for structural analysis of bridges and buildings.
// Built-in 3D frame solver + optional CalculiX backend + FreeCAD export.
// Transport: stdio. All logging goes to stderr (stdout is the MCP protocol channel).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import { Model, SUPPORT_TYPES } from './model.js';
import { SHAPES } from './sections.js';
import { analyzeBeamEngine } from './solver.js';
import { runCalculix, writeInpContent, findCcx } from './calculix.js';
import { exportFCStd, findFreecadCmd } from './freecad.js';
import { listPresets, generateStructure } from './generators.js';
import fs from 'node:fs';

const models = new Map();
const OUT_DIR = process.env.BEAM_MCP_OUTPUT || path.join(os.homedir(), 'beam-mcp-output');

const server = new McpServer({ name: 'beam-analysis-mcp', version: '0.1.0' });

function getModel(name) {
  const m = models.get(name);
  if (!m) {
    throw new Error(`No model named "${name}". Existing models: ${[...models.keys()].join(', ') || '(none)'}`);
  }
  return m;
}
function uniqueName(base) {
  let name = base, i = 2;
  while (models.has(name)) name = `${base}-${i++}`;
  return name;
}
function ok(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}
function r(v, sig = 5) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  return Number(v.toPrecision(sig));
}

function summarizeBeamResults(res) {
  const byUtil = [...res.members].sort((a, b) => (b.utilization ?? b.stressMax) - (a.utilization ?? a.stressMax));
  return {
    engine: res.engine,
    dofs: res.dofs,
    warnings: res.warnings,
    equilibrium: {
      appliedForce_kN: res.totals.appliedForce.map((v) => r(v / 1e3)),
      reactionForce_kN: res.totals.reactionForce.map((v) => r(v / 1e3)),
      ok: res.totals.equilibriumOk,
    },
    maxDisplacement: {
      mm: r(res.maxDisplacement.value * 1000),
      atNode: res.maxDisplacement.node,
      alongMember: res.maxDisplacement.member,
      vector_mm: res.maxDisplacement.vector.map((v) => r(v * 1000)),
    },
    maxUtilization: byUtil[0]?.utilization != null ? r(byUtil[0].utilization) : null,
    mostStressedMembers: byUtil.slice(0, 8).map((m) => ({
      member: m.member, type: m.type,
      N_kN: { min: r(m.N.min / 1e3), max: r(m.N.max / 1e3) },
      Mmax_kNm: r(Math.max(m.My, m.Mz) / 1e3),
      Vmax_kN: r(Math.max(m.Vy, m.Vz) / 1e3),
      stress_MPa: r(m.stressMax / 1e6),
      utilization: m.utilization != null ? r(m.utilization) : null,
    })),
    reactions_kN: res.reactions.map((x) => ({
      node: x.node, fx: r(x.fx / 1e3), fy: r(x.fy / 1e3), fz: r(x.fz / 1e3),
    })),
  };
}

function summarizeCcxResults(res) {
  return {
    engine: res.engine,
    ccxPath: res.ccxPath,
    mesh: res.mesh,
    notes: res.notes,
    maxDisplacement: {
      mm: r(res.maxDisplacement.value * 1000),
      atNode: res.maxDisplacement.node,
      vector_mm: res.maxDisplacement.vector.map((v) => r(v * 1000)),
    },
    sumReactions_kN: res.totals.reactionForce.map((v) => r(v / 1e3)),
  };
}

// ---------- environment ----------
server.registerTool('check_environment', {
  title: 'Check environment',
  description: 'Report availability of the built-in solver, CalculiX (ccx) and FreeCAD (freecadcmd) on this machine.',
  inputSchema: {},
}, async () => ok({
  node: process.version,
  builtInBeamSolver: 'available',
  calculix: findCcx() || 'NOT FOUND (install FreeCAD or CalculiX, or set CCX_PATH)',
  freecadCmd: findFreecadCmd() || 'NOT FOUND (install FreeCAD or set FREECAD_CMD)',
  outputDir: OUT_DIR,
  units: 'SI: meters, Newtons, Pascals, kg/m3. Global +Z is up; loads down are negative fz/wz.',
}));

// ---------- model building ----------
server.registerTool('create_model', {
  title: 'Create empty model',
  description: 'Create a new empty structural model. Use add_nodes/add_material/add_section/add_members/add_supports/add_loads to build it, or use generate_structure for common typologies.',
  inputSchema: { name: z.string().describe('Unique model name') },
}, async ({ name }) => {
  const n = uniqueName(name);
  models.set(n, new Model(n));
  return ok({ model: n, hint: 'Units: m, N, Pa. Global +Z up.' });
});

server.registerTool('list_structure_presets', {
  title: 'List structure presets',
  description: 'List parametric structure generators (bridge and building typologies) with their default parameters.',
  inputSchema: {},
}, async () => ok(listPresets()));

server.registerTool('generate_structure', {
  title: 'Generate a structure from a preset',
  description: 'Create a complete model (geometry, sections, supports, loads) from a parametric typology preset: beam_bridge, truss_bridge (pratt/howe/warren), arch_bridge, cable_stayed_bridge, portal_frame, moment_frame_building, braced_frame_building, roof_truss. Params override preset defaults (see list_structure_presets).',
  inputSchema: {
    preset: z.string().describe('Preset name, e.g. "truss_bridge"'),
    params: z.record(z.any()).optional().describe('Overrides for the preset defaults, e.g. {"span": 80, "panels": 10, "type": "warren"}'),
    name: z.string().optional().describe('Model name (defaults to preset name)'),
  },
}, async ({ preset, params, name }) => {
  const n = uniqueName(name || preset);
  const { model, params: used } = generateStructure(preset, params, n);
  models.set(n, model);
  return ok({ model: n, paramsUsed: used, summary: model.summary() });
});

server.registerTool('add_nodes', {
  title: 'Add nodes',
  description: 'Add nodes to a model. Coordinates in meters, global +Z up. Node ids are optional (auto-assigned integers).',
  inputSchema: {
    model: z.string(),
    nodes: z.array(z.object({
      id: z.number().int().optional(),
      x: z.number(), y: z.number(), z: z.number(),
    })).min(1),
  },
}, async ({ model, nodes }) => {
  const m = getModel(model);
  const ids = nodes.map((n) => m.addNode(n.x, n.y, n.z, n.id));
  return ok({ added: ids, totalNodes: m.nodes.size });
});

server.registerTool('add_material', {
  title: 'Add material',
  description: 'Add a material. E = Young\'s modulus [Pa], nu = Poisson ratio, density [kg/m3] (needed for self-weight), fy = yield/design strength [Pa] (needed for utilization checks). Example steel: E=210e9, nu=0.3, density=7850, fy=355e6.',
  inputSchema: {
    model: z.string(),
    name: z.string(),
    E: z.number().positive(),
    nu: z.number().min(0).max(0.49).optional(),
    density: z.number().min(0).optional(),
    fy: z.number().min(0).optional(),
  },
}, async ({ model, name, ...props }) => {
  const m = getModel(model);
  m.addMaterial(name, props);
  return ok({ material: m.materials.get(name) });
});

server.registerTool('add_section', {
  title: 'Add cross-section',
  description: `Add a cross-section. Shapes and required params [m]: rectangle{b,h}, box{b,h,t}, pipe{d,t}, circle{d}, isection{b,h,tf,tw}, generic{A,Iy,Iz,J[,cy,cz]}. Convention: b = width (local y), h = depth (local z); for horizontal members local z is vertical, so Iy is the strong axis for gravity bending. Valid shapes: ${SHAPES.join(', ')}.`,
  inputSchema: {
    model: z.string(),
    name: z.string(),
    shape: z.string(),
    params: z.record(z.number()).describe('Shape parameters, e.g. {"b":0.3,"h":0.6,"t":0.02}'),
  },
}, async ({ model, name, shape, params }) => {
  const m = getModel(model);
  m.addSection(name, shape, params);
  const s = m.sections.get(name);
  return ok({ section: { name, shape, A: r(s.A), Iy: r(s.Iy), Iz: r(s.Iz), J: r(s.J) } });
});

server.registerTool('add_members', {
  title: 'Add members',
  description: 'Add beam or truss members between existing nodes. type "beam" (default, 6 DOF frame element) or "truss" (axial only, for braces/cables/truss webs). rollDeg rotates the section about the member axis.',
  inputSchema: {
    model: z.string(),
    members: z.array(z.object({
      id: z.number().int().optional(),
      from: z.number().int(),
      to: z.number().int(),
      section: z.string(),
      material: z.string(),
      type: z.enum(['beam', 'truss']).optional(),
      rollDeg: z.number().optional(),
    })).min(1),
  },
}, async ({ model, members }) => {
  const m = getModel(model);
  const ids = members.map((mem) => m.addMember(mem.from, mem.to, mem));
  return ok({ added: ids, totalMembers: m.members.size });
});

server.registerTool('add_supports', {
  title: 'Add supports',
  description: `Add supports at nodes. type is one of ${Object.keys(SUPPORT_TYPES).join(', ')}, or a 6-character 0/1 string for (ux,uy,uz,rx,ry,rz), e.g. "111100". "roller-yz" is a typical bridge sliding bearing; "planar-xz" restrains out-of-plane DOFs for 2D models in the XZ plane.`,
  inputSchema: {
    model: z.string(),
    supports: z.array(z.object({
      node: z.number().int(),
      type: z.string(),
    })).min(1),
  },
}, async ({ model, supports }) => {
  const m = getModel(model);
  for (const s of supports) m.addSupport(s.node, s.type);
  return ok({ totalSupports: m.supports.size });
});

server.registerTool('add_loads', {
  title: 'Add loads',
  description: 'Add nodal loads [N, N·m], member uniformly distributed loads [N/m], and/or set the self-weight factor (1 = full gravity). Downward = negative fz/wz. UDL sys "global" (default) or "local" (member axes).',
  inputSchema: {
    model: z.string(),
    nodal: z.array(z.object({
      node: z.number().int(),
      fx: z.number().optional(), fy: z.number().optional(), fz: z.number().optional(),
      mx: z.number().optional(), my: z.number().optional(), mz: z.number().optional(),
    })).optional(),
    memberUDL: z.array(z.object({
      member: z.number().int(),
      wx: z.number().optional(), wy: z.number().optional(), wz: z.number().optional(),
      sys: z.enum(['global', 'local']).optional(),
    })).optional(),
    selfWeightFactor: z.number().min(0).optional(),
  },
}, async ({ model, nodal, memberUDL, selfWeightFactor }) => {
  const m = getModel(model);
  for (const l of nodal || []) m.addNodalLoad(l.node, l);
  for (const l of memberUDL || []) m.addMemberUDL(l.member, l);
  if (selfWeightFactor != null) m.loads.selfWeightFactor = selfWeightFactor;
  return ok({ loads: m.summary().loads });
});

// ---------- analysis ----------
server.registerTool('analyze', {
  title: 'Run structural analysis',
  description: 'Run linear-static analysis. engine "beam" = built-in 3D direct-stiffness solver (fast, exact for Euler-Bernoulli frames); "calculix" = CalculiX FEM (B32R beam elements); "both" = run both and compare max displacements. Returns displacements, reactions, member force envelopes, stresses and utilization (stress/fy).',
  inputSchema: {
    model: z.string(),
    engine: z.enum(['beam', 'calculix', 'both']).optional().describe('Default "beam"'),
    subdivisions: z.number().int().min(1).max(20).optional().describe('CalculiX elements per member (default 4)'),
  },
}, async ({ model, engine = 'beam', subdivisions }) => {
  const m = getModel(model);
  const out = {};
  if (engine === 'beam' || engine === 'both') {
    const res = analyzeBeamEngine(m);
    m.results.beam = res;
    out.beam = summarizeBeamResults(res);
  }
  if (engine === 'calculix' || engine === 'both') {
    const res = await runCalculix(m, { subdivisions });
    m.results.calculix = res;
    out.calculix = summarizeCcxResults(res);
  }
  if (engine === 'both') {
    const a = m.results.beam.maxDisplacement.value;
    const b = m.results.calculix.maxDisplacement.value;
    out.comparison = {
      maxDisplacement_mm: { beam: r(a * 1000), calculix: r(b * 1000) },
      relativeDifference: a > 0 ? r(Math.abs(a - b) / Math.max(a, b)) : 0,
    };
  }
  return ok(engine === 'both' ? out : out[engine]);
});

server.registerTool('get_results', {
  title: 'Get detailed results',
  description: 'Retrieve detailed results from the last analysis: "displacements" (per node), "reactions" (per support), or "member_forces" (end forces + envelopes per member). Optionally filter by ids.',
  inputSchema: {
    model: z.string(),
    what: z.enum(['displacements', 'reactions', 'member_forces']),
    engine: z.enum(['beam', 'calculix']).optional().describe('Default "beam"'),
    ids: z.array(z.number().int()).optional().describe('Node ids or member ids to filter'),
  },
}, async ({ model, what, engine = 'beam', ids }) => {
  const m = getModel(model);
  const res = m.results[engine];
  if (!res) throw new Error(`No ${engine} results for "${model}" — run analyze first.`);
  const idSet = ids ? new Set(ids) : null;
  if (what === 'displacements') {
    const rows = res.displacements
      .filter((d) => !idSet || idSet.has(d.node))
      .map((d) => ({ node: d.node, ux_mm: r(d.ux * 1e3), uy_mm: r(d.uy * 1e3), uz_mm: r(d.uz * 1e3), mag_mm: r(d.mag * 1e3) }));
    return ok(rows);
  }
  if (what === 'reactions') {
    const rows = res.reactions
      .filter((d) => !idSet || idSet.has(d.node))
      .map((d) => ({
        node: d.node, fx_kN: r(d.fx / 1e3), fy_kN: r(d.fy / 1e3), fz_kN: r(d.fz / 1e3),
        ...(d.mx !== undefined ? { mx_kNm: r(d.mx / 1e3), my_kNm: r(d.my / 1e3), mz_kNm: r(d.mz / 1e3) } : {}),
      }));
    return ok(rows);
  }
  if (engine !== 'beam') throw new Error('member_forces are available from the "beam" engine');
  const rows = res.members
    .filter((d) => !idSet || idSet.has(d.member))
    .map((mm) => ({
      member: mm.member, from: mm.from, to: mm.to, type: mm.type, L_m: r(mm.L),
      N_kN: { min: r(mm.N.min / 1e3), max: r(mm.N.max / 1e3) },
      Vy_kN: r(mm.Vy / 1e3), Vz_kN: r(mm.Vz / 1e3),
      My_kNm: r(mm.My / 1e3), Mz_kNm: r(mm.Mz / 1e3), T_kNm: r(mm.T / 1e3),
      stressMax_MPa: r(mm.stressMax / 1e6),
      utilization: mm.utilization != null ? r(mm.utilization) : null,
      deflMax_mm: r(mm.deflMax * 1e3),
    }));
  return ok(rows);
});

// ---------- export ----------
server.registerTool('export_freecad', {
  title: 'Export model to FreeCAD',
  description: 'Build a solid 3D representation of the model (member solids + support markers) and save it as a FreeCAD .FCStd document you can open in FreeCAD. Runs headless freecadcmd; takes ~5-20 s.',
  inputSchema: {
    model: z.string(),
    path: z.string().optional().describe('Output .FCStd path (default: <output dir>/<model>.FCStd)'),
  },
}, async ({ model, path: outPath }) => {
  const m = getModel(model);
  const target = outPath || path.join(OUT_DIR, `${m.name}.FCStd`);
  const res = await exportFCStd(m, target);
  return ok(res);
});

server.registerTool('export_calculix_inp', {
  title: 'Export CalculiX input deck',
  description: 'Write the CalculiX .inp input deck for the model (B32R beam elements) without running the solver.',
  inputSchema: {
    model: z.string(),
    path: z.string().optional().describe('Output .inp path (default: <output dir>/<model>.inp)'),
    subdivisions: z.number().int().min(1).max(20).optional(),
  },
}, async ({ model, path: outPath, subdivisions }) => {
  const m = getModel(model);
  const { content, mesh, notes } = writeInpContent(m, { subdivisions });
  const target = outPath || path.join(OUT_DIR, `${m.name}.inp`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return ok({ path: target, nodes: mesh.nodes.length, elements: mesh.elements.length, notes });
});

// ---------- management ----------
server.registerTool('model_info', {
  title: 'Model info',
  description: 'Summary of a model: counts, materials, sections, loads, bounding box.',
  inputSchema: { model: z.string() },
}, async ({ model }) => ok(getModel(model).summary()));

server.registerTool('list_models', {
  title: 'List models',
  description: 'List all models in this session.',
  inputSchema: {},
}, async () => ok([...models.values()].map((m) => m.summary())));

server.registerTool('delete_model', {
  title: 'Delete model',
  description: 'Delete a model from the session.',
  inputSchema: { model: z.string() },
}, async ({ model }) => {
  getModel(model);
  models.delete(model);
  return ok({ deleted: model });
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`beam-analysis-mcp ready (ccx: ${findCcx() || 'not found'}, freecadcmd: ${findFreecadCmd() || 'not found'})`);
