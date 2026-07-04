// Cross-section property calculators.
//
// Local axis convention (see solver.js): local x runs along the member, local y and
// local z are the cross-section axes. For a horizontal member, local z points up
// (global +Z) and local y is horizontal. Section dimension `b` (width) lies along
// local y and `h` (height/depth) along local z, so Iy = strong-axis inertia for
// gravity bending of horizontal members.

export const SHAPES = ['rectangle', 'box', 'pipe', 'circle', 'isection', 'generic'];

function rectJ(b, h) {
  // St-Venant torsion constant of a solid rectangle (Roark approximation).
  const a = Math.max(b, h);
  const c = Math.min(b, h);
  return a * Math.pow(c, 3) * (1 / 3 - 0.21 * (c / a) * (1 - Math.pow(c, 4) / (12 * Math.pow(a, 4))));
}

export function sectionProps(shape, p) {
  let A, Iy, Iz, J, cy, cz, ccx, dims;
  switch (shape) {
    case 'rectangle': {
      const { b, h } = need(p, ['b', 'h']);
      A = b * h;
      Iy = (b * Math.pow(h, 3)) / 12;
      Iz = (h * Math.pow(b, 3)) / 12;
      J = rectJ(b, h);
      cy = b / 2; cz = h / 2;
      ccx = { section: 'RECT', line: [b, h] };
      dims = { kind: 'box', b, h };
      break;
    }
    case 'box': {
      const { b, h, t } = need(p, ['b', 'h', 't']);
      const bi = b - 2 * t, hi = h - 2 * t;
      if (bi <= 0 || hi <= 0) throw new Error('box section: wall thickness too large');
      A = b * h - bi * hi;
      Iy = (b * Math.pow(h, 3) - bi * Math.pow(hi, 3)) / 12;
      Iz = (h * Math.pow(b, 3) - hi * Math.pow(bi, 3)) / 12;
      const a0 = (b - t) * (h - t);
      const per = 2 * ((b - t) + (h - t));
      J = (4 * a0 * a0 * t) / per; // thin-wall closed section
      cy = b / 2; cz = h / 2;
      ccx = { section: 'BOX', line: [b, h, t, t, t, t] };
      dims = { kind: 'box', b, h };
      break;
    }
    case 'pipe': {
      const { d, t } = need(p, ['d', 't']);
      const di = d - 2 * t;
      if (di <= 0) throw new Error('pipe section: wall thickness too large');
      A = (Math.PI / 4) * (d * d - di * di);
      Iy = Iz = (Math.PI / 64) * (Math.pow(d, 4) - Math.pow(di, 4));
      J = 2 * Iy;
      cy = cz = d / 2;
      ccx = { section: 'PIPE', line: [d / 2, t] };
      dims = { kind: 'cylinder', r: d / 2 };
      break;
    }
    case 'circle': {
      const { d } = need(p, ['d']);
      A = (Math.PI / 4) * d * d;
      Iy = Iz = (Math.PI / 64) * Math.pow(d, 4);
      J = 2 * Iy;
      cy = cz = d / 2;
      ccx = { section: 'CIRC', line: [d / 2, d / 2] };
      dims = { kind: 'cylinder', r: d / 2 };
      break;
    }
    case 'isection': {
      const { b, h, tf, tw } = need(p, ['b', 'h', 'tf', 'tw']);
      const hw = h - 2 * tf;
      if (hw <= 0) throw new Error('isection: flanges too thick');
      A = 2 * b * tf + hw * tw;
      Iy = (b * Math.pow(h, 3) - (b - tw) * Math.pow(hw, 3)) / 12;
      Iz = (2 * tf * Math.pow(b, 3) + hw * Math.pow(tw, 3)) / 12;
      J = (2 * b * Math.pow(tf, 3) + (h - tf) * Math.pow(tw, 3)) / 3;
      cy = b / 2; cz = h / 2;
      ccx = rectEquivalent(A, Iy); // CalculiX has no I-beam section; use equivalent rectangle
      dims = { kind: 'box', b, h };
      break;
    }
    case 'generic': {
      const { A: a, Iy: iy, Iz: iz, J: j } = need(p, ['A', 'Iy', 'Iz', 'J']);
      A = a; Iy = iy; Iz = iz; J = j;
      cz = p.cz ?? Math.sqrt(12 * Iy / A) / 2;
      cy = p.cy ?? Math.sqrt(12 * Iz / A) / 2;
      ccx = rectEquivalent(A, Iy);
      dims = { kind: 'box', b: 2 * cy, h: 2 * cz };
      break;
    }
    default:
      throw new Error(`Unknown section shape "${shape}". Valid: ${SHAPES.join(', ')}`);
  }
  return { shape, params: p, A, Iy, Iz, J, cy, cz, Wy: Iy / cz, Wz: Iz / cy, ccx, dims };
}

// Rectangle matching a section's area and strong-axis inertia, for shapes CalculiX
// beam sections cannot represent directly (approximation is noted in tool output).
function rectEquivalent(A, Iy) {
  const h = Math.sqrt(12 * Iy / A);
  const b = A / h;
  return { section: 'RECT', line: [b, h], approx: true };
}

function need(p, keys) {
  for (const k of keys) {
    if (typeof p[k] !== 'number' || !(p[k] > 0)) {
      throw new Error(`Section parameter "${k}" is required and must be a positive number (got ${p[k]})`);
    }
  }
  return p;
}
