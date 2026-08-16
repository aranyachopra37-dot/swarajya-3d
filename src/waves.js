// What comes at you, and when.
//
// This is where the seed is allowed to matter. Every player on today's seed gets
// the identical list out of this file, so it varies *what you face* without ever
// varying *what happens when you act*. That distinction is the whole reason the
// leaderboard can mean something: two equally skilled players on the same seed
// still get the same result.
//
// Nothing in the battle itself rolls dice. Only this.

import { TICKS_PER_SECOND } from "./constants.js";

const WAVE_GAP = 6 * TICKS_PER_SECOND; // seconds between waves
const WITHIN_WAVE_GAP = 45;            // ticks between units in the same wave

// Each wave offers a few equally-fair variants. The seed picks which one you
// get; the shapes are deliberately similar in difficulty so the choice adds
// texture, not luck.
// Each wave offers a few equally-fair variants; the seed picks which you face.
// The back half introduces the things that break a rule you have been relying
// on — Zealots that cannot be frightened into breaking, a Warlord who puts
// broken men back on their feet, and a Siege Tower that destroys what you built.
//
// Those all punish a defence built on breaking will, and for a long time the
// back half punished nothing else, so a defence built on killing simply never
// met a problem. Hirelings are the other half of that pressure and take the
// Shieldwall's place in three waves rather than being added on top: the count of
// what arrives is unchanged, but now some of it has to be frightened off instead
// of shot down.
const WAVE_TABLE = [
  [["levy", "levy"], ["levy", "levy"]],
  [["levy", "levy", "outriders"], ["outriders", "levy", "levy"]],
  [["shieldwall", "levy"], ["levy", "shieldwall"]],
  [["bearer", "levy", "levy"], ["levy", "bearer", "levy"]],
  [["outriders", "outriders"], ["outriders", "levy", "outriders"]],
  [["ram", "levy"], ["levy", "ram"]],
  [["zealots", "levy"], ["levy", "zealots"]],
  [["bearer", "hirelings", "shieldwall"], ["shieldwall", "bearer", "hirelings"]],
  [["ram", "outriders", "hirelings"], ["ram", "hirelings", "outriders"]],
  [["zealots", "zealots", "outriders", "levy"], ["outriders", "zealots", "zealots", "levy"]],
  [["warlord", "shieldwall", "levy", "outriders"], ["shieldwall", "warlord", "outriders", "levy"]],
  [["siegeTower", "hirelings", "barrowWight"], ["hirelings", "siegeTower", "barrowWight"]],
  [["warlord", "barrowWight", "shieldwall", "hirelings"], ["barrowWight", "warlord", "hirelings", "shieldwall"]],
  [["siegeTower", "ram", "warlord", "zealots"], ["ram", "siegeTower", "zealots", "warlord"]],

  // The last two waves are the whole point of the back half, and they are meant
  // to be survived rather than beaten cleanly. The difficulty audit found that a
  // winning run never dropped below 96% of its gate on ANY map — the defence was
  // never being asked a question, only checked for one answer ("can you kill
  // armour?"). Volume is the question nothing else in the game asks: five and six
  // regiments arriving together punish slow single-target guns and reward
  // anything that strikes a whole stretch of road at once.
  [["ram", "ram", "hirelings", "zealots", "outriders"],
   ["hirelings", "ram", "zealots", "ram", "outriders"]],
  [["siegeTower", "warlord", "barrowWight", "zealots", "hirelings", "shieldwall"],
   ["warlord", "siegeTower", "hirelings", "barrowWight", "shieldwall", "zealots"]],
];

/**
 * Build the full spawn list for a battle.
 * Returns [{ tick, unit }] sorted by tick.
 */
export function buildWaves(random) {
  const spawns = [];
  let tick = 60; // a second of quiet before the first wave

  WAVE_TABLE.forEach((variants, wave) => {
    const chosen = variants[Math.floor(random() * variants.length)];

    chosen.forEach((unit, index) => {
      // `wave` is carried so the game can tell which spawns belong together —
      // calling a wave early has to move a whole wave, not one regiment.
      spawns.push({ tick: tick + index * WITHIN_WAVE_GAP, unit, wave });
    });

    tick += WAVE_GAP;
  });

  return spawns;
}

export const WAVE_COUNT = WAVE_TABLE.length;
