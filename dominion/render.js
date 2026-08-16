// Dominion's renderer. The only file here that touches a pixel.
//
// Everything is drawn from primitives rather than sprites, deliberately: this is
// a vertical slice and its job is to prove the loop, so a unit is a shape with a
// health bar and that is enough to tell whether the pathfinding works. Art comes
// after the design is worth drawing.

import {
  TILE, toTile, idx, GROUND, ROCK, BUILDING as BUILDING_CELL, WATER, FOREST,
  HILL, GOLD, TERRAIN,
} from "./grid.js";
import { applyCamera, clearCamera, worldToScreen } from "./camera.js";
import { BUILDINGS } from "./sim.js";
// Art is optional everywhere below: every sprite has a primitive fallback, so
// a missing or still-loading PNG makes the game plainer, never broken.
import { sprites, loadSprites } from "../src/assets.js";

loadSprites();

/** Which painted figure stands in for each unit, if it has loaded. */
const UNIT_ART = {
  peasant: "dom_peasant",
  spearman: "dom_spearman",
  archer: "dom_archer",
  warRider: "dom_warRider",
  huntress: "dom_huntress",
  cart: "dom_cart",
  sapper: "dom_sapper",
  catapult: "dom_catapult",
  mangonel: "dom_mangonel",
  ram: "dom_ram",
  dragon: "dom_dragon",
  behemoth: "dom_behemoth",
  witch: "dom_witch",
};

// The palette. Kept warm and low-contrast on purpose: the units and the
// buildings are the brightest things on the map, and terrain that competes with
// them for attention is terrain that makes a battle harder to read.
const C = {
  ground: "#2a2a24",
  groundLight: "rgba(255, 246, 214, 0.022)",
  groundDark: "rgba(0, 0, 0, 0.05)",
  grid: "rgba(255,255,255,0.035)",

  rock: "#3b3f4a",
  rockLit: "#4d5361",
  rockDark: "#2b2f38",

  water: "#224257",
  waterDeep: "#17303f",
  waterLine: "#4d7f9c",
  shore: "#6b6551",          // the bank; the single most valuable line here

  forestFloor: "#1c2a1e",
  forestShadow: "rgba(0,0,0,0.4)",
  forestMid: "#2f4a2c",
  forestTop: "#3d5e36",

  hill: "#33342a",
  hillEdge: "#565a41",       // the contour along the top of a rise
  hillFoot: "#26271f",
  hillScrub: "#454832",

  wall: "#6f7178",
  wallCap: "#8d9099",
  wallHurt: "#5b5257",

  seam: "#3a3320",
  seamGlint: "#d9b153",
  seamDull: "#8c7132",

  shadow: "rgba(0,0,0,0.35)",
  select: "#7fd48f",
  range: "rgba(127, 212, 143, 0.5)",
  hostile: "#d47f7f",
  site: "#5f677c",
};

export function draw(ctx, sim, view) {
  const { cam, selection, dragBox, ghost, pointer } = view;

  clearCamera(ctx);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  applyCamera(ctx, cam);

  drawTerrain(ctx, sim, cam);
  drawSites(ctx, sim);
  drawBuildings(ctx, sim, selection);
  drawPlans(ctx, sim, selection);
  drawUnits(ctx, sim, selection);
  drawProjectiles(ctx, sim);
  if (ghost) drawGhost(ctx, sim, ghost);

  clearCamera(ctx);
  if (dragBox) drawDragBox(ctx, dragBox);
  drawMinimap(ctx, sim, cam);
}

/** Only the tiles actually on screen — the map is far bigger than the window. */
function visibleTiles(cam) {
  return {
    x0: Math.max(0, toTile(cam.x) - 1),
    y0: Math.max(0, toTile(cam.y) - 1),
    x1: toTile(cam.x + cam.viewW / cam.zoom) + 1,
    y1: toTile(cam.y + cam.viewH / cam.zoom) + 1,
  };
}

/** Pixels one repeat of the ground texture covers. Two and a bit tiles. */
const GROUND_TEX_SCALE = 72;

let groundPattern = null;

/**
 * Below this zoom a tile is a handful of pixels and every flourish on it is
 * invisible. Measured on a 176x120 map: the detailed path took 98 ms a frame at
 * whole-map zoom — ten frames a second — because it was faithfully drawing
 * mottle, rock facets, hill scrub and shore lines onto squares five pixels
 * across. The far view draws flat colour and nothing else.
 */
const DETAIL_ZOOM = 0.45;

