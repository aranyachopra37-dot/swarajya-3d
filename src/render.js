// Drawing. This file reads the simulation and paints it — it never changes it.
//
// It is also the ONLY file that touches a pixel, which means the look can be
// replaced wholesale — sprites, a WebGL renderer, anything — without a single
// line of the rules changing.

import { canPlace, ROAD_HALF } from "./sim.js";
import { TERRAIN, pointAt } from "./maps.js";
import { FAMILIES, FAMILY_IDS, effectiveSpec, isUnlocked } from "./towers.js";
import { sprites } from "./assets.js";
import { applyCamera, clearCamera } from "./camera.js";

// How tall things are drawn on the field, in pixels. Sprites are authored much
// larger and scaled down here, so they stay crisp on high-DPI screens.
const UNIT_HEIGHT = 34;
const RAM_HEIGHT = 40;
const TOWER_HEIGHT = 46;

// Anything that should not be man-sized. This was a single `id === "ram"` check
// until the Siege Tower arrived and drew at the size of a farmer with a spear —
// a machine that eats your buildings has to look like it could. Size is the
// cheapest threat-reading a player gets, so it is worth being explicit about.
const UNIT_HEIGHTS = {
  ram: RAM_HEIGHT,
  siegeTower: 52,
  warlord: 38,
  barrowWight: 42, // taller than a man, and it should look like it
  shade: 30,       // and what comes out of it should not
};

// A regiment is drawn as several figures rather than one, so that losses are
// visible without reading a number — the block visibly thins as men die.
const MEN_PER_FIGURE = 4;
const MAX_FIGURES = 6;

/**
 * Draw a sprite anchored at its feet. Returns false if the sprite is missing,
 * which lets each caller fall back to its old shape independently.
 */
function drawSprite(ctx, name, x, footY, height, opts = {}) {
  const img = sprites[name];
  if (!img) return false;

  const scale = height / img.height;
  const w = img.width * scale;
  const { flip = false, alpha = 1, flash = 0 } = opts;

  // Anchor at the feet: translate to the ground point, mirror if needed, then
  // draw centred horizontally with the bottom edge on zero.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, footY);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -height, w, height);

  // Recently hit: overlay a brightened copy of the same sprite.
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.6;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(img, -w / 2, -height, w, height);
  }
  ctx.restore();

  return true;
}

const C = {
  skyTop: "#1a1e28",
  skyBottom: "#22262f",
  // Lightened from #242a2a: the sprites are dark earth tones and were sinking
  // into the ground they stood on.
  grass: "#2d3433",
  grassAlt: "#313837",
  road: "#3a3730",
  roadEdge: "#4a463c",
  keep: "#7c869b",
  keepDark: "#5d6679",
  keepHurt: "#c9635b",
  routing: "#767b8b",
  moraleHigh: "#7fd48f",
  moraleMid: "#e0c05c",
  moraleLow: "#e07a5c",
  text: "#d3d8e4",
  dim: "#727a8d",
  gold: "#e8c877",
  ok: "rgba(127, 212, 143, 0.9)",
  bad: "rgba(201, 99, 91, 0.9)",
  shadow: "rgba(0, 0, 0, 0.35)",
};

const HIT_FLASH_TICKS = 6;

