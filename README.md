# beam-analysis-mcp

A **lightweight MCP (Model Context Protocol) server** for linear-static structural analysis of **bridges and building frames**, written in Node.js with no heavy dependencies.

It gives an AI client (Claude Desktop, Claude Code, Cursor, ...) tools to:

- **Build 3D beam/truss models** (nodes, members, sections, materials, supports, loads) or generate complete structures from **parametric typology presets** (girder bridges, Pratt/Howe/Warren truss bridges, arch bridges, cable-stayed bridges, portal frames, moment frames, 3D braced buildings, roof trusses).
- **Analyze** them with two engines:
  - **`beam`** — built-in 3D direct-stiffness frame solver (pure JavaScript, instant). Euler-Bernoulli elements with consistent fixed-end forces and exact in-span deflection/moment recovery — one element per member is enough.
  - **`calculix`** — writes a CalculiX input deck (B32R beam elements), runs `ccx`, and parses displacements/reactions. Use `engine: "both"` to cross-check the two solvers.
- **Export to FreeCAD** — builds a solid 3D model of the structure and saves a `.FCStd` document you can open and inspect in FreeCAD.
- Get **member force envelopes** (N, V, M, T), **stresses**, and **utilization** (σ/fy), **reactions**, and **displacements**.

> **No CalculiX install needed if you have FreeCAD**: FreeCAD bundles `ccx` with its FEM workbench, and this server auto-detects it (e.g. `C:\Program Files\FreeCAD 1.1\bin\ccx.exe`).

## Requirements

