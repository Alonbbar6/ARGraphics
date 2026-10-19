/**
 * Tuning for the 3D model shelf. Starting values come from the A24 disc gallery
 * (a24.raviklaassens.com) and were adjusted for standing objects instead of flat discs:
 * a lower camera and a gentler group tilt so glasses and plates are not seen from above.
 */
export const SHELF_CONFIG = {
  // Fan layout: every position derives from the item's offset from the fractional active index.
  anglePerItem: 0.35,
  hGap: 2.0,
  depthGap: 0.8,
  /** Extra recession per item of distance, so neighbours sit clearly behind the front one. */
  depthPerItem: 0.55,
  activeLift: 0.04,
  groupRotXDeg: -10,
  groupRotYDeg: -24,
  groupScale: 1,
  inactiveScale: 0.74,
  scaleFalloff: 0.6,

  // Camera.
  cameraFov: 34,
  cameraDistance: 4.5,
  cameraY: 1.05,
  lookAtY: 0.26,
  /** Stages narrower than this aspect pull the camera back and look lower, so the fan sits higher, clear of the caption. */
  narrowAspect: 1.5,
  narrowLookAtShift: -0.32,

  // Stepping between items.
  snapDuration: 0.46,
  snapEase: 'power3.out',
  kick: 2.5,
  velocityDecay: 5,
  flowLean: 0.055,
  flowLeanMax: 0.3,
  flowBank: 0.32,
  flowDip: 0.014,
  flowDipMax: 0.09,

  // Pointer.
  hoverTilt: 0.34,
  hoverEase: 10,
  /** A fast cursor sweep across a model knocks it; a press dents it. Springs bring it back. */
  wipeMinSpeed: 0.9,
  wipePush: 0.0016,
  wipePushMax: 0.5,
  pressDepth: 0.35,
  pressTilt: 0.9,
  pushSpring: 14,
  pushDamping: 4.5,
  dragStartDistance: 5,
  scrubPixelsPerItem: 260,
  flickVelocity: 0.0012,
  spinSensitivity: 0.011,
  spinFriction: 0.9,
  wheelThreshold: 28,
  wheelCooldownMs: 320,

  // The active model turns on its own; a drag adds to that and the extra speed bleeds off.
  turntableSpeed: 0.45,

  // Idle life: the front model turns and breathes, the rest sway a touch.
  idleBob: 0.028,
  idleRate: 0.45,
  idleSway: 0.012,

  // Newcomers entering the fan while stepping slide in from the side and grow.
  spawnSlide: 0.9,
  spawnShrink: 0.72,
  spawnRate: 3.2,

  // Intro (the A24 "preload fan": rise from below, spinning, centre first) and
  // "flight" (click the front model to leave the page).
  introDuration: 1.15,
  introStagger: 0.28,
  introStaggerMax: 3,
  introRise: 2.8,
  introDepth: 0.7,
  introSpin: 1.1,
  introGrow: 0.5,
  introPopScale: 0.02,
  introRecede: 1.2,
  flightOutDuration: 0.5,
  flightBoost: 1.45,
  flightRecede: 2.2,
  flightStagger: 0.45,
  flightStaggerMax: 4,
  flightPopScale: 0.35,

  // Loading and rendering.
  renderRadius: 2,
  pixelRatioMax: 2,
  modelHeight: 1,
  /** Wide models are capped here instead of filling the full height, so a tumbler does not dwarf a coupe. */
  modelMaxWidth: 0.62,
  puckRadius: 0.6,
  puckThickness: 0.045,

  // Light.
  exposure: 0.95,
  environmentIntensity: 0.85,
  keyColor: 0xfff4e0,
  keyIntensity: 1.6,
  fillIntensity: 0.5,
  rimColor: 0x9fc4ff,
  rimIntensity: 1.4,
} as const;

export type ShelfConfig = typeof SHELF_CONFIG;
