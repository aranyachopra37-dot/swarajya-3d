// Who attacks you.
//
// This table is the answer to "they all behaved identically". Variety comes from
// who shows up, not from dice — everyone facing today's seed faces exactly this,
// so there is no luck in it anywhere.
//
// The important field is `morale`. A Ram has `morale: null`, and that single
// absence means "this is a machine and cannot be frightened". It walks into the
// guns until it is destroyed. No flag, no special case — the missing value IS
// the behaviour.

export const UNITS = {
  levy: {
    id: "levy",
    name: "Levy",
    men: 24,
    morale: 70,
    armour: 0,
    speed: 30,
    colour: "#d7c9a7",
    lore: "Farmers with two weeks' drill. They came because a man on a horse told them to.",
  },
  shieldwall: {
    id: "shieldwall",
    name: "Shieldwall",
    men: 18,
    morale: 130,
    armour: 1, // every hit does 1 less soldier damage, never below 0
    speed: 22,
    colour: "#a7b6d7",
    lore: "Paid men who have stood before. They will not run for a bell.",
  },
  outriders: {
    id: "outriders",
    name: "Outriders",
    men: 12,
    morale: 60,
    armour: 0,
    speed: 62,
    colour: "#d7a7a7",
    lore: "Fast, thin-skinned, and gone before you have reloaded. Or dead before they arrive.",
  },
  ram: {
    id: "ram",
    name: "Ram",
    // Was 30, which was quietly decisive: two Rams arrive per battle and 2 x 30
    // was EXACTLY the gate's 60 health. Any creed that could not kill machines
    // therefore lost by precisely enough, which is why the balance harness read
    // 18/18 for Forge and 0/18 for everything else — a cliff, not a gradient.
    // At 18 every strategy survived instead, which is the opposite failure —
    // no challenge at all. 24 leaves a pair of Rams doing 48 of 60, so letting
    // both through is very nearly fatal without being automatically so.
    men: 24,
    morale: null, // a machine. It cannot rout.
    armour: 2,
    speed: 14,
    colour: "#8a7f6b",
    lore: "Oak, iron and rope. It has no opinion about your bells.",
  },
  bearer: {
    id: "bearer",
    name: "Standard Bearer",
    men: 10,
    morale: 90,
    armour: 0,
    speed: 30,
    colour: "#d7b96b",
    // While it lives, nearby regiments recover faster and cannot be pushed
    // below `auraFloor` — so they simply will not break. Killing the bearer is
    // the play that unlocks the whole wave.
    auraRadius: 170,
    auraRegen: 6,
    auraFloor: 25,
    lore: "Ten men and a piece of cloth. Kill the cloth and the field comes apart.",
  },
};

// --- The harder things -------------------------------------------------------
//
// Each of these breaks one assumption the defence has been resting on, rather
// than simply having bigger numbers. Grounded in the RTS unit classes this
// design borrows from: a Special, a Demonic fanatic, and a Siege engine.

UNITS.warlord = {
  id: "warlord",
  name: "Warlord",
  men: 16,
  morale: 220,
  armour: 2,
  speed: 26,
  colour: "#d78b6b",
  // A bearer holds a line steady. A Warlord drags it back onto its feet: any
  // routing regiment near him turns and fights again, once. The counter to a
  // defence built entirely on breaking will.
  auraRadius: 200,
  auraRegen: 10,
  auraFloor: 40,
  rallies: true,
  lore: "He has lost battles before and come back with the same men. Ask them why.",
};

UNITS.zealots = {
  id: "zealots",
  name: "Zealots",
  men: 20,
  morale: 60,
  armour: 0,
  speed: 40,
  colour: "#b06b8f",
  // Fanatics: casualties STEEL them instead of shaking them. Every other unit
  // in the game gets easier to break as it thins. These get harder, which turns
  // the core mechanic inside out and forces you to actually kill them.
  fanatic: true,
  lore: "They came for the ending. Hurting them only confirms they were right.",
};

UNITS.hirelings = {
  id: "hirelings",
  name: "Hirelings",
  men: 20,
  // The Ram's mirror. Every other hard enemy here punishes a defence built on
  // breaking will — a Bearer floors morale, a Warlord puts the broken back on
  // their feet, Zealots cannot be frightened at all, machines have no morale to
  // attack. Nothing punished a defence built on killing. Plate good enough that
  // a Cannon cannot scratch it and only a Bombard tells, married to the worst
  // nerve on the field: you do not kill Hirelings, you frighten them, and they
  // are delighted to oblige.
  //
  // Be honest about what this did NOT do. It was added to check Forge, which
  // holds every battle it plays, and it does not — Forge still holds 42 of 42.
  // The harness was run with these at armour 12, literally unkillable by
  // anything in the game, and Forge held 42 of 42 then too, breaking them with
  // incidental morale chip from sheer weight of guns. Forge's dominance is not
  // in any number these could counter. What they did do is give the break-creeds
  // a late game: Wild went from 33 of 42 to 37. They take the Shieldwall's place
  // in three waves rather than being added on top, so the field is no fuller —
  // it is harder for a defence that kills and softer for one that frightens,
  // which is the direction that was wanted even if the size was not.
  morale: 55,
  armour: 6,
  speed: 24,
  colour: "#9a9aa8",
  lore: "Very good armour, bought with someone else's money, worn by men who intend to keep wearing it.",
};

// --- The old things ----------------------------------------------------------
//
// Wild is what stood here before the Empire, and these are what Wild remembers.
// They are the first enemies that are not simply men with a different job, and
// they arrive in the back half where the game had stopped asking new questions.

UNITS.barrowWight = {
  id: "barrowWight",
  name: "Barrow-Wight",
  men: 30,
  // It CAN be frightened, and that is the entire design. Break it and it goes
  // back into the ground whole; kill it and it comes apart into three fast
  // things that are already halfway down your road. Every other enemy rewards
  // whichever answer the player happens to own — this one punishes killing,
  // which is the answer that has never once been punished. Forge holds every
  // battle it plays, and nothing in five separate balance passes touched that.
  morale: 150,
  armour: 4,
  speed: 18,
  colour: "#7f8fa0",
  splitsInto: { unit: "shade", count: 3 },
  lore: "It was buried with its rings on, under a mound the road was polite enough to go around.",
};

UNITS.shade = {
  id: "shade",
  name: "Shade",
  men: 8,
  // Thin nerve, no armour, and quick. A defence built to grind down heavy things
  // is the wrong shape for these, which is the point of making them the reward
  // for grinding down a heavy thing.
  morale: 35,
  armour: 0,
  speed: 48,
  colour: "#9fb0c4",
  lore: "Whatever it was is long gone. What is left still knows the way to the gate.",
};

UNITS.siegeTower = {
  id: "siegeTower",
  name: "Siege Tower",
  men: 26,
  morale: null,       // a machine, like the Ram
  armour: 3,
  speed: 12,
  colour: "#6f6a5c",
  // The first enemy that shoots back. It destroys your buildings as it passes,
  // so a defence can no longer be built once and left alone.
  attacksTowers: { range: 110, reload: 150 },
  lore: "It does not want your gate. It wants the things you built to protect it.",
};

export const UNIT_IDS = [
  "levy",
  "shieldwall",
  "outriders",
  "ram",
  "bearer",
  "warlord",
  "zealots",
  "hirelings",
  "barrowWight",
  "shade",
  "siegeTower",
];
