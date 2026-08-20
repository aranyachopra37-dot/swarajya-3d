// Dominion — the simulation. Every rule, and nothing about how it looks.
//
// Same contract as Rout's sim.js and for the same reasons: fixed ticks, no
// clock, no screen, and the player never mutates state directly — every action
// arrives as a recorded input applied on the tick it belongs to, so the input
// list IS the replay. That property is what will make lockstep multiplayer
// possible without trusting either client, and it is cheaper to keep from the
// first line than to retrofit.
//
// What is new against Rout, and the whole point of this slice:
//
//   * Units navigate in TWO dimensions over a grid, not along a fixed road.
//   * There is an economy — gold is produced by buildings, not by killing.
//   * Both sides build. The enemy is a player, not a wave table.
//
// Deliberately NOT here yet: fog of war, multiple resources, walls, upgrades,
// formations, naval, terrain effects. This exists to prove the core loop runs
// deterministically at a playable size, not to be the game.

import { makeRng } from "../src/rng.js";
import {
  TILE, createGrid, flowField, steer, idx, inBounds, passable, buildable,
  speedFactor, toTile, tileCentre,
  GROUND, ROCK, BUILDING, WATER, FOREST, HILL, GOLD,
} from "./grid.js";

export const TICKS_PER_SECOND = 20; // NOT 60 — see the note in the design docs

// --- What can be built -------------------------------------------------------

/**
 * MANOR → KEEP → CASTLE → PALACE.
 *
 * Two measured defects, one answer.
 *
 * The first: the manor is paper. Three dragons break one in 18.5 seconds; the
 * manor kills ONE dragon in 30.9. Since the manor shooting is the only
 * defender's advantage in the game — the beam the whole difficulty ladder rests
 * on — a hall that folds to the first serious army means the late game has no
 * defender's advantage at all.
 *
 * The second: nothing in the game had a prerequisite. A 360-gold Lair was a
 * legal FIRST building, so the tech tree was a price list, and a price list has
 * no arc: there is no moment where the match changes character, because nothing
 * is ever unlocked.
 *
 * Warrior Kings: Battles answers both with the same object, and so does this.
 * Upgrading is not a purchase — it is a peasant job like any construction, so it
 * costs the thing that is always scarcest, which is peasant-time. And the tier
 * gates the buildings above it, which is what makes raising your hall the
 * decision the middle game is about.
 *
 * `might` is Warrior Kings' flat, NON-CUMULATIVE bonus: a Castle is 30%, not
 * 15+30. Written as the total at each tier rather than as a step, because a step
 * is the kind of number somebody eventually adds up twice.
 *
 * A HALL GETS TOUGH, NOT DEADLY, AND THE FIRST DRAFT GOT THAT BACKWARDS.
 *
 * Health climbs 2400 → 7200 (3x) while the gun climbs 11 → 21 damage per second
 * (under 2x). The first version scaled both hard — a Castle at 23 damage on a
 * 16-tick reload — and the arithmetic came out at exactly break-even: sixteen
 * spearmen do 144 damage a second and need 36 seconds to break a 5,200-point
 * Castle, and that Castle kills a 70-point spearman every 2.4 seconds, so it
 * kills fifteen of them in the same 36 seconds. Both sides finish at once and
 * neither finishes at all. Measured: Kingsmoor went 3/3 decided to 0/3, with one
 * seat's hall sitting at 731 of 3,600 when the clock stopped.
 *
 * The tier is meant to buy you TIME to answer an attack, not to answer it for
 * you. If the hall can beat an army by itself, nobody has to build one.
 */
export const MANOR_TIERS = [
  {
    name: "Asana", hp: 2400, might: 0,
    attack: { damage: 11, reload: 20, range: 150 },
  },
  {
    name: "Peeth", hp: 3600, might: 0.15,
    attack: { damage: 13, reload: 19, range: 165 },
    cost: { gold: 240, timber: 220 }, work: 900,
    lore: "Stone where there was timber, and a wall you can stand on.",
  },
  {
    name: "Mahapeeth", hp: 5200, might: 0.30,
    attack: { damage: 15, reload: 18, range: 180 },
    cost: { gold: 520, timber: 380 }, work: 1500,
    lore: "A seat, not a house. What you build here, you are.",
  },
  {
    name: "Siddhapeeth", hp: 7200, might: 0.45,
    attack: { damage: 18, reload: 17, range: 195 },
    cost: { gold: 900, timber: 560 }, work: 2200,
    lore: "The last stone. Everything after this is somebody else's problem.",
  },
];

export const MAX_MANOR_TIER = MANOR_TIERS.length - 1;

/**
 * THE THREE PATHS, AND WHY THEY ARE NOT INVENTED.
 *
 * Warrior Kings: Battles makes you choose Imperial, Pagan or Renaissance by
 * WHICH BUILDING YOU RAISE — you never pick a faction off a menu, you commit by
 * building, and past a point you cannot take it back. That is the mechanic worth
 * stealing: a choice you make with a peasant and a foundation is a choice you
 * remember making.
 *
 * The three names come from the source rather than from us: Vanashira, Matrika
 * and Kankala are all real figures in the Himalayan Siddha material, each with
 * its own article, etymology and iconography. Every quote in the table below is
 * from that article and every article is cited. See docs/LORE_GLOSSARY.md.
 *
 * An earlier draft used the three abstract principles of the Traya Guhya Tantra
 * Mala instead — Purusha, Shakti, Abheda. Accurate, and flat: they are
 * categories rather than characters, and a category has no face to put on a
 * building. Named beings with iconography give the art somewhere to start.
 *
 * We did not have to invent three factions. The source names three, and they are
 * three DISCIPLINES WITHIN ONE TRADITION rather than three rival faiths — which
 * is better for a competitive game anyway, because nobody has to be the villain
 * and a reverent side never has to fight an infidel side.
 *
 * The game identities are readings, and they are stated as readings:
 *
 *   Vanashira — the masculine principle, consciousness, the witness, unmoving.
 *             Here: THE STEADFAST. Stone that does not fall.
 *   Shakti  — the feminine principle, power, energy, the active force.
 *             Here: THE KINETIC. Speed and striking and change.
 *   Kankala  — non-difference; that which is not divided.
 *             Here: THE UNDIVIDED, which takes from both and masters neither.
 *             This is the one liberty and it is a small one: a path DEFINED by
 *             not dividing becoming the path that refuses to specialise is a
 *             reading, not a doctrine.
 *
 * Framed in-game as a discipline a house pursues. Never as teaching.
 */
export const PATHS = {
  vanashira: {
    id: "vanashira", name: "Vanashira", house: "bastion",
    title: "the steadfast",
    // "The strongest, most powerful, most knowledgeable and the highest" deity
    // of the mountain peaks; **Param Yoddha, the greatest warrior that existed
    // on this planet**; a Param Kshetrapala — one of the great protector deities
    // — and guardian of the Astra Shastras, the divine weapons. Titled Ratri
    // Prahari, the night guardian. A Gana Bhairav of Shiv.
    //   — siddhapedia.com/vanashira
    //
    // A keeper of weapons who fights at night is the obvious patron of the path
    // that holds ground, and the etymology already says it: vana (forest) +
    // shira (peak).
    buildingHp: 0.25,
    lore: "Guardian of the peaks, and of the weapons. What he holds is not taken.",
  },
  matrika: {
    id: "matrika", name: "Matrika", house: "lair",
    title: "the mother-energies",
    // "Matrika" — the Motherly Energies; "Bhairava" — the fierce, fear-
    // destroying form of Shiva. A manifestation of Swacchanda Bhairava Shiva who
    // **"embodies within Him all the Matrikas"** — the Ashta, the Shodasha, the
    // Varna Matrikas — and is **"the supreme source of all mantra shakti"**.
    // Crown of five skulls, a long sharp sword and a khappar; jackals for
    // mounts. His sadhana grants the eight major siddhis.
    //   — siddhapedia.com/matrika-bhairava
    //
    // Many powers gathered into one figure is the right patron for the house
    // that raises things nothing else in the game can raise.
    speed: 0.12,
    lore: "All the mother-energies in one. What answers here does not answer twice.",
  },
  kankala: {
    id: "kankala", name: "Kankala", house: "factory",
    // Kaṅkālā = skeleton, bare bones. **"The hidden, sustaining, and
    // awe-inspiring form of Shiva — the skeletal ground of existence"**, which
    // embodies **"the naked truth of existence stripped of illusion"** and
    // mastery over fear and desire.
    //   — siddhapedia.com/kankala-bhairava
    //
    // NOT UNDEAD, and the article is explicit about it. The skeleton here is the
    // FRAME under things, not a corpse walking — an inherited lore bible made
    // exactly that mistake and it is the reason docs/LORE_GLOSSARY.md exists.
    // Bone as structure is also precisely what an engine is: the mechanism with
    // the ornament stripped off, which is what this house builds.
    title: "the bare frame",
    lore: "The frame under everything, with the ornament taken off.",
  },
};

export const PATH_IDS = Object.keys(PATHS);

export const BUILDINGS = {
  manor: {
    id: "manor", name: "Asana",
    plain: "Your great hall. Trains Praja (peasants) and stores everything they bring home. Lose it and you lose the match.",
    // Never bought, so it has no cost to take a percentage of. Priced by hand at
    // roughly a barracks for a full bar: enough that holding a broken hall
    // together is a real drain, not enough to make defending one hopeless.
    mendPrice: 260, cost: 0, tiles: 3, hp: 2400, buildWork: 0,
    trains: ["peasant"],
    // Where a laden peasant takes his gold. The manor is one; a Warehouse is the
    // other, and the only reason to build one is that it is closer to a seam.
    dropOff: true,
    // Lose this and you lose the match. There is exactly one per player.
    isHeart: true,
    /**
     * The manor shoots. This is not decoration, it is the load-bearing beam of
     * the whole design.
     *
     * Without it there was NO defender's advantage anywhere in the game, so
     * attacking was strictly better than building an economy and the difficulty
     * ladder came out upside down: the tier that massed its army lost to the
     * tier that trickled it, and the tier with six mines lost to the tier with
     * four, every time. Measured — 0% and 10% win rates for the supposedly
     * better opponent.
     *
     * A manor that kills a lone spearman makes trickling a mistake and massing
     * correct, which is the ordering the ladder claims. Every RTS worth copying
     * does this: the Town Centre shoots.
     */
    attack: { damage: 11, reload: 20, range: 150 },
    colour: "#d9c68a",
    lore: "Your hall, your granary, and the only roof your people actually care about.",
  },
  warehouse: {
    id: "warehouse", name: "Grama (Village)",
    plain: "Village & Storehouse (Warrior Kings: Battles). Rural village that automatically trains Krishaka (farmers) who auto-cultivate surrounding farmland, stores harvest and gold, and comes with 1 free supply cart upon construction.",
    cost: { gold: 60, timber: 50 }, tiles: 2, hp: 550,
    buildWork: 340,
    dropOff: true,
    depot: true,
    granary: 1200,
    trains: ["peasant", "cart"],
    colour: "#d4b25e",
    lore: "A bustling village hub. Spawns 1 supply cart upon completion. Farmers trained here automatically construct or harvest nearby fertile farms.",
  },
  farm: {
    id: "farm", name: "Kshetra",
    plain: "Farm. Right-click it with peasants and they grow food. Food pays for soldiers and keeps them alive.", cost: { gold: 40, timber: 30 }, tiles: 2, hp: 260,
    buildWork: 260,
    // Peasants work it the way they work a seam: right-click it with a peasant
    // and he brings grain back to the hall. Yield depends on the ground around
    // it, so a farm on the hill spine is a farm that barely feeds anyone.
    farm: true,
    colour: "#9fbf6a",
    lore: "Soldiers eat. Put it on the flat, not on the rock.",
  },
  barracks: {
    id: "barracks", name: "Akhara",
    plain: "Barracks. Trains Shulin (spearmen), Dhanurdhara (archers), and Yogini (Tantric mystics).", cost: { gold: 120, timber: 90 }, tiles: 2, hp: 700,
    buildWork: 620,
    trains: ["spearman", "archer", "yogini"],
    colour: "#c08a5a",
    lore: "Where the queue forms and the shouting starts.",
  },
  armory: {
    id: "armory", name: "Khadga Shala",
    plain: "Royal Armory & Foundry. Forges heavy plate armor, increases troop resilience, and constructs Ratha (War Chariots).", cost: { gold: 160, timber: 140 }, tiles: 2, hp: 850,
    buildWork: 950,
    trains: ["ratha"],
    colour: "#9c8158",
    lore: "Where the iron of the peaks is beaten into blades and chariot wheel rims.",
  },
  watchBeacon: {
    id: "watchBeacon", name: "Dhvaja Stambha",
    plain: "Sacred Watch Beacon. Tall mountain spire providing wide line-of-sight vision across foggy mountain passes.", cost: { gold: 50, timber: 80 }, tiles: 1, hp: 500,
    buildWork: 320,
    sightRange: 450,
    colour: "#e76f51",
    lore: "A flame high upon the ridge, watching the passes day and night.",
  },
  stables: {
    id: "stables", name: "Vaji Shala",
    plain: "Stables. Trains Ashvarohi (lancers) and Mrigayini (mounted archers) — fast riders for raiding.", cost: { gold: 180, timber: 110 }, tiles: 3, hp: 800,
    buildWork: 980,
    needsTier: 1,
    trains: ["warRider", "huntress"],
    colour: "#b0784e",
    lore: "Horses eat better than the men who ride them, and it shows on the field.",
  },
  /**
   * THE BASTION — the house of the steadfast path.
   *
   * The third path-house, and the only one that had to be built: the Lair and
   * the Factory already existed as mechanics with no doctrine attached, so two
   * of the three garlands were already on the map and nobody had noticed.
   */
  bastion: {
    id: "bastion", name: "Shira Durg",
    plain: "Fortress of the steadfast path. Trains Kshetrapala (heavy guards) and makes all your buildings tougher.", cost: { gold: 200, timber: 200 }, tiles: 3, hp: 1200,
    buildWork: 1300,
    needsTier: 1,
    path: "vanashira",
    trains: ["guardian"],
    colour: "#8892a8",
    lore: "Raised by men who intend to be here in a hundred years.",
  },
  factory: {
    id: "factory", name: "Asthi Shala",
    plain: "Workshop of the undivided path. Builds siege engines, and can train a guard or a mystic — a bit of everything.", cost: { gold: 190, timber: 160 }, tiles: 3, hp: 900,
    buildWork: 1150,
    needsTier: 1,
    path: "kankala",
    // TAKES FROM BOTH, MASTERS NEITHER. A guardian and a witch, but never a
    // dragon and never a behemoth: the apex of each path stays with that path.
    trains: ["sapper", "ram", "guardian", "witch"],
    colour: "#8f7a5a",
    lore: "Rope, timber and men who can read a drawing. Nothing here is cheap.",
  },
  lair: {
    id: "lair", name: "Mantra Shala",
    plain: "Shrine of the mother-energies path. Trains the serpent, the war bear and the Mantrini (mystic), and speeds up all your troops.", cost: { gold: 360, timber: 180 }, tiles: 3, hp: 1000,
    buildWork: 1600,
    // Behind a KEEP. A Lair used to be a legal first building, which meant a
    // dragon could arrive before the other player had a barracks. A Keep is gate
    // enough — and all three path-houses open at the same tier on purpose, so
    // the choice between them is a choice rather than a running order.
    needsTier: 1,
    path: "matrika",
    trains: ["dragon", "behemoth", "witch"],
    colour: "#6b4f74",
    lore: "Older than the Empire, and unimpressed by it.",
  },
  /**
   * A BRIDGE. One tile, laid in a line, and the only thing that may stand on
   * water.
   *
   * Built like a wall on purpose — cheap segments rather than one big structure
   * — because that makes it grow outward from the shore by itself: the first
   * segment is reachable from land, and once it is finished a peasant can stand
   * ON it to raise the next. Nobody had to write that; it falls out of a
   * completed bridge tile being walkable ground.
   *
   * Expensive per tile compared to a wall, and deliberately so. A strait should
   * be a decision, not a formality, and a bridge is the most attackable thing
   * either player will ever build: it cannot be repaired under fire, it cannot
   * be walked around, and breaking one drops whoever is standing on it.
   */
  bridge: {
    id: "bridge", name: "Setu",
    plain: "Bridge. The only thing you can build on water. Lay them in a line to cross a river.", cost: { gold: 10, timber: 40 }, tiles: 1, hp: 340,
    buildWork: 210,
    spans: true,
    colour: "#8a6a45",
    lore: "Two shores, and a plank between them. Whoever holds the plank holds both.",
  },

  wall: {
    id: "wall", name: "Prakara",
    plain: "Wall. A single block of stone. Build them in a row to close a gap.", cost: { gold: 8, timber: 18 }, tiles: 1, hp: 620,
    buildWork: 130,
    // Cheap, quick and tough for the money. A wall is not meant to kill
    // anything — it is meant to make an army spend a minute in one place while
    // your towers and your riders decide what to do about them.
    colour: "#7d7f86",
    lore: "Stone does not tire, does not desert, and does not need paying.",
  },
  /**
   * THE GATE — the reason anybody would build a wall at all.
   *
   * From the Warrior Kings replays: every base in all three is enclosed by a
   * long run of stone with towers at intervals AND a proper gatehouse. We had
   * walls and towers and no door, so walling yourself in meant walling yourself
   * IN — your own army could not get out, and the sensible move was never to
   * build one. A wall with a gate is a decision; a wall without one is a trap.
   *
   * It is a wall segment that your own people may walk through and the enemy may
   * not — which is exactly what a gate is, and it needs no new pathfinding: the
   * tile is open ground with an owner, and `blocksFor` is asked whose it is.
   */
  gate: {
    id: "gate", name: "Dwara",
    plain: "Gatehouse. A wall segment your own people can walk through and the enemy cannot. Build it into a wall so your army has a door.",
    cost: { gold: 45, timber: 60 }, tiles: 1, hp: 900,
    buildWork: 320,
    gate: true,
    colour: "#a89272",
    lore: "A wall with no door is a wall you built against yourself.",
  },
  watchtower: {
    id: "watchtower", name: "Prahari",
    plain: "Watch tower. Shoots at enemies who come near. Cheap defence for a road or a gold seam.", cost: { gold: 80, timber: 70 }, tiles: 1, hp: 520,
    // NOT GATED, AND THAT IS A DECISION.
    //
    // It was, briefly, behind a Keep. That is backwards: a tower is the answer
    // to early aggression, so putting it behind a tier makes the rush strictly
    // stronger and hands the opening to whoever attacks first. Gates belong on
    // the things that ESCALATE a match — cavalry, engines, dragons — never on
    // the thing that lets you survive long enough to reach them.
    buildWork: 480,
    // A tower has real health and shoots on its own — the point of building one
    // is that it holds ground while your army is somewhere else.
    attack: { damage: 9, reload: 16, range: 165 },
    colour: "#9aa2b4",
    lore: "Two bored men and a good view. Worth more than either of them.",
  },
};

export const UNITS = {
  // The peasant is the whole economy. He mines, he builds, and he dies to
  // anything that looks at him — deliberately the weakest thing on the field, so
  // that an undefended economy is a real risk rather than a nuisance.
  peasant: {
    // GOLD ONLY, DELIBERATELY.
    //
    // Charging grain for a peasant looks right — a mouth is a mouth — and it
    // produced a measured death spiral: the AI's peasant priority ate every
    // grain the farms produced, so it reached fourteen peasants, no army, and
    // sat there. The people who GROW the food must not be gated behind it.
    // Armies eat; the men who feed them do not have to be fed first.
    id: "peasant", name: "Praja",
    plain: "Peasant. Mines gold, fells timber, farms food and builds everything. Your whole economy.", cost: 30, buildTicks: 20 * 3,
    hp: 28, damage: 2, reload: 26, range: 16, speed: 46, radius: 6,
    worker: true,
    colour: "#c9bfa4",
  },
  /**
   * Carries a warehouse's takings to the manor, on its own, for ever.
   *
   * Not commanded. A supply line the player has to steer by hand is a supply
   * line the player forgets, and then wonders why nothing is affordable — so a
   * cart runs its own loop and the only decisions are how many to build and
   * whether to defend them.
   */
  cart: {
    id: "cart", name: "Shakata",
    plain: "Cart. Hauls goods from a storehouse to your hall on its own. Kill an enemy one to cut their supply.", cost: { gold: 30, timber: 40 }, buildTicks: 20 * 5,
    hp: 90, damage: 0, reload: 60, range: 0, speed: 58, radius: 9,
    hauler: true, capacity: 300,
    colour: "#b9a06a",
  },
  spearman: {
    id: "spearman", name: "Shulin",
    plain: "Spearman. Cheap foot soldier. The backbone of any army.", cost: { gold: 25, food: 30 }, buildTicks: 20 * 5,
    hp: 70, damage: 9, reload: 20, range: 22, speed: 52, radius: 7,
    colour: "#9fb6d4",
  },
  archer: {
    id: "archer", name: "Dhanurdhara",
    plain: "Archer. Shoots from a distance but is weak up close. Carries a limited number of arrows.", cost: { gold: 35, timber: 15, food: 30 }, buildTicks: 20 * 6,
    ammo: 60,
    hp: 42, damage: 7, reload: 26, range: 120, speed: 48, radius: 7,
    colour: "#b9d49f",
  },
  // Stables units trade gold for SPEED, which on a map this size is a different
  // thing to buy than more men: a rider reaches a raided warehouse in time, and
  // a spearman does not.
  warRider: {
    id: "warRider", name: "Ashvarohi",
    plain: "Lancer. Fast horseman, good at running down peasants and archers.", cost: { gold: 70, food: 55 }, buildTicks: 20 * 8,
    hp: 130, damage: 17, reload: 22, range: 24, speed: 92, radius: 9,
    colour: "#d4a17f",
  },
  huntress: {
    id: "huntress", name: "Mrigayini",
    plain: "Mounted archer. Fast and shoots on the move. Expensive.", cost: { gold: 80, timber: 20, food: 55 }, buildTicks: 20 * 9,
    ammo: 45,
    hp: 72, damage: 10, reload: 24, range: 100, speed: 86, radius: 9,
    colour: "#c7d49f",
  },

  // --- The siege train -------------------------------------------------------
  //
  // Siege is the answer to a wall, and it is deliberately awkward: everything
  // here is slow, fragile in the open, and useless against men. An army of
  // catapults loses to six spearmen, which is the point — siege is a thing you
  // ESCORT, and escorting is what makes an attack a plan rather than a click.
  //
  // `vsBuilding` multiplies damage against anything with walls. A ram that hits
  // a manor for 90 and a spearman for 6 is a ram; one that does 90 to both is
  // just a very good spearman.

  /** Builds the engines. Also the only unit besides a peasant that can build. */
  sapper: {
    id: "sapper", name: "Sthapati",
    plain: "Engineer. Builds siege engines out in the field where he stands.", cost: { gold: 45, timber: 20, food: 30 }, buildTicks: 20 * 7,
    hp: 46, damage: 4, reload: 26, range: 18, speed: 44, radius: 7,
    engineer: true,
    erects: ["catapult", "mangonel"],
    colour: "#bda98a",
  },

  /** Fixed once placed. Enormous reach, and it cannot run away. */
  catapult: {
    id: "catapult", name: "Kshepani",
    plain: "Catapult. Smashes buildings from far away. Cannot move once set up.", cost: { gold: 110, timber: 100 }, buildTicks: 20 * 10,
    ammo: 30,
    hp: 150, damage: 24, reload: 70, range: 300, speed: 0, radius: 11,
    fixed: true, vsBuilding: 5, siege: true,
    colour: "#a08154",
  },

  /** Between an archer and a catapult, in reach and in usefulness. */
  mangonel: {
    id: "mangonel", name: "Shila Yantra",
    plain: "Stone thrower. Shorter range than a catapult, cheaper, also fixed in place.", cost: { gold: 70, timber: 70 }, buildTicks: 20 * 8,
    ammo: 36,
    hp: 110, damage: 9, reload: 44, range: 190, speed: 0, radius: 10,
    fixed: true, vsBuilding: 2, siege: true,
    colour: "#96a07c",
  },

  /** Walks. Slowly. Hits like the end of the world, and only on buildings. */
  ram: {
    id: "ram", name: "Dwaraghna",
    plain: "Battering ram. Slow, tough, and made for breaking down buildings.", cost: { gold: 60, timber: 120 }, buildTicks: 20 * 9,
    hp: 320, damage: 12, reload: 34, range: 30, speed: 26, radius: 11,
    vsBuilding: 8, siege: true,
    colour: "#7f6a4e",
  },

  // --- The Lair --------------------------------------------------------------
  //
  // Expensive, late, and each one answers a different problem: a dragon ignores
  // the map, a behemoth ignores a wall, and a witch ignores the whole argument
  // and takes your best unit off you. They are meant to be a decision you make
  // instead of an army, not as well as one — hence the prices.

  /**
   * Flies. Which is to say: `flies` makes movement ignore the grid entirely.
   *
   * That is the whole reason a dragon costs what it does. Every other unit in
   * the game is a prisoner of the fords and the chokes — the maps are BUILT
   * around that — and something that is not changes what the map means.
   */
  dragon: {
    id: "dragon", name: "Kankana Naga",
    plain: "The eight-headed serpent. Your most powerful creature, and your most expensive.", cost: { gold: 300, food: 140 }, buildTicks: 20 * 22,
    hp: 340, damage: 26, reload: 24, range: 70, speed: 96, radius: 13,
    flies: true, vsBuilding: 2,
    colour: "#c2603f",
  },

  /** Slow, enormous, and mostly interested in masonry. */
  behemoth: {
    id: "behemoth", name: "Rksha",
    plain: "War bear. Huge and slow, soaks up enormous punishment.", cost: { gold: 260, food: 160 }, buildTicks: 20 * 20,
    hp: 900, damage: 20, reload: 30, range: 28, speed: 34, radius: 14,
    vsBuilding: 4,
    colour: "#7a6f92",
  },

  /**
   * Takes a minute to turn one of theirs into one of yours.
   *
   * The only rule in the game that changes who OWNS something mid-match, which
   * makes it the only one that can hand a player something they never paid for.
   * Deliberately slow, short-ranged and fragile: the counter is to kill her, and
   * a minute is long enough that you always can if you are looking.
   */
  witch: {
    id: "witch", name: "Mantrini",
    plain: "Mystic. Can turn an enemy unit to your side, but must stand still to do it.", cost: { gold: 220, food: 90 }, buildTicks: 20 * 16,
    hp: 60, damage: 3, reload: 30, range: 20, speed: 50, radius: 8,
    converts: true, convertRange: 150, convertTicks: 20 * 60,
    colour: "#9d7fc4",
  },

  /**
   * THE GUARDIAN — the steadfast path's man.
   *
   * Deliberately the dullest unit in the game to read and the hardest to move
   * off a tile: four times a spearman's health, slower than a peasant, and a
   * reach barely longer than his own arm. He does not raid, he does not chase,
   * and he cannot be sent anywhere quickly. What he does is stand in a gap.
   *
   * That is the whole identity of Vanashira expressed as a soldier — the witness
   * that does not move — and it is also the only counter in the game to being
   * outrun, which is what Shakti does to everyone else.
   */
  guardian: {
    id: "guardian", name: "Kshetrapala",
    plain: "Heavy guard. Very tough, very slow, cannot chase. Put him in a gap and he holds it.", cost: { gold: 75, timber: 25, food: 50 },
    buildTicks: 20 * 9,
    hp: 190, damage: 15, reload: 24, range: 22, speed: 38, radius: 10,
    colour: "#93a3bd",
  },
  yogini: {
    id: "yogini", name: "Yogini",
    plain: "Tantric Mystic. Swift esoteric adept who channels lightning bolts and spiritual wards.", cost: { gold: 110, food: 70 },
    buildTicks: 20 * 8,
    hp: 85, damage: 16, reload: 22, range: 115, speed: 62, radius: 8,
    abilities: ["vajra", "kavacha"],
    colour: "#e76f51",
  },
  ratha: {
    id: "ratha", name: "Ratha",
    plain: "War Chariot & Ballista. Fast mobile artillery carriage firing armor-piercing ballista bolts.", cost: { gold: 120, timber: 90, food: 50 },
    buildTicks: 20 * 11,
    hp: 240, damage: 20, reload: 34, range: 160, speed: 76, radius: 12,
    vsBuilding: 3.0, siege: true,
    abilities: ["trample"],
    colour: "#d4a373",
  },
  senapati: {
    id: "senapati", name: "Senapati Indra",
    plain: "Supreme General & Hero. Mounted Himalayan commander. Radiates an Aura of Valour (+25% attack speed / +15 armor to nearby allies). Gains XP and levels up in battle.",
    cost: { gold: 200, food: 120 },
    buildTicks: 20 * 15,
    hp: 450, damage: 28, reload: 20, range: 28, speed: 84, radius: 12,
    isHero: true, heroType: "senapati",
    auraRange: 90, auraBuff: { attackSpeed: 0.25, armor: 15 },
    abilities: ["battlecry", "trample"],
    colour: "#f4a261",
  },
  acharya: {
    id: "acharya", name: "Kaula Acharya",
    plain: "Tantric Sage & Hero. Channels celestial energy, radiating an Aura of Prana (+2.5 HP/s regeneration to nearby allies). Casts powerful Vajra storms and Kavacha shields.",
    cost: { gold: 220, food: 140 },
    buildTicks: 20 * 16,
    hp: 320, damage: 24, reload: 22, range: 130, speed: 56, radius: 9,
    isHero: true, heroType: "acharya",
    auraRange: 100, auraBuff: { regen: 2.5, magicResist: 0.20 },
    abilities: ["vajra", "kavacha"],
    colour: "#9b5de5",
  },
};

export const ABILITIES = {
  vajra: {
    id: "vajra",
    name: "Vajra Storm",
    desc: "Unleash celestial chain lightning striking the target and arcing to 3 nearby enemies for 65 damage.",
    cooldown: 120, // 6 seconds
    range: 150,
    radius: 65,
    damage: 65,
    maxChains: 4,
    icon: "⚡",
    sound: "vajra",
  },
  kavacha: {
    id: "kavacha",
    name: "Kavacha Warding",
    desc: "Conjure a glowing Tantric spiritual barrier granting +60 temporary shield to all friendly units in radius for 10 seconds.",
    cooldown: 160, // 8 seconds
    range: 0,
    radius: 70,
    shield: 60,
    duration: 200,
    icon: "🛡️",
    sound: "devotion",
  },
  trample: {
    id: "trample",
    name: "Trample Charge",
    desc: "Surge forward in a devastating cavalry charge at double speed, dealing 45 impact damage and knocking back infantry.",
    cooldown: 140, // 7 seconds
    range: 160,
    damage: 45,
    duration: 50,
    icon: "🌪️",
    sound: "order",
  },
  agni: {
    id: "agni",
    name: "Agni Shila",
    desc: "Launch an incendiary flaming boulder that creates a burning fire patch on the ground dealing continuous damage.",
    cooldown: 180, // 9 seconds
    range: 280,
    radius: 38,
    duration: 160,
    damagePerSec: 14,
    icon: "🔥",
    sound: "build",
  },
  battlecry: {
    id: "battlecry",
    name: "Aura of Valour",
    desc: "Sound the celestial Himalayan war horn, granting +35% damage and movement speed to all nearby friendly forces.",
    cooldown: 160, // 8 seconds
    range: 0,
    radius: 110,
    duration: 160,
    icon: "📯",
    sound: "warHorn",
  },
};

