# Image sequences

Pre-rendered frames that the landing page scrubs on a canvas as you scroll (the
technique behind sites like CoMinVi and Apple's product pages). They are baked, not
hand-made, so they can always be regenerated.

## Layout

```
public/sequences/<name>/
  manifest.json       name, poster, intro, sets.desktop / sets.mobile, source notes
  poster.webp         shown before frames decode and under prefers-reduced-motion
  desktop/0000.webp…  landscape set (hero: 1920×1080, 120 frames)
  mobile/0000.webp…   portrait set  (hero: 1080×1350, 80 frames), optional
```

The page loads `manifest.json`, picks a set by viewport, fetches frames 0–9 first and
the rest in batches of 30, and only keeps a window of decoded frames in memory on phones.
See `src/lib/frame-sequence.ts`, `src/lib/frame-loader.ts` and
`src/pages/landing/components/ScrollCanvas.tsx`.

## Sequences the landing page expects

| name    | used by                     | story      | notes                                   |
|---------|-----------------------------|------------|-----------------------------------------|
| `hero`  | Chapter 1 (full-bleed hero) | `assemble` | transparent, composited over public/hero/plate.jpg, desktop + mobile |
| `phone` | Chapter 3 (inside the phone)| `rise`     | transparent background, desktop set only|

Without them the page still works: the hero shows a lit table and the phone shows a
placeholder glow. In dev a note under the hero links to the baker.

## How to bake (Chrome)

1. Run the app (`./dev-local.sh`) and open `/dev/bake` (dev builds only).
2. Pick a `.glb` (a Meshy drink or dish export). Local ones live under
   `~/.local/argraphics-storage/.../public/qrholigrams/drinks/<drink>/<id>.glb`.
3. Choose the `hero` preset with background **Transparent**, scrub the preview, adjust
   exposure or model height, then **Bake frames** and pick the folder
   `artifacts/argraphics/public/sequences/hero`. (Pick "Dark table" instead if you
   remove the photo plate; the hero then shows the drink on a lit table.)
4. Repeat with the `phone` preset into `public/sequences/phone` (background: transparent).
5. Reload `/`. Optionally add
   `<link rel="preload" as="image" href="%BASE_URL%sequences/hero/poster.webp">`
   to `index.html` so the poster is the LCP image.

Browsers without the File System Access API download a zip to unpack into
`public/sequences/`. Each `manifest.json` records the source model and settings.

Budget: keep the hero under ~7 MB desktop and ~4 MB mobile (quality 0.8–0.85).
