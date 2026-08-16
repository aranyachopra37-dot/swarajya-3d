// Maps — and the geometry for walking along one.
//
// Until now the enemy walked in a straight line at a fixed height, so a
// regiment's position was just a number. A real map needs a *path*: a chain of
// points the army follows. Everything else works the same way — a regiment
// still only tracks how far along it has walked, which keeps the simulation
// simple and, more importantly, keeps it deterministic.

export const ROAD_HALF = 30; // how wide the road is; you cannot build on it

// --- Terrain -----------------------------------------------------------------
//
// Ground is not uniform. Water and mountain each admit buildings that nothing
// else can use, and refuse everything else — so a map's terrain decides which
// creeds are even available to you, before you have made a single choice.
//
// A tower declares the terrain it needs via `spec.terrain`:
//   null        plain ground only (most buildings)
//   "water"     only in water — ships
//   "mountain"  only on high ground — scouts and marksmen
//
// Shapes are circles and rectangles rather than polygons, because they are
// trivial to test against and trivial to draw, and the placement rule has to be
// cheap: it runs for every candidate spot the balance bot considers.

export const TERRAIN = {
  water: { id: "water", name: "Water", colour: "#2b4a5e", edge: "#38607a" },
  mountain: { id: "mountain", name: "High ground", colour: "#3d3a44", edge: "#544f5c" },
  forest: { id: "forest", name: "Forest", colour: "#26362a", edge: "#334736" },
};

const circle = (kind, x, y, r) => ({ kind, x, y, r });
const rect = (kind, x, y, w, h) => ({ kind, x, y, w, h });

/** Which terrain covers this point, or null for plain ground. */
export function terrainAt(map, x, y) {
  for (const zone of map.terrain ?? []) {
    if (zone.r !== undefined) {
      if (Math.hypot(x - zone.x, y - zone.y) <= zone.r) return zone.kind;
    } else if (
      x >= zone.x && x <= zone.x + zone.w &&
      y >= zone.y && y <= zone.y + zone.h
    ) {
      return zone.kind;
    }
  }
  return null;
}

export const MAPS = {
  longRoad: {
    id: "longRoad",
    name: "The Long Road",
    blurb: "Open ground and no cover. Whatever you build, you will need it early.",
    gateHealth: 200,
    path: [
      { x: -40, y: 250 },
      { x: 900, y: 250 },
    ],
  },

  fenCrossing: {
    id: "fenCrossing",
    name: "The Fen Crossing",
    blurb: "The road bends twice around the marsh. Slow ground, and time to work.",
    gateHealth: 200,
    path: [
      { x: -40, y: 120 },
      { x: 240, y: 120 },
      { x: 360, y: 300 },
      { x: 620, y: 300 },
      { x: 740, y: 140 },
      { x: 910, y: 140 },
    ],
  },

  hairpin: {
    id: "hairpin",
    name: "The Hairpin",
    blurb:
      "The road doubles back on itself. A tower set in the crook covers both legs at once — if you can afford the crook.",
    gateHealth: 200,
    path: [
      { x: -40, y: 90 },
      { x: 700, y: 90 },
      { x: 800, y: 210 },
      { x: 180, y: 210 },
      { x: 100, y: 340 },
      { x: 910, y: 340 },
    ],
  },

  // --- Terrain maps ----------------------------------------------------------
  // Each of these makes at least one terrain-locked building essential, so the
  // map decides part of your answer before you do.

  drownedCauseway: {
    id: "drownedCauseway",
    name: "The Drowned Causeway",
    blurb:
      "A raised road through open water. Almost nowhere to stand — but the water is yours if you can float something on it.",
    gateHealth: 200,
    path: [
      { x: -40, y: 210 },
      { x: 300, y: 210 },
      { x: 420, y: 300 },
      { x: 700, y: 300 },
      { x: 800, y: 190 },
      { x: 910, y: 190 },
    ],
    terrain: [
      rect("water", 0, 0, 960, 150),
      rect("water", 0, 360, 960, 60),
      circle("water", 180, 320, 70),
      circle("water", 600, 130, 80),
    ],
  },

  cragPass: {
    id: "cragPass",
    name: "Crag Pass",
    blurb:
      "The road threads between two ridges. Nothing shoots far from down here — but a marksman on the crag sees the whole pass.",
    gateHealth: 200,
    path: [
      { x: -40, y: 230 },
      { x: 250, y: 230 },
      { x: 330, y: 130 },
      { x: 620, y: 130 },
      { x: 700, y: 250 },
      { x: 910, y: 250 },
    ],
    terrain: [
      rect("mountain", 0, 300, 420, 120),
      rect("mountain", 520, 320, 440, 100),
      circle("mountain", 470, 40, 90),
      rect("forest", 120, 20, 200, 70),
    ],
  },

  saltMarsh: {
    id: "saltMarsh",
    name: "The Salt Marsh",
    blurb:
      "Water on one side, high ground on the other, and a road that will not commit to either.",
    gateHealth: 200,
    path: [
      { x: -40, y: 130 },
      { x: 220, y: 130 },
      { x: 320, y: 260 },
      { x: 560, y: 260 },
      { x: 660, y: 140 },
      { x: 910, y: 140 },
    ],
    terrain: [
      rect("water", 0, 330, 960, 90),
      circle("water", 430, 60, 75),
      rect("mountain", 700, 210, 260, 90),
      circle("mountain", 120, 250, 60),
      rect("forest", 500, 330, 200, 60),
    ],
  },

  theSpine: {
    id: "theSpine",
    name: "The Spine",
    blurb:
      "Four legs of road down a mountain's back. Everything here is either too high to build on or too wet — choose your ground early.",
    gateHealth: 240,
    path: [
      { x: -40, y: 70 },
      { x: 760, y: 70 },
      { x: 850, y: 175 },
      { x: 140, y: 175 },
      { x: 60, y: 285 },
      { x: 830, y: 285 },
      { x: 900, y: 380 },
      { x: 960, y: 380 },
    ],
    terrain: [
      rect("mountain", 0, 0, 960, 40),
      rect("mountain", 0, 210, 200, 50),
      rect("mountain", 620, 210, 340, 50),
      rect("water", 0, 330, 620, 90),
      circle("mountain", 400, 130, 45),
    ],
  },
};