const START_GOLD = 240;
// Enough timber for the first two buildings, and enough food that nobody starves
// before they have understood that food exists.
//
// TWO, not one. Unlike gold, timber income is zero until somebody is explicitly
// sent to fell a tree, so a stock that covers only one building means the second
// one is gated behind a chore rather than behind a choice. 120 bought a
// warehouse and left a barracks nine timber short, which reads as a bug.
const START_TIMBER = 200;

/**
 * GRAIN HAS A CEILING, AND THE CEILING IS A BUILDING.
 *
 * Taken from Warrior Kings, whose top bar shows food as `434/674` — a stock AND
 * a capacity — rather than as one endlessly-growing number.
 *
 * It is a different lever from anything else in this economy. Gold asks "how
 * fast can you gather"; upkeep asks "how much can you afford to keep". This asks
 * **"where are you putting it"**, and the answer is a building somebody can
 * burn. Before this, a player who out-farmed their army simply banked grain for
 * ever and the surplus was pure safety; now a surplus is a thing with a location.
 *
 * The hall holds the base store and every Kosha adds to it. Overflow is not
 * banked and not an error — the barns are full, so a peasant arriving with grain
 * finds nowhere to put it and it spoils. That is deliberately quiet: it is
 * visible in the HUD as a bar sitting at its cap, which is the signal to build.
 *
 * SIZED HIGH, AND THE FIRST ATTEMPT WAS NOT. At 900 the ceiling taxed every
 * match rather than only the hoarder: Kingsmoor fell from 3/3 decided to 1/3 and
 * the Ashen Reach stretched from 17 minutes to 21. That is the same mistake as
 * the first quiver depth, one system along — a limit meant to punish an extreme
 * must be set where the extreme is, not where the average is. 2,000 in the hall
 * is comfortably more grain than any ordinary match banks, so the rule is
 * invisible until somebody is genuinely sitting on a mountain of it.
 */
const BASE_GRANARY = 2000;
const START_FOOD = 200;
const START_PEASANTS = 3;

/**
 * How many things one player may have on the field at once.
 *
 * High on purpose. This is not a balance lever yet — it is a floor under the
 * frame rate and an upper bound on how silly a match can get, because without
 * one the correct play in a long game is to convert every coin into bodies and
 * the answer to everything is "more". A cap makes an army something you SPEND
 * rather than accumulate, which is the point at which composition starts to
 * matter.
 *
 * Peasants count. They are units, they cost population in every game that has
 * both, and a cap that ignores your economy is a cap you can trivially dodge.
 */
export const POP_CAP = 240;

/** What one player currently has on the field. */
export const population = (sim, owner) =>
  sim.units.filter((u) => u.owner === owner).length;

/**
 * Population already spoken for: on the field, plus everything queued.
 *
 * Counting only what EXISTS lets a player queue two hundred spearmen at the cap
 * and have them trickle out for the rest of the match — the cap would be a
 * suggestion. Gold is taken when a unit is ordered, so the queue has already
 * been paid for and has to be counted.
 */
export function committed(sim, owner) {
  let n = population(sim, owner);
  for (const b of sim.buildings) {
    if (b.owner === owner) n += b.queue.length;
  }
  return n;
}
const SEPARATION = 0.55; // how hard units shove each other apart

// --- The peasant loop --------------------------------------------------------
//
// Numbers chosen so one peasant on a nearby seam is worth roughly what the old
// passive Gold Mine paid, and so the first real decision in a match is how many
// peasants to raise before the first barracks.
const MINE_TICKS = 24;      // swinging a pick, before he has anything to carry
const GOLD_PER_TRIP = 12;   // what he carries back
const LOAD_TICKS = 30;      // a cart being filled or emptied

/**
 * How much gold is in one tile of seam, and why it runs out.
 *
 * Infinite seams made the map a backdrop. Whoever found a safe seam first could
 * sit on it for ever, expansion was optional, and the contested gold in the
 * middle of Kingsmoor — the whole reason that map has a middle — was a nice-to-
 * have rather than the thing the match is about. A finite seam turns the map
 * into a clock: every position you hold is being spent, and eventually you have
 * to go and take somebody else's.
 *
 * Large, because running dry in ninety seconds is a different game (and a worse
 * one) from running dry in ten minutes. A seam blob is about a dozen tiles, so
 * one blob is roughly 13,000 gold — hundreds of trips, and enough for an army.
 *
 * MEASURED DOWN FROM 1800. At that value Kingsmoor's home gold was 46,800 and
 * each player mined about 24,000 in the first ten minutes — so home lasted about
 * thirty-four minutes, which is longer than any match anyone plays. The seams
 * ran out in theory and never once in practice, so the expansion the middle of
 * that map exists for was optional, and everybody just sat at home. The point of
 * a finite seam is that holding ground has an expiry date; a number nobody
 * reaches is the same as no number at all.
 */
const GOLD_PER_TILE = 1100;
/**
 * TIMBER, AND WHY A WOOD IS NOT A SEAM.
 *
 * Gold is the clock: it is scarce, it is in a few places, and running out of it
 * is what eventually forces you off your own ground. Timber is the opposite —
 * woods are wide and everywhere, so timber is not a scarcity, it is a LABOUR
 * COST. Every plank in a barracks is a peasant who spent that minute not on the
 * gold. That is the decision it exists to create.
 *
 * Each tile still runs out, because a wood that never thins is scenery. It is
 * counted lazily: a forest tile only enters `sim.woods` once somebody has swung
 * an axe at it, so a map with four thousand trees does not carry four thousand
 * entries through every checksum for the whole match.
 */
const FELL_TICKS = 40;       // an axe is slower than a pick
const TIMBER_PER_TRIP = 6;
const TIMBER_PER_TILE = 180;

/**
 * FOOD IS GROWN, NOT FOUND.
 *
 * There is no food on the map. A farm makes it, and a peasant standing at the
 * farm makes it faster, which is what stops food from being a building you place
 * once and forget. Yield rises with the fertility of the ground it sits on — see
 * `fertility()` — so where you farm is a real choice on a map with hills in it.
 */
const HARVEST_TICKS = 50;
const FOOD_PER_TRIP = 8;

const BUILD_PER_TICK = 1;   // work one peasant contributes to a foundation
const WORK_REACH = 26;      // how close he must be to a seam, site or drop-off

/**
 * REPAIR, AND WHAT IT COSTS.
 *
 * Both numbers are expressed against what the building took to raise in the
 * first place, so a Watch Tower and a Manor do not need separate tuning and
 * anything added later inherits sensible rates for free.
 *
 * Mending a full health bar takes one peasant thirty seconds and costs 35% of
 * what the building cost to raise. That makes repair clearly better than
 * rebuilding — which it must be, or nobody would ever do it — while still being
 * enough money that patching a wall under siege is a real decision.
 *
 * THE TIME IS A FLAT NUMBER OF TICKS, NOT A FRACTION OF `buildWork`, and the
 * price falls back to `mendPrice` where a building has no cost. Deriving both
 * from what it took to build looks tidier and had a hole in it: the manor is
 * never bought, so its cost and its buildWork are both ZERO — which made
 * `maxHp / buildWork` an instant full heal, for nothing. The one building you
 * would most want to mend under siege was the one that mended itself for free.
 *
 * The gold is taken as the work happens rather than up front. A player who
 * walks their peasants away mid-repair should be charged for the mending they
 * got, and no more; and a player who cannot afford it should stop, not go
 * overdrawn.
 */
const REPAIR_TICKS = 600;   // one peasant, a whole bar, thirty seconds
const REPAIR_PRICE = 0.35;  // of cost, for the whole bar

// --- The board ---------------------------------------------------------------

// Kept as the size of the ORIGINAL two maps. Every map now carries its own
// dimensions in the MAPS table; these two are the default and are still exported
// because tools and tests refer to them.
export const MAP_W = 64;
export const MAP_H = 48;

/**
 * One symmetric map. Symmetry is not decoration — it is the only way a 1v1 can
 * be fair, and it makes an unfair result obviously a bug rather than the map.
 */
function buildMap(grid, random) {
  const blob = (cx, cy, r, kind = ROCK) => {
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (!inBounds(grid, tx, ty)) continue;
        const dx = tx - cx;
        const dy = ty - cy;
        if (dx * dx + dy * dy <= r * r) grid.cells[idx(grid, tx, ty)] = kind;
      }
    }
  };

  const wall = (tx, fromY, toY) => {
    for (let ty = fromY; ty <= toY; ty++) {
      if (inBounds(grid, tx, ty)) grid.cells[idx(grid, tx, ty)] = ROCK;
    }
  };

  /**
   * An irregular region, rather than a perfect circle.
   *
   * `blob` is a disc, and a map made of discs reads as polka dots the moment you
   * can see all of it at once — which is exactly what the big maps made
   * unavoidable. A region scatters several overlapping discs of varying size
   * around a centre, so a wood has bays and a crag has spurs. Seeded, so it is
   * the same wood every time the same match is played.
   */
  /**
   * A RANDOM DIRECTION, WITHOUT TRIGONOMETRY.
   *
   * This is not fastidiousness, it is the determinism rule at the top of
   * grid.js applied where it had been missed. `Math.sin` and `Math.cos` are NOT
   * required by ECMAScript to be correctly rounded — two engines may differ in
   * the last bit — and this runs inside map generation, which both peers do
   * from the shared seed. One bit of disagreement here does not desync a unit;
   * it builds the two players **different maps**, and every tick after that is
   * garbage.
   *
   * `Math.sqrt` IS specified exactly, so: draw a point in the square, reject it
   * if it falls outside the unit circle (which also gives a uniform angle for
   * free), and normalise. Every operation is +, -, *, / or sqrt, all of which
   * IEEE-754 pins down exactly. The rejection loop consumes a variable number of
   * draws, but from OUR seeded generator, so both peers consume the same ones.
   */
  const unitVector = () => {
    for (;;) {
      const x = random() * 2 - 1;
      const y = random() * 2 - 1;
      const d2 = x * x + y * y;
      if (d2 > 0.000001 && d2 <= 1) {
        const d = Math.sqrt(d2);
        return [x / d, y / d];
      }
    }
  };

  const region = (cx, cy, r, kind, lumps = 5) => {
    blob(cx, cy, Math.max(1, Math.round(r * 0.72)), kind);
    for (let i = 0; i < lumps; i++) {
      const [ux, uy] = unitVector();
      const d = r * (0.45 + random() * 0.55);
      blob(
        Math.round(cx + ux * d),
        Math.round(cy + uy * d),
        Math.max(1, Math.round(r * (0.3 + random() * 0.4))),
        kind
      );
    }
  };

  const patch = (x0, y0, x1, y1, kind) => {
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (inBounds(grid, tx, ty)) grid.cells[idx(grid, tx, ty)] = kind;
      }
    }
  };

  if (grid.mapId === "kingsmoor") {
    buildKingsmoor(grid, random, { blob, patch });
    return;
  }

  if (grid.mapId === "trishulPass") {
    buildTrishulPass(grid, random, { blob, patch });
    return;
  }

  if (grid.mapId === "kailashSanctum") {
    buildKailashSanctum(grid, random, { blob, patch, region });
    return;
  }

  if (grid.mapId === "fourKings") {
    buildFourKings(grid, random, { blob, patch, region });
    return;
  }

  if (grid.mapId === "theCrucible") {
    buildCrucible(grid, random, { blob, patch, region });
    return;
  }

  if (grid.mapId === "threeCrowns") {
    buildThreeCrowns(grid, random, { blob });
    return;
  }

  if (grid.mapId === "theSunder") {
    buildSunder(grid, random, { blob, patch, region });
    return;
  }

  if (grid.mapId === "ashenReach") {
    buildAshenReach(grid, random, { blob, patch, region });
    return;
  }

  if (grid.mapId === "hingol") {
    buildHingol(grid, random, { blob, patch, region });
    return;
  }

  if (grid.mapId === "twoGates") {
    // TWO GATES. A ridge with a gap top and bottom and nothing through the
    // middle, so an army has to commit to a flank and can be met there. The
    // original.
    for (let ty = 0; ty < MAP_H; ty++) {
      const inGap = (ty > 9 && ty < 16) || (ty > 31 && ty < 38);
      if (inGap) continue;
      grid.cells[idx(grid, 31, ty)] = 1;
      grid.cells[idx(grid, 32, ty)] = 1;
    }
    for (const [cx, cy, r] of [[14, 8, 3], [14, 39, 3], [49, 8, 3], [49, 39, 3]]) {
      blob(cx, cy, r);
    }
  } else {
    // THE NARROWS. One central passage instead of two, guarded by rock on both
    // sides, and open ground behind each base.
    //
    // It asks a different question from Two Gates rather than being a different
    // shape for its own sake. There, an attack can arrive from either flank and
    // splitting your army is punished; here everything must funnel through one
    // choke, so holding it is cheap and going around is impossible — which
    // rewards the massing the ladder's better tiers already do, and punishes
    // trickling far harder.
    for (let ty = 0; ty < MAP_H; ty++) {
      const inGap = ty > 20 && ty < 27;
      if (inGap) continue;
      grid.cells[idx(grid, 30, ty)] = 1;
      grid.cells[idx(grid, 33, ty)] = 1;
    }
    // Rock shoulders leading into the choke, mirrored on both axes.
    for (const [cx, cy, r] of [[24, 17, 4], [24, 30, 4], [39, 17, 4], [39, 30, 4]]) {
      blob(cx, cy, r);
    }
    // Short spurs behind each base, so there is somewhere sheltered to build.
    wall(11, 4, 11);
    wall(52, 4, 11);
    wall(11, 36, 43);
    wall(52, 36, 43);
  }

  // A nod to the seed so different matches are not pixel-identical, without
  // making the map unfair: the same jitter is applied to both halves.
  const jitter = Math.floor(random() * 5) - 2;
  for (const side of [0, 1]) {
    const cx = side === 0 ? 20 : 43;
    blob(cx, 24 + jitter, 2);
  }

  // Gold seams. The two original maps predate the peasant economy and had no
  // resource on them at all — without this there is nothing to mine and no game.
  // Two safe seams behind each base and one contested seam forward of it.
  //
  // Written as the WEST half plus a mirror rather than as six hand-placed
  // coordinates, because the hand-placed version was wrong: the mirror of tile 9
  // on a 64-wide map is 54, not `MAP_W - 12`. Three seams landed a couple of
  // tiles off and the east player won a mirror match 14-0. `W - 1 - tx` cannot
  // be off by one; arithmetic done in your head can.
  for (const [sx, sy] of [[9, 14], [9, 32], [26, 23]]) {
    blob(sx, sy, 2, GOLD);
    blob(grid.w - 1 - sx, sy, 2, GOLD);
  }

  // Woods, for the same reason and by the same method as the seams above.
  //
  // These two maps predate every terrain kind after "wall or not", so they had
  // no trees on them — and once timber became a price, a map with no trees was a
  // map where nothing can be built. Mirrored with `w - 1 - tx`, never with
  // hand-placed coordinates: that is exactly the arithmetic that once handed the
  // east player a 14-0 record here.
  //
  // Placed BEHIND and BESIDE each base rather than in the middle. Timber is a
  // labour cost, not a prize; making both players fight over the only trees on a
  // 64-tile map would turn a supply chore into the whole match.
  // Clear of the halls at (5,22) and (56,22). The first draft put a wood on top
  // of the west manor, so both crews spawned standing in trees.
  for (const [wx, wy, r] of [[5, 7, 3], [5, 37, 3], [18, 20, 3], [22, 6, 2], [22, 38, 2]]) {
    blob(wx, wy, r, FOREST);
    blob(grid.w - 1 - wx, wy, r, FOREST);
  }
}

/**
 * KINGSMOOR — three times the ground of the other two, and the first map with
 * terrain that is more than "wall or not".
 *
 * The shape of the decision, taken from Warrior Kings: a river splits the map
 * north to south with three fords. Everything must cross at a ford or go the
 * long way, and each ford is worth a different amount: the middle one is short
 * and open, the outer two are longer and screened by wood. Woods are walkable
 * but cost twice as much to cross, so an army in a wood is slow and an archer in
 * one is a nuisance. High ground can be built on and is where a Watch Tower is
 * worth its price.
 *
 * Gold is the reason to leave your base: two safe seams behind each manor, two
 * more on your own bank of the river, and a rich contested pair at the middle
 * ford that neither player can hold cheaply.
 *
 * Mirrored on the vertical axis, like the others. A 1v1 on an unfair map is not
 * a match, and a mirrored map makes an unfair RESULT obviously a bug.
 */
/**
 * THE SUNDER — two coasts and the water between them.
 *
 * 176x120, which is more than three times Kingsmoor and about nine times the
 * original maps. Deliberately NOT symmetric and not square: the west landmass is
 * a broad fertile shelf with its gold spread thin, the east is a narrower
 * highland spine with richer seams packed into fewer places. They are not the
 * same shape and they are not meant to be. A map where every start is a mirror
 * of every other is a diagram; Warrior Kings' maps were places.
 *
 * The strait is the map. It is crossable in three ways and each costs something
 * different:
 *
 *   - THE SHALLOWS in the north, where the water thins to a ford of open ground.
 *     Free, slow to reach, and everybody knows where it is.
 *   - THE NARROWS in the middle, four tiles across. Two bridges' worth of gold
 *     and the shortest road between the two halls.
 *   - THE DEEP in the south, wide and studded with rocks. A long bridge, or a
 *     flier, or nothing.
 *
 * Nobody starts able to reach anybody. That is the point: the opening is an
 * economy, and the moment you commit to a crossing you have told the other
 * player where you are coming from.
 */
function buildSunder(grid, random, { blob, patch, region }) {
  const W = grid.w;
  const H = grid.h;

  // The coastline. A hand-drawn edge for each shore, wobbling with the seed so
  // no two matches have quite the same beaches, then everything between them is
  // sea. Sampling a few control points and walking between them gives a coast
  // that bends rather than one that jitters per row.
  // TWO OCTAVES, BECAUSE ONE READS AS A FUNNEL.
  //
  // The first version interpolated between nine control points, which on a map
  // 120 rows tall means fifteen-row straight runs — and with a sine bend on top
  // the whole strait came out as a neat geometric hourglass. A coarse wander for
  // the shape of the coast plus a finer one for its detail gives an edge that
  // bends at several scales, which is what a coastline actually does.
  const octave = (n, spread) => {
    const points = [];
    for (let i = 0; i <= n; i++) points.push((random() - 0.5) * spread);
    return (u) => {
      const t = u * n;
      const i = Math.min(n - 1, Math.floor(t));
      const f = t - i;
      // Smoothstep between control points, so the joins are not visible corners.
      const e = f * f * (3 - 2 * f);
      return points[i] + (points[i + 1] - points[i]) * e;
    };
  };

  const coast = (base, spread, bend) => {
    const coarse = octave(5, spread);
    const fine = octave(17, spread * 0.45);
    return (ty) => {
      const u = ty / (H - 1);
      return Math.round(base + coarse(u) + fine(u) + bend(u));
    };
  };

  // West shore bulges east in the middle; east shore is pushed back at the top,
  // which is what opens the northern shallows.
  // `4u(1-u)` rather than `sin(pi*u)`: same shape — nought at both ends, one in
  // the middle — built from multiplication alone, which is exact everywhere.
  // See `unitVector` above for why a transcendental function has no business in
  // map generation.
  const bulge = (u) => 4 * u * (1 - u);
  const westEdge = coast(72, 22, (u) => bulge(u) * 7);
  const eastEdge = coast(106, 22, (u) => -bulge(u) * 5);

  for (let ty = 0; ty < H; ty++) {
    const from = westEdge(ty);
    const to = eastEdge(ty);
    patch(from, ty, to, ty, WATER);
  }

  // THE SHALLOWS: a band in the north where the sea is a ford instead.
  for (let ty = 12; ty <= 19; ty++) {
    const from = westEdge(ty);
    const to = eastEdge(ty);
    patch(from, ty, to, ty, GROUND);
  }
  // Boulders standing IN the ford, not beside it.
  //
  // These were markers on each shore — `blob(from - 2, …)` — which is a 3x3
  // stamp centred two tiles from the water, so it covered the first land tile at
  // each end and sealed the crossing at both. The map then had two landmasses
  // with no route between them and the halls were simply unreachable from one
  // another. Rock in the middle narrows the ford, which is what it was for;
  // rock at the ends closes it.
  for (const [bx, by] of [[0.3, 13], [0.62, 16], [0.45, 19]]) {
    const from = westEdge(by);
    const to = eastEdge(by);
    blob(Math.round(from + (to - from) * bx), by, 1, ROCK);
  }

  // THE NARROWS: pinch the middle to four tiles, the obvious place to bridge.
  for (let ty = 54; ty <= 66; ty++) {
    const mid = Math.round((westEdge(ty) + eastEdge(ty)) / 2);
    patch(westEdge(ty), ty, mid - 3, ty, GROUND);
    patch(mid + 2, ty, eastEdge(ty), ty, GROUND);
  }

  // THE DEEP: rocks in the southern water. They break a long bridge into
  // stretches and give a fleet-less army something to aim at.
  for (const [cx, cy, r] of [[86, 96, 2], [92, 104, 2], [80, 110, 2], [96, 88, 1]]) {
    region(cx, cy, r, ROCK);
  }

  // --- The west: a broad shelf, thin gold, easy building ---------------------
  for (const [cx, cy, r] of [[26, 20, 7], [40, 40, 6], [18, 62, 8], [34, 84, 7], [52, 102, 6], [12, 100, 5]]) {
    region(cx, cy, r, FOREST);
  }
  for (const [cx, cy, r] of [[46, 24, 5], [30, 52, 4], [56, 70, 5], [22, 88, 4]]) {
    region(cx, cy, r, HILL);
  }
  for (const [cx, cy, r] of [[16, 30, 2], [38, 16, 2], [50, 48, 2], [26, 72, 2], [46, 92, 2], [60, 60, 2], [10, 48, 2], [40, 110, 2]]) {
    blob(cx, cy, r, GOLD);
  }
  // A rocky spine down the west's back, so the shelf is not one open field.
  for (const [cx, cy, r] of [[8, 14, 4], [6, 76, 5], [24, 108, 4], [58, 8, 3]]) {
    region(cx, cy, r, ROCK);
  }

  // --- The east: a highland spine, rich gold, awkward ground -----------------
  for (const [cx, cy, r] of [[130, 16, 9], [148, 34, 8], [126, 56, 7], [156, 76, 9], [136, 100, 8], [166, 108, 6]]) {
    region(cx, cy, r, HILL);
  }
  for (const [cx, cy, r] of [[142, 24, 6], [160, 54, 5], [128, 82, 6], [150, 112, 5]]) {
    region(cx, cy, r, FOREST);
  }
  for (const [cx, cy, r] of [[144, 20, 3], [134, 62, 3], [158, 92, 3], [168, 40, 2], [124, 104, 3]]) {
    blob(cx, cy, r, GOLD);
  }
  for (const [cx, cy, r] of [[170, 12, 5], [116, 34, 4], [172, 70, 6], [118, 118, 5], [154, 4, 4]]) {
    region(cx, cy, r, ROCK);
  }

  // Clear ground for the halls, last, so nothing above can bury a start.
  for (const [sx, sy] of MAPS.theSunder.starts) blob(sx + 1, sy + 1, 7, GROUND);
}

/**
 * THE ASHEN REACH — canyon country, after the fire.
 *
 * 200x104, the widest map in the game and the one that behaves least like the
 * others. Inspired by the mesa country of the American southwest: the ground is
 * mostly IMPASSABLE, and what you actually play on is a branching network of
 * canyon floors between plateaus.
 *
 * That inverts the usual problem. On every other map the question is where to
 * meet; here the question is which way round. There are four routes east to
 * west and they are not equivalent — the northern canyon is wide and fast and
 * has nothing in it, the two central ones are narrow, forked and full of gold,
 * and the southern one is a long detour that arrives behind everything.
 *
 * The plateaus are HILL, which means they are buildable and slow. A tower on a
 * mesa overlooks two canyons at once and cannot be reached without walking
 * around, which is the single most Warrior Kings thing on the map.
 */
/**
 * THE HINGOL. A river down the length of a red desert, and six seats on it.
 *
 * Built in the order a place forms: the water first, because everything else is
 * a response to it; then the ground the water made; then the rock, the woods
 * that follow the river, and last the gold, which is put where it makes people
 * go rather than where it looks tidy.
 *
 * The river is drawn as a CENTRELINE with a width, not as a rectangle. A
 * straight canal would make the three crossings arbitrary — you could ford it
 * anywhere and the map would have no shape. A wandering river with three
 * deliberate narrows has three answers and they are all different.
 */
function buildHingol(grid, random, { blob, patch, region }) {
  const W = grid.w;
  const H = grid.h;

  // --- the river ---------------------------------------------------------
  //
  // Centre x for each row, wandering about the middle. Two slow waves plus a
  // seeded drift, all polynomial — see `unitVector` for why nothing here is
  // allowed to be a sine.
  const drift = random() * 12 - 6;
  const centreAt = (ty) => {
    const u = ty / (H - 1);
    // Two humps in opposite directions: a lazy S down the map.
    const s = 4 * u * (1 - u);            // 0 at the ends, 1 in the middle
    const t = 4 * (u - 0.5) * (u - 0.5);  // 1 at the ends, 0 in the middle
    return Math.round(W / 2 + s * 26 - t * 18 + drift);
  };

  // Width by latitude. THE THREE CROSSINGS ARE THREE WIDTHS.
  //
  //   north (u < 0.24) — the shallows, wide but shallow: open ground, not water
  //   middle (0.42..0.58) — the gorge, four tiles across and walled in rock
  //   south — broad and deep, crossable only by building
  const widthAt = (ty) => {
    const u = ty / (H - 1);
    if (u < 0.22) return 0;                 // the shallows: no water at all
    if (u > 0.42 && u < 0.58) return 4;     // the gorge
    if (u > 0.78) return 16;                // the southern flats
    return 9;
  };

  for (let ty = 0; ty < H; ty++) {
    const wide = widthAt(ty);
    // A WIDTH OF ZERO MEANS NO RIVER, NOT A RIVER ONE TILE WIDE.
    //
    // Without this the shallows were a continuous single-tile channel running
    // the whole length of the north, because `|tx - cx| <= 0` is true for the
    // centre tile. Measured: every east-bank seat came out UNREACHABLE from
    // every west-bank seat, so the map was two islands and the crossing the
    // blurb promises did not exist.
    if (wide <= 0) continue;
    const cx = centreAt(ty);
    const half = wide / 2;
    for (let tx = 0; tx < W; tx++) {
      if (Math.abs(tx - cx) <= half) grid.cells[idx(grid, tx, ty)] = WATER;
    }
  }

  // --- the gorge walls ---------------------------------------------------
  //
  // What makes the middle crossing a gorge rather than a puddle: rock rims on
  // both banks, so an army that takes it is committed and an army that watches
  // it is above it. High ground on the rims, which is where a tower earns its
  // price.
  for (let ty = Math.floor(H * 0.40); ty < Math.floor(H * 0.60); ty++) {
    const cx = centreAt(ty);
    for (const side of [-1, 1]) {
      const edge = cx + side * 4;
      for (let d = 2; d < 9; d++) {
        const tx = edge + side * d;
        if (!inBounds(grid, tx, ty)) continue;
        if (grid.cells[idx(grid, tx, ty)] !== GROUND) continue;
        grid.cells[idx(grid, tx, ty)] = d < 6 ? ROCK : HILL;
      }
    }
  }

  // --- the two banks are not the same country ----------------------------
  //
  // West is broad farmland: low, open, easy to build on, gold spread thin.
  // East is broken: rock spurs and hills, less room, richer seams.
  for (let i = 0; i < 26; i++) {
    const x = 8 + Math.floor(random() * (W * 0.34));
    const y = 6 + Math.floor(random() * (H - 12));
    if (grid.cells[idx(grid, x, y)] === GROUND) region(x, y, 3 + random() * 4, HILL, 3);
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(W * 0.62) + Math.floor(random() * (W * 0.34));
    const y = 6 + Math.floor(random() * (H - 12));
    if (grid.cells[idx(grid, x, y)] === GROUND) {
      region(x, y, 3 + random() * 5, random() < 0.55 ? ROCK : HILL, 4);
    }
  }

  // --- woods follow the water --------------------------------------------
  //
  // In a desert, trees grow where the river is. This is also why timber is a
  // reason to go NEAR the river — the one resource that pulls you toward the
  // thing you are most likely to be killed at.
  for (let ty = 4; ty < H - 4; ty += 3) {
    const cx = centreAt(ty);
    const half = widthAt(ty) / 2;
    for (const side of [-1, 1]) {
      if (random() > 0.62) continue;
      const x = Math.round(cx + side * (half + 6 + random() * 10));
      if (!inBounds(grid, x, ty)) continue;
      if (grid.cells[idx(grid, x, ty)] !== GROUND) continue;
      region(x, ty, 2 + random() * 3, FOREST, 3);
    }
  }
  // And a few real woods further out, so the banks are not the only timber.
  for (let i = 0; i < 14; i++) {
    const x = 10 + Math.floor(random() * (W - 20));
    const y = 6 + Math.floor(random() * (H - 12));
    if (grid.cells[idx(grid, x, y)] === GROUND) region(x, y, 4 + random() * 4, FOREST, 4);
  }

  // --- gold ---------------------------------------------------------------
  //
  // Home seams first, and deliberately: the Ashen Reach shipped with all its
  // gold along the contested middles and measured ZERO tiles within thirty of
  // either start, which is a start position that cannot open. Learned once.
  for (const [sx, sy] of MAPS.hingol.starts) {
    const inward = sx < W / 2 ? 1 : -1;
    for (const [dx, dy] of [[13, -8], [16, 9], [24, -2]]) {
      blob(sx + inward * dx, sy + dy, 2, GOLD);
    }
  }
  // Then the prizes: rich seams on the gorge rims, which is the reason to want
  // the middle at all rather than merely to cross it.
  for (const ty of [Math.floor(H * 0.44), Math.floor(H * 0.56)]) {
    const cx = centreAt(ty);
    blob(cx - 13, ty, 3, GOLD);
    blob(cx + 13, ty, 3, GOLD);
  }
  // And a seeded scatter, so twelve seeds are twelve maps.
  for (let i = 0; i < 18; i++) {
    const x = 12 + Math.floor(random() * (W - 24));
    const y = 8 + Math.floor(random() * (H - 16));
    if (grid.cells[idx(grid, x, y)] === GROUND) blob(x, y, 1 + Math.floor(random() * 2), GOLD);
  }

  // --- home woods, because this mistake has now been made twice -----------
  //
  // The Ashen Reach shipped with 307 tiles of wood and none of it within thirty
  // of a start, so timber — the price of every building — was unreachable in the
  // opening. Measured here before shipping: seats 3 and 5 had ZERO. Riparian
  // woods follow the river, and two of the six seats do not sit near it.
  for (const [sx, sy] of MAPS.hingol.starts) {
    const inward = sx < W / 2 ? 1 : -1;
    for (const [dx, dy] of [[11, 14], [17, -13]]) {
      region(sx + inward * dx, sy + dy, 4, FOREST, 3);
    }
  }

  // --- and room to stand at every start -----------------------------------
  for (const [sx, sy] of MAPS.hingol.starts) blob(sx + 1, sy + 1, 7, GROUND);
}

