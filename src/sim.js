// The simulation: all the rules of the game, and nothing about how it looks.
//
// This file never touches the screen, the mouse, or the clock. It is a pure
// machine: given a state and a list of inputs, it produces the next state. That
// is why `node --test` can run the whole game with no browser — which is exactly
// what a verification server would do to check a submitted score.
//
// Two rules hold this together and must not be broken:
//
//   1. Everything advances in whole ticks (60 per second), never in real
//      seconds. Real time varies between machines; ticks do not.
//   2. The player never mutates this state directly. Every action arrives as a
//      recorded input, applied on the tick it belongs to. That list of inputs IS
//      the replay.

import { makeRng } from "./rng.js";
import { TOWERS, FAMILY_IDS, tierFor, isUnlocked, effectiveSpec } from "./towers.js";
import { UNITS } from "./units.js";
import { buildWaves } from "./waves.js";
import {
  MAPS, ROAD_HALF, pathLength, pointAt, distanceToPath, terrainAt, nearestOnPath,
} from "./maps.js";
import { TICKS_PER_SECOND, MIN_TOWER_GAP, FIELD_MARGIN } from "./constants.js";

export { TICKS_PER_SECOND };
export { ROAD_HALF } from "./maps.js";

// --- Tuning knobs ------------------------------------------------------------
const ROUT_SPEED = 95;      // fleeing is faster than marching — panic is quick
const MORALE_REGEN = 3.5;   // per second, once not hit for a moment
const STEADY_AFTER = 1.2;   // seconds without damage before they steady
const PANIC_BONUS = 9;      // extra morale lost per hit once badly thinned
const PANIC_AT = 2 / 3;     // "badly thinned" = below this share of full strength
const FANATIC_STEEL = 2.5;  // morale a fanatic GAINS per hit taken

const CASCADE_RADIUS = 180;
const CASCADE_MORALE = 18;

// Each additional regiment caught by the same blast takes less than the one
// before it. Without this, area damage scaled linearly with how tightly the road
// was packed — a Bell facing six regiments did six times the work of a Bell
// facing one — and since calling a wave early is precisely what packs the road,
// greed paid. It was not a trade at all: on seed 4242 with eight buildings the
// patient run ended on gate 43 having leaked 9, the greedy run on gate 196
// having leaked 1, and there was no defence size at which greed cost anything.
//
// Be honest about what this did NOT do. It was landed as the fix for greed and
// it is not one: it makes greed cost something in a narrow band of defence
// sizes, and the very next difficulty change moved the band and the defect came
// straight back. The real mechanism is that calling early front-loads income —
// the same enemies arrive sooner, so the same gold arrives sooner, and that
// compounds while wave overlap only adds up linearly. See the `todo` test.
//
// It stays regardless, because a crowd should not be free damage. It just is not
// the answer to greed.
const AREA_FALLOFF = 0.75;

// The most a gun can gain from Watchposts covering it, however many there are.
// Two of them, and no more — see supportAt.
const SUPPORT_CAP = { range: 0.44, damage: 0.36 };

// Troops find their nerve once, not endlessly. Letting them rally repeatedly
// produced a traffic jam at the entrance rather than drama.
const RALLY_AFTER = 6 * TICKS_PER_SECOND;
const RALLY_MIN_STRENGTH = 0.55;
const RALLY_MORALE_PENALTY = 30;

const START_GOLD = 150;
const GOLD_PER_SOLDIER = 8;

// Breaking a regiment used to pay a flat 25 while killing paid 8 for every man,
// so a 24-man levy was worth 192 gold killed and 25 broken. Forge therefore ran
// the whole battle on roughly six times Order's income, out-built it, and held
// 42 battles out of 42 while Order held 16 — an economy gap wearing a balance
// gap's clothes. Breaking now pays for the men who ran, because a regiment that
// throws down its shields and runs leaves the shields.
//
// Slightly less per man than killing: the field is looted either way, but a
// broken regiment carries some of its kit away and may come back wearing it.
const GOLD_PER_ROUTED_MAN = 5;

// --- Score -------------------------------------------------------------------
// Breaking is worth more than killing. Killing is the safe, slow answer;
// breaking is the fast, risky one, and the game should pay for nerve.
const SCORE_PER_ROUT = 100;
const SCORE_PER_DESTROY = 60;
const SCORE_PER_WAVE = 50;      // multiplied by the wave number
const SCORE_PER_LEAK = -120;

// Holding the gate has to be worth something, or the optimal line is to break as
// much as possible and let the wall fall. The balance harness caught exactly
// that: the top-scoring strategy lost 18 battles out of 18, and the only one
// that survived scored last. Awarded on victory only, scaled by what is left of
// the gate, so a narrow hold pays less than a clean one.
const SCORE_PER_GATE_KEPT = 9;

