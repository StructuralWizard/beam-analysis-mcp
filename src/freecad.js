// FreeCAD export: builds a solid 3D representation of the structural model
// (extruded member solids + support markers) and saves it as a .FCStd document
// by running FreeCAD's headless `freecadcmd` with a generated Python script.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

let cachedCmd;
export function findFreecadCmd() {
  if (cachedCmd !== undefined) return cachedCmd;
  cachedCmd = null;
  const candidates = [];
  if (process.env.FREECAD_CMD) candidates.push(process.env.FREECAD_CMD);
  const exe = process.platform === 'win32' ? 'freecadcmd.exe' : 'freecadcmd';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, exe));
  }
  if (process.platform === 'win32') {
    for (const pf of ['C:\\Program Files', 'C:\\Program Files (x86)', path.join(os.homedir(), 'AppData', 'Local', 'Programs')]) {
      try {
        for (const d of fs.readdirSync(pf)) {
          if (/freecad/i.test(d)) candidates.push(path.join(pf, d, 'bin', 'freecadcmd.exe'));
        }
      } catch { /* directory missing */ }
    }
  } else {
    candidates.push('/usr/bin/freecadcmd', '/usr/local/bin/freecadcmd');
    candidates.push('/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd');
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) { cachedCmd = c; break; } } catch { /* skip */ }
  }
  return cachedCmd;
}

const SCALE = 1000; // model meters -> FreeCAD millimeters

export async function exportFCStd(model, outPath, opts = {}) {
  const cmd = findFreecadCmd();
  if (!cmd) {
    throw new Error(
      'freecadcmd not found. Install FreeCAD or set the FREECAD_CMD environment variable.'
    );
  }
  const payload = { docName: model.name.replace(/[^A-Za-z0-9_]/g, '_') || 'Structure', members: [], supports: [] };
  for (const m of model.members.values()) {
    const sec = model.sections.get(m.section);
    const geo = model.memberGeometry(m);
    payload.members.push({
      a: [geo.a.x * SCALE, geo.a.y * SCALE, geo.a.z * SCALE],
      len: geo.L * SCALE,
      xl: geo.xl, yl: geo.yl, zl: geo.zl,
      shape: sec.dims.kind,
      b: (sec.dims.b || 0) * SCALE,
      h: (sec.dims.h || 0) * SCALE,
      r: (sec.dims.r || 0) * SCALE,
    });
  }
  for (const [nid] of model.supports) {
    const n = model.nodes.get(nid);
    payload.supports.push([n.x * SCALE, n.y * SCALE, n.z * SCALE]);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-mcp-fc-'));
  const jsonPath = path.join(workDir, 'model.json');
  const scriptPath = path.join(workDir, 'build.py');
  fs.writeFileSync(jsonPath, JSON.stringify(payload));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const script = `
import json, sys
import FreeCAD as App
import Part

data = json.load(open(${py(jsonPath)}))
doc = App.newDocument(data["docName"])
shapes = []
for m in data["members"]:
    xl, yl, zl = m["xl"], m["yl"], m["zl"]
    M = App.Matrix(xl[0], yl[0], zl[0], 0,
                   xl[1], yl[1], zl[1], 0,
                   xl[2], yl[2], zl[2], 0,
                   0, 0, 0, 1)
    rot = App.Rotation(M)
    a = App.Vector(*m["a"])
    if m["shape"] == "cylinder" and m["r"] > 0:
        s = Part.makeCylinder(m["r"], m["len"], a, App.Vector(*xl))
    else:
        b = max(m["b"], 1.0); h = max(m["h"], 1.0)
        s = Part.makeBox(m["len"], b, h)
        s.Placement = App.Placement(a + rot.multVec(App.Vector(0, -b / 2.0, -h / 2.0)), rot)
    shapes.append(s)

obj = doc.addObject("Part::Feature", "Members")
obj.Shape = Part.makeCompound(shapes)

marks = []
for s in data["supports"]:
    c = Part.makeCone(250.0, 0.0, 400.0, App.Vector(s[0], s[1], s[2] - 400.0), App.Vector(0, 0, 1))
    marks.append(c)
if marks:
    so = doc.addObject("Part::Feature", "Supports")
    so.Shape = Part.makeCompound(marks)

doc.recompute()
doc.saveAs(${py(outPath)})
print("FCSTD_SAVED:" + ${py(outPath)})
`;
  fs.writeFileSync(scriptPath, script);
  const res = await execFileP(cmd, [scriptPath], {
    timeout: opts.timeoutMs ?? 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (res.stdout || '') + (res.stderr || '');
  if (!fs.existsSync(outPath)) {
    throw new Error(`FreeCAD export failed:\n${out.slice(-1500)}`);
  }
  return { path: outPath, freecadCmd: cmd, members: payload.members.length, supports: payload.supports.length };
}

function py(s) {
  return 'r"""' + s + '"""';
}