/** Terrain kind -> its flat colour, for the far view. */
const FLAT = {
  [GROUND]: C.ground, [ROCK]: C.rock, [WATER]: C.water,
  [FOREST]: C.forestMid, [HILL]: C.hill, [GOLD]: C.seam,
  [BUILDING_CELL]: C.ground,
};

/**
 * The whole map at once, cheaply.
 *
 * One pass over the visible tiles collecting rectangles per terrain kind, then
 * ONE fill per kind. The saving is not really the missing decoration — it is
 * that `fillStyle` changes thousands of times a frame in the detailed path, and
 * here it changes six times.
 */
function drawTerrainFar(ctx, grid, v, x1, y1) {
  const runs = new Map();
  for (let ty = v.y0; ty <= y1; ty++) {
    let runStart = -1;
    let runCell = -1;
    for (let tx = v.x0; tx <= x1 + 1; tx++) {
      const cell = tx > x1 ? -1 : grid.cells[idx(grid, tx, ty)];
      if (cell === runCell) continue;
      // Horizontal runs of one terrain become a single rectangle, which on a
      // map made of large regions is a big reduction in draw calls again.
      if (runCell !== -1 && runStart !== -1) {
        let list = runs.get(runCell);
        if (!list) runs.set(runCell, (list = []));
        list.push(runStart * TILE, ty * TILE, (tx - runStart) * TILE, TILE);
      }
      runStart = tx;
      runCell = cell;
    }
  }
  for (const [cell, list] of runs) {
    ctx.fillStyle = FLAT[cell] ?? C.ground;
    for (let i = 0; i < list.length; i += 4) {
      ctx.fillRect(list[i], list[i + 1], list[i + 2], list[i + 3]);
    }
  }
}