// Losing the gate has to cost real score, not merely forfeit a bonus. At 30 per
// gate point the survival award was about a quarter of a typical run, so playing
// recklessly and collapsing on the last wave still out-scored defending — the
// balance harness caught the inversion twice. Half the run is a price nobody
// can rationalise away.
const DEFEAT_SCORE_KEPT = 0.5;

// Calling a wave early is the whole reason a shared-seed ladder cannot be
// solved. Without it, everyone who plays perfectly ties; with it, score is an
// unbounded curve and the question becomes how much risk you will carry.
// The bonus scales with BOTH how early you called and how deep you are.
const GOLD_PER_SECOND_EARLY = 4;
const SCORE_PER_SECOND_EARLY = 12;

const FIELD_WIDTH = 960;
const FIELD_HEIGHT = 420;

/**
 * Build a fresh battle. Same map, same seed and same inputs in — same battle
 * out, always.
 */
export function createSim(seed, mapId = "longRoad") {
  const random = makeRng(seed);
  const map = MAPS[mapId] ?? MAPS.longRoad;

  return {
    seed,
    map,
    pathLength: pathLength(map.path),
    tick: 0,
    over: false,

    towers: [],
    regiments: [],
    shots: [],
    pulses: [],

    // Traps lying on the road, as distances ALONG it — the same coordinate a
    // regiment uses for how far it has walked, so setting one off is a
    // subtraction rather than a geometry problem. The only consumable thing in
    // the game: every other building is as good on the last wave as the first.
    charges: [],

    pending: buildWaves(random),
    nextSpawn: 0,

    inputs: [],
    nextInput: 0,

    // You never pick a creed. This is what you have built, and it decides who
    // you are.
    devotion: { ORDER: 0, FORGE: 0, WILD: 0 },

    gold: START_GOLD,
    score: 0,
    wavesCalled: 0,
    lastWaveSeen: -1,
    gateHealth: map.gateHealth,
    routed: 0,
    destroyed: 0,
    leaked: 0,
    rallied: 0,
    spikesSprung: 0,

    events: [],

    // Sound cues raised this tick, drained by the audio layer every frame.
    // Kept separate from `events` because most sounds should not clutter the
    // battle log. Nothing here can affect the simulation — a muted game and a
    // loud one play out identically, and a replay raises the same cues.
    sounds: [],

    nextRegimentId: 1,
  };
}

export function tiers(sim) {
  const out = {};
  for (const id of FAMILY_IDS) out[id] = tierFor(sim.devotion[id]);
  return out;
}

// --- Placement ---------------------------------------------------------------

/**
 * Can a tower go here? Used by the interface to colour the ghost and by the
 * simulation when it applies the input, so there is exactly one copy of the rule
 * and a replay always reaches the same verdict the live game did.
 */
export function canPlace(sim, towerId, x, y) {
  const spec = TOWERS[towerId];
  if (!spec) return { ok: false, reason: "no such tower" };
  if (!isUnlocked(spec, sim.devotion)) return { ok: false, reason: "not yet unlocked" };
  if (sim.gold < spec.cost) return { ok: false, reason: "not enough gold" };

  if (
    x < FIELD_MARGIN ||
    x > FIELD_WIDTH - FIELD_MARGIN ||
    y < FIELD_MARGIN ||
    y > FIELD_HEIGHT - FIELD_MARGIN
  ) {
    return { ok: false, reason: "off the field" };
  }

  if (distanceToPath(sim.map.path, x, y) <= ROAD_HALF) {
    return { ok: false, reason: "cannot build on the road" };
  }

  // Terrain decides what may stand where. A ship needs water; a watchpost needs
  // height; everything else needs plain ground and refuses both.
  const ground = terrainAt(sim.map, x, y);
  const needs = spec.terrain ?? null;
  if (needs !== ground) {
    if (needs === "water") return { ok: false, reason: "must be built on water" };
    if (needs === "mountain") return { ok: false, reason: "must be built on high ground" };
    if (ground === "water") return { ok: false, reason: "cannot build on water" };
    if (ground === "mountain") return { ok: false, reason: "cannot build on high ground" };
    return { ok: false, reason: `cannot build on ${ground}` };
  }

  for (const tower of sim.towers) {
    if (Math.hypot(tower.x - x, tower.y - y) < MIN_TOWER_GAP) {
      return { ok: false, reason: "too close to another tower" };
    }
  }

  return { ok: true };
}

// --- Calling waves early -----------------------------------------------------

/**
 * The next wave that has not started spawning, and how many ticks early it is.
 * Returns null when there is nothing left to call.
 */
