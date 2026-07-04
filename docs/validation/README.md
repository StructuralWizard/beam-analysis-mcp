# Per-structure validation report

Ten bridge and building typologies analyzed with the **built-in 3D beam solver** and **CalculiX** (B32R beam elements, run through the ccx bundled with FreeCAD), with results compared against **analytical/hand-calculation** values for every structure.

All figures are generated programmatically from the same model data that is exported to FreeCAD (.FCStd) and CalculiX (.inp). CalculiX stress/strain fields are parsed from the genuine ccx `.frd` output (von Mises on the expanded solid mesh, mapped back to the member axes). FreeCAD cannot render viewport screenshots headlessly, so open the exported `.FCStd` files (run `npm run typologies`) for interactive 3D inspection.

| # | Structure | δ_max built-in | δ_max ccx | Δ | σ_max built-in | σ_vm ccx | Checks passed |
|---|---|---|---|---|---|---|---|
| 01 | [Simply supported girder bridge (35 m)](01-simply-supported-bridge.md) | 137.40 mm | 138.11 mm | 0.5% | 169.6 MPa | 169.7 MPa | 7/7 |
| 02 | [Continuous girder bridge (30 + 40 + 30 m)](02-continuous-girder-bridge.md) | 56.65 mm | 57.83 mm | 2.1% | 140.0 MPa | 136.7 MPa | 3/3 |
| 03 | [Pratt truss bridge (60 m, 8 panels)](03-pratt-truss-bridge.md) | 48.46 mm | 48.23 mm | 0.5% | 105.0 MPa | 97.8 MPa | 3/3 |
| 04 | [Warren truss bridge (64 m, 8 panels)](04-warren-truss-bridge.md) | 69.51 mm | 69.27 mm | 0.3% | 132.1 MPa | 123.5 MPa | 3/3 |
| 05 | [Deck arch bridge (90 m span, 18 m rise)](05-arch-bridge.md) | 10.72 mm | 10.74 mm | 0.2% | 50.4 MPa | 41.5 MPa | 3/3 |
| 06 | [Cable-stayed bridge (140 m deck, 40 m pylon)](06-cable-stayed-bridge.md) | 118.90 mm | 118.72 mm | 0.2% | 306.8 MPa | 305.2 MPa | 3/3 |
| 07 | [Portal frame warehouse (30 m span)](07-portal-frame-warehouse.md) | 136.30 mm | 131.22 mm | 3.7% | 280.9 MPa | 328.2 MPa | 4/4 |
| 08 | [5-story, 3-bay moment frame](08-moment-frame-5story.md) | 5.60 mm | 5.59 mm | 0.3% | 56.1 MPa | 66.3 MPa | 3/3 |
| 09 | [6-story 3D braced tower (2×2 bays)](09-braced-tower-3d.md) | 11.51 mm | 19.64 mm | 70.7% | 129.1 MPa | 144.8 MPa | 3/3 |
| 10 | [Howe roof truss (28 m span)](10-howe-roof-truss.md) | 13.86 mm | 13.22 mm | 4.6% | 44.7 MPa | 42.9 MPa | 3/3 |

Strain measures: built-in reports uniaxial fiber strain σ/E; CalculiX reports equivalent (von Mises) strain, so magnitudes differ by the strain-measure definition while stresses are directly comparable.
