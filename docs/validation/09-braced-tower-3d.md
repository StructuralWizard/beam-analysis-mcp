# 09 · 6-story 3D braced tower (2×2 bays)

**Preset**: `braced_frame_building` with `{"stories":6,"baysX":2,"baysY":2}`
**Load combination**: 1.00 × self-weight + 1.00 × floor UDL (25 kN/m) + 1.00 × wind X (40 kN/floor)
**Model**: 63 nodes, 174 members · **CalculiX mesh**: 993 nodes, 552 B32R elements

**Analytical basis**: Base shear equilibrium; ground-story brace force from the shear path: each braced face takes V/2, split between the tension and compression diagonals, N ≈ (V/4)·(L_brace/dx). The nine continuous columns form a moment frame in parallel with the bracing and carry ~15–20 % of the story shear, so the braces are expected to see correspondingly less than the hand formula (tolerance ±25 %).

## Geometry, supports & loads

![geometry](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-geometry.svg)

## CalculiX mesh

![mesh](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-mesh.svg)

## Load cases

The combination above superposes the individual load cases (linear analysis). Deformed shapes:

![LC1 gravity](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-lc1.svg)
![LC2 wind X](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-lc2.svg)

| Load case | max deflection |
|---|---|
| LC1 gravity | 6.81 mm |
| LC2 wind X | 8.06 mm |
| **Combination (all loads)** | **11.51 mm** |

**Superposition check** at node (0, 0, 21): combination ux = 5.81 mm vs LC1+LC2 = 5.81 mm; uz = -2.70 mm vs -2.70 mm — linear superposition holds.

## Deflections (built-in vs CalculiX)

![deformed](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-deformed.svg)

## Internal forces (built-in solver)

![moment](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-moment.svg)
![shear](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-shear.svg)
![axial](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-axial.svg)

## Stresses and strains

![stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-stress.svg)
![strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-strain.svg)

### CalculiX field output (.frd, expanded solid mesh)

![ccx stress](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-ccx-stress.svg)
![ccx strain](https://raw.githubusercontent.com/StructuralWizard/beam-analysis-mcp/main/docs/validation/img/09-ccx-strain.svg)

## Key results

| Quantity | Built-in beam | CalculiX | Difference |
|---|---|---|---|
| Max deflection | 11.51 mm | 19.64 mm | 70.7% |
| ΣR vertical | 11560.9 kN | 11560.9 kN | 0.0% |
| Max normal stress / von Mises | 129.1 MPa | 144.8 MPa | 12.1% |
| Max strain (ε = σ/E / equiv.) | 6.15e-4 | 5.97e-4 | — (different strain measures) |
| Equilibrium ΣR = ΣF | satisfied (exact) | reactions parsed from .dat | |

*CalculiX reactions are RF at constrained DOFs corrected for loads applied at support nodes. Residual differences of a few % can remain where supports form expansion "knots" or members carry axial self-weight — a ccx printout artifact, not an equilibrium error.*

## Analytical checks

| Check | Formula | Analytical | Computed | Deviation | Tolerance | Pass |
|---|---|---|---|---|---|---|
| Base shear | `ΣH = 6 × 40 kN` | 240.0 | 240.0 kN | 0.0% | ≤ 0.1% | ✅ |
| Vertical equilibrium | `ΣV = W` | 11560.9 | 11560.9 kN | 0.0% | ≤ 0.1% | ✅ |
| Ground-story brace force (wind part) | `N = (N_A − N_B)/2 ≈ (V/4)·L_b/dx` | 69.5 | 56.4 kN | 18.9% | ≤ 25% | ✅ |

*(built-in solver values unless marked; CalculiX values from parsed `.dat`/`.frd` output; 999 ms total)*
