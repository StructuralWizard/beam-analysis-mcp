// Parser for CalculiX .frd result files (ASCII). For beam models ccx expands
// every beam into volume elements, so the .frd contains the expanded 3D mesh.
// We read nodal coordinates, displacements (DISP), stresses (STRESS) and total
// strains (TOSTRAIN), compute von Mises equivalents, and map the expanded-node
// fields back onto the beam axis nodes by proximity (nodes of the expanded
// cross-section lie within roughly one section size of the axis).

export function parseFrd(text) {
  const lines = text.split(/\r?\n/);
  const nodes = new Map();   // id -> [x,y,z]
  const fields = {};         // name -> Map(id -> number[])
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s{4}2C/.test(line)) {
      i++;
      while (i < lines.length && lines[i].startsWith(' -1')) {
        const l = lines[i];
        const id = parseInt(l.slice(3, 13), 10);
        nodes.set(id, [num(l, 13), num(l, 25), num(l, 37)]);
        i++;
      }
      continue;
    }
    const blk = line.match(/^\s*-4\s+(\w+)/);
    if (blk) {
      const name = blk[1];
      i++;
      while (i < lines.length && lines[i].startsWith(' -5')) i++;
      const map = new Map();
      while (i < lines.length && lines[i].startsWith(' -1')) {
        const l = lines[i];
        const id = parseInt(l.slice(3, 13), 10);
        const vals = [];
        for (let c = 13; c + 12 <= l.length + 1; c += 12) {
          const v = num(l, c);
          if (Number.isFinite(v)) vals.push(v);
        }
        map.set(id, vals);
        i++;
      }
      fields[name] = map; // last time step wins
      continue;
    }
    i++;
  }
  return { nodes, fields };
}

function num(l, start) {
  return parseFloat(l.slice(start, start + 12));
}

export function vonMises(s) {
  const [sx, sy, sz, sxy, syz, szx] = s;
  return Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (sxy * sxy + syz * syz + szx * szx));
}
export function vonMisesStrain(e) {
  // equivalent (von Mises) strain with nu_eff = 0.5 convention
  const [ex, ey, ez, exy, eyz, ezx] = e;
  return (Math.SQRT2 / 3) * Math.sqrt((ex - ey) ** 2 + (ey - ez) ** 2 + (ez - ex) ** 2 + 6 * (exy * exy + eyz * eyz + ezx * ezx));
}

// Map expanded-mesh nodal fields onto beam-axis chain nodes.
// chains: Map(memberId -> [{x,y,z}...]); radii: Map(memberId -> search radius m)
// Returns Map(memberId -> per-chain-node {disp:[3], vm, evm}) and global maxima.
export function mapToChains(frd, chains, radii) {
  const ids = [...frd.nodes.keys()];
  const disp = frd.fields.DISP;
  const stress = frd.fields.STRESS;
  const strain = frd.fields.TOSTRAIN;
  const out = new Map();
  let maxVm = 0, maxEvm = 0, maxDisp = 0;
  for (const [mid, pts] of chains) {
    const r = radii.get(mid) ?? 0.5;
    const r2 = r * r;
    const row = pts.map((p) => {
      let dsum = [0, 0, 0], dn = 0, vm = 0, evm = 0;
      for (const id of ids) {
        const c = frd.nodes.get(id);
        const dx = c[0] - p.x, dy = c[1] - p.y, dz = c[2] - p.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        const d = disp?.get(id);
        if (d) { dsum[0] += d[0]; dsum[1] += d[1]; dsum[2] += d[2]; dn++; }
        const s = stress?.get(id);
        if (s && s.length >= 6) vm = Math.max(vm, vonMises(s));
        const e = strain?.get(id);
        if (e && e.length >= 6) evm = Math.max(evm, vonMisesStrain(e));
      }
      const d = dn ? [dsum[0] / dn, dsum[1] / dn, dsum[2] / dn] : [0, 0, 0];
      maxVm = Math.max(maxVm, vm);
      maxEvm = Math.max(maxEvm, evm);
      maxDisp = Math.max(maxDisp, Math.hypot(...d));
      return { disp: d, vm, evm };
    });
    out.set(mid, row);
  }
  return { chains: out, maxVm, maxEvm, maxDisp };
}
