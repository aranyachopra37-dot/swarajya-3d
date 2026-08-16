// The Pretender — a ladder of opponents rather than one opponent.
//
// Two rules every tier must obey, and they matter more than how well any of them
// plays:
//
//   1. It acts ONLY through the same queued inputs a human uses. It never
//      touches simulation state directly. That keeps a match against the AI
//      exactly as replayable and verifiable as a match against a person, and the
//      eventual "train your own commander" idea inherits the property for free.
//   2. It is a pure function of the simulation state. No clock, no randomness of
//      its own — same state in, same decision out, or replays diverge.
//
// THE DESIGN RULE FOR THE LADDER: a higher tier is better at PLAYING, not richer.
// Handing the opponent free gold is the cheap way to make it hard and it feels
// exactly like being cheated, because you are. Every tier below the last spends
// the same coins you do; what changes is how fast it reacts, how many peasants
// it commits to, whether it masses its army before attacking, and whether it
// comes home when its base is burning. Only the top tier takes a handicap, and
// it says so on the tin.
//
// WHAT CHANGED WITH THE PEASANT ECONOMY
//
// Gold no longer falls out of buildings, so "build four mines" is not a strategy
// any more — the tiers are now separated by how many PEASANTS they raise and how
// well they keep them working, which is much closer to what actually separates
// RTS players. And because nothing marches on its own now, every tier has to
// issue real attack orders; a tier that forgets to is a tier that never attacks
// at all, which is a much louder failure than the old one.
//
// `tools/ladder.mjs` plays every tier against the one below it and fails if the
// ladder is not monotonic. A difficulty setting nobody has measured is a guess.
//
// NO TIER BUILDS A FACTORY, AND BOTH ATTEMPTS ARE WORTH RECORDING.
//
// Giving the Warden a Factory and two rams INVERTED its rung: 8/8 against the
// Castellan became 0/8. Six hundred gold and a peasant's time went into engines
// that are slow, that nothing escorts, and that have nothing to break — no AI
// builds walls, and siege with no wall in front of it is an expensive slow
// soldier.
//
// Giving it only to the Pretender kept the ladder monotonic and broke something
// quieter: the mirror-fairness test went from a spread to 6/6 for one seat.
// Without the factory the same tier is 3/7. Rams hunt structures rather than
// men, and structure targeting breaks ties on the lower id — which is
// systematically one seat's buildings. It was not a big enough effect to see
// until something started aiming at buildings on purpose.
//
// So siege is a PLAYER tool until an opponent exists that walls, and until that
// tie-break is fixed. Handing a tier a toy it cannot use is not difficulty.

import {
  BUILDINGS, UNITS, canBuild, queueBuild, queueTrain, queueOrder, queueAttack,
  goldSeams, ringAround, canAfford, canRaise, queueRaise, manorTier, PATHS,
} from "./sim.js";
import {
  toTile, tileCentre, FOREST, WATER, ROCK, flowField, idx, UNREACHABLE,
} from "./grid.js";

/**
 * WHICH GARLAND EACH OPPONENT PURSUES, AND WHY TWO OF THEM PURSUE NONE.
 *
 * The bottom two never reach a Keep, so a path would be a field they could not
 * use. Above that the choice is part of the opponent's character: the Castellan
 * takes Vanashira, the steadfast path, matching a tier whose whole description is
 * holding what it has. The Pretender takes Matrika, because the top of the ladder
 * should be the one that arrives before you are ready.
 *
 * THE WARDEN TAKES ABHEDA, AND THAT REVERSES A DECISION RECORDED ABOVE.
 *
 * The note at the top of this file says no tier builds a Factory, because rams
 * are slow, nothing escorts them, and — the load-bearing half — they had nothing
 * to break: no AI builds walls, so siege was an expensive slow soldier.
 *
 * Both halves of that reason expired. Structure targeting no longer breaks ties
 * on the lower id, which was the other objection. And halls now have tiers: a
 * Castle behind a Vanashira bonus is 6,500 points of stone that shoots back, which
 * is precisely a thing to break. Measured, the gap it left was loud — Kingsmoor
 * went from 3/3 decided to 0/3, ending 14v0 and 16v0, one side with no army at
 * all and still unable to finish the other in twenty-five minutes.
 *
 * The answer to stone is engines, and Kankala — the undivided — is the path that
 * carries them. A tier that must crack the Castellan's Vanashira wall is exactly
 * the tier that should own the tool for it.
 */

/**
 * FARMS ARE A TIER KNOB, NOT A CONSTANT.
 *
 * They were fixed at two for everybody, and the ladder measured the cost: the
 * Castellan beat the Marcher Lord only 58% with five draws, because it builds
 * more barracks and a stables and then cannot feed what they make. Wanting a
 * bigger army with the same food ceiling is not a harder opponent, it is a
 * hungrier one — every tier above needs the grain to match its ambition, the
 * same way it already gets the barracks to match it.
 */
