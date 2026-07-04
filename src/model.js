// Structural model container: nodes, materials, sections, members, supports, loads.
// Units are SI throughout: meters, Newtons, Pascals, kg/m^3. Global +Z is up.

import { sectionProps } from './sections.js';
import { vSub, vUnit, vCross, vDot, vScale, vAdd, vNorm } from './linalg.js';

export const SUPPORT_TYPES = {
  fixed: [1, 1, 1, 1, 1, 1],
  pinned: [1, 1, 1, 0, 0, 0],
  roller: [0, 0, 1, 0, 0, 0],       // vertical support only
  'roller-yz': [0, 1, 1, 0, 0, 0],  // bridge bearing: free to slide longitudinally (x)
  'planar-xz': [0, 1, 0, 1, 0, 1],  // out-of-plane restraint for 2D models in the XZ plane
};

export class Model {
  constructor(name) {
    this.name = name;
    this.nodes = new Map();      // id -> {id, x, y, z}
    this.materials = new Map();  // name -> {name, E, nu, G, density, fy}
    this.sections = new Map();   // name -> sectionProps result + name
    this.members = new Map();    // id -> {id, from, to, section, material, type, rollDeg}
    this.supports = new Map();   // nodeId -> [6 flags]
    this.loads = { nodal: [], udl: [], selfWeightFactor: 0 };
    this.results = {};           // engine -> last analysis results
    this._nextNode = 1;
    this._nextMember = 1;
  }

  addNode(x, y, z, id) {
    const nid = id ?? this._nextNode;
    if (this.nodes.has(nid)) throw new Error(`Node ${nid} already exists`);
    this.nodes.set(nid, { id: nid, x, y, z });
    this._nextNode = Math.max(this._nextNode, nid) + 1;
    return nid;
  }

  // Returns existing node id if a node already sits at (x,y,z), else creates one.
  nodeAt(x, y, z, tol = 1e-6) {
    for (const n of this.nodes.values()) {
      if (Math.abs(n.x - x) < tol && Math.abs(n.y - y) < tol && Math.abs(n.z - z) < tol) return n.id;
    }
    return this.addNode(x, y, z);
  }

  addMaterial(name, { E, nu = 0.3, density = 0, fy = 0 }) {
    if (!(E > 0)) throw new Error('Material E (Young\'s modulus, Pa) must be positive');
    this.materials.set(name, { name, E, nu, G: E / (2 * (1 + nu)), density, fy });
    return name;
  }

  addSection(name, shape, params) {
    const props = sectionProps(shape, params);
    this.sections.set(name, { name, ...props });
    return name;
  }

