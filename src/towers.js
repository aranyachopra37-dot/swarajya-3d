// What you can build. Plain data on purpose: balancing should mean editing
// numbers here, never editing logic.
//
// The three creeds split along the axis the whole game turns on — killing
// versus breaking:
//
//   ORDER  bells and relics. Kills almost nobody; shatters will.
//   FORGE  powder and iron. Erases men; barely dents will.
//   WILD   thorn and old blood. Cheap, fast, weak alone, dreadful in numbers.
//
// You do not choose a creed. You build, and what you have built decides who you
// are — devotion accrues one tower at a time, and the deeper it runs the more it
// opens to you. That is the whole identity system, and it means two players can
// face the same board and end up playing different games.

export const FAMILIES = {
  ORDER: {
    id: "ORDER",
    name: "Order",
    colour: "#d4c97f",
    creed: "Break their will and you need not break their bodies.",
    // Per tier: all your towers do this much more morale damage.
    perTier: { moraleDamage: 0.14 },
    boonText: "+14% morale damage per tier",
  },
  FORGE: {
    id: "FORGE",
    name: "Forge",
    colour: "#d49a7f",
    creed: "Faith is slow. Powder is not.",
    perTier: { soldierDamage: 0.14 },
    boonText: "+14% killing power per tier",
  },
  WILD: {
    id: "WILD",
    name: "Wild",
    colour: "#8fd47f",
    creed: "The old things were here before the empire, and will outlast it.",
    perTier: { reload: -0.11 }, // negative = faster
    boonText: "-11% reload per tier",
  },
};

export const FAMILY_IDS = ["ORDER", "FORGE", "WILD"];

// Devotion is simply how many towers of a creed you have raised.
export const TIER_THRESHOLDS = [2, 4]; // tier 1 at 2 towers, tier 2 at 4

export function tierFor(devotion) {
  let tier = 0;
  for (const threshold of TIER_THRESHOLDS) if (devotion >= threshold) tier += 1;
  return tier;
}

export const TOWERS = {
  // --- Common ----------------------------------------------------------------
  archer: {
    id: "archer",
    name: "Watch Post",
    family: null, // belongs to no creed, and earns devotion to none
    cost: 40,
    range: 150,
    reload: 42,
    soldierDamage: 1,
    moraleDamage: 9,
    splash: 0,
    pulse: false,
    colour: "#7fa7d4",
    lore: "Levied bowmen and a plank roof. Every lord has these; no lord wins with them.",
  },

  // --- Order -----------------------------------------------------------------
  bell: {
    id: "bell",
    name: "Bell Tower",
    family: "ORDER",
    cost: 75,
    range: 140,
    reload: 90,
    soldierDamage: 0, // kills nobody, ever
    moraleDamage: 22,
    splash: 0,
    pulse: true, // no projectile: strikes everything in range at once
    colour: "#d4c97f",
    lore: "It tolls for the dying, and the living hear it too.",
  },
  reliquary: {
    id: "reliquary",
    name: "Reliquary",
    family: "ORDER",
    requires: { family: "ORDER", devotion: 2 },
    cost: 165,
    range: 210,
    reload: 150,
    soldierDamage: 0,
    moraleDamage: 46,
    splash: 0,
    pulse: true,
    colour: "#f0e3a0",
    lore: "A saint's finger bone under glass. Armies have quit the field rather than pass it.",
  },

  // --- Forge -----------------------------------------------------------------
  cannon: {
    id: "cannon",
    name: "Cannon",
    family: "FORGE",
    cost: 90,
    range: 170,
    reload: 70,
    soldierDamage: 4,
    moraleDamage: 3,
    splash: 60,
    pulse: false,
    colour: "#d49a7f",
    lore: "Cast by a guild that will not say how. It does not care what a man believes.",
  },
  bombard: {
    id: "bombard",
    name: "Bombard",
    family: "FORGE",
    requires: { family: "FORGE", devotion: 2 },
    cost: 180,
    range: 200,
    reload: 130,
    soldierDamage: 9,
    moraleDamage: 5,
    splash: 95,
    pulse: false,
    colour: "#f0b596",
    lore: "Takes six men to load and empties a road in one breath.",
  },

  // --- Wild ------------------------------------------------------------------
  thorn: {
    id: "thorn",
    name: "Thornstone",
    family: "WILD",
    cost: 25,
    range: 95,
    reload: 26,
    soldierDamage: 1,
    moraleDamage: 5,
    splash: 0,
    pulse: false,
    colour: "#8fd47f",
    lore: "A standing stone with the wrong marks on it. The briars came after.",
  },
  bloodthorn: {
    id: "bloodthorn",
    name: "Bloodthorn",
    family: "WILD",
    requires: { family: "WILD", devotion: 2 },
    cost: 130,
    range: 120,
    reload: 20,
    soldierDamage: 2,
    moraleDamage: 11,
    splash: 0,
    pulse: true, // takes the whole road at once, very fast
    // Briars do not care what you are wearing: they go under it. This is Wild's
    // only answer to a machine, and it is deliberately the tier-2 building, so
    // the answer costs a commitment to the creed. Without it Wild did literal
    // zero to Rams, Warlords and Siege Towers — thirty-six Thornstones and a
    // Ram still walked through — and "dreadful in numbers" was simply false.
    pierce: 2,
    colour: "#b6f0a0",
    lore: "It drinks first and flowers after. The flowers are the wrong colour.",
  },
};