export const TIERS = [
  {
    name: "Praja Nayaka (Militia Leader)",
    blurb: "Works three peasants and sends levies at your border the moment they muster.",
    thinkEvery: 24,   // slow to react
    peasants: 4,
    barracks: 1,
    farms: 1,
    tier: 0,
    path: null,
    stables: 0,
    towers: 0,
    massAt: 1,        // never waits — attacks with whatever exists
    defend: false,
    handicap: 1,
  },
  {
    name: "Durgadhyaksha (Fortress Commander)",
    blurb: "Deepens mining operations, raises watch towers, and marches with a disciplined vanguard.",
    thinkEvery: 16,
    peasants: 7,
    barracks: 1,
    farms: 1,
    tier: 1,
    path: null,
    stables: 0,
    towers: 1,
    massAt: 5,
    defend: true,
    handicap: 1,
  },
  {
    name: "Dandanayaka (Marshal of the Host)",
    blurb: "Balances resource logistics with military expansion, pursuing the steadfast Vanashira path.",
    thinkEvery: 10,
    peasants: 10,
    barracks: 2,
    farms: 2,
    tier: 1,
    path: "vanashira",
    stables: 1,
    towers: 2,
    massAt: 8,
    defend: true,
    handicap: 1,
  },
  {
    name: "Maha Senapati (Grand Commander)",
    blurb: "Expands to outer gold veins, fields cavalry and siege rams under the Kankala banner.",
    thinkEvery: 6,
    peasants: 14,
    barracks: 2,
    farms: 3,
    tier: 2,
    path: "kankala",
    rams: 2,
    stables: 1,
    towers: 2,
    massAt: 11,
    defend: true,
    handicap: 1,
  },
  {
    name: "Indra-Parikshaka (The Divine Examiner)",
    blurb: "A rigorous cosmic trial testing the seeker's strategic mastery with overwhelming economic output.",
    thinkEvery: 4,
    peasants: 18,
    barracks: 3,
    farms: 4,
    tier: 2,
    path: "matrika",
    stables: 2,
    towers: 3,
    massAt: 14,
    defend: true,
    handicap: 1.35,
  },
];

export const MAX_TIER = TIERS.length - 1;

/** Clamp into the ladder, so a saved progress value can never break a match. */
export const tierAt = (n) => TIERS[Math.max(0, Math.min(MAX_TIER, n | 0))];

/**
 * The enemy manor this player should be thinking about.
 *
 * `sim.buildings.find(b => b.owner !== owner && b.spec.isHeart)` is what this
 * was, and it takes the FIRST one in the array — which is creation order, which
 * is seat order. With two players that is the only enemy and the bug is
 * invisible. With three, every AI on the map would have picked seat 0 and
 * ganged up on them for no reason but array order, every game, and it would have
 * looked like a deliberate rule.
 *
 * Nearest, then by seat as a tiebreak so two peers cannot disagree.
 */
function nearestEnemyHeart(sim, owner, from) {
  const hearts = sim.buildings.filter((b) => b.owner !== owner && b.spec.isHeart);
  if (hearts.length === 0) return null;
  if (hearts.length === 1) return hearts[0];

  const d2 = (b) => (b.x - from.x) ** 2 + (b.y - from.y) ** 2;
  let nearest = Infinity;
  for (const b of hearts) nearest = Math.min(nearest, d2(b));

  // NEARLY AS NEAR IS AS NEAR.
  //
  // Strict "nearest" looks obviously right and produced the same match every
  // time. Three Crowns cannot be an exactly equilateral triangle on a square
  // grid — its base is 60.00 tiles and its sides are 60.03 — so seats 1 and 2
  // were each other's nearest enemy by THREE HUNDREDTHS OF A TILE. They duelled,
  // seat 0 attacked the loser, and seat 0 won twelve matches out of twelve at
  // identical times. A distance no player could perceive decided every game.
  //
  // So anything within a fifth of the nearest counts as equally near, and the
  // choice among them turns on the seed. Deterministic — seed and owner are
  // shared state both peers agree on — but no longer a foregone conclusion.
  const CLOSE_ENOUGH = 1.2 * 1.2;
  const close = hearts
    .filter((b) => d2(b) <= nearest * CLOSE_ENOUGH)
    .sort((a, b) => a.owner - b.owner);

  return close[(sim.seed + owner) % close.length];
}

/**
 * Run one opponent's turn.
 *
 * `tier` may be an index or a tier object, so callers can pass either a saved
 * number or a bespoke commander.
 */
export function think(sim, owner = 1, tier = 0) {
  if (sim.over) return;

  const cfg = typeof tier === "number" ? tierAt(tier) : tier;
  if (sim.tick % cfg.thinkEvery !== 0) return;

  const mine = sim.buildings.filter((b) => b.owner === owner);
  const heart = mine.find((b) => b.spec.isHeart);
  if (!heart) return;

  const enemyHeart = nearestEnemyHeart(sim, owner, heart);

  labour(sim, owner, heart);
  span(sim, owner, heart, enemyHeart);
  economy(sim, owner, cfg, mine, heart, enemyHeart);
  production(sim, owner, cfg, mine);
  command(sim, owner, cfg, heart, enemyHeart);
}

// --- Getting to the enemy at all ---------------------------------------------

/**
 * IF YOU CANNOT WALK TO THEM, BUILD A ROAD.
 *
 * The Sunder is two landmasses with a strait between them, and it was the last
 * map in the game that could never finish: 0/3 decided at every cap we ever
 * measured, with both players at forty units and neither able to reach the
 * other. That is not an economy failure and it is not a combat failure. The AI
 * simply had no concept of a place it could not walk to, so it massed an army
 * for twenty-five minutes and then stood on its own beach with it.
 *
 * The mechanic to fix it already existed and nothing used it. A bridge is built
 * one tile at a time and a finished tile is walkable ground, so a span GROWS
 * from the shore by itself: lay the first segment against your own bank, and
 * when it stands, the next tile out is reachable and can be laid in turn.
 * Nobody had to write a bridge-planner — the AI only has to keep asking "what is
 * the nearest water I can reach that gets me closer to them", and the strait
 * closes itself.
 */

/** How often to ask the expensive question. A strait does not move. */
const REACH_EVERY = 200;