function buildAshenReach(grid, random, { blob, patch, region }) {
  const W = grid.w;
  const H = grid.h;

  // Start from solid rock and cut the world out of it. Every other map in this
  // game adds obstacles to a field; this one removes a field from an obstacle,
  // which is why it feels different to play before a single unit moves.
  patch(0, 0, W - 1, H - 1, ROCK);

  /** A canyon floor: a wandering channel of open ground, `wide` tiles across. */
  const carve = (points, wide) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(x0 + ((x1 - x0) * s) / steps);
        const y = Math.round(y0 + ((y1 - y0) * s) / steps);
        // The width breathes a little along the run, so a canyon has bays and
        // pinch points rather than being a corridor of constant size.
        const r = wide + (Math.abs((x * 7 + y * 13) % 5) - 2) * 0.5;
        blob(x, y, Math.max(1, Math.round(r)), GROUND);
      }
    }
  };

  // The four roads. Deliberately different characters, deliberately not mirrored.
  carve([[4, 14], [40, 10], [78, 16], [120, 12], [160, 18], [196, 14]], 6);          // north: wide, fast, empty
  carve([[6, 44], [34, 40], [56, 52], [88, 44], [104, 56], [138, 46], [172, 52], [196, 44]], 4); // middle north: forked
  carve([[4, 66], [30, 74], [62, 64], [92, 76], [126, 66], [158, 74], [196, 68]], 4);          // middle south
  carve([[8, 96], [48, 100], [96, 92], [148, 98], [192, 94]], 5);                    // south: the long way round

  // Cross-links, so the network is a net and not four parallel tunnels. Fewer
  // than you would expect, because the value of a canyon map is that going the
  // wrong way is expensive.
  carve([[40, 10], [44, 40]], 3);
  carve([[88, 44], [92, 76]], 3);
  carve([[126, 66], [130, 12]], 3);
  carve([[158, 74], [160, 98]], 3);
  carve([[30, 74], [34, 100]], 3);

  // Mesas: buildable high ground on the shoulders of the canyons. Placed on
  // rock, so they read as the tops of the plateaus rather than as hills in a
  // field.
  for (const [cx, cy, r] of [
    [24, 28, 7], [66, 32, 6], [104, 28, 8], [146, 30, 6], [182, 32, 7],
    [20, 82, 6], [58, 88, 7], [100, 84, 6], [140, 86, 7], [178, 82, 6],
    [76, 58, 5], [116, 56, 5],
  ]) {
    region(cx, cy, r, HILL);
  }

  // Scrub in the wider bays — the only cover on the whole map.
  for (const [cx, cy, r] of [[46, 12, 4], [110, 14, 4], [64, 50, 3], [100, 58, 3], [150, 48, 3], [70, 96, 4], [160, 96, 3]]) {
    region(cx, cy, r, FOREST);
  }

  // Gold, and where it is IS the map's argument: little on the fast northern
  // road, most of it down the two contested middles, a rich pocket at the far
  // end of the southern detour for whoever thinks it is worth the walk.
  for (const [cx, cy, r] of [
    [58, 14, 2], [168, 16, 2],
    [52, 48, 3], [86, 46, 3], [112, 54, 3], [144, 48, 3],
    [44, 70, 3], [78, 70, 3], [118, 68, 3], [154, 72, 3],
    [96, 92, 3], [122, 94, 3],
  ]) {
    blob(cx, cy, r, GOLD);
  }

  // A seeded scatter of boulders that narrow a few random pinch points, so the
  // same map plays differently between matches without the layout changing.
  for (let i = 0; i < 14; i++) {
    const x = 12 + Math.floor(random() * (W - 24));
    const y = 8 + Math.floor(random() * (H - 16));
    if (grid.cells[idx(grid, x, y)] === GROUND) blob(x, y, 1 + Math.floor(random() * 2), ROCK);
  }

  // HOME SEAMS, AND THEY HAD TO BE PLACED DELIBERATELY.
  //
  // The first version put all the gold along the contested middles, which reads
  // well and is unplayable: measured, neither start had a single tile of gold
  // within thirty, so both players opened with peasants and nowhere to send
  // them. On a map where the routes are the content, the opening economy still
  // has to be at hand.
  for (const [sx, sy] of MAPS.ashenReach.starts) {
    for (const [dx, dy] of [[14, -6], [16, 8], [24, 2]]) {
      const gx = sx < 100 ? sx + dx : sx - dx;
      blob(gx, sy + dy, 2, GOLD);
    }
  }

  // HOME WOODS, FOR EXACTLY THE SAME REASON.
  //
  // The identical mistake, one resource later: this map's 307 tiles of wood are
  // all out along the routes, so measured, neither start had a SINGLE tree
  // within thirty tiles. Timber is the price of every building, so that is a
  // start position that cannot build — the same unplayable opening the home
  // seams above were added to fix, arrived at by the same reasoning.
  //
  // Placed on the far side of the hall from the gold, so the two errands pull in
  // different directions and splitting the crew is a real choice.
  for (const [sx, sy] of MAPS.ashenReach.starts) {
    for (const [dx, dy] of [[10, -14], [14, 16]]) {
      const wx = sx < 100 ? sx + dx : sx - dx;
      blob(wx, sy + dy, 4, FOREST);
    }
  }

  for (const [sx, sy] of MAPS.ashenReach.starts) blob(sx + 1, sy + 1, 8, GROUND);
}

/**
 * THREE CROWNS. Three halls around a ring of hills, nobody with a back wall.
 *
 * FAIRNESS IS THE WHOLE PROBLEM, AND IT IS A DIFFERENT PROBLEM FROM 1v1.
 *
 * Two seats are made fair by mirroring the map left to right, which is exact:
 * `w - 1 - tx` is integer arithmetic and either matches or does not. Three seats
 * need 120-degree rotational symmetry instead, and that brings two difficulties
 * that took a while to see:
 *
 *   1. A ROTATION DOES NOT MAP A RECTANGLE ONTO ITSELF. Turn a 96x64 map by a
 *      third and most of it lands outside. So the playable ground here is a DISC
 *      inscribed in a square grid, with rock beyond the rim — the shape of the
 *      map is what makes the symmetry possible, not a decoration on top of it.
 *
 *   2. NO TRIGONOMETRY, ANYWHERE. The obvious way to write this is to classify
 *      each tile by its angle from the centre, `atan2(dy, dx) mod 120 degrees`.
 *      ECMAScript does NOT specify `atan2`, `sin` or `cos` as correctly rounded
 *      — they are implementation-approximated — so two players on different
 *      browsers could classify a boundary tile differently and desync on tick
 *      zero, on a map that looked identical in both screenshots. Everything
 *      below uses only `+ - * /`, `Math.sqrt` and `Math.round`, all of which are
 *      exactly specified. This is the same rule as `Math.sqrt` never
 *      `Math.hypot` in the pathfinder, for the same reason.
 *
 * So terrain is authored ONCE, in a frame local to a seat, and laid down for all
 * three seats from their own frames. Symmetric by construction: there is no
 * arithmetic done in your head to get wrong, which is exactly what the mirror
 * test was written to catch when it caught it twice.
 */
function buildThreeCrowns(grid, random, { blob }) {
  const W = grid.w;
  const H = grid.h;
  const starts = MAPS.threeCrowns.starts;

  // THE CENTRE IS THE TRIANGLE'S, NOT THE GRID'S.
  //
  // This was `(W - 1) / 2` on both axes, which is the middle of the canvas and
  // not the middle of the three halls — the triangle sits a fraction low and its
  // x-centre is 48, not 47.5. Half a tile, and it was enough: measured, seat 2
  // sat 0.86 tiles further from the centre than seat 1, so the rim of the disc
  // cut into its home ground and took a gold seam with it. Seat 2 opened with 3
  // tiles of gold and 25 of rock where seat 0 had 15 and none.
  //
  // Derived from the HALLS so the two cannot drift apart again — and from the
  // halls rather than the starts, because a start is a manor's top-left corner
  // and the manor is three tiles across. Measuring corners put the centre one
  // tile off in x, which is not a rounding error: it made seat 2 sit 1.7 tiles
  // further out than seat 1 and cost it a seam to the rim.
  const HALL = 1; // a manor's centre, from its corner
  const cx = starts.reduce((n, [x]) => n + x + HALL, 0) / starts.length;
  const cy = starts.reduce((n, [, y]) => n + y + HALL, 0) / starts.length;
  const RIM = 45;

  // Beyond the rim there is nothing. Squared distances, so no square root and
  // no boundary a rounding difference could move.
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const dx = tx - cx;
      const dy = ty - cy;
      if (dx * dx + dy * dy > RIM * RIM) grid.cells[idx(grid, tx, ty)] = ROCK;
    }
  }

  /**
   * A point in one seat's frame: `forward` tiles toward the centre of the map,
   * `side` tiles across it. Every feature is placed this way, so writing it once
   * places it three times.
   */
  const at = (seat, forward, side) => {
    const sx = starts[seat][0] + HALL;
    const sy = starts[seat][1] + HALL;
    const vx = cx - sx;
    const vy = cy - sy;
    const len = Math.sqrt(vx * vx + vy * vy);
    const fx = vx / len;
    const fy = vy / len;
    // The perpendicular, which is just the forward vector turned a quarter.
    return [
      Math.round(sx + fx * forward - fy * side),
      Math.round(sy + fy * forward + fx * side),
    ];
  };

  const forEachSeat = (forward, side, r, kind) => {
    for (let seat = 0; seat < starts.length; seat++) {
      const [x, y] = at(seat, forward, side);
      blob(x, y, r, kind);
    }
  };

  // The middle: a hill crown with the richest gold on the map on top of it.
  // High ground, slow to cross, in reach of everybody and safe for nobody — the
  // same job the centre seams do on Kingsmoor.
  blob(Math.round(cx), Math.round(cy), 11, HILL);
  blob(Math.round(cx), Math.round(cy), 4, GOLD);

  // Everything below is written once per seat and mirrored across that seat's
  // own axis, which gives the map the full symmetry of a triangle rather than
  // just the rotation. A seat whose left flank differed from its right would be
  // fair between players and still lopsided to play.

  // Home seams, close enough to work from the hall on the first peasant.
  forEachSeat(10, -7, 2, GOLD);
  forEachSeat(10, 7, 2, GOLD);

  // Woods screening the approach, so an army coming at you has to commit.
  forEachSeat(19, -11, 5, FOREST);
  forEachSeat(19, 11, 5, FOREST);

  // Shoulders of high ground either side of home — the tower ground.
  forEachSeat(5, -15, 4, HILL);
  forEachSeat(5, 15, 4, HILL);

  // Rock spurs between neighbours, which is what stops the ride around the
  // outside being as quick as the ride through the middle.
  forEachSeat(24, -22, 4, ROCK);
  forEachSeat(24, 22, 4, ROCK);

  // A contested seam on each of the three roads between neighbours.
  forEachSeat(30, -20, 2, GOLD);

  // SEEDED SCATTER, DRAWN ONCE AND LAID DOWN THREE TIMES.
  //
  // Without this the map ignored its seed completely, and every match on it was
  // the same match: twelve seeds produced twelve identical games, ending at the
  // identical second. That is not a hard bug to miss — the map looked fine and
  // the matches ran — but it means a dozen "samples" were one sample, and any
  // balance measured from them was measuring nothing.
  //
  // The draw happens ONCE per feature and is then stamped for every seat, so the
  // map varies between matches without any seat getting different ground from
  // another.
  for (let i = 0; i < 4; i++) {
    const forward = 12 + Math.floor(random() * 16);
    const side = 6 + Math.floor(random() * 14);
    const r = 3 + Math.floor(random() * 3);
    const kind = random() < 0.35 ? HILL : FOREST;
    forEachSeat(forward, -side, r, kind);
    forEachSeat(forward, side, r, kind);
  }

  // Clear ground for the hall itself, LAST, so nothing above can bury a start.
  // Placing a manor on rock is a crash; placing it on a seam eats the seam.
  for (let seat = 0; seat < starts.length; seat++) {
    blob(starts[seat][0] + HALL, starts[seat][1] + HALL, 6, GROUND);
  }
}

function buildKingsmoor(grid, random, { blob, patch }) {
  const W = grid.w;
  const H = grid.h;
  const midX = Math.floor(W / 2);

  // The river, with three fords cut through it. Water is impassable, so the
  // fords ARE the map.
  const fordYs = [Math.floor(H * 0.18), Math.floor(H * 0.5), Math.floor(H * 0.82)];
  for (let ty = 0; ty < H; ty++) {
    const atFord = fordYs.some((fy) => Math.abs(ty - fy) <= 3);
    if (atFord) continue;
    patch(midX - 2, ty, midX + 1, ty, WATER);
  }

  // Woods screening the two outer fords, and a scatter of copses on each half.
  // Every copse is placed twice, mirrored, so neither player gets better cover.
  const copses = [
    [22, 10, 5], [22, 70, 5], [30, 26, 4], [30, 56, 4],
    [44, 14, 4], [44, 66, 4], [47, 40, 5], [16, 42, 4],
  ];
  for (const [cx, cy, r] of copses) {
    blob(cx, cy, r, FOREST);
    blob(W - 1 - cx, cy, r, FOREST);
  }

  // High ground — buildable, slow to cross, and the obvious place for a tower.
  for (const [cx, cy, r] of [[34, 20, 5], [34, 62, 5], [26, 41, 4]]) {
    blob(cx, cy, r, HILL);
    blob(W - 1 - cx, cy, r, HILL);
  }

  // Rock, to stop the outer edges being an empty motorway around everything.
  for (const [cx, cy, r] of [[13, 24, 3], [13, 58, 3], [39, 5, 4], [39, 76, 4]]) {
    blob(cx, cy, r, ROCK);
    blob(W - 1 - cx, cy, r, ROCK);
  }

  // Gold. Safe pair behind the manor, a forward pair, and the contested seams
  // either side of the middle ford.
  for (const [cx, cy, r] of [[8, 30, 2], [8, 52, 2], [28, 12, 2], [28, 70, 2]]) {
    blob(cx, cy, r, GOLD);
    blob(W - 1 - cx, cy, r, GOLD);
  }
  blob(midX - 6, fordYs[1], 3, GOLD);
  blob(midX + 5, fordYs[1], 3, GOLD);

  // The same seeded jitter on both halves, so matches differ without either
  // player getting the better of it.
  const jitter = Math.floor(random() * 7) - 3;
  for (const [cx, cy, r] of [[20, 30, 3]]) {
    blob(cx, cy + jitter, r, FOREST);
    blob(W - 1 - cx, cy + jitter, r, FOREST);
  }
}

function buildTrishulPass(grid, random, { blob, patch }) {
  const W = grid.w;
  const H = grid.h;
  const midX = Math.floor(W / 2);

  // The Three Ridges of the Trishul Peak (Northern, Central, Southern Prongs)
  blob(midX, Math.floor(H * 0.14), 11, ROCK);
  blob(midX, Math.floor(H * 0.50), 9, ROCK);
  blob(midX, Math.floor(H * 0.86), 11, ROCK);

  // The Two Narrow Mountain Passes (Northern Pass Y~32, Southern Pass Y~64)
  const passYs = [Math.floor(H * 0.32), Math.floor(H * 0.64)];
  
  // Glacier stream cutting through the valleys
  for (let ty = 0; ty < H; ty++) {
    const inPass = passYs.some(py => Math.abs(ty - py) <= 4);
    if (inPass) continue;
    patch(midX - 1, ty, midX + 1, ty, WATER);
  }

  // Deodar pine forests on mountain slopes
  const woods = [
    [20, 18, 5], [20, 78, 5], [36, 32, 4], [36, 64, 4],
    [50, 16, 4], [50, 80, 4], [25, 48, 5], [14, 48, 4]
  ];
  for (const [cx, cy, r] of woods) {
    blob(cx, cy, r, FOREST);
    blob(W - 1 - cx, cy, r, FOREST);
  }

  // High Hill Platforms
  for (const [cx, cy, r] of [[38, 20, 5], [38, 76, 5], [52, 48, 4]]) {
    blob(cx, cy, r, HILL);
    blob(W - 1 - cx, cy, r, HILL);
  }

  // Sacred Mountain Gold deposits
  for (const [cx, cy, r] of [[12, 36, 2], [12, 60, 2], [32, 14, 2], [32, 82, 2]]) {
    blob(cx, cy, r, GOLD);
    blob(W - 1 - cx, cy, r, GOLD);
  }
  // High-value contested central seam in the passes
  blob(midX - 8, passYs[0], 3, GOLD);
  blob(midX + 7, passYs[0], 3, GOLD);
  blob(midX - 8, passYs[1], 3, GOLD);
  blob(midX + 7, passYs[1], 3, GOLD);
}

function buildKailashSanctum(grid, random, { blob, patch, region }) {
  const W = grid.w;
  const H = grid.h;
  const midX = Math.floor(W / 2);
  const midY = Math.floor(H / 2);

  // 1. Mount Kailash: The Sacred Central Snow-Crowned Peak
  blob(midX, midY, 13, ROCK);
  blob(midX, midY - 6, 8, ROCK);
  blob(midX, midY + 6, 8, ROCK);

  // 2. High Glacial Lakes:
  // Northern: Lake Manasarovar (Pure round glacial lake)
  blob(midX, Math.floor(H * 0.16), 11, WATER);
  // Southern: Lake Rakshastal (Crescent dark lake)
  blob(midX, Math.floor(H * 0.84), 11, WATER);

  // 3. Two Strategic Mountain Passes (Northern Pass Y~34, Southern Pass Y~78)
  const passYs = [Math.floor(H * 0.34), Math.floor(H * 0.78)];

  // High Alpine Deodar & Cedar Forests on mountain slopes
  const woods = [
    [24, 20, 6], [24, 92, 6], [42, 38, 5], [42, 74, 5],
    [58, 20, 5], [58, 92, 5], [30, 56, 6], [18, 56, 5]
  ];
  for (const [cx, cy, r] of woods) {
    blob(cx, cy, r, FOREST);
    blob(W - 1 - cx, cy, r, FOREST);
  }

  // High Hill Terraces for tactical elevation & defense
  for (const [cx, cy, r] of [[44, 24, 6], [44, 88, 6], [62, 56, 5]]) {
    blob(cx, cy, r, HILL);
    blob(W - 1 - cx, cy, r, HILL);
  }

  // Sacred Mountain Gold veins:
  // Base home seams
  for (const [cx, cy, r] of [[18, 42, 2], [18, 70, 2], [38, 18, 2], [38, 94, 2]]) {
    blob(cx, cy, r, GOLD);
    blob(W - 1 - cx, cy, r, GOLD);
  }

  // Contested High Glacial Seams in the Passes and around Mount Kailash
  blob(midX - 10, passYs[0], 3, GOLD);
  blob(midX + 9, passYs[0], 3, GOLD);
  blob(midX - 10, passYs[1], 3, GOLD);
  blob(midX + 9, passYs[1], 3, GOLD);
  blob(midX - 8, midY, 3, GOLD);
  blob(midX + 7, midY, 3, GOLD);
}

function buildFourKings(grid, random, { blob, patch, region }) {
  const W = grid.w;
  const H = grid.h;
  const midX = Math.floor(W / 2);
  const midY = Math.floor(H / 2);

  // 1. Asymmetric Center: Ancient Mahashira Fortress Sanctuary & Mount Kailash Crags
  blob(midX, midY, 14, ROCK);
  blob(midX - 8, midY - 6, 9, ROCK);
  blob(midX + 7, midY + 8, 9, ROCK);
  blob(midX - 12, midY + 10, 7, HILL);
  blob(midX + 11, midY - 10, 7, HILL);

  // 2. Glacial River System (Asymmetrical meandering water course from North-East glacier down to South-West lake)
  for (let t = 0; t < 160; t++) {
    const rx = Math.floor(150 - t * 0.85 + Math.sin(t * 0.08) * 8);
    const ry = Math.floor(10 + t * 0.85 + Math.cos(t * 0.06) * 7);
    if (rx >= 0 && rx < W && ry >= 0 && ry < H) {
      blob(rx, ry, (t > 70 && t < 90) ? 1 : 2, WATER);
    }
  }

  // Large South-West Glacial Lake Basin
  blob(38, 126, 12, WATER);
  blob(46, 134, 9, WATER);

  // 3. Four Asymmetric Strategic Quadrants
  // Q1: North-West Alpine Highlands (Terraced Hill fortress with pine slopes)
  blob(36, 20, 7, HILL);
  blob(18, 42, 6, FOREST);
  blob(42, 38, 6, FOREST);
  blob(28, 16, 3, GOLD);
  blob(14, 32, 2, GOLD);

  // Q2: North-East Craggy Glacial Ridge (Surrounded by mountain rock walls and switchbacks)
  blob(124, 18, 8, ROCK);
  blob(144, 42, 6, FOREST);
  blob(118, 38, 5, FOREST);
  blob(140, 16, 3, GOLD);
  blob(128, 34, 2, GOLD);

  // Q3: South-West Lake Basin & Meadow (Fertile river delta with rich timber)
  blob(16, 118, 6, HILL);
  blob(38, 148, 8, FOREST);
  blob(16, 148, 6, FOREST);
  blob(30, 142, 3, GOLD);
  blob(14, 124, 2, GOLD);

  // Q4: South-East High Canyon Gorge (Arid crags and deep rock corridors)
  blob(144, 118, 8, ROCK);
  blob(120, 146, 6, FOREST);
  blob(146, 146, 5, FOREST);
  blob(124, 126, 3, GOLD);
  blob(142, 140, 2, GOLD);

  // 4. Contested High-Yield Gold Clusters in passes and around central summit
  blob(midX - 16, midY - 14, 4, GOLD);
  blob(midX + 15, midY + 14, 4, GOLD);
  blob(midX - 14, midY + 16, 4, GOLD);
  blob(midX + 16, midY - 14, 4, GOLD);
  blob(midX, midY - 18, 3, GOLD);
  blob(midX, midY + 18, 3, GOLD);

  // Clear 7x7 flat clearings around the 4 player starting manors
  for (const [sx, sy] of [[20, 22], [136, 24], [22, 136], [134, 134]]) {
    blob(sx + 1, sy + 1, 7, GROUND);
  }
}

function buildCrucible(grid, random, { blob, patch, region }) {
  const W = grid.w;
  const H = grid.h;
  const midX = Math.floor(W / 2);
  const midY = Math.floor(H / 2);

  // 1. High Outer Volcanic Caldera Ring Ridge (Impassable Sheer Mountain Cliffs)
  // Drawn with 4 wide canyon entrance gateways at cardinal points
  for (let angle = 0; angle < Math.PI * 2; angle += 0.05) {
    // Leave 4 canyon pass openings at 0, PI/2, PI, 3PI/2
    const nearPass = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].some(a => Math.abs(angle - a) < 0.18);
    if (nearPass) continue;

    const rx = Math.floor(midX + Math.cos(angle) * (W * 0.45));
    const ry = Math.floor(midY + Math.sin(angle) * (H * 0.45));
    if (rx >= 0 && rx < W && ry >= 0 && ry < H) {
      blob(rx, ry, 4, ROCK);
    }
  }

  // 2. Four Elevated Bastion Corner Mesas (High Tablelands)
  blob(32, 32, 10, HILL);
  blob(112, 32, 10, HILL);
  blob(32, 112, 10, HILL);
  blob(112, 112, 10, HILL);

  // 3. Central Sunken Valley Basin with Glacial River Cross & Wide Fords
  // Wide open fords at mid-spans ensure all 4 sectors are fully walkable and connected
  for (let t = 20; t < H - 20; t++) {
    // River has wide walkable fords at y: 36-48, 62-82 (center), and 96-108
    const inFord = (t >= 36 && t <= 48) || (t >= midY - 10 && t <= midY + 10) || (t >= 96 && t <= 108);
    if (inFord) continue;

    const rx = Math.floor(midX + Math.sin(t * 0.12) * 3);
    if (rx >= 0 && rx < W) {
      blob(rx, t, 1, WATER);
    }
  }

  for (let t = 20; t < W - 20; t++) {
    const inFord = (t >= 36 && t <= 48) || (t >= midX - 10 && t <= midX + 10) || (t >= 96 && t <= 108);
    if (inFord) continue;

    const ry = Math.floor(midY + Math.cos(t * 0.12) * 3);
    if (ry >= 0 && ry < H) {
      blob(t, ry, 1, WATER);
    }
  }

  // 4. Central Contested Citadel Island (Raised Monolith Mesa)
  blob(midX, midY, 8, HILL);
  blob(midX - 14, midY, 4, ROCK);
  blob(midX + 14, midY, 4, ROCK);

  // 5. Home Woods for all 4 starting bases (ensuring ample timber within 20 tiles)
  for (const [sx, sy] of [[18, 18], [122, 18], [18, 122], [122, 122]]) {
    const dx = sx < midX ? 12 : -12;
    const dy = sy < midY ? 12 : -12;
    blob(sx + dx, sy, 4, FOREST);
    blob(sx, sy + dy, 4, FOREST);
    blob(sx + dx, sy + dy, 3, FOREST);
  }

  // Lowland Woods
  blob(midX - 22, midY - 22, 5, FOREST);
  blob(midX + 22, midY - 22, 5, FOREST);
  blob(midX - 22, midY + 22, 5, FOREST);
  blob(midX + 22, midY + 22, 5, FOREST);

  // 6. Gold Deposits
  // Safe Home Gold Seams for all 4 seats
  for (const [sx, sy] of [[18, 18], [122, 18], [18, 122], [122, 122]]) {
    const dx = sx < midX ? 9 : -9;
    const dy = sy < midY ? 9 : -9;
    blob(sx + dx, sy, 2, GOLD);
    blob(sx, sy + dy, 2, GOLD);
    blob(sx + dx * 2, sy + dy, 2, GOLD);
  }

  // Contested Sunken Lowland Gold Seams
  blob(midX - 16, midY - 16, 3, GOLD);
  blob(midX + 16, midY - 16, 3, GOLD);
  blob(midX - 16, midY + 16, 3, GOLD);
  blob(midX + 16, midY + 16, 3, GOLD);
  blob(midX, midY, 3, GOLD); // The Central Monolith Core

  // 7. Clear 7x7 flat start pads around the 4 bases
  for (const [sx, sy] of [[18, 18], [122, 18], [18, 122], [122, 122]]) {
    blob(sx + 1, sy + 1, 7, GROUND);
  }
}

// --- Setup -------------------------------------------------------------------

/**
 * The maps, mirrored left to right so a 1v1 on one is actually fair.
 *
 * `starts` are the manors' top-left tiles and are part of the map rather than
 * computed, because a start position that drifts with the map size is a start
 * position that quietly stops being mirrored.
 */

/**
 * THE THREE RESOURCES.
 *
 * Warrior Kings: Battles runs on food, materials and gold, and the reason is not
 * variety for its own sake — it is that one resource makes every decision a
 * question of "how much", and three make it a question of "which". A barracks
 * that wants timber as well as coin cannot be bought by simply mining harder.
 *
 * Flat fields on the player rather than a `stock` object, because `player.gold`
 * already appears in twenty-six places that all still mean exactly what they
 * said, and a refactor that touches every one of them to say `stock.gold`
 * changes nothing except the number of places a mistake can hide.
 */
export const RESOURCES = ["gold", "timber", "food"];

/**
 * A price, normalised.
 *
 * `cost: 180` means 180 gold — the overwhelming majority of prices, and spelling
 * it `{ gold: 180 }` everywhere would be noise. `cost: { gold: 120, timber: 60 }`
 * means both. Either form is legal; this is the only place that needs to know.
 */
export function priceOf(spec) {
  const c = spec.cost;
  if (typeof c === "number") return { gold: c, timber: 0, food: 0 };
  return { gold: c.gold ?? 0, timber: c.timber ?? 0, food: c.food ?? 0 };
}

export function canAfford(player, spec) {
  const price = priceOf(spec);
  return RESOURCES.every((r) => player[r] >= price[r]);
}

export function pay(player, spec) {
  const price = priceOf(spec);
  for (const r of RESOURCES) player[r] -= price[r];
}

/** Give it back — a cancelled order should cost nothing. */
export function refund(player, spec) {
  const price = priceOf(spec);
  for (const r of RESOURCES) player[r] += price[r];
}

/**
 * What is missing, and how much, in words a player can act on.
 *
 * Silence is the worst failure mode: an order dropped for want of timber looks
 * exactly like a broken button, and with three resources "not enough gold" is
 * now a lie as often as it is the truth.
 */
export function shortfall(player, spec) {
  const price = priceOf(spec);
  const missing = RESOURCES
    .filter((r) => player[r] < price[r])
    .map((r) => `${Math.ceil(price[r] - player[r])} ${r}`);
  return missing.join(" and ");
}

/**
 * Seat colours, and they have to survive being looked at quickly.
 *
 * Blue and red were chosen against the terrain, which is warm and low-contrast.
 * A third has to be as far from BOTH as it is from the ground — green reads as
 * the selection ring, gold reads as a seam, so this is a pale violet: nothing
 * else on the map is anywhere near it.
 */
/**
 * SIX SEATS' WORTH, AND THEY HAVE TO BE TELLABLE APART AT FORTY PIXELS.
 *
 * Not a rainbow. Every colour here is picked to survive being a twelve-pixel
 * smudge on a two-hundred-tile map: distinct in hue from its neighbours, similar
 * in value so none of them reads as "the faint player", and none of them close
 * to the terrain greens or the gold-seam yellow.
 */
const SEAT_COLOURS = [
  "#7fa7d4", // blue
  "#d47f7f", // red
  "#b79fd4", // violet
  "#87c9a3", // jade
  "#d8b45c", // amber
  "#c98fb4", // rose
];

const SEAT_NAMES = [
  "You", "The Pretender", "The Third Crown",
  "The Fourth Seat", "The Fifth Seat", "The Sixth Seat",
];

