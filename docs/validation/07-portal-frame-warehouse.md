# 07 · Portal frame warehouse (30 m span)

**Preset**: `portal_frame` with `{"span":30,"eaveHeight":7,"ridgeHeight":10}`
**Load combination**: 1.00 × self-weight + 1.00 × roof UDL (10 kN/m) + 1.00 × lateral wind (25 kN at eave)
**Model**: 5 nodes, 4 members · **CalculiX mesh**: 33 nodes, 16 B32R elements

**Analytical basis**: Statics of the pinned-base column: with no load along the column, the eave moment equals the base horizontal reaction times the eave height, M_eave = H·h — an exact check.

## Geometry, supports & loads

![geometry](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-geometry.svg)

## CalculiX mesh

![mesh](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-mesh.svg)

## Load cases

The combination above superposes the individual load cases (linear analysis). Deformed shapes:

![LC1 gravity](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-lc1.svg)
![LC2 lateral wind](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-lc2.svg)

| Load case | max deflection |
|---|---|
| LC1 gravity | 137.28 mm |
| LC2 lateral wind | 28.24 mm |
| **Combination (all loads)** | **136.30 mm** |

**Superposition check** at node (0, 0, 7): combination ux = -0.72 mm vs LC1+LC2 = -0.72 mm; uz = -0.30 mm vs -0.30 mm — linear superposition holds.

## Deflections (built-in vs CalculiX)

![deformed](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-deformed.svg)

## Internal forces (built-in solver)

![moment](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-moment.svg)
![shear](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-shear.svg)
![axial](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-axial.svg)

## Stresses and strains

![stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-stress.svg)
![strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-strain.svg)

### CalculiX field output (.frd, expanded solid mesh)

![ccx stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-ccx-stress.svg)
![ccx strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/07-ccx-strain.svg)

## Key results

| Quantity | Built-in beam | CalculiX | Difference |
|---|---|---|---|
| Max deflection | 136.30 mm | 131.22 mm | 3.7% |
| ΣR vertical | 360.6 kN | 360.6 kN | 0.0% |
| Max normal stress / von Mises | 280.9 MPa | 328.2 MPa | 16.9% |
| Max strain (ε = σ/E / equiv.) | 1.34e-3 | 1.35e-3 | — (different strain measures) |
| Equilibrium ΣR = ΣF | satisfied (exact) | reactions parsed from .dat | |

*CalculiX reactions are RF at constrained DOFs corrected for loads applied at support nodes. Residual differences of a few % can remain where supports form expansion "knots" or members carry axial self-weight — a ccx printout artifact, not an equilibrium error.*

## Analytical checks

| Check | Formula | Analytical | Computed | Deviation | Tolerance | Pass |
|---|---|---|---|---|---|---|
| Horizontal equilibrium | `ΣH = F_wind` | 25.0 | 25.0 kN | 0.0% | ≤ 0.1% | ✅ |
| Left eave moment | `M = |H_left|·h (exact statics)` | 576.4 | 576.4 kN·m | 0.0% | ≤ 0.5% | ✅ |
| Right eave moment | `M = |H_right|·h (exact statics)` | 751.4 | 751.4 kN·m | 0.0% | ≤ 0.5% | ✅ |
| Vertical equilibrium | `ΣV = W` | 360.6 | 360.6 kN | 0.0% | ≤ 0.1% | ✅ |

*(built-in solver values unless marked; CalculiX values from parsed `.dat`/`.frd` output; 87 ms total)*
