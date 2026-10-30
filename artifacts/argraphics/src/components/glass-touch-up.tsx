import { createElement, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Droplets, Eraser, GlassWater, LoaderCircle, Minus, PaintBucket, Plus, Square, Undo2, Wand2, X } from 'lucide-react';
import { encodePickId, loopBounds, pickedIds, type Point } from '@/lib/lasso';

/** A triangle of the stored model: `[primitiveIndex, triangleIndex]`, as the server expects it. */
export type Pick = [number, number];
export type Picks = { solid: Pick[]; glass: Pick[]; fill: Pick[]; inside: Pick[]; source: Pick[] };
type Label = 'solid' | 'glass' | 'fill' | 'inside' | 'source';

const LABELS: Label[] = ['glass', 'solid', 'fill', 'inside', 'source'];
const COLOURS: Record<Label, number> = { glass: 0x38bdf8, solid: 0xfb923c, fill: 0x34d399, inside: 0xa78bfa, source: 0xfacc15 };
const STROKES: Record<Label, string> = { glass: '#38bdf8', solid: '#fb923c', fill: '#34d399', inside: '#a78bfa', source: '#facc15' };
const FILLS: Record<Label, string> = { glass: 'rgb(56 189 248 / .25)', solid: 'rgb(251 146 60 / .25)', fill: 'rgb(52 211 153 / .25)', inside: 'rgb(167 139 250 / .25)', source: 'rgb(250 204 21 / .25)' };
const NAMES: Record<Label, string> = { glass: 'clear glass', solid: 'solid', fill: 'filled in', inside: 'filled inside', source: 'the texture to copy' };
/** The split's helper primitives (the drink's body and inner surface) are not the owner's to relabel. */
const HELPER_MATERIALS = new Set(['liquid', 'inner']);
const HINTS: Partial<Record<Label, string>> = {
  fill: 'Loop a see-through hole in the drink: it turns solid and is repainted to match the drink around it.',
  inside: 'Loop clear glass that looks hollow: the wall stays clear and the drink is filled in behind it, textured like the drink around it.',
  source: 'Loop the texture to copy, then switch to Fill in or Fill inside and loop the spot to paint.',
};

/**
 * The 3D preview with a lasso for the owner to label spots of the model as clear glass,
 * solid, or filled in, after the automatic split. A filled-in spot becomes solid and its
 * texture is repainted from the drink around it, for a see-through hole where the drink
 * should be. In touch-up mode the preview is our own view of the same file: every triangle
 * is drawn into a hidden picking pass under its own colour, so a loop selects exactly the
 * triangles visible inside it, and the selection is painted on the model straight away.
 * Arrow keys and the on-screen arrows rotate; Apply sends the picks to the server, which
 * re-splits the stored model, and the preview reloads it.
 */