export const MAPS = {
  twoGates: {
    id: "twoGates",
    seats: 2,
    symmetry: "mirrorX",
    name: "Two Gates",
    w: 64, h: 48,
    starts: [[5, 22], [56, 22]],
    blurb: "A ridge with a gap at each end. Attack either flank — or defend both.",
  },
  narrows: {
    id: "narrows",
    seats: 2,
    symmetry: "mirrorX",
    name: "The Narrows",
    w: 64, h: 48,
    starts: [[5, 22], [56, 22]],
    blurb: "One passage through the rock. Nothing goes around it, so everything meets in it.",
  },
  theSunder: {
    id: "theSunder",
    seats: 2,
    // Not mirrored, and does not claim to be. The two coasts are different
    // shapes with different economies, which is the point — see the note on
    // map symmetry in the knowledge pack.
    symmetry: "none",
    name: "The Sunder",
    w: 176, h: 120,
    starts: [[16, 54], [152, 56]],
    blurb:
      "Two coasts and the sea between them. A ford in the north, a narrows worth " +
      "bridging in the middle, and deep water in the south that nobody crosses cheaply.",
  },
  ashenReach: {
    id: "ashenReach",
    seats: 2,
    symmetry: "none",
    name: "The Ashen Reach",
    w: 200, h: 104,
    starts: [[8, 40], [186, 62]],
    blurb:
      "Canyon country. Four roads run east to west and none of them are the same " +
      "road — the fast one is empty, the rich ones are narrow, and the long one " +
      "arrives behind you.",
  },
  /**
   * THE HINGOL — the biggest ground in the game, and the first named for a real
   * place in the material.
   *
   * > Hinglaj Devi: "the primordial red one" — Hingula (cinnabar) + Aj
   * > (primordial/unborn). Her temple sits "nestled within a narrow gorge" in
   * > the Makran Desert along the Hingol River, where Sati's Brahmarandhra fell.
   * >   — siddhapedia.com/hinglaj-devi
   *
   * A red desert, a river, and a gorge. That is a map, and it was sitting in the
   * lore the whole time — an article we had already read for faction names, when
   * what it actually describes is terrain.
   *
   * 280x160 is 44,800 tiles: more than twice The Sunder, and the reason the
   * camera work on the big maps had to be done first.
   *
   * THE SHAPE OF THE DECISION. The Hingol runs the length of the map and every
   * seat sits on one bank or the other. It is crossable in three places and each
   * costs something different — the northern shallows are free and far from
   * everything, the gorge in the middle is short and overlooked from both rims,
   * and the southern flats are wide open with no cover at all.
   *
   * SIX SEATS, DELIBERATELY UNEVEN. Three on each bank, and they are not
   * mirrored: the west bank is broad farmland with its gold spread thin, the
   * east is broken rock with rich seams in fewer places. A 2-player match uses
   * the two outer seats and plays as a long-range duel; a 6-player match is a
   * brawl over three crossings. Per the standing decision in the design pack,
   * this map is NOT balanced to a spreadsheet — different positions have
   * different problems, which is what makes a place rather than a diagram.
   */
  hingol: {
    id: "hingol",
    name: "The Hingol",
    w: 280, h: 160,
    seats: 6,
    symmetry: "none",
    // West bank reads down the left, east bank down the right. Seat order
    // alternates banks so that a 2- or 3-player match is never all on one side.
    starts: [
      [16, 26], [263, 34],
      [14, 80], [265, 126],
      [20, 134], [258, 78],
    ],
    blurb:
      "The red country, and the river through it. Three ways across: the " +
      "shallows in the north that everyone can use and nobody can hold, the " +
      "gorge in the middle that is short and watched from both rims, and the " +
      "southern flats where there is nothing to hide behind at all.",
  },
  threeCrowns: {
    id: "threeCrowns",
    name: "Three Crowns",
    // Square, because the playable ground is a DISC inscribed in it. A rotation
    // by 120 degrees maps a disc onto itself and does not map a rectangle onto
    // anything, so the shape of the map is what makes three-way fairness
    // possible at all — see `buildThreeCrowns`.
    w: 96, h: 96,
    seats: 3,
    symmetry: "rot120",
    // An equilateral triangle about (48, 48), as near as a square grid allows:
    // the base is 60 tiles and the sides are 60.03, because the height of an
    // equilateral triangle is its base times an irrational number and no integer
    // triple is exact. Three hundredths of a tile is not a fairness problem; it
    // is why the test below measures what each seat HAS rather than comparing
    // rotated pixels.
    starts: [[48, 13], [18, 65], [78, 65]],
    blurb:
      "Three halls around a ring of hills, each an equal ride from the other two. " +
      "Nobody here has a back to defend.",
  },
  kingsmoor: {
    id: "kingsmoor",
    seats: 2,
    symmetry: "mirrorX",
    name: "Kingsmoor",
    w: 112, h: 84,
    starts: [[6, 40], [103, 40]],
    blurb:
      "A river with three fords, woods that slow an army, high ground worth a tower, " +
      "and gold in the middle that neither of you can hold cheaply.",
  },
  trishulPass: {
    id: "trishulPass",
    seats: 2,
    symmetry: "none",
    name: "Trishul Pass (त्रिशूल दर्रा)",
    w: 128, h: 96,
    starts: [[8, 48], [117, 48]],
    weather: "snow",
    biome: "alpine_himalaya",
    blurb:
      "The Three Ridges of the sacred Trishul peaks dividing the high snow line from " +
      "the alpine valleys. Two narrow switchback passes contested by glacial streams and mountain gold.",
  },
  kailashSanctum: {
    id: "kailashSanctum",
    seats: 2,
    symmetry: "none",
    name: "Kailash Sanctum (कैलाश धाम)",
    w: 144, h: 112,
    starts: [[12, 56], [129, 56]],
    weather: "snow",
    biome: "alpine_himalaya",
    blurb:
      "The Sacred Axis Mundi Mount Kailash standing between Lake Manasarovar and Lake Rakshastal. " +
      "Towering glacial pinnacles, deep mountain passes, and contested high-altitude gold seams.",
  },
  fourKings: {
    id: "fourKings",
    seats: 4,
    symmetry: "none",
    name: "Valley of the Four Kings (चतुर्नृप उपत्यका)",
    w: 160, h: 160,
    starts: [[20, 22], [136, 24], [22, 136], [134, 134]],
    weather: "fair",
    biome: "alpine_himalaya",
    blurb:
      "A vast, asymmetric Himalayan expanse for 4 contending kings (AI or human). " +
      "Towering jagged summits, meandering glacial rivers, deep forest gorges, and a contested central fortress sanctuary.",
  },
  theCrucible: {
    id: "theCrucible",
    seats: 4,
    symmetry: "none",
    name: "The Crucible (कुण्ड द्रोणी)",
    w: 144, h: 144,
    starts: [[18, 18], [122, 18], [18, 122], [122, 122]],
    weather: "fair",
    biome: "alpine_himalaya",
    blurb:
      "A faithful 1:1 recreation of the iconic Warrior Kings Battles caldera. " +
      "Four elevated corner bastion plateaus overlooking a deep sunken river basin with high sniper cliffs and contested central gold monoliths.",
  },
};
export const MAP_IDS = Object.keys(MAPS);

export const SCENARIOS = {
  chapter1: {
    id: "chapter1",
    chapter: 1,
    title: "Chapter I: The Mountain Pass of Trishul",
    mapId: "trishulPass",
    hero: "senapati",
    difficulty: "Novice",
    briefing: "Warlord raiders descend from the high snowy crags to seize the sacred mountain pass. Command Senapati Indra, construct an Akhara, defend the pass against 3 raiding assaults, and vanquish the Raider Chieftain.",
    objectives: [
      { id: "build_barracks", desc: "Construct an Akhara (Barracks)", done: false },
      { id: "survive_waves", desc: "Defend the Pass against 3 Raiding Waves", done: false, count: 0, total: 3 },
      { id: "defeat_chieftain", desc: "Eliminate the Raider Chieftain in the North", done: false },
    ],
    waves: [
      { tick: 400, units: [{ type: "spearman", count: 4 }], msg: "⚠️ First Raiding Vanguard approaches through the southern gap!" },
      { tick: 900, units: [{ type: "spearman", count: 6 }, { type: "archer", count: 3 }], msg: "⚠️ Second Raiding Warband sighted ascending the terrace!" },
      { tick: 1500, units: [{ type: "warRider", count: 3 }, { type: "spearman", count: 8 }, { type: "ratha", count: 1 }], chieftain: true, msg: "⚔️ The Raider Chieftain arrives at the head of the war host!" }
    ],
  },
  chapter2: {
    id: "chapter2",
    chapter: 2,
    title: "Chapter II: Trial of the 8-Headed Naga",
    mapId: "ashenReach",
    hero: "acharya",
    difficulty: "Adept",
    briefing: "Rogue cultists have desecrated the ancient mountain terrace. Guide Kaula Acharya, train a cadre of Yoginis, harness the celestial Vajra Storm, and cleanse the sacred Naga Shrine.",
    objectives: [
      { id: "train_yoginis", desc: "Train 4 Yoginis at your Akhara", done: false, count: 0, total: 4 },
      { id: "cast_vajra", desc: "Cast Vajra Storm 2 times in battle", done: false, count: 0, total: 2 },
      { id: "destroy_shrine", desc: "Purify the Rogue Mountain Stronghold", done: false },
    ],
    waves: [
      { tick: 500, units: [{ type: "archer", count: 5 }, { type: "spearman", count: 5 }], msg: "⚡ Rogue acolytes launch a sortie against your encampment!" },
      { tick: 1100, units: [{ type: "yogini", count: 3 }, { type: "guardian", count: 4 }], msg: "⚡ Cultist mystics channel dark prana towards your gates!" }
    ],
  },
  chapter3: {
    id: "chapter3",
    chapter: 3,
    title: "Chapter III: The Siege of Kailash Sanctum",
    mapId: "kailashSanctum",
    hero: "senapati",
    difficulty: "Master",
    briefing: "The mountain fortress of the usurper sits heavily fortified behind stone walls and watchtowers. Assemble a mighty siege train with Sthapati engineers, battering rams and catapults to storm the citadel.",
    objectives: [
      { id: "raise_keep", desc: "Raise your Asana to a Keep (Shira Durg)", done: false },
      { id: "erect_catapults", desc: "Erect 2 Catapults or Rams", done: false, count: 0, total: 2 },
      { id: "destroy_citadel", desc: "Raze the Usurper's Mountain Palace", done: false },
    ],
    waves: [
      { tick: 600, units: [{ type: "warRider", count: 4 }, { type: "archer", count: 6 }], msg: "🏹 Fortress defenders sortie from the outer barbican!" },
      { tick: 1300, units: [{ type: "ratha", count: 2 }, { type: "guardian", count: 6 }], msg: "🛡️ Heavy fortress guards counter-attack your siege engines!" }
    ],
  },
  chapter4: {
    id: "chapter4",
    chapter: 4,
    title: "Chapter IV: Night Ambush in the Pine Passes",
    mapId: "trishulPass",
    hero: "senapati",
    difficulty: "Master",
    dialogue: [
      { speaker: "Senapati Indra", role: "Supreme Commander", avatar: "👑", text: "The moon is shrouded in the pine valleys. The mountaineer raiders use the dark fog for cover. Mount our archers upon the stone battlements and take the Surya Tirtha to illuminate the ridge!" },
      { speaker: "Scout Dhanurdhara", role: "Vanguard", avatar: "🏹", text: "Commander, they approach through the lower tree lines. Ready bows and hold fire until they enter the kill zone!" }
    ],
    briefing: "Hostile mountaineer raiders emerge under cover of night. Mount your archers on stone ramparts (+50% Range), capture the sacred Surya Tirtha, and defeat the Night Warlord.",
    objectives: [
      { id: "mount_archers", desc: "Mount 4 Archers or Mystics on Stone Walls", done: false, count: 0, total: 4 },
      { id: "capture_surya", desc: "Capture and Consecrate the Surya Tirtha", done: false },
      { id: "defeat_warlord", desc: "Eliminate the Night Warlord's Main War Host", done: false },
    ],
    waves: [
      { tick: 450, units: [{ type: "spearman", count: 6 }, { type: "archer", count: 4 }], msg: "🌙 Night raiders stealthily advance through the outer pine glade!" },
      { tick: 950, units: [{ type: "warRider", count: 4 }, { type: "huntress", count: 4 }], msg: "🏹 Mounted raiders charge the southern pass outposts!" },
      { tick: 1600, units: [{ type: "ratha", count: 2 }, { type: "guardian", count: 8 }, { type: "archer", count: 6 }], warlord: true, msg: "⚔️ The Night Warlord leads the supreme assault on your stronghold!" }
    ],
  },
  chapter5: {
    id: "chapter5",
    chapter: 5,
    title: "Chapter V: Defense of the Five River Bridges",
    mapId: "twoGates",
    hero: "acharya",
    difficulty: "Grandmaster",
    dialogue: [
      { speaker: "Kaula Acharya", role: "Tantric Sage", avatar: "🔮", text: "The glacial river divides our lands. The enemy king sends battering rams and armored chariots to force the river crossings. Build fortified gatehouses to bar their passage and unleash the Vajra Storm!" },
      { speaker: "Yogini Vani", role: "Dakini Mystic", avatar: "⚡", text: "The prana flows through the waters. When our gatehouses hold, our lightning will incinerate their war machines!" }
    ],
    briefing: "Enemy war engines attempt to breach the river crossings. Construct fortified gatehouses (Dwara), deploy War Chariots (Ratha), and repel 4 massive crossing assaults.",
    objectives: [
      { id: "build_gatehouses", desc: "Construct 2 Fortified Gatehouses (Dwara)", done: false, count: 0, total: 2 },
      { id: "train_rathas", desc: "Train 2 War Chariots (Ratha) at your Armory", done: false, count: 0, total: 2 },
      { id: "repel_crossings", desc: "Repel 4 Glacial River Crossing Waves", done: false, count: 0, total: 4 },
    ],
    waves: [
      { tick: 400, units: [{ type: "spearman", count: 6 }, { type: "ram", count: 1 }], msg: "🌊 First vanguard assaults the eastern river bridge!" },
      { tick: 850, units: [{ type: "ratha", count: 2 }, { type: "archer", count: 6 }], msg: "🏹 Armored war chariots bombard the river gatehouses!" },
      { tick: 1400, units: [{ type: "ram", count: 2 }, { type: "guardian", count: 6 }, { type: "yogini", count: 2 }], msg: "🛡️ Heavy assault brigade forces the central river crossing!" },
      { tick: 2000, units: [{ type: "ratha", count: 3 }, { type: "catapult", count: 2 }, { type: "guardian", count: 10 }], msg: "⚔️ Supreme Royal Host commits all forces to breach your river perimeter!" }
    ],
  },
  chapter6: {
    id: "chapter6",
    chapter: 6,
    title: "Chapter VI: Siege of the Asura Citadel",
    mapId: "theCrucible",
    hero: "senapati",
    difficulty: "Legendary",
    dialogue: [
      { speaker: "Senapati Indra", role: "Supreme Commander", avatar: "👑", text: "This is the final redoubt of the Asura tyrant. The caldera fortress is surrounded by ancient Himalayan Tirthas. Capture the four holy sanctums to shatter the citadel's mystical warding, roll forward our heavy catapults, and claim Swarajya for eternity!" },
      { speaker: "Kaula Acharya", role: "Tantric Sage", avatar: "🔮", text: "The four holy energies — Surya, Vayu, Kavacha, and Soma — will unite to bestow supreme victory upon our armies!" }
    ],
    briefing: "Grand Finale: Capture all 4 Sacred Himalayan Tirthas to shatter the fortress wards, erect 3 Heavy Catapults (Shila Yantra), and raze the Asura Mountain Palace.",
    objectives: [
      { id: "capture_all_tirthas", desc: "Capture all 4 Sacred Himalayan Tirthas", done: false, count: 0, total: 4 },
      { id: "erect_heavy_catapults", desc: "Construct 3 Heavy Catapults (Shila Yantra)", done: false, count: 0, total: 3 },
      { id: "raze_asura_palace", desc: "Raze the Central Asura Mountain Palace", done: false },
    ],
    waves: [
      { tick: 600, units: [{ type: "guardian", count: 6 }, { type: "huntress", count: 4 }], msg: "🏰 Citadel garrison sorties to reclaim the outer shrines!" },
      { tick: 1200, units: [{ type: "ratha", count: 3 }, { type: "catapult", count: 1 }, { type: "yogini", count: 3 }], msg: "⚡ Tyrant's inner guard unleashes heavy counter-battery fire!" },
      { tick: 1800, units: [{ type: "dragon", count: 1 }, { type: "guardian", count: 10 }, { type: "ram", count: 2 }], msg: "🐉 The Supreme Asura Warlord sorties with celestial war beasts!" }
    ],
  },
};
export const TIRTHAS = {
  surya: {
    id: "surya",
    name: "Surya Tirtha",
    title: "Solar Sanctum",
    color: "#ffaa00",
    auraColor: 0xffaa00,
    desc: "+15% Army Damage & 1.25x Crop Harvest Yield",
    buffs: { dmgMul: 1.15, cropMul: 1.25 },
  },
  vayu: {
    id: "vayu",
    name: "Vayu Peeth",
    title: "Shrine of the Gales",
    color: "#00d4ff",
    auraColor: 0x00d4ff,
    desc: "+18% Movement Speed & Rapid Cooldowns",
    buffs: { speedMul: 1.18, reloadMul: 0.82 },
  },
  kavacha: {
    id: "kavacha",
    name: "Vajra Kavacha Shrine",
    title: "Sanctum of Protection",
    color: "#ff3366",
    auraColor: 0xff3366,
    desc: "+25% Fortification HP & +1.5 HP/s Passive Regen",
    buffs: { buildingHpMul: 1.25, regenPerSec: 1.5 },
  },
  soma: {
    id: "soma",
    name: "Soma Kund",
    title: "Celestial Nectar Spring",
    color: "#aa44ff",
    auraColor: 0xaa44ff,
    desc: "+25% Mystic Spell Damage & Extended Shields",
    buffs: { spellMul: 1.25, shieldMul: 2.0 },
  },
};
export const TIRTHA_IDS = Object.keys(TIRTHAS);

export function playerHasTirtha(sim, owner, type) {
  if (!sim || !sim.tirthas) return false;
  return sim.tirthas.some(t => t.type === type && t.controller === owner);
}

export function createSim(seed = 1, mapId = "twoGates", scenarioId = null) {
  const scenario = scenarioId && SCENARIOS[scenarioId] ? JSON.parse(JSON.stringify(SCENARIOS[scenarioId])) : null;
  const actualMapId = scenario ? scenario.mapId : mapId;
  const random = makeRng(seed);
  const map = MAPS[actualMapId] ?? MAPS.twoGates;
  const grid = createGrid(map.w, map.h);
  grid.mapId = map.id;
  buildMap(grid, random);

  const sim = {
    seed,
    mapId: grid.mapId,
    scenarioId: scenario ? scenario.id : null,
    scenario,
    hazards: [],
    tirthas: [],
    grid,
    tick: 0,
    over: false,
    winner: null,
    players: map.starts.map(([, ], i) => ({
      id: i,
      name: SEAT_NAMES[i] ?? `Player ${i + 1}`,
      gold: START_GOLD,
      timber: START_TIMBER,
      food: START_FOOD,
      starving: false,
      path: null,
      pathLocked: false,
      goldRate: 1,
      colour: SEAT_COLOURS[i],
      seq: 0,
      out: false,
    })),
    buildings: [],
    sites: [],
    units: [],
    projectiles: [],
    inputs: [],
    nextInput: 0,
    nextId: 1,
    fields: new Map(),
    fieldsDirty: false,
    seams: new Map(),
    woods: new Map(),
    events: [],
    sounds: [],
    diplomacy: Array.from({ length: map.starts.length }, (_, i) =>
      Array.from({ length: map.starts.length }, (_, j) => (i === j ? "self" : "enemy"))
    ),
  };

  for (const [tx, ty] of goldSeams(grid)) {
    sim.seams.set(idx(grid, tx, ty), GOLD_PER_TILE);
  }

  // Initialize Strategic Sacred Himalayan Tirthas (Shrines)
  const midX = Math.floor(grid.w / 2);
  const midY = Math.floor(grid.h / 2);
  const tirthaConfigs = [
    { type: "surya", tx: midX, ty: Math.floor(grid.h * 0.25) },
    { type: "vayu", tx: midX, ty: Math.floor(grid.h * 0.75) },
  ];
  if (map.starts.length >= 4 || grid.w >= 140) {
    tirthaConfigs.push({ type: "kavacha", tx: Math.floor(grid.w * 0.25), ty: midY });
    tirthaConfigs.push({ type: "soma", tx: Math.floor(grid.w * 0.75), ty: midY });
  }
  for (const cfg of tirthaConfigs) {
    const spot = freeSpotNear(sim, cfg.tx, cfg.ty);
    const tx = spot ? spot.tx : cfg.tx;
    const ty = spot ? spot.ty : cfg.ty;
    sim.tirthas.push({
      id: sim.nextId++,
      type: cfg.type,
      spec: TIRTHAS[cfg.type],
      tx,
      ty,
      x: tileCentre(tx),
      y: tileCentre(ty),
      controller: null,
      progress: 0,
      capturingOwner: null,
    });
  }

  const manors = map.starts.map(([sx, sy], owner) =>
    placeBuilding(sim, owner, "manor", sx, sy)
  );
  for (const manor of manors) {
    for (let i = 0; i < START_PEASANTS; i++) spawnUnit(sim, manor, "peasant");
  }

  // If scenario has a designated hero, spawn the hero for player 0!
  if (sim.scenario && sim.scenario.hero && manors[0]) {
    spawnUnit(sim, manors[0], sim.scenario.hero);
    say(sim, `⚔️ Campaign Mission: ${sim.scenario.title}`, true);
  }

  sim.events.length = 0;
  sim.sounds.length = 0;

  return sim;
}

// --- Buildings ---------------------------------------------------------------

function footprint(spec, tx, ty) {
  const tiles = [];
  for (let y = ty; y < ty + spec.tiles; y++) {
    for (let x = tx; x < tx + spec.tiles; x++) tiles.push([x, y]);
  }
  return tiles;
}

/**
 * The tiles exactly `r` rings out from a footprint, as a hollow rectangle.
 *
 * The obvious version — offsets of -r..+r from `tx` — is WRONG for anything
 * bigger than one tile, and wrong asymmetrically. A footprint spans tx..tx+2,
 * so a ring built from tx alone reaches three tiles clear on the left and only
 * one on the right. Both seats then muster and build off-centre in the same
 * direction, which on a mirrored map means one of them is two tiles closer to
 * their own hall than the other. Every unit. All match. Mirror matches went
 * 0-12 on it.
 *
 * Measure from the footprint's EDGES and the shape is symmetric by construction.
 */
export function ringAround(tx, ty, tiles, r) {
  const out = [];
  const x0 = tx - r;
  const y0 = ty - r;
  const x1 = tx + tiles - 1 + r;
  const y1 = ty + tiles - 1 + r;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1) out.push([x, y]);
    }
  }
  return out;
}

/**
 * TAKING A PATH, AND THE POINT OF NO RETURN.
 *
 * Raising a path-house commits you: the other two become unbuildable. Until your
 * hall reaches a Castle that commitment is REVERSIBLE — lose every building of
 * your path and you are unaligned again, free to choose differently. At Castle
 * it sets, exactly as Warrior Kings sets alignment at its castle tier.
 *
 * The reversible window matters more than it sounds. Without it, one raid on a
 * half-built Bastion in the eighth minute would decide what kind of army you are
 * allowed to have for the rest of the match, and that is a coin-flip wearing a
 * decision's clothes.
 */
function takePath(sim, owner, path) {
  const player = sim.players[owner];
  if (player.path === path) return;
  player.path = path;
  applyPathBonus(sim, owner);
  say(sim, `${player.name} takes the ${PATHS[path].name} path — ${PATHS[path].title}.`, true);
  sound(sim, "build", owner);
}

/**
 * Drop an unset path when the last house of it falls, before the Castle sets it.
 *
 * Called wherever a building is lost rather than on a timer, so it is exact and
 * costs nothing on a quiet tick.
 */
function reviewPath(sim, owner) {
  const player = sim.players[owner];
  if (!player.path || player.pathLocked) return;
  const holds = sim.buildings.some(
    (b) => b.owner === owner && b.spec.path === player.path
  ) || sim.sites.some((s) => s.owner === owner && s.spec.path === player.path);
  if (holds) return;
  player.path = null;
  applyPathBonus(sim, owner);
  say(sim, `${player.name} is unaligned again.`);
}

/**
 * Re-scale what a path changes. Same fraction rule as a manor tier: a wounded
 * building stays wounded by the same fraction, so taking or losing a path never
 * heals anything and never kills anything outright.
 */
function applyPathBonus(sim, owner) {
  const bonus = buildingHpBonus(sim, owner);
  for (const b of sim.buildings) {
    if (b.owner !== owner) continue;
    const base = b.spec.isHeart ? MANOR_TIERS[b.tier].hp : b.spec.hp;
    const want = Math.round(base * (1 + bonus));
    if (want === b.maxHp) continue;
    const frac = b.hp / b.maxHp;
    b.maxHp = want;
    b.hp = want * frac;
  }
}

/** The steadfast path's stone. Zero for everybody else. */
export function buildingHpBonus(sim, owner) {
  const path = sim.players[owner]?.path;
  const pathBonus = path ? (PATHS[path].buildingHp ?? 0) : 0;
  const kavachaBonus = playerHasTirtha(sim, owner, "kavacha") ? 0.25 : 0;
  return pathBonus + kavachaBonus;
}

/** The kinetic path's legs. Zero for everybody else. */
export function speedBonus(sim, owner) {
  const path = sim.players[owner]?.path;
  return path ? (PATHS[path].speed ?? 0) : 0;
}

/** What tier this player's hall stands at. No hall is tier 0, not a crash. */
/** How much grain this player can hold: the hall, plus every storehouse. */
export function granaryOf(sim, owner) {
  let cap = 0;
  for (const b of sim.buildings) {
    if (b.owner !== owner) continue;
    if (b.spec.isHeart) cap += BASE_GRANARY;
    else if (b.spec.granary) cap += b.spec.granary;
  }
  return cap;
}

/**
 * Put grain in, up to what there is room for. Returns what actually landed.
 *
 * Every path that adds food goes through here — the peasant tipping a basket and
 * the cart emptying a depot — because a cap that only one of them respects is
 * not a cap, it is a bug with a rule written next to it.
 */
function storeFood(sim, owner, amount) {
  const player = sim.players[owner];
  const room = Math.max(0, granaryOf(sim, owner) - player.food);
  const kept = Math.min(amount, room);
  player.food += kept;
  return kept;
}

export function manorTier(sim, owner) {
  const hall = sim.buildings.find((b) => b.owner === owner && b.spec.isHeart);
  return hall ? hall.tier : 0;
}

/** The flat, non-cumulative bonus a player's men get from their hall. */
export function mightOf(sim, owner) {
  return MANOR_TIERS[manorTier(sim, owner)].might;
}

/**
 * Take a hall up a tier, and carry the men up with it.
 *
 * Existing units are rescaled rather than left behind, because "the bonus only
 * applies to men raised after the upgrade" is a rule nobody can see and everyone
 * would misread as the upgrade doing nothing. A wounded man stays wounded by the
 * same FRACTION — scaling hp and maxHp together means an upgrade never heals and
 * never hurts, it only raises the ceiling.
 */
function applyManorTier(sim, hall, tier) {
  const was = MANOR_TIERS[hall.tier];
  const now = MANOR_TIERS[tier];
  hall.tier = tier;

  // The hall itself. Same fraction rule, for the same reason.
  const wounded = hall.hp / hall.maxHp;
  hall.maxHp = now.hp;
  hall.hp = now.hp * wounded;

  for (const u of sim.units) {
    if (u.owner !== hall.owner) continue;
    const frac = u.hp / u.maxHp;
    u.maxHp = Math.round(u.spec.hp * (1 + now.might));
    u.hp = u.maxHp * frac;
  }

  // A CASTLE SETS YOUR PATH. Announced, because an irreversible thing that
  // happens silently is a rule players learn by being punished for it.
  const player = sim.players[hall.owner];
  if (tier >= 2 && player.path && !player.pathLocked) {
    player.pathLocked = true;
    say(sim, `${player.name} is committed to the ${PATHS[player.path].name} path.`, true);
  }

  // The hall's own ceiling still owes the path whatever the path gives.
  applyPathBonus(sim, hall.owner);

  say(sim, `${sim.players[hall.owner].name} raises a ${now.name}.`, true);
  sound(sim, "build", hall.owner);
  return was;
}

export function canBuild(sim, owner, type, tx, ty) {
  const spec = BUILDINGS[type];
  if (!spec) return { ok: false, reason: "no such building" };
  if (spec.isHeart && sim.buildings.some((b) => b.owner === owner && b.spec.isHeart)) {
    return { ok: false, reason: "you already have a manor" };
  }
  // A LOCKED BUILDING MUST SAY WHAT UNLOCKS IT, AND SAY IT FIRST.
  //
  // Before the price, deliberately. Silence is the worst failure mode a gate can
  // have — a button that does nothing and explains nothing reads as a bug rather
  // than as a tech tree — but "you are 120 gold short" is very nearly as bad
  // when the truth is that no amount of gold would help. Answer the question the
  // player is actually asking.
  const tier = manorTier(sim, owner);
  if ((spec.needsTier ?? 0) > tier) {
    return {
      ok: false,
      reason: `needs a ${MANOR_TIERS[spec.needsTier].name} — raise your hall first`,
    };
  }

  // A path already taken forbids the other two, and says which one you took.
  const taken = sim.players[owner].path;
  if (spec.path && taken && spec.path !== taken) {
    return {
      ok: false,
      reason: `you have taken the ${PATHS[taken].name} path`,
    };
  }

  if (!canAfford(sim.players[owner], spec)) {
    return { ok: false, reason: `not enough ${shortfall(sim.players[owner], spec)}` };
  }
  if (!sim.units.some((u) => u.owner === owner && u.spec.worker)) {
    return { ok: false, reason: "no peasants to raise it" };
  }

  for (const [x, y] of footprint(spec, tx, ty)) {
    if (!inBounds(sim.grid, x, y)) return { ok: false, reason: "off the map" };
    const cell = sim.grid.cells[idx(sim.grid, x, y)];

    // A BRIDGE IS THE ONE THING THAT WANTS BAD GROUND UNDER IT.
    //
    // Everything else is refused on water; a bridge is refused ANYWHERE ELSE.
    // That inversion is the whole mechanic: a strait is not a wall, it is a
    // wall with a price, and the price is paid at a place both sides can see.
    if (spec.spans) {
      if (cell !== WATER) return { ok: false, reason: "a bridge needs water under it" };
      continue;
    }
    // A gate goes where a wall goes: ordinary buildable ground.

    // `buildable`, not `passable`: a wood is walkable and a gold seam is
    // walkable, but dropping a warehouse on the only seam in reach would let a
    // player delete the map's economy by paying 90 gold for it.
    if (!buildable(sim.grid, x, y)) {
      return { ok: false, reason: "cannot build on that ground" };
    }
  }
  return { ok: true };
}