function span(sim, owner, heart, enemyHeart) {
  if (!enemyHeart) return;
  if (sim.tick % REACH_EVERY !== 0) return;
  // One span at a time. A second foundation on the water while the first is
  // half-built just splits the crew across two things neither of which finishes.
  if (sim.sites.some((s) => s.owner === owner && s.spec.spans)) return;
  if (!canAfford(sim.players[owner], BUILDINGS.bridge)) return;

  // Can we already get there? A full field from the enemy hall, read once, and
  // the answer for every tile on the map falls out of it — including which of
  // our own shoreline is reachable, which is the next thing we need.
  //
  // ASKED ABOUT THE GROUND BESIDE THE HALL, NOT THE HALL.
  //
  // The first version read the field at the manor's own tile and concluded the
  // enemy was unreachable on every map in the game — because a manor's tiles are
  // BUILDING, buildings are impassable, and an impassable tile is unreachable by
  // definition. It is a true answer to the wrong question, and it is invisible:
  // the AI simply never built anything, which looks exactly like the feature not
  // being wired up.
  const field = flowField(sim.grid, [[enemyHeart.tx, enemyHeart.ty]]);
  const doorstep = ringAround(heart.tx, heart.ty, heart.spec.tiles, 1).find(
    ([x, y]) => x >= 0 && y >= 0 && x < sim.grid.w && y < sim.grid.h &&
      field[idx(sim.grid, x, y)] !== UNREACHABLE
  );
  if (doorstep) return; // there is a road; we do not need to build one

  // The water tile to lay the next segment on: touching ground we can stand on,
  // and as close to them as the map allows. Ties break on tile index, because
  // this runs inside a simulation two machines have to agree about.
  const { w, h, cells } = sim.grid;
  let best = null;
  let bestKey = null;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const key = ty * w + tx;
      if (cells[key] !== WATER) continue;
      // Reachable from OUR side means: a neighbour we can stand on that is not
      // itself across the water.
      let onOurBank = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (cells[nk] === WATER || cells[nk] === ROCK) continue;
        if (field[nk] !== UNREACHABLE) continue; // that side is already theirs
        onOurBank = true;
        break;
      }
      if (!onOurBank) continue;

      const d2 = (tx - enemyHeart.tx) ** 2 + (ty - enemyHeart.ty) ** 2;
      const cmp = [d2, key];
      if (!bestKey || cmp[0] < bestKey[0] || (cmp[0] === bestKey[0] && cmp[1] < bestKey[1])) {
        best = [tx, ty];
        bestKey = cmp;
      }
    }
  }
  if (!best) return;
  if (!canBuild(sim, owner, "bridge", best[0], best[1]).ok) return;
  queueBuild(sim, owner, "bridge", best[0], best[1]);
}

// --- Keeping the peasants busy -----------------------------------------------

/**
 * Any peasant with nothing to do goes to the nearest workable seam.
 *
 * This is the single most important function in the file and it is the dullest.
 * A peasant that finishes a building and is never told what to do next is a
 * peasant standing in a field for the rest of the match, and with the economy
 * now made entirely of peasants that is not a small loss — it is the match. The
 * old AI could not have this bug because gold came out of buildings whether
 * anyone was looking or not.
 *
 * "Nearest" is measured from the peasant, not the manor, so a peasant who has
 * just finished a forward warehouse works the forward seam rather than walking
 * all the way home.
 */
