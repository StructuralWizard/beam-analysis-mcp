# 10 · Howe roof truss (28 m span)

**Preset**: `roof_truss` with `{"span":28,"height":4,"panels":8}`
**Load combination**: 1.00 × self-weight + 1.00 × snow point loads (12 kN per top node)
**Model**: 16 nodes, 29 members · **CalculiX mesh**: 141 nodes, 77 B32R elements

**Analytical basis**: Method of joints at the support: heel top-chord N = R/sinθ (compression), first bottom-chord N = R/tanθ (tension), with θ the first roof-segment slope. Beam-type continuous chords carry some bending, so ±10 % is expected.

## Geometry, supports & loads

![geometry](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-geometry.svg)

## CalculiX mesh

![mesh](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-mesh.svg)


## Deflections (built-in vs CalculiX)

![deformed](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-deformed.svg)

## Internal forces (built-in solver)

![moment](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-moment.svg)
![shear](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-shear.svg)
![axial](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-axial.svg)

## Stresses and strains

![stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-stress.svg)
![strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-strain.svg)

### CalculiX field output (.frd, expanded solid mesh)

![ccx stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-ccx-stress.svg)
![ccx strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/10-ccx-strain.svg)

## Key results

| Quantity | Built-in beam | CalculiX | Difference |
|---|---|---|---|
| Max deflection | 13.86 mm | 13.22 mm | 4.6% |
| ΣR vertical | 130.9 kN | 118.1 kN | 9.8% |
| Max normal stress / von Mises | 44.7 MPa | 42.9 MPa | 4.0% |
| Max strain (ε = σ/E / equiv.) | 2.13e-4 | 1.77e-4 | — (different strain measures) |
| Equilibrium ΣR = ΣF | satisfied (exact) | reactions parsed from .dat | |

*CalculiX reactions are RF at constrained DOFs corrected for loads applied at support nodes. Residual differences of a few % can remain where supports form expansion "knots" or members carry axial self-weight — a ccx printout artifact, not an equilibrium error.*

## Analytical checks

| Check | Formula | Analytical | Computed | Deviation | Tolerance | Pass |
|---|---|---|---|---|---|---|
| Support reaction | `R = ΣP/2 + W_self/2` | 65.4 | 65.4 kN | 0.0% | ≤ 1% | ✅ |
| Heel top-chord force | `N = −R/sinθ` | -238.2 | -222.6 kN | 6.6% | ≤ 10% | ✅ |
| First bottom-chord force | `N = R/tanθ` | 229.1 | 213.5 kN | 6.8% | ≤ 10% | ✅ |

*(built-in solver values unless marked; CalculiX values from parsed `.dat`/`.frd` output; 146 ms total)*
