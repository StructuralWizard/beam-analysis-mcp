# Validation & test documentation

This document describes every automated test in the repository, the theory each one
checks against, the acceptance tolerances, and the results of the 10-typology
cross-validation between the built-in solver and CalculiX.

Reference machine for the recorded results: Windows 11, Node 25, FreeCAD 1.1
(bundled CalculiX 2.22 at `C:\Program Files\FreeCAD 1.1\bin\ccx.exe`).

## How to run

```bash
npm test            # unit + closed-form + MCP e2e + CalculiX cross-check
npm run typologies  # 10-typology comparison table + .FCStd/.inp exports
```

The CalculiX test is skipped automatically when `ccx` is not found, so `npm test`
passes on machines without FreeCAD/CalculiX.

## 1. Closed-form solver validation (`test/solver.test.js`)

The built-in engine uses Euler-Bernoulli elements with consistent fixed-end forces
and Hermite + quartic-correction recovery, so nodal *and* in-span results should be
**exact** for these cases — tolerances are numerical (1e-6 to 1e-9 relative), not
engineering approximations.

| Test | Model | Checked against | Tolerance |
|---|---|---|---|
| Section properties | 200×400 mm rectangle | A = bh, Iy = bh³/12, Iz = hb³/12 | 1e-12 abs |
| Simply supported beam, UDL | L = 6 m, w = 10 kN/m, 1 element | δ_mid = 5wL⁴/384EI, M_max = wL²/8, R = wL/2 each | 1e-6 rel |
| Cantilever, tip point load | L = 3 m, P = 20 kN | δ_tip = PL³/3EI, M_fix = PL, R = P | 1e-9 rel |
| Cantilever, UDL | L = 4 m, w = 5 kN/m | δ_tip = wL⁴/8EI, M_fix = wL²/2 | 1e-9 rel |
| Two-bar truss | 3-4-5 geometry, apex load P = 50 kN | N = P/(2 sin θ) = 41.67 kN compression | 1e-9 rel |
| Vertical member | Column with axial + lateral tip load | Reaction equilibrium, exercises the vertical-member local-axis branch | 1e-9 rel |
| Generator presets | All 8 presets + warren + howe truss variants | ΣReactions = ΣApplied (3 force components), max displacement plausible (0 < δ < 1 m) | solver equilibrium check |

Notes on what these catch:

- The **simply supported / cantilever UDL** pair validates the consistent fixed-end
  force vector *and* the in-span recovery: one element per member must reproduce the
  mid-span 5wL⁴/384EI exactly (Hermite interpolation alone would give 4wL⁴/384; the
  quartic UDL correction supplies the remaining 1/384).
- The **cantilever moment** checks caught a real sign error during development: the
  internal moment recovery was correct at the fixed end but grew along the member
  instead of decaying (M(L) = 2PL instead of 0). The current formulas are derived
  from segment statics and verified by these tests.
- The **preset equilibrium loop** is a regression net over every generator; it
  caught a lateral mechanism in the pure pin-jointed Warren truss layout (top chord
  free to sway out-of-plane), fixed by modeling Warren diagonals as welded (beam)
  members.

## 2. MCP protocol end-to-end (`test/mcp.test.js`)

Spawns the real server (`src/server.js`) over stdio and drives it with the official
`@modelcontextprotocol/sdk` client — the same transport Claude Desktop uses:

1. `listTools` — asserts the core tools are registered.
2. `generate_structure` — builds a 48 m Warren truss bridge, asserts model summary.
3. `analyze` (beam engine) — asserts equilibrium flag and a plausible deflection.
4. `get_results` (member_forces with id filter) — asserts row count.

This guards the zod schemas, JSON serialization, and server startup (e.g. nothing
accidentally printing to stdout, which would corrupt the protocol stream).

## 3. CalculiX cross-validation (`test/solver.test.js`, skipped without ccx)

Simply supported beam (6 m, UDL), built-in engine vs CalculiX B32R deck with 8
subdivisions: max deflection must agree within **3%** (measured: <1%). The residual
difference is physical — ccx expands beams into solid elements, which include shear
deformation absent from Euler-Bernoulli theory.

## 4. Ten-typology cross-validation (`examples/run-typologies.js`)

Each typology is generated, solved with both engines, checked for equilibrium, and
exported to `.FCStd` (FreeCAD solid model) and `.inp` (CalculiX deck):

| # | Typology | Nodes/Members | δ_max beam [mm] | δ_max ccx [mm] | Diff |
|---|---|---|---|---|---|
| 1 | Simply supported girder bridge, 35 m | 7/6 | 137.40 | 138.11 | 0.5% |
| 2 | Continuous girder bridge, 30+40+30 m | 19/18 | 56.65 | 57.83 | 2.0% |
| 3 | Pratt truss bridge, 60 m | 32/74 | 48.46 | 48.23 | 0.5% |
| 4 | Warren truss bridge, 64 m | 34/79 | 69.51 | 69.27 | 0.3% |
| 5 | Deck arch bridge, 90 m | 34/47 | 10.72 | 10.74 | 0.2% |
| 6 | Cable-stayed bridge, 140 m | 15/26 | 118.90 | 118.72 | 0.2% |
| 7 | Portal frame warehouse, 30 m | 5/4 | 136.30 | 131.22 | 3.7% |
| 8 | 5-story moment frame | 24/35 | 5.60 | 5.59 | 0.3% |
| 9 | 6-story 3D braced tower | 63/174 | 11.51 | 19.64 | 41% (see below) |
| 10 | Howe roof truss, 28 m | 16/29 | 13.86 | 13.22 | 4.6% |

All 10 satisfy ΣReactions = ΣApplied in the built-in engine, and all 10 exported
valid FreeCAD documents.

### The braced-tower discrepancy (investigated, expected behavior)

The 41% gap on typology 9 was investigated by isolation:

- **Load case sweep**: gravity-only and self-weight-only agree within 2%; the gap
  is entirely in the *wind (lateral)* response (8.06 vs 18.80 mm).
- **Scale sweep**: the ratio grows with height (1 story: 18%, 6 stories: 133%),
  pointing at overturning/chord stiffness, not story shear.
- **Minimal repro**: a single braced portal agrees to 0.5% (1.262 vs 1.256 mm),
  and matches a hand calculation (~1.2 mm) — so both element formulations are fine.
- **Uniform-section test**: giving every member the same cross-section collapses
  the gap to 6% (2.80 vs 2.63 mm).

Conclusion: CalculiX expands beam elements into solids and generates a "knot" at
any node shared by members of **different** cross-sections; knots are more flexible
than the ideal rigid joint assumed in beam theory. The built-in solver's answer
matches the classical hand calculation; ccx's answer includes joint flexibility.
Both are internally consistent — the server appends an explanatory note to CalculiX
results whenever the model mixes sections.

### Historical fixes these runs caught

1. **BOX beam sections require B32R elements** in CalculiX (B31 decks are rejected
   with `*ERROR reading *BEAM SECTION`). The mesh writer now always emits 3-node
   B32R elements with generated midside nodes.
2. **Phantom bending stress in truss members**: internal-force sampling initially
   attributed transverse self-weight of axial-only members (e.g. 80 m cable stays)
   to internal bending, producing utilizations of ~65. Truss members now report
   axial force only, which brought the cable-stayed bridge to a plausible 0.86.

## Scope

All checks are linear static. Buckling, dynamics, P-Δ, and cable tension-only
behavior are out of scope (see README Limitations). Results support preliminary
sizing and education, not final design verification.