function labour(sim, owner, heart) {
  const peasants = sim.units.filter((u) => u.owner === owner && u.spec.worker);
  if (peasants.length === 0) return;

  // Foundations first, and they must PULL peasants off the gold.
  //
  // Staffing sites only from idle peasants looked reasonable and produced an AI
  // that mined for ten minutes and built nothing: `labour` puts every spare
  // peasant on a seam, so by the time a foundation is laid there is never an
  // idle one left, and its two half-built barracks sat at zero work for the
  // whole match while it banked eight thousand gold. Nobody is ever idle in a
  // working economy, so "when idle" means "never".
  // A RISING HALL IS A FOUNDATION, AND NEEDS THE SAME TREATMENT.
  //
  // The identical bug, one feature later, and it cost the whole tech tree:
  // ordering the upgrade PAYS for it and starts the work, but the work is done
  // by peasants, and every peasant was on a seam. Measured — the hall sat at
  // 0/900 for seven minutes with the money already spent, so no opponent ever
  // reached a Keep and everything above tier 0 was permanently locked.
  //
  // Before the foundations, because a hall being raised is the one piece of
  // construction that gates every other building on the list.
  const rising = sim.buildings.find((b) => b.owner === owner && b.raising);
  if (rising) {
    const on = peasants.filter(
      (u) => u.job && u.job.kind === "raise" && u.job.id === rising.id
    );
    const want = Math.max(2, Math.min(5, Math.floor(peasants.length / 2)));
    const short = want - on.length;
    if (short > 0) {
      const spare = peasants
        .filter((u) => !u.job || (u.job.kind !== "raise" && u.job.kind !== "build"))
        .map((u) => ({ u, d2: (rising.x - u.x) ** 2 + (rising.y - u.y) ** 2 }))
        .sort((a, b) => a.d2 - b.d2 || a.u.id - b.u.id)
        .slice(0, short);
      for (const { u } of spare) queueOrder(sim, owner, [u.id], rising.tx, rising.ty);
    }
  }

  const sites = sim.sites.filter((s) => s.owner === owner);
  if (sites.length > 0) {
    const perSite = Math.max(1, Math.min(3, Math.floor(peasants.length / 3)));
    for (const site of sites) {
      const on = peasants.filter(
        (u) => u.job && u.job.kind === "build" && u.job.id === site.id
      );
      let short = perSite - on.length;
      if (short <= 0) continue;

      // Nearest first, and never one already building something else — pulling a
      // peasant off site A to work site B just moves the problem.
      const spare = peasants
        .filter((u) => !u.job || u.job.kind !== "build")
        .map((u) => {
          const dx = site.x - u.x;
          const dy = site.y - u.y;
          return { u, d2: dx * dx + dy * dy };
        })
        .sort((a, b) => a.d2 - b.d2 || a.u.id - b.u.id);

      for (const { u } of spare) {
        if (short <= 0) break;
        queueOrder(sim, owner, [u.id], site.tx, site.ty);
        short -= 1;
      }
    }
  }

  // WHO IS ON WHAT.
  //
  // With one resource this function had one answer: everybody on gold. With
  // three it has to hold a balance, and the balance cannot be struck only when a
  // peasant falls idle — mining never ends, so "when idle" means "at the start
  // of the match and never again". An AI that put its first eight peasants on
  // gold would still be on gold with no timber and no grain twenty minutes
  // later, unable to build or train, losing to a stone wall.
  //
  // So it reassigns: count who is on what, compare against a doctrine, and move
  // a couple of peasants across per think. A couple, not all of them — swinging
  // the whole crew back and forth spends the whole match walking.
  const enemyHeart = nearestEnemyHeart(sim, owner, heart);
  const farms = sim.buildings.filter(
    (b) => b.owner === owner && b.spec.farm && b.hp >= b.maxHp
  );

  const onGold = [];
  const onWood = [];
  const onFarm = [];
  const spare = [];
  for (const u of peasants) {
    if (!u.job) spare.push(u);
    else if (u.job.kind === "mine" || (u.job.kind === "drop" && u.job.seam)) onGold.push(u);
    else if (u.job.kind === "fell" || (u.job.kind === "drop" && u.job.wood)) onWood.push(u);
    else if (u.job.kind === "harvest" || (u.job.kind === "drop" && u.job.farm != null)) onFarm.push(u);
  }

  // DOCTRINE, AND WHY IT IS NOT A FIXED RATIO.
  //
  // A fixed split was the obvious thing and it was measurably wrong: a quarter of
  // the crew on trees and a quarter on grain produced four thousand timber and
  // five thousand grain that nothing in the game wanted, while gold — the thing
  // that buys everything — sat at nineteen. Half the labour force was making
  // stock for a shelf.
  //
  // So each resource's share falls as the stockpile of it rises, and gold takes
  // whatever is left. Early on that staffs all three; once the barns are full it
  // quietly walks everyone back to the seams, which is exactly what a player
  // does without thinking about it.
  const stock = sim.players[owner];
  const appetite = (have, enough) =>
    Math.max(0.08, Math.min(1, 1 - have / enough));

  const crew = onGold.length + onWood.length + onFarm.length + spare.length;
  const wantFarm = farms.length
    ? Math.round(crew * 0.34 * appetite(stock.food, 900)) : 0;
  const wantWood = Math.round(crew * 0.32 * appetite(stock.timber, 700));
  const wantGold = crew - wantFarm - wantWood;

  /** Send these peasants at a thing, in the game's own right-click language. */
  const send = (crewToMove, tx, ty) => {
    for (const u of crewToMove) queueOrder(sim, owner, [u.id], tx, ty);
  };

  // Nearest first, so a reassignment is a short walk rather than a march.
  const nearestTo = (list, x, y) =>
    [...list]
      .map((u) => ({ u, d2: (u.x - x) ** 2 + (u.y - y) ** 2 }))
      .sort((a, b) => a.d2 - b.d2 || a.u.id - b.u.id)
      .map((e) => e.u);

  const MOVE_LIMIT = 2;

  // Grain, if there is a farm and it is short-handed.
  if (farms.length && onFarm.length < wantFarm) {
    const farm = farms[0];
    const take = Math.min(MOVE_LIMIT, wantFarm - onFarm.length);
    const pool = spare.length ? spare : nearestTo(onGold, farm.x, farm.y);
    send(pool.slice(0, take), farm.tx, farm.ty);
    for (const u of pool.slice(0, take)) {
      const i = spare.indexOf(u); if (i >= 0) spare.splice(i, 1);
      const j = onGold.indexOf(u); if (j >= 0) onGold.splice(j, 1);
    }
  }

  // Timber. `nearestWood` lives inside the simulation, so the AI finds its own
  // tree the same way any other caller would: it points a peasant at a forest
  // tile and the right-click rules do the rest.
  if (onWood.length < wantWood) {
    const take = Math.min(MOVE_LIMIT, wantWood - onWood.length);
    const pool = spare.length ? spare : nearestTo(onGold, heart.x, heart.y);
    for (const u of pool.slice(0, take)) {
      const tree = nearestForest(sim, u);
      if (!tree) break;
      queueOrder(sim, owner, [u.id], tree[0], tree[1]);
      const i = spare.indexOf(u); if (i >= 0) spare.splice(i, 1);
      const j = onGold.indexOf(u); if (j >= 0) onGold.splice(j, 1);
    }
  }

  // Everyone still without a job goes to the gold, which is what this function
  // has always done and is still the right default.
  if (spare.length === 0) return;

  const seams = goldSeams(sim.grid);
  if (seams.length === 0) return;

  for (const peasant of spare) {
    let best = null;
    let bestKey = null;
    for (const [tx, ty] of seams) {
      const key = seamKey(peasant, heart, enemyHeart, tx, ty);
      if (!bestKey || lessKey(key, bestKey)) {
        best = [tx, ty];
        bestKey = key;
      }
    }
    if (best) queueOrder(sim, owner, [peasant.id], best[0], best[1]);
  }
}

