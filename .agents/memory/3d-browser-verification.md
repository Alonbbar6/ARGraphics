---
name: 3D browser verification
description: Distinguish model generation and download success from actual WebGL rendering in browser tests.
---

Do not treat a successful model download or the viewer's loaded flag as proof that a model was visually rendered.

**Why:** The testing browser reported WebGL renderer/vendor access disabled even while the viewer reported a loaded model and the saved GLB downloaded successfully. Publishing and reload persistence could be verified, but rotation and zoom could not.

**How to apply:** Report rendering as unverified when the browser cannot create a WebGL context. Use a WebGL-capable browser to verify visual interaction; do not spend additional OpenAI or Meshy credits regenerating an already valid saved model to resolve a browser graphics restriction.