export function nextCallable(sim) {
  const upcoming = sim.pending.slice(sim.nextSpawn);
  if (upcoming.length === 0) return null;

  const wave = upcoming[0].wave;
  const startsAt = Math.min(...upcoming.filter((s) => s.wave === wave).map((s) => s.tick));
  const early = startsAt - sim.tick;
  if (early <= 0) return null; // already arriving

  const seconds = early / TICKS_PER_SECOND;
  return {
    wave,
    early,
    seconds,
    gold: Math.round(seconds * GOLD_PER_SECOND_EARLY),
    score: Math.round(seconds * SCORE_PER_SECOND_EARLY * (wave + 1)),
  };
}

/** Record a call. Like placement, it goes through the input list so it replays. */
export function queueCallWave(sim) {
  if (!nextCallable(sim)) return { ok: false, reason: "nothing left to call" };
  sim.inputs.push({ tick: sim.tick + 1, type: "call" });
  return { ok: true };
}

/** Record a placement. It takes effect next tick, never immediately. */
export function queuePlacement(sim, towerId, x, y) {
  const check = canPlace(sim, towerId, x, y);
  if (!check.ok) return check;

  sim.inputs.push({
    tick: sim.tick + 1,
    type: "place",
    tower: towerId,
    x: Math.round(x),
    y: Math.round(y),
  });

  return { ok: true };
}

function applyDueInputs(sim) {
  while (sim.nextInput < sim.inputs.length && sim.inputs[sim.nextInput].tick <= sim.tick) {
    const input = sim.inputs[sim.nextInput];
    sim.nextInput += 1;

    if (input.type === "call") {
      const call = nextCallable(sim);
      if (!call) continue; // the wave arrived on its own before this applied

      // Pull the whole remaining schedule forward. Everything after the called
      // wave moves too, so calling early genuinely compresses the battle rather
      // than just fetching one wave and leaving a gap behind it.
      for (let i = sim.nextSpawn; i < sim.pending.length; i++) {
        sim.pending[i].tick -= call.early;
      }

      sim.gold += call.gold;
      sim.score += call.score;
      sim.wavesCalled += 1;
      sound(sim, "call");
      say(
        sim,
        `Wave ${call.wave + 1} called ${call.seconds.toFixed(1)}s early — ` +
          `+${call.gold} gold, +${call.score} points.`,
        true
      );
      continue;
    }

    if (input.type !== "place") continue;
    if (!canPlace(sim, input.tower, input.x, input.y).ok) continue;

    const spec = TOWERS[input.tower];
    sim.gold -= spec.cost;

    const tower = { spec, x: input.x, y: input.y, cooldown: 0 };
    // A trap layer works on one stretch of road — the nearest one — and where
    // that is never changes, so it is resolved once here rather than every tick.
    if (spec.spikes) {
      tower.roadDist = nearestOnPath(sim.map.path, input.x, input.y).along;
      tower.stock = 0;
      tower.layTimer = 0; // the first charge goes down immediately
    }
    sim.towers.push(tower);
    sound(sim, "build");

    if (spec.family) {
      const before = tierFor(sim.devotion[spec.family]);
      sim.devotion[spec.family] += 1;
      const after = tierFor(sim.devotion[spec.family]);

      say(sim, `${spec.name} raised.`);
      if (after > before) {
        sound(sim, "devotion");
        // Carry the creed and tier on the event so the interface can attach the
        // right lore line without parsing English back out of the text.
        const event = { creed: spec.family, tier: after };
        say(sim, `Your devotion to ${spec.family} deepens — tier ${after}.`, true, event);
      }
    } else {
      say(sim, `${spec.name} raised.`);
    }
  }
}

// --- The tick ----------------------------------------------------------------

export function step(sim) {
  if (sim.over) return;

  sim.tick += 1;

  applyDueInputs(sim);
  spawnDue(sim);
  layCharges(sim);
  moveRegiments(sim);
  // After movement, not before: a regiment should set off what it has just
  // walked onto, in the same tick it walked onto it.
  springTraps(sim);
  siegeAttacks(sim);
  fireTowers(sim);
  moveShots(sim);
  agePulses(sim);
  recoverMorale(sim);
  tryRally(sim);
  checkEnd(sim);
}

function spawnDue(sim) {
  while (sim.nextSpawn < sim.pending.length && sim.pending[sim.nextSpawn].tick <= sim.tick) {
    const { unit, wave } = sim.pending[sim.nextSpawn];
    sim.nextSpawn += 1;
    sim.regiments.push(makeRegiment(sim, sim.nextRegimentId++, UNITS[unit], wave));

    // Surviving to see a wave arrive is worth points, and deeper waves are
    // worth more — which is what makes calling them early tempting.
    if (wave !== sim.lastWaveSeen) {
      sim.lastWaveSeen = wave;
      sim.score += SCORE_PER_WAVE * (wave + 1);
    }
  }
}

