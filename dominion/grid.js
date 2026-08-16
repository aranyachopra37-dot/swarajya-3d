// The board Dominion is played on, and the pathfinding over it.
//
// This file exists to answer the one question the vertical slice was built to
// answer: can this engine do deterministic 2D navigation? Rout's units track a
// single number — how far along a fixed road they have walked — and every rule
// downstream leans on that. An army that goes where it likes cannot.
//
// The answer here is a FLOW FIELD rather than a path per unit, and that choice
// falls straight out of the design: troops head for the enemy manor unless told
// otherwise, so hundreds of units share a handful of destinations. Computing one
// field per destination and letting everyone read it is both far cheaper than
// per-unit A* and much easier to keep deterministic — there is no per-unit state
// to diverge, only a shared integer array.
//
// DETERMINISM RULES, which matter more here than anywhere else in the project
// because two different browsers will one day have to agree tick for tick:
//
//   * Integer costs only. Distances are Int32, never floats.
//   * Ties broken by tile index, always, so the queue order is total.
//   * No Math.hypot anywhere in the simulation. It is not specified to be
//     correctly rounded and two engines may disagree in the last bit;
//     Math.sqrt IS specified. Rout uses hypot throughout and gets away with it
//     because both sides of its verification run V8 — Dominion will not have
//     that luxury.

export const TILE = 32;

// Eight-way movement. Diagonals cost 14 against an orthogonal 10, which is
// 1.4 — close enough to root two for integer work and the standard choice.
export const ORTHO_COST = 10;
export const DIAG_COST = 14;

const UNREACHABLE = 0x7fffffff;

/**
 * What it costs a field to route through something you would have to break.
 *
 * 40 tiles of open ground. High enough that an army always prefers a real gap —
 * a gate, a ford, the long way round — and low enough that it will go THROUGH a
 * wall rather than give up when the long way round is longer than that. It also
 * makes the field prefer the thinnest part of a wall, which is the right
 * instinct and costs nothing to get.
 */
const SOFT_COST = 400;

const NEIGHBOURS = [
  [1, 0, ORTHO_COST], [-1, 0, ORTHO_COST], [0, 1, ORTHO_COST], [0, -1, ORTHO_COST],
  [1, 1, DIAG_COST], [1, -1, DIAG_COST], [-1, 1, DIAG_COST], [-1, -1, DIAG_COST],
];

// --- Terrain -----------------------------------------------------------------
//
// The slice had two kinds of tile: open and not. Warrior Kings maps are made of
// ground that is passable but *expensive* — you can march through a wood, it
// just costs you — and that is what makes a map a decision rather than a shape.
//
// The cost column is the load-bearing part and it must stay INTEGER. The flow
// field is Dijkstra over these numbers, two browsers have to agree on it tile
// for tile, and a float cost is the shortest road to a desync. 10 is one tile of
// open ground, so a wood at 22 is "a bit over twice as slow" and reads that way
// on screen.
export const GROUND = 0;   // open
export const ROCK = 1;     // blocked
export const BUILDING = 2; // blocked, and remembers what was under it
export const WATER = 3;    // blocked
export const FOREST = 4;   // passable, slow, cannot build
export const HILL = 5;     // passable, slow, CAN build — high ground is worth taking
export const GOLD = 6;     // passable, cannot build, peasants mine it

export const TERRAIN = {
  [GROUND]: { id: "ground", name: "Open ground", cost: 10, walk: true, build: true },
  [ROCK]: { id: "rock", name: "Rock", cost: 0, walk: false, build: false },
  [BUILDING]: { id: "building", name: "Building", cost: 0, walk: false, build: false },
  [WATER]: { id: "water", name: "Water", cost: 0, walk: false, build: false },
  [FOREST]: { id: "forest", name: "Wood", cost: 22, walk: true, build: false },
  [HILL]: { id: "hill", name: "High ground", cost: 15, walk: true, build: true },
  [GOLD]: { id: "gold", name: "Gold seam", cost: 10, walk: true, build: false },
};

/** Cost of ENTERING this tile, orthogonally. Diagonals scale it by 14/10. */
export const moveCost = (grid, tx, ty) => TERRAIN[grid.cells[idx(grid, tx, ty)]].cost;

