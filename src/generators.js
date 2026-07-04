// Parametric generators for common bridge and building typologies.
// Units: m, N, N/m. Loads are negative Z = downward. Default material is S355 steel.

import { Model } from './model.js';

function addSteel(model) {
  model.addMaterial('steel', { E: 210e9, nu: 0.3, density: 7850, fy: 355e6 });
  return 'steel';
}
function planarXZ(model) {
  for (const id of model.nodes.keys()) model.addSupport(id, 'planar-xz');
}

export const presets = {
  beam_bridge: {
    description: 'Girder bridge: one continuous line of beam elements over 1..n spans (simply supported or continuous).',
    defaults: {
      spans: [30], segmentsPerSpan: 6, udl: -50e3, selfWeight: 1,
      section: { shape: 'box', b: 0.8, h: 1.5, t: 0.03 },
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('girder', p.section.shape, p.section);
      const supportX = [0];
      let xEnd = 0;
      for (const s of p.spans) { xEnd += s; supportX.push(xEnd); }
      const nodes = [];
      let x = 0;
      nodes.push(model.addNode(0, 0, 0));
      for (const span of p.spans) {
        const seg = span / p.segmentsPerSpan;
        for (let i = 1; i <= p.segmentsPerSpan; i++) {
          nodes.push(model.addNode(x + seg * i, 0, 0));
        }
        x += span;
      }
      for (let i = 0; i < nodes.length - 1; i++) {
        const mid = model.addMember(nodes[i], nodes[i + 1], { section: 'girder', material: mat });
        model.addMemberUDL(mid, { wz: p.udl });
      }
      for (const sx of supportX) {
        const nid = model.nodeAt(sx, 0, 0);
        model.addSupport(nid, sx === 0 ? [1, 1, 1, 1, 0, 0] : 'roller-yz');
      }
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },

  truss_bridge: {
    description: '3D through-truss bridge (two planar trusses + deck cross-beams). Types: pratt, howe, warren.',
    defaults: {
      type: 'pratt', span: 60, height: 8, panels: 8, width: 7,
      deckUdl: -30e3, selfWeight: 1,
      chord: { shape: 'box', b: 0.4, h: 0.4, t: 0.02 },
      web: { shape: 'box', b: 0.3, h: 0.3, t: 0.016 },
      cross: { shape: 'isection', b: 0.25, h: 0.5, tf: 0.016, tw: 0.01 },
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('chord', p.chord.shape, p.chord);
      model.addSection('web', p.web.shape, p.web);
      model.addSection('cross', p.cross.shape, p.cross);
      const n = p.panels;
      const step = p.span / n;
      const beamOpts = { section: 'chord', material: mat };
      const webBeam = { section: 'web', material: mat };
      const webTruss = { section: 'web', material: mat, type: 'truss' };

      const bot = [], top = [];
      for (const y of [0, p.width]) {
        const b = [], t = [];
        for (let i = 0; i <= n; i++) b.push(model.addNode(i * step, y, 0));
        if (p.type === 'warren') {
          for (let i = 0; i < n; i++) t.push(model.addNode((i + 0.5) * step, y, p.height));
        } else {
          t.push(null);
          for (let i = 1; i <= n - 1; i++) t.push(model.addNode(i * step, y, p.height));
        }
        bot.push(b); top.push(t);
      }

      for (let s = 0; s < 2; s++) {
        const b = bot[s], t = top[s];
        for (let i = 0; i < n; i++) {
          const bid = model.addMember(b[i], b[i + 1], beamOpts);
          model.addMemberUDL(bid, { wz: p.deckUdl });
        }
        if (p.type === 'warren') {
          for (let i = 0; i < n - 1; i++) model.addMember(t[i], t[i + 1], beamOpts);
          // welded (beam) diagonals: they also provide the lateral restraint of the
          // top chord, which a pure pin-jointed Warren layout would lack
          for (let i = 0; i < n; i++) {
            model.addMember(b[i], t[i], webBeam);
            model.addMember(t[i], b[i + 1], webBeam);
          }
        } else {
          for (let i = 1; i < n - 1; i++) model.addMember(t[i], t[i + 1], beamOpts);
          model.addMember(b[0], t[1], webBeam);           // end posts
          model.addMember(b[n], t[n - 1], webBeam);
          for (let i = 1; i <= n - 1; i++) model.addMember(t[i], b[i], webBeam); // verticals
          const mid = n / 2;
          if (p.type === 'pratt') {
            for (let i = 1; i < mid; i++) model.addMember(t[i], b[i + 1], webTruss);
            for (let i = Math.ceil(mid) + (n % 2 === 0 ? 1 : 0); i <= n - 1; i++) model.addMember(t[i], b[i - 1], webTruss);
          } else { // howe
            for (let i = 2; i <= Math.floor(mid); i++) model.addMember(t[i], b[i - 1], webTruss);
            for (let i = Math.floor(mid); i <= n - 2; i++) model.addMember(t[i], b[i + 1], webTruss);
          }
        }
      }
      // deck cross-beams and top lateral struts
      const crossOpts = { section: 'cross', material: mat };
      for (let i = 0; i <= n; i++) model.addMember(bot[0][i], bot[1][i], crossOpts);
      const tRange = p.type === 'warren' ? [0, n - 1] : [1, n - 1];
      for (let i = tRange[0]; i <= tRange[1]; i++) {
        if (top[0][i] != null) model.addMember(top[0][i], top[1][i], crossOpts);
      }
      for (const s of [0, 1]) {
        model.addSupport(bot[s][0], 'pinned');
        model.addSupport(bot[s][n], 'roller-yz');
      }
      model.addSupport(bot[0][0], [0, 0, 0, 1, 0, 0]); // torsional restraint
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },

  arch_bridge: {
    description: 'Deck arch bridge: parabolic arch rib, spandrel columns, deck girder (planar XZ model).',
    defaults: {
      span: 80, rise: 16, segments: 16, deckClearance: 2,
      udl: -60e3, selfWeight: 1,
      arch: { shape: 'box', b: 1.2, h: 1.8, t: 0.05 },
      deck: { shape: 'box', b: 0.8, h: 1.4, t: 0.04 },
      column: { shape: 'pipe', d: 0.5, t: 0.02 },
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('arch', p.arch.shape, p.arch);
      model.addSection('deck', p.deck.shape, p.deck);
      model.addSection('column', p.column.shape, p.column);
      const L = p.span, n = p.segments;
      const deckZ = p.rise + p.deckClearance;
      const archN = [], deckN = [];
      for (let i = 0; i <= n; i++) {
        const x = (L * i) / n;
        archN.push(model.addNode(x, 0, (4 * p.rise * x * (L - x)) / (L * L)));
        deckN.push(model.addNode(x, 0, deckZ));
      }
      for (let i = 0; i < n; i++) {
        model.addMember(archN[i], archN[i + 1], { section: 'arch', material: mat });
        const d = model.addMember(deckN[i], deckN[i + 1], { section: 'deck', material: mat });
        model.addMemberUDL(d, { wz: p.udl });
      }
      for (let i = 1; i < n; i++) {
        model.addMember(archN[i], deckN[i], { section: 'column', material: mat });
      }
      model.addSupport(archN[0], 'fixed');
      model.addSupport(archN[n], 'fixed');
      model.addSupport(deckN[0], 'roller-yz');
      model.addSupport(deckN[n], 'roller-yz');
      planarXZ(model);
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },

  cable_stayed_bridge: {
    description: 'Single-pylon cable-stayed bridge, fan pattern stays (planar XZ model). Note: linear analysis — stays can carry compression.',
    defaults: {
      deckLength: 120, towerHeight: 35, towerBelowDeck: 8, staysPerSide: 5,
      udl: -100e3, selfWeight: 1,
      deck: { shape: 'box', b: 1.2, h: 2.2, t: 0.045 },
      tower: { shape: 'box', b: 2, h: 2, t: 0.06 },
      stayArea: 0.006,
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('deck', p.deck.shape, p.deck);
      model.addSection('tower', p.tower.shape, p.tower);
      model.addSection('stay', 'generic', { A: p.stayArea, Iy: 1e-7, Iz: 1e-7, J: 2e-7 });
      const half = p.deckLength / 2;
      const spacing = half / p.staysPerSide;
      const deckN = [];
      const nx = p.staysPerSide * 2;
      for (let i = 0; i <= nx; i++) deckN.push(model.addNode(-half + i * spacing, 0, 0));
      const center = p.staysPerSide;
      const towerBase = model.addNode(0, 0, -p.towerBelowDeck);
      const towerTop = model.addNode(0, 0, p.towerHeight);
      for (let i = 0; i < nx; i++) {
        const d = model.addMember(deckN[i], deckN[i + 1], { section: 'deck', material: mat });
        model.addMemberUDL(d, { wz: p.udl });
      }
      model.addMember(towerBase, deckN[center], { section: 'tower', material: mat });
      model.addMember(deckN[center], towerTop, { section: 'tower', material: mat });
      for (let i = 0; i <= nx; i++) {
        if (i === center) continue;
        model.addMember(towerTop, deckN[i], { section: 'stay', material: mat, type: 'truss' });
      }
      model.addSupport(towerBase, 'fixed');
      model.addSupport(deckN[0], 'roller-yz');
      model.addSupport(deckN[nx], 'roller-yz');
      planarXZ(model);
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },

  portal_frame: {
    description: 'Single-bay gable portal frame (warehouse/industrial shed, planar XZ model).',
    defaults: {
      span: 24, eaveHeight: 6, ridgeHeight: 8.5,
      roofUdl: -10e3, lateralLoad: 25e3, selfWeight: 1, baseFixity: 'pinned',
      column: { shape: 'isection', b: 0.3, h: 0.6, tf: 0.02, tw: 0.012 },
      rafter: { shape: 'isection', b: 0.25, h: 0.55, tf: 0.018, tw: 0.011 },
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('column', p.column.shape, p.column);
      model.addSection('rafter', p.rafter.shape, p.rafter);
      const b1 = model.addNode(0, 0, 0);
      const e1 = model.addNode(0, 0, p.eaveHeight);
      const apex = model.addNode(p.span / 2, 0, p.ridgeHeight);
      const e2 = model.addNode(p.span, 0, p.eaveHeight);
      const b2 = model.addNode(p.span, 0, 0);
      model.addMember(b1, e1, { section: 'column', material: mat });
      const r1 = model.addMember(e1, apex, { section: 'rafter', material: mat });
      const r2 = model.addMember(apex, e2, { section: 'rafter', material: mat });
      model.addMember(e2, b2, { section: 'column', material: mat });
      model.addMemberUDL(r1, { wz: p.roofUdl });
      model.addMemberUDL(r2, { wz: p.roofUdl });
      if (p.lateralLoad) model.addNodalLoad(e1, { fx: p.lateralLoad });
      model.addSupport(b1, p.baseFixity);
      model.addSupport(b2, p.baseFixity);
      planarXZ(model);
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },

  moment_frame_building: {
    description: 'Multi-story multi-bay moment-resisting frame (planar XZ model) with gravity + lateral floor loads.',
    defaults: {
      stories: 5, bays: 3, bayWidth: 6, storyHeight: 3.5,
      floorUdl: -30e3, lateralPerFloor: 20e3, selfWeight: 1,
      column: { shape: 'box', b: 0.4, h: 0.4, t: 0.016 },
      beam: { shape: 'isection', b: 0.25, h: 0.5, tf: 0.016, tw: 0.01 },
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('column', p.column.shape, p.column);
      model.addSection('beam', p.beam.shape, p.beam);
      const grid = [];
      for (let s = 0; s <= p.stories; s++) {
        const row = [];
        for (let c = 0; c <= p.bays; c++) row.push(model.addNode(c * p.bayWidth, 0, s * p.storyHeight));
        grid.push(row);
      }
      for (let s = 0; s < p.stories; s++) {
        for (let c = 0; c <= p.bays; c++) {
          model.addMember(grid[s][c], grid[s + 1][c], { section: 'column', material: mat });
        }
      }
      for (let s = 1; s <= p.stories; s++) {
        for (let c = 0; c < p.bays; c++) {
          const b = model.addMember(grid[s][c], grid[s][c + 1], { section: 'beam', material: mat });
          model.addMemberUDL(b, { wz: p.floorUdl });
        }
        if (p.lateralPerFloor) model.addNodalLoad(grid[s][0], { fx: (p.lateralPerFloor * s) / p.stories });
      }
      for (let c = 0; c <= p.bays; c++) model.addSupport(grid[0][c], 'fixed');
      planarXZ(model);
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },

  braced_frame_building: {
    description: 'Full 3D building frame: columns, two-way floor beams, X-bracing on perimeter faces.',
    defaults: {
      stories: 4, baysX: 2, baysY: 2, dx: 6, dy: 6, storyHeight: 3.5,
      floorUdl: -25e3, windXPerFloor: 40e3, selfWeight: 1,
      column: { shape: 'box', b: 0.35, h: 0.35, t: 0.014 },
      beam: { shape: 'isection', b: 0.24, h: 0.48, tf: 0.015, tw: 0.01 },
      brace: { shape: 'pipe', d: 0.16, t: 0.008 },
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('column', p.column.shape, p.column);
      model.addSection('beam', p.beam.shape, p.beam);
      model.addSection('brace', p.brace.shape, p.brace);
      const nid = (ix, iy, s) => model.nodeAt(ix * p.dx, iy * p.dy, s * p.storyHeight);
      const colOpts = { section: 'column', material: mat };
      const beamOpts = { section: 'beam', material: mat };
      const braceOpts = { section: 'brace', material: mat, type: 'truss' };
      for (let s = 0; s < p.stories; s++) {
        for (let ix = 0; ix <= p.baysX; ix++) {
          for (let iy = 0; iy <= p.baysY; iy++) {
            model.addMember(nid(ix, iy, s), nid(ix, iy, s + 1), colOpts);
          }
        }
      }
      for (let s = 1; s <= p.stories; s++) {
        for (let iy = 0; iy <= p.baysY; iy++) {
          for (let ix = 0; ix < p.baysX; ix++) {
            const b = model.addMember(nid(ix, iy, s), nid(ix + 1, iy, s), beamOpts);
            model.addMemberUDL(b, { wz: p.floorUdl });
          }
        }
        for (let ix = 0; ix <= p.baysX; ix++) {
          for (let iy = 0; iy < p.baysY; iy++) {
            const b = model.addMember(nid(ix, iy, s), nid(ix, iy + 1, s), beamOpts);
            model.addMemberUDL(b, { wz: p.floorUdl });
          }
        }
      }
      // X-bracing: first bay of each perimeter face, every story
      for (let s = 0; s < p.stories; s++) {
        for (const iy of [0, p.baysY]) {
          model.addMember(nid(0, iy, s), nid(1, iy, s + 1), braceOpts);
          model.addMember(nid(1, iy, s), nid(0, iy, s + 1), braceOpts);
        }
        for (const ix of [0, p.baysX]) {
          model.addMember(nid(ix, 0, s), nid(ix, 1, s + 1), braceOpts);
          model.addMember(nid(ix, 1, s), nid(ix, 0, s + 1), braceOpts);
        }
      }
      // wind in +X applied along the x=0 face at each floor
      for (let s = 1; s <= p.stories; s++) {
        const perNode = p.windXPerFloor / (p.baysY + 1);
        for (let iy = 0; iy <= p.baysY; iy++) {
          model.addNodalLoad(nid(0, iy, s), { fx: perNode });
        }
      }
      for (let ix = 0; ix <= p.baysX; ix++) {
        for (let iy = 0; iy <= p.baysY; iy++) model.addSupport(nid(ix, iy, 0), 'pinned');
      }
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },

  roof_truss: {
    description: 'Triangular (Howe-style) roof truss with point loads at top-chord panel points (planar XZ model).',
    defaults: {
      span: 24, height: 3.6, panels: 8, topNodeLoad: -12e3, selfWeight: 1,
      chord: { shape: 'box', b: 0.18, h: 0.18, t: 0.01 },
      web: { shape: 'circle', d: 0.08 },
    },
    build(model, p) {
      const mat = addSteel(model);
      model.addSection('chord', p.chord.shape, p.chord);
      model.addSection('web', p.web.shape, p.web);
      const n = p.panels, step = p.span / n;
      const chordOpts = { section: 'chord', material: mat };
      const webOpts = { section: 'web', material: mat, type: 'truss' };
      const bot = [], roof = [];
      for (let i = 0; i <= n; i++) bot.push(model.addNode(i * step, 0, 0));
      roof.push(bot[0]);
      const topOf = [null];
      for (let i = 1; i <= n - 1; i++) {
        const z = p.height * (1 - Math.abs((2 * i) / n - 1));
        const t = model.addNode(i * step, 0, z);
        roof.push(t); topOf.push(t);
      }
      roof.push(bot[n]);
      for (let i = 0; i < n; i++) model.addMember(bot[i], bot[i + 1], chordOpts);
      for (let i = 0; i < roof.length - 1; i++) model.addMember(roof[i], roof[i + 1], chordOpts);
      for (let i = 1; i <= n - 1; i++) model.addMember(bot[i], topOf[i], webOpts);
      const mid = n / 2;
      for (let i = 1; i < mid; i++) model.addMember(bot[i], topOf[i + 1], webOpts);
      for (let i = Math.ceil(mid) + 1; i <= n - 1; i++) model.addMember(bot[i], topOf[i - 1], webOpts);
      for (let i = 1; i <= n - 1; i++) model.addNodalLoad(topOf[i], { fz: p.topNodeLoad });
      model.addSupport(bot[0], 'pinned');
      model.addSupport(bot[n], 'roller-yz');
      planarXZ(model);
      model.loads.selfWeightFactor = p.selfWeight;
    },
  },
};

export function listPresets() {
  return Object.entries(presets).map(([name, p]) => ({
    name,
    description: p.description,
    defaults: p.defaults,
  }));
}

export function generateStructure(preset, params = {}, modelName) {
  const def = presets[preset];
  if (!def) {
    throw new Error(`Unknown preset "${preset}". Available: ${Object.keys(presets).join(', ')}`);
  }
  const p = deepMerge(structuredClone(def.defaults), params);
  const model = new Model(modelName || preset);
  def.build(model, p);
  model.validate();
  return { model, params: p };
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}
