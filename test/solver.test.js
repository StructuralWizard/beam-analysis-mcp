// Validation of the built-in solver against closed-form solutions, plus
// cross-validation against CalculiX when ccx is available on this machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/model.js';
import { analyzeBeamEngine } from '../src/solver.js';
import { runCalculix, findCcx } from '../src/calculix.js';
import { generateStructure, presets } from '../src/generators.js';

const E = 210e9;

function steelModel(name) {
  const m = new Model(name);
  m.addMaterial('steel', { E, nu: 0.3, density: 7850, fy: 355e6 });
  return m;
}

test('section properties: rectangle', () => {
  const m = steelModel('sec');
  m.addSection('r', 'rectangle', { b: 0.2, h: 0.4 });
  const s = m.sections.get('r');
  assert.ok(Math.abs(s.A - 0.08) < 1e-12);
  assert.ok(Math.abs(s.Iy - (0.2 * 0.4 ** 3) / 12) < 1e-12);
  assert.ok(Math.abs(s.Iz - (0.4 * 0.2 ** 3) / 12) < 1e-12);
});

test('simply supported beam under UDL matches 5wL^4/384EI and wL^2/8', () => {
  const L = 6, w = 10e3; // N/m downward
  const m = steelModel('ss');
  m.addSection('r', 'rectangle', { b: 0.2, h: 0.4 });
  const n1 = m.addNode(0, 0, 0);
  const n2 = m.addNode(L, 0, 0);
  const mem = m.addMember(n1, n2, { section: 'r', material: 'steel' });
  m.addMemberUDL(mem, { wz: -w });
  m.addSupport(n1, [1, 1, 1, 1, 0, 0]);
  m.addSupport(n2, 'roller-yz');
  const res = analyzeBeamEngine(m);
  const I = (0.2 * 0.4 ** 3) / 12;
  const deflExact = (5 * w * L ** 4) / (384 * E * I);
  assert.ok(Math.abs(res.maxDisplacement.value - deflExact) / deflExact < 1e-6,
    `defl ${res.maxDisplacement.value} vs exact ${deflExact}`);
  const Mexact = (w * L * L) / 8;
  const Mmax = Math.max(res.members[0].My, res.members[0].Mz);
  assert.ok(Math.abs(Mmax - Mexact) / Mexact < 1e-6, `M ${Mmax} vs exact ${Mexact}`);
  // reactions: each support carries wL/2 upward
  for (const rx of res.reactions) {
    assert.ok(Math.abs(rx.fz - (w * L) / 2) / (w * L) < 1e-9, `reaction ${rx.fz}`);
  }
  assert.ok(res.totals.equilibriumOk);
});

test('cantilever with tip point load matches PL^3/3EI and fixed-end moment PL', () => {
  const L = 3, P = 20e3;
  const m = steelModel('cant');
  m.addSection('r', 'rectangle', { b: 0.15, h: 0.3 });
  const n1 = m.addNode(0, 0, 0);
  const n2 = m.addNode(L, 0, 0);
  m.addMember(n1, n2, { section: 'r', material: 'steel' });
  m.addNodalLoad(n2, { fz: -P });
  m.addSupport(n1, 'fixed');
  const res = analyzeBeamEngine(m);
  const I = (0.15 * 0.3 ** 3) / 12;
  const exact = (P * L ** 3) / (3 * E * I);
  assert.ok(Math.abs(res.maxDisplacement.value - exact) / exact < 1e-9);
  const Mmax = Math.max(res.members[0].My, res.members[0].Mz);
  assert.ok(Math.abs(Mmax - P * L) / (P * L) < 1e-9);
  const rz = res.reactions[0].fz;
  assert.ok(Math.abs(rz - P) / P < 1e-9);
});

test('cantilever with UDL matches wL^4/8EI (fixed-end force consistency)', () => {
  const L = 4, w = 5e3;
  const m = steelModel('cant-udl');
  m.addSection('r', 'rectangle', { b: 0.15, h: 0.3 });
  const n1 = m.addNode(0, 0, 0);
  const n2 = m.addNode(L, 0, 0);
  const mem = m.addMember(n1, n2, { section: 'r', material: 'steel' });
  m.addMemberUDL(mem, { wz: -w });
  m.addSupport(n1, 'fixed');
  const res = analyzeBeamEngine(m);
  const I = (0.15 * 0.3 ** 3) / 12;
  const exact = (w * L ** 4) / (8 * E * I);
  assert.ok(Math.abs(res.maxDisplacement.value - exact) / exact < 1e-9,
    `defl ${res.maxDisplacement.value} vs ${exact}`);
  const Mexact = (w * L * L) / 2;
  const Mmax = Math.max(res.members[0].My, res.members[0].Mz);
  assert.ok(Math.abs(Mmax - Mexact) / Mexact < 1e-9);
});