/**
 * How much tougher a regiment is for arriving late in the battle.
 *
 * This is the difficulty curve, and it deliberately scales ARMOUR and MORALE
 * while leaving `men` alone. That asymmetry is the whole trick. Gold is paid per
 * man killed and per man routed, so scaling men would hand the defence the exact
 * funding it needs to answer them — which is why every previous attempt failed:
 * more enemies, bigger waves and two extra waves all made the game *easier*,
 * because the defence's power is proportional to its income and its income is
 * proportional to how much walks onto the road.
 *
 * Armour is the one stat that taxes the defence without paying it: it blunts
 * every hit, so each shot kills fewer men, which is simultaneously less gold and
 * more time. Morale does the same to the breaking half of the game.
 */
const WAVE_ARMOUR_STEP = 8;      // +1 armour every this many waves
const WAVE_MORALE_GROWTH = 0.05; // compounding, per wave

// And the other half of the curve, which is the one that actually works: a
// regiment arriving late is worth LESS. Gold is the whole game — the defence's
// power is proportional to its income and its income is proportional to what
// walks onto the road, which is why adding enemies has never once made this
// game harder. Paying less for late arrivals breaks that loop directly, and it
// does it without touching a single combat number, so no creed gets walled out
// of hurting anything. Scaling armour hard was tried instead and did exactly
// that: Wild went from 42 held out of 42 to 17, because +3 armour is nothing to
// a Bombard doing nine and a total wall to a Bloodthorn doing two.
const WAVE_LOOT_DECAY = 0.05;    // per wave, compounding
const WAVE_LOOT_FLOOR = 0.35;    // never worth nothing, or killing stops paying

function toughness(wave) {
  return {
    armour: WAVE_ARMOUR_STEP ? Math.floor(wave / WAVE_ARMOUR_STEP) : 0,
    morale: (1 + WAVE_MORALE_GROWTH) ** wave,
    loot: Math.max(WAVE_LOOT_FLOOR, (1 - WAVE_LOOT_DECAY) ** wave),
  };
}

function makeRegiment(sim, id, type, wave = 0) {
  const start = pointAt(sim.map.path, 0);
  const older = toughness(wave);
  const morale =
    type.morale === null ? null : Math.round(type.morale * older.morale);

  return {
    id,
    type,
    wave,           // kept so anything it spawns inherits the same hardness
    dist: 0,        // how far along the road they have walked
    x: start.x,
    y: start.y,
    men: type.men,
    maxMen: type.men,
    // Carried on the regiment rather than read off the type, because the same
    // Levy is a different proposition on wave 15 than on wave 1 and the type is
    // shared by every one of them.
    armour: type.armour + older.armour,
    loot: older.loot,
    morale,
    moraleMax: morale,
    state: "advancing",
    lastHitTick: -9999,
    hasRallied: false,
  };
}

function moveRegiments(sim) {
  for (const r of sim.regiments) {
    if (r.state === "gone") continue;

    if (r.state === "advancing") {
      // Snare ground buys time, which nothing else in the game sells.
      let slow = 0;
      for (const tower of sim.towers) {
        if (!tower.spec.slow) continue;
        if (Math.hypot(tower.x - r.x, tower.y - r.y) <= tower.spec.range) {
          slow = Math.max(slow, tower.spec.slow);
        }
      }
      r.slowed = slow > 0;
      r.dist += (r.type.speed * (1 - slow)) / TICKS_PER_SECOND;

      if (r.dist >= sim.pathLength) {
        sim.gateHealth -= r.men;
        sim.leaked += 1;
        sim.score += SCORE_PER_LEAK;
        r.state = "gone";
        sound(sim, "gate_hit");
        say(sim, `${r.type.name} ${r.id} reached the gate — ${r.men} through.`, true);
        continue;
      }
    } else if (r.state === "routing") {
      r.dist -= ROUT_SPEED / TICKS_PER_SECOND;

      if (r.dist <= 0) {
        r.state = "gone";
        say(sim, `${r.type.name} ${r.id} fled the field.`);
        continue;
      }
    }

    const point = pointAt(sim.map.path, r.dist);
    r.x = point.x;
    r.y = point.y;
  }
}

// --- Traps -------------------------------------------------------------------

/**
 * Trap layers restock the road. Slowly, and up to a cap, so the field is a
 * buffer that a heavy wave can strip rather than a wall that always holds.
 */