- Node.js ≥ 18
- Optional: [FreeCAD](https://www.freecad.org/) (provides both `freecadcmd` for export **and** the bundled CalculiX solver)
- Optional: standalone [CalculiX](http://www.calculix.de/) (`ccx`) if you don't use FreeCAD

## Install & run

```bash
git clone https://github.com/StructuralWizard/beam-analysis-mcp.git
cd beam-analysis-mcp
npm install
npm test          # closed-form validation + MCP e2e + CalculiX cross-check
npm run typologies  # analyze 10 bridge/building typologies with both engines
```

### Claude Desktop / Claude Code configuration

Add to `claude_desktop_config.json` (or `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "beam-analysis": {
      "command": "node",
      "args": ["C:/path/to/beam-analysis-mcp/src/server.js"]
    }
  }
}
```

Optional environment variables:

| Variable | Purpose |
|---|---|
| `CCX_PATH` | Explicit path to the CalculiX `ccx` executable |
| `FREECAD_CMD` | Explicit path to `freecadcmd` |
| `BEAM_MCP_OUTPUT` | Default directory for exported `.FCStd` / `.inp` files (default `~/beam-mcp-output`) |

## Tools

| Tool | Purpose |
|---|---|
| `check_environment` | Report Node/ccx/freecadcmd availability and unit conventions |
| `create_model` | Create an empty model |
| `list_structure_presets` | List parametric typology generators and their defaults |
| `generate_structure` | Build a complete bridge/building from a preset + parameter overrides |
| `add_nodes` / `add_material` / `add_section` / `add_members` / `add_supports` / `add_loads` | Manual model building |
| `analyze` | Run linear-static analysis (`beam`, `calculix`, or `both` with comparison) |
| `get_results` | Detailed displacements, reactions, or member force envelopes |
| `export_freecad` | Save a solid 3D `.FCStd` model (opens in FreeCAD) |
| `export_calculix_inp` | Write the CalculiX `.inp` deck without solving |
| `model_info` / `list_models` / `delete_model` | Session management |

## Structure presets

| Preset | Typology |
|---|---|
| `beam_bridge` | Simply supported or continuous girder bridge (1..n spans) |
| `truss_bridge` | 3D through-truss bridge — `pratt`, `howe`, or `warren` |
| `arch_bridge` | Deck arch bridge: parabolic rib + spandrel columns + deck girder |
| `cable_stayed_bridge` | Single-pylon fan-pattern cable-stayed bridge |
| `portal_frame` | Gable portal frame (warehouse/industrial shed) |
| `moment_frame_building` | Multi-story multi-bay moment-resisting frame |
| `braced_frame_building` | Full 3D building with columns, two-way beams, perimeter X-bracing |
| `roof_truss` | Triangular (Howe-style) roof truss |

Example conversation with an MCP client:

> "Generate a 3-span continuous girder bridge (30 m + 40 m + 30 m), analyze it with both engines, and export it to FreeCAD."

which maps to `generate_structure {preset: "beam_bridge", params: {spans: [30,40,30]}}` → `analyze {engine: "both"}` → `export_freecad`.

## Conventions

- **Units**: SI — meters, Newtons, Pascals, kg/m³. Downward loads are **negative** `fz`/`wz`.
- **Axes**: global +Z is up. Member local x runs along the member; for non-vertical members local z lies in the vertical plane, so section depth `h` resists gravity bending (strong axis = `Iy`).
- **Supports**: `fixed`, `pinned`, `roller` (uz), `roller-yz` (bridge sliding bearing), `planar-xz` (out-of-plane restraint for 2D models), or a custom 6-flag string like `"111100"` (ux,uy,uz,rx,ry,rz).
- **Member types**: `beam` (6-DOF frame element) or `truss` (axial only — braces, cables, truss webs).

## Validation

`npm test` checks the solver against closed-form solutions:

- Simply supported beam under UDL: `5wL⁴/384EI` deflection and `wL²/8` moment (exact to 1e-6)
- Cantilever tip load / UDL: `PL³/3EI`, `wL⁴/8EI`, fixed-end moments
- Two-bar truss axial force `P/(2 sin θ)`
- Equilibrium (ΣR = ΣF) on every generator preset
- Cross-validation against CalculiX (skipped automatically if `ccx` is not installed)

`npm run typologies` builds and analyzes 10 typologies end-to-end and prints a built-in vs CalculiX comparison table. Results on the reference machine (FreeCAD 1.1 bundled CalculiX 2.22, Windows 11):

| # | Typology | Nodes/Members | Max defl. beam [mm] | Max defl. ccx [mm] | Diff | Equilibrium |
|---|---|---|---|---|---|---|
| 1 | Simply supported girder bridge (35 m) | 7/6 | 137.40 | 138.11 | 0.5% | ok |
| 2 | Continuous girder bridge (30+40+30 m) | 19/18 | 56.65 | 57.83 | 2.0% | ok |
| 3 | Pratt truss bridge (60 m) | 32/74 | 48.46 | 48.23 | 0.5% | ok |
| 4 | Warren truss bridge (64 m) | 34/79 | 69.51 | 69.27 | 0.3% | ok |
| 5 | Deck arch bridge (90 m) | 34/47 | 10.72 | 10.74 | 0.2% | ok |
| 6 | Cable-stayed bridge (140 m) | 15/26 | 118.90 | 118.72 | 0.2% | ok |
| 7 | Portal frame warehouse (30 m) | 5/4 | 136.30 | 131.22 | 3.7% | ok |
| 8 | 5-story moment frame | 24/35 | 5.60 | 5.59 | 0.3% | ok |
| 9 | 6-story 3D braced tower | 63/174 | 11.51 | 19.64 | 41%* | ok |
| 10 | Howe roof truss (28 m) | 16/29 | 13.86 | 13.22 | 4.6% | ok |

\* Expected: the tower mixes several cross-sections, and CalculiX models joints between members of different sections as flexible "knots" (see Limitations). Re-run with uniform sections and the two engines agree within 6%.

## Limitations

- Linear static only: no buckling, no dynamics, no P-Δ, no nonlinear cable sag (stays are modeled as linear truss members that can also take compression).
- The two engines answer slightly different questions: the built-in solver assumes ideal rigid joints (classic beam theory), while CalculiX expands beams into solid elements and models joints between members of *different* sections as "knots", which are more flexible. Agreement is sub-1% on determinate structures and within a few % on frames with uniform sections, but expect larger differences (which ccx reports as a note) on tall 3D frames mixing many sections.
- CalculiX backend reports displacements and reactions; member force envelopes come from the built-in engine.
- I-sections and generic sections are mapped to an equivalent rectangle in the CalculiX deck (ccx beam sections support RECT/CIRC/PIPE/BOX only).
- Results are for **preliminary/educational analysis** — not a substitute for design verification by a qualified engineer.

## License

MIT