test('two-bar truss: bar force P/(2 sin θ)', () => {
  const m = steelModel('truss2');
  m.addSection('bar', 'circle', { d: 0.05 });
  const a = m.addNode(0, 0, 0);
  const b = m.addNode(8, 0, 0);
  const c = m.addNode(4, 0, 3); // apex; bar length 5 m, sinθ = 3/5
  m.addMember(a, c, { section: 'bar', material: 'steel', type: 'truss' });
  m.addMember(b, c, { section: 'bar', material: 'steel', type: 'truss' });
  const P = 50e3;
  m.addNodalLoad(c, { fz: -P });
  m.addSupport(a, 'pinned');
  m.addSupport(b, 'pinned');
  m.addSupport(c, 'planar-xz');
  const res = analyzeBeamEngine(m);
  const exact = P / (2 * (3 / 5)); // compression
  for (const mm of res.members) {
    assert.ok(Math.abs(Math.abs(mm.N.min) - exact) / exact < 1e-9,
      `axial ${mm.N.min} vs -${exact}`);
  }
});

test('vertical member (column) is handled by the local-axis convention', () => {
  const m = steelModel('col');
  m.addSection('r', 'rectangle', { b: 0.3, h: 0.3 });
  const n1 = m.addNode(0, 0, 0);
  const n2 = m.addNode(0, 0, 3);
  m.addMember(n1, n2, { section: 'r', material: 'steel' });
  m.addSupport(n1, 'fixed');
  m.addNodalLoad(n2, { fx: 10e3, fz: -100e3 });
  const res = analyzeBeamEngine(m);
  assert.ok(res.totals.equilibriumOk);
  assert.ok(Math.abs(res.reactions[0].fz - 100e3) / 100e3 < 1e-9);
  assert.ok(Math.abs(res.reactions[0].fx + 10e3) / 10e3 < 1e-9);
});

test('all generator presets build, solve, and satisfy equilibrium', () => {
  const cases = Object.keys(presets).map((name) => [name, {}]);
  cases.push(['truss_bridge', { type: 'warren' }], ['truss_bridge', { type: 'howe' }]);
  for (const [name, params] of cases) {
    const { model } = generateStructure(name, params, `gen-${name}-${params.type || 'default'}`);
    const res = analyzeBeamEngine(model);
    assert.ok(res.totals.equilibriumOk,
      `${name}: equilibrium error ${res.totals.equilibriumError} (applied ${res.totals.appliedForce}, reactions ${res.totals.reactionForce})`);
    assert.ok(res.maxDisplacement.value > 0 && res.maxDisplacement.value < 1,
      `${name}: implausible max displacement ${res.maxDisplacement.value} m`);
  }
});

test('CalculiX cross-validation: SS beam deflection within 3%', { skip: !findCcx() }, async () => {
  const L = 6, w = 10e3;
  const m = steelModel('ss-ccx');
  m.addSection('r', 'rectangle', { b: 0.2, h: 0.4 });
  const n1 = m.addNode(0, 0, 0);
  const n2 = m.addNode(L, 0, 0);
  const mem = m.addMember(n1, n2, { section: 'r', material: 'steel' });
  m.addMemberUDL(mem, { wz: -w });
  m.addSupport(n1, [1, 1, 1, 1, 0, 0]);
  m.addSupport(n2, 'roller-yz');
  const js = analyzeBeamEngine(m);
  const cx = await runCalculix(m, { subdivisions: 8 });
  const diff = Math.abs(js.maxDisplacement.value - cx.maxDisplacement.value) / js.maxDisplacement.value;
  assert.ok(diff < 0.03, `beam=${js.maxDisplacement.value} ccx=${cx.maxDisplacement.value} diff=${(diff * 100).toFixed(2)}%`);
});
