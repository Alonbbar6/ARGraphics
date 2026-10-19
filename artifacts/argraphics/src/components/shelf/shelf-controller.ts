/**
 * Drives the shelf: one fractional active index that GSAP tweens between items, a velocity
 * that leans the fan, pointer input (hover tilt, drag to scrub, drag the front model to spin
 * it, click to step or select), horizontal wheel stepping, the intro and the flight out.
 *
 * Vertical wheel is left alone so the dashboard page keeps scrolling.
 */
import * as THREE from 'three';
import { gsap, prefersReducedMotion } from '@/lib/motion';
import { SHELF_CONFIG, type ShelfConfig } from './shelf-config';
import { clamp, layoutItem, staggered, type FanState } from './shelf-layout';
import { ShelfPool, type ShelfItemSource, type Slot } from './shelf-pool';
import { createShelfScene, type ShelfScene } from './shelf-scene';

export type StepSource = 'click' | 'key' | 'flick' | 'wheel' | 'snap';

export type ShelfCallbacks = {
  onIndexChange: (index: number) => void;
  onSelect: (index: number) => void;
  onHover?: (index: number | null) => void;
};

type DragMode = 'pending' | 'scrub' | 'spin';

type Drag = {
  pointerId: number;
  mode: DragMode;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  velocityX: number;
  startIndex: number;
  hit: number;
};

export class ShelfController {
  readonly scene: ShelfScene;
  private pool: ShelfPool;
  private anim = { index: 0 };
  private index = 0;
  private target = 0;
  private velocity = 0;
  private fan: FanState = { others: 1, active: 1, inbound: false };
  /** 0..1 progress of the rise-from-below intro. */
  private intro = { p: 0 };
  private introDone = false;
  private time = 0;
  private hoverIndex: number | null = null;
  private pointer = new THREE.Vector2(0, 0);
  private lastPointer = { x: 0, y: 0, time: 0 };
  private raycaster = new THREE.Raycaster();
  private drag: Drag | null = null;
  private wheelAccumulator = 0;
  private lastWheelStep = 0;
  private reduced = prefersReducedMotion();
  private leaving = false;
  private destroyed = false;
  private offTick: () => void;
  private intersection: IntersectionObserver | null = null;
  private readonly cfg: ShelfConfig;
  private readonly count: number;

  constructor(
    private host: HTMLElement,
    items: ShelfItemSource[],
    private callbacks: ShelfCallbacks,
    cfg: ShelfConfig = SHELF_CONFIG,
    startIndex = 0,
  ) {
    this.cfg = cfg;
    this.count = items.length;
    this.scene = createShelfScene(host, cfg);
    this.pool = new ShelfPool(this.scene.group, items, cfg, () => this.scene.requestFrames(2));
    this.index = this.target = this.anim.index = clamp(startIndex, 0, Math.max(0, items.length - 1));
    this.pool.sync(this.index);
    this.offTick = this.scene.onTick((dt) => this.tick(dt));

    const canvas = this.scene.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver((entries) => {
        this.scene.setVisible(entries.some((entry) => entry.isIntersecting));
      }, { rootMargin: '120px 0px' });
      this.intersection.observe(host);
    }