/**
 * Mark out a footprint and take the money. Nothing stands here yet.
 *
 * The tiles are blocked IMMEDIATELY even though the building does not exist, so
 * two foundations cannot be laid on top of each other and an enemy cannot walk
 * through the plot while it is going up. That is also why a site has hp: an
 * unfinished building is a real thing an army can knock down.
 */
function placeSite(sim, owner, type, tx, ty) {
  const spec = BUILDINGS[type];
  const tiles = footprint(spec, tx, ty);
  const groundUnder = tiles.map(([x, y]) => sim.grid.cells[idx(sim.grid, x, y)]);
  for (const [x, y] of tiles) sim.grid.cells[idx(sim.grid, x, y)] = BUILDING;

  const site = {
    id: sim.nextId++,
    seq: sim.players[owner].seq++,
    owner,
    spec,
    tx,
    ty,
    tiles,
    groundUnder,
    x: tileCentre(tx) + ((spec.tiles - 1) * TILE) / 2,
    y: tileCentre(ty) + ((spec.tiles - 1) * TILE) / 2,
    work: 0,
    needed: spec.buildWork,
    // Deliberately fragile. A foundation is scaffolding, and catching one
    // undefended should be worth the ride out to it.
    hp: Math.max(60, Math.round(spec.hp * 0.25)),
    maxHp: Math.max(60, Math.round(spec.hp * 0.25)),
    builders: 0,
  };

  sim.sites.push(site);
  sim.fieldsDirty = true;
  return site;
}

export function placeBuilding(sim, owner, type, tx, ty, groundUnder = null) {
  const spec = BUILDINGS[type];
  const tiles = footprint(spec, tx, ty);
  const under =
    groundUnder ?? tiles.map(([x, y]) => sim.grid.cells[idx(sim.grid, x, y)]);
  // A bridge is the one building you walk ON rather than around, so its tiles
  // become open ground. `groundUnder` still remembers the water, which is what
  // puts the strait back when the bridge falls.
  // A bridge and a gate are the two buildings you walk ON rather than around.
  //
  // WHAT A GATE IS, HONESTLY. The ideal is a door only your own people may use,
  // and that would mean a flow field per owner — the fields are cached per goal
  // and shared by everybody, so making passability depend on who is asking is a
  // real change to the pathfinder, not a flag.
  //
  // So this gate is open ground that both sides can cross, and a building with
  // 900 health standing on it. In play that is very close to the real thing:
  // your army walks straight through its own gate, and an enemy reaching it
  // finds a structure in the way — `findTarget` prefers structures for siege and
  // takes them for everyone else once no men are left — so they stop and break
  // it while your towers shoot. The wall gets its door, and the door is still
  // worth defending. Per-owner passability stays open as the better version.
  const cell = spec.spans || spec.gate ? GROUND : BUILDING;
  for (const [x, y] of tiles) sim.grid.cells[idx(sim.grid, x, y)] = cell;

  const building = {
    id: sim.nextId++,
    seq: sim.players[owner].seq++,
    owner,
    spec,
    tx,
    ty,
    tiles,
    // What the ground was before this stood on it. Without this, knocking a
    // building down turned high ground into open ground and a wood into a lawn —
    // the map would slowly flatten itself over a long match.
    groundUnder: under,
    x: tileCentre(tx) + ((spec.tiles - 1) * TILE) / 2,
    y: tileCentre(ty) + ((spec.tiles - 1) * TILE) / 2,
    hp: Math.round(spec.hp * (1 + buildingHpBonus(sim, owner))),
    maxHp: Math.round(spec.hp * (1 + buildingHpBonus(sim, owner))),
    queue: [],
    buildTimer: 0,
    rally: null,
    // Only a manor uses these, but every building carries them so nothing
    // downstream has to check what kind of building it is holding first.
    tier: 0,
    raising: null,
    // What a depot is holding, per good. Always present, so nothing downstream
    // has to guess whether `store` is a number, an object, or missing.
    store: { gold: 0, timber: 0, food: 0 },
  };

  sim.buildings.push(building);
  sim.fieldsDirty = true;
  return building;
}

function restoreGround(sim, thing) {
  thing.tiles.forEach(([x, y], i) => {
    sim.grid.cells[idx(sim.grid, x, y)] = thing.groundUnder?.[i] ?? GROUND;
  });
}

function destroyBuilding(sim, building) {
  restoreGround(sim, building);

  // WHOEVER WAS ON THE BRIDGE GOES INTO THE WATER.
  //
  // The alternative is worse in every way: the tile becomes water again, water
  // is impassable, and a unit standing on impassable ground cannot path off it —
  // so an army would sit in the middle of a strait for the rest of the match,
  // unreachable and unable to move. Drowning them is both the honest outcome and
  // the one that leaves no stuck state.
  if (building.spec.spans) {
    const drowned = sim.units.filter((u) =>
      building.tiles.some(([x, y]) => toTile(u.x) === x && toTile(u.y) === y)
    );
    if (drowned.length > 0) {
      const ids = new Set(drowned.map((u) => u.id));
      sim.units = sim.units.filter((u) => !ids.has(u.id));
      for (const u of sim.units) if (ids.has(u.chaseId)) u.chaseId = null;
      say(sim, `The bridge goes, and ${drowned.length} with it.`, true);
      sound(sim, "die");
    }
  }

  sim.buildings = sim.buildings.filter((b) => b !== building);
  sim.fieldsDirty = true;

  // Any units mounted on this wall/bastion are thrown into the nearest open spot
  for (const u of sim.units) {
    if (u.mountedOn === building.id) {
      u.mountedOn = null;
      u.job = null;
      u.hp -= 25;
      const spot = freeSpotNear(sim, toTile(u.x), toTile(u.y));
      if (spot) {
        u.x = tileCentre(spot.tx);
        u.y = tileCentre(spot.ty);
      }
    }
  }

  // Every peasant working on this is now working on nothing.
  for (const u of sim.units) {
    if (u.job && u.job.kind === "drop" && u.job.id === building.id) u.job = null;
  }
  sound(sim, "collapse", building.owner);
  say(sim, `${sim.players[building.owner].name}'s ${building.spec.name} is rubble.`);
  // Losing your last house of a path sets you free, if a Castle has not set it.
  if (building.spec.path) reviewPath(sim, building.owner);
}

function destroySite(sim, site) {
  restoreGround(sim, site);
  sim.sites = sim.sites.filter((s) => s !== site);
  sim.fieldsDirty = true;
  for (const u of sim.units) {
    if (u.job && u.job.kind === "build" && u.job.id === site.id) u.job = null;
  }
  sound(sim, "collapse", site.owner);
  say(sim, `${sim.players[site.owner].name}'s half-built ${site.spec.name} is pulled down.`);
  if (site.spec.path) reviewPath(sim, site.owner);
}

/** A finished foundation becomes the real thing, on the same tiles. */
function completeSite(sim, site) {
  sim.sites = sim.sites.filter((s) => s !== site);
  // The tiles are already blocked, so hand the remembered ground straight over
  // rather than reading it back — it would read BUILDING and be lost.
  const building = placeBuilding(sim, site.owner, site.spec.id, site.tx, site.ty, site.groundUnder);
  for (const u of sim.units) {
    if (u.job && u.job.kind === "build" && u.job.id === site.id) {
      if (building.spec.farm) {
        u.job = { kind: "harvest", id: building.id };
      } else {
        u.job = null;
      }
    }
  }
  sound(sim, "build", site.owner);
  say(sim, `${sim.players[site.owner].name}'s ${site.spec.name} is finished.`);

  // A warehouse without a cart is a pile of gold nobody can spend, which is a
  // trap rather than a decision. It comes with one; more are yours to build.
  if (building.spec.depot && committed(sim, building.owner) < POP_CAP) {
    spawnUnit(sim, building, "cart");
  }

  // THE COMMITMENT LANDS WHEN THE HOUSE STANDS, not when it is marked out.
  //
  // A foundation is scaffolding and can be knocked over by one rider; binding a
  // player's whole army list to a rectangle on the ground that an enemy can
  // delete in ten seconds would make the most important choice in the match the
  // cheapest one to grief.
  if (building.spec.path) takePath(sim, building.owner, building.spec.path);
  return building;
}

// --- Inputs ------------------------------------------------------------------
//
// Everything a player can do goes through here, so a match is fully described by
// its seed and this list. Applied on the following tick, never immediately.

export function queueBuild(sim, owner, type, tx, ty, unitIds = null, queued = false) {
  const check = canBuild(sim, owner, type, tx, ty);
  if (!check.ok) return check;
  sim.inputs.push({
    tick: sim.tick + 1, kind: "build", owner, type, tx, ty,
    unitIds: unitIds ? [...unitIds] : null,
    queued,
  });
  return { ok: true };
}

/**
 * Begin raising your hall a tier. Paid on ordering, like every other build.
 *
 * Refused rather than queued when it cannot happen, so the interface can say
 * why — see the note in `canBuild` about silent gates.
 */
export function canRaise(sim, owner) {
  const hall = sim.buildings.find((b) => b.owner === owner && b.spec.isHeart);
  if (!hall) return { ok: false, reason: "you have no hall" };
  if (hall.raising) return { ok: false, reason: "your hall is already being raised" };
  if (hall.tier >= MAX_MANOR_TIER) return { ok: false, reason: "a Palace is the last stone" };
  const next = MANOR_TIERS[hall.tier + 1];
  if (!canAfford(sim.players[owner], next)) {
    return { ok: false, reason: `not enough ${shortfall(sim.players[owner], next)}` };
  }
  if (!sim.units.some((u) => u.owner === owner && u.spec.worker)) {
    return { ok: false, reason: "no peasants to raise it" };
  }
  return { ok: true, next };
}

/**
 * FORM UP. Eight or more of one type become a battalion.
 *
 * One type, deliberately: a "battalion" of six spearmen and two catapults that
 * shared damage evenly would be a way of hiding engines inside infantry, and
 * concentrating the fire of units with different reach means most of them stand
 * about. The restriction is what makes the rule legible.
 *
 * Sent again with a battalion selected, it disbands the formation — the same
 * key both ways, because a player who can form up and cannot see how to stop is
 * a player who has been given a trap.
 */
export function queueForm(sim, owner, unitIds) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "form", owner, unitIds: [...unitIds],
  });
  return { ok: true };
}

/** Sets the layout formation: "none" | "line" | "wedge" | "square" | "scatter" */
export function queueFormation(sim, owner, unitIds, formation) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "formation", owner, unitIds: [...unitIds], formation,
  });
  return { ok: true };
}

/** Sets combat stance: "aggressive" | "defensive" | "stand_ground" | "hold_fire" */
export function queueStance(sim, owner, unitIds, stance) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "stance", owner, unitIds: [...unitIds], stance,
  });
  return { ok: true };
}

/** Orders units to patrol continuously between origin and destination waypoint */
export function queuePatrol(sim, owner, unitIds, tx, ty) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "patrol", owner, unitIds: [...unitIds], tx, ty,
  });
  return { ok: true };
}

/** Orders units to guard and follow a friendly unit, hero, or structure */
export function queueGuard(sim, owner, unitIds, targetId) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "guard", owner, unitIds: [...unitIds], targetId,
  });
  return { ok: true };
}

/** Orders ranged units to mount stone fortress walls or ramparts for range & height bonus */
export function queueMount(sim, owner, unitIds, wallId) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "mount", owner, unitIds: [...unitIds], wallId,
  });
  return { ok: true };
}

/** Can these actually form up? Answered here so the interface can say why. */
export function canForm(sim, owner, unitIds) {
  const picked = sim.units.filter(
    (u) => unitIds.includes(u.id) && u.owner === owner && !u.spec.worker && !u.spec.hauler
  );
  if (picked.some((u) => u.band != null)) return { ok: true, breaking: true };
  if (picked.length < BAND_MINIMUM) {
    return { ok: false, reason: `a battalion is ${BAND_MINIMUM} or more of one kind` };
  }
  const kind = picked[0].spec.id;
  if (picked.some((u) => u.spec.id !== kind)) {
    return { ok: false, reason: "a battalion is one kind of soldier, not a crowd" };
  }
  return { ok: true, kind, size: picked.length };
}

export function queueRaise(sim, owner, unitIds = null) {
  const check = canRaise(sim, owner);
  if (!check.ok) return check;
  sim.inputs.push({
    tick: sim.tick + 1, kind: "raise", owner,
    unitIds: unitIds ? [...unitIds] : null,
  });
  return { ok: true };
}

export function queueTrain(sim, owner, buildingId, unit) {
  sim.inputs.push({ tick: sim.tick + 1, kind: "train", owner, buildingId, unit });
  return { ok: true };
}

/**
 * One right-click, whatever it landed on.
 *
 * The simulation decides what the click MEANT rather than the interface, so a
 * human clicking a gold seam and the AI deciding to mine one take the identical
 * path. `resolveOrder` below is the single place that mapping lives.
 */
export function queueOrder(sim, owner, unitIds, tx, ty, queued = false) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "order", owner, unitIds: [...unitIds], tx, ty, queued,
  });
  return { ok: true };
}

/**
 * Attack a specific thing, and follow it.
 *
 * Distinct from a move order onto its tile: a move ends when the tile is
 * reached, and a target that walks away should still be chased.
 */
export function queueAttack(sim, owner, unitIds, targetId, queued = false) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "attack", owner, unitIds: [...unitIds], targetId, queued,
  });
  return { ok: true };
}

/**
 * Disband. They are gone, and whatever they were carrying is gone with them.
 *
 * A COMMAND, not a local deletion. Deleting a unit in the interface would remove
 * it from one peer's simulation and not the other's, which is a desync on the
 * next tick — and the checksum would correctly void the match over a housekeeping
 * click. Everything that changes state goes through the same funnel.
 */
export function queueDisband(sim, owner, unitIds) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "disband", owner, unitIds: [...unitIds],
  });
  return { ok: true };
}

/**
 * Leave the match.
 *
 * A COMMAND, not something the interface does locally, and that is the whole
 * point: it lands on a tick every peer agrees on, so all of them watch the same
 * player leave at the same moment. A connection that simply dies is turned into
 * one of these by the lockstep engine — see `lost` in net.js — precisely so
 * that quitting and dropping are the same event to the simulation.
 */
export function queueResign(sim, owner) {
  sim.inputs.push({ tick: sim.tick + 1, kind: "resign", owner });
  return { ok: true };
}

/** Stop where you are and cancel whatever you were doing. */
export function queueHold(sim, owner, unitIds) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "hold", owner, unitIds: [...unitIds],
  });
  return { ok: true };
}

/**
 * A sapper erects an engine where he is standing.
 *
 * Not trained from a building, because the whole point of a catapult is that it
 * appears at the front rather than walking there at speed zero. It costs gold,
 * costs population, and takes the sapper a while — during which he is standing
 * still in the open, which is exactly the risk that makes escorting him a
 * decision.
 */
export function queueErect(sim, owner, sapperId, type) {
  sim.inputs.push({ tick: sim.tick + 1, kind: "erect", owner, sapperId, type });
  return { ok: true };
}

/**
 * A witch begins turning one of theirs into one of yours.
 *
 * She must stay near her target for a full minute. Anything that breaks that —
 * the target dying, walking out of range, or the witch being killed — ends the
 * channel with nothing gained, which is what makes her a thing you have to
 * protect rather than a button you press.
 */
export function queueConvert(sim, owner, witchId, targetId) {
  sim.inputs.push({ tick: sim.tick + 1, kind: "convert", owner, witchId, targetId });
  return { ok: true };
}

/** Where a building's new units walk to. Right-click with it selected. */
export function queueRally(sim, owner, buildingId, tx, ty) {
  sim.inputs.push({
    tick: sim.tick + 1, kind: "rally", owner, buildingId, tx, ty,
  });
  return { ok: true };
}

/**
 * What does a right-click on this tile mean for this unit?
 *
 * Ordered by how specific the thing under the cursor is. A peasant is the only
 * unit that can mine or build, and telling a spearman to go and stand on a gold
 * seam is a legitimate thing to want, so the worker checks come first and fall
 * through to a plain move for everyone else.
 */
function resolveOrder(sim, unit, tx, ty) {
  const cell = inBounds(sim.grid, tx, ty) ? sim.grid.cells[idx(sim.grid, tx, ty)] : ROCK;

  if (unit.spec.worker) {
    if (cell === GOLD) return { kind: "mine", tx, ty };
    // A peasant sent INTO a wood fells it. He can still be walked through one
    // by clicking past it, which is the same bargain the seams already make.
    if (cell === FOREST) return { kind: "fell", tx, ty };

    const farm = sim.buildings.find(
      (b) => b.owner === unit.owner && b.spec.farm && b.hp >= b.maxHp &&
        b.tiles.some(([x, y]) => x === tx && y === ty)
    );
    if (farm) return { kind: "harvest", id: farm.id };

    const site = sim.sites.find(
      (s) => s.owner === unit.owner && s.tiles.some(([x, y]) => x === tx && y === ty)
    );
    if (site) return { kind: "build", id: site.id };

    // A hall being raised is a foundation with a roof on it, so it takes labour
    // the same way — right-click it and he goes and works. Before the repair
    // check, because a hall can be damaged AND being raised, and finishing the
    // Keep is the more useful of the two.
    const rising = sim.buildings.find(
      (b) => b.owner === unit.owner && b.raising &&
        b.tiles.some(([x, y]) => x === tx && y === ty)
    );
    if (rising) return { kind: "raise", id: rising.id };

    // A worker sent at his own hurt building mends it. Only if it IS hurt —
    // otherwise right-clicking your own manor to move past it would put the
    // whole crew on a repair job that has nothing to do.
    const hurt = sim.buildings.find(
      (b) => b.owner === unit.owner && b.hp < b.maxHp &&
        b.tiles.some(([x, y]) => x === tx && y === ty)
    );
    if (hurt) return { kind: "repair", id: hurt.id };
  }

  const building = sim.buildings.find((b) =>
    b.tiles.some(([x, y]) => x === tx && y === ty)
  );
  if (building && building.owner !== unit.owner) {
    return { kind: "attack", id: building.id, isBuilding: true };
  }
  if (building && building.owner === unit.owner) {
    const isRanged = (unit.spec.range && unit.spec.range >= 50) || unit.spec.id === "archer" || unit.spec.id === "yogini" || unit.spec.id === "acharya";
    const isDefensiveWall = building.spec.wall || building.spec.gate || building.spec.id === "wall" || building.spec.id === "gate" || building.spec.id === "bastion" || building.spec.id === "watchtower";
    if (isRanged && isDefensiveWall) {
      return { kind: "mount", id: building.id };
    }
  }

  return { kind: "move", tx, ty };
}

/**
 * Put one step on a unit's list, or do it now if the list is the only thing
 * standing between the unit and idleness.
 *
 * A step is stored as WHAT WAS CLICKED, not as what it meant. That is the whole
 * trick behind "if a building in the queue gets destroyed, move on to the next":
 * a step is not resolved until the unit actually reaches it, so a foundation
 * that was razed in the meantime simply is not there any more, and `resolveOrder`
 * says "move" instead of "build". `siteId` is remembered alongside so that case
 * can be skipped outright rather than walked to — a peasant should not trudge
 * across the map to stand on rubble before starting his next job.
 */
/** Work a unit gave ITSELF: the endless economy loop, not an order from anyone. */
const AUTOMATIC = new Set(["mine", "drop", "collect", "deliver"]);

function pushStep(sim, unit, step) {
  // The first queued order pulls a unit off automatic work; later ones wait
  // their turn.
  //
  // Without this, "select a peasant and mark out five buildings" did nothing at
  // all: he was mining, mining never finishes, and so the list he had just been
  // given would sit untouched for the rest of the match. Queuing behind a task
  // with no end is not queuing, it is discarding. Work the player explicitly
  // ordered — a build, an erect, a conversion — is left alone, because there the
  // queue means what it says.
  if (unit.plan.length === 0 && unit.job && AUTOMATIC.has(unit.job.kind)) {
    unit.job = null;
    unit.order = null;
  }
  unit.plan.push(step);
  unit.holding = false;
}

/** The step a unit is doing right now is finished; take up the next one. */
function advancePlans(sim) {
  for (const unit of sim.units) {
    if (unit.plan.length === 0) continue;
    // Still busy. A move order not yet arrived, standing work not yet done, or
    // something still being chased all mean "not ready for the next thing".
    if (unit.order || unit.job || unit.chaseId !== null) continue;

    while (unit.plan.length > 0) {
      const step = unit.plan.shift();

      if (step.targetId !== undefined) {
        // Chase a specific thing. If it died while this step waited its turn,
        // there is nothing to walk to and nothing to avenge — skip it.
        const alive =
          sim.units.some((u) => u.id === step.targetId) ||
          sim.buildings.some((b) => b.id === step.targetId) ||
          sim.sites.some((x) => x.id === step.targetId);
        if (!alive) continue;
        unit.chaseId = step.targetId;
        break;
      }

      // A step aimed at one of our own foundations, and the foundation is gone:
      // either an enemy razed it or it finished without us. Either way there is
      // no work there.
      if (step.siteId !== undefined) {
        const site = sim.sites.find((x) => x.id === step.siteId);
        if (!site) continue;
        unit.job = { kind: "build", id: site.id };
        break;
      }

      const job = resolveOrder(sim, unit, step.tx, step.ty);
      if (job.kind === "move") unit.order = { tx: step.tx, ty: step.ty };
      else if (job.kind === "attack") unit.chaseId = job.id;
      else unit.job = job;
      break;
    }
  }
}

function applyDueInputs(sim) {
  while (sim.nextInput < sim.inputs.length && sim.inputs[sim.nextInput].tick <= sim.tick) {
    const input = sim.inputs[sim.nextInput];
    sim.nextInput += 1;

    if (input.kind === "form") {
      const picked = sim.units.filter(
        (u) => input.unitIds.includes(u.id) && u.owner === input.owner &&
          !u.spec.worker && !u.spec.hauler
      );
      // Already formed? Then this is the order to break formation.
      if (picked.some((u) => u.band != null)) {
        const bands = new Set(picked.map((u) => u.band).filter((b) => b != null));
        for (const u of sim.units) if (bands.has(u.band)) u.band = null;
        say(sim, `${sim.players[input.owner].name}'s battalion breaks formation.`);
        continue;
      }
      const check = canForm(sim, input.owner, input.unitIds);
      if (!check.ok) continue;
      const band = sim.nextId++;
      for (const u of picked) u.band = band;
      say(sim, `${plural(picked.length, UNITS[check.kind].name)} form up.`);
      sound(sim, "build", input.owner);
      continue;
    }

    if (input.kind === "raise") {
      const check = canRaise(sim, input.owner);
      if (!check.ok) continue;
      const hall = sim.buildings.find((b) => b.owner === input.owner && b.spec.isHeart);
      pay(sim.players[input.owner], check.next);
      hall.raising = { to: hall.tier + 1, work: 0, needed: check.next.work, builders: 0 };
      say(sim, `${sim.players[input.owner].name} begins a ${check.next.name}.`);

      // Same rule as a foundation: whoever you had selected does the work, and
      // if you had nobody selected, the idle ones go.
      const chosen = input.unitIds
        ? sim.units.filter(
            (u) => input.unitIds.includes(u.id) && u.owner === input.owner && u.spec.worker
          )
        : [];
      const crew = chosen.length > 0 ? chosen : sim.units.filter(
        (u) => u.owner === input.owner && u.spec.worker &&
          (!u.job || u.job.kind === "idle") && u.plan.length === 0
      );
      for (const u of crew) {
        u.plan.length = 0;
        abandonJob(sim, u);
        u.job = { kind: "raise", id: hall.id };
        u.order = null;
      }
      continue;
    }

    if (input.kind === "build") {
      if (!canBuild(sim, input.owner, input.type, input.tx, input.ty).ok) continue;
      pay(sim.players[input.owner], BUILDINGS[input.type]);
      const site = placeSite(sim, input.owner, input.type, input.tx, input.ty);

      // Peasants you had selected when you laid it out are the ones who raise
      // it. This is what makes "select a peasant, then mark out five buildings"
      // work: each foundation lands on HIS list, in the order you placed them,
      // instead of every idle peasant on the map swarming the newest one.
      const chosen = input.unitIds
        ? sim.units.filter(
            (u) => input.unitIds.includes(u.id) && u.owner === input.owner && u.spec.worker
          )
        : [];

      let sent = 0;
      if (chosen.length > 0) {
        for (const u of chosen) {
          if (input.queued) {
            pushStep(sim, u, { tx: input.tx, ty: input.ty, siteId: site.id });
          } else {
            u.plan.length = 0;
            abandonJob(sim, u);
            u.job = { kind: "build", id: site.id };
            u.order = null;
          }
          sent += 1;
        }
      } else {
        // Nobody relevant selected. Send whoever is already idle, so laying a
        // foundation is one click rather than two. Anyone busy mining stays on
        // the gold — pulling the whole economy off its seams every time you
        // queue a building is the kind of "help" that loses matches. A peasant
        // part-way through a list of his own is busy too, even between steps.
        for (const u of sim.units) {
          if (u.owner !== input.owner || !u.spec.worker) continue;
          if (u.job && u.job.kind !== "idle") continue;
          if (u.plan.length > 0) continue;
          u.job = { kind: "build", id: site.id };
          u.order = null;
          sent += 1;
        }
      }

      say(
        sim,
        sent > 0
          ? `${site.spec.name} marked out. ${sent} peasant${sent === 1 ? "" : "s"} heading over.`
          : `${site.spec.name} marked out — send peasants to raise it.`
      );
      sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "train") {
      const building = sim.buildings.find((b) => b.id === input.buildingId);
      if (!building || building.owner !== input.owner) continue;
      if (!building.spec.trains?.includes(input.unit)) continue;

      const spec = UNITS[input.unit];
      if (!canAfford(sim.players[input.owner], spec)) continue;
      if (committed(sim, input.owner) >= POP_CAP) {
        say(sim, `No room for another ${spec.name} — you are at the limit.`);
        continue;
      }
      // Paid on ordering, not on delivery — otherwise a player queues twenty
      // units they cannot afford and the barracks decides later who was real.
      pay(sim.players[input.owner], spec);
      building.queue.push(input.unit);
      continue;
    }

    if (input.kind === "formation") {
      for (const id of input.unitIds) {
        const u = sim.units.find(u => u.id === id && u.owner === input.owner);
        if (u) u.formation = input.formation;
      }
      say(sim, `${sim.players[input.owner].name}'s battalion adopts ${input.formation.toUpperCase()} formation.`);
      sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "stance") {
      for (const id of input.unitIds) {
        const u = sim.units.find(u => u.id === id && u.owner === input.owner);
        if (u) {
          u.stance = input.stance;
          u.guardX = u.x;
          u.guardY = u.y;
        }
      }
      say(sim, `Troops switch to ${input.stance.replace('_', ' ').toUpperCase()} stance.`);
      sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "patrol") {
      for (const id of input.unitIds) {
        const unit = sim.units.find(u => u.id === id && u.owner === input.owner);
        if (!unit) continue;
        unit.plan.length = 0;
        abandonJob(sim, unit);
        unit.order = null;
        unit.chaseId = null;
        unit.job = {
          kind: "patrol",
          x0: toTile(unit.x),
          y0: toTile(unit.y),
          x1: input.tx,
          y1: input.ty,
          target: 1,
        };
      }
      say(sim, `Troops assigned to continuous patrol.`);
      sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "guard") {
      const target = sim.units.find(u => u.id === input.targetId) || sim.buildings.find(b => b.id === input.targetId);
      if (target) {
        for (const id of input.unitIds) {
          const unit = sim.units.find(u => u.id === id && u.owner === input.owner);
          if (!unit || unit.id === target.id) continue;
          unit.plan.length = 0;
          abandonJob(sim, unit);
          unit.order = null;
          unit.chaseId = null;
          unit.job = {
            kind: "guard",
            targetId: target.id,
          };
          unit.stance = "defensive";
          unit.guardX = target.x;
          unit.guardY = target.y;
        }
        say(sim, `Troops assigned to guard ${target.spec ? target.spec.name : "target"}.`);
        sound(sim, "order", input.owner);
      }
      continue;
    }

    if (input.kind === "mount") {
      const bldg = sim.buildings.find(b => b.id === input.wallId && b.owner === input.owner);
      if (bldg) {
        for (const id of input.unitIds) {
          const u = sim.units.find(x => x.id === id && x.owner === input.owner);
          if (!u) continue;
          u.plan.length = 0;
          abandonJob(sim, u);
          u.order = null;
          u.chaseId = null;
          u.job = { kind: "mount", id: bldg.id };
        }
        say(sim, `Ranged troops climbing fortress battlements.`);
        sound(sim, "order", input.owner);
      }
      continue;
    }

    if (input.kind === "order") {
      let any = false;
      const validUnits = input.unitIds
        .map(id => sim.units.find(u => u.id === id && u.owner === input.owner))
        .filter(Boolean);

      const count = validUnits.length;
      let avgX = 0, avgY = 0;
      for (const u of validUnits) {
        avgX += u.x;
        avgY += u.y;
      }
      if (count > 0) {
        avgX /= count;
        avgY /= count;
      }

      const destX = input.tx * TILE + 16;
      const destY = input.ty * TILE + 16;
      const moveDx = destX - avgX;
      const moveDy = destY - avgY;
      const moveDist = Math.sqrt(moveDx * moveDx + moveDy * moveDy) || 1;
      const fx = moveDx / moveDist;
      const fy = moveDy / moveDist;
      const px = -fy;
      const py = fx;

      for (let i = 0; i < validUnits.length; i++) {
        const unit = validUnits[i];
        unit.mountedOn = null; // Dismount if moving off wall
        if (input.queued) {
          const site = unit.spec.worker
            ? sim.sites.find(
                (x) => x.owner === unit.owner &&
                  x.tiles.some(([sx, sy]) => sx === input.tx && sy === input.ty)
              )
            : null;
          pushStep(sim, unit, site
            ? { tx: input.tx, ty: input.ty, siteId: site.id }
            : { tx: input.tx, ty: input.ty });
          any = true;
          continue;
        }

        unit.plan.length = 0;
        unit.guardX = destX;
        unit.guardY = destY;

        let targetTx = input.tx;
        let targetTy = input.ty;

        // Structured formation slot offsets if multiple units and formation active
        if (count > 1 && unit.formation && unit.formation !== "none") {
          let ox = 0, oy = 0;
          if (unit.formation === "line") {
            const span = (i - (count - 1) / 2) * 26;
            ox = px * span;
            oy = py * span;
          } else if (unit.formation === "wedge") {
            const rankIdx = Math.floor(Math.sqrt(i));
            const posInRank = i - rankIdx * rankIdx;
            const rankSpread = (posInRank - rankIdx * 0.5) * 24;
            ox = px * rankSpread - fx * (rankIdx * 20);
            oy = py * rankSpread - fy * (rankIdx * 20);
          } else if (unit.formation === "square") {
            const ringAngle = (i / count) * Math.PI * 2;
            const ringR = Math.max(20, count * 3.5);
            ox = Math.cos(ringAngle) * ringR;
            oy = Math.sin(ringAngle) * ringR;
          } else if (unit.formation === "scatter") {
            const r = Math.floor(i / 3);
            const c = i % 3;
            ox = px * (c - 1) * 34 - fx * (r - 0.5) * 34;
            oy = py * (c - 1) * 34 - fy * (r - 0.5) * 34;
          }

          const stx = toTile(destX + ox);
          const sty = toTile(destY + oy);
          if (passable(sim.grid, stx, sty)) {
            targetTx = stx;
            targetTy = sty;
          }
        }

        const job = resolveOrder(sim, unit, targetTx, targetTy);
        if (job.kind === "move") {
          abandonJob(sim, unit);
          unit.order = { tx: targetTx, ty: targetTy };
        } else if (job.kind === "attack") {
          abandonJob(sim, unit);
          unit.order = null;
          unit.chaseId = job.id;
        } else {
          abandonJob(sim, unit);
          unit.job = job;
          unit.order = null;
        }
        unit.holding = false;
        any = true;
      }
      if (any) sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "attack") {
      for (const id of input.unitIds) {
        const unit = sim.units.find((u) => u.id === id);
        if (!unit || unit.owner !== input.owner) continue;
        if (input.queued) {
          pushStep(sim, unit, { targetId: input.targetId });
          continue;
        }
        unit.plan.length = 0;
        abandonJob(sim, unit);
        unit.order = null;
        unit.chaseId = input.targetId;
        unit.holding = false;
      }
      sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "convert") {
      const witch = sim.units.find((u) => u.id === input.witchId);
      const prey = sim.units.find((u) => u.id === input.targetId);
      if (!witch || witch.owner !== input.owner || !witch.spec.converts) continue;
      if (!prey || prey.owner === input.owner) continue;

      witch.job = { kind: "convert", id: prey.id, work: 0, needed: witch.spec.convertTicks };
      witch.order = null;
      witch.chaseId = null;
      say(sim, `A witch begins her work on a ${prey.spec.name}.`);
      sound(sim, "devotion", witch.owner);
      continue;
    }

    if (input.kind === "erect") {
      const sapper = sim.units.find((u) => u.id === input.sapperId);
      if (!sapper || sapper.owner !== input.owner) continue;
      if (!sapper.spec.erects?.includes(input.type)) continue;

      const spec = UNITS[input.type];
      if (!canAfford(sim.players[input.owner], spec)) {
        say(sim, `Not enough gold for a ${spec.name}.`);
        continue;
      }
      if (committed(sim, input.owner) >= POP_CAP) {
        say(sim, `No room for a ${spec.name} — you are at the limit.`);
        continue;
      }
      // Paid on ordering, like everything else, so a sapper cannot start three
      // engines he can only afford one of.
      pay(sim.players[input.owner], spec);
      sapper.job = { kind: "erect", type: input.type, work: 0, needed: spec.buildTicks };
      sapper.order = null;
      sapper.chaseId = null;
      sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "resign") {
      const player = sim.players[input.owner];
      if (player) eliminate(sim, player, `${player.name} leaves the field.`);
      continue;
    }

    if (input.kind === "hold") {
      for (const id of input.unitIds) {
        const unit = sim.units.find((u) => u.id === id);
        if (!unit || unit.owner !== input.owner) continue;
        // Stop means stop. Leaving the list behind would have a unit you just
        // halted set off again a tick later, which is the opposite of the one
        // thing this key is for.
        unit.plan.length = 0;
        abandonJob(sim, unit);
        unit.order = null;
        unit.chaseId = null;
        unit.carrying = 0;
      }
      sound(sim, "order", input.owner);
      continue;
    }

    if (input.kind === "disband") {
      const doomed = new Set(input.unitIds);
      let gone = 0;
      for (const unit of sim.units) {
        if (!doomed.has(unit.id) || unit.owner !== input.owner) continue;
        abandonJob(sim, unit);
        unit.hp = 0;   // fight() clears the dead, so there is one place that does
        gone += 1;
      }
      if (gone > 0) {
        say(sim, `${gone} disbanded.`);
        sound(sim, "die", input.owner);
      }
      continue;
    }

    if (input.kind === "rally") {
      const building = sim.buildings.find((b) => b.id === input.buildingId);
      if (!building || building.owner !== input.owner) continue;
      building.rally = { tx: input.tx, ty: input.ty };
      sound(sim, "order", input.owner);
    }

    if (input.kind === "cast") {
      queueCast(sim, input.owner, input.unitId, input.ability, input.tx, input.ty, input.targetId);
      continue;
    }
  }
}