export function GlassTouchUp({ src, alt, applying, onApply }: {
  src: string;
  alt: string;
  applying: boolean;
  onApply: (picks: Picks) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState<Label>('glass');
  const [loops, setLoops] = useState<Array<{ label: Label; picks: Pick[] }>>([]);
  // A new file means a new model: earlier picks no longer name its triangles.
  useEffect(() => { setLoops([]); }, [src]);

  const apply = () => {
    const picks: Picks = { solid: [], glass: [], fill: [], inside: [], source: [] };
    // Later loops win over earlier ones for the same triangle.
    const latest = new Map<string, { label: Label; pick: Pick }>();
    for (const entry of loops) for (const pick of entry.picks) latest.set(`${pick[0]}/${pick[1]}`, { label: entry.label, pick });
    for (const { label: l, pick } of latest.values()) picks[l].push(pick);
    onApply(picks);
  };
  const pending = loops.reduce((sum, entry) => sum + entry.picks.length, 0);
  const copying = loops.some((entry) => entry.label === 'source');
  // A copied texture alone changes nothing; Apply waits for a spot to paint or relabel.
  const actionable = loops.some((entry) => entry.label !== 'source');
  const painting = loops.some((entry) => entry.label === 'fill' || entry.label === 'inside');
  const status = pending
    ? `${pending} spots in ${loops.length} loop${loops.length > 1 ? 's' : ''}${copying ? painting ? ' · fills copy the looped texture' : ' · texture copied: now loop a spot to fill' : ''}`
    : HINTS[label] ?? 'Draw a loop around a spot. Arrow keys rotate, + and − zoom.';
  const viewerStyle: CSSProperties = { width: '100%', height: '100%', backgroundColor: 'transparent' };

  return (
    <div className="relative h-full w-full" data-testid="panel-glass-touch-up" data-editing={editing}>
      {editing
        ? <LassoEditor src={src} label={label} loops={loops} onLoop={(entry) => setLoops((current) => [...current, entry])} />
        : createElement('model-viewer', { src, 'camera-controls': true, 'auto-rotate': true, 'rotation-per-second': '18deg', 'shadow-intensity': '0.7', 'environment-image': 'neutral', alt, style: viewerStyle })}
      <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/95 p-1.5 text-xs shadow-lg backdrop-blur">
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 font-semibold text-primary-foreground" data-testid="button-touch-up"><Wand2 size={14} /> Touch up glass</button>
        ) : (
          <>
            <button type="button" onClick={() => setLabel('glass')} className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 font-semibold ${label === 'glass' ? 'bg-sky-500 text-white' : 'border border-border'}`} data-testid="button-label-glass"><GlassWater size={14} /> Clear glass</button>
            <button type="button" onClick={() => setLabel('solid')} className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 font-semibold ${label === 'solid' ? 'bg-orange-500 text-white' : 'border border-border'}`} data-testid="button-label-solid"><Square size={14} /> Solid</button>
            <button type="button" onClick={() => setLabel('fill')} title="Make the spot solid and paint it with the drink's own colour and texture from around it" className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 font-semibold ${label === 'fill' ? 'bg-emerald-500 text-white' : 'border border-border'}`} data-testid="button-label-fill"><PaintBucket size={14} /> Fill in</button>
            <button type="button" onClick={() => setLabel('inside')} title="Keep the glass clear and fill the inside of the drink behind it, textured like the drink around it" className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 font-semibold ${label === 'inside' ? 'bg-violet-500 text-white' : 'border border-border'}`} data-testid="button-label-inside"><Droplets size={14} /> Fill inside</button>
            <button type="button" onClick={() => setLabel('source')} title="Loop the texture to copy into the spots you fill, like a clone stamp" className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 font-semibold ${label === 'source' ? 'bg-yellow-400 text-black' : 'border border-border'}`} data-testid="button-label-source"><Copy size={14} /> Copy texture</button>
            <span className="px-1 text-muted-foreground" role="status">{status}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => setLoops((current) => current.slice(0, -1))} disabled={!loops.length} className="flex min-h-10 items-center gap-1 rounded-lg border border-border px-2.5 disabled:opacity-40" data-testid="button-undo-loop"><Undo2 size={14} /> Undo</button>
              <button type="button" onClick={() => setLoops([])} disabled={!loops.length} className="flex min-h-10 items-center gap-1 rounded-lg border border-border px-2.5 disabled:opacity-40" data-testid="button-clear-loops"><Eraser size={14} /> Clear</button>
              <button type="button" onClick={() => setEditing(false)} className="flex min-h-10 items-center gap-1 rounded-lg border border-border px-2.5" data-testid="button-touch-up-done"><X size={14} /> Done</button>
              <button type="button" onClick={apply} disabled={!actionable || applying} className="flex min-h-10 items-center gap-1 rounded-lg bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-40" data-testid="button-apply-touch-up">{applying ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} Apply</button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Everything the three.js view keeps between renders. */
type View = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The model's primitives in file order, so picks match what the server stores. */
  primitives: THREE.Mesh[];
  /** Hidden picking pass: the same triangles, each under its own colour. */
  pickScene: THREE.Scene;
  pickTarget: THREE.WebGLRenderTarget;
  /** Global triangle id → where it lives. */
  idToPick: Pick[];
  /** Overlay meshes that show the current loops, one per primitive and label. */
  highlights: Record<Label, THREE.Mesh[]>;
  orbit: { theta: number; phi: number; radius: number; target: THREE.Vector3 };
  dispose(): void;
};

function LassoEditor({ src, label, loops, onLoop }: {
  src: string;
  label: Label;
  loops: Array<{ label: Label; picks: Pick[] }>;
  onLoop: (entry: { label: Label; picks: Pick[] }) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [loop, setLoop] = useState<Point[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [size, setSize] = useState({ width: 1, height: 1 });

  // Build the view once per file.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: View | null = null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.DirectionalLight(0xffffff, 1.2).translateX(2).translateY(4).translateZ(3));
    const camera = new THREE.PerspectiveCamera(30, host.clientWidth / host.clientHeight, 0.01, 100);

    new GLTFLoader().load(src, (gltf) => {
      if (cancelled) return;
      const primitives: THREE.Mesh[] = [];
      gltf.scene.traverse((object) => { if ((object as THREE.Mesh).isMesh) primitives.push(object as THREE.Mesh); });
      scene.add(gltf.scene);
      // Frame the model.
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const target = bounds.getCenter(new THREE.Vector3());
      const radius = bounds.getSize(new THREE.Vector3()).length() * 1.1;
      const orbit = { theta: 0, phi: Math.PI / 2.3, radius, target };

      // Picking pass: every triangle of every primitive, non-indexed, coloured by id.
      const pickScene = new THREE.Scene();
      const idToPick: Pick[] = [];
      const highlights: Record<Label, THREE.Mesh[]> = { glass: [], solid: [], fill: [], inside: [], source: [] };
      primitives.forEach((primitive, primitiveIndex) => {
        // The helpers keep their file-order index but take no picks.
        const materialName = (Array.isArray(primitive.material) ? primitive.material[0] : primitive.material)?.name;
        if (HELPER_MATERIALS.has(materialName ?? '')) { for (const l of LABELS) highlights[l].push(new THREE.Mesh()); return; }
        const geometry = primitive.geometry;
        const index = geometry.getIndex();
        const position = geometry.getAttribute('position');
        const triangleCount = index ? index.count / 3 : position.count / 3;
        const positions = new Float32Array(triangleCount * 9);
        const colours = new Float32Array(triangleCount * 9);
        for (let t = 0; t < triangleCount; t++) {
          const id = idToPick.length;
          idToPick.push([primitiveIndex, t]);
          const colour = encodePickId(id);
          for (let k = 0; k < 3; k++) {
            const vertex = index ? index.getX(t * 3 + k) : t * 3 + k;
            positions.set([position.getX(vertex), position.getY(vertex), position.getZ(vertex)], (t * 3 + k) * 3);
            colours.set(colour, (t * 3 + k) * 3);
          }
        }
        const pickGeometry = new THREE.BufferGeometry();
        pickGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        pickGeometry.setAttribute('pickColor', new THREE.BufferAttribute(colours, 3));
        const pickMesh = new THREE.Mesh(pickGeometry, new THREE.ShaderMaterial({
          vertexShader: 'attribute vec3 pickColor; varying vec3 vColor; void main() { vColor = pickColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }',
          side: THREE.DoubleSide,
        }));
        primitive.updateWorldMatrix(true, false);
        pickMesh.applyMatrix4(primitive.matrixWorld);
        pickScene.add(pickMesh);
        // Highlights share the primitive's vertices and take an index of the picked triangles.
        for (const l of LABELS) {
          const highlight = new THREE.Mesh(
            new THREE.BufferGeometry().setAttribute('position', position).setIndex([]),
            new THREE.MeshBasicMaterial({ color: COLOURS[l], transparent: true, opacity: 0.6, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
          );
          highlight.applyMatrix4(primitive.matrixWorld);
          highlight.renderOrder = 10;
          scene.add(highlight);
          highlights[l].push(highlight);
        }
      });
      const pickTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      view = {
        renderer, scene, camera, primitives, pickScene, pickTarget, idToPick, highlights, orbit,
        dispose() {
          renderer.dispose();
          pickTarget.dispose();
          pmrem.dispose();
          host.contains(renderer.domElement) && host.removeChild(renderer.domElement);
        },
      };
      viewRef.current = view;
      setSize({ width: host.clientWidth, height: host.clientHeight });
      setStatus('ready');
      render();
    }, undefined, () => { if (!cancelled) setStatus('failed'); });

    const render = () => {
      const current = viewRef.current;
      if (!current) return;
      const { orbit: o } = current;
      current.camera.position.set(
        o.target.x + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
        o.target.y + o.radius * Math.cos(o.phi),
        o.target.z + o.radius * Math.sin(o.phi) * Math.cos(o.theta),
      );
      current.camera.lookAt(o.target);
      current.renderer.render(current.scene, current.camera);
    };
    const resize = () => {
      const current = viewRef.current;
      if (!current || !host.clientWidth) return;
      current.renderer.setSize(host.clientWidth, host.clientHeight);
      current.camera.aspect = host.clientWidth / host.clientHeight;
      current.camera.updateProjectionMatrix();
      setSize({ width: host.clientWidth, height: host.clientHeight });
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    (host as HTMLDivElement & { __render?: () => void }).__render = render;
    return () => {
      cancelled = true;
      observer.disconnect();
      view?.dispose();
      viewRef.current = null;
      if (!view && host.contains(renderer.domElement)) { renderer.dispose(); host.removeChild(renderer.domElement); }
    };
  }, [src]);

  const render = () => (hostRef.current as (HTMLDivElement & { __render?: () => void }) | null)?.__render?.();

  // Paint the loops onto the model whenever they change.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const latest = new Map<string, { label: Label; pick: Pick }>();
    for (const entry of loops) for (const pick of entry.picks) latest.set(`${pick[0]}/${pick[1]}`, { label: entry.label, pick });
    const perMesh = Object.fromEntries(LABELS.map((l) => [l, view.primitives.map(() => [] as number[])])) as Record<Label, number[][]>;
    for (const { label: l, pick: [p, t] } of latest.values()) {
      const index = view.primitives[p]?.geometry.getIndex();
      if (!index) continue;
      perMesh[l][p].push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
    }
    for (const l of LABELS) {
      view.highlights[l].forEach((mesh, p) => {
        mesh.geometry.setIndex(perMesh[l][p]);
        mesh.visible = perMesh[l][p].length > 0;
      });
    }
    render();
  }, [loops, status]);

  const rotate = (dTheta: number, dPhi: number, zoom = 1) => {
    const view = viewRef.current;
    if (!view) return;
    view.orbit.theta += dTheta;
    view.orbit.phi = Math.min(Math.PI - 0.05, Math.max(0.05, view.orbit.phi + dPhi));
    view.orbit.radius = Math.min(view.orbit.radius * 4, Math.max(view.orbit.radius * 0.1, view.orbit.radius * zoom));
    render();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.12;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => rotate(-step, 0), ArrowRight: () => rotate(step, 0),
      ArrowUp: () => rotate(0, -step), ArrowDown: () => rotate(0, step),
      '+': () => rotate(0, 0, 0.9), '=': () => rotate(0, 0, 0.9), '-': () => rotate(0, 0, 1.1),
    };
    const action = keys[event.key];
    if (action) { event.preventDefault(); action(); }
  };

  const pointFrom = (event: PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (status !== 'ready' || event.button !== 0) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(true);
    setLoop([pointFrom(event)]);
  };
  const extend = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const next = pointFrom(event);
    setLoop((current) => {
      const last = current[current.length - 1];
      return last && Math.hypot(next[0] - last[0], next[1] - last[1]) < 3 ? current : [...current, next];
    });
  };
  const finish = () => {
    if (!drawing) return;
    setDrawing(false);
    const view = viewRef.current;
    if (!view || loop.length < 3) { setLoop([]); return; }
    // Picking pass over the loop's box: one pixel per CSS pixel is plenty for a finger.
    const { renderer, camera, pickScene, pickTarget } = view;
    const { width, height } = size;
    pickTarget.setSize(width, height);
    const ratio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setRenderTarget(pickTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(pickScene, camera);
    const bounds = loopBounds(loop, width, height);
    const boxWidth = bounds.x1 - bounds.x0 + 1;
    const boxHeight = bounds.y1 - bounds.y0 + 1;
    const pixels = new Uint8Array(boxWidth * boxHeight * 4);
    // The GPU's rows run bottom-up; read the box and flip it to match the loop's coordinates.
    renderer.readRenderTargetPixels(pickTarget, bounds.x0, height - 1 - bounds.y1, boxWidth, boxHeight, pixels);
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(ratio);
    const flipped = new Uint8Array(pixels.length);
    for (let row = 0; row < boxHeight; row++) flipped.set(pixels.subarray(row * boxWidth * 4, (row + 1) * boxWidth * 4), (boxHeight - 1 - row) * boxWidth * 4);
    const ids = pickedIds(flipped, bounds, loop);
    const picks = [...ids].map((id) => view.idToPick[id]).filter(Boolean);
    if (picks.length) onLoop({ label, picks });
    setLoop([]);
    render();
  };

  const path = loop.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={start}
      onPointerMove={extend}
      onPointerUp={finish}
      onPointerCancel={finish}
      className="relative h-full w-full cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-primary"
      role="application"
      aria-label={`Lasso spots of the model to make ${NAMES[label]}; arrow keys rotate`}
      data-testid="surface-lasso"
    >
      <svg width={size.width} height={size.height} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {loop.length > 1 && <path d={drawing ? path : `${path}Z`} fill={FILLS[label]} stroke={STROKES[label]} strokeWidth={2.5} strokeLinejoin="round" />}
      </svg>
      {status === 'loading' && <p className="absolute inset-x-0 top-3 text-center text-xs text-muted-foreground" role="status">Loading the model for touch-up…</p>}
      {status === 'failed' && <p className="absolute inset-x-0 top-3 text-center text-xs text-destructive" role="alert">The model could not be loaded for touch-up. Reopen the studio and try again.</p>}
      <div className="absolute right-2 top-2 grid grid-cols-3 gap-1" onPointerDown={(event) => event.stopPropagation()}>
        <span />
        <button type="button" onClick={() => rotate(0, -0.2)} className="grid h-9 w-9 place-items-center rounded-lg bg-card/90 shadow" aria-label="Tilt up" data-testid="button-rotate-up"><ChevronUp size={16} /></button>
        <button type="button" onClick={() => rotate(0, 0, 0.85)} className="grid h-9 w-9 place-items-center rounded-lg bg-card/90 shadow" aria-label="Zoom in" data-testid="button-zoom-in"><Plus size={16} /></button>
        <button type="button" onClick={() => rotate(-0.25, 0)} className="grid h-9 w-9 place-items-center rounded-lg bg-card/90 shadow" aria-label="Rotate left" data-testid="button-rotate-left"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => rotate(0, 0.2)} className="grid h-9 w-9 place-items-center rounded-lg bg-card/90 shadow" aria-label="Tilt down" data-testid="button-rotate-down"><ChevronDown size={16} /></button>
        <button type="button" onClick={() => rotate(0, 0, 1.15)} className="grid h-9 w-9 place-items-center rounded-lg bg-card/90 shadow" aria-label="Zoom out" data-testid="button-zoom-out"><Minus size={16} /></button>
        <span />
        <button type="button" onClick={() => rotate(0.25, 0)} className="col-start-3 grid h-9 w-9 place-items-center rounded-lg bg-card/90 shadow" aria-label="Rotate right" data-testid="button-rotate-right"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