    this.runIntro();
  }

  get activeIndex() {
    return this.target;
  }

  /** Dev-only snapshot for debugging from the console. */
  debug() {
    return { index: this.index, target: this.target, velocity: this.velocity, intro: this.intro.p, introDone: this.introDone, time: this.time, reduced: this.reduced, leaving: this.leaving, slots: this.pool.pickTargets().length };
  }

  /** Step to an item. Sources shape the tween the way the A24 gallery does. */
  go(rawIndex: number, source: StepSource = 'snap') {
    if (this.destroyed || this.leaving || this.count === 0) return;
    const index = clamp(Math.round(rawIndex), 0, this.count - 1);
    const distance = Math.abs(index - this.index);
    const changed = index !== this.target;
    this.target = index;
    if (changed) this.callbacks.onIndexChange(index);
    gsap.killTweensOf(this.anim);

    if (this.reduced) {
      this.index = this.anim.index = index;
      this.velocity = 0;
      this.pool.sync(index, false);
      this.scene.requestFrames(2);
      return;
    }

    const base = this.cfg.snapDuration;
    const tween = (() => {
      switch (source) {
        case 'key': return { duration: Math.min(0.6, base - 0.04 + distance * 0.05), kick: 4 };
        case 'click': return { duration: clamp(0.45 + distance * 0.11, base, 1.05), kick: Math.min(5, distance * 1.4) };
        case 'flick': return { duration: base + 0.1, kick: 0 };
        case 'wheel': return { duration: base + 0.05, kick: 2.5 };
        default: return { duration: base, kick: 0 };
      }
    })();
    const direction = Math.sign(index - this.index);
    if (direction && tween.kick) this.velocity = clamp(this.velocity + direction * tween.kick, -12, 12);

    this.anim.index = this.index;
    gsap.to(this.anim, {
      index,
      duration: tween.duration,
      ease: this.cfg.snapEase,
      overwrite: true,
      onUpdate: () => { this.index = this.anim.index; },
      onComplete: () => { this.index = this.anim.index = index; },
    });
    this.scene.requestFrames(3);
  }

  next(source: StepSource = 'key') { this.go(this.target + 1, source); }
  prev(source: StepSource = 'key') { this.go(this.target - 1, source); }

  /** Lift the front model and drop the rest, then resolve. The page can navigate after. */
  flightOut(): Promise<void> {
    if (this.destroyed || this.leaving) return Promise.resolve();
    this.leaving = true;
    this.endDrag();
    gsap.killTweensOf(this.anim);
    gsap.killTweensOf(this.fan);
    this.fan.inbound = false;
    this.velocity = 0;
    this.host.setAttribute('data-shelf-flight', 'true');
    const slot = this.pool.get(this.target);
    if (this.reduced) {
      this.fan.others = 0;
      this.fan.active = this.cfg.flightBoost;
      this.scene.requestFrames(2);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timeline = gsap.timeline({ onComplete: resolve });
      if (this.index !== this.target) {
        timeline.to(this.anim, { index: this.target, duration: 0.18, ease: 'power2.out', onUpdate: () => { this.index = this.anim.index; } }, 0);
      }
      timeline.to(this.fan, { others: 0, duration: this.cfg.flightOutDuration, ease: 'none' }, 0.08);
      timeline.to(this.fan, { active: this.cfg.flightBoost, duration: this.cfg.flightOutDuration, ease: 'power2.in' }, 0.08);
      if (slot) {
        const spinTarget = { value: slot.spin };
        timeline.to(spinTarget, { value: slot.spin + Math.PI / 2, duration: this.cfg.flightOutDuration, ease: 'power2.in', onUpdate: () => { slot.spin = spinTarget.value; } }, 0.08);
      }
      this.scene.requestFrames(3);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.endDrag();
    gsap.killTweensOf(this.anim);
    gsap.killTweensOf(this.fan);
    gsap.killTweensOf(this.intro);
    const canvas = this.scene.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    this.intersection?.disconnect();
    this.offTick();
    this.pool.dispose();
    this.scene.dispose();
  }

  private runIntro() {
    if (this.reduced || this.count === 0) {
      this.intro.p = 1;
      this.introDone = true;
      this.scene.requestFrames(2);
      return;
    }
    // The A24 "preload fan": every model rises from below the shelf, spinning and growing,
    // the front one first and the rest following outward.
    gsap.to(this.intro, {
      p: 1,
      duration: this.cfg.introDuration,
      ease: 'none',
      delay: 0.08,
      onComplete: () => { this.introDone = true; },
    });
    this.scene.requestFrames(3);
  }

  private tick(dt: number) {
    if (this.destroyed) return false;
    this.time += dt;
    let busy = !this.introDone || this.leaving || gsap.isTweening(this.anim) || gsap.isTweening(this.fan);

    if (this.drag?.mode !== 'scrub') {
      this.velocity *= Math.exp(-this.cfg.velocityDecay * dt);
      if (Math.abs(this.velocity) < 0.01) this.velocity = 0;
    }
    if (this.velocity !== 0) busy = true;

    this.pool.sync(this.index, this.introDone && !this.reduced);
    if (this.pool.fadePosters(dt)) busy = true;

    const hoverRate = Math.min(1, dt * this.cfg.hoverEase);
    const spinning = this.drag?.mode === 'spin';
    const springStep = Math.min(dt, 1 / 30);
    this.pool.forEach((slot) => {
      const active = slot.index === this.target;
      const hoverTarget = this.hoverIndex === slot.index && !this.leaving ? 1 : 0;
      if (Math.abs(slot.hover - hoverTarget) > 0.001) {
        slot.hover += (hoverTarget - slot.hover) * hoverRate;
        busy = true;
      } else {
        slot.hover = hoverTarget;
      }

      // Turntable: the front model turns on its own; a drag adds speed that bleeds off.
      if (active && !this.reduced && !this.leaving) {
        if (!spinning) {
          slot.spin += (this.cfg.turntableSpeed + slot.spinVelocity) * dt;
          slot.spinVelocity *= Math.pow(this.cfg.spinFriction, dt * 60);
          if (Math.abs(slot.spinVelocity) < 0.01) slot.spinVelocity = 0;
          busy = true;
        }
      } else if (!active && slot.spinVelocity !== 0) {
        slot.spinVelocity = 0;
      }
      if (!active && !this.reduced && slot.spin !== 0) {
        // Non-active models settle back to face front.
        const settle = Math.min(1, dt * 4);
        const wrapped = ((slot.spin + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        slot.spin = wrapped * (1 - settle);
        if (Math.abs(slot.spin) < 0.002) slot.spin = 0;
        else busy = true;
      }

      // Springs for knocks and presses: pulled back to rest, damped.
      if (!this.reduced) {
        const k = this.cfg.pushSpring;
        const c = this.cfg.pushDamping;
        slot.pushVX += (-slot.pushRotX * k - slot.pushVX * c) * springStep;
        slot.pushVY += (-slot.pushRotY * k - slot.pushVY * c) * springStep;
        slot.pushVZ += (-slot.pushZ * k - slot.pushVZ * c) * springStep;
        slot.pushRotX += slot.pushVX * springStep;
        slot.pushRotY += slot.pushVY * springStep;
        slot.pushZ += slot.pushVZ * springStep;
        const energy = Math.abs(slot.pushRotX) + Math.abs(slot.pushRotY) + Math.abs(slot.pushZ) + Math.abs(slot.pushVX) + Math.abs(slot.pushVY) + Math.abs(slot.pushVZ);
        if (energy < 0.002) {
          slot.pushRotX = slot.pushRotY = slot.pushZ = slot.pushVX = slot.pushVY = slot.pushVZ = 0;
        } else {
          busy = true;
        }
        if (slot.spawn > 0) {
          slot.spawn = Math.max(0, slot.spawn - dt * this.cfg.spawnRate);
          busy = true;
        }
      }

      this.applyPose(slot, active);
    });

    return busy;
  }

  private applyPose(slot: Slot, active: boolean) {
    const pose = layoutItem(slot.index - this.index, this.velocity, this.fan, this.cfg);
    slot.group.visible = pose.visible;
    if (!pose.visible) return;
    const cfg = this.cfg;
    let { x, y, z, scale } = pose;
    let rotX = pose.rotX + slot.pushRotX;
    let rotY = pose.rotY + slot.pushRotY;
    let rotZ = pose.rotZ;
    let spin = slot.spin;
    z += slot.pushZ;

    if (slot.hover > 0.001) {
      rotX += slot.hover * cfg.hoverTilt * -this.pointer.y * 0.5;
      rotY += slot.hover * cfg.hoverTilt * this.pointer.x * 0.5;
    }

    if (!this.reduced) {
      // Idle life.
      if (active && !this.leaving) {
        y += Math.sin(this.time * cfg.idleRate * Math.PI * 2) * cfg.idleBob;
        rotZ += Math.sin(this.time * 0.7) * cfg.idleSway * 0.5;
      } else {
        rotZ += Math.sin(this.time * 0.9 + slot.index * 1.7) * cfg.idleSway;
      }

      // Newcomers slide in from their side and grow into place.
      if (slot.spawn > 0) {
        const s = slot.spawn * slot.spawn;
        x += slot.spawnDir * cfg.spawnSlide * s;
        scale *= 1 - cfg.spawnShrink * s;
      }

      // Intro: rise from below, spinning, growing. Centre first.
      if (!this.introDone) {
        const distance = Math.abs(slot.index - this.index);
        const p = staggered(this.intro.p, distance, cfg.introStagger, cfg.introStaggerMax);
        const eased = 1 - Math.pow(1 - p, 3);
        const left = 1 - eased;
        y -= left * cfg.introRise;
        z -= left * cfg.introDepth;
        spin += left * cfg.introSpin * Math.PI * 2;
        scale *= 1 - cfg.introGrow * left;
      }
    }

    slot.group.position.set(x, y, z);
    slot.group.rotation.set(rotX, rotY, rotZ);
    slot.group.scale.setScalar(Math.max(0.0001, scale));
    slot.turntable.rotation.y = spin;
  }

  private updatePointer(event: PointerEvent) {
    const rect = this.scene.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private hitTest(): number {
    const targets = this.pool.pickTargets();
    if (!targets.length) return -1;
    this.raycaster.setFromCamera(this.pointer, this.scene.camera);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? (hit.object.userData.index as number) ?? -1 : -1;
  }

  private setHover(index: number | null) {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.scene.canvas.style.cursor = index === null ? '' : index === this.target ? 'grab' : 'pointer';
    this.callbacks.onHover?.(index);
    this.scene.requestFrames(2);
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.leaving || this.count === 0 || event.button !== 0) return;
    this.updatePointer(event);
    const hit = this.hitTest();
    const pressed = hit >= 0 ? this.pool.get(hit) : undefined;
    if (pressed && !this.reduced) {
      // Press: dent the model away from the cursor and tip it toward where it was touched.
      pressed.pushVZ -= this.cfg.pressDepth * 6;
      pressed.pushVY += this.pointer.x * this.cfg.pressTilt * 2;
      pressed.pushVX -= this.pointer.y * this.cfg.pressTilt * 2;
      this.scene.requestFrames(2);
    }
    this.drag = {
      pointerId: event.pointerId,
      mode: 'pending',
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocityX: 0,
      startIndex: this.index,
      hit,
    };
    this.scene.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    this.updatePointer(event);
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (!this.leaving && event.pointerType === 'mouse') {
        const hit = this.hitTest();
        this.setHover(hit === -1 ? null : hit);
        this.wipe(hit, event);
      }
      this.scene.requestFrames(1);
      return;
    }
    const dx = event.clientX - drag.lastX;
    const now = performance.now();
    const dtMs = Math.max(1, now - drag.lastTime);
    drag.velocityX = drag.velocityX * 0.6 + (dx / dtMs) * 0.4;
    drag.lastX = event.clientX;
    drag.lastTime = now;

    if (drag.mode === 'pending') {
      const travelled = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (travelled < this.cfg.dragStartDistance) return;
      // A horizontal pull on the front model spins it; anything else scrubs the fan.
      drag.mode = drag.hit === this.target && Math.abs(event.clientX - drag.startX) > Math.abs(event.clientY - drag.startY) ? 'spin' : 'scrub';
      if (drag.mode === 'spin') this.scene.canvas.style.cursor = 'grabbing';
      gsap.killTweensOf(this.anim);
      this.setHover(null);
    }

    if (drag.mode === 'spin') {
      const slot = this.pool.get(this.target);
      if (slot) {
        slot.spin += dx * this.cfg.spinSensitivity;
        slot.spinVelocity = clamp(drag.velocityX * this.cfg.spinSensitivity * 1000 * 0.35, -6, 6);
      }
    } else {
      const next = drag.startIndex - (event.clientX - drag.startX) / this.cfg.scrubPixelsPerItem;
      const bounded = clamp(next, -0.35, this.count - 0.65);
      this.velocity = clamp(-drag.velocityX * 14, -12, 12);
      this.index = this.anim.index = bounded;
      const nearest = clamp(Math.round(bounded), 0, this.count - 1);
      if (nearest !== this.target) {
        this.target = nearest;
        this.callbacks.onIndexChange(nearest);
      }
    }
    this.scene.requestFrames(2);
  };

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    try { this.scene.canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    this.scene.canvas.style.cursor = '';

    if (event.type === 'pointercancel') {
      this.go(this.target, 'snap');
      return;
    }
    if (drag.mode === 'pending') {
      if (drag.hit === -1) return;
      if (drag.hit === this.target) this.callbacks.onSelect(this.target);
      else this.go(drag.hit, 'click');
      return;
    }
    if (drag.mode === 'scrub') {
      const flick = -drag.velocityX;
      const carry = Math.abs(flick) > this.cfg.flickVelocity * 1000 ? Math.sign(flick) * Math.min(3, Math.round(Math.abs(flick) * 1.2)) : 0;
      this.go(Math.round(this.index + carry), carry ? 'flick' : 'snap');
      return;
    }
    if (event.pointerType === 'mouse') this.setHover(this.hitTest() === -1 ? null : this.hitTest());
  };

  private onPointerLeave = () => {
    if (!this.drag) this.setHover(null);
  };

  /** A fast cursor sweep across a model knocks it in the direction of travel. */
  private wipe(hit: number, event: PointerEvent) {
    const now = performance.now();
    const last = this.lastPointer;
    const dtMs = now - last.time;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    this.lastPointer = { x: event.clientX, y: event.clientY, time: now };
    if (this.reduced || hit < 0 || dtMs <= 0 || dtMs > 80) return;
    const speed = Math.hypot(dx, dy) / dtMs;
    if (speed < this.cfg.wipeMinSpeed) return;
    const slot = this.pool.get(hit);
    if (!slot) return;
    const max = this.cfg.wipePushMax;
    slot.pushVY += clamp(dx * this.cfg.wipePush * 60, -max, max);
    slot.pushVX += clamp(dy * this.cfg.wipePush * 60, -max, max);
    this.scene.requestFrames(2);
  }

  private onWheel = (event: WheelEvent) => {
    if (this.leaving || this.count < 2) return;
    let dx = event.deltaX;
    let dy = event.deltaY;
    if (event.deltaMode === 1) { dx *= 16; dy *= 16; } else if (event.deltaMode === 2) { dx *= window.innerWidth; dy *= window.innerHeight; }
    // Only sideways scrolling belongs to the shelf. Vertical keeps scrolling the page.
    if (Math.abs(dx) <= Math.abs(dy) * 1.25) return;
    event.preventDefault();
    this.wheelAccumulator += dx;
    const now = performance.now();
    if (Math.abs(this.wheelAccumulator) >= this.cfg.wheelThreshold && now - this.lastWheelStep > this.cfg.wheelCooldownMs) {
      const direction = Math.sign(this.wheelAccumulator);
      this.wheelAccumulator = 0;
      this.lastWheelStep = now;
      this.go(this.target + direction, 'wheel');
    } else if (Math.abs(this.wheelAccumulator) >= this.cfg.wheelThreshold) {
      this.wheelAccumulator = 0;
    }
  };

  private endDrag() {
    if (!this.drag) return;
    try { this.scene.canvas.releasePointerCapture(this.drag.pointerId); } catch { /* already released */ }
    this.drag = null;
    this.scene.canvas.style.cursor = '';
  }
}