export const MAP_IDS = [
  "longRoad",
  "fenCrossing",
  "hairpin",
  "drownedCauseway",
  "cragPass",
  "saltMarsh",
  "theSpine",
];

// --- Geometry ----------------------------------------------------------------

/** Total length of a path, in pixels. */
export function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/**
 * Where are you, having walked `distance` along the path?
 * Also returns the direction of travel, so things can face the right way.
 */
export function pointAt(path, distance) {
  let remaining = Math.max(0, distance);

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);

    if (remaining <= segment) {
      const t = segment === 0 ? 0 : remaining / segment;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        dx: segment === 0 ? 1 : (b.x - a.x) / segment,
        dy: segment === 0 ? 0 : (b.y - a.y) / segment,
      };
    }
    remaining -= segment;
  }

  const last = path[path.length - 1];
  const prev = path[path.length - 2] ?? last;
  const segment = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  return {
    x: last.x,
    y: last.y,
    dx: (last.x - prev.x) / segment,
    dy: (last.y - prev.y) / segment,
  };
}

/**
 * The point on the road nearest to (x, y), as a distance ALONG the road.
 *
 * Regiments only ever track how far they have walked, so anything that wants to
 * interact with them where they are — a trap lying on the road — is far simpler
 * to express in the same coordinate. A charge at `along` catches a regiment when
 * their two distances are close, which needs no geometry at all at match time
 * and stays exact regardless of how the road bends.
 */
export function nearestOnPath(path, x, y) {
  let best = { distance: Infinity, along: 0 };
  let travelled = 0;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const segment = Math.hypot(vx, vy);
    const lengthSquared = vx * vx + vy * vy;

    let t = lengthSquared === 0 ? 0 : ((x - a.x) * vx + (y - a.y) * vy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const distance = Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t));
    if (distance < best.distance) best = { distance, along: travelled + segment * t };

    travelled += segment;
  }

  return best;
}

/** Shortest distance from a point to the road. Used to keep towers off it. */
export function distanceToPath(path, x, y) {
  let best = Infinity;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lengthSquared = vx * vx + vy * vy;

    let t = lengthSquared === 0 ? 0 : ((x - a.x) * vx + (y - a.y) * vy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const distance = Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t));
    if (distance < best) best = distance;
  }

  return best;
}