function layCharges(sim) {
  for (const tower of sim.towers) {
    const kit = tower.spec.spikes;
    if (!kit) continue;

    if (tower.layTimer > 0) {
      tower.layTimer -= 1;
      continue;
    }
    if (tower.stock >= kit.max) continue;

    tower.layTimer = kit.every;
    tower.stock += 1;
    // Charges are spread along the stretch the layer covers rather than piled on
    // one spot, so a single regiment cannot eat the whole stockpile in one step.
    const offset = ((tower.stock - 1) % kit.max) * (kit.reach * 0.9) - kit.reach;
    sim.charges.push({
      tower,
      at: Math.max(0, Math.min(sim.pathLength - 1, tower.roadDist + offset)),
      born: sim.tick,
    });
  }
}

/**
 * Anything standing on a charge sets it off. Advancing only — a routing
 * regiment is running back over ground it has already cleared, and charging a
 * player's spikes for the privilege of watching them flee would be perverse.
 */
function springTraps(sim) {
  if (sim.charges.length === 0) return;

  const survivors = [];

  for (const charge of sim.charges) {
    const reach = charge.tower.spec.spikes.reach;
    let victim = null;

    // Whoever is furthest along, so the leading rank takes it — the same
    // targeting rule the towers use, for the same reason.
    for (const r of sim.regiments) {
      if (r.state !== "advancing") continue;
      if (Math.abs(r.dist - charge.at) > reach) continue;
      if (!victim || r.dist > victim.dist) victim = r;
    }

    if (!victim) {
      survivors.push(charge);
      continue;
    }

    const kit = charge.tower.spec.spikes;
    applyHit(sim, victim, {
      soldierDamage: kit.damage,
      moraleDamage: 0, // ground is not frightening, it is only expensive
      pierce: kit.pierce,
      splash: 0,
    });
    charge.tower.stock = Math.max(0, charge.tower.stock - 1);
    sound(sim, "spikes");
    sim.spikesSprung += 1;
  }

  sim.charges = survivors;
}

// --- Shooting ----------------------------------------------------------------

/**
 * Siege Towers shoot back. Nothing else in the game does, and it means a
 * defence can no longer be built once and then ignored — you have to protect
 * the things protecting you.
 */
function siegeAttacks(sim) {
  for (const r of sim.regiments) {
    const siege = r.type.attacksTowers;
    if (!siege || r.state !== "advancing") continue;

    r.siegeCooldown = (r.siegeCooldown ?? siege.reload) - 1;
    if (r.siegeCooldown > 0) continue;
    r.siegeCooldown = siege.reload;

    // Hit the nearest building in range.
    let target = null;
    let best = Infinity;
    for (const tower of sim.towers) {
      const d = Math.hypot(tower.x - r.x, tower.y - r.y);
      if (d <= siege.range && d < best) {
        best = d;
        target = tower;
      }
    }
    if (!target) continue;

    sim.towers = sim.towers.filter((t) => t !== target);
    if (target.spec.family) {
      sim.devotion[target.spec.family] = Math.max(
        0, sim.devotion[target.spec.family] - 1
      );
    }
    sound(sim, "tower_lost");
    say(sim, `${target.spec.name} destroyed by ${r.type.name} ${r.id}.`, true);
  }
}

/**
 * What a Watchpost adds to a tower standing inside its radius. Support stacks
 * additively, so two watchposts covering the same gun are worth building.
 */
function supportAt(sim, x, y) {
  let range = 0;
  let damage = 0;
  for (const other of sim.towers) {
    const s = other.spec.support;
    if (!s) continue;
    if (Math.hypot(other.x - x, other.y - y) > other.spec.range) continue;
    range += s.rangeBonus;
    damage += s.damageBonus;
  }
  // Capped, and it was not before. Watchposts stacked without limit, so on maps
  // with a lot of high ground the bot built thirty-one of them and every gun
  // underneath collected several hundred percent of its damage and reach for
  // free. Two watchposts' worth is the whole benefit now; a third pair of eyes
  // does not double what the first pair told you.
  //
  // Being honest about what this bought: nothing measurable. It was tried as a
  // fix for the three maps the difficulty audit found unopposed and moved them by
  // a single point. It stays anyway, because an unbounded multiplier that the bot
  // happens not to exploit decisively is still an unbounded multiplier, and a
  // player who finds it would not be so restrained.
  return {
    range: Math.min(range, SUPPORT_CAP.range),
    damage: Math.min(damage, SUPPORT_CAP.damage),
  };
}

