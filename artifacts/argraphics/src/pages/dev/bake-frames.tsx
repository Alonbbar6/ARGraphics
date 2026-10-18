import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FrameManifest, FrameSet } from '@/lib/frame-sequence';
import { ZipWriter } from './zip';

/*
  Dev-only frame baker. Loads a GLB (your Meshy drink or dish), lights it like a bar,
  and renders N frames of a scroll story to WebP, plus a poster and a manifest, straight
  into public/sequences/<name>/ via the File System Access API (Chrome). Other browsers
  get a zip. This route only exists when `import.meta.env.DEV` is true.

  The story mapped onto progress p in [0, 1] ("the special builds itself"):
    0.00–0.45  a clipping plane sweeps from the model's base to its top while it turns 0→90°
    0.45–0.80  turntable 90→330°, the key light orbits so highlights sweep the glass
    0.80–1.00  settle to the hero angle (one full 360° turn in total), camera drops, slight push-in
*/

type SetKey = 'desktop' | 'mobile';
type Story = 'assemble' | 'turntable' | 'rise';

type SetConfig = { enabled: boolean; width: number; height: number; count: number };

const PRESETS: Record<string, { label: string; desktop: SetConfig; mobile: SetConfig; intro: number }> = {
  hero: {
    label: 'hero (full-bleed, 1920×1080 + 1080×1350)',
    desktop: { enabled: true, width: 1920, height: 1080, count: 120 },
    mobile: { enabled: true, width: 1080, height: 1350, count: 80 },
    intro: 26,
  },
  phone: {
    label: 'phone (inside the mockup, 720×960)',
    desktop: { enabled: true, width: 720, height: 960, count: 60 },
    mobile: { enabled: false, width: 540, height: 720, count: 60 },
    intro: 0,
  },
};

const DEG = Math.PI / 180;
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const span = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ------------------------------------------------------------------ scene */

type Rig = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  key: THREE.SpotLight;
  rim: THREE.DirectionalLight;
  clip: THREE.Plane;
  model: THREE.Group | null;
  modelHeight: number;
  modelRadius: number;
  table: THREE.Mesh;
  contact: THREE.Mesh;
  pmrem: THREE.PMREMGenerator;
};

function makeContactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTableTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(512, 512, 0, 512, 512, 512);
  g.addColorStop(0, '#4a3d31');
  g.addColorStop(0.12, '#3a3027');
  g.addColorStop(0.3, '#17130f');
  g.addColorStop(0.5, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildRig(canvas: HTMLCanvasElement): Rig {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 50);

  // Warm key from the upper left, cool rim from behind. A bar at nine o'clock.
  const key = new THREE.SpotLight(0xffd0a0, 70, 20, 0.42, 0.75, 1.5);
  key.position.set(2.4, 3.6, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(0xbfd4ff, 2.2);
  rim.position.set(-2.5, 2.2, -2.8);
  scene.add(rim);

  const fill = new THREE.HemisphereLight(0x2a2622, 0x050505, 0.2);
  scene.add(fill);

  // The table: a warm dark surface under the light that fades to black long before its
  // edge, so the frame never shows a "plate". A radial gradient texture carries the fade.
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 28),
    // Lambert on purpose: no specular term, so grazing-angle reflections of the room
    // cannot wash out the fade to black.
    new THREE.MeshLambertMaterial({ map: makeTableTexture() }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: makeContactShadowTexture(), transparent: true, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.002;
  scene.add(contact);

  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

  return { renderer, scene, camera, key, rim, clip, model: null, modelHeight: 1, modelRadius: 0.5, table, contact, pmrem };
}

function disposeModel(rig: Rig) {
  if (!rig.model) return;
  rig.scene.remove(rig.model);
  rig.model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) m.dispose();
  });
  rig.model = null;
}

async function loadModel(rig: Rig, file: File, targetHeight: number) {
  disposeModel(rig);
  const buffer = await file.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const root = gltf.scene;

  // Centre on the origin, feet on the table, scaled to a consistent height.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 1e-6);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const center = box2.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box2.min.y;
  // Remember the recentred resting position; pose() animates relative to it.
  root.userData.baseY = root.position.y;
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  const finalSize = box3.getSize(new THREE.Vector3());

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      mat.clippingPlanes = [rig.clip];
      mat.clipShadows = true;
      mat.side = THREE.DoubleSide; // the clip cut shows the inside; double-sided keeps it solid
      mat.needsUpdate = true;
    }
  });

  rig.model = root;
  rig.modelHeight = finalSize.y;
  rig.modelRadius = Math.max(finalSize.x, finalSize.z) / 2;
  rig.contact.scale.setScalar(rig.modelRadius * 3.2);
  rig.scene.add(root);
}