function drawTerrain(ctx, sim, cam) {
  const { grid } = sim;
  const v = visibleTiles(cam);
  const x1 = Math.min(grid.w - 1, v.x1);
  const y1 = Math.min(grid.h - 1, v.y1);

  if (cam.zoom < DETAIL_ZOOM) {
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, 0, grid.worldW, grid.worldH);
    return drawTerrainFar(ctx, grid, v, x1, y1);
  }

  // GROUND IS DRAWN, NOT PHOTOGRAPHED.
  //
  // This used to be a tiled photographic texture at low opacity. On a map this
  // wide it repeated about a dozen times across the screen and read
  // unmistakably as wallpaper — hard diagonal streaks marching across open
  // country. Shrinking it and fading it only made it a smaller, fainter
  // wallpaper, and once everything ELSE on the map became procedural it was the
  // one thing that did not belong.
  //
  // A flat base with a little per-tile mottle costs nothing, never repeats in a
  // way the eye can catch, and sits underneath the canopy and the shores
  // without fighting them.
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, grid.worldW, grid.worldH);

  // TWO PASSES, BECAUSE EDGES ARE WHAT MAKE GROUND LOOK LIKE GROUND.
  //
  // One pass of per-tile fills gives you a mosaic: every wood is a hard-edged
  // square of green, every shore is a staircase, and the map reads as a
  // spreadsheet with colours. What sells terrain is what happens BETWEEN two
  // kinds of ground — a bank where the water meets the land, canopy that spills
  // past its own tile, a contour along the top of a rise.
  //
  // So the body of each terrain is laid down first, and then a second pass draws
  // only the boundaries, looking at each tile's neighbours. It stays cheap
  // (nothing here is per-frame work beyond the visible tiles) and it stays
  // deterministic — every scatter is keyed to the tile's own coordinates, never
  // to a clock or a random, so the same map draws the same way every time.

  const at = (tx, ty) =>
    tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h ? ROCK : grid.cells[idx(grid, tx, ty)];

  // A stable per-tile pseudo-random in [0,1). Hashed rather than sequential so
  // neighbouring tiles do not scatter in visible diagonal stripes.
  const jitter = (tx, ty, salt) => {
    let h = (tx * 73856093) ^ (ty * 19349663) ^ (salt * 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // --- Pass one: the body of each tile ---------------------------------------
  for (let ty = v.y0; ty <= y1; ty++) {
    for (let tx = v.x0; tx <= x1; tx++) {
      const cell = grid.cells[idx(grid, tx, ty)];
      const x = tx * TILE;
      const y = ty * TILE;

      if (cell === WATER) {
        // Depth: water away from any shore is darker. A flat blue slab reads as
        // a hole in the map; a graded one reads as a river.
        const open =
          at(tx - 1, ty) === WATER && at(tx + 1, ty) === WATER &&
          at(tx, ty - 1) === WATER && at(tx, ty + 1) === WATER;
        ctx.fillStyle = open ? C.waterDeep : C.water;
        ctx.fillRect(x, y, TILE, TILE);

        ctx.fillStyle = C.waterLine;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x + 3 + ((tx * 7 + ty * 3) % 10), y + 8, 12, 1.5);
        ctx.fillRect(x + 1 + ((tx * 5 + ty * 11) % 13), y + 22, 9, 1.5);
        ctx.globalAlpha = 1;
      } else if (cell === ROCK) {
        ctx.fillStyle = C.rock;
        ctx.fillRect(x, y, TILE, TILE);
        // Facets rather than a stripe: a lit face and a shaded one, so a crag
        // has a direction to it.
        ctx.fillStyle = C.rockLit;
        ctx.beginPath();
        ctx.moveTo(x + 2, y + TILE - 3);
        ctx.lineTo(x + 6 + jitter(tx, ty, 1) * 9, y + 5);
        ctx.lineTo(x + TILE - 5, y + 9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = C.rockDark;
        ctx.beginPath();
        ctx.moveTo(x + TILE - 5, y + 9);
        ctx.lineTo(x + TILE - 2, y + TILE - 2);
        ctx.lineTo(x + 8, y + TILE - 2);
        ctx.closePath();
        ctx.fill();
      } else if (cell === HILL) {
        ctx.fillStyle = C.hill;
        ctx.fillRect(x, y, TILE, TILE);
        // A little scrub, so high ground is not a blank olive square.
        ctx.fillStyle = C.hillScrub;
        for (let i = 0; i < 2; i++) {
          const ox = 5 + jitter(tx, ty, i + 3) * 22;
          const oy = 6 + jitter(tx, ty, i + 9) * 20;
          ctx.fillRect(x + ox, y + oy, 3, 2);
        }
      } else if (cell === FOREST) {
        // Forest FLOOR here; the canopy goes on in pass two so it can spill
        // over the edges of its own tile and hide the grid beneath it.
        ctx.fillStyle = C.forestFloor;
        ctx.fillRect(x, y, TILE, TILE);
      } else if (cell === GROUND) {
        // Two faint patches per tile, keyed to the tile, so open country has
        // some life in it without ever showing a repeat.
        for (let i = 0; i < 2; i++) {
          const ox = jitter(tx, ty, i + 41) * TILE;
          const oy = jitter(tx, ty, i + 53) * TILE;
          const r = 7 + jitter(tx, ty, i + 61) * 11;
          ctx.fillStyle = i % 2 ? C.groundLight : C.groundDark;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (cell === GOLD) {
        ctx.fillStyle = C.seam;
        ctx.fillRect(x, y, TILE, TILE);
        for (let i = 0; i < 5; i++) {
          const ox = 3 + jitter(tx, ty, i) * 25;
          const oy = 3 + jitter(tx, ty, i + 5) * 25;
          const r = 1 + jitter(tx, ty, i + 11) * 1.6;
          ctx.fillStyle = i % 2 ? C.seamGlint : C.seamDull;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // --- Pass two: boundaries and canopy ---------------------------------------
  for (let ty = v.y0; ty <= y1; ty++) {
    for (let tx = v.x0; tx <= x1; tx++) {
      const cell = grid.cells[idx(grid, tx, ty)];
      const x = tx * TILE;
      const y = ty * TILE;

      // A pale bank on every land tile that touches water. This one line does
      // more for the look of the map than anything else here: a river without a
      // shore is a blue rectangle, and with one it is a river.
      if (cell !== WATER) {
        ctx.strokeStyle = C.shore;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (at(tx - 1, ty) === WATER) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + TILE); }
        if (at(tx + 1, ty) === WATER) { ctx.moveTo(x + TILE - 1, y); ctx.lineTo(x + TILE - 1, y + TILE); }
        if (at(tx, ty - 1) === WATER) { ctx.moveTo(x, y + 1); ctx.lineTo(x + TILE, y + 1); }
        if (at(tx, ty + 1) === WATER) { ctx.moveTo(x, y + TILE - 1); ctx.lineTo(x + TILE, y + TILE - 1); }
        ctx.stroke();
      }

      // A contour along the upper edge of high ground, so a rise reads as a
      // rise rather than as a differently coloured field.
      if (cell === HILL && at(tx, ty - 1) !== HILL) {
        ctx.strokeStyle = C.hillEdge;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + 1.5);
        ctx.lineTo(x + TILE, y + 1.5);
        ctx.stroke();
      }
      if (cell === HILL && at(tx, ty + 1) !== HILL) {
        ctx.fillStyle = C.hillFoot;
        ctx.fillRect(x, y + TILE - 3, TILE, 3);
      }

      // Canopy last, drawn OVER the tile edges with a shadow under it. Trees
      // that stop exactly at a tile boundary are the single most obvious tell
      // that a map is a grid.
      if (cell === FOREST) {
        for (let i = 0; i < 4; i++) {
          const ox = 3 + jitter(tx, ty, i) * 27;
          const oy = 3 + jitter(tx, ty, i + 17) * 27;
          const r = 5.2 + jitter(tx, ty, i + 31) * 3.4;
          ctx.fillStyle = C.forestShadow;
          ctx.beginPath();
          ctx.arc(x + ox + 1.6, y + oy + 2.4, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = i % 2 ? C.forestTop : C.forestMid;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // The grid, last and faint, only over ground you can actually build on. It is
  // not decoration — it is how you judge whether a 3-tile manor fits in a gap —
  // but it has no business being drawn across a river or a wood.
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let ty = v.y0; ty <= y1; ty++) {
    for (let tx = v.x0; tx <= x1; tx++) {
      const cell = grid.cells[idx(grid, tx, ty)];
      if (cell === GROUND || cell === HILL) {
        ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE, TILE);
      }
    }
  }

  // The world's edge, so it is obvious where the map stops.
  ctx.strokeStyle = "#3d4450";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, grid.worldW, grid.worldH);
}

/**
 * Foundations — a marked-out plot with scaffolding that fills as it is raised.
 *
 * Two things have to be readable at a glance and both are load-bearing for the
 * new economy: how far along it is, and whether anyone is actually working on
 * it. A foundation with nobody on it is the commonest mistake a new player makes
 * — they mark out a barracks, assume it builds itself the way it used to, and
 * come back four minutes later to a rectangle.
 */
function drawSites(ctx, sim) {
  for (const s of sim.sites) {
    const size = s.spec.tiles * TILE;
    const x = s.tx * TILE;
    const y = s.ty * TILE;
    const owner = sim.players[s.owner];
    const done = Math.max(0, Math.min(1, s.work / s.needed));

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x, y, size, size);

    // The part that is up, rising from the bottom.
    ctx.fillStyle = s.spec.colour;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x, y + size * (1 - done), size, size * done);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = owner.colour;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    ctx.setLineDash([]);

    if (s.builders > 0) {
      // A little hammer mark per peasant on it, capped so a big crew does not
      // overflow the plot.
      ctx.fillStyle = "#e8c877";
      for (let i = 0; i < Math.min(4, s.builders); i++) {
        ctx.fillRect(x + 4 + i * 7, y + 4, 4, 4);
      }
    } else {
      ctx.fillStyle = C.hostile;
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText("idle", x + 4, y + 12);
    }

    if (s.hp < s.maxHp) healthBar(ctx, x, y - 7, size, s.hp / s.maxHp);
  }
}

/** Which painted sprite stands in for each building, if it has loaded. */
const BUILDING_ART = {
  manor: "dom_manor",
  warehouse: "dom_warehouse",
  barracks: "dom_barracks",
  stables: "dom_stables",
  watchtower: "dom_watchtower",
  factory: "dom_factory",
  lair: "dom_lair",
  // Added late and missed here, which is why both rendered as plain coloured
  // boxes long after their art existed. A building whose sprite is not in this
  // table falls silently through to the primitive block — worth remembering the
  // next time something new looks unfinished.
  farm: "dom_farm",
  bastion: "dom_bastion",
  // No `wall`, on purpose. Walls are painted from primitives so that a run of
  // segments joins into one length of stone with merlons only at its ends — a
  // sprite would repeat the same block and put a seam every 32 pixels.
};

/**
 * Does this building have a painted sprite at all?
 *
 * Walls and bridges are drawn from primitives on purpose — a wall sprite would
 * repeat and put a seam every 32 pixels — and the gate has no art yet. The build
 * bar asks before it puts an <img> on a button, so the interface does not fetch
 * three files that were never meant to exist.
 */
export function hasArt(id) {
  return Boolean(BUILDING_ART[id] || UNIT_ART[id]);
}

/** A sprite, but only once the browser has actually decoded it. */
function art(name) {
  const image = sprites[name];
  return image && image.complete && image.naturalWidth > 0 ? image : null;
}

function drawBuildings(ctx, sim, selection) {
  // Walls are drawn first and as one thing, so a run of them reads as a wall
  // rather than as a row of identical grey boxes with gaps of shadow between.
  const walled = new Set();
  for (const b of sim.buildings) {
    if (b.spec.id === "wall") walled.add(b.tx + b.ty * 10000);
  }
  const wallAt = (tx, ty) => walled.has(tx + ty * 10000);

  // Bridges first, and drawn as decking rather than as a building, because that
  // is what they are: you walk ON one. Their tiles are open ground in the
  // simulation, so anything else here would be a lie about where units can go.
  for (const b of sim.buildings) {
    if (!b.spec.spans) continue;
    const x = b.tx * TILE;
    const y = b.ty * TILE;
    const owner = sim.players[b.owner];
    const hurt = b.hp < b.maxHp * 0.5;

    ctx.fillStyle = hurt ? "#5d4a33" : "#7a6144";
    ctx.fillRect(x, y + 3, TILE, TILE - 6);
    // Planks across, and rails along, so the direction of the crossing reads.
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (let i = 1; i < 4; i++) ctx.fillRect(x + i * 8, y + 3, 1.5, TILE - 6);
    ctx.fillStyle = hurt ? "#7d6446" : "#9a7d59";
    ctx.fillRect(x, y + 2, TILE, 2.5);
    ctx.fillRect(x, y + TILE - 4.5, TILE, 2.5);

    ctx.fillStyle = owner.colour;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(x, y + TILE - 2, TILE, 2);
    ctx.globalAlpha = 1;

    if (selection.buildingId === b.id) {
      ctx.strokeStyle = C.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 2, y - 2, TILE + 4, TILE + 4);
    }
    if (b.hp < b.maxHp) healthBar(ctx, x, y - 6, TILE, b.hp / b.maxHp);
  }

  for (const b of sim.buildings) {
    if (b.spec.id !== "wall") continue;
    const x = b.tx * TILE;
    const y = b.ty * TILE;
    const owner = sim.players[b.owner];

    ctx.fillStyle = C.shadow;
    ctx.fillRect(x + 2, y + 4, TILE, TILE);
    ctx.fillStyle = b.hp < b.maxHp * 0.5 ? C.wallHurt : C.wall;
    ctx.fillRect(x, y, TILE, TILE);

    // A cap along the top and merlons, but only where the wall does not
    // continue — the join between two segments should look like stone, not like
    // the end of one block and the start of another.
    ctx.fillStyle = C.wallCap;
    if (!wallAt(b.tx, b.ty - 1)) {
      ctx.fillRect(x, y, TILE, 5);
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 2 + i * 11, y - 3, 7, 4);
    }
    if (!wallAt(b.tx - 1, b.ty)) ctx.fillRect(x, y, 3, TILE);
    if (!wallAt(b.tx + 1, b.ty)) ctx.fillRect(x + TILE - 3, y, 3, TILE);

    ctx.fillStyle = owner.colour;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    ctx.globalAlpha = 1;

    if (selection.buildingId === b.id) {
      ctx.strokeStyle = C.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 2, y - 2, TILE + 4, TILE + 4);
    }
    if (b.hp < b.maxHp) healthBar(ctx, x, y - 6, TILE, b.hp / b.maxHp);
  }

  for (const b of sim.buildings) {
    if (b.spec.id === "wall" || b.spec.spans) continue;
    const size = b.spec.tiles * TILE;
    const x = b.tx * TILE;
    const y = b.ty * TILE;
    const owner = sim.players[b.owner];
    const image = art(BUILDING_ART[b.spec.id]);

    if (image) {
      // A soft pool on the ground, not the offset square the flat blocks used.
      // With a painted building the square shadow is visible AROUND the art
      // rather than under it, and reads as a bug — a black rectangle stuck to
      // the manor's bottom-right corner.
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size - 5, size * 0.46, size * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = C.shadow;
      ctx.fillRect(x + 3, y + 5, size, size);
    }

    if (image) {
      // Painted buildings are taller than their footprint — a manor occupies
      // three tiles of GROUND but its roof rises above them, the way it would in
      // any isometric strategy game. The sprite is anchored to the bottom of the
      // footprint and allowed to overhang upwards, so the tiles it blocks still
      // match the tiles you can see it standing on. Getting this backwards makes
      // players try to build into a space that is visibly occupied.
      // Buildings overhang their footprint upward — a roof rises above the
      // ground it stands on. Raised with the units so the two stay in
      // proportion to each other; a hall that did not grow would suddenly look
      // like a shed beside its own guards.
      const w = size * 1.34;
      const h = (image.naturalHeight / image.naturalWidth) * w;
      ctx.drawImage(image, x + (size - w) / 2, y + size - h, w, h);

      // An owner band under the footprint rather than across the roof: it must
      // never cover the art, and whose it is still has to be readable at a
      // glance from across the map.
      ctx.fillStyle = owner.colour;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y + size - 4, size, 4);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = b.spec.colour;
      ctx.fillRect(x, y, size, size);

      // An owner band along the top, because at a glance colour is the only thing
      // that says whose it is.
      ctx.fillStyle = owner.colour;
      ctx.fillRect(x, y, size, 6);

      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

      if (b.spec.isHeart) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(x + size / 2 - 4, y + 12, 8, size - 20);
      }
    }

    if (selection.buildingId === b.id) {
      ctx.strokeStyle = C.select;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 3, y - 3, size + 6, size + 6);
      // WHAT IT CAN REACH.
      //
      // A tower's range is the one number that decides whether 130 gold was
      // well spent, and there was no way to see it — you placed one and found
      // out later whether it covered the ford. Shown on selection rather than
      // always, because a dozen overlapping rings is a worse map than no rings.
      if (b.spec.attack) rangeRing(ctx, b.x, b.y, b.spec.attack.range);
    }

    if (b.hp < b.maxHp) healthBar(ctx, x, y - 7, size, b.hp / b.maxHp);
    // A barracks with a queue should look busy.
    if (b.queue?.length) {
      ctx.fillStyle = "#e8c877";
      ctx.fillRect(x, y + size + 2, (size * (b.queue.length > 5 ? 5 : b.queue.length)) / 5, 3);
    }
  }
}