  addMember(from, to, { section, material, type = 'beam', rollDeg = 0, id } = {}) {
    const mid = id ?? this._nextMember;
    if (this.members.has(mid)) throw new Error(`Member ${mid} already exists`);
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      throw new Error(`Member ${mid}: node ${!this.nodes.has(from) ? from : to} does not exist`);
    }
    if (from === to) throw new Error(`Member ${mid}: from and to are the same node`);
    if (!this.sections.has(section)) throw new Error(`Member ${mid}: unknown section "${section}"`);
    if (!this.materials.has(material)) throw new Error(`Member ${mid}: unknown material "${material}"`);
    if (type !== 'beam' && type !== 'truss') throw new Error(`Member type must be "beam" or "truss"`);
    this.members.set(mid, { id: mid, from, to, section, material, type, rollDeg });
    this._nextMember = Math.max(this._nextMember, mid) + 1;
    return mid;
  }

  addSupport(nodeId, typeOrDofs) {
    if (!this.nodes.has(nodeId)) throw new Error(`Support: node ${nodeId} does not exist`);
    let dofs;
    if (Array.isArray(typeOrDofs)) dofs = typeOrDofs;
    else if (typeof typeOrDofs === 'string' && /^[01]{6}$/.test(typeOrDofs)) {
      dofs = typeOrDofs.split('').map(Number);
    } else if (SUPPORT_TYPES[typeOrDofs]) dofs = SUPPORT_TYPES[typeOrDofs];
    else throw new Error(`Unknown support "${typeOrDofs}". Use ${Object.keys(SUPPORT_TYPES).join('/')} or a 6-char 0/1 string (ux,uy,uz,rx,ry,rz)`);
    const existing = this.supports.get(nodeId) || [0, 0, 0, 0, 0, 0];
    this.supports.set(nodeId, existing.map((v, i) => (v || dofs[i] ? 1 : 0)));
  }

  addNodalLoad(nodeId, { fx = 0, fy = 0, fz = 0, mx = 0, my = 0, mz = 0 }) {
    if (!this.nodes.has(nodeId)) throw new Error(`Load: node ${nodeId} does not exist`);
    this.loads.nodal.push({ node: nodeId, f: [fx, fy, fz, mx, my, mz] });
  }

  addMemberUDL(memberId, { wx = 0, wy = 0, wz = 0, sys = 'global' }) {
    if (!this.members.has(memberId)) throw new Error(`UDL: member ${memberId} does not exist`);
    if (sys !== 'global' && sys !== 'local') throw new Error('UDL sys must be "global" or "local"');
    this.loads.udl.push({ member: memberId, w: [wx, wy, wz], sys });
  }

  // Geometry and local axes of a member. Local x = from->to. For non-vertical members
  // local z lies in the vertical plane (points "up"); vertical members use global X
  // as reference. rollDeg rotates y/z about the member axis.
  memberGeometry(m) {
    const a = this.nodes.get(m.from);
    const b = this.nodes.get(m.to);
    const dv = vSub([b.x, b.y, b.z], [a.x, a.y, a.z]);
    const L = vNorm(dv);
    if (L < 1e-9) throw new Error(`Member ${m.id} has zero length`);
    const xl = vScale(dv, 1 / L);
    const vertical = Math.abs(xl[2]) > 0.999;
    const aux = vertical ? [1, 0, 0] : [0, 0, 1];
    let yl = vUnit(vCross(aux, xl));
    let zl = vCross(xl, yl);
    if (m.rollDeg) {
      const c = Math.cos((m.rollDeg * Math.PI) / 180);
      const s = Math.sin((m.rollDeg * Math.PI) / 180);
      const y2 = vAdd(vScale(yl, c), vScale(zl, s));
      const z2 = vAdd(vScale(yl, -s), vScale(zl, c));
      yl = y2; zl = z2;
    }
    // Rotation matrix rows = local axes: v_local = R * v_global
    const R = [xl, yl, zl];
    return { a, b, L, xl, yl, zl, R };
  }

  validate() {
    if (this.nodes.size < 2) throw new Error('Model needs at least 2 nodes');
    if (this.members.size < 1) throw new Error('Model needs at least 1 member');
    if (this.supports.size < 1) throw new Error('Model has no supports');
    const used = new Set();
    for (const m of this.members.values()) { used.add(m.from); used.add(m.to); }
    for (const id of this.nodes.keys()) {
      if (!used.has(id)) throw new Error(`Node ${id} is not connected to any member`);
    }
  }

  summary() {
    return {
      name: this.name,
      nodes: this.nodes.size,
      members: this.members.size,
      supports: this.supports.size,
      materials: [...this.materials.keys()],
      sections: [...this.sections.keys()],
      loads: {
        nodal: this.loads.nodal.length,
        memberUDL: this.loads.udl.length,
        selfWeightFactor: this.loads.selfWeightFactor,
      },
      boundingBox: this.bbox(),
    };
  }

  bbox() {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const n of this.nodes.values()) {
      min = [Math.min(min[0], n.x), Math.min(min[1], n.y), Math.min(min[2], n.z)];
      max = [Math.max(max[0], n.x), Math.max(max[1], n.y), Math.max(max[2], n.z)];
    }
    return { min, max };
  }
}
