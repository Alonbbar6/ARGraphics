# Demo assets

3D models behind the demo bar's menu. On startup in development, or when `SEED_DEMO=true`,
the API copies each one into object storage for its demo drink if that drink has no model yet,
so `/s/demobar1`, `/s/demotbl1` and the 3D library show real items on a fresh database.

| files | demo drink | made from |
|---|---|---|
| `blood-orange-spritz.*` | Blood Orange Spritz (`demo-cocktail-1`) | a photo, through the app's photo-to-3D pipeline |
| `last-word.*` | Last Word (`demo-cocktail-3`) | same |
| `garden-gimlet.*` | Garden Gimlet (`demo-cocktail-4`) | same |

The Velvet Negroni has no bundled model on purpose: its only photo was a 335px screenshot and the
result was not good enough to show. It stays on the demo menu as a drink without 3D.

Each set is a `.glb` (web and Android AR), a `.usdz` (iPhone AR) and a `.png` thumbnail.
To refresh one, build it in the 3D library, then copy the three files from object storage
under `argraphics/drinks/<drink id>/` over the set here, keeping the names.
