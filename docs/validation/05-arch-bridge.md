# 05 · Deck arch bridge (90 m span, 18 m rise)

**Preset**: `arch_bridge` with `{"span":90,"rise":18}`
**Load combination**: 1.00 × self-weight + 1.00 × deck UDL (60 kN/m)
**Model**: 34 nodes, 47 members · **CalculiX mesh**: 363 nodes, 188 B32R elements

**Analytical basis**: Funicular parabolic arch under uniform load: horizontal thrust H = WL/8f; crown axial force ≈ H. Deviations come from deck girder stiffness sharing and fixed springings.

## Geometry, supports & loads

![geometry](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-geometry.svg)

## CalculiX mesh

![mesh](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-mesh.svg)


## Deflections (built-in vs CalculiX)

![deformed](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-deformed.svg)

## Internal forces (built-in solver)

![moment](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-moment.svg)
![shear](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-shear.svg)
![axial](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-axial.svg)

## Stresses and strains

![stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-stress.svg)
![strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-strain.svg)

### CalculiX field output (.frd, expanded solid mesh)

![ccx stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-ccx-stress.svg)
![ccx strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/05-ccx-strain.svg)

## Key results

| Quantity | Built-in beam | CalculiX | Difference |
|---|---|---|---|
| Max deflection | 10.72 mm | 10.74 mm | 0.2% |
| ΣR vertical | 9033.5 kN | 9033.3 kN | 0.0% |
| Max normal stress / von Mises | 50.4 MPa | 41.5 MPa | 17.6% |
| Max strain (ε = σ/E / equiv.) | 2.40e-4 | 1.71e-4 | — (different strain measures) |
| Equilibrium ΣR = ΣF | satisfied (exact) | reactions parsed from .dat | |

*CalculiX reactions are RF at constrained DOFs corrected for loads applied at support nodes. Residual differences of a few % can remain where supports form expansion "knots" or members carry axial self-weight — a ccx printout artifact, not an equilibrium error.*

## Analytical checks

| Check | Formula | Analytical | Computed | Deviation | Tolerance | Pass |
|---|---|---|---|---|---|---|
| Horizontal thrust at springing | `H = WL/8f` | 5645.9 | 5416.1 kN | 4.1% | ≤ 12% | ✅ |
| Crown axial force | `N ≈ −H (compression)` | -5645.9 | -5160.1 kN | 8.6% | ≤ 12% | ✅ |
| Springing vertical reaction | `V = W/2 (per springing pair)` | 4516.7 | 4516.7 kN | 0.0% | ≤ 15% | ✅ |

*(built-in solver values unless marked; CalculiX values from parsed `.dat`/`.frd` output; 279 ms total)*