/**
 * The nearest forest tile to a unit, or null.
 *
 * A bounded box, ties on tile index — the same shape and the same tie-break as
 * the simulation's own `nearestWood`, because an AI that disagrees with the
 * simulation about which tree is closest sends its peasants somewhere the
 * simulation immediately overrides.
 */
function nearestForest(sim, unit) {
  const { w, h, cells } = sim.grid;
  const ux = toTile(unit.x);
  const uy = toTile(unit.y);
  let best = null;
  let bestD2 = Infinity;
  for (let ty = Math.max(0, uy - 40); ty <= Math.min(h - 1, uy + 40); ty++) {
    for (let tx = Math.max(0, ux - 40); tx <= Math.min(w - 1, ux + 40); tx++) {
      const key = ty * w + tx;
      if (cells[key] !== FOREST) continue;
      const dx = tileCentre(tx) - unit.x;
      const dy = tileCentre(ty) - unit.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 || (d2 === bestD2 && best && key < best[2])) {
        best = [tx, ty, key];
        bestD2 = d2;
      }
    }
  }
  return best;
}

/**
 * How good a seam is, as a comparison key. EVERY component is mirror-invariant,
 * and that is the entire point.
 *
 * Nearest-seam with a tile-index tie-break looks obviously fair and is not.
 * Kingsmoor has a contested PAIR of seams either side of the middle ford, at
 * equal distance from a peasant standing between them — so the tie-break decided
 * which one got worked, and "lower tile index" means "the western one" for both
 * players. The west player's peasants went to the safe seam and the east
 * player's went to the one under the enemy's nose. Mirror matches on Kingsmoor
 * went 0-12 while Two Gates, which has no such pair, looked fine.
 *
 * Distance from the peasant, distance from your own manor, and distance from
 * the enemy's are all unchanged when you flip the map, so a key built from those
 * three gives both seats the same answer in mirrored positions.
 */
function seamKey(peasant, heart, enemyHeart, tx, ty) {
  const x = tileCentre(tx);
  const y = tileCentre(ty);
  const pdx = x - peasant.x;
  const pdy = y - peasant.y;
  const hdx = x - heart.x;
  const hdy = y - heart.y;
  const edx = enemyHeart ? x - enemyHeart.x : 0;
  const edy = enemyHeart ? y - enemyHeart.y : 0;
  return [
    pdx * pdx + pdy * pdy,          // nearest to the man
    hdx * hdx + hdy * hdy,          // then nearest home
    -(edx * edx + edy * edy),       // then furthest from the enemy
  ];
}

const lessKey = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
};

// --- Building ----------------------------------------------------------------

function economy(sim, owner, cfg, mine, heart, enemyHeart) {
  const count = (type) =>
    mine.filter((b) => b.spec.id === type).length +
    sim.sites.filter((s) => s.owner === owner && s.spec.id === type).length;

  const peasants = sim.units.filter((u) => u.owner === owner && u.spec.worker).length;
  const queuedPeasants = heart.queue.length;

  // Peasants first, and by a wide margin. Every tier's ceiling is how much gold
  // it can move, and gold is moved by legs.
  if (peasants + queuedPeasants < cfg.peasants) {
    if (heart.queue.length < 2 && canAfford(sim.players[owner], UNITS.peasant)) {
      queueTrain(sim, owner, heart.id, "peasant");
      return;
    }
  }

  // Then buildings, in the order they actually pay off. One decision per turn,
  // so it cannot empty its purse in a single tick.
  // ONE DECISION PER TURN, SO ORDER IS THE WHOLE POLICY.
  //
  // This loop returns after the first thing it can afford, which makes the list
  // a priority order rather than a shopping list: anything near the bottom is
  // rarely reached inside a fifteen-minute match. Read it as "what this tier
  // builds FIRST", not as a list of what it ends up with.
  //
  // THE SECOND FARM BELONGS AT THE BOTTOM, AND THAT WAS MEASURED THE HARD WAY.
  // It looks like it should be promoted — a barracks you cannot feed is a
  // building that does nothing — so it was, gated on the larder running low.
  // The ladder inverted: The Pretender fell from 75% to 33% against the tier
  // below, because it has the biggest farm target and spent its opening on grain
  // instead of its third barracks and second stables, while its one advantage is
  // a GOLD handicap that farms cannot spend. The tiers that draw are not short
  // of food; promoting food cost the tier that was not short of anything.
  // RAISING THE HALL IS PART OF THE BUILD ORDER, NOT A LUXURY.
  //
  // Every tier above the first is DEFINED by buildings that now sit behind a
  // Keep or a Castle — stables, towers, the factory, the lair. An AI that never
  // raises its hall is an AI whose difficulty setting quietly stops meaning
  // anything, and the ladder would inverted itself from the top down.
  //
  // Placed above the second barracks and below the first of everything: the
  // opening is unchanged, and the hall goes up the moment the basics stand.
  // `cfg.tier` is how far up this opponent intends to go, so the ladder is still
  // a ladder — the Levy Captain never leaves his Manor and the Pretender ends in
  // a Castle.
  const hall = mine.find((b) => b.spec.isHeart);
  const wantTier = cfg.tier ?? 0;
  const essentials =
    count("farm") >= 1 && count("barracks") >= 1 && count("warehouse") >= 1;

  if (hall && !hall.raising && hall.tier < wantTier && essentials) {
    // IT HAS TO SAVE, OR IT NEVER GETS THERE.
    //
    // Measured: with this as a plain "raise it if you can afford it" check, no
    // opponent at any tier ever raised its hall once in twelve minutes. A Keep
    // is 240 gold and 220 timber; a second barracks is 120 and 90. The cheaper
    // thing always wins the race, so the purse never reaches the price and the
    // whole upper tech tree stays locked for ever.
    //
    // So once the basics stand, it stops buying and puts the money aside. That
    // is also simply how the decision feels to a player — you go without the
    // third barracks for two minutes because you want the Castle.
    if (canRaise(sim, owner).ok) queueRaise(sim, owner);
    return;
  }

  const wants = [];
  // A farm FIRST. Every soldier costs grain, so a barracks raised before a farm
  // is a building that cannot do the one thing it is for.
  if (count("farm") < 1) wants.push("farm");
  if (count("barracks") < 1) wants.push("barracks");
  if (count("warehouse") < 1) wants.push("warehouse");
  if (count("barracks") < cfg.barracks) wants.push("barracks");
  // The path-house, once the hall can carry it. Above the stables because the
  // whole point of a path is that it changes what this opponent IS, and below
  // the second barracks because an army it cannot feed or field first is worse.
  if (cfg.path && count(PATHS[cfg.path].house) < 1) wants.push(PATHS[cfg.path].house);
  if (count("stables") < cfg.stables) wants.push("stables");
  if (count("watchtower") < cfg.towers) wants.push("watchtower");
  if (cfg.factory && count("factory") < cfg.factory) wants.push("factory");
  if (count("farm") < (cfg.farms ?? 2)) wants.push("farm");
  if (count("warehouse") < 2) wants.push("warehouse");

  for (const type of wants) {
    // A LOCKED BUILDING IS SKIPPED, NOT WAITED FOR.
    //
    // `return` on unaffordable is deliberate — it stops the AI spending its way
    // down the list in one tick. But returning on a LOCKED building would park
    // the whole build order behind a tier it has not reached: a tier-3 opponent
    // that wants a stables at tier 0 would build nothing else, for ever.
    if ((BUILDINGS[type].needsTier ?? 0) > manorTier(sim, owner)) continue;
    if (!canAfford(sim.players[owner], BUILDINGS[type])) return;
    // Don't start a third thing while two are already half-built and starved of
    // peasants — an AI with four foundations and three peasants finishes none.
    if (sim.sites.filter((s) => s.owner === owner).length >= 2) return;

    const spot =
      type === "warehouse"
        ? findWarehouseSpot(sim, owner, heart)
        : findSpot(sim, owner, type, heart, enemyHeart);
    if (spot) queueBuild(sim, owner, type, spot.tx, spot.ty);
    return;
  }
}

