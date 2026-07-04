# 02 · Continuous girder bridge (30 + 40 + 30 m)

**Preset**: `beam_bridge` with `{"spans":[30,40,30]}`
**Load combination**: 1.00 × self-weight + 1.00 × deck UDL (50 kN/m)
**Model**: 19 nodes, 18 members · **CalculiX mesh**: 145 nodes, 72 B32R elements

**Analytical basis**: Three-moment (Clapeyron) equation for the symmetric 3-span continuous beam: 180·M₁ = −w(L₁³+L₂³)/4 → M₁ = −126.39·w; R_end = wL₁/2 + M₁/L₁.

## Geometry, supports & loads

![geometry](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-geometry.svg)

## CalculiX mesh

![mesh](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-mesh.svg)


## Deflections (built-in vs CalculiX)

![deformed](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-deformed.svg)

## Internal forces (built-in solver)

![moment](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-moment.svg)
![shear](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-shear.svg)
![axial](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-axial.svg)

## Stresses and strains

![stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-stress.svg)
![strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-strain.svg)

### CalculiX field output (.frd, expanded solid mesh)

![ccx stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-ccx-stress.svg)
![ccx strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/02-ccx-strain.svg)

## Key results

| Quantity | Built-in beam | CalculiX | Difference |
|---|---|---|---|
| Max deflection | 56.65 mm | 57.83 mm | 2.1% |
| ΣR vertical | 6034.6 kN | 6034.6 kN | 0.0% |
| Max normal stress / von Mises | 140.0 MPa | 136.7 MPa | 2.4% |
| Max strain (ε = σ/E / equiv.) | 6.67e-4 | 5.64e-4 | — (different strain measures) |
| Equilibrium ΣR = ΣF | satisfied (exact) | reactions parsed from .dat | |

*CalculiX reactions are RF at constrained DOFs corrected for loads applied at support nodes. Residual differences of a few % can remain where supports form expansion "knots" or members carry axial self-weight — a ccx printout artifact, not an equilibrium error.*

## Analytical checks

| Check | Formula | Analytical | Computed | Deviation | Tolerance | Pass |
|---|---|---|---|---|---|---|
| Support hogging moment | `M₁ = −126.39·w (three-moment eq.)` | 7627.1 | 7627.1 kN·m | 0.0% | ≤ 2% | ✅ |
| End reaction | `R = wL₁/2 + M₁/L₁` | 651.0 | 651.0 kN | 0.0% | ≤ 2% | ✅ |
| Mid-span-2 moment | `M = wL₂²/8 + M₁` | 4442.2 | 4442.2 kN·m | 0.0% | ≤ 6% | ✅ |

*(built-in solver values unless marked; CalculiX values from parsed `.dat`/`.frd` output; 137 ms total)*
