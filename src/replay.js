// Replays: everything needed to prove a score was really achieved.
//
// A run is fully described by the map, the seed and the list of inputs. That is
// the whole point of the fixed timestep and the recorded-input pipeline — a
// verifier re-runs the same simulation with the same inputs and must arrive at
// the same score. If it does not, the claim is false.
//
// A replay is a few hundred bytes. It is not a video, and it is not the score
// itself — the score in here is the CLAIM, and the verifier's job is to disagree
// with it when it is wrong.

/**
 * The version of the RULES, not of the file format.
 *
 * A replay is only inputs. What those inputs produce depends on every number in
 * the simulation, so the instant a balance change lands, an old replay stops
 * reproducing its own score — through no fault of the player who recorded it.
 * The verifier re-runs the current rules and compares, so without this check it
 * rejects an honest replay with "the replay does not produce the score it
 * claims", which reads as an accusation of cheating. It was measured: a replay
 * recorded on one wave table and checked against the next came back
 * `claimed 7297, actually 7097`.
 *
 * BUMP THIS whenever a change alters what a given set of inputs produces —
 * tower or unit numbers, the wave table, scoring, gold, map geometry. Anything
 * in `sim.js`, `towers.js`, `units.js`, `waves.js` or `maps.js`, in practice.
 * Bumping it does not break anything; failing to bump it silently turns honest
 * old scores into apparent forgeries.
 *
 * Scores are only comparable within a rules version. A ladder spanning two of
 * them is not one ladder.
 *
 *   1  the rule set the first on-chain score (5918) was recorded under
 *   2  creed rebalance: rout gold pays per man, Bloodthorn pierces, Hirelings
 *      replace Shieldwalls in three waves
 *   3  the Caltrop Field, a gate with a real health bar (200/240 rather than
 *      60/70, and the survival bonus rescaled to match), two more waves and a
 *      heavier back half, and a cap on Watchpost stacking
 *   4  area damage falls off across multiple targets, so packing the road no
 *      longer pays the defender
 *   5  a difficulty curve — late regiments are harder to break, slightly better
 *      armoured, and worth less gold — plus the Barrow-Wight, which comes apart
 *      into Shades when killed rather than when broken
 */
export const REPLAY_VERSION = 5;

/**
 * Was this replay recorded under the rules we are about to judge it by?
 * Kept separate from verification so a stale replay can be reported as stale
 * rather than as a lie.
 */
export function rulesMatch(replay) {
  const recorded = replay.v ?? 0;
  return {
    ok: recorded === REPLAY_VERSION,
    recorded,
    current: REPLAY_VERSION,
  };
}

export function makeReplay(sim) {
  return {
    v: REPLAY_VERSION,
    map: sim.map.id,
    seed: sim.seed,
    // The claim. A verifier recomputes this and refuses to trust it.
    claim: {
      score: sim.score,
      ticks: sim.tick,
      gateHealth: sim.gateHealth,
      routed: sim.routed,
      destroyed: sim.destroyed,
      leaked: sim.leaked,
      wavesCalled: sim.wavesCalled,
    },
    inputs: sim.inputs.map((i) =>
      i.type === "place"
        ? { t: i.tick, k: "p", w: i.tower, x: i.x, y: i.y }
        : { t: i.tick, k: "c" }
    ),
  };
}

/** Turn the compact form back into what the simulation expects. */
export function expandInputs(replay) {
  return replay.inputs.map((i) =>
    i.k === "p"
      ? { tick: i.t, type: "place", tower: i.w, x: i.x, y: i.y }
      : { tick: i.t, type: "call" }
  );
}

export function replayFilename(replay) {
  return `rout-${replay.map}-${replay.seed}-${replay.claim.score}.json`;
}