// --- Terrain-locked and support buildings ------------------------------------
//
// These come from the unit classes of the RTS this design is grounded in —
// Ships, Reconnaissance and Siege — recast as buildings. Their point is that
// terrain decides what you may build, so a map constrains your creed before you
// have chosen one.

TOWERS.scout = {
  id: "scout",
  name: "Watchpost",
  family: null,           // earns devotion to nobody: it is not a weapon
  terrain: "mountain",    // only on high ground
  cost: 55,
  range: 190,             // the radius it BUFFS, not a firing range
  reload: 0,
  soldierDamage: 0,
  moraleDamage: 0,
  splash: 0,
  pulse: false,
  support: { rangeBonus: 0.22, damageBonus: 0.18 },
  colour: "#9fd4c8",
  lore: "It carries no weapon. It simply sees further than anyone below, and says so.",
};

TOWERS.marksman = {
  id: "marksman",
  name: "Marksman's Nest",
  family: "ORDER",
  terrain: "mountain",
  cost: 110,
  range: 300,             // by far the longest reach in the game
  reload: 105,
  soldierDamage: 3,
  moraleDamage: 14,
  splash: 0,
  pulse: false,
  colour: "#c9c07f",
  lore: "One shot, one officer. The rest of the column watches him fall.",
};

TOWERS.barge = {
  id: "barge",
  name: "War Barge",
  family: "FORGE",
  terrain: "water",       // ships need water, which not every map has
  cost: 125,
  range: 205,
  reload: 88,
  soldierDamage: 5,
  moraleDamage: 6,
  splash: 75,
  pulse: false,
  colour: "#7fb9d4",
  lore: "Flat-bottomed, badly steered, and carrying more iron than sense.",
};

TOWERS.snare = {
  id: "snare",
  name: "Snare Ground",
  family: "WILD",
  terrain: null,
  cost: 60,
  range: 130,
  reload: 0,
  soldierDamage: 0,
  moraleDamage: 0,
  splash: 0,
  pulse: false,
  // Slows everything in range. The game had no way to buy TIME before this.
  slow: 0.45,
  colour: "#6f9a5c",
  lore: "Stakes, wire and a great deal of patience. It kills nobody and ruins everyone.",
};

TOWERS.spikes = {
  id: "spikes",
  name: "Caltrop Field",
  // Belongs to no creed, exactly like the Watch Post. That is the whole point of
  // it: the balance harness showed the game asking one question — "do you have
  // an answer to armour?" — and answering it as a checkbox. Yes meant an
  // untouched gate, no meant a dead one, and only Forge could say yes without
  // help from the terrain. A road that hurts is an answer every creed can buy.
  family: null,
  terrain: null,
  cost: 70,
  range: 0,
  reload: 0,
  soldierDamage: 0,   // it never fires; everything it does happens underfoot
  moraleDamage: 0,
  splash: 0,
  pulse: false,
  /**
   * A field of iron on the road, restocked slowly and used up by whoever walks
   * over it. Two things make it different from every other building:
   *
   *   - It is CONSUMED. Nothing else in the game depletes, so nothing else has
   *     ever degraded under sustained pressure — a defence was either sufficient
   *     forever or insufficient immediately, which is exactly the binary the
   *     difficulty audit found. Spikes run out, and a heavy wave leaves the road
   *     bare behind it.
   *   - It PIERCES. Caltrops do not care about plate, because they go in from
   *     underneath — this is the only thing a creed that cannot kill can put in
   *     front of a Ram.
   *
   * It cannot break anybody: `moraleDamage` is zero and stays zero. Losing men
   * to the ground is not the same as being frightened by it, and Order should
   * still need Order.
   */
  spikes: {
    every: 165,   // ticks between new charges — deliberately slower than a wave
    max: 5,       // stockpile cap, so it cannot be left to accumulate all battle
    damage: 7,
    pierce: 3,    // through a Ram's 2 and a Siege Tower's 3
    reach: 26,    // how close along the road a regiment must be to set one off
  },
  colour: "#b3a58c",
  lore: "The smith's apprentice seeds the road every morning and swears at it every evening.",
};

export const TOWER_IDS = [
  "archer",
  "bell",
  "reliquary",
  "cannon",
  "bombard",
  "thorn",
  "bloodthorn",
  "scout",
  "marksman",
  "barge",
  "snare",
  "spikes",
];

/** Is this tower available yet, given what has been built? */
export function isUnlocked(spec, devotion) {
  if (!spec.requires) return true;
  return (devotion[spec.requires.family] ?? 0) >= spec.requires.devotion;
}

/**
 * A tower's stats after the boons its owner's creeds provide. Towers of every
 * creed benefit — devotion changes *you*, not just the buildings.
 */
export function effectiveSpec(spec, devotion) {
  let soldierDamage = spec.soldierDamage;
  let moraleDamage = spec.moraleDamage;
  let reload = spec.reload;

  for (const id of FAMILY_IDS) {
    const tier = tierFor(devotion[id] ?? 0);
    if (tier === 0) continue;
    const per = FAMILIES[id].perTier;
    if (per.soldierDamage) soldierDamage *= 1 + per.soldierDamage * tier;
    if (per.moraleDamage) moraleDamage *= 1 + per.moraleDamage * tier;
    if (per.reload) reload *= 1 + per.reload * tier;
  }

  return {
    ...spec,
    soldierDamage,
    moraleDamage,
    reload: Math.max(6, Math.round(reload)),
  };
}
