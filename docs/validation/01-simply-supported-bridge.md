# 01 · Simply supported girder bridge (35 m)

**Preset**: `beam_bridge` with `{"spans":[35]}`
**Load combination**: 1.00 × self-weight + 1.00 × deck UDL (50 kN/m)
**Model**: 7 nodes, 6 members · **CalculiX mesh**: 49 nodes, 24 B32R elements

**Analytical basis**: Textbook single-span beam under uniform load — exact closed-form solutions.

## Geometry, supports & loads

![geometry](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-geometry.svg)

## CalculiX mesh

![mesh](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-mesh.svg)


## Deflections (built-in vs CalculiX)

![deformed](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-deformed.svg)

## Internal forces (built-in solver)

![moment](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-moment.svg)
![shear](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-shear.svg)
![axial](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-axial.svg)

## Stresses and strains

![stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-stress.svg)
![strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-strain.svg)

### CalculiX field output (.frd, expanded solid mesh)

![ccx stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-ccx-stress.svg)
![ccx strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/01-ccx-strain.svg)

## Key results

| Quantity | Built-in beam | CalculiX | Difference |
|---|---|---|---|
| Max deflection | 137.40 mm | 138.11 mm | 0.5% |
| ΣR vertical | 2112.1 kN | 2112.1 kN | 0.0% |
| Max normal stress / von Mises | 169.6 MPa | 169.7 MPa | 0.0% |
| Max strain (ε = σ/E / equiv.) | 8.08e-4 | 7.00e-4 | — (different strain measures) |
| Equilibrium ΣR = ΣF | satisfied (exact) | reactions parsed from .dat | |

*CalculiX reactions are RF at constrained DOFs corrected for loads applied at support nodes. Residual differences of a few % can remain where supports form expansion "knots" or members carry axial self-weight — a ccx printout artifact, not an equilibrium error.*

## Analytical checks

| Check | Formula | Analytical | Computed | Deviation | Tolerance | Pass |
|---|---|---|---|---|---|---|
| End reaction R | `R = wL/2` | 1056.1 | 1056.1 kN | 0.0% | ≤ 1% | ✅ |
| Max bending moment | `M = wL²/8` | 9240.5 | 9240.5 kN·m | 0.0% | ≤ 1% | ✅ |
| Max deflection (built-in) | `δ = 5wL⁴/384EI` | 137.40 | 137.40 mm | 0.0% | ≤ 1% | ✅ |
| Max deflection (CalculiX) | `δ = 5wL⁴/384EI` | 137.40 | 138.11 mm | 0.5% | ≤ 3% | ✅ |
| Max bending stress (built-in) | `σ = M/W` | 169.6 | 169.6 MPa | 0.0% | ≤ 2% | ✅ |
| Max von Mises (CalculiX .frd) | `σ = M/W` | 169.6 | 169.7 MPa | 0.0% | ≤ 6% | ✅ |
| Max strain (CalculiX .frd, equiv.) | `ε ≈ σ/E` | 8.08e-4 | 7.00e-4 ε | 13.3% | ≤ 25% | ✅ |

*(built-in solver values unless marked; CalculiX values from parsed `.dat`/`.frd` output; 88 ms total)*