export function draw(ctx, sim, ghost, pointer, cam) {
  clearCamera(ctx);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  applyCamera(ctx, cam);

  drawGround(ctx);
  drawTerrain(ctx, sim.map);
  drawRoad(ctx, sim.map.path);
  drawKeep(ctx, sim);

  // Support and snare radii are always visible, unlike firing ranges: they are
  // static facts about the battlefield, and hiding them would make the buildings
  // that create them unreadable.
  for (const tower of sim.towers) {
    if (tower.spec.support) drawFieldRing(ctx, tower, "rgba(159,212,200,0.30)");
    if (tower.spec.slow) drawFieldRing(ctx, tower, "rgba(111,154,92,0.34)");
  }

  // Charges sit ON the road, so they are drawn before anything that walks over
  // them. A player has to be able to see the stockpile draining — it is the one
  // thing in the game that runs out, and a resource you cannot watch deplete is
  // not a resource, it is a surprise.
  drawCharges(ctx, sim);

  for (const r of sim.regiments) drawAura(ctx, r);

  // Range rings show only for the tower under the cursor or the one being
  // placed. Drawing them all at once buried the battle under giant circles.
  const hovered = pointer ? towerAt(sim, pointer) : null;
  if (hovered) {
    const spec = effectiveSpec(hovered.spec, sim.devotion);
    drawRange(ctx, hovered.x, hovered.y, spec.range, spec.colour);
  }

  for (const tower of sim.towers) drawTower(ctx, sim, tower, tower === hovered);
  for (const pulse of sim.pulses) drawPulse(ctx, pulse);
  for (const r of sim.regiments) drawRegiment(ctx, r, sim.tick);
  for (const shot of sim.shots) drawShot(ctx, shot);

  if (ghost) drawGhost(ctx, sim, ghost);

  // Interface is drawn in screen space, so it never zooms or slides with the map.
  clearCamera(ctx);
  drawHud(ctx, sim, cam);
  drawVignette(ctx);
}

function towerAt(sim, p) {
  for (const t of sim.towers) {
    if (Math.abs(t.x - p.x) <= 16 && Math.abs(t.y - p.y) <= 16) return t;
  }
  return null;
}

// --- Terrain -----------------------------------------------------------------

function drawGround(ctx) {
  const { width, height } = ctx.canvas;

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, C.skyTop);
  sky.addColorStop(1, C.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += 22) {
    ctx.fillStyle = (y / 22) % 2 === 0 ? C.grass : C.grassAlt;
    ctx.fillRect(0, y, width, 22);
  }

  // A painted surface over the flat bands. Kept semi-transparent on purpose:
  // the bands carry the readability and the texture only has to stop the field
  // looking like graph paper. At full opacity the tile seams announce
  // themselves and every unit has to fight the ground for attention.
  const ground = pattern(ctx, "tex_ground");
  if (ground) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

/**
 * A repeating pattern from a loaded texture, made once and kept.
 *
 * `createPattern` is not free and this runs every frame, so the result is
 * cached against the image itself — and only built once the image has actually
 * loaded, since a pattern from a half-loaded image is silently empty.
 */
const patterns = new Map();

function pattern(ctx, name) {
  const image = sprites[name];
  if (!image || !image.complete || image.naturalWidth === 0) return null;
  let made = patterns.get(name);
  if (!made) {
    made = ctx.createPattern(image, "repeat");
    patterns.set(name, made);
  }
  return made;
}

/**
 * Terrain, drawn under the road. It has to read instantly — a player must be
 * able to see at a glance where a ship can float and where a watchpost can
 * stand, without hovering to find out.
 */
function drawTerrain(ctx, map) {
  for (const zone of map.terrain ?? []) {
    const t = TERRAIN[zone.kind];
    if (!t) continue;

    ctx.fillStyle = t.colour;
    ctx.strokeStyle = t.edge;
    ctx.lineWidth = 2;

    ctx.beginPath();
    if (zone.r !== undefined) ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
    else ctx.rect(zone.x, zone.y, zone.w, zone.h);
    ctx.fill();

    // Ground shows through, except in water. Once the field itself was textured
    // these zones were the only flat colour left on screen and read as plastic
    // laid on top of a painting — which is exactly what they were. Water stays
    // smooth on purpose: it is the one surface that should not look like earth.
    const grain = zone.kind === "water" ? null : pattern(ctx, "tex_ground");
    if (grain) {
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }

    ctx.stroke();

    if (zone.kind === "water") drawWaves(ctx, zone);
    if (zone.kind === "mountain") drawRidges(ctx, zone);
  }
}