function fireTowers(sim) {
  for (const tower of sim.towers) {
    // Watchposts, snares and trap layers never fire. They do their work by
    // existing, or by what they leave on the ground.
    if (tower.spec.support || tower.spec.slow || tower.spec.spikes) continue;

    const base = effectiveSpec(tower.spec, sim.devotion);
    const boost = supportAt(sim, tower.x, tower.y);
    const spec = {
      ...base,
      range: base.range * (1 + boost.range),
      soldierDamage: base.soldierDamage * (1 + boost.damage),
      moraleDamage: base.moraleDamage * (1 + boost.damage),
    };

    if (tower.cooldown > 0) {
      tower.cooldown -= 1;
      continue;
    }

    if (spec.pulse) {
      const inRange = regimentsInRange(sim, tower, spec.range);
      if (inRange.length === 0) continue;

      tower.cooldown = spec.reload;
      sim.pulses.push({ x: tower.x, y: tower.y, radius: spec.range, life: 18 });
      sound(sim, `fire_${tower.spec.id}`);

      // Furthest along the road takes the full hit, and everyone behind them
      // gets progressively less. Two reasons for that order rather than any
      // other: it is the same "most urgent threat" rule `pickTarget` already
      // uses, and it is total and deterministic — `dist` ties are broken by id,
      // which is unique and handed out in spawn order — so a replay re-runs to
      // the identical battle. An unstable sort here would break verification
      // silently, which is the worst way for it to break.
      inRange.sort((a, b) => b.dist - a.dist || a.id - b.id);

      let scale = 1;
      for (const r of inRange) {
        applyHit(sim, r, spec, scale);
        scale *= AREA_FALLOFF;
      }
      continue;
    }

    const target = pickTarget(sim, tower, spec.range);
    if (!target) continue;

    tower.cooldown = spec.reload;
    sound(sim, `fire_${tower.spec.id}`);
    sim.shots.push({ x: tower.x, y: tower.y, targetId: target.id, spec, speed: 420 });
  }
}

function regimentsInRange(sim, tower, range) {
  const found = [];
  for (const r of sim.regiments) {
    if (r.state !== "advancing") continue;
    if (Math.hypot(r.x - tower.x, r.y - tower.y) <= range) found.push(r);
  }
  return found;
}

// Towers shoot whoever is furthest along the road — the most urgent threat.
// Routing regiments are ignored: they are already beaten, and wasting shots on
// them is a mistake the game should let you make.
function pickTarget(sim, tower, range) {
  let best = null;
  for (const r of regimentsInRange(sim, tower, range)) {
    if (!best || r.dist > best.dist) best = r;
  }
  return best;
}

function moveShots(sim) {
  const stillFlying = [];

  for (const shot of sim.shots) {
    const target = sim.regiments.find((r) => r.id === shot.targetId);

    // Target died or broke before the shot landed. The shot is wasted — the
    // cost of over-committing to a regiment that was about to break anyway.
    if (!target || target.state !== "advancing") continue;

    const dx = target.x - shot.x;
    const dy = target.y - shot.y;
    const distance = Math.hypot(dx, dy);
    const travel = shot.speed / TICKS_PER_SECOND;

    if (distance <= travel) {
      applyHit(sim, target, shot.spec);

      if (shot.spec.splash > 0) {
        const caught = [];
        for (const other of sim.regiments) {
          if (other === target || other.state !== "advancing") continue;
          if (Math.hypot(other.x - target.x, other.y - target.y) <= shot.spec.splash) {
            caught.push(other);
          }
        }

        // Same ordering rule as a pulse, and the same reason. The regiment that
        // was actually aimed at keeps its full hit above; only the neighbours
        // decay, so a blast that catches one bystander behaves exactly as it
        // always did and only genuine crowds are worth less.
        caught.sort((a, b) => b.dist - a.dist || a.id - b.id);

        let scale = 0.5;
        for (const other of caught) {
          applyHit(sim, other, shot.spec, scale);
          scale *= AREA_FALLOFF;
        }
      }
    } else {
      shot.x += (dx / distance) * travel;
      shot.y += (dy / distance) * travel;
      stillFlying.push(shot);
    }
  }

  sim.shots = stillFlying;
}

function agePulses(sim) {
  sim.pulses = sim.pulses.filter((p) => (p.life -= 1) > 0);
}

// --- The heart of the game ---------------------------------------------------

/**
 * A hit lands. It does two things at once: kills men, and breaks will. A
 * regiment can be stopped either way — wipe it out, or scare it off.
 */
