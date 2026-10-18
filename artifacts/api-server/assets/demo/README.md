# Demo assets

`blood-orange-spritz.{glb,usdz,png}` is the 3D model behind the demo bar's "Blood Orange
Spritz" (a Meshy export of a photo). On startup in development, or when `SEED_DEMO=true`,
the API copies it into object storage for the demo drink if that drink has no model yet, so
`/s/demobar1` and `/s/demotbl1` show something in AR on a fresh database.
