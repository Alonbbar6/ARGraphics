import { describe, expect, it } from 'vitest';
import {
  batchRanges,
  containRect,
  coverRect,
  frameUrl,
  joinUrl,
  pickFrameSet,
  progressToIndex,
  residentWindow,
  resolveFromManifest,
  type FrameManifest,
} from './frame-sequence';

const manifest: FrameManifest = {
  name: 'hero',
  version: 1,
  poster: 'poster.webp',
  sets: {
    desktop: { dir: 'desktop', count: 120, width: 1920, height: 1080, format: 'webp' },
    mobile: { dir: 'mobile', count: 80, width: 1080, height: 1350, format: 'webp' },
  },
};

describe('pickFrameSet', () => {
  it('uses the desktop set on wide landscape viewports', () => {
    expect(pickFrameSet(manifest, 1440, 900)).toBe(manifest.sets.desktop);
  });
  it('uses the mobile set on narrow or portrait viewports', () => {
    expect(pickFrameSet(manifest, 390, 844)).toBe(manifest.sets.mobile);
    expect(pickFrameSet(manifest, 800, 1200)).toBe(manifest.sets.mobile);
  });
  it('falls back to desktop when there is no mobile set', () => {
    const only: FrameManifest = { ...manifest, sets: { desktop: manifest.sets.desktop } };
    expect(pickFrameSet(only, 390, 844)).toBe(only.sets.desktop);
  });
});

describe('urls', () => {
  it('joins segments without doubled slashes', () => {
    expect(joinUrl('/app/', '/sequences/', 'hero')).toBe('/app/sequences/hero');
    expect(joinUrl('https://cdn.example.com/', 'x')).toBe('https://cdn.example.com/x');
  });
  it('resolves manifest-relative paths and leaves absolute ones alone', () => {
    expect(resolveFromManifest('/sequences/hero/manifest.json', 'poster.webp')).toBe('/sequences/hero/poster.webp');
    expect(resolveFromManifest('/sequences/hero/manifest.json', 'https://cdn/x.webp')).toBe('https://cdn/x.webp');
  });
  it('builds zero-padded frame names', () => {
    expect(frameUrl('/sequences/hero/manifest.json', manifest.sets.desktop, 7)).toBe('/sequences/hero/desktop/0007.webp');
    expect(frameUrl('/s/m.json', { ...manifest.sets.desktop, pad: 3 }, 12)).toBe('/s/desktop/012.webp');
  });
});

describe('progressToIndex', () => {
  it('clamps and rounds', () => {
    expect(progressToIndex(0, 120)).toBe(0);
    expect(progressToIndex(1, 120)).toBe(119);
    expect(progressToIndex(0.5, 120)).toBe(60);
    expect(progressToIndex(-2, 120)).toBe(0);
    expect(progressToIndex(5, 120)).toBe(119);
    expect(progressToIndex(Number.NaN, 120)).toBe(0);
    expect(progressToIndex(0.5, 0)).toBe(0);
  });
});

describe('batchRanges', () => {
  it('puts a small priority batch first, then fixed batches', () => {
    expect(batchRanges(75)).toEqual([
      [0, 10],
      [10, 40],
      [40, 70],
      [70, 75],
    ]);
  });
  it('handles tiny and empty sets', () => {
    expect(batchRanges(4)).toEqual([[0, 4]]);
    expect(batchRanges(0)).toEqual([]);
  });
});

describe('rects', () => {
  it('cover fills the destination and centres the overflow', () => {
    const r = coverRect(1920, 1080, 960, 960);
    expect(r.dx).toBeCloseTo(-373.333, 2);
    expect(r.dy).toBe(0);
    expect(r.dw).toBeCloseTo(1706.667, 2);
    expect(r.dh).toBe(960);
    expect(coverRect(1920, 1080, 1920, 540)).toEqual({ dx: 0, dy: -270, dw: 1920, dh: 1080 });
  });
  it('cover honours a vertical focus point', () => {
    expect(coverRect(1920, 1080, 1920, 540, 0).dy).toBe(0);
    expect(coverRect(1920, 1080, 1920, 540, 1).dy).toBe(-540);
  });
  it('contain fits the whole image', () => {
    expect(containRect(1920, 1080, 960, 960)).toEqual({ dx: 0, dy: 210, dw: 960, dh: 540 });
  });
  it('returns an empty rect for bad sizes', () => {
    expect(coverRect(0, 0, 10, 10)).toEqual({ dx: 0, dy: 0, dw: 0, dh: 0 });
  });
});

describe('residentWindow', () => {
  it('keeps everything when it fits', () => {
    expect(residentWindow(50, 120, 200)).toEqual([0, 120]);
  });
  it('centres a window and clamps at both ends', () => {
    expect(residentWindow(60, 120, 40)).toEqual([40, 80]);
    expect(residentWindow(3, 120, 40)).toEqual([0, 40]);
    expect(residentWindow(118, 120, 40)).toEqual([80, 120]);
  });
});
