// A camera that knows the world is bigger than the window.
//
// Rout's camera clamps against the viewport size, because in Rout the field IS
// the viewport — 960x420, always fully visible, and zoom is a luxury. Dominion's
// map is 2048x1536 and the point of it is that you cannot see it all at once, so
// panning has to be a first-class thing and the bounds have to come from the
// world rather than the window. Kept separate rather than generalising Rout's,
// because Warden is finished and does not need the risk.

/**
 * How far out you may zoom, and it CANNOT BE A CONSTANT.
 *
 * It was 0.4, with a comment claiming that was far enough to take in the whole
 * map. That was true of the first two maps and quietly stopped being true as
 * soon as a bigger one existed: measured on Kingsmoor you could see 58% of the
 * map's height at full zoom-out, and on Three Crowns 50%. The player reported it
 * as "I could not pan across the largest map" — panning was fine, there was
 * simply no view from which the map made sense.
 *
 * So the floor is derived from the world. `0.4` survives only as the limit for
 * maps small enough not to need anything looser.
 */
export const MAX_ZOOM = 2.4;
const NEAR_ZOOM = 0.4;

/** Zoom at which the whole world fits the window, with a little air around it. */
function fitZoom(viewW, viewH, worldW, worldH) {
  return Math.min(viewW / worldW, viewH / worldH) * 0.94;
}

export function createCamera(viewW, viewH, worldW, worldH) {
  const cam = {
    // Opens at 1.35 rather than 1. The maps grew from 64x48 to 280x160 over the
    // course of development and the starting zoom never moved with them, so a
    // new match opened looking at a wide expanse of empty ground with the
    // player's own hall as one small object in it. You can always pull out — Z
    // shows the whole map — but the first thing you see should be your own
    // people, close enough to read.
    x: 0, y: 0, zoom: 1.35, viewW, viewH, worldW, worldH,
    minZoom: Math.min(NEAR_ZOOM, fitZoom(viewW, viewH, worldW, worldH)),
  };
  clampToWorld(cam);
  return cam;
}

/** The zoom that shows everything. What the "whole map" key should give you. */
export function wholeMapZoom(cam) {
  return cam.minZoom;
}

export function applyCamera(ctx, cam) {
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
}

export function clearCamera(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function screenToWorld(cam, sx, sy) {
  return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
}

export function worldToScreen(cam, wx, wy) {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

export function zoomAt(cam, sx, sy, factor) {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom = clamp(cam.zoom * factor, cam.minZoom, MAX_ZOOM);
  const after = screenToWorld(cam, sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  clampToWorld(cam);
}

export function panBy(cam, dxScreen, dyScreen) {
  cam.x -= dxScreen / cam.zoom;
  cam.y -= dyScreen / cam.zoom;
  clampToWorld(cam);
}

/** Put a world point in the middle of the window — used to jump to your manor. */
export function centreOn(cam, wx, wy) {
  cam.x = wx - cam.viewW / cam.zoom / 2;
  cam.y = wy - cam.viewH / cam.zoom / 2;
  clampToWorld(cam);
}

function clampToWorld(cam) {
  const visibleW = cam.viewW / cam.zoom;
  const visibleH = cam.viewH / cam.zoom;

  // When you are zoomed out far enough to see past the edge of the world,
  // centre it rather than letting it drift into a corner.
  if (visibleW >= cam.worldW) cam.x = (cam.worldW - visibleW) / 2;
  else cam.x = clamp(cam.x, 0, cam.worldW - visibleW);

  if (visibleH >= cam.worldH) cam.y = (cam.worldH - visibleH) / 2;
  else cam.y = clamp(cam.y, 0, cam.worldH - visibleH);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