function applyHit(sim, r, spec, scale = 1) {
  r.lastHitTick = sim.tick;

  // Armour is subtracted from every hit, so anything doing less damage than a
  // regiment's armour does exactly nothing — a wall rather than a gradient.
  // That is deliberate and it is why `pierce` exists: it is subtracted from the
  // armour, never added to the damage, so a piercing weapon is transformed
  // against plate and unchanged against a farmer in a shirt.
  // `r.armour`, not `r.type.armour` — a regiment carries its own, because the
  // difficulty curve hardens late arrivals and the type is shared by all of them.
  const armour = Math.max(0, r.armour - (spec.pierce ?? 0));
  const soldierDamage = Math.max(0, Math.round(spec.soldierDamage * scale) - armour);
  if (soldierDamage > 0) {
    r.men -= soldierDamage;
    sim.gold += Math.round(soldierDamage * GOLD_PER_SOLDIER * (r.loot ?? 1));
  }

  if (r.men <= 0) {
    r.men = 0;
    r.state = "gone";
    sim.destroyed += 1;
    sim.score += SCORE_PER_DESTROY;
    sound(sim, "destroy");
    say(sim, `${r.type.name} ${r.id} destroyed to the last man.`, true);
    comeApart(sim, r);
    return;
  }

  // Machines have no morale. Nothing below this line applies to them, and that
  // absence is the entire "it cannot be frightened" behaviour.
  if (r.morale === null) return;

  let moraleLoss = spec.moraleDamage * scale;

  if (r.type.fanatic) {
    // Zealots invert the whole mechanic: casualties steel them rather than
    // shaking them, so a thinned unit is HARDER to break. You have to kill them.
    if (r.men <= r.maxMen * PANIC_AT) moraleLoss = Math.max(0, moraleLoss - PANIC_BONUS);
    r.morale = Math.min(r.moraleMax, r.morale + FANATIC_STEEL * scale);
  } else if (r.men <= r.maxMen * PANIC_AT) {
    moraleLoss += PANIC_BONUS;
  }

  r.morale -= moraleLoss;
  clampMorale(sim, r);

  if (r.morale <= 0) break_(sim, r);
}

/**
 * Some things do not die. They come apart, and the pieces keep walking.
 *
 * This exists to give the game a MIDDLE. Across 175 battles a winning run never
 * dropped below ~94% of its gate on any map: a defence that covered the road
 * took no damage at all, and one that did not collapsed outright. There was no
 * state where you held but were hurt, because nothing could half-get-through.
 * Splitting is that state — you stop the thing in front of you and some of it
 * still arrives.
 *
 * It also asks the one question nothing else in the game asks. Killing a
 * splitter is WORSE than breaking it: break its will and it flees whole, kill it
 * and you have made three fast problems out of one slow one. Every other enemy
 * rewards whichever answer you happen to own. This one punishes the answer that
 * has never been punished — Forge kills, and killing is the wrong tool here.
 *
 * Fragments never split again (they are a different unit with no `splitsInto`),
 * so this terminates. Ids come from the same counter as everything else, so a
 * replay reproduces the pieces exactly.
 */
function comeApart(sim, r) {
  const split = r.type.splitsInto;
  if (!split) return;

  const type = UNITS[split.unit];
  for (let i = 0; i < split.count; i++) {
    const piece = makeRegiment(sim, sim.nextRegimentId++, type, r.wave ?? 0);
    // Strung out slightly behind where the parent fell rather than stacked on
    // one point, so they read as a scatter and cannot all be caught by a single
    // blast for free.
    piece.dist = Math.max(0, r.dist - i * 14);
    const at = pointAt(sim.map.path, piece.dist);
    piece.x = at.x;
    piece.y = at.y;
    sim.regiments.push(piece);
  }

  sound(sim, "split");
  say(sim, `${r.type.name} ${r.id} comes apart — ${split.count} ${type.name} spill out.`, true);
}

function break_(sim, r) {
  r.morale = 0;
  r.state = "routing";
  sim.routed += 1;
  sim.gold += Math.round(r.men * GOLD_PER_ROUTED_MAN * (r.loot ?? 1));
  sim.score += SCORE_PER_ROUT;
  sound(sim, "rout");
  say(sim, `${r.type.name} ${r.id} BROKE — ${r.men} men turn and run.`, true);

  // Panic spreads. Watching a regiment break shakes everyone who can see it,
  // and that is how one well-placed collapse takes a whole wave with it.
  for (const other of sim.regiments) {
    if (other === r || other.state !== "advancing" || other.morale === null) continue;
    if (Math.hypot(other.x - r.x, other.y - r.y) > CASCADE_RADIUS) continue;

    other.morale -= CASCADE_MORALE;
    clampMorale(sim, other);
    if (other.morale <= 0) break_(sim, other); // cascades can chain
  }
}

/**
 * Keep morale inside its legal range. Every change goes through here, because a
 * bearer's floor must hold no matter *how* morale moved — damage, cascade, rally
 * or recovery.
 */