type Framing = { aspect: number; fov: number; distance: number; lookY: number; shiftX: number };

function framingFor(rig: Rig, width: number, height: number, story: Story): Framing {
  const aspect = width / height;
  const portrait = aspect < 1;
  const fov = portrait ? 34 : 30;
  // Fit the model's bounding sphere with headroom; tighter for the phone set.
  const sphere = Math.hypot(rig.modelHeight / 2, rig.modelRadius) * (story === 'turntable' ? 1.05 : portrait ? 1.25 : 1.3);
  const vFov = fov * DEG;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distance = Math.max(sphere / Math.sin(vFov / 2), sphere / Math.sin(hFov / 2));
  const halfW = distance * Math.tan(hFov / 2);
  // Landscape hero: the copy lives on the left, so the special sits right of centre.
  // Portrait: the copy is on top, so aim above the model and it sits in the lower half.
  const hero = story !== 'turntable';
  return {
    aspect,
    fov,
    distance,
    // Aim a little below the model's middle so it sits in the upper part of the frame.
    lookY: rig.modelHeight * (portrait ? (hero ? 0.62 : 0.46) : 0.36),
    shiftX: portrait || !hero ? 0 : -0.28 * halfW,
  };
}

/** Puts the camera, light and clip plane where the story says they are at progress p. */
function pose(rig: Rig, p: number, story: Story, framing: Framing) {
  const h = rig.modelHeight;
  let theta: number;
  let elev: number;
  let dist = framing.distance;
  let clipY = h + 1;
  let keyAz = 40;

  if (story === 'assemble') {
    const build = smooth(span(p, 0, 0.45));
    const turn = smooth(span(p, 0.45, 0.8));
    const settle = smooth(span(p, 0.8, 1));
    clipY = lerp(-0.02, h + 0.05, build);
    theta = lerp(0, 90, build) + lerp(0, 240, turn) + lerp(0, 30, settle);
    elev = lerp(18, 14, build) + lerp(0, -6, settle);
    dist = framing.distance * lerp(1, 0.97, settle);
    keyAz = 40 + lerp(0, 140, turn) + lerp(0, -40, settle);
  } else if (story === 'rise') {
    const up = smooth(span(p, 0, 0.5));
    const turn = smooth(span(p, 0.2, 1));
    clipY = h + 1;
    theta = lerp(0, 360, turn);
    elev = lerp(24, 10, up);
    dist = framing.distance * lerp(1.08, 0.96, up);
    keyAz = 40 + 120 * turn;
  } else {
    theta = p * 360;
    elev = 12;
  }

  rig.clip.constant = clipY;
  const built = story === 'assemble' ? smooth(span(p, 0.02, 0.4)) : story === 'rise' ? smooth(span(p, 0.1, 0.5)) : 1;
  (rig.contact.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.75 * built;
  rig.contact.scale.setScalar(rig.modelRadius * (2.2 + 1.2 * built));
  // Rise-only story floats the model up out of the table. Everything is relative to the
  // recentred resting position, which puts the model's base on the table.
  if (rig.model) {
    const baseY = (rig.model.userData.baseY as number | undefined) ?? 0;
    rig.model.position.y = baseY + (story === 'rise' ? lerp(-h * 0.9, 0, smooth(span(p, 0, 0.5))) : 0);
  }

  const t = theta * DEG;
  const e = elev * DEG;
  rig.camera.fov = framing.fov;
  rig.camera.aspect = framing.aspect;
  const target = new THREE.Vector3(0, framing.lookY, 0);
  rig.camera.position.set(Math.sin(t) * Math.cos(e) * dist, Math.sin(e) * dist + framing.lookY, Math.cos(t) * Math.cos(e) * dist);
  rig.camera.lookAt(target);
  if (framing.shiftX !== 0) {
    // Slide camera and target sideways together so the model moves in frame without skew.
    const right = new THREE.Vector3().crossVectors(rig.camera.getWorldDirection(new THREE.Vector3()), rig.camera.up).normalize();
    rig.camera.position.addScaledVector(right, framing.shiftX);
    target.addScaledVector(right, framing.shiftX);
    rig.camera.lookAt(target);
  }
  rig.camera.updateProjectionMatrix();

  const ka = keyAz * DEG;
  rig.key.position.set(Math.sin(ka) * 3, 3.4, Math.cos(ka) * 3);
  rig.key.target.position.set(0, h * 0.4, 0);
  rig.key.target.updateMatrixWorld();
}

/* ------------------------------------------------------------------- page */

type Status = { phase: 'idle' | 'loading' | 'baking' | 'writing' | 'done' | 'error'; message?: string; done?: number; total?: number };

export default function BakeFramesPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<Rig | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<keyof typeof PRESETS>('hero');
  const [name, setName] = useState('hero');
  const [story, setStory] = useState<Story>('assemble');
  const [sets, setSets] = useState<Record<SetKey, SetConfig>>({ ...PRESETS.hero });
  const [quality, setQuality] = useState(0.82);
  const [background, setBackground] = useState<'transparent' | 'dark'>('dark');
  const [modelHeight, setModelHeight] = useState(1.6);
  const [exposure, setExposure] = useState(1.05);
  const [scrub, setScrub] = useState(0);
  const [previewSet, setPreviewSet] = useState<SetKey>('desktop');
  const [status, setStatus] = useState<Status>({ phase: 'idle' });
  const supportsFs = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rig = buildRig(canvas);
    rigRef.current = rig;
    return () => {
      disposeModel(rig);
      rig.pmrem.dispose();
      rig.renderer.dispose();
      rigRef.current = null;
    };
  }, []);

  useEffect(() => {
    const p = PRESETS[preset];
    setSets({ desktop: { ...p.desktop }, mobile: { ...p.mobile } });
    setName(preset);
    if (preset === 'phone') setStory('rise');
  }, [preset]);

  // Load the model whenever the file or the height changes.
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || !file) return;
    let cancelled = false;
    setStatus({ phase: 'loading', message: `Loading ${file.name}…` });
    loadModel(rig, file, modelHeight)
      .then(() => {
        if (cancelled) return;
        setStatus({ phase: 'idle', message: `${file.name} loaded. Scrub the preview, then bake.` });
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [file, modelHeight]);

  const previewConfig = sets[previewSet];
  const previewScale = useMemo(() => Math.min(1, 640 / previewConfig.width, 480 / previewConfig.height), [previewConfig]);

  // Preview render for the current scrub value.
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    // Never touch the renderer mid-bake: the bake owns its size until it finishes.
    if (status.phase === 'baking' || status.phase === 'writing') return;
    const w = Math.round(previewConfig.width * previewScale);
    const h = Math.round(previewConfig.height * previewScale);
    rig.renderer.setSize(w, h, false);
    rig.renderer.toneMappingExposure = exposure;
    rig.scene.background = background === 'dark' ? new THREE.Color(0x000000) : null;
    rig.table.visible = background === 'dark';
    const framing = framingFor(rig, previewConfig.width, previewConfig.height, story);
    pose(rig, scrub, story, framing);
    rig.renderer.render(rig.scene, rig.camera);
  }, [scrub, story, previewConfig, previewScale, exposure, background, file, modelHeight, status.phase]);

  async function bake() {
    const rig = rigRef.current;
    if (!rig || !rig.model) {
      setStatus({ phase: 'error', message: 'Load a .glb first.' });
      return;
    }
    const chosen = (Object.keys(sets) as SetKey[]).filter((k) => sets[k].enabled);
    if (chosen.length === 0) {
      setStatus({ phase: 'error', message: 'Enable at least one set.' });
      return;
    }

    // Pick where the frames go before rendering, so the permission prompt comes first.
    let dir: FileSystemDirectoryHandle | null = null;
    let zip: ZipWriter | null = null;
    if (supportsFs) {
      try {
        dir = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'argraphics-sequences' });
      } catch {
        setStatus({ phase: 'idle', message: 'Cancelled.' });
        return;
      }
    } else {
      zip = new ZipWriter();
    }

    const total = chosen.reduce((n, k) => n + sets[k].count, 0) + 1;
    let done = 0;
    setStatus({ phase: 'baking', done, total });

    const out = document.createElement('canvas');
    const octx = out.getContext('2d')!;
    const writeFile = async (path: string, blob: Blob) => {
      if (zip) {
        await zip.add(`${name}/${path}`, blob);
        return;
      }
      const parts = path.split('/');
      let folder = dir!;
      for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
      const handle = await folder.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    };

    try {
      rig.scene.background = background === 'dark' ? new THREE.Color(0x000000) : null;
      rig.table.visible = background === 'dark';
      rig.renderer.toneMappingExposure = exposure;

      const manifestSets: Partial<Record<SetKey, FrameSet>> = {};
      let poster: Blob | null = null;

      for (const key of chosen) {
        const cfg = sets[key];
        rig.renderer.setSize(cfg.width, cfg.height, false);
        out.width = cfg.width;
        out.height = cfg.height;
        const framing = framingFor(rig, cfg.width, cfg.height, story);
        for (let i = 0; i < cfg.count; i++) {
          const p = cfg.count === 1 ? 1 : i / (cfg.count - 1);
          pose(rig, p, story, framing);
          rig.renderer.render(rig.scene, rig.camera);
          octx.clearRect(0, 0, cfg.width, cfg.height);
          octx.drawImage(rig.renderer.domElement, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/webp', quality));
          if (!blob) throw new Error('WebP encoding is not supported in this browser. Use Chrome.');
          await writeFile(`${key}/${String(i).padStart(4, '0')}.webp`, blob);
          if (key === chosen[0] && i === cfg.count - 1) poster = blob;
          done++;
          if (i % 4 === 0) {
            setStatus({ phase: 'baking', done, total, message: `${key} ${i + 1}/${cfg.count}` });
            await new Promise((r) => requestAnimationFrame(r));
          }
        }
        manifestSets[key] = { dir: key, count: cfg.count, width: cfg.width, height: cfg.height, format: 'webp', pad: 4 };
      }

      setStatus({ phase: 'writing', done, total, message: 'Writing poster and manifest…' });
      if (poster) await writeFile('poster.webp', poster);

      // Merge with an existing manifest so desktop and mobile can be baked in separate runs.
      let existing: FrameManifest | null = null;
      if (dir) {
        try {
          const fh = await dir.getFileHandle('manifest.json');
          existing = JSON.parse(await (await fh.getFile()).text()) as FrameManifest;
        } catch {
          existing = null;
        }
      }
      const desktop = manifestSets.desktop ?? existing?.sets.desktop;
      if (!desktop) throw new Error('A desktop set is required (bake it first or enable it).');
      const manifest: FrameManifest = {
        name,
        version: 1,
        poster: 'poster.webp',
        intro: PRESETS[preset].intro > 0 ? { endFrame: PRESETS[preset].intro, durationMs: 1200 } : undefined,
        sets: { desktop, mobile: manifestSets.mobile ?? existing?.sets.mobile },
        source: {
          model: file?.name,
          story,
          quality,
          background,
          modelHeight,
          exposure,
          bakedAt: new Date().toISOString(),
        },
      };
      await writeFile('manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
      done++;

      if (zip) {
        const blob = zip.finish();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}-sequence.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setStatus({ phase: 'done', done, total, message: `Downloaded ${name}-sequence.zip. Unzip into public/sequences/.` });
      } else {
        setStatus({ phase: 'done', done, total, message: `Wrote ${done - 1} frames, poster.webp and manifest.json.` });
      }
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      // Put the preview back.
      const cfg = sets[previewSet];
      rig.renderer.setSize(Math.round(cfg.width * previewScale), Math.round(cfg.height * previewScale), false);
    }
  }

  const busy = status.phase === 'baking' || status.phase === 'writing' || status.phase === 'loading';

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-6 text-[#f5f5f5]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-5 text-sm">
          <div>
            <h1 className="text-xl font-semibold">Frame baker</h1>
            <p className="mt-1 text-[#a3a3a3]">
              Dev only. Renders a GLB into a scroll-scrub image sequence for the landing page. Pick the folder{' '}
              <code className="rounded bg-[#1f1f1f] px-1">artifacts/argraphics/public/sequences/&lt;name&gt;</code> when asked.
            </p>
            {!supportsFs ? (
              <p className="mt-2 rounded border border-dashed border-[#444] p-2 text-[#a3a3a3]">
                This browser cannot write folders; you will get a zip to unpack into public/sequences/. Chrome writes directly.
              </p>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-1 block text-[#a3a3a3]">Model (.glb)</span>
            <input
              type="file"
              accept=".glb,model/gltf-binary"
              className="block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-[#1f1f1f] file:px-3 file:py-2 file:text-[#f5f5f5]"
              onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[#a3a3a3]">Preset</span>
              <select className="w-full rounded border border-[#2a2a2a] bg-[#121212] p-2" value={preset} onChange={(e) => setPreset(e.currentTarget.value as keyof typeof PRESETS)}>
                {Object.entries(PRESETS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[#a3a3a3]">Folder name</span>
              <input className="w-full rounded border border-[#2a2a2a] bg-[#121212] p-2" value={name} onChange={(e) => setName(e.currentTarget.value.replace(/[^a-z0-9-]/gi, ''))} />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[#a3a3a3]">Story</span>
            <select className="w-full rounded border border-[#2a2a2a] bg-[#121212] p-2" value={story} onChange={(e) => setStory(e.currentTarget.value as Story)}>
              <option value="assemble">Assemble: builds up from the table, turns, settles (hero)</option>
              <option value="rise">Rise: floats up out of the table and turns (phone)</option>
              <option value="turntable">Turntable: one full rotation</option>
            </select>
          </label>

          {(['desktop', 'mobile'] as SetKey[]).map((key) => (
            <fieldset key={key} className="rounded border border-[#2a2a2a] p-3">
              <legend className="px-1 text-[#a3a3a3]">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sets[key].enabled}
                    onChange={(e) => {
                      const enabled = e.currentTarget.checked; // read before the updater runs
                      setSets((s) => ({ ...s, [key]: { ...s[key], enabled } }));
                    }}
                  />
                  {key} set
                </label>
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(['width', 'height', 'count'] as const).map((field) => (
                  <label key={field} className="block">
                    <span className="mb-1 block text-xs text-[#737373]">{field}</span>
                    <input
                      type="number"
                      className="w-full rounded border border-[#2a2a2a] bg-[#121212] p-1.5"
                      value={sets[key][field]}
                      min={field === 'count' ? 2 : 64}
                      onChange={(e) => {
                        const value = Number(e.currentTarget.value) || 0;
                        setSets((s) => ({ ...s, [key]: { ...s[key], [field]: value } }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[#a3a3a3]">WebP quality {quality.toFixed(2)}</span>
              <input type="range" min={0.5} max={0.95} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.currentTarget.value))} className="w-full" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[#a3a3a3]">Exposure {exposure.toFixed(2)}</span>
              <input type="range" min={0.5} max={2} step={0.05} value={exposure} onChange={(e) => setExposure(Number(e.currentTarget.value))} className="w-full" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[#a3a3a3]">Model height (scene units)</span>
              <input type="number" step={0.1} min={0.2} className="w-full rounded border border-[#2a2a2a] bg-[#121212] p-1.5" value={modelHeight} onChange={(e) => setModelHeight(Number(e.currentTarget.value) || 1.6)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[#a3a3a3]">Background</span>
              <select className="w-full rounded border border-[#2a2a2a] bg-[#121212] p-1.5" value={background} onChange={(e) => setBackground(e.currentTarget.value as 'dark' | 'transparent')}>
                <option value="dark">Dark table (black)</option>
                <option value="transparent">Transparent (no table)</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={busy || !file}
            onClick={() => void bake()}
            className="w-full rounded-full bg-[hsl(347_77%_50%)] px-5 py-3 font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Bake frames'}
          </button>

          {status.message || status.total ? (
            <div className={`rounded border p-3 ${status.phase === 'error' ? 'border-red-500/40 text-red-300' : 'border-[#2a2a2a] text-[#a3a3a3]'}`}>
              {status.total ? (
                <div className="mb-2 h-1.5 overflow-hidden rounded bg-[#1f1f1f]">
                  <div className="h-full bg-[#f5f5f5]" style={{ width: `${Math.round(((status.done ?? 0) / status.total) * 100)}%` }} />
                </div>
              ) : null}
              {status.message}
            </div>
          ) : null}
        </aside>

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <span className="text-[#a3a3a3]">Preview</span>
              <select className="rounded border border-[#2a2a2a] bg-[#121212] p-1.5" value={previewSet} onChange={(e) => setPreviewSet(e.currentTarget.value as SetKey)}>
                <option value="desktop">desktop</option>
                <option value="mobile">mobile</option>
              </select>
            </label>
            <label className="flex flex-1 items-center gap-3">
              <span className="text-[#a3a3a3]">Scrub {scrub.toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.005} value={scrub} onChange={(e) => setScrub(Number(e.currentTarget.value))} className="flex-1" />
            </label>
          </div>
          <div className="inline-block rounded-xl border border-[#2a2a2a] bg-[#121212] p-2" style={{ backgroundImage: background === 'transparent' ? 'linear-gradient(45deg,#1a1a1a 25%,transparent 25%),linear-gradient(-45deg,#1a1a1a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1a 75%),linear-gradient(-45deg,transparent 75%,#1a1a1a 75%)' : undefined, backgroundSize: '20px 20px', backgroundPosition: '0 0,0 10px,10px -10px,-10px 0' }}>
            <canvas ref={canvasRef} className="block max-w-full" />
          </div>
          <p className="mt-3 max-w-prose text-xs text-[#737373]">
            Tip: the “assemble” story clips the model from the table up, so a drink looks like it is being poured and a tower looks like it is being stacked. If the cut
            looks hollow, that model has open geometry; switch to “rise”. Output goes to <code>public/sequences/{name}/</code> and the landing page picks it up on reload.
          </p>
        </section>
      </div>
    </div>
  );
}