/**
 * How fast something actually moves on this tile, as a fraction of its speed.
 *
 * This has to exist or the pathfinding is a liar: the flow field routes around a
 * wood because a wood is expensive, but if units then cross it at full speed the
 * detour is pure loss and the terrain may as well be paint. Derived from the
 * same cost column so the two can never disagree.
 *
 * Float, unlike the field — but only +-*\/ , which IEEE 754 specifies exactly,
 * so two engines agree. The rule that matters is no transcendentals.
 */
export function speedFactor(grid, tx, ty) {
  if (!inBounds(grid, tx, ty)) return 1;
  const cost = TERRAIN[grid.cells[idx(grid, tx, ty)]].cost;
  return cost > 0 ? ORTHO_COST / cost : 1;
}

export function createGrid(w, h) {
  return {
    w,
    h,
    // One byte per tile, holding a terrain constant from the table above.
    // Bytes rather than booleans so a building can be removed without forgetting
    // what the ground under it was — see `groundUnder` in sim.js.
    cells: new Uint8Array(w * h),
    worldW: w * TILE,
    worldH: h * TILE,
  };
}

export const idx = (grid, tx, ty) => ty * grid.w + tx;
export const inBounds = (grid, tx, ty) =>
  tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h;

/** Can something walk here? */
export const passable = (grid, tx, ty) =>
  inBounds(grid, tx, ty) && TERRAIN[grid.cells[idx(grid, tx, ty)]].walk;

/**
 * Can a foundation be laid here?
 *
 * Deliberately narrower than `passable`. A wood is walkable and a gold seam is
 * walkable, but building on either would let a player wall off the one resource
 * on the map by dropping a warehouse on top of it.
 */
export const buildable = (grid, tx, ty) =>
  inBounds(grid, tx, ty) && TERRAIN[grid.cells[idx(grid, tx, ty)]].build;

/** World position -> tile. Floor, so tile 0 covers x in [0, TILE). */
export const toTile = (v) => Math.floor(v / TILE);
/** Tile -> the world position of its centre. */
export const tileCentre = (t) => t * TILE + TILE / 2;

/**
 * A minimal binary heap keyed on (cost, tile).
 *
 * Written out rather than reached for because the tie-break is load-bearing:
 * two tiles with equal cost must always come out in the same order or two
 * clients computing the same field could disagree about which way a unit turns.
 * Tile index is unique, so (cost, index) is a total order.
 */
function makeHeap() {
  const cost = [];
  const tile = [];

  const less = (a, b) =>
    cost[a] !== cost[b] ? cost[a] < cost[b] : tile[a] < tile[b];

  return {
    get size() {
      return cost.length;
    },
    push(c, t) {
      cost.push(c);
      tile.push(t);
      let i = cost.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!less(i, parent)) break;
        [cost[i], cost[parent]] = [cost[parent], cost[i]];
        [tile[i], tile[parent]] = [tile[parent], tile[i]];
        i = parent;
      }
    },
    pop() {
      const topCost = cost[0];
      const topTile = tile[0];
      const lastCost = cost.pop();
      const lastTile = tile.pop();

      if (cost.length > 0) {
        cost[0] = lastCost;
        tile[0] = lastTile;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let small = i;
          if (l < cost.length && less(l, small)) small = l;
          if (r < cost.length && less(r, small)) small = r;
          if (small === i) break;
          [cost[i], cost[small]] = [cost[small], cost[i]];
          [tile[i], tile[small]] = [tile[small], tile[i]];
          i = small;
        }
      }

      return { cost: topCost, tile: topTile };
    },
  };
}

/**
 * Integer distance from every reachable tile to the nearest goal.
 *
 * Dijkstra outward FROM the goals, which is what makes one pass serve every
 * unit: a unit reads its own tile and walks downhill. Recompute only when the
 * goals or the obstacles change, not per tick and never per unit.
 */
/**
 * @param {Set<number>} [soft] tile indices that are blocked, but which the field
 *   may route THROUGH at a heavy cost. See the note in sim.js on siege fields.
 */
