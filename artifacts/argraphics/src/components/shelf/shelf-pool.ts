/**
 * A pool of shelf slots. Only indices near the active one own a slot; the rest are
 * released and their meshes reused. Each slot holds a glossy puck, a poster plane with
 * the item's thumbnail that shows until its model arrives, the model itself, and an
 * invisible cylinder used for pointer picking.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SHELF_CONFIG, type ShelfConfig } from './shelf-config';
import { liveRange, loadOrder } from './shelf-layout';

/** An item without a model shows its poster standing on the puck instead. */
export type ShelfItemSource = { id: string; glbUrl: string | null; posterUrl: string | null };

export type Slot = {
  index: number;
  group: THREE.Group;
  /** Rotates around Y: the turntable. The model and poster sit inside it. */
  turntable: THREE.Group;
  pick: THREE.Mesh;
  poster: THREE.Mesh;
  model: THREE.Object3D | null;
  loading: boolean;
  /** Turntable angle and extra angular velocity from a drag. */
  spin: number;
  spinVelocity: number;
  /** 0..1 pointer hover amount, eased. */
  hover: number;
  /** Poster fade, 1 while the poster shows, eases to 0 once the model is in. */
  posterAlpha: number;
  /** Spring offsets from a cursor sweep or a press, with their velocities. */
  pushRotX: number;
  pushRotY: number;
  pushZ: number;
  pushVX: number;
  pushVY: number;
  pushVZ: number;
  /** 1 right after the slot joins the fan while stepping, easing to 0; the side it came from. */
  spawn: number;
  spawnDir: number;
};

export function resetSlotMotion(slot: Slot) {
  slot.spin = 0;
  slot.spinVelocity = 0;
  slot.hover = 0;
  slot.pushRotX = slot.pushRotY = slot.pushZ = 0;
  slot.pushVX = slot.pushVY = slot.pushVZ = 0;
  slot.spawn = 0;
  slot.spawnDir = 0;
}

type Cached = { promise: Promise<THREE.Group>; root: THREE.Group | null };

const PICK_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.normalMap?.dispose();
      mat.roughnessMap?.dispose();
      mat.metalnessMap?.dispose();
      mat.emissiveMap?.dispose();
      mat.dispose();
    }
  });
}

/** Centre on the origin, feet at y = 0, scaled to a consistent height. Mirrors the frame baker. */
export function normaliseModel(root: THREE.Object3D, targetHeight: number, maxWidth = Infinity) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const byHeight = targetHeight / Math.max(size.y, 1e-6);
  const byWidth = maxWidth / Math.max(size.x, size.z, 1e-6);
  const scale = Math.min(byHeight, byWidth);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const center = box2.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box2.min.y;
  root.updateMatrixWorld(true);
  const final = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return { height: final.y, radius: Math.max(final.x, final.z) / 2 };
}

function makeContactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ShelfPool {
  private slots = new Map<number, Slot>();
  private free: Slot[] = [];
  private cache = new Map<string, Cached>();
  private textures = new Map<string, Promise<THREE.Texture | null>>();
  private loader = new GLTFLoader();
  private textureLoader = new THREE.TextureLoader();
  private puckGeometry: THREE.CylinderGeometry;
  private puckMaterial: THREE.MeshPhysicalMaterial;
  private contactGeometry: THREE.PlaneGeometry;
  private contactMaterial: THREE.MeshBasicMaterial;
  private pickGeometry: THREE.CylinderGeometry;
  private disposed = false;
  private from = 0;
  private to = -1;

  constructor(
    private parent: THREE.Group,
    private items: ShelfItemSource[],
    private cfg: ShelfConfig = SHELF_CONFIG,
    private onChange: () => void = () => undefined,
  ) {
    this.textureLoader.setCrossOrigin('anonymous');
    this.puckGeometry = new THREE.CylinderGeometry(cfg.puckRadius, cfg.puckRadius * 0.985, cfg.puckThickness, 72);
    this.puckMaterial = new THREE.MeshPhysicalMaterial({ color: 0x1c1c1e, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
    this.contactGeometry = new THREE.PlaneGeometry(1, 1);
    this.contactMaterial = new THREE.MeshBasicMaterial({ map: makeContactTexture(), transparent: true, depthWrite: false });
    this.pickGeometry = new THREE.CylinderGeometry(cfg.puckRadius, cfg.puckRadius, cfg.modelHeight + cfg.puckThickness, 24);
    const poolSize = cfg.renderRadius * 2 + 3;
    for (let i = 0; i < poolSize; i += 1) this.free.push(this.makeSlot());
  }

  private makeSlot(): Slot {
    const group = new THREE.Group();
    group.visible = false;
    const turntable = new THREE.Group();
    group.add(turntable);

    const puck = new THREE.Mesh(this.puckGeometry, this.puckMaterial);
    puck.position.y = this.cfg.puckThickness / 2;
    group.add(puck);

    const contact = new THREE.Mesh(this.contactGeometry, this.contactMaterial);
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = this.cfg.puckThickness + 0.002;
    contact.scale.setScalar(this.cfg.puckRadius * 1.6);
    group.add(contact);

    const posterMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), posterMaterial);
    poster.visible = false;
    turntable.add(poster);

    const pick = new THREE.Mesh(this.pickGeometry, PICK_MATERIAL);
    pick.position.y = (this.cfg.modelHeight + this.cfg.puckThickness) / 2;
    group.add(pick);

    this.parent.add(group);
    const slot: Slot = {
      index: -1, group, turntable, pick, poster, model: null, loading: false, posterAlpha: 1,
      spin: 0, spinVelocity: 0, hover: 0, pushRotX: 0, pushRotY: 0, pushZ: 0, pushVX: 0, pushVY: 0, pushVZ: 0, spawn: 0, spawnDir: 0,
    };
    return slot;
  }

  get(index: number) {
    return this.slots.get(index);
  }

  forEach(fn: (slot: Slot) => void) {
    this.slots.forEach(fn);
  }

  pickTargets() {
    return Array.from(this.slots.values(), (slot) => slot.pick);
  }

  /**
   * Make sure the indices around `active` have slots, loading models for them in priority order.
   * With `spawning`, newcomers enter from the side they belong to (used while stepping).
   */
  sync(active: number, spawning = false) {
    const { from, to } = liveRange(active, this.items.length, this.cfg.renderRadius);
    if (from === this.from && to === this.to) return;
    this.from = from;
    this.to = to;
    for (const slot of Array.from(this.slots.values())) {
      if (slot.index < from || slot.index > to) this.release(slot);
    }
    for (const index of loadOrder(Math.round(active), this.items.length, this.cfg.renderRadius + 1)) {
      if (index >= from && index <= to) this.assign(index, spawning ? Math.sign(index - active) || 1 : 0);
    }
  }

  private assign(index: number, spawnDir: number) {
    if (this.slots.has(index)) return;
    const slot = this.free.pop();
    if (!slot) return;
    const item = this.items[index];
    slot.index = index;
    slot.pick.userData.index = index;
    slot.group.visible = true;
    resetSlotMotion(slot);
    if (spawnDir) {
      slot.spawn = 1;
      slot.spawnDir = spawnDir;
    }
    slot.posterAlpha = 1;
    this.slots.set(index, slot);
    this.showPoster(slot, item);
    void this.attachModel(slot, item);
  }

  private release(slot: Slot) {
    this.slots.delete(slot.index);
    slot.index = -1;
    slot.group.visible = false;
    slot.poster.visible = false;
    if (slot.model) {
      slot.turntable.remove(slot.model);
      slot.model = null;
    }
    this.free.push(slot);
  }

  private showPoster(slot: Slot, item: ShelfItemSource) {
    const material = slot.poster.material as THREE.MeshBasicMaterial;
    material.map = null;
    material.opacity = 1;
    slot.poster.visible = false;
    if (!item.posterUrl) return;
    void this.texture(item.posterUrl).then((tex) => {
      if (this.disposed || slot.index === -1 || this.items[slot.index] !== item || !tex || slot.model) return;
      const image = tex.image as { width?: number; height?: number } | undefined;
      const aspect = image?.width && image?.height ? image.width / image.height : 1;
      const h = this.cfg.modelHeight * 0.92;
      slot.poster.scale.set(h * aspect, h, 1);
      slot.poster.position.y = this.cfg.puckThickness + h / 2;
      material.map = tex;
      material.needsUpdate = true;
      slot.poster.visible = true;
      this.onChange();
    });
  }

  private texture(url: string) {
    let pending = this.textures.get(url);
    if (!pending) {
      pending = new Promise<THREE.Texture | null>((resolve) => {
        this.textureLoader.load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        }, undefined, () => resolve(null));
      });
      this.textures.set(url, pending);
    }
    return pending;
  }

  private load(url: string) {
    let cached = this.cache.get(url);
    if (!cached) {
      const entry: Cached = { root: null, promise: Promise.resolve(new THREE.Group()) };
      entry.promise = this.loader.loadAsync(url).then((gltf) => {
        const root = gltf.scene;
        normaliseModel(root, this.cfg.modelHeight, this.cfg.modelMaxWidth);
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.frustumCulled = false;
        });
        entry.root = root;
        return root;
      });
      cached = entry;
      this.cache.set(url, cached);
    }
    return cached.promise;
  }

  private async attachModel(slot: Slot, item: ShelfItemSource) {
    if (!item.glbUrl) return;
    slot.loading = true;
    let root: THREE.Group;
    try {
      root = await this.load(item.glbUrl);
    } catch {
      slot.loading = false;
      return;
    }
    if (this.disposed || slot.index === -1 || this.items[slot.index] !== item) return;
    // A cached scene may be shown in one slot at a time, so slots get a clone with shared materials.
    const instance = root.clone(true);
    instance.position.y += this.cfg.puckThickness;
    slot.model = instance;
    slot.turntable.add(instance);
    slot.loading = false;
    slot.posterAlpha = slot.poster.visible ? 1 : 0;
    this.onChange();
  }

  /** Ease the poster out once a model is in; returns true while still animating. */
  fadePosters(dt: number) {
    let busy = false;
    for (const slot of this.slots.values()) {
      if (!slot.model || !slot.poster.visible) continue;
      slot.posterAlpha = Math.max(0, slot.posterAlpha - dt * 4);
      (slot.poster.material as THREE.MeshBasicMaterial).opacity = slot.posterAlpha;
      if (slot.posterAlpha <= 0) slot.poster.visible = false;
      else busy = true;
    }
    return busy;
  }

  dispose() {
    this.disposed = true;
    for (const slot of [...this.slots.values(), ...this.free]) {
      this.parent.remove(slot.group);
      (slot.poster.material as THREE.MeshBasicMaterial).dispose();
      slot.poster.geometry.dispose();
    }
    this.slots.clear();
    this.free = [];
    for (const entry of this.cache.values()) {
      if (entry.root) disposeObject(entry.root);
    }
    this.cache.clear();
    void Promise.all(this.textures.values()).then((textures) => textures.forEach((tex) => tex?.dispose()));
    this.textures.clear();
    this.puckGeometry.dispose();
    this.puckMaterial.dispose();
    this.contactGeometry.dispose();
    this.contactMaterial.map?.dispose();
    this.contactMaterial.dispose();
    this.pickGeometry.dispose();
  }
}