function clampMorale(sim, r) {
  if (r.morale === null) return;
  const floor = auraFloor(sim, r);
  const ceiling = Math.max(r.moraleMax, floor);
  if (r.morale < floor) r.morale = floor;
  if (r.morale > ceiling) r.morale = ceiling;
}

/** The highest morale floor projected onto this regiment by a living bearer. */
function auraFloor(sim, r) {
  let floor = 0;
  for (const other of sim.regiments) {
    if (other === r || other.state !== "advancing" || !other.type.auraRadius) continue;
    if (Math.hypot(other.x - r.x, other.y - r.y) > other.type.auraRadius) continue;
    if (other.type.auraFloor > floor) floor = other.type.auraFloor;
  }
  return floor;
}

// Left alone, troops steady themselves. This is what makes sustained pressure
// matter more than occasional damage — and why where you build matters.
function recoverMorale(sim) {
  const steadyAfterTicks = STEADY_AFTER * TICKS_PER_SECOND;

  for (const r of sim.regiments) {
    if (r.state !== "advancing" || r.morale === null) continue;
    if (sim.tick - r.lastHitTick < steadyAfterTicks) continue;

    let regen = MORALE_REGEN;
    for (const other of sim.regiments) {
      if (other === r || other.state !== "advancing" || !other.type.auraRegen) continue;
      if (Math.hypot(other.x - r.x, other.y - r.y) <= other.type.auraRadius) {
        regen += other.type.auraRegen;
      }
    }

    r.morale += regen / TICKS_PER_SECOND;
    clampMorale(sim, r);
  }
}

// Broken troops who get away clean find their nerve — once — and come back with
// less of it than before. Finish them, or meet them again.
/** Is a Warlord close enough to drag this regiment back onto its feet? */
function warlordNear(sim, r) {
  for (const other of sim.regiments) {
    if (other === r || other.state !== "advancing" || !other.type.rallies) continue;
    if (Math.hypot(other.x - r.x, other.y - r.y) <= other.type.auraRadius) return true;
  }
  return false;
}

function tryRally(sim) {
  for (const r of sim.regiments) {
    if (r.state !== "routing" || r.morale === null || r.hasRallied) continue;

    // A Warlord rallies broken men on the spot — no waiting, no strength test.
    // He is the answer to a defence built entirely on breaking will.
    const forced = warlordNear(sim, r);
    if (!forced && sim.tick - r.lastHitTick < RALLY_AFTER) continue;
    if (!forced && r.men < r.maxMen * RALLY_MIN_STRENGTH) continue;

    r.hasRallied = true;
    r.moraleMax = Math.max(20, r.moraleMax - RALLY_MORALE_PENALTY);
    r.morale = r.moraleMax;
    r.state = "advancing";
    clampMorale(sim, r);
    sim.rallied += 1;
    sound(sim, "rally");
    say(sim, `${r.type.name} ${r.id} RALLIED and turns back.`, true);
  }
}

function checkEnd(sim) {
  const anyAlive = sim.regiments.some((r) => r.state !== "gone");
  const allSpawned = sim.nextSpawn >= sim.pending.length;

  if (sim.gateHealth <= 0) {
    sim.gateHealth = 0;
    sim.over = true;
    const lost = sim.score - Math.floor(sim.score * DEFEAT_SCORE_KEPT);
    sim.score = Math.floor(sim.score * DEFEAT_SCORE_KEPT);
    sound(sim, "defeat");
    say(sim, `The gate has fallen. ${lost} points lost with it.`, true);
  } else if (!anyAlive && allSpawned) {
    sim.over = true;
    const bonus = sim.gateHealth * SCORE_PER_GATE_KEPT;
    sim.score += bonus;
    sound(sim, "victory");
    say(
      sim,
      `The field is held. Broken ${sim.routed}, killed ${sim.destroyed}. ` +
        `Gate intact: +${bonus} points.`,
      true
    );
  }
}

function say(sim, text, big = false, extra = null) {
  sim.events.push({ text, big, tick: sim.tick, ...extra });
}

/** Raise a sound cue. Purely cosmetic — never read back by the simulation. */
function sound(sim, name) {
  sim.sounds.push(name);
}

/** Everything a score submission would need in order to be checked. */
export function summary(sim) {
  return {
    seed: sim.seed,
    map: sim.map.id,
    ticks: sim.tick,
    score: sim.score,
    wavesCalled: sim.wavesCalled,
    gateHealth: sim.gateHealth,
    routed: sim.routed,
    destroyed: sim.destroyed,
    leaked: sim.leaked,
    rallied: sim.rallied,
    gold: sim.gold,
    devotion: { ...sim.devotion },
  };
}