/** Where on the map a queued step points. */
function stepPoint(sim, step) {
  if (step.targetId !== undefined) {
    const thing =
      sim.units.find((u) => u.id === step.targetId) ??
      sim.buildings.find((b) => b.id === step.targetId) ??
      sim.sites.find((x) => x.id === step.targetId);
    return thing ? { x: thing.x, y: thing.y, gone: false } : null;
  }
  if (step.siteId !== undefined) {
    const site = sim.sites.find((x) => x.id === step.siteId);
    // The foundation was razed. Still worth drawing, greyed: the player queued
    // something there and needs to see that it is not going to happen.
    if (!site) return { x: step.tx * TILE + TILE / 2, y: step.ty * TILE + TILE / 2, gone: true };
    return { x: site.x, y: site.y, gone: false };
  }
  return { x: step.tx * TILE + TILE / 2, y: step.ty * TILE + TILE / 2, gone: false };
}

/**
 * The route a selected unit still has to run.
 *
 * An order queue you cannot see is an order queue you cannot trust — after four
 * Ctrl-clicks there is no way to know whether the fourth registered, and the
 * only way to find out is to watch for a minute. Numbered stops, drawn only for
 * what is selected, so the map does not fill with everybody's plans at once.
 */
function drawPlans(ctx, sim, selection) {
  ctx.save();
  for (const u of sim.units) {
    if (!selection.unitIds.has(u.id) || !u.plan || u.plan.length === 0) continue;

    const stops = u.plan.map((step) => stepPoint(sim, step)).filter(Boolean);
    if (stops.length === 0) continue;

    ctx.strokeStyle = C.select;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(u.x, u.y);
    for (const s of stops) ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 1;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    stops.forEach((s, i) => {
      ctx.fillStyle = s.gone ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.65)";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.gone ? C.hostile : C.select;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = s.gone ? C.hostile : C.select;
      ctx.fillText(String(i + 1), s.x, s.y + 0.5);
    });
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

function drawUnits(ctx, sim, selection) {
  for (const u of sim.units) {
    const owner = sim.players[u.owner];
    const r = u.spec.radius;

    // Fliers are lifted off their own shadow. The simulation already lets a
    // dragon cross water and walls, and without this the only way to discover
    // that was to try it — it sat on the ground looking like everything else.
    // The shadow stays put, so the gap is what reads as height.
    const lift = u.spec.flies ? r * 1.1 : 0;

    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + r * 0.7, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    if (selection.unitIds.has(u.id)) {
      ctx.strokeStyle = C.select;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + r * 0.7, r + 3, (r + 3) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const image = art(UNIT_ART[u.spec.id]);
    if (image) {
      // The owner ring stays, drawn UNDER the man rather than around him. Two
      // painted spearmen twenty pixels tall are not distinguishable by their
      // tunics at any sane zoom, and in a 1v1 knowing whose army you are looking
      // at matters more than the art does.
      ctx.strokeStyle = owner.colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + r * 0.7, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();

      // ART SCALE IS NOT COLLISION SCALE, AND IT SHOULD NOT BE.
      //
      // At 3.4 a spearman — radius 7 — was drawn twenty-four pixels tall, which
      // is a smudge you cannot identify and cannot enjoy. The radius is what the
      // simulation uses to push men apart and to decide what a blow reaches; the
      // sprite is what the player reads. Tying them one-to-one made the second
      // job serve the first.
      //
      // 5.2 puts that spearman at thirty-six pixels — comfortably past the
      // forty-pixel silhouette test STYLE.md sets, once the usual zoom is
      // counted — while the radius, and therefore every rule in the game, is
      // untouched. Sprites overlapping slightly is normal in the genre and reads
      // as a crowd rather than as a bug.
      const h = r * 5.2;
      const w = (image.naturalWidth / image.naturalHeight) * h;
      ctx.drawImage(image, u.x - w / 2, u.y + r * 0.7 - h - lift, w, h);
    } else {
      ctx.fillStyle = u.spec.colour;
      ctx.beginPath();
      ctx.arc(u.x, u.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = owner.colour;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Archers get a mark so the two types are told apart without reading text.
      if (u.spec.id === "archer") {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(u.x - 1, u.y - r - 3, 2, 5);
      }
    }

    // A peasant carrying something home, so the economy is something you can
    // watch rather than a number that changes. It is also the fastest way to see
    // that a seam is too far from a drop-off: the road is full of loaded men
    // walking. Coloured by WHAT he is carrying, so you can see at a glance which
    // of the three supply lines is actually running.
    if (u.carrying > 0) {
      ctx.fillStyle = CARRY_COLOUR[u.carryKind] ?? C.seamGlint;
      ctx.beginPath();
      ctx.arc(u.x + r * 0.8, u.y - r * 0.9 - lift, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (u.hp < u.maxHp) {
      healthBar(ctx, u.x - r, u.y - r - 6 - lift, r * 2, u.hp / u.maxHp);
    }
  }
}

/** What a load looks like on a man's back. */
const CARRY_COLOUR = { gold: "#f2d06b", timber: "#a3733f", food: "#bcd97a" };

function healthBar(ctx, x, y, w, frac) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x, y, w, 3);
  ctx.fillStyle = frac > 0.5 ? "#7fd48f" : frac > 0.25 ? "#e8c877" : "#d47f7f";
  ctx.fillRect(x, y, w * frac, 3);
}

function drawProjectiles(ctx, sim) {
  ctx.lineWidth = 1;
  // ARROWS ARCH. A straight line between two points is a laser, and a field of
  // them reads as damage happening rather than as a volley being loosed — which
  // is most of what a ranged battle looks like in Warrior Kings, where you can
  // see the shape of an exchange from across the map.
  //
  // The bow is a quadratic through a control point lifted perpendicular to the
  // shot, so the arc always bends "upwards" in screen terms regardless of which
  // way the arrow travels. Lift scales with distance: a point-blank shot is
  // nearly flat, a long shot loops.
  //
  // Purely cosmetic. `sim.projectiles` is drained by the simulation and nothing
  // here is read back, so a client that drew straight lines would still agree
  // with one that drew arcs — which is the rule every renderer here follows.
  for (const p of sim.projectiles) {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const span = Math.sqrt(dx * dx + dy * dy);
    const lift = Math.min(38, span * 0.22);
    // Perpendicular, normalised. A zero-length shot gets no bow and no NaN.
    const nx = span > 0.001 ? -dy / span : 0;
    const ny = span > 0.001 ? dx / span : 0;
    const cx = p.x + dx / 2 + nx * lift;
    const cy = p.y + dy / 2 + ny * lift - lift * 0.5;

    ctx.strokeStyle = `rgba(255,235,180,${p.life / 5})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(cx, cy, p.tx, p.ty);
    ctx.stroke();
  }
}

/** A dashed circle, for a thing that can hit at a distance. */
function rangeRing(ctx, x, y, radius) {
  ctx.save();
  ctx.strokeStyle = C.range;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawGhost(ctx, sim, ghost) {
  const spec = BUILDINGS[ghost.type];
  const size = spec.tiles * TILE;

  // The ring follows the GHOST too, so a tower is placed knowing what it covers
  // rather than found out afterwards. This is the moment the number matters.
  if (spec.attack) {
    const cx = ghost.tx * TILE + size / 2;
    const cy = ghost.ty * TILE + size / 2;
    rangeRing(ctx, cx, cy, spec.attack.range);
  }

  // Per TILE, not per footprint. With four kinds of ground that can each refuse
  // a building for a different reason, a single red square tells you it will not
  // fit but not which corner is the problem — and on Kingsmoor, where woods and
  // seams break the ground up, that is most of the map.
  for (let dy = 0; dy < spec.tiles; dy++) {
    for (let dx = 0; dx < spec.tiles; dx++) {
      const tx = ghost.tx + dx;
      const ty = ghost.ty + dy;
      const okHere =
        tx >= 0 && ty >= 0 && tx < sim.grid.w && ty < sim.grid.h &&
        TERRAIN[sim.grid.cells[idx(sim.grid, tx, ty)]].build;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = okHere ? spec.colour : C.hostile;
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = ghost.ok ? C.select : C.hostile;
  ctx.lineWidth = 2;
  ctx.strokeRect(ghost.tx * TILE, ghost.ty * TILE, size, size);
}

function drawDragBox(ctx, box) {
  const x = Math.min(box.x0, box.x1);
  const y = Math.min(box.y0, box.y1);
  const w = Math.abs(box.x1 - box.x0);
  const h = Math.abs(box.y1 - box.y0);
  ctx.fillStyle = "rgba(127,212,143,0.12)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.select;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}

/**
 * A minimap, which stops being a luxury the moment the map is bigger than the
 * window — without one you cannot tell that an army is walking around behind
 * you, and "where is everything" becomes the whole difficulty.
 */
const MINIMAP = 150;

function drawMinimap(ctx, sim, cam) {
  const pad = 10;
  const scale = MINIMAP / sim.grid.worldW;
  const h = sim.grid.worldH * scale;
  const x0 = ctx.canvas.width - MINIMAP - pad;
  const y0 = ctx.canvas.height - h - pad;

  ctx.fillStyle = "rgba(10,12,16,0.85)";
  ctx.fillRect(x0 - 2, y0 - 2, MINIMAP + 4, h + 4);

  ctx.fillStyle = "#2a2f39";
  ctx.fillRect(x0, y0, MINIMAP, h);

  // Terrain, so the minimap is a MAP rather than a dot plot. On Kingsmoor —
  // three times the ground of the other two — the river and the fords are the
  // whole strategic picture, and a minimap that hides them makes the big map
  // feel like a small map with more walking.
  const step = Math.max(1, Math.round(1 / (TILE * scale)));
  const px = Math.ceil(TILE * scale * step);
  for (let ty = 0; ty < sim.grid.h; ty += step) {
    for (let tx = 0; tx < sim.grid.w; tx += step) {
      const cell = sim.grid.cells[idx(sim.grid, tx, ty)];
      if (cell === GROUND || cell === BUILDING_CELL) continue;
      ctx.fillStyle =
        cell === WATER ? C.water
          : cell === FOREST ? C.forestTop
            : cell === HILL ? C.hill
              : cell === GOLD ? C.seamGlint
                : C.rock;
      ctx.fillRect(x0 + tx * TILE * scale, y0 + ty * TILE * scale, px, px);
    }
  }

  for (const s of sim.sites) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    const size = Math.max(3, s.spec.tiles * TILE * scale);
    ctx.fillRect(x0 + s.tx * TILE * scale, y0 + s.ty * TILE * scale, size, size);
  }
  for (const b of sim.buildings) {
    ctx.fillStyle = sim.players[b.owner].colour;
    const s = Math.max(3, b.spec.tiles * TILE * scale);
    ctx.fillRect(x0 + b.tx * TILE * scale, y0 + b.ty * TILE * scale, s, s);
  }
  for (const u of sim.units) {
    // Peasants dimmer than soldiers: on a big map the thing you want to spot
    // instantly is an ARMY moving, not your own economy shuffling about.
    ctx.globalAlpha = u.spec.worker ? 0.5 : 1;
    ctx.fillStyle = sim.players[u.owner].colour;
    ctx.fillRect(x0 + u.x * scale - 1, y0 + u.y * scale - 1, 2, 2);
  }
  ctx.globalAlpha = 1;

  // Where you are looking.
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    x0 + cam.x * scale,
    y0 + cam.y * scale,
    (cam.viewW / cam.zoom) * scale,
    (cam.viewH / cam.zoom) * scale
  );

  return { x0, y0, scale, h };
}

export function minimapRect(ctx, sim) {
  const pad = 10;
  const scale = MINIMAP / sim.grid.worldW;
  const h = sim.grid.worldH * scale;
  return {
    x0: ctx.canvas.width - MINIMAP - pad,
    y0: ctx.canvas.height - h - pad,
    w: MINIMAP,
    h,
    scale,
  };
}