/**
 * A legal spot near the manor, preferring ground on the FAR side from the enemy.
 *
 * The "far side" part is not polish, it is fairness. This used to take the first
 * legal tile of a fixed west-to-east scan, which sounds neutral and is not: the
 * player on the left of the map ends up building away from the enemy and the
 * player on the right ends up building toward them, undefended. Both sides ran
 * this identical AI and one seat won every single match because of it.
 */
/**
 * Every footprint a ring tile could anchor, as top-left corners.
 *
 * A footprint runs from its corner in the +x/+y direction, so "the ring tile is
 * the corner" is not a mirror-symmetric way to choose a spot: flip the map and a
 * two-tile building lands one tile off where its reflection would. Offering both
 * the tile and the tile minus (size - 1) closes the candidate set under
 * reflection, which is what the fairness test actually needs.
 */
function corners(tx, ty, tiles) {
  const back = tiles - 1;
  if (back === 0) return [[tx, ty]];
  return [[tx, ty], [tx - back, ty], [tx, ty - back], [tx - back, ty - back]];
}

/** Distance squared between two footprints' centres, in tiles. */
function centreGap(tx, ty, tiles, other) {
  const cx = tx + (tiles - 1) / 2;
  const cy = ty + (tiles - 1) / 2;
  const ox = other.tx + (other.spec.tiles - 1) / 2;
  const oy = other.ty + (other.spec.tiles - 1) / 2;
  return (cx - ox) ** 2 + (cy - oy) ** 2;
}