// --- The tick ----------------------------------------------------------------

export function step(sim) {
  if (sim.over) return;
  sim.tick += 1;

  applyDueInputs(sim);
  if (sim.fieldsDirty) {
    sim.fields.clear();
    sim.fieldsDirty = false;
  }

  advancePlans(sim);
  workPeasants(sim);
  runCarts(sim);
  trainUnits(sim);
  feedArmy(sim);
  processAbilitiesAndHazards(sim);
  processHeroesAndAuras(sim);
  processCampaign(sim);
  processTirthas(sim);
  updateGates(sim);
  moveUnits(sim);
  fight(sim);
  checkEnd(sim);
}

export function processTirthas(sim) {
  if (!sim || !sim.tirthas) return;

  for (const tirtha of sim.tirthas) {
    const counts = new Map();
    for (const u of sim.units) {
      if (u.hp <= 0 || u.spec.flies || u.spec.hauler) continue;
      const dx = u.x - tirtha.x;
      const dy = u.y - tirtha.y;
      if (dx * dx + dy * dy <= 80 * 80) {
        counts.set(u.owner, (counts.get(u.owner) || 0) + 1);
      }
    }

    if (counts.size === 0) continue;

    let dominantOwner = null;
    let maxCount = 0;
    let secondMax = 0;
    for (const [owner, cnt] of counts) {
      if (cnt > maxCount) {
        secondMax = maxCount;
        maxCount = cnt;
        dominantOwner = owner;
      } else if (cnt > secondMax) {
        secondMax = cnt;
      }
    }

    const advantage = maxCount - secondMax;
    if (advantage <= 0 || dominantOwner === null) continue;

    if (tirtha.controller === dominantOwner) {
      tirtha.progress = Math.min(100, tirtha.progress + advantage * 0.8);
    } else {
      if (tirtha.progress > 0 && tirtha.capturingOwner !== dominantOwner) {
        tirtha.progress -= advantage * 1.2;
        if (tirtha.progress <= 0) {
          if (tirtha.controller !== null) {
            say(sim, `⚡ ${sim.players[tirtha.controller].name} has lost control of the ${tirtha.spec.name}!`, true);
          }
          tirtha.controller = null;
          tirtha.capturingOwner = dominantOwner;
          tirtha.progress = 0;
        }
      } else {
        tirtha.capturingOwner = dominantOwner;
        tirtha.progress += advantage * 1.2;
        if (tirtha.progress >= 100) {
          tirtha.progress = 100;
          tirtha.controller = dominantOwner;
          say(sim, `🚩 ${sim.players[dominantOwner].name} has captured the ${tirtha.spec.name}! (${tirtha.spec.desc})`, true);
          sound(sim, "build", dominantOwner);
        }
      }
    }
  }
}

function updateGates(sim) {
  for (const b of sim.buildings) {
    if (b.spec.gate || b.spec.id === "gate") {
      let enemyNear = false;
      let allyNear = false;
      for (const u of sim.units) {
        if (u.hp <= 0) continue;
        const dx = u.x - b.x;
        const dy = u.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 90 * 90) {
          if (u.owner !== b.owner && (!sim.diplomacy || sim.diplomacy[b.owner]?.[u.owner] !== "ally")) {
            enemyNear = true;
            break;
          } else if (u.owner === b.owner || (sim.diplomacy && sim.diplomacy[b.owner]?.[u.owner] === "ally")) {
            if (d2 <= 55 * 55) allyNear = true;
          }
        }
      }
      b.isOpen = !enemyNear && allyNear;
    }
  }
}

function processAbilitiesAndHazards(sim) {
  // Cooldowns, shields, charges, and buffs for units
  for (const u of sim.units) {
    if (u.cooldowns) {
      for (const k in u.cooldowns) {
        if (u.cooldowns[k] > 0) u.cooldowns[k]--;
      }
    }
    if (u.shieldTicks > 0) {
      u.shieldTicks--;
      if (u.shieldTicks === 0) u.shield = 0;
    }
    if (u.buff && u.buff.ticks > 0) {
      u.buff.ticks--;
      if (u.buff.ticks === 0) u.buff = null;
    }
    if (u.charge && u.charge.ticks > 0) {
      u.charge.ticks--;
      // Charge collision check with enemy infantry
      for (const enemy of sim.units) {
        if (enemy.owner !== u.owner && enemy.hp > 0 && !enemy.spec.siege && !enemy.spec.flies) {
          const d2 = (enemy.x - u.x) ** 2 + (enemy.y - u.y) ** 2;
          if (d2 <= (u.spec.radius + enemy.spec.radius + 6) ** 2) {
            enemy.hp -= u.charge.damage;
            const angle = Math.atan2(enemy.y - u.y, enemy.x - u.x);
            enemy.x += Math.cos(angle) * 16;
            enemy.y += Math.sin(angle) * 16;
            u.charge.damage = Math.max(10, u.charge.damage - 15);
          }
        }
      }
      if (u.charge.ticks === 0) u.charge = null;
    }

    // Kavacha Tirtha blessing: passive health regeneration for troops
    if (sim.tick % 20 === 0 && playerHasTirtha(sim, u.owner, "kavacha")) {
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 2);
    }
  }

  // Hazards (Agni Fire Patches)
  if (sim.hazards && sim.hazards.length > 0) {
    for (const h of sim.hazards) {
      h.ticks--;
      for (const u of sim.units) {
        if (u.owner !== h.owner && u.hp > 0 && !u.spec.flies) {
          const d2 = (u.x - h.x) ** 2 + (u.y - h.y) ** 2;
          if (d2 <= h.radius ** 2) {
            u.hp -= h.dps;
          }
        }
      }
    }
    sim.hazards = sim.hazards.filter((h) => h.ticks > 0);
  }
}

const XP_THRESHOLDS = [0, 100, 250, 500, 1000];

function processHeroesAndAuras(sim) {
  // Reset transient aura states
  for (const u of sim.units) {
    u.auraValour = false;
    u.auraPrana = false;
  }

  const heroes = sim.units.filter((u) => u.isHero && u.hp > 0);
  for (const hero of heroes) {
    hero.level = hero.level || 1;
    hero.xp = hero.xp || 0;

    // Level up check
    if (hero.level < 5 && hero.xp >= XP_THRESHOLDS[hero.level]) {
      hero.level++;
      hero.maxHp = Math.round(hero.spec.hp * (1 + (hero.level - 1) * 0.25));
      hero.hp = hero.maxHp;
      say(sim, `👑 ${hero.spec.name} has advanced to Level ${hero.level}!`, true);
      sound(sim, "devotion", hero.owner);
    }

    const auraRange = (hero.spec.auraRange || 90) * (1 + (hero.level - 1) * 0.15);
    const range2 = auraRange * auraRange;

    for (const u of sim.units) {
      if (u.owner === hero.owner && u.hp > 0) {
        const d2 = (u.x - hero.x) ** 2 + (u.y - hero.y) ** 2;
        if (d2 <= range2) {
          if (hero.heroType === "senapati") {
            u.auraValour = true;
          } else if (hero.heroType === "acharya") {
            u.auraPrana = true;
            // Healing prana: +2.4 HP/sec (0.12 HP/tick)
            u.hp = Math.min(u.maxHp, u.hp + 0.12);
          }
        }
      }
    }
  }
}

