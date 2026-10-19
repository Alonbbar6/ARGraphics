/**
 * The shelf's renderer, camera, lights and environment. Renders on demand: callers ask
 * for frames and the loop stops once nothing is moving, when the stage is off screen,
 * or when the tab is hidden.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from '@/lib/motion';
import { SHELF_CONFIG, type ShelfConfig } from './shelf-config';

export type ShelfScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The fan. Items are children of this group. */
  group: THREE.Group;
  canvas: HTMLCanvasElement;
  /** Ask for at least `n` more frames (default 1). */
  requestFrames: (n?: number) => void;
  /** Register a per-tick callback; return true to keep rendering next frame. */
  onTick: (fn: (dt: number) => boolean) => () => void;
  setVisible: (visible: boolean) => void;
  size: () => { width: number; height: number };
  dispose: () => void;
};

export function createShelfScene(host: HTMLElement, cfg: ShelfConfig = SHELF_CONFIG): ShelfScene {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'shelf-canvas';
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatioMax));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.exposure;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = cfg.environmentIntensity;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(cfg.cameraFov, 1, 0.1, 60);
  camera.position.set(0, cfg.cameraY, cfg.cameraDistance);
  camera.lookAt(0, cfg.lookAtY, 0);

  const group = new THREE.Group();
  group.rotation.x = THREE.MathUtils.degToRad(cfg.groupRotXDeg);
  group.rotation.y = THREE.MathUtils.degToRad(cfg.groupRotYDeg);
  group.scale.setScalar(cfg.groupScale);
  scene.add(group);

  // Warm key from the upper right, cool rim from behind, soft fill from the left.
  const key = new THREE.DirectionalLight(cfg.keyColor, cfg.keyIntensity);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, cfg.fillIntensity);
  fill.position.set(-5, 2, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(cfg.rimColor, cfg.rimIntensity);
  rim.position.set(-1, 3, -5);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));

  let width = 1;
  let height = 1;
  const resize = () => {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Narrow stages pull the camera back so the active model still fits, and look lower so the
    // fan sits higher in the frame, clear of the caption.
    const narrow = camera.aspect < cfg.narrowAspect;
    const squeeze = narrow ? cfg.narrowAspect / camera.aspect : 1;
    camera.position.z = cfg.cameraDistance * Math.min(1.6, squeeze);
    camera.lookAt(0, cfg.lookAtY + (narrow ? cfg.narrowLookAtShift : 0), 0);
    camera.updateProjectionMatrix();
    requestFrames(2);
  };

  let pending = 0;
  let visible = true;
  let hidden = document.hidden;
  let running = false;
  let lastTime = 0;
  const tickers = new Set<(dt: number) => boolean>();

  // GSAP's ticker passes the elapsed time in seconds and the frame delta in milliseconds.
  const frame = (time: number, deltaMs: number) => {
    const dt = lastTime ? Math.min(0.05, Math.max(0.001, deltaMs / 1000)) : 1 / 60;
    lastTime = time;
    let keep = false;
    for (const fn of tickers) if (fn(dt)) keep = true;
    renderer.render(scene, camera);
    if (pending > 0) pending -= 1;
    if (!keep && pending <= 0) {
      stop();
    }
  };

  const start = () => {
    if (running || !visible || hidden) return;
    running = true;
    lastTime = 0;
    gsap.ticker.add(frame);
  };
  const stop = () => {
    if (!running) return;
    running = false;
    gsap.ticker.remove(frame);
  };

  function requestFrames(n = 1) {
    pending = Math.max(pending, n);
    start();
  }

  const onVisibility = () => {
    hidden = document.hidden;
    if (hidden) stop();
    else requestFrames(2);
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onLost = (event: Event) => {
    event.preventDefault();
    stop();
  };
  const onRestored = () => requestFrames(3);
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  return {
    renderer,
    scene,
    camera,
    group,
    canvas,
    requestFrames,
    onTick(fn) {
      tickers.add(fn);
      requestFrames(1);
      return () => tickers.delete(fn);
    },
    setVisible(next) {
      visible = next;
      if (!next) stop();
      else requestFrames(2);
    },
    size: () => ({ width, height }),
    dispose() {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      envTarget.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