export function flowField(grid, goals, soft = null) {
  const n = grid.w * grid.h;
  const dist = new Int32Array(n).fill(UNREACHABLE);
  const heap = makeHeap();

  for (const [tx, ty] of goals) {
    if (!inBounds(grid, tx, ty)) continue;
    const at = idx(grid, tx, ty);
    // Goals themselves are seeded even when blocked — a manor occupies its own
    // tiles, and units must still be able to path AT it in order to hit it.
    if (dist[at] !== 0) {
      dist[at] = 0;
      heap.push(0, at);
    }
  }

  while (heap.size > 0) {
    const { cost, tile } = heap.pop();
    if (cost > dist[tile]) continue; // a stale entry, already improved on

    const tx = tile % grid.w;
    const ty = (tile - tx) / grid.w;

    for (const [dx, dy, step] of NEIGHBOURS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!inBounds(grid, nx, ny)) continue;

      const soften = soft && soft.has(idx(grid, nx, ny));
      if (!passable(grid, nx, ny) && !soften) continue;

      // No cutting corners diagonally past a blocked tile: without this, units
      // slide through the diagonal gap between two buildings, which looks like
      // a bug and makes walls useless. A soft tile is still a wall for this
      // purpose — you may knock it down, you may not slip past its corner.
      if (dx !== 0 && dy !== 0) {
        if (!passable(grid, tx + dx, ty) || !passable(grid, tx, ty + dy)) continue;
      }

      // Terrain cost, scaled for diagonals. `step` is 10 or 14 and the tile's
      // own cost is in the same units, so (cost * step) / 10 keeps everything in
      // integers — the division is exact because every cost in the table is a
      // whole number and 14/10 of it is rounded DOWN identically on any engine.
      // A float here would be the shortest road to a desync.
      //
      // A soft tile costs what it costs to knock a hole in it. Integer, like
      // everything else here.
      const enter = soften
        ? (SOFT_COST * step) / ORTHO_COST | 0
        : (moveCost(grid, nx, ny) * step) / ORTHO_COST | 0;

      const next = idx(grid, nx, ny);
      const through = cost + enter;
      if (through < dist[next]) {
        dist[next] = through;
        heap.push(through, next);
      }
    }
  }

  return dist;
}

/**
 * Which way should something standing on this tile go?
 * Returns a unit vector, or null when it is already at a goal or walled in.
 */
export function steer(grid, dist, tx, ty, soft = null) {
  if (!inBounds(grid, tx, ty)) return null;
  const here = dist[idx(grid, tx, ty)];
  if (here === 0) return null;

  // TWO passes, and the reason is fairness rather than tidiness.
  //
  // The obvious single pass keeps the first strictly-better neighbour it finds,
  // so when several are equally good the winner is whichever comes first in
  // NEIGHBOURS — east, then west, then south, then north. That is deterministic,
  // which lockstep needs, but it is not MIRRORED: flip the map and "prefer east"
  // does not become "prefer west", so two players in mirrored positions walk
  // subtly different routes and one of them is systematically better. It is the
  // same shape as the three scan-order bugs already documented in this project.
  //
  // Averaging every equally-good direction has no such preference. If east and
  // north-east are tied the unit heads east-north-east; mirrored, west and
  // north-west tie and it heads west-north-west, which is exactly the reflection.
  // It also happens to look better — units round corners instead of stepping
  // around them.
  // A unit may only STEP onto ground it can actually stand on. The field may
  // have routed through a wall; walking into it is what puts the wall in weapon
  // range, and the fight does the rest.
  const canStep = (nx, ny) => passable(grid, nx, ny);

  let best = here;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inBounds(grid, nx, ny) || !canStep(nx, ny)) continue;
    if (dx !== 0 && dy !== 0) {
      if (!passable(grid, tx + dx, ty) || !passable(grid, tx, ty + dy)) continue;
    }
    // Strictly less, so equal-cost neighbours never cause a unit to dither
    // between two tiles for ever.
    const there = dist[idx(grid, nx, ny)];
    if (there < best) best = there;
  }
  if (best === here) return null;

  let bx = 0;
  let by = 0;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inBounds(grid, nx, ny) || !canStep(nx, ny)) continue;
    if (dx !== 0 && dy !== 0) {
      if (!passable(grid, tx + dx, ty) || !passable(grid, tx, ty + dy)) continue;
    }
    if (dist[idx(grid, nx, ny)] !== best) continue;
    // Diagonals are longer, so they must be normalised before being summed or a
    // tie between an orthogonal and a diagonal leans towards the diagonal.
    const len = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
    bx += dx * len;
    by += dy * len;
  }

  if (bx === 0 && by === 0) return null;
  // Math.sqrt, never Math.hypot — see the determinism note at the top.
  const len = Math.sqrt(bx * bx + by * by);
  return { x: bx / len, y: by / len };
}

export const isReachable = (dist, grid, tx, ty) =>
  inBounds(grid, tx, ty) && dist[idx(grid, tx, ty)] !== UNREACHABLE;

export { UNREACHABLE };
