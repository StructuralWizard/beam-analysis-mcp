// End-to-end exercise of the analysis pipeline over 10 structure typologies:
// build each model, solve with the built-in engine and with CalculiX, compare,
// and export FreeCAD (.FCStd) + CalculiX (.inp) files to ./output.
//
// Usage: node examples/run-typologies.js [--no-freecad] [--no-ccx]

import path from 'node:path';
import fs from 'node:fs';
import { generateStructure } from '../src/generators.js';
import { analyzeBeamEngine } from '../src/solver.js';
import { runCalculix, findCcx, writeInpContent } from '../src/calculix.js';
import { exportFCStd, findFreecadCmd } from '../src/freecad.js';

const OUT = path.resolve('output');
fs.mkdirSync(OUT, { recursive: true });
const doFreecad = !process.argv.includes('--no-freecad') && !!findFreecadCmd();
const doCcx = !process.argv.includes('--no-ccx') && !!findCcx();

const typologies = [
  ['01-simply-supported-bridge', 'beam_bridge', { spans: [35] }],
  ['02-continuous-girder-bridge', 'beam_bridge', { spans: [30, 40, 30] }],
  ['03-pratt-truss-bridge', 'truss_bridge', { type: 'pratt', span: 60, panels: 8 }],
  ['04-warren-truss-bridge', 'truss_bridge', { type: 'warren', span: 64, panels: 8, height: 7 }],
  ['05-arch-bridge', 'arch_bridge', { span: 90, rise: 18 }],
  ['06-cable-stayed-bridge', 'cable_stayed_bridge', { deckLength: 140, towerHeight: 40, staysPerSide: 6 }],
  ['07-portal-frame-warehouse', 'portal_frame', { span: 30, eaveHeight: 7, ridgeHeight: 10 }],
  ['08-moment-frame-5story', 'moment_frame_building', { stories: 5, bays: 3 }],
  ['09-braced-tower-3d', 'braced_frame_building', { stories: 6, baysX: 2, baysY: 2 }],
  ['10-howe-roof-truss', 'roof_truss', { span: 28, height: 4, panels: 8 }],
];

const rows = [];
for (const [name, preset, params] of typologies) {
  const t0 = Date.now();
  const { model } = generateStructure(preset, params, name);
  const js = analyzeBeamEngine(model);
  const jsMs = Date.now() - t0;

  let ccx = null, ccxErr = null;
  if (doCcx) {
    try { ccx = await runCalculix(model, { subdivisions: 4 }); }
    catch (e) { ccxErr = e.message.split('\n')[0]; }
  }

  const inp = writeInpContent(model, { subdivisions: 4 });
  fs.writeFileSync(path.join(OUT, `${name}.inp`), inp.content);

  let fcstd = null;
  if (doFreecad) {
    try {
      const res = await exportFCStd(model, path.join(OUT, `${name}.FCStd`));
      fcstd = res.path;
    } catch (e) { fcstd = `FAILED: ${e.message.split('\n')[0]}`; }
  }

  const util = js.members.reduce((a, m) => Math.max(a, m.utilization ?? 0), 0);
  const dJs = js.maxDisplacement.value * 1000;
  const dCx = ccx ? ccx.maxDisplacement.value * 1000 : null;
  rows.push({
    typology: name,
    'nodes/members': `${model.nodes.size}/${model.members.size}`,
    'maxDefl beam [mm]': dJs.toFixed(2),
    'maxDefl ccx [mm]': dCx != null ? dCx.toFixed(2) : (ccxErr || 'skipped'),
    'diff [%]': dCx != null ? ((Math.abs(dJs - dCx) / Math.max(dJs, dCx)) * 100).toFixed(1) : '-',
    'maxUtil [-]': util.toFixed(2),
    'equilibrium': js.totals.equilibriumOk ? 'ok' : `ERR ${js.totals.equilibriumError.toExponential(2)}`,
    'solve [ms]': jsMs,
    'FCStd': fcstd ? path.basename(String(fcstd)) : 'skipped',
  });
  console.log(`done: ${name}`);
}

console.log('\n=== 10 typologies: built-in beam engine vs CalculiX ===');
console.table(rows);
if (!doCcx) console.log('CalculiX not run (not found or --no-ccx).');
if (!doFreecad) console.log('FreeCAD export not run (not found or --no-freecad).');
console.log(`Outputs in: ${OUT}`);