function findSpot(sim, owner, type, heart, enemyHeart) {
  const tiles = BUILDINGS[type].tiles;

  for (let r = 2; r < 14; r++) {
    let best = null;
    let bestScore = -Infinity;

    // `ringAround` measures from the manor's FOOTPRINT rather than its top-left
    // tile. Offsets from a corner reach further on one side than the other, and
    // on a mirrored map that lands as a real seat advantage — see the note on
    // ringAround itself.
    for (const [rx, ry] of ringAround(heart.tx, heart.ty, heart.spec.tiles, r)) {
      for (const [tx, ty] of corners(rx, ry, tiles)) {
        if (!canBuild(sim, owner, type, tx, ty).ok) continue;

        // Scored on CENTRES, not corners, for the same reason.
        const score = enemyHeart ? centreGap(tx, ty, tiles, enemyHeart) : 0;
        if (score > bestScore) {
          bestScore = score;
          best = { tx, ty };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * A warehouse belongs beside the gold, not beside the hall.
 *
 * The whole point of the building is to shorten the walk, so putting it where
 * everything else goes — hard against the manor, on the safe side — is worth
 * nothing at all. This looks for the seam furthest from an existing drop-off and
 * builds next to that one.
 */
function findWarehouseSpot(sim, owner, heart) {
  const drops = sim.buildings.filter((b) => b.owner === owner && b.spec.dropOff);
  const seams = goldSeams(sim.grid);
  if (seams.length === 0) return null;

  const enemyHeart = nearestEnemyHeart(sim, owner, heart);

  // The seam our peasants are actually working that is worst served.
  let worst = null;
  let worstKey = null;
  for (const [tx, ty] of seams) {
    const x = tileCentre(tx);
    const y = tileCentre(ty);

    let nearest = Infinity;
    for (const d of drops) {
      const dx = d.x - x;
      const dy = d.y - y;
      nearest = Math.min(nearest, dx * dx + dy * dy);
    }
    // Distance from home is a cost, not a prize: a warehouse on the enemy's
    // doorstep is a gift. Only seams within reach of our half count.
    const hx = heart.x - x;
    const hy = heart.y - y;
    const fromHome = hx * hx + hy * hy;
    if (fromHome > 900 * 900) continue;

    const edx = enemyHeart ? x - enemyHeart.x : 0;
    const edy = enemyHeart ? y - enemyHeart.y : 0;
    // Same mirror-invariant ordering as the seam choice above, and for the same
    // reason: "first one found" over a row-major seam list is a seat advantage.
    const key = [-nearest, fromHome, -(edx * edx + edy * edy)];
    if (!worstKey || lessKey(key, worstKey)) {
      worstKey = key;
      worst = { tx, ty };
    }
  }
  if (!worst) return null;

  // Nearest legal tile to that seam. The seam is a single tile here, so the
  // ring is symmetric either way, but it goes through the same helper as
  // everything else so there is one shape to get wrong instead of three.
  const tiles = BUILDINGS.warehouse.tiles;
  for (let r = 2; r < 8; r++) {
    let best = null;
    let bestScore = Infinity;
    for (const [rx, ry] of ringAround(worst.tx, worst.ty, 1, r)) {
      for (const [tx, ty] of corners(rx, ry, tiles)) {
        if (!canBuild(sim, owner, "warehouse", tx, ty).ok) continue;
        // Closest to the seam, measured centre to centre — corners are not
        // mirror-symmetric for an even-sized building.
        const cx = tx + (tiles - 1) / 2;
        const cy = ty + (tiles - 1) / 2;
        const score = (cx - worst.tx) ** 2 + (cy - worst.ty) ** 2;
        if (score < bestScore) {
          bestScore = score;
          best = { tx, ty };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// --- Training ----------------------------------------------------------------

function production(sim, owner, cfg, mine) {
  // Roughly two spearmen per archer, measured from the army it HAS rather than
  // from the tick, and it waits rather than substituting when it wants the
  // dearer unit. Both details exist because of the same bug: picking a type by
  // tick and skipping when it could not afford THAT type meant every archer
  // decision landed in the gap between the Spearman's 45 and the Archer's 60 —
  // and this AI spends down to nearly nothing, so it was always in that gap. It
  // fielded 24 spearmen and zero archers in three minutes, silently.
  const army = sim.units.filter((u) => u.owner === owner && !u.spec.worker);
  const of = (id) => army.filter((u) => u.spec.id === id).length;

  const foot = of("archer") * 2 <= of("spearman") ? "archer" : "spearman";
  const horse = of("huntress") * 2 <= of("warRider") ? "huntress" : "warRider";

  const rams = army.filter((u) => u.spec.id === "ram").length;

  // A DEAD CART IS A SEVERED ECONOMY, AND NOBODY WAS REPLACING THEM.
  //
  // A warehouse is a depot, not a treasury: what peasants tip into it is only
  // spendable once a cart carries it to the hall. One cart comes free with the
  // warehouse — and when that cart dies, every coin the crew mines from then on
  // goes into a building nothing empties.
  //
  // Measured, and it is not a small leak: seven thousand gold in a warehouse at
  // eight minutes with zero carts, while the purse sat at 23 and the AI stood
  // there unable to afford a barracks with six peasants on the seams. It reads
  // exactly like "the economy is too tight" and it is nothing of the kind.
  //
  // Ahead of soldiers on purpose. A cart is 30 gold and restores the whole
  // income; a spearman is 25 and does not.
  // More carts when the depot is backing up, not just one each.
  //
  // A cart carries 300 a trip and a working crew mines faster than that, so a
  // single cart per warehouse leaves thousands of gold sitting in a shed. Unlike
  // the dead-cart case this one IS a real decision — widen the pipe or defend a
  // fatter one — and the AI should make it the same way a player would: when the
  // pile is bigger than a load and a half, add another cart.
  const depots = mine.filter((b) => b.spec.depot);
  const backedUp = depots.some(
    (b) => b.store.gold + b.store.timber + b.store.food > UNITS.cart.capacity * 1.5
  );
  const carts = sim.units.filter((u) => u.owner === owner && u.spec.hauler).length;
  if (carts < depots.length || (backedUp && carts < depots.length * 3)) {
    for (const depot of depots) {
      if (depot.queue.length > 0) continue;
      if (!canAfford(sim.players[owner], UNITS.cart)) break;
      queueTrain(sim, owner, depot.id, "cart");
      break;
    }
  }

  for (const b of mine) {
    const want =
      b.spec.id === "barracks" ? foot
        : b.spec.id === "bastion" ? "guardian"
          // The Lair's apex unit only. A Pretender that spent its Lair on
          // witches would have paid 360 gold for a conversion trick it has no
          // idea how to use.
          : b.spec.id === "lair" ? "dragon"
            : b.spec.id === "stables" ? horse
          // A factory makes rams up to the tier's appetite, and sappers never:
          // nothing in this AI knows where to put a catapult.
          : b.spec.id === "factory" && rams < (cfg.rams ?? 0) ? "ram"
            : null;
    if (!want) continue;
    if (b.queue.length >= 2) continue;
    if (b.queue.includes(want)) continue;
    if (!canAfford(sim.players[owner], UNITS[want])) continue;
    queueTrain(sim, owner, b.id, want);
  }
}

// --- Commanding the army -----------------------------------------------------

/**
 * The nearest enemy building to a point — not necessarily their hall.
 *
 * ON A BIG MAP, THE HALL IS THE WRONG TARGET.
 *
 * Marching at the enemy heart is correct on Two Gates, where it is forty tiles
 * away. On The Sunder the halls are 136 tiles apart, and an order to walk that
 * far means the army leaves home, strings out over a minute and a half, and
 * arrives in ones and twos at the best-defended building on the map. Measured:
 * both sides holding armies, both permanently "attacking", and 0/3 decided at
 * every cap we ever ran.
 *
 * Their forward warehouse is three tiles from your border and worth breaking.
 * Going at what is CLOSE means the fight actually happens, and a fight that
 * happens is a match that can end.
 *
 * Ties on id, because two machines have to pick the same building.
 */
function nearestEnemyStructure(sim, owner, from) {
  let best = null;
  let bestD2 = Infinity;
  for (const b of sim.buildings) {
    if (b.owner === owner) continue;
    const d2 = (b.x - from.x) ** 2 + (b.y - from.y) ** 2;
    if (d2 < bestD2 || (d2 === bestD2 && best && b.id < best.id)) {
      best = b;
      bestD2 = d2;
    }
  }
  return best;
}

function command(sim, owner, cfg, heart, enemyHeart) {
  // Peasants are never part of the army. Sending the economy to die at a manor
  // is the sort of thing that reads as a hilarious bug and loses every match.
  const army = sim.units.filter((u) => u.owner === owner && !u.spec.worker);
  if (army.length === 0) return;

  // Is anything hostile close to home? Cheap check against the manor rather
  // than a proper threat map — this is a placeholder opponent, not a general.
  const raider = cfg.defend
    ? sim.units.find((u) => {
        if (u.owner === owner) return false;
        const dx = u.x - heart.x;
        const dy = u.y - heart.y;
        return dx * dx + dy * dy < 420 * 420;
      })
    : null;

  if (raider) {
    // Everything home, and onto the raider specifically. A tier that ignores a
    // raid loses its economy to six spearmen while its own army walks the other
    // way, which is the single most frustrating thing to watch an ally do and
    // the most satisfying to do to an opponent who cannot.
    const free = army.filter((u) => u.chaseId !== raider.id);
    if (free.length) queueAttack(sim, owner, free.map((u) => u.id), raider.id);
    return;
  }

  if (!enemyHeart) return;

  // NOTHING LEFT TO FIGHT, SO GO AND FINISH IT.
  //
  // Every other branch here only ever re-orders units whose `chaseId` is null,
  // which is correct while there is a battle on — re-issuing orders to men who
  // are already swinging just makes them mill about. But it means a unit that
  // auto-acquires ANY target is never given another instruction, and that turns
  // a won match into an unwinnable one.
  //
  // Measured on Kingsmoor: one seat reduced to two peasants and a hall at
  // 1,971 of 5,200, the other with fourteen soldiers and every one of them
  // holding a chase — of the peasants, across the map, for forty-five minutes.
  // A hundred and thirty thousand gold still in the ground and neither player
  // able to end it. From the outside that is indistinguishable from a stalemate,
  // and it is nothing of the kind: it is an army with nobody telling it to
  // knock the last building down.
  //
  // So when the enemy has no army at all, everyone goes at the hall — including
  // the men already chasing something, because what they are chasing is the
  // problem.
  const enemyStillFights = sim.units.some(
    (u) => u.owner !== owner && !u.spec.worker && !u.spec.hauler
  );
  if (!enemyStillFights) {
    // Nearest first, then the next, and the hall last of all — which is exactly
    // how a player mops up, and it means every order given is one the army can
    // finish before something else happens.
    const mob = army[0] ?? heart;
    const target = nearestEnemyStructure(sim, owner, mob) ?? enemyHeart;
    const notOnIt = army.filter((u) => u.chaseId !== target.id);
    if (notOnIt.length) queueAttack(sim, owner, notOnIt.map((u) => u.id), target.id);
    return;
  }

  // Nothing marches on its own any more, so an attack is an ORDER — and a tier
  // that forgets to give one simply never attacks. `committed` is the army
  // already sent; everyone else is still gathering at the rally.
  const committed = army.filter((u) => u.chaseId !== null);
  const waiting = army.filter((u) => u.chaseId === null);

  if (army.length >= cfg.massAt) {
    if (waiting.length) {
      // THE HALL, NOT THE NEAREST BUILDING — and that was measured both ways.
      //
      // Sending a massed army at whatever is closest sounds better and is not.
      // It cost Kingsmoor 3/3 decided down to 1/3: the army spends the match
      // pecking at outbuildings on the border, never threatens the heart, and
      // the defender rebuilds them faster than they fall. An attack has to be
      // aimed at the thing that ENDS the match, or it is a raid with extra
      // steps. (The mop-up branch above is the opposite case and does want the
      // nearest building — there, everything left is worth breaking.)
      queueAttack(sim, owner, waiting.map((u) => u.id), enemyHeart.id);
    }
    return;
  }

  // Still gathering: park anyone loose at the rally point, which sits between
  // the manor and the enemy so the army is already facing the right way. Only
  // units that have actually stopped are re-ordered, or the whole army gets a
  // fresh identical order every think and never arrives anywhere.
  if (committed.length > 0) return;

  const rallyX = heart.x + (enemyHeart.x - heart.x) * 0.12;
  const rallyY = heart.y + (enemyHeart.y - heart.y) * 0.12;
  const tx = toTile(rallyX);
  const ty = toTile(rallyY);

  const loose = waiting.filter((u) => !u.order);
  if (loose.length) queueOrder(sim, owner, loose.map((u) => u.id), tx, ty);
}