function drawWaves(ctx, zone) {
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1.5;
  const top = zone.r !== undefined ? zone.y - zone.r : zone.y;
  const bottom = zone.r !== undefined ? zone.y + zone.r : zone.y + zone.h;
  const left = zone.r !== undefined ? zone.x - zone.r : zone.x;
  const right = zone.r !== undefined ? zone.x + zone.r : zone.x + zone.w;

  ctx.save();
  ctx.beginPath();
  if (zone.r !== undefined) ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
  else ctx.rect(zone.x, zone.y, zone.w, zone.h);
  ctx.clip();
  for (let y = top + 12; y < bottom; y += 16) {
    ctx.beginPath();
    for (let x = left; x < right; x += 8) {
      ctx.lineTo(x, y + Math.sin(x / 14) * 2.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawRidges(ctx, zone) {
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  const left = zone.r !== undefined ? zone.x - zone.r : zone.x;
  const right = zone.r !== undefined ? zone.x + zone.r : zone.x + zone.w;
  const base = zone.r !== undefined ? zone.y + zone.r : zone.y + zone.h;

  ctx.save();
  ctx.beginPath();
  if (zone.r !== undefined) ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
  else ctx.rect(zone.x, zone.y, zone.w, zone.h);
  ctx.clip();
  for (let x = left; x < right; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x + 17, base - 34);
    ctx.lineTo(x + 34, base);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The road is drawn as one thick stroked line along the map's path. */
function drawRoad(ctx, path) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = C.roadEdge;
  ctx.lineWidth = ROAD_HALF * 2 + 4;
  strokePath(ctx, path);

  ctx.strokeStyle = C.road;
  ctx.lineWidth = ROAD_HALF * 2;
  strokePath(ctx, path);

  // Packed dirt over the flat band. Stroking WITH the pattern rather than
  // clipping and filling keeps it exactly inside the road on every bend, for
  // free, with the same geometry the road itself is drawn from.
  const road = pattern(ctx, "tex_road");
  if (road) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = road;
    ctx.lineWidth = ROAD_HALF * 2;
    strokePath(ctx, path);
    ctx.restore();
  }

  // A dashed centre line makes the direction of travel legible on bends.
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 14]);
  strokePath(ctx, path);
  ctx.setLineDash([]);
}

function strokePath(ctx, path) {
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
}

function drawKeep(ctx, sim) {
  const end = sim.map.path[sim.map.path.length - 1];
  const hurt = sim.gateHealth < 25;
  const base = hurt ? C.keepHurt : C.keep;

  ctx.fillStyle = C.shadow;
  ctx.fillRect(end.x - 8, end.y - 55, 24, 112);

  ctx.fillStyle = base;
  ctx.fillRect(end.x - 11, end.y - 58, 22, 116);
  ctx.fillStyle = hurt ? "#a04f48" : C.keepDark;
  ctx.fillRect(end.x - 11, end.y - 16, 22, 32);

  ctx.fillStyle = base;
  for (let i = 0; i < 5; i++) ctx.fillRect(end.x - 17, end.y - 58 + i * 26, 7, 12);
}

// --- Towers ------------------------------------------------------------------

function drawRange(ctx, x, y, range, colour) {
  ctx.fillStyle = hexToRgba(colour, 0.06);
  ctx.beginPath();
  ctx.arc(x, y, range, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(colour, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawTower(ctx, sim, tower, highlighted) {
  const { x, y } = tower;
  const spec = effectiveSpec(tower.spec, sim.devotion);

  const footY = y + 12;

  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(x, footY, 15, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!drawSprite(ctx, tower.spec.id, x, footY, TOWER_HEIGHT)) {
    ctx.fillStyle = "#3b4150";
    ctx.fillRect(x - 11, y - 4, 22, 16);
    ctx.fillStyle = spec.colour;
    ctx.fillRect(x - 9, y - 14, 18, 12);
    ctx.fillStyle = hexToRgba(spec.colour, 0.45);
    ctx.fillRect(x - 9, y - 14, 18, 4);
  }

  // A glow at the base rather than a box around it. A hard rectangle looked
  // fine around a coloured square and looks like a picture frame around a
  // painted building.
  if (highlighted) {
    const glow = ctx.createRadialGradient(x, footY, 2, x, footY, 26);
    glow.addColorStop(0, hexToRgba(spec.colour, 0.5));
    glow.addColorStop(1, hexToRgba(spec.colour, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, footY, 26, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const ready = 1 - tower.cooldown / spec.reload;
  ctx.fillStyle = "#12151b";
  ctx.fillRect(x - 11, y + 14, 22, 3);
  ctx.fillStyle = ready >= 1 ? spec.colour : hexToRgba(spec.colour, 0.5);
  ctx.fillRect(x - 11, y + 14, 22 * ready, 3);
}

function drawPulse(ctx, pulse) {
  const t = pulse.life / 18;
  ctx.strokeStyle = `rgba(212, 201, 127, ${t * 0.7})`;
  ctx.lineWidth = 2 + (1 - t) * 2;
  ctx.beginPath();
  ctx.arc(pulse.x, pulse.y, pulse.radius * (1.05 - t * 0.3), 0, Math.PI * 2);
  ctx.stroke();
}

// --- Regiments ---------------------------------------------------------------

/**
 * Iron on the road. Charges are stored as a distance along the path rather than
 * a point, because that is the coordinate the simulation reasons in — so the
 * position is recovered here rather than stored twice and allowed to disagree.
 */
function drawCharges(ctx, sim) {
  if (!sim.charges || sim.charges.length === 0) return;

  for (const charge of sim.charges) {
    const p = pointAt(sim.map.path, charge.at);
    // Freshly laid ones flash briefly, so the act of restocking is visible and
    // the building does not look inert between waves.
    const age = sim.tick - charge.born;
    const fresh = Math.max(0, 1 - age / 25);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.dy, p.dx));

    ctx.strokeStyle = fresh > 0 ? "#e8dcb8" : "#9a8f78";
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.55 + fresh * 0.45;

    // Four little spikes in a scatter — a caltrop lands whichever way up it
    // likes and always has a point upward, which is the joke of the thing.
    for (const [dx, dy] of [[-7, -4], [4, -6], [8, 3], [-3, 6]]) {
      ctx.beginPath();
      ctx.moveTo(dx - 2.5, dy + 2.5);
      ctx.lineTo(dx + 2.5, dy - 2.5);
      ctx.moveTo(dx - 2.5, dy - 2.5);
      ctx.lineTo(dx + 2.5, dy + 2.5);
      ctx.stroke();
    }

    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFieldRing(ctx, tower, colour) {
  ctx.strokeStyle = colour;
  ctx.setLineDash([5, 7]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(tower.x, tower.y, tower.spec.range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawAura(ctx, r) {
  if (r.state !== "advancing" || !r.type.auraRadius) return;

  ctx.strokeStyle = "rgba(215, 185, 107, 0.22)";
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(r.x, r.y, r.type.auraRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRegiment(ctx, r, tick) {
  if (r.state === "gone") return;

  const routing = r.state === "routing";
  const flash = Math.max(0, 1 - (tick - r.lastHitTick) / HIT_FLASH_TICKS);
  const height = UNIT_HEIGHTS[r.type.id] ?? UNIT_HEIGHT;

  // How many figures stand for this regiment right now. Losing men removes
  // figures, so attrition stays readable at a glance.
  //
  // Except for machines, which are ONE machine. A Ram's `men` is its crew and
  // its structural integrity, not a count of vehicles, so the usual one-figure-
  // per-four-men rule drew six battering rams in a row. Machines are exactly the
  // units with no morale — the same missing value that means "cannot be
  // frightened" also means "there is only one of me".
  const machine = r.type.morale === null;
  const figures = machine
    ? 1
    : Math.min(MAX_FIGURES, Math.max(1, Math.ceil(r.men / MEN_PER_FIGURE)));

  const spread = Math.min(30, 7 + figures * 3.5);
  const placed = [];
  for (let i = 0; i < figures; i++) {
    // A loose clump rather than a grid — deterministic offsets from the index,
    // so it never shimmers between frames.
    const t = figures === 1 ? 0 : i / (figures - 1) - 0.5;
    placed.push({
      x: r.x + t * spread * 2,
      y: r.y + ((i % 2) * 2 - 1) * spread * 0.42,
    });
  }
  // Back to front, so nearer figures overlap the ones behind them.
  placed.sort((a, b) => a.y - b.y);

  const top = r.y - height - 6;

  for (const spot of placed) {
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y + 2, height * 0.22, height * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawn = drawSprite(ctx, r.type.id, spot.x, spot.y, height, {
      flip: routing,
      alpha: routing ? 0.72 : 1,
      flash,
    });

    if (!drawn) {
      // Sprite missing — fall back to the old block so the game stays playable.
      ctx.fillStyle = flash > 0 ? "#ffffff" : routing ? C.routing : r.type.colour;
      ctx.fillRect(spot.x - 5, spot.y - 12, 10, 12);
    }
  }

  // The bearer sprite carries its own banner, so only draw the vector one when
  // we are falling back to blocks.
  if (r.type.auraRadius && !routing && !sprites[r.type.id]) drawBanner(ctx, r, top);
  drawMoraleBar(ctx, r, routing, top);
}

function drawBanner(ctx, r, top) {
  ctx.strokeStyle = r.type.colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.x, top);
  ctx.lineTo(r.x, top - 30);
  ctx.stroke();

  ctx.fillStyle = r.type.colour;
  ctx.beginPath();
  ctx.moveTo(r.x, top - 30);
  ctx.lineTo(r.x + 16, top - 25);
  ctx.lineTo(r.x, top - 18);
  ctx.closePath();
  ctx.fill();
}

function drawMoraleBar(ctx, r, routing, top) {
  const width = 44;
  const x = r.x - width / 2;
  const y = top - 12;

  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "center";

  if (r.morale === null) {
    ctx.fillStyle = C.dim;
    ctx.fillText("NO MORALE", r.x, y + 5);
    ctx.textAlign = "left";
    return;
  }

  const fraction = Math.max(0, r.morale) / Math.max(1, r.moraleMax);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 1, y - 1, width + 2, 7);
  ctx.fillStyle = "#12151b";
  ctx.fillRect(x, y, width, 5);
  ctx.fillStyle = routing
    ? C.routing
    : fraction > 0.5
      ? C.moraleHigh
      : fraction > 0.25
        ? C.moraleMid
        : C.moraleLow;
  ctx.fillRect(x, y, width * fraction, 5);

  if (routing) {
    ctx.fillStyle = "#ffb4a2";
    ctx.fillText("ROUTING", r.x, y - 5);
  }
  ctx.textAlign = "left";
}

function drawShot(ctx, shot) {
  const heavy = shot.spec.splash > 0;
  ctx.fillStyle = hexToRgba(shot.spec.colour, 0.35);
  ctx.beginPath();
  ctx.arc(shot.x, shot.y, heavy ? 6 : 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shot.spec.colour;
  ctx.beginPath();
  ctx.arc(shot.x, shot.y, heavy ? 3.5 : 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// --- Placement ---------------------------------------------------------------

function drawGhost(ctx, sim, ghost) {
  const check = canPlace(sim, ghost.tower, ghost.x, ghost.y);
  const spec = effectiveSpec(ghost.spec, sim.devotion);

  drawRange(ctx, ghost.x, ghost.y, spec.range, check.ok ? spec.colour : "#c9635b");

  const footY = ghost.y + 12;
  if (!drawSprite(ctx, ghost.tower, ghost.x, footY, TOWER_HEIGHT, { alpha: 0.55 })) {
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = check.ok ? spec.colour : "#c9635b";
    ctx.fillRect(ghost.x - 9, ghost.y - 14, 18, 12);
    ctx.globalAlpha = 1;
  }

  // A ring on the ground reads as "this is where it goes" better than a box.
  ctx.strokeStyle = check.ok ? C.ok : C.bad;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(ghost.x, footY, 18, 8, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (!check.ok) {
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    const width = ctx.measureText(check.reason).width + 12;
    ctx.fillStyle = "rgba(12,14,19,0.85)";
    ctx.fillRect(ghost.x - width / 2, ghost.y - 36, width, 16);
    ctx.fillStyle = C.bad;
    ctx.fillText(check.reason, ghost.x, ghost.y - 24);
    ctx.textAlign = "left";
  }
}

// --- Interface ---------------------------------------------------------------

function drawHud(ctx, sim, cam) {
  ctx.fillStyle = "rgba(12, 14, 19, 0.78)";
  ctx.fillRect(0, 0, 268, 96);

  ctx.font = "14px ui-monospace, monospace";
  ctx.fillStyle = C.moraleHigh;
  ctx.fillText(`${sim.score} pts`, 14, 26);

  ctx.fillStyle = C.gold;
  ctx.fillText(`${sim.gold}g`, 118, 26);

  ctx.fillStyle = sim.gateHealth < 25 ? C.keepHurt : C.text;
  ctx.fillText(`gate ${Math.max(0, sim.gateHealth)}`, 186, 26);

  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = C.dim;
  ctx.fillText(`broken ${sim.routed}   killed ${sim.destroyed}`, 14, 46);
  ctx.fillText(`rallied ${sim.rallied}   through ${sim.leaked}`, 14, 62);

  // Devotion — what you have built, and therefore who you are becoming.
  let x = 14;
  for (const id of FAMILY_IDS) {
    const count = sim.devotion[id];
    const family = FAMILIES[id];
    ctx.fillStyle = count > 0 ? family.colour : "#39404f";
    ctx.fillRect(x, 74, 10, 10);
    ctx.fillStyle = count > 0 ? C.text : C.dim;
    ctx.fillText(`${id.toLowerCase()} ${count}`, x + 14, 83);
    x += 84;
  }

  ctx.fillStyle = C.dim;
  const zoomNote = cam && cam.zoom !== 1 ? `   ${cam.zoom.toFixed(1)}x` : "";
  ctx.fillText(
    `${sim.map.name}   seed ${sim.seed}   ${(sim.tick / 60).toFixed(1)}s${zoomNote}`,
    14,
    ctx.canvas.height - 12
  );

  if (sim.over) {
    ctx.fillStyle = "rgba(16, 18, 24, 0.85)";
    ctx.fillRect(0, 140, ctx.canvas.width, 140);
    ctx.textAlign = "center";
    ctx.fillStyle = C.text;
    ctx.font = "20px ui-monospace, monospace";
    ctx.fillText(
      sim.gateHealth <= 0 ? "THE GATE HAS FALLEN" : "THE FIELD IS HELD",
      ctx.canvas.width / 2,
      196
    );
    ctx.font = "15px ui-monospace, monospace";
    ctx.fillStyle = C.moraleHigh;
    ctx.fillText(`${sim.score} points`, ctx.canvas.width / 2, 222);

    ctx.font = "12px ui-monospace, monospace";
    ctx.fillStyle = C.dim;
    ctx.fillText(
      `${sim.routed} broken · ${sim.destroyed} killed · ${sim.leaked} through · ` +
        `${sim.wavesCalled} waves called early`,
      ctx.canvas.width / 2,
      246
    );
    ctx.textAlign = "left";
  }
}

function drawVignette(ctx) {
  const { width, height } = ctx.canvas;
  const g = ctx.createRadialGradient(
    width / 2, height / 2, height * 0.35,
    width / 2, height / 2, height * 0.95
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export { isUnlocked };