function processCampaign(sim) {
  if (!sim.scenario || sim.over) return;
  const sc = sim.scenario;

  // Wave Spawning
  if (sc.waves) {
    for (const w of sc.waves) {
      if (sim.tick === w.tick) {
        const enemyManor = sim.buildings.find((b) => b.owner === 1 && b.spec.isHeart) || sim.buildings[0];
        if (enemyManor) {
          for (const item of w.units) {
            for (let c = 0; c < item.count; c++) {
              spawnUnit(sim, enemyManor, item.type);
            }
          }
          if (w.chieftain) {
            const ch = makeUnit(sim, 1, UNITS.senapati, enemyManor.tx, enemyManor.ty);
            ch.isChieftain = true;
            sim.units.push(ch);
          }
        }
        say(sim, w.msg, true);
        sound(sim, "hit", 0);
      }
    }
  }

  // Objectives tracking
  if (sc.objectives) {
    for (const obj of sc.objectives) {
      if (obj.done) continue;

      if (obj.id === "build_barracks") {
        if (sim.buildings.some((b) => b.owner === 0 && b.spec.id === "barracks" && b.hp >= b.maxHp)) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Construct an Akhara!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "train_yoginis") {
        const count = sim.units.filter((u) => u.owner === 0 && u.spec.id === "yogini").length;
        obj.count = count;
        if (count >= obj.total) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Train 4 Yoginis!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "raise_keep") {
        if (manorTier(sim, 0) >= 1) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Raise Asana to Keep!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "erect_catapults") {
        const engines = sim.units.filter((u) => u.owner === 0 && (u.spec.id === "catapult" || u.spec.id === "ram")).length;
        obj.count = engines;
        if (engines >= obj.total) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Erect 2 Siege Engines!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "survive_waves") {
        if (sim.tick >= 1600 && !sim.units.some((u) => u.owner === 1 && u.isChieftain)) {
          obj.done = true;
          obj.count = 3;
        }
      } else if (obj.id === "defeat_chieftain") {
        if (sim.tick > 1500 && !sim.units.some((u) => u.owner === 1 && u.isChieftain)) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Raider Chieftain Defeated!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "destroy_shrine" || obj.id === "destroy_citadel" || obj.id === "raze_asura_palace") {
        const enemyHeart = sim.buildings.find((b) => b.owner !== 0 && b.spec.isHeart);
        if (!enemyHeart) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Enemy Stronghold Cleansed!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "mount_archers") {
        const mounted = sim.units.filter(u => u.owner === 0 && u.mountedOn).length;
        obj.count = mounted;
        if (mounted >= obj.total) {
          obj.done = true;
          say(sim, `✓ Objective Complete: 4 Archers Mounted on Battlements!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "capture_surya") {
        if (playerHasTirtha(sim, 0, "surya")) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Surya Tirtha Consecrated!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "defeat_warlord") {
        if (sim.tick > 1600 && !sim.units.some(u => u.owner === 1 && u.isWarlord)) {
          obj.done = true;
          say(sim, `✓ Objective Complete: Night Warlord Vanquished!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "build_gatehouses") {
        const gates = sim.buildings.filter(b => b.owner === 0 && (b.spec.gate || b.spec.id === "gate") && b.hp >= b.maxHp).length;
        obj.count = gates;
        if (gates >= obj.total) {
          obj.done = true;
          say(sim, `✓ Objective Complete: 2 Fortified Gatehouses Constructed!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "train_rathas") {
        const rathas = sim.units.filter(u => u.owner === 0 && u.spec.id === "ratha").length;
        obj.count = rathas;
        if (rathas >= obj.total) {
          obj.done = true;
          say(sim, `✓ Objective Complete: 2 War Chariots (Ratha) Trained!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "repel_crossings") {
        if (sim.tick >= 2000) {
          obj.done = true;
          obj.count = 4;
          say(sim, `✓ Objective Complete: All 4 River Crossing Waves Repelled!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "capture_all_tirthas") {
        const held = sim.tirthas ? sim.tirthas.filter(t => t.controller === 0).length : 0;
        obj.count = held;
        if (held >= (obj.total || 4)) {
          obj.done = true;
          say(sim, `✓ Objective Complete: All Sacred Tirthas Consecrated!`, true);
          sound(sim, "devotion", 0);
        }
      } else if (obj.id === "erect_heavy_catapults") {
        const cats = sim.units.filter(u => u.owner === 0 && u.spec.id === "catapult").length;
        obj.count = cats;
        if (cats >= obj.total) {
          obj.done = true;
          say(sim, `✓ Objective Complete: 3 Heavy Catapults Erected!`, true);
          sound(sim, "devotion", 0);
        }
      }
    }

    if (sc.objectives.every((o) => o.done)) {
      sim.over = true;
      sim.winner = 0;
      say(sim, `🏆 CAMPAIGN CHAPTER COMPLETE! Swarajya is victorious!`, true);
      sound(sim, "build", 0);
    }
  }
}

/**
 * AN ARMY EATS, AND THAT IS WHAT ENDS MATCHES.
 *
 * The measured defect this exists to fix: on the big maps two AIs each reached
 * about fifty units and then drew at the twenty-five minute cap, every time.
 * Nothing in the game made a standing army cost anything, so there was never a
 * reason to spend one — massing was free and attacking was risk, and two
 * rational players both chose to sit.
 *
 * Warrior Kings: Battles solves this with food supply rather than with a tax,
 * and food supply is the better lever because it is a decision rather than a
 * drip: an army you cannot feed starves, so the army you raised is a clock you
 * started. It is also why farms are worth defending, and why a raid on a farm is
 * worth making.
 *
 * Upkeep is derived from the price rather than hand-tabled per unit, so a new
 * unit cannot be added with an upkeep of zero by forgetting a line. Gold counts
 * at a fraction of grain: a siege engine has no food price at all and still has
 * to be maintained.
 */
const UPKEEP_EVERY = TICKS_PER_SECOND; // charged once a second, not every tick
const UPKEEP_PER_FOOD = 1 / 120;       // a soldier eats his own price every 2 min
const UPKEEP_PER_GOLD = 0.15 / 120;

/** How much a unit eats per second. Computed once per spec, then remembered. */
const upkeepCache = new Map();
function upkeepOf(spec) {
  let n = upkeepCache.get(spec.id);
  if (n === undefined) {
    const price = priceOf(spec);
    n = price.food * UPKEEP_PER_FOOD + price.gold * UPKEEP_PER_GOLD;
    upkeepCache.set(spec.id, n);
  }
  return n;
}

/**
 * How fast a starving army falls apart.
 *
 * A fraction of the unit's own health, so it costs a Behemoth what it costs a
 * spearman — proportionally. Slow enough that an empty larder is a problem you
 * can still solve, fast enough that ignoring it loses the match: a full-health
 * unit dies in about three minutes of famine.
 */
const STARVE_FRACTION = 0.006;

function feedArmy(sim) {
  if (sim.tick % UPKEEP_EVERY !== 0) return;

  // Per player, so one starving side does not touch the other's men.
  for (const player of sim.players) {
    if (player.out) continue;

    let bill = 0;
    for (const unit of sim.units) {
      if (unit.owner !== player.id || unit.hp <= 0) continue;
      if (unit.spec.worker || unit.spec.hauler) continue; // they feed themselves
      bill += upkeepOf(unit.spec);
    }
    if (bill <= 0) continue;

    if (player.food >= bill) {
      player.food -= bill;
      player.starving = false;
      continue;
    }

    // The larder is empty. Whatever grain there is goes in first — a famine that
    // ignores the last of the stores would make the last hundred food worthless.
    const shortfallRatio = (bill - player.food) / bill;
    player.food = 0;
    if (!player.starving) {
      say(sim, `${player.name}'s army has no food. They are starving.`, true);
      sound(sim, "collapse", player.id);
    }
    player.starving = true;

    for (const unit of sim.units) {
      if (unit.owner !== player.id || unit.hp <= 0) continue;
      if (unit.spec.worker || unit.spec.hauler) continue;
      unit.hp -= unit.maxHp * STARVE_FRACTION * shortfallRatio;
    }
  }
}

/**
 * Drop whatever standing work a unit was doing, and give back what it cost.
 *
 * Ordering a builder to move should cancel the build — every game works that
 * way and fighting it would be a worse surprise than the cancel. But an engine
 * is PAID FOR when it is ordered, so cancelling silently ate the gold: right up
 * to the last tick you could lose 190 by clicking the wrong bit of grass. The
 * money comes back, which makes the cancel honest and the order safe.
 */
function abandonJob(sim, unit) {
  if (unit.job && unit.job.kind === "erect") {
    const spec = UNITS[unit.job.type];
    if (spec) {
      refund(sim.players[unit.owner], spec);
      say(sim, `The ${spec.name} is abandoned. Its cost is returned.`);
    }
  }
  unit.job = null;
}

/** Squared distance from a point to a building or site's footprint. */
function gapTo(thing, x, y) {
  const half = (thing.spec.tiles * TILE) / 2;
  const dx = Math.max(0, Math.abs(thing.x - x) - half);
  const dy = Math.max(0, Math.abs(thing.y - y) - half);
  return dx * dx + dy * dy;
}

/**
 * The nearest place a laden peasant can put his gold down.
 *
 * Ties break on id, never on scan order — this is the fourth thing in this file
 * that has to say so, and the reason is always the same: a fixed scan order is
 * a seat advantage, and it is invisible.
 */
function nearestDropOff(sim, unit) {
  // A WAREHOUSE WITH NO CART IS A HOLE IN THE GROUND.
  //
  // The depot rule says only what reaches the hall can be spent, and that is a
  // good rule. What it must not do is become a one-way trap: kill a player's
  // last cart and every coin the crew mines from that moment goes into a
  // building nothing empties — and because the treasury is now empty, they
  // cannot afford the 30-gold cart that would fix it. The economy is dead and
  // the map is still full of gold.
  //
  // Measured: seven thousand gold in a warehouse at eight minutes, purse at 23,
  // six peasants working the seams and the player unable to afford a barracks.
  // That is not a decision anyone made, it is a hole to fall down.
  //
  // So with no cart alive, the depots stop taking deliveries and the crew walks
  // to the hall instead. Slower, which is the correct punishment — the warehouse
  // was worth building for the shorter walk, and losing your carts should cost
  // you that walk. It should not cost you the gold.
  const hasCart = sim.units.some((u) => u.owner === unit.owner && u.spec.hauler);

  let best = null;
  let bestD2 = Infinity;
  for (const b of sim.buildings) {
    if (b.owner !== unit.owner || !b.spec.dropOff) continue;
    if (b.spec.depot && !hasCart) continue;
    const d2 = gapTo(b, unit.x, unit.y);
    if (d2 < bestD2 || (d2 === bestD2 && best && b.id < best.id)) {
      best = b;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * Mining, hauling and building — everything a peasant does that is not walking.
 *
 * The loop is the classic one and it is deliberately not clever: walk to the
 * seam, swing for a while, carry a fixed amount to the nearest drop-off, go
 * back. Nothing is generated by a building standing still, which is the whole
 * point of the change: gold now costs a walk, so where your seams are and
 * whether you built a Warehouse beside them is a real decision, and an
 * undefended peasant line is a real risk.
 */

/**
 * The nearest seam that still has gold in it.
 *
 * Scans `sim.seams` rather than the map: that Map holds exactly the tiles with
 * gold left, so this is a walk over the live seams instead of twenty thousand
 * cells. Ties break on tile index, so both peers pick the same seam — this runs
 * inside the simulation and a peasant wandering to a different rock on two
 * machines is a desync.
 */
function nearestSeam(sim, unit) {
  let best = null;
  let bestD2 = Infinity;
  for (const key of sim.seams.keys()) {
    if (sim.grid.cells[key] !== GOLD) continue;
    const tx = key % sim.grid.w;
    const ty = (key / sim.grid.w) | 0;
    const dx = tileCentre(tx) - unit.x;
    const dy = tileCentre(ty) - unit.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && best && key < best.key)) {
      best = { tx, ty, key };
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * Put a peasant back on gold, or leave him idle if there is none left.
 *
 * A worked-out seam used to simply clear the job, so a crew that had been mining
 * all match stood still at the moment their seam ran dry and waited to be
 * noticed. On a map with two hundred seams that is not a decision the player
 * wants to be making by hand every few minutes — it is just an interruption.
 */
function moveToNextSeam(sim, unit) {
  const seam = nearestSeam(sim, unit);
  unit.job = seam ? { kind: "mine", tx: seam.tx, ty: seam.ty } : null;
  return Boolean(seam);
}

/**
 * The nearest tile that still has trees on it.
 *
 * Unlike `nearestSeam` this cannot scan `sim.woods`, because that Map only holds
 * tiles somebody has already cut — an untouched wood is not in it. So it sweeps
 * a bounded box around the peasant instead, which is affordable because it only
 * runs when a tile runs out. Ties break on tile index so both peers pick the
 * same tree; anything else here is a desync, not a cosmetic difference.
 */
const WOOD_SEARCH = 40; // tiles; past this he is genuinely out of work
function nearestWood(sim, unit) {
  const { w, h, cells } = sim.grid;
  const ux = toTile(unit.x);
  const uy = toTile(unit.y);
  let best = null;
  let bestD2 = Infinity;
  for (let ty = Math.max(0, uy - WOOD_SEARCH); ty <= Math.min(h - 1, uy + WOOD_SEARCH); ty++) {
    for (let tx = Math.max(0, ux - WOOD_SEARCH); tx <= Math.min(w - 1, ux + WOOD_SEARCH); tx++) {
      const key = ty * w + tx;
      if (cells[key] !== FOREST) continue;
      const dx = tileCentre(tx) - unit.x;
      const dy = tileCentre(ty) - unit.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 || (d2 === bestD2 && best && key < best.key)) {
        best = { tx, ty, key };
        bestD2 = d2;
      }
    }
  }
  return best;
}

/** Put a peasant back on trees, or leave him idle if the wood is gone. */
function moveToNextWood(sim, unit) {
  const wood = nearestWood(sim, unit);
  unit.job = wood ? { kind: "fell", tx: wood.tx, ty: wood.ty } : null;
  return Boolean(wood);
}

/**
 * FERTILITY — what the ground around a farm is worth.
 *
 * The ring of tiles just outside the building. Flat open ground feeds people;
 * hill and forest and rock do not. Returned as a multiplier around 1, so a farm
 * on good ground is worth roughly half again one built on the spine — enough
 * that placement matters, not so much that a bad map position starves you.
 */
function fertility(sim, farm) {
  let good = 0;
  let seen = 0;
  for (const [tx, ty] of ringAround(farm.tx, farm.ty, farm.spec.tiles, 2)) {
    if (!inBounds(sim.grid, tx, ty)) continue;
    const cell = sim.grid.cells[idx(sim.grid, tx, ty)];
    if (cell === WATER || cell === ROCK) continue; // neither help nor hinder
    seen += 1;
    if (cell === GROUND || cell === BUILDING) good += 1;
  }
  if (seen === 0) return 1;
  return 0.6 + 0.8 * (good / seen);
}

function workPeasants(sim) {
  for (const s of sim.sites) s.builders = 0;

  for (const unit of sim.units) {
    // Peasants mine and build, sappers erect, witches channel. All three are
    // "standing work", and this is the one loop that runs it.
    if ((!unit.spec.worker && !unit.spec.engineer && !unit.spec.converts) || !unit.job) continue;

    if (unit.job.kind === "build") {
      const site = sim.sites.find((s) => s.id === unit.job.id);
      if (!site || site.owner !== unit.owner) {
        unit.job = null;
        continue;
      }
      if (gapTo(site, unit.x, unit.y) > WORK_REACH * WORK_REACH) continue;

      // More peasants means faster, with no diminishing returns — the whole
      // reason to raise a fourth peasant instead of a second spearman is that it
      // makes everything else arrive sooner.
      site.builders += 1;
      site.work += BUILD_PER_TICK;
      continue;
    }

    if (unit.job.kind === "raise") {
      const hall = sim.buildings.find((b) => b.id === unit.job.id);
      if (!hall || hall.owner !== unit.owner || !hall.raising) {
        // Finished, or the hall fell over while he walked. Either way there is
        // nothing here to do and standing on it is not an answer.
        unit.job = null;
        continue;
      }
      if (gapTo(hall, unit.x, unit.y) > WORK_REACH * WORK_REACH) continue;

      hall.raising.builders += 1;
      hall.raising.work += BUILD_PER_TICK;
      if (hall.raising.work < hall.raising.needed) continue;

      const to = hall.raising.to;
      hall.raising = null;
      applyManorTier(sim, hall, to);
      // Release the whole crew, not just this one — everyone else is standing at
      // a finished job and would look busy for the rest of the match.
      for (const other of sim.units) {
        if (other.job && other.job.kind === "raise" && other.job.id === hall.id) {
          other.job = null;
        }
      }
      continue;
    }

    if (unit.job.kind === "repair") {
      const b = sim.buildings.find((x) => x.id === unit.job.id);
      if (!b || b.owner !== unit.owner || b.hp >= b.maxHp) {
        unit.job = null;
        continue;
      }
      if (gapTo(b, unit.x, unit.y) > WORK_REACH * WORK_REACH) continue;

      // Rates derived from what the building cost to raise — see REPAIR_WORK.
      const heal = (b.maxHp / REPAIR_TICKS) * BUILD_PER_TICK;
      const forWholeBar = b.spec.mendPrice ?? priceOf(b.spec).gold * REPAIR_PRICE;
      const price = (forWholeBar / REPAIR_TICKS) * BUILD_PER_TICK;

      const purse = sim.players[unit.owner];
      if (purse.gold < price) {
        // Stop rather than go overdrawn, and say so once per building rather
        // than once per peasant per tick.
        if (!b.brokeAt || sim.tick - b.brokeAt > TICKS_PER_SECOND * 10) {
          b.brokeAt = sim.tick;
          say(sim, `No gold to mend the ${b.spec.name}.`);
        }
        continue;
      }

      purse.gold -= price;
      b.hp = Math.min(b.maxHp, b.hp + heal);
      if (b.hp >= b.maxHp) {
        say(sim, `The ${b.spec.name} is mended.`);
        // Everyone working on it is free; leaving them on a finished job is how
        // a crew stands about looking busy.
        for (const other of sim.units) {
          if (other.job && other.job.kind === "repair" && other.job.id === b.id) {
            other.job = null;
          }
        }
      }
      continue;
    }

    if (unit.job.kind === "convert") {
      const prey = sim.units.find((u) => u.id === unit.job.id);
      // Broken by anything: the target dead, converted by someone else, or
      // simply walked away. A minute of work and nothing to show for it is the
      // correct outcome — otherwise there is no reason to run from a witch.
      if (!prey || prey.owner === unit.owner) {
        unit.job = null;
        continue;
      }
      const dx = prey.x - unit.x;
      const dy = prey.y - unit.y;
      const reach = unit.spec.convertRange;
      if (dx * dx + dy * dy > reach * reach) {
        unit.job = null;
        say(sim, `The witch loses her hold.`);
        continue;
      }

      unit.job.work += 1;
      if (unit.job.work < unit.job.needed) continue;

      // Hers now. Everything it was doing belonged to its old owner and must go
      // with them, or a converted peasant carries on filling a warehouse it can
      // no longer reach.
      prey.owner = unit.owner;
      prey.job = null;
      prey.order = null;
      prey.chaseId = null;
      prey.carrying = 0;
      prey.targetId = null;
      unit.job = null;
      say(sim, `A ${prey.spec.name} has changed sides.`, true);
      sound(sim, "devotion", unit.owner);
      continue;
    }

    if (unit.job.kind === "erect") {
      // He must stand still to do it, which the movement code already honours:
      // an `erect` job produces no destination, so `targetFor` returns null.
      unit.job.work += 1;
      if (unit.job.work < unit.job.needed) continue;

      const spec = UNITS[unit.job.type];
      const spot = freeSpotNear(sim, toTile(unit.x), toTile(unit.y));
      unit.job = null;
      if (!spot) {
        say(sim, `There is no room to set up the ${spec.name}.`);
        continue;
      }
      sim.units.push(makeUnit(sim, unit.owner, spec, spot.tx, spot.ty));
      say(sim, `A ${spec.name} is ready.`);
      sound(sim, "build", unit.owner);
      continue;
    }

    if (unit.job.kind === "mine") {
      const { tx, ty } = unit.job;
      // The seam can be built over or otherwise stop being a seam.
      if (!inBounds(sim.grid, tx, ty) || sim.grid.cells[idx(sim.grid, tx, ty)] !== GOLD) {
        // Built over, or worked out while he was walking to it. Either way there
        // is gold somewhere else and standing still is not an answer.
        moveToNextSeam(sim, unit);
        continue;
      }
      const cx = tileCentre(tx);
      const cy = tileCentre(ty);
      const dx = cx - unit.x;
      const dy = cy - unit.y;
      if (dx * dx + dy * dy > WORK_REACH * WORK_REACH) continue;

      unit.mineTimer = (unit.mineTimer ?? 0) + 1;
      if (unit.mineTimer < MINE_TICKS) continue;
      unit.mineTimer = 0;

      // Take it out of the ground. A seam that cannot fill a whole load gives
      // what it has left rather than rounding up out of nothing.
      const key = idx(sim.grid, tx, ty);
      const left = sim.seams.get(key) ?? 0;
      const took = Math.min(GOLD_PER_TRIP, left);
      unit.carrying = took;
      sim.seams.set(key, left - took);

      if (left - took <= 0) {
        // Worked out. The tile becomes ordinary ground — which changes what can
        // be walked and built on, so the fields have to go.
        sim.seams.delete(key);
        sim.grid.cells[key] = GROUND;
        sim.fieldsDirty = true;
        say(sim, `A seam is worked out.`);
        sound(sim, "collapse");
        // Anyone else standing on it is now doing nothing, and must be told so
        // rather than swinging at bare rock for the rest of the match.
        let moved = 0;
        for (const other of sim.units) {
          if (other.job && other.job.kind === "mine" &&
              idx(sim.grid, other.job.tx, other.job.ty) === key) {
            if (moveToNextSeam(sim, other)) moved += 1;
          }
        }
        if (moved > 0) {
          say(sim, `${moved} peasant${moved === 1 ? "" : "s"} move to the next seam.`);
        }
      }

      if (took <= 0) {
        unit.job = null;
        continue;
      }

      const drop = nearestDropOff(sim, unit);
      // Nowhere to put it means the manor is gone, and the match is over anyway.
      if (drop) unit.job = { kind: "drop", id: drop.id, seam: { tx, ty } };
      continue;
    }

    if (unit.job.kind === "fell") {
      const { tx, ty } = unit.job;
      if (!inBounds(sim.grid, tx, ty) || sim.grid.cells[idx(sim.grid, tx, ty)] !== FOREST) {
        // Felled by somebody else, or built over. Take the next tree rather
        // than standing in a clearing waiting to be noticed.
        moveToNextWood(sim, unit);
        continue;
      }
      const dx = tileCentre(tx) - unit.x;
      const dy = tileCentre(ty) - unit.y;
      if (dx * dx + dy * dy > WORK_REACH * WORK_REACH) continue;

      unit.mineTimer = (unit.mineTimer ?? 0) + 1;
      if (unit.mineTimer < FELL_TICKS) continue;
      unit.mineTimer = 0;

      const key = idx(sim.grid, tx, ty);
      // Lazily counted: an untouched tile is a full tile.
      const left = sim.woods.get(key) ?? TIMBER_PER_TILE;
      const took = Math.min(TIMBER_PER_TRIP, left);
      unit.carrying = took;
      unit.carryKind = "timber";
      sim.woods.set(key, left - took);

      if (left - took <= 0) {
        // The wood thins. That changes what can be walked and BUILT on, so the
        // flow fields have to be rebuilt exactly as a worked-out seam does.
        sim.woods.delete(key);
        sim.grid.cells[key] = GROUND;
        sim.fieldsDirty = true;
        for (const other of sim.units) {
          if (other.job && other.job.kind === "fell" &&
              idx(sim.grid, other.job.tx, other.job.ty) === key) {
            moveToNextWood(sim, other);
          }
        }
      }

      if (took <= 0) { unit.job = null; continue; }
      const drop = nearestDropOff(sim, unit);
      if (drop) unit.job = { kind: "drop", id: drop.id, wood: { tx, ty } };
      continue;
    }

    if (unit.job.kind === "harvest") {
      const farm = sim.buildings.find((b) => b.id === unit.job.id);
      if (!farm || farm.owner !== unit.owner || !farm.spec.farm) {
        unit.job = null;
        continue;
      }
      if (gapTo(farm, unit.x, unit.y) > WORK_REACH * WORK_REACH) continue;

      unit.mineTimer = (unit.mineTimer ?? 0) + 1;
      if (unit.mineTimer < HARVEST_TICKS) continue;
      unit.mineTimer = 0;

      // A farm does not run out. What it does is pay for the ground it is on.
      const suryaBonus = playerHasTirtha(sim, unit.owner, "surya") ? 1.25 : 1.0;
      unit.carrying = Math.max(1, Math.floor(FOOD_PER_TRIP * fertility(sim, farm) * suryaBonus));
      unit.carryKind = "food";
      const drop = nearestDropOff(sim, unit);
      if (drop) unit.job = { kind: "drop", id: drop.id, farm: farm.id };
      continue;
    }

    if (unit.job.kind === "drop") {
      const drop = sim.buildings.find((b) => b.id === unit.job.id);
      if (!drop || drop.owner !== unit.owner || !drop.spec.dropOff) {
        // The warehouse he was walking to just fell over. Find another.
        const other = nearestDropOff(sim, unit);
        if (other) unit.job = { ...unit.job, id: other.id };
        else unit.job = null;
        continue;
      }
      if (gapTo(drop, unit.x, unit.y) > WORK_REACH * WORK_REACH) continue;

      // A DEPOT IS NOT A TREASURY.
      //
      // Tipping a load into a warehouse fills the warehouse. Only what reaches
      // the manor is money, and a cart has to bring it — which is what makes a
      // forward mining camp a supply line rather than free gold at a distance.
      //
      // The handicap lands on gold that actually arrives, rather than on a
      // building's output — same knob as before, still set once before the first
      // tick, and still the only thing the top ladder tier gets that you do not.
      const good = unit.carryKind ?? "gold";
      if (drop.spec.depot) {
        drop.store[good] += unit.carrying;
      } else {
        // The handicap is a GOLD handicap and stays one. Applying it to grain and
        // timber as well would make the top ladder tier eat and build faster too,
        // which is three advantages wearing one name.
        const rate = good === "gold" ? (sim.players[unit.owner].goldRate ?? 1) : 1;
        if (good === "food") storeFood(sim, unit.owner, unit.carrying);
        else sim.players[unit.owner][good] += unit.carrying * rate;
      }
      unit.carrying = 0;

      // Straight back to whatever he was working — unless it stopped existing
      // while he was walking, in which case he reports as idle and can be sent
      // somewhere that still has something in it.
      const seam = unit.job.seam;
      const wood = unit.job.wood;
      if (seam) {
        const stillThere = sim.grid.cells[idx(sim.grid, seam.tx, seam.ty)] === GOLD;
        if (stillThere) unit.job = { kind: "mine", ...seam };
        else moveToNextSeam(sim, unit);
      } else if (wood) {
        const stillThere = sim.grid.cells[idx(sim.grid, wood.tx, wood.ty)] === FOREST;
        if (stillThere) unit.job = { kind: "fell", ...wood };
        else moveToNextWood(sim, unit);
      } else if (unit.job.farm != null) {
        const farm = sim.buildings.find((b) => b.id === unit.job.farm);
        unit.job = farm && farm.owner === unit.owner
          ? { kind: "harvest", id: farm.id } : null;
      } else {
        unit.job = null;
      }
    }
  }

  // A sapper counts as a worker for the purposes of this loop, so the filter
  // that runs it must let him in.
  for (const site of sim.sites.slice()) {
    if (site.work >= site.needed) completeSite(sim, site);
  }
}

/**
 * The carts, which nobody commands.
 *
 * A supply line the player has to steer by hand is a supply line the player
 * forgets about, and then wonders why nothing is affordable. So a cart picks its
 * own warehouse — the fullest one it can reach — fills up, walks to the manor,
 * tips it in, and goes back. The only decisions left are how many carts to build
 * and whether to defend the road, which are the two decisions worth having.
 *
 * Everything here is a state on the cart itself, so it survives being killed
 * mid-journey with its load: the gold in a cart that dies is gone, which is the
 * entire reason raiding one is worth doing.
 */
function runCarts(sim) {
  for (const cart of sim.units) {
    if (!cart.spec.hauler) continue;

    const manor = sim.buildings.find((b) => b.owner === cart.owner && b.spec.isHeart);
    if (!manor) continue;

    // Nothing to do but find work.
    if (!cart.job) {
      if (cart.carrying > 0) {
        cart.job = { kind: "deliver", id: manor.id, work: 0 };
        continue;
      }
      // The biggest single pile anywhere, ties on good order then on building
      // id so both peers pick the same one. A cart hauls ONE good per trip:
      // mixing them would make a warehouse a pipe rather than a place, and the
      // whole point of the depot rule is that the goods sit somewhere killable.
      let best = null;
      let bestGood = null;
      let bestHeld = 0;
      for (const b of sim.buildings) {
        if (b.owner !== cart.owner || !b.spec.depot) continue;
        for (const good of RESOURCES) {
          const held = b.store[good];
          if (held <= 0) continue;
          if (held > bestHeld || (held === bestHeld && best && b.id < best.id)) {
            best = b;
            bestGood = good;
            bestHeld = held;
          }
        }
      }
      if (best) cart.job = { kind: "collect", id: best.id, good: bestGood, work: 0 };
      continue;
    }

    if (cart.job.kind === "collect") {
      const depot = sim.buildings.find((b) => b.id === cart.job.id);
      const good = cart.job.good;
      if (!depot || depot.owner !== cart.owner || depot.store[good] <= 0) {
        cart.job = null;
        continue;
      }
      if (gapTo(depot, cart.x, cart.y) > WORK_REACH * WORK_REACH) continue;

      // Loading takes a moment, so a cart parked on a depot does not teleport
      // gold across the map in a single tick.
      cart.job.work += 1;
      if (cart.job.work < LOAD_TICKS) continue;

      const took = Math.min(cart.spec.capacity, depot.store[good]);
      depot.store[good] -= took;
      cart.carrying = took;
      cart.carryKind = good;
      cart.job = { kind: "deliver", id: manor.id, work: 0 };
      continue;
    }

    if (cart.job.kind === "deliver") {
      const hall = sim.buildings.find((b) => b.id === cart.job.id);
      if (!hall || hall.owner !== cart.owner) {
        cart.job = null;
        continue;
      }
      if (gapTo(hall, cart.x, cart.y) > WORK_REACH * WORK_REACH) continue;

      cart.job.work += 1;
      if (cart.job.work < LOAD_TICKS) continue;

      const good = cart.carryKind ?? "gold";
      const rate = good === "gold" ? (sim.players[cart.owner].goldRate ?? 1) : 1;
      if (good === "food") storeFood(sim, cart.owner, cart.carrying);
      else sim.players[cart.owner][good] += cart.carrying * rate;
      cart.carrying = 0;
      cart.job = null;
    }
  }
}

function trainUnits(sim) {
  for (const b of sim.buildings) {
    if (b.queue.length === 0) continue;

    if (b.buildTimer <= 0) b.buildTimer = UNITS[b.queue[0]].buildTicks;
    b.buildTimer -= 1;
    if (b.buildTimer > 0) continue;

    const unitType = b.queue.shift();
    b.buildTimer = 0;
    spawnUnit(sim, b, unitType);
  }
}

/**
 * The enemy manor nearest a thing. Ties on seat, so both peers agree.
 *
 * The simulation's own version of the AI's `nearestEnemyHeart` — deliberately
 * separate, because this one has to be identical on both peers and so cannot
 * consult the seeded preference the AI uses to decide who to pick a fight with.
 */
function nearestHeartTo(sim, owner, from) {
  let best = null;
  let bestD2 = Infinity;
  for (const b of sim.buildings) {
    if (b.owner === owner || !b.spec.isHeart) continue;
    const d2 = (b.x - from.x) ** 2 + (b.y - from.y) ** 2;
    if (d2 < bestD2 || (d2 === bestD2 && best && b.owner < best.owner)) {
      best = b;
      bestD2 = d2;
    }
  }
  return best;
}

export function spawnUnit(sim, building, type) {
  const spec = UNITS[type];
  // Muster on the side facing the enemy, rather than on whichever side a fixed
  // scan happens to reach first.
  //
  // Note this now decides where a unit STANDS rather than which way it sets off:
  // troops no longer march anywhere on their own.
  //
  // This is the third place in this slice where a west-to-east scan order turned
  // into a competitive advantage. Taking the first legal tile meant the player on
  // the left of the map spawned troops BEHIND their own barracks and the player
  // on the right spawned them in front, half a building closer to the fight,
  // every single unit, all match. Both sides run the same AI on a mirrored map
  // and it still went 8-0. A scan order is not neutral just because it is fixed.
  //
  // WITH THREE PLAYERS, "THE ENEMY" IS A QUESTION AGAIN. This was
  // `buildings.find(b => b.owner !== owner && b.spec.isHeart)` — the first enemy
  // manor in the array, which is the lowest seat number. Fine when there was
  // only ever one enemy; with two it means every seat musters toward seat 0's
  // hall whether or not that is where the fighting is, and the seat next to the
  // one you are actually fighting gets to muster facing them while you muster
  // facing somebody else entirely.
  const enemyHeart = nearestHeartTo(sim, building.owner, building);

  let spot = null;
  let bestScore = Infinity;

  for (let r = 1; r <= 7; r++) {
    for (const [tx, ty] of ringAround(building.tx, building.ty, building.spec.tiles, r)) {
      if (!passable(sim.grid, tx, ty)) continue;

      const score = enemyHeart
        ? (tx - enemyHeart.tx) ** 2 + (ty - enemyHeart.ty) ** 2
        : 0;
      if (score < bestScore) {
        bestScore = score;
        spot = { tx, ty };
      }
    }
    if (spot) break; // nearest ring that has room wins
  }
  if (!spot) return; // walled in; the gold is spent and the unit is not coming

  const unit = makeUnit(sim, building.owner, spec, spot.tx, spot.ty);
  if (building.rally) {
    const job = resolveOrder(sim, unit, building.rally.tx, building.rally.ty);
    if (job.kind === "move") {
      unit.order = { tx: building.rally.tx, ty: building.rally.ty };
    } else if (job.kind === "attack") {
      unit.chaseId = job.id;
      unit.order = { tx: building.rally.tx, ty: building.rally.ty };
    } else {
      unit.job = job;
      unit.order = { tx: building.rally.tx, ty: building.rally.ty };
    }
  } else if (building.spec.id === "warehouse" && type === "peasant") {
    // Warrior Kings: Battles Village Behavior:
    // Farmer automatically seeks nearby farm or marks out a fertile farm plot nearby
    let nearbyFarm = sim.buildings.find(
      (b) => b.owner === building.owner && b.spec.farm && gapTo(b, unit.x, unit.y) <= 200 * 200
    );
    if (nearbyFarm) {
      unit.job = { kind: "harvest", id: nearbyFarm.id };
    } else {
      let farmSpot = null;
      for (let r = 2; r <= 6; r++) {
        for (const [fx, fy] of ringAround(building.tx, building.ty, building.spec.tiles, r)) {
          if (canBuild(sim, building.owner, "farm", fx, fy).ok) {
            farmSpot = { tx: fx, ty: fy };
            break;
          }
        }
        if (farmSpot) break;
      }
      if (farmSpot && canAfford(sim.players[building.owner], BUILDINGS.farm)) {
        pay(sim.players[building.owner], BUILDINGS.farm);
        const site = placeSite(sim, building.owner, "farm", farmSpot.tx, farmSpot.ty);
        unit.job = { kind: "build", id: site.id };
        say(sim, `Village farmer lays out a fertile farmstead.`);
      }
    }
  }
  sim.units.push(unit);
  sound(sim, "trained", building.owner);
  return unit;
}

/**
 * One unit, wherever it is coming from.
 *
 * Trained at a building, erected by a sapper in a field — the object has to be
 * identical either way, because everything downstream reads these fields and a
 * second construction site for them is a second place to forget one.
 */
function makeUnit(sim, owner, spec, tx, ty) {
  return {
    id: sim.nextId++,
    seq: sim.players[owner].seq++,
    owner,
    spec,
    x: tileCentre(tx),
    y: tileCentre(ty),
    // Born at whatever standard the hall keeps. `mightOf` is read at creation
    // rather than applied later, so a unit's ceiling is right from its first
    // tick and there is no window where a fresh recruit is weaker than the man
    // beside him.
    hp: Math.round(spec.hp * (1 + mightOf(sim, owner))),
    maxHp: Math.round(spec.hp * (1 + mightOf(sim, owner))),
    cooldown: 0,

    // Nothing marches on its own any more.
    //
    // The slice defaulted every unit to "walk at the enemy manor until it or you
    // is dead", which made an army something that happened TO you rather than
    // something you commanded — you could not mass, could not garrison, could
    // not raid, and a barracks was a slow suicide button. A new unit now walks
    // to its building's rally point and stops there.
    //
    // Three fields rather than one, because they mean different things and
    // collapsing them is how a unit ends up chasing a corpse across the map:
    //   order   — a place to walk to, cleared on arrival
    //   job     — standing work: mine, haul, build, erect
    //   chaseId — a specific thing to kill, followed until it dies
    order: { tx, ty },
    job: null,
    chaseId: null,
    carrying: 0,
    carryKind: "gold",
    band: null,
    ammo: spec.ammo ?? 0,
    resupply: 0,
    mineTimer: 0,

    isHero: !!spec.isHero,
    heroType: spec.heroType || null,
    level: spec.isHero ? 1 : 0,
    xp: 0,
    cooldowns: {},
    shield: 0,
    shieldTicks: 0,
    buff: null,
    charge: null,

    // Formations & Tactical Stances
    formation: "none",
    stance: "aggressive",
    guardX: tx * TILE + 16,
    guardY: ty * TILE + 16,

    // Wall-Mounting Ramparts
    mountedOn: null,

    holding: false,
    targetId: null,

    plan: [],
  };
}

/** The nearest tile something can stand on, searched outward. */
function freeSpotNear(sim, tx, ty) {
  if (passable(sim.grid, tx, ty)) return { tx, ty };
  for (let r = 1; r <= 6; r++) {
    for (const [x, y] of ringAround(tx, ty, 1, r)) {
      if (passable(sim.grid, x, y)) return { tx: x, ty: y };
    }
  }
  return null;
}

// --- Movement ----------------------------------------------------------------

/** The field to a set of goal tiles, computed once and shared by everyone. */
function fieldFor(sim, key, goals, soft = null) {
  let field = sim.fields.get(key);
  if (!field) {
    field = flowField(sim.grid, goals, soft);
    sim.fields.set(key, field);
  }
  return field;
}

/**
 * The open tiles hugging a building's footprint.
 *
 * A building's own tiles are impassable, so seeding a field at the CENTRE of a
 * 3x3 manor produces a field that cannot escape the building — every neighbour
 * of the centre is more manor. The whole army then stands still, which is
 * exactly what happened the first time this ran. Walk to the ring instead: it is
 * where an attacker can actually stand, and it is where they need to be to swing
 * at the thing anyway.
 */
function approachRing(sim, thing) {
  const out = [];
  const x0 = thing.tx - 1;
  const y0 = thing.ty - 1;
  const x1 = thing.tx + thing.spec.tiles;
  const y1 = thing.ty + thing.spec.tiles;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const onRing = x === x0 || y === y0 || x === x1 || y === y1;
      if (onRing && passable(sim.grid, x, y)) out.push([x, y]);
    }
  }
  return out;
}

/**
 * Where a unit is trying to get to, as a field key and a set of goal tiles.
 *
 * Returning null means "stand still", and that is now the DEFAULT. A unit with
 * nothing to do does nothing, which is the whole change: an army is a thing the
 * player commands, not a tide that leaves the barracks by itself.
 */
/**
 * The enemy structures an attacker is allowed to route THROUGH, as tile indices.
 *
 * WALLS ARE ONLY A GOOD IDEA IF AN ARMY KNOWS WHAT TO DO ABOUT THEM.
 *
 * A wall across a ford makes the enemy manor genuinely unreachable, and a flow
 * field over impassable tiles then says so: no path, no direction, and an army
 * that stands in a field for the rest of the match looking broken. That is not
 * a siege, it is a bug with a good excuse.
 *
 * So an ATTACK field treats enemy structures as passable at a heavy cost. The
 * route then goes through the thinnest part of the wall, units walk up to it —
 * `steer` still refuses to step onto a blocked tile — and the wall comes into
 * weapon range, at which point `findTarget` does the rest without a single new
 * rule. Defenders' own walls are never soft: you do not walk through your own.
 */
function siegeSet(sim, owner) {
  const soft = new Set();
  for (const b of sim.buildings) {
    if (b.owner === owner) continue;
    for (const [x, y] of b.tiles) soft.add(idx(sim.grid, x, y));
  }
  for (const s of sim.sites) {
    if (s.owner === owner) continue;
    for (const [x, y] of s.tiles) soft.add(idx(sim.grid, x, y));
  }
  return soft;
}

function targetFor(sim, unit) {
  // Chasing something specific. Buildings are approached by their ring, because
  // a field seeded inside a 3x3 footprint cannot escape it.
  if (unit.chaseId !== null) {
    const prey = sim.units.find((u) => u.id === unit.chaseId);
    if (prey) {
      const tx = toTile(prey.x);
      const ty = toTile(prey.y);
      return { key: `to:${tx},${ty}`, goals: [[tx, ty]] };
    }
    const structure =
      sim.buildings.find((b) => b.id === unit.chaseId) ??
      sim.sites.find((s) => s.id === unit.chaseId);
    if (structure) {
      // Keyed by owner as well as target: two players besieging the same thing
      // have different walls in the way, so they need different fields.
      return {
        key: `siege:${structure.id}:${unit.owner}`,
        goals: approachRing(sim, structure),
        siege: true,
      };
    }
    unit.chaseId = null; // it is dead; hold here rather than wandering off
    return null;
  }

  if (unit.job) {
    // Standing work: no destination, so no movement. This is the whole mechanism
    // that pins a sapper — or a witch mid-incantation — in the open while she
    // does it, which is what makes killing her the answer.
    if (unit.job.kind === "erect" || unit.job.kind === "convert") return null;

    if (unit.job.kind === "mine" || unit.job.kind === "fell") {
      const { tx, ty } = unit.job;
      return { key: `to:${tx},${ty}`, goals: [[tx, ty]] };
    }
    // A FARM IS APPROACHED, NOT STOOD ON.
    //
    // Every job in this list needs a clause here or the unit simply never walks
    // to it — it holds the job, the job's reach check fails for ever, and it
    // looks exactly like a broken job rather than a missing destination.
    // Measured: four peasants held a harvest job for eight minutes and produced
    // seventeen grain between them, all of it from the one who happened to spawn
    // beside the farm.
    if (unit.job.kind === "harvest") {
      const farm = sim.buildings.find((b) => b.id === unit.job.id);
      if (farm) return { key: `at:${farm.id}`, goals: approachRing(sim, farm) };
      return null;
    }
    if (unit.job.kind === "build") {
      const site = sim.sites.find((s) => s.id === unit.job.id);
      if (site) return { key: `at:${site.id}`, goals: approachRing(sim, site) };
      return null;
    }
    // `raise` needs its own clause for the same reason `harvest` did: a job with
    // no destination is a peasant who holds it for ever without walking to it.
    if (unit.job.kind === "drop" || unit.job.kind === "repair" || unit.job.kind === "raise") {
      const there = sim.buildings.find((b) => b.id === unit.job.id);
      if (there) return { key: `at:${there.id}`, goals: approachRing(sim, there) };
      return null;
    }
    // A cart walks to whatever it is collecting from or delivering to. Same
    // shape as a peasant's haul, and the same approach ring for the same reason.
    if (unit.job.kind === "collect" || unit.job.kind === "deliver") {
      const there = sim.buildings.find((b) => b.id === unit.job.id);
      if (there) return { key: `at:${there.id}`, goals: approachRing(sim, there) };
      return null;
    }
    if (unit.job.kind === "patrol") {
      const isTarget1 = unit.job.target === 1;
      const ptx = isTarget1 ? unit.job.x1 : unit.job.x0;
      const pty = isTarget1 ? unit.job.y1 : unit.job.y0;
      return { key: `to:${ptx},${pty}`, goals: [[ptx, pty]] };
    }
    if (unit.job.kind === "guard") {
      const guardedUnit = sim.units.find(u => u.id === unit.job.targetId && u.hp > 0);
      if (guardedUnit) {
        const dx = guardedUnit.x - unit.x;
        const dy = guardedUnit.y - unit.y;
        if (dx * dx + dy * dy > 45 * 45) {
          const gtx = toTile(guardedUnit.x);
          const gty = toTile(guardedUnit.y);
          return { key: `to:${gtx},${gty}`, goals: [[gtx, gty]] };
        }
        return null;
      }
      const guardedBldg = sim.buildings.find(b => b.id === unit.job.targetId && b.hp > 0);
      if (guardedBldg) {
        if (gapTo(guardedBldg, unit.x, unit.y) > 50 * 50) {
          return { key: `at:${guardedBldg.id}`, goals: approachRing(sim, guardedBldg) };
        }
        return null;
      }
      unit.job = null;
      return null;
    }
    if (unit.job.kind === "mount") {
      const bldg = sim.buildings.find(b => b.id === unit.job.id && b.hp > 0);
      if (bldg) {
        const dx = bldg.x - unit.x;
        const dy = bldg.y - unit.y;
        if (dx * dx + dy * dy > 20 * 20) {
          return { key: `at:${bldg.id}`, goals: approachRing(sim, bldg) };
        } else {
          unit.mountedOn = bldg.id;
          unit.x = bldg.x;
          unit.y = bldg.y;
          return null;
        }
      }
      unit.mountedOn = null;
      unit.job = null;
      return null;
    }
  }

  if (unit.order) {
    const { tx, ty } = unit.order;
    return { key: `to:${tx},${ty}`, goals: [[tx, ty]] };
  }

  return null;
}

/**
 * How fast this unit actually walks, path included.
 *
 * BOTH places that read speed go through here. There are exactly two — the
 * straight-line step and the flow-field step — and a bonus applied to one of
 * them would produce a unit that is quick in the open and ordinary the moment it
 * has to path around something, which is the kind of bug that gets blamed on the
 * pathfinder for a week.
 */
function paceOf(sim, unit) {
  const vayuBonus = playerHasTirtha(sim, unit.owner, "vayu") ? 0.18 : 0;
  return unit.spec.speed * (1 + speedBonus(sim, unit.owner) + vayuBonus);
}

function moveUnits(sim) {
  // MOVEMENT IS SIMULTANEOUS, for exactly the reason combat is.
  //
  // This used to walk `sim.units` in order and write x/y in place, so the
  // separation shove read already-moved positions for units earlier in the array
  // and not-yet-moved ones for the rest. Array order is id order, and player 0's
  // units are created first, so one seat's army was permanently being shoved
  // against a stale snapshot of the other's. Nothing errors, nothing looks
  // wrong, and mirror matches went 0-16.
  //
  // Everyone reads the state as it was at the start of the tick, and the writes
  // land at the end. That is the third time this project has had to learn the
  // same lesson — see `fight()` and the three scan-order notes.
  const before = sim.units.map((u) => ({ x: u.x, y: u.y }));
  const frozen = sim.units.map((u, i) => ({
    spec: u.spec,
    x: before[i].x,
    y: before[i].y,
    self: u,
  }));
  const hash = spatialHash(frozen, 48);
  const moved = new Map();

  // One siege set per owner per tick, not one per unit. It walks every building
  // and every site, and with a hundred units on the field that is the difference
  // between a few hundred operations a tick and a few tens of thousands.
  const siegeFor = new Map();
  const softFor = (owner) => {
    if (!siegeFor.has(owner)) siegeFor.set(owner, siegeSet(sim, owner));
    return siegeFor.get(owner);
  };

  for (const unit of sim.units) {
    // A catapult is a building that shoots. Once set up it does not move, and
    // giving it an order should not quietly turn it into a very slow soldier —
    // the reason it out-ranges everything is that it gave up its legs.
    if (unit.spec.fixed) continue;
    if (unit.holding) continue;
    // Something in reach to shoot at is a better use of the tick than walking.
    // A peasant is the exception: he is armed only so he is not free to kill,
    // and stopping to poke at a passing rider means the gold stops coming.
    if (unit.targetId !== null && !unit.spec.worker) continue;

    const want = targetFor(sim, unit);
    if (!want || want.goals.length === 0) continue;

    const tx = toTile(unit.x);
    const ty = toTile(unit.y);

    // A DRAGON DOES NOT USE THE FLOW FIELD AT ALL.
    //
    // Every map in this game is built around fords and chokes, and the
    // pathfinding is the thing that makes them mean something. Flight is the
    // exception, so it skips the field entirely and steers straight at the goal
    // — no terrain cost, no walls, no shore. Trying to express that as a
    // cheaper field would be a lie: it is not a cheaper route, it is no route.
    if (unit.spec.flies) {
      const gx = tileCentre(want.goals[0][0]);
      const gy = tileCentre(want.goals[0][1]);
      const dx = gx - unit.x;
      const dy = gy - unit.y;
      const far = Math.sqrt(dx * dx + dy * dy);
      if (far < 2) {
        if (unit.job && unit.job.kind === "patrol") {
          unit.job.target = unit.job.target === 1 ? 0 : 1;
          continue;
        }
        if (unit.order && !unit.job && unit.chaseId === null) unit.order = null;
        continue;
      }
      const step = paceOf(sim, unit) / TICKS_PER_SECOND;
      moved.set(unit, { x: unit.x + (dx / far) * step, y: unit.y + (dy / far) * step });
      continue;
    }

    const soft = want.siege ? softFor(unit.owner) : null;
    let dir = steer(sim.grid, fieldFor(sim, want.key, want.goals, soft), tx, ty);

    if (!dir) {
      // Standing on a goal tile — but "on a tile" means anywhere inside a 32px
      // square, and units cross the boundary and stop dead. That left them up to
      // half a tile short of where the goal ring meant them to be: measured, an
      // army parked 31px from the manor it had walked the width of the map to
      // attack, with a spear that reaches 22. They besieged it for ten minutes
      // without landing a blow. Close the last few pixels to the tile centre.
      const cx = tileCentre(tx);
      const cy = tileCentre(ty);
      const dx = cx - unit.x;
      const dy = cy - unit.y;
      const gap = Math.sqrt(dx * dx + dy * dy);

      // Check if destination is already occupied by a stationed unit
      const nearOccupier = hash.near(cx, cy).some(
        other => other.self !== unit && (other.x - cx) ** 2 + (other.y - cy) ** 2 < (unit.spec.radius + other.spec.radius) ** 2
      );

      if (gap < 2.0 || (nearOccupier && gap < (unit.spec.radius || 7) * 2.5)) {
        // Arrived.
        if (unit.job && unit.job.kind === "patrol") {
          unit.job.target = unit.job.target === 1 ? 0 : 1;
          continue;
        }
        if (unit.order && !unit.job && unit.chaseId === null) {
          unit.order = null;
          continue;
        }
      }
      dir = { x: dx / gap, y: dy / gap };
    }

    let vx = dir.x;
    let vy = dir.y;

    // Shove apart from neighbours during movement
    for (const other of hash.near(unit.x, unit.y)) {
      if (other.self === unit || other.self.spec.flies) continue;
      const dx = unit.x - other.x;
      const dy = unit.y - other.y;
      const d2 = dx * dx + dy * dy;
      const want = (unit.spec.radius || 7) + (other.spec.radius || 7) + 2;
      if (d2 > want * want || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const force = ((want - d) / want) * 1.2;
      vx += (dx / d) * force;
      vy += (dy / d) * force;
    }

    const len = Math.sqrt(vx * vx + vy * vy);
    if (len === 0) continue;

    // Ground the unit is standing on slows it, using the same cost column the
    // flow field routes by.
    const speed = (paceOf(sim, unit) / TICKS_PER_SECOND) * speedFactor(sim.grid, tx, ty);
    const nx = unit.x + (vx / len) * speed;
    const ny = unit.y + (vy / len) * speed;

    // Slide along blocked tiles rather than stopping dead against them.
    let fx = unit.x;
    let fy = unit.y;
    if (passable(sim.grid, toTile(nx), toTile(fy))) fx = nx;
    if (passable(sim.grid, toTile(fx), toTile(ny))) fy = ny;
    moved.set(unit, { x: fx, y: fy });
  }

  for (const [unit, at] of moved) {
    unit.x = at.x;
    unit.y = at.y;
  }

  // PHYSICAL BODY COLLISION & HARD RELAXATION PASS (No Ghost Overlaps)
  // Ensures units never merge or occupy the exact same coordinate.
  for (let iter = 0; iter < 2; iter++) {
    const rHash = spatialHash(sim.units.map(u => ({ x: u.x, y: u.y, spec: u.spec, self: u })), 36);
    for (const u of sim.units) {
      if (u.spec.flies) continue; // Flying creatures fly overhead
      for (const other of rHash.near(u.x, u.y)) {
        if (other.self === u || other.self.spec.flies) continue;
        const v = other.self;
        if (u.id >= v.id) continue; // Resolve each unit pair once

        const dx = u.x - v.x;
        const dy = u.y - v.y;
        const distSq = dx * dx + dy * dy;
        const minDist = (u.spec.radius || 7) + (v.spec.radius || 7);
        const minDistSq = minDist * minDist;

        if (distSq < minDistSq) {
          let d = Math.sqrt(distSq);
          let nx, ny;
          if (d < 0.001) {
            // Exact overlap tie-break: deterministic angle based on unit IDs
            const angle = ((u.id * 37 + v.id * 19) % 360) * (Math.PI / 180);
            nx = Math.cos(angle);
            ny = Math.sin(angle);
            d = 0.001;
          } else {
            nx = dx / d;
            ny = dy / d;
          }

          const overlap = minDist - d;
          const pushU = v.spec.fixed ? overlap : (u.spec.fixed ? 0 : overlap * 0.5);
          const pushV = u.spec.fixed ? overlap : (v.spec.fixed ? 0 : overlap * 0.5);

          if (pushU > 0) {
            const ux = u.x + nx * pushU;
            const uy = u.y + ny * pushU;
            if (passable(sim.grid, toTile(ux), toTile(uy))) {
              u.x = ux;
              u.y = uy;
            }
          }

          if (pushV > 0) {
            const vx2 = v.x - nx * pushV;
            const vy2 = v.y - ny * pushV;
            if (passable(sim.grid, toTile(vx2), toTile(vy2))) {
              v.x = vx2;
              v.y = vy2;
            }
          }
        }
      }
    }
  }
}

/** A cheap uniform grid for "who is near me", rebuilt each tick. */
function spatialHash(units, cell) {
  const buckets = new Map();
  for (const u of units) {
    const key = `${Math.floor(u.x / cell)},${Math.floor(u.y / cell)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(u);
  }
  return {
    near(x, y) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const out = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = buckets.get(`${cx + dx},${cy + dy}`);
          if (list) out.push(...list);
        }
      }
      return out;
    },
  };
}

// --- Fighting ----------------------------------------------------------------

/**
 * BATTALIONS — Warrior Kings' Form Up, and why it changes a battle.
 *
 * Eight or more of one type can be formed into a battalion, and two rules follow:
 * they **concentrate their fire** on one target, and they **split incoming damage
 * evenly** between everyone still standing.
 *
 * The second rule is the interesting one. Without it a big army is mush: damage
 * lands on whoever happens to be in front, that man dies, the next man steps up,
 * and thirty units grind down one at a time in a way nobody can influence. With
 * it a battalion stays whole and then breaks — which means committing one is a
 * decision with a moment in it, and means that catching a battalion at half
 * strength is worth doing rather than being the default state of every fight.
 *
 * It also cuts the click-load enormously on maps this size, which is the reason
 * Warrior Kings had it.
 */
const BAND_MINIMUM = 8;

/**
 * AMMUNITION — a ranged blob cannot camp your doorstep for ever.
 *
 * Archers and engines carry a finite number of shots and refill only near their
 * own buildings or a cart. Nothing else in the game stopped a wall of archers
 * from parking outside a manor and shooting it down over ten minutes with no
 * risk and no decision; now that army has a supply line, and a supply line is a
 * thing you can cut.
 *
 * QUIVERS ARE DEEP ON PURPOSE, AND THE FIRST DRAFT WAS NOT.
 *
 * Twenty arrows sounds like a lot and is twenty SECONDS of continuous fire. At
 * that depth ammunition stopped being a rule about sieges and became a tax on
 * every skirmish in the game: measured, matches decided fell from 15/18 to
 * 12/18 and Two Gates went from 9.3 minutes to 23.6, because two field armies
 * would meet, empty their quivers into each other, and then stand there.
 *
 * The rule is meant to bite the army that parks outside your hall for ten
 * minutes, and to be invisible to the army that fights for ninety seconds and
 * goes home. Sixty shots is a minute of firing — long past any real engagement,
 * far short of a siege.
 */
const AMMO_REACH = 220;      // about seven tiles from a friendly building or cart
const RESUPPLY_TICKS = 12;   // one shot back, well under a second

/** Which supply points a player has, computed once a tick rather than per unit. */
function resupplyPoints(sim, owner) {
  const points = [];
  for (const b of sim.buildings) if (b.owner === owner) points.push(b);
  for (const u of sim.units) if (u.owner === owner && u.spec.hauler) points.push(u);
  return points;
}

function nearSupply(points, unit) {
  for (const p of points) {
    const dx = p.x - unit.x;
    const dy = p.y - unit.y;
    if (dx * dx + dy * dy <= AMMO_REACH * AMMO_REACH) return true;
  }
  return false;
}

function fight(sim) {
  const hash = spatialHash(sim.units, 256);

  // Battalion membership, gathered once. Doing this per hit would be a scan of
  // every unit in the game for every blow struck.
  const bands = new Map();
  for (const u of sim.units) {
    if (u.band == null || u.hp <= 0) continue;
    if (!bands.has(u.band)) bands.set(u.band, []);
    bands.get(u.band).push(u);
  }

  /**
   * A blow lands. On a lone unit it lands on him; on a battalion it is shared.
   *
   * Shared between the LIVING, and computed from the snapshot taken at the top
   * of the round — so who a blow is split between cannot depend on who has
   * already been hit this tick, which would put the acting order straight back
   * into the arithmetic that `acting` exists to keep out of it.
   */
  const land = (target, dmg) => {
    // 35% height and stone parapet damage reduction when mounted on walls / ramparts
    if (target.mountedOn) dmg *= 0.65;

    if (target.shield > 0) {
      if (target.shield >= dmg) {
        target.shield -= dmg;
        return;
      }
      dmg -= target.shield;
      target.shield = 0;
    }
    const band = target.band != null ? bands.get(target.band) : null;
    if (!band || band.length <= 1) {
      target.hp -= dmg;
      return;
    }
    const each = dmg / band.length;
    for (const m of band) m.hp -= each;
  };

  // Resupply, and the ammunition clock. Both are per player, so a cart parked
  // with one army does nothing for the other.
  const supply = new Map();
  for (const p of sim.players) supply.set(p.id, resupplyPoints(sim, p.id));
  for (const u of sim.units) {
    if (!u.spec.ammo) continue;
    if (u.ammo >= u.spec.ammo) continue;
    if (!nearSupply(supply.get(u.owner) ?? [], u)) continue;
    u.resupply = (u.resupply ?? 0) + 1;
    if (u.resupply < RESUPPLY_TICKS) continue;
    u.resupply = 0;
    u.ammo += 1;
  }

  // A ROUND IS SIMULTANEOUS. Everyone who was alive when the round began acts,
  // on the state as it was then, and deaths are resolved at the end.
  const acting = sim.units.filter((u) => u.hp > 0);

  const bandTarget = new Map();
  for (const [id, members] of bands) {
    const leader = members.reduce((a, b) => (rank(a, b) <= 0 ? a : b));
    const t = findTarget(sim, leader, hash);
    if (t) bandTarget.set(id, t);
  }

  for (const unit of acting) {
    if (unit.cooldown > 0) unit.cooldown -= 1;

    let target =
      unit.spec.worker && unit.job ? null : findTarget(sim, unit, hash);

    if (unit.band != null && bandTarget.has(unit.band)) {
      const shared = bandTarget.get(unit.band);
      if (shared.hp > 0 && inReach(unit, shared)) target = shared;
    }

    unit.targetId = target ? target.id : null;
    if (!target || unit.cooldown > 0) continue;

    if (unit.spec.ammo) {
      if ((unit.ammo ?? 0) <= 0) continue;
      unit.ammo -= 1;
    }

    let reload = unit.spec.reload;
    if (unit.auraValour) reload = Math.max(1, Math.round(reload * 0.75));
    if (playerHasTirtha(sim, unit.owner, "vayu")) reload = Math.max(1, Math.round(reload * 0.82));
    unit.cooldown = reload;

    const isStructure = Boolean(target.spec.tiles);
    let dmg = isStructure && unit.spec.vsBuilding
      ? unit.spec.damage * unit.spec.vsBuilding
      : unit.spec.damage;
    if (unit.buff && unit.buff.dmgMul) dmg *= unit.buff.dmgMul;
    if (playerHasTirtha(sim, unit.owner, "surya")) dmg *= 1.15;

    if (isStructure) target.hp -= dmg;
    else land(target, dmg);
    sim.projectiles.push({
      x: unit.x, y: unit.y, tx: target.x, ty: target.y, life: 4,
      owner: unit.owner,
    });
    sound(sim, "hit");
  }

  // Buildings that shoot take their turn on the same state as everyone else.
  for (const b of sim.buildings) {
    const gun = b.spec.isHeart ? MANOR_TIERS[b.tier].attack : b.spec.attack;
    if (!gun) continue;

    b.cooldown = (b.cooldown ?? 0) - 1;
    if (b.cooldown > 0) continue;

    let target = null;
    let bestD2 = Infinity;
    for (const u of acting) {
      if (u.owner === b.owner) continue;
      const half = (b.spec.tiles * TILE) / 2;
      const dx = Math.max(0, Math.abs(b.x - u.x) - half);
      const dy = Math.max(0, Math.abs(b.y - u.y) - half);
      const d2 = dx * dx + dy * dy;
      if (d2 > gun.range * gun.range) continue;
      if (d2 < bestD2 || (d2 === bestD2 && rank(u, target) < 0)) {
        target = u;
        bestD2 = d2;
      }
    }
    if (!target) continue;

    b.cooldown = gun.reload;
    target.hp -= gun.damage;
    sim.projectiles.push({
      x: b.x, y: b.y, tx: target.x, ty: target.y, life: 4, owner: b.owner,
    });
    sound(sim, "hit");
  }

  for (const b of sim.buildings.slice()) {
    if (b.hp <= 0) destroyBuilding(sim, b);
  }
  for (const s of sim.sites.slice()) {
    if (s.hp <= 0) destroySite(sim, s);
  }
  const fallen = sim.units.filter((u) => u.hp <= 0);
  if (fallen.length > 0) {
    const dead = new Set(fallen.map((u) => u.id));
    const livingHeroes = sim.units.filter((u) => u.isHero && u.hp > 0);
    for (const d of fallen) {
      sim.events.push({
        type: "vfx_prana_death",
        x: d.x,
        y: d.y,
        colour: d.spec.colour,
        tick: sim.tick,
      });
      for (const h of livingHeroes) {
        if (h.owner !== d.owner) {
          const d2 = (h.x - d.x) ** 2 + (h.y - d.y) ** 2;
          if (d2 <= 140 * 140) {
            h.xp = (h.xp || 0) + (d.spec.isHero ? 100 : (d.spec.siege ? 40 : 20));
          }
        }
      }
    }
    sim.units = sim.units.filter((u) => u.hp > 0);
    for (const u of sim.units) {
      if (u.chaseId !== null && dead.has(u.chaseId)) u.chaseId = null;
    }
    sound(sim, "die");
  }

  sim.projectiles = sim.projectiles.filter((p) => (p.life -= 1) > 0);
}

export function queueCast(sim, owner, unitId, abilityId, tx, ty, targetId = null) {
  const unit = sim.units.find((u) => u.id === unitId && u.owner === owner);
  if (!unit || unit.hp <= 0) return { ok: false, reason: "unit not found" };

  const spec = ABILITIES[abilityId];
  if (!spec) return { ok: false, reason: "unknown ability" };

  if (!unit.spec.abilities?.includes(abilityId)) return { ok: false, reason: "unit cannot cast this" };

  unit.cooldowns = unit.cooldowns || {};
  if ((unit.cooldowns[abilityId] || 0) > 0) return { ok: false, reason: "ability on cooldown" };

  unit.cooldowns[abilityId] = spec.cooldown;

  if (abilityId === "vajra") {
    let primaryTarget = null;
    if (targetId) {
      primaryTarget = sim.units.find((u) => u.id === targetId && u.owner !== owner && u.hp > 0);
    }
    if (!primaryTarget) {
      const cx = tx ? tx * TILE + 8 : unit.x;
      const cy = ty ? ty * TILE + 8 : unit.y;
      let minD2 = Infinity;
      for (const u of sim.units) {
        if (u.owner !== owner && u.hp > 0) {
          const d2 = (u.x - cx) ** 2 + (u.y - cy) ** 2;
          if (d2 < minD2 && d2 <= spec.range ** 2) {
            minD2 = d2;
            primaryTarget = u;
          }
        }
      }
    }

    if (primaryTarget) {
      const chained = [primaryTarget];
      let current = primaryTarget;
      for (let c = 1; c < (spec.maxChains || 4); c++) {
        let nextTarget = null;
        let nextD2 = Infinity;
        for (const u of sim.units) {
          if (u.owner !== owner && u.hp > 0 && !chained.includes(u)) {
            const d2 = (u.x - current.x) ** 2 + (u.y - current.y) ** 2;
            if (d2 < nextD2 && d2 <= (spec.radius || 65) ** 2) {
              nextD2 = d2;
              nextTarget = u;
            }
          }
        }
        if (nextTarget) {
          chained.push(nextTarget);
          current = nextTarget;
        } else {
          break;
        }
      }

      for (const target of chained) {
        target.hp -= spec.damage;
        if (target.hp <= 0 && unit.isHero) {
          unit.xp = (unit.xp || 0) + 30;
        }
      }

      sim.events.push({
        type: "vfx_vajra",
        fromId: unit.id,
        fromX: unit.x,
        fromY: unit.y,
        targets: chained.map((t) => ({ id: t.id, x: t.x, y: t.y, hp: t.hp })),
        tick: sim.tick,
      });
      say(sim, `${unit.spec.name} channels Vajra Storm!`);
      sound(sim, "devotion", owner);
    }
    return { ok: true };
  }

  if (abilityId === "kavacha") {
    let count = 0;
    for (const u of sim.units) {
      if (u.owner === owner && u.hp > 0) {
        const d2 = (u.x - unit.x) ** 2 + (u.y - unit.y) ** 2;
        if (d2 <= (spec.radius || 70) ** 2) {
          u.shield = (u.shield || 0) + spec.shield;
          u.shieldTicks = spec.duration;
          count++;
        }
      }
    }
    sim.events.push({
      type: "vfx_kavacha",
      fromId: unit.id,
      x: unit.x,
      y: unit.y,
      radius: spec.radius,
      tick: sim.tick,
    });
    say(sim, `${unit.spec.name} manifests Kavacha Ward upon ${count} warriors.`);
    sound(sim, "devotion", owner);
    return { ok: true };
  }

  if (abilityId === "trample") {
    unit.charge = {
      targetX: tx * TILE + 8,
      targetY: ty * TILE + 8,
      ticks: spec.duration,
      speedBoost: 2.0,
      damage: spec.damage,
    };
    sim.events.push({
      type: "vfx_trample",
      unitId: unit.id,
      tick: sim.tick,
    });
    say(sim, `${unit.spec.name} surges in a Trample Breaching Charge!`);
    sound(sim, "order", owner);
    return { ok: true };
  }

  if (abilityId === "agni") {
    const targetX = tx * TILE + 8;
    const targetY = ty * TILE + 8;
    sim.hazards = sim.hazards || [];
    sim.hazards.push({
      x: targetX,
      y: targetY,
      radius: spec.radius,
      ticks: spec.duration,
      dps: spec.damagePerSec / 20.0,
      owner,
    });
    sim.events.push({
      type: "vfx_agni",
      x: targetX,
      y: targetY,
      radius: spec.radius,
      tick: sim.tick,
    });
    say(sim, `Flaming Agni Shila ignites the battlefield!`);
    sound(sim, "build", owner);
    return { ok: true };
  }

  if (abilityId === "battlecry") {
    let count = 0;
    for (const u of sim.units) {
      if (u.owner === owner && u.hp > 0) {
        const d2 = (u.x - unit.x) ** 2 + (u.y - unit.y) ** 2;
        if (d2 <= spec.radius ** 2) {
          u.buff = { kind: "valour", dmgMul: 1.35, speedMul: 1.25, ticks: spec.duration };
          count++;
        }
      }
    }
    sim.events.push({
      type: "vfx_battlecry",
      unitId: unit.id,
      radius: spec.radius,
      tick: sim.tick,
    });
    say(sim, `${unit.spec.name} sounds the Himalayan War Horn of Valour!`);
    sound(sim, "devotion", owner);
    return { ok: true };
  }

  return { ok: false, reason: "unhandled ability" };
}

/**
 * Which of two equally-close targets to prefer. Lower wins.
 *
 * This used to be the raw `id`, and that was quietly unfair. Ids are handed out
 * in creation order across the whole match, so between two identical armies the
 * one that happened to train a spearman a tick earlier owned every tie for the
 * rest of the game — always the same seat, always in the same direction. It cost
 * mirror matches 6-6 once rams started hunting structures, and it was invisible
 * because nothing about it looks like a bug.
 *
 * `seq` counts within an owner, so a player's Nth thing pairs with the enemy's
 * Nth thing and the tie falls the same way from both seats. Owner is the last
 * resort and only ever decides between two DIFFERENT enemies — with one
 * opponent it never runs, and a free-for-all has no symmetry to protect anyway.
 *
 * A purely geometric rule cannot do this job: mirroring negates every offset, so
 * "prefer the one further left" reverses into "prefer the one further right".
 * The tie-break has to be paired, not positional.
 */
function rank(a, b) {
  // `?? 0` rather than a bare subtraction: a missing `seq` would make this NaN,
  // NaN is not less than zero, and the tie would quietly fall back to whichever
  // one the scan happened to reach first — a scan-order bug that no test would
  // fail on. Falling through to owner and id keeps the order total either way.
  return (a.seq ?? 0) - (b.seq ?? 0) || a.owner - b.owner || a.id - b.id;
}

/**
 * Nearest enemy in range, units before buildings — a soldier shoots the man in
 * front of him rather than the wall behind. Ties break on `rank` so two clients
 * always pick the same one, and neither seat is favoured.
 */
/**
 * Can this unit hit that thing from where it stands?
 *
 * Measured the same two ways `findTarget` measures — footprint distance for a
 * structure, centre distance for a man. A band-mate using a different rule from
 * the one that chose the target would fire at things it cannot reach, which is
 * a miss that costs a reload and looks like the unit being broken.
 */
function inReach(unit, thing) {
  const reach = unit.mountedOn ? Math.round(unit.spec.range * 1.5) : unit.spec.range;
  const d2 = thing.spec.tiles
    ? gapTo(thing, unit.x, unit.y)
    : (thing.x - unit.x) ** 2 + (thing.y - unit.y) ** 2;
  return d2 <= reach * reach;
}

function findTarget(sim, unit, hash) {
  // Stances:
  // - "hold_fire": Never auto-acquire targets (stealth / hold discipline).
  if (unit.stance === "hold_fire") return null;

  let best = null;
  let bestD2 = Infinity;
  const reach = unit.mountedOn ? Math.round(unit.spec.range * 1.5) : unit.spec.range;

  const guardRadius = unit.stance === "defensive" ? 140 : (unit.stance === "stand_ground" ? reach : Infinity);
  const guardX = unit.guardX ?? unit.x;
  const guardY = unit.guardY ?? unit.y;

  // Siege looks for walls FIRST.
  if (unit.spec.vsBuilding) {
    for (const structure of [...sim.buildings, ...sim.sites]) {
      if (structure.owner === unit.owner || (sim.diplomacy && sim.diplomacy[unit.owner]?.[structure.owner] === "ally")) continue;
      const d2 = gapTo(structure, unit.x, unit.y);
      if (d2 > reach * reach) continue;
      if (unit.stance === "defensive" && gapTo(structure, guardX, guardY) > guardRadius * guardRadius) continue;
      if (d2 < bestD2 || (d2 === bestD2 && rank(structure, best) < 0)) {
        best = structure;
        bestD2 = d2;
      }
    }
    if (best) return best;
    bestD2 = Infinity;
  }

  for (const other of hash.near(unit.x, unit.y)) {
    if (other.owner === unit.owner || (sim.diplomacy && sim.diplomacy[unit.owner]?.[other.owner] === "ally")) continue;
    const dx = other.x - unit.x;
    const dy = other.y - unit.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    if (unit.stance === "defensive") {
      const gdx = other.x - guardX;
      const gdy = other.y - guardY;
      if (gdx * gdx + gdy * gdy > guardRadius * guardRadius) continue;
    }
    if (d2 < bestD2 || (d2 === bestD2 && rank(other, best) < 0)) {
      best = other;
      bestD2 = d2;
    }
  }
  if (best) return best;

  // Structures, once there is no man left to swing at.
  for (const structure of [...sim.buildings, ...sim.sites]) {
    if (structure.owner === unit.owner || (sim.diplomacy && sim.diplomacy[unit.owner]?.[structure.owner] === "ally")) continue;
    const d2 = gapTo(structure, unit.x, unit.y);
    if (d2 > reach * reach) continue;
    if (unit.stance === "defensive" && gapTo(structure, guardX, guardY) > guardRadius * guardRadius) continue;
    if (d2 < bestD2 || (d2 === bestD2 && rank(structure, best) < 0)) {
      best = structure;
      bestD2 = d2;
    }
  }

  return best;
}

/**
 * Losing your manor puts you out. The last one standing wins.
 *
 * This used to read "if anyone has no heart, the OTHER player won", which is
 * correct for exactly two players and quietly wrong for any other number. With
 * three it would have ended the whole match the first time anybody was knocked
 * out, and handed the win to seat 0 or 1 depending on who fell.
 *
 * A knocked-out player's army leaves with them. The alternative — a leaderless
 * horde that fights on for a player who cannot give it orders, cannot be
 * defeated again and cannot win — is not a mechanic anyone would design, and
 * would decide the remaining match by which survivor happened to be standing
 * next to it.
 *
 * Two-player behaviour is unchanged: one player falls, one player is left, and
 * that player wins on the same tick as before.
 */
function checkEnd(sim) {
  for (const player of sim.players) {
    if (player.out) continue;
    const hasHeart = sim.buildings.some(
      (b) => b.owner === player.id && b.spec.isHeart
    );
    if (hasHeart) continue;

    eliminate(sim, player, `${player.name} is broken.`);
  }

  const left = sim.players.filter((p) => !p.out);
  if (left.length <= 1) {
    sim.over = true;
    sim.winner = left.length === 1 ? left[0].id : null;
    if (sim.winner !== null) {
      say(sim, `${sim.players[sim.winner].name} takes the field.`, true);
    }
  }
}

/**
 * Take a player off the board: their hall is gone, or they walked away.
 *
 * Shared by `checkEnd` and by a resignation, because those must do EXACTLY the
 * same thing. A player who quits leaving a working economy behind would be a
 * gift to whoever stood nearest, and one who quit leaving nothing while a
 * defeated player left an army would be two different rules for the same state.
 */
function eliminate(sim, player, line) {
  if (player.out) return;
  player.out = true;
  say(sim, line, true);

  // Everything they still owned goes with them. Buildings first, so the grid is
  // restored before anything tries to path across where they stood.
  for (const b of sim.buildings.slice()) {
    if (b.owner === player.id) destroyBuilding(sim, b);
  }
  for (const site of sim.sites.slice()) {
    if (site.owner === player.id) destroySite(sim, site);
  }
  sim.units = sim.units.filter((u) => u.owner !== player.id);
  for (const u of sim.units) {
    // Anything that was chasing something of theirs now has nothing to chase.
    if (u.chaseId !== null && !thingExists(sim, u.chaseId)) u.chaseId = null;
  }
  sim.fieldsDirty = true;
}

/** Is this id still a unit, a building or a foundation? */
function thingExists(sim, id) {
  return (
    sim.units.some((u) => u.id === id) ||
    sim.buildings.some((b) => b.id === id) ||
    sim.sites.some((x) => x.id === id)
  );
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function say(sim, text, big = false) {
  sim.events.push({ text, big, tick: sim.tick });
}

/**
 * Raise a sound cue. WHOSE it is matters.
 *
 * This pushed a bare string, so every cue the simulation raised was played to
 * every player: you heard the enemy's people being trained, their buildings
 * going up, their men dying — from anywhere on a map that is now two hundred
 * and eighty tiles wide. It reads as the game being noisy and confusing, and it
 * is really the game telling you things you have no way to see and no business
 * hearing.
 *
 * `owner` null means "everybody hears this", which is right for nothing at
 * present but is the honest default for a cue that belongs to the world rather
 * than to a player.
 *
 * Nothing here can affect the simulation. `sim.sounds` is drained by the client
 * and never read back, so a muted game and a loud one play out identically.
 */
function sound(sim, name, owner = null) {
  sim.sounds.push({ name, owner });
}

/** Everything a verifier would need to check a claimed result. */
export function summary(sim) {
  return {
    seed: sim.seed,
    mapId: sim.mapId,
    ticks: sim.tick,
    winner: sim.winner,
    gold: sim.players.map((p) => Math.floor(p.gold)),
    timber: sim.players.map((p) => Math.floor(p.timber)),
    food: sim.players.map((p) => Math.floor(p.food)),
    // Split per good. One combined figure hid the case this is for — a player
    // whose depots are full of grain and empty of gold is in a very different
    // position from one holding the same total in gold.
    inDepots: sim.players.map((p) => {
      const held = { gold: 0, timber: 0, food: 0 };
      for (const b of sim.buildings) {
        if (b.owner !== p.id) continue;
        for (const r of RESOURCES) held[r] += b.store[r];
      }
      return held;
    }),
    goldLeft: [...sim.seams.values()].reduce((a, b) => a + b, 0),
    units: sim.players.map((p) => sim.units.filter((u) => u.owner === p.id).length),
    peasants: sim.players.map(
      (p) => sim.units.filter((u) => u.owner === p.id && u.spec.worker).length
    ),
    buildings: sim.players.map((p) => sim.buildings.filter((b) => b.owner === p.id).length),
    sites: sim.players.map((p) => sim.sites.filter((s) => s.owner === p.id).length),
  };
}

/** Every gold seam on the map, as tiles. Used by the AI and the renderer. */
export function goldSeams(grid) {
  const out = [];
  for (let ty = 0; ty < grid.h; ty++) {
    for (let tx = 0; tx < grid.w; tx++) {
      if (grid.cells[idx(grid, tx, ty)] === GOLD) out.push([tx, ty]);
    }
  }
  return out;
}

export function queueDiplomacy(sim, owner, targetSeat, stance) {
  if (targetSeat < 0 || targetSeat >= sim.players.length || targetSeat === owner) return { ok: false, reason: "invalid target" };
  if (stance !== "ally" && stance !== "neutral" && stance !== "enemy") return { ok: false, reason: "invalid stance" };
  sim.diplomacy[owner][targetSeat] = stance;
  sim.events.push({
    type: "diplomacy_change",
    from: owner,
    to: targetSeat,
    stance,
    tick: sim.tick,
  });
  return { ok: true };
}

export function queueTribute(sim, owner, targetSeat, resource, amount) {
  if (targetSeat < 0 || targetSeat >= sim.players.length || targetSeat === owner) return { ok: false, reason: "invalid target" };
  if (!RESOURCES.includes(resource)) return { ok: false, reason: "invalid resource" };
  const pFrom = sim.players[owner];
  const pTo = sim.players[targetSeat];
  const amt = Math.max(0, Math.min(pFrom[resource] || 0, amount));
  if (amt <= 0) return { ok: false, reason: "insufficient resources" };
  pFrom[resource] -= amt;
  pTo[resource] += amt;
  sim.events.push({
    type: "tribute",
    from: owner,
    to: targetSeat,
    resource,
    amount: amt,
    tick: sim.tick,
  });
  return { ok: true };
}

export function queueChat(sim, owner, text, target = -1) {
  const clean = String(text).slice(0, 140);
  sim.events.push({
    type: "chat",
    from: owner,
    target, // -1: All, >=0: Specific player
    text: clean,
    tick: sim.tick,
  });
  return { ok: true };
}
