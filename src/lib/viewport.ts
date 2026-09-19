/** Pure pan/zoom math on an SVG viewBox. No DOM access so it is unit-testable. */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zoom by `factor` (>1 zooms in) keeping the point (fx, fy) in 0..1 of the box fixed on screen. */
export function zoomAt(vb: ViewBox, factor: number, fx: number, fy: number, full: ViewBox, maxZoom = 12): ViewBox {
  const minW = full.w / maxZoom;
  const w = clamp(vb.w / factor, minW, full.w);
  const h = w * (vb.h / vb.w);
  return constrain({ x: vb.x + (vb.w - w) * fx, y: vb.y + (vb.h - h) * fy, w, h }, full);
}

/** Pan by a delta expressed in viewBox units. */
export function panBy(vb: ViewBox, dx: number, dy: number, full: ViewBox): ViewBox {
  return constrain({ ...vb, x: vb.x - dx, y: vb.y - dy }, full);
}

/** Keep the view overlapping `full` so users cannot pan into empty space forever. */
export function constrain(vb: ViewBox, full: ViewBox): ViewBox {
  const slackX = vb.w * 0.25;
  const slackY = vb.h * 0.25;
  return {
    ...vb,
    x: clamp(vb.x, full.x - slackX, full.x + full.w - vb.w + slackX),
    y: clamp(vb.y, full.y - slackY, full.y + full.h - vb.h + slackY),
  };
}

/** A viewBox of `width` meters wide centered on (cx, cy), matching the aspect ratio of `like`. */
export function centeredOn(cx: number, cy: number, width: number, like: ViewBox): ViewBox {
  const h = width * (like.h / like.w);
  return { x: cx - width / 2, y: cy - h / 2, w: width, h };
}

/** Fit `full` into a container aspect ratio (w/h) without distortion, centered. */
export function fitAspect(full: ViewBox, aspect: number): ViewBox {
  const fullAspect = full.w / full.h;
  if (fullAspect > aspect) {
    const h = full.w / aspect;
    return { x: full.x, y: full.y - (h - full.h) / 2, w: full.w, h };
  }
  const w = full.h * aspect;
  return { x: full.x - (w - full.w) / 2, y: full.y, w, h: full.h };
}

export const lerpBox = (a: ViewBox, b: ViewBox, t: number): ViewBox => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
