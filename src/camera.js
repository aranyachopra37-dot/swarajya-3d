// The camera: zoom and pan over the battlefield.
//
// ON ROTATION, since it was asked for. Zoom and pan are cheap and work
// perfectly. Free rotation, the way Warrior Kings does it, does NOT work here —
// not because of effort, but because of what our art is. Every sprite is painted
// from one fixed angle. Rotate the world and a soldier painted from the front
// slides sideways while still facing you: it breaks instantly and obviously.
//
// Three ways to get real rotation, none of them free:
//   1. True 3D (Three.js + models) — rotation comes for free, but sprites are
//      replaced by models, and generated 3D is far weaker than generated 2D.
//   2. Multi-angle sprites — draw each subject at 8 or 16 headings and swap by
//      camera angle. That is 12 assets x 8 = ~96 images, and staying consistent
//      across angles is precisely what generative models are worst at.
//   3. Billboarding — rotate only the ground and road, keep every sprite upright
//      and facing the viewer. Standard 2.5D, looks fine, and is the pragmatic
//      route if we want it. Placement and hit-testing get more complex.
//
// Worth knowing: in Warrior Kings, rotation was tactical because terrain and
// elevation mattered. Rout is flat, so rotation would be pure spectacle. Zoom
// and pan deliver most of the practical value for a fraction of the work, so
// that is what this does today.

export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 3.2;

export function createCamera(width, height) {
  return { x: 0, y: 0, zoom: 1, width, height };
}

/** Apply the camera to a context. Everything drawn after this is in world space. */
export function applyCamera(ctx, cam) {
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
}

/** Drop back to screen space, for the interface. */
export function clearCamera(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function screenToWorld(cam, sx, sy) {
  return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
}

/**
 * Zoom toward a screen point, so the thing under the cursor stays under it.
 * Zooming toward the centre instead feels like the map is sliding away.
 */
export function zoomAt(cam, sx, sy, factor) {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const after = screenToWorld(cam, sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  clampToField(cam);
}

export function panBy(cam, dxScreen, dyScreen) {
  cam.x -= dxScreen / cam.zoom;
  cam.y -= dyScreen / cam.zoom;
  clampToField(cam);
}

export function resetCamera(cam) {
  cam.x = 0;
  cam.y = 0;
  cam.zoom = 1;
}

/** Keep the field on screen — you should never be able to pan into the void. */
function clampToField(cam) {
  const visibleW = cam.width / cam.zoom;
  const visibleH = cam.height / cam.zoom;

  if (visibleW >= cam.width) cam.x = (cam.width - visibleW) / 2;
  else cam.x = clamp(cam.x, 0, cam.width - visibleW);

  if (visibleH >= cam.height) cam.y = (cam.height - visibleH) / 2;
  else cam.y = clamp(cam.y, 0, cam.height - visibleH);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
