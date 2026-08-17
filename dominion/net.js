// Lockstep — how two machines play the same match without trusting each other.
//
// Neither peer sends positions, health or gold. They send COMMANDS, both run the
// identical simulation, and both arrive at the identical state. That is only
// possible because the simulation was built deterministic from the first line:
// fixed ticks, no clock, no unseeded randomness, and integer pathfinding with
// total orderings everywhere. This file is the payoff for that discipline.
//
// The protocol, which is the classic one and is small on purpose:
//
//   * Time is divided into ticks. A tick may only run once BOTH peers' commands
//     for it have arrived.
//   * Commands issued now are scheduled for tick + INPUT_DELAY. That delay is
//     what hides the network: you get a few frames to deliver a packet before
//     anyone stalls. It is also why RTS games feel slightly "heavy" to click —
//     the order is real the moment you give it, it just lands shortly after.
//   * Every peer sends a frame for every tick even when it did nothing. Silence
//     is indistinguishable from a dropped packet, so "I did nothing" has to be
//     said out loud.
//   * Peers exchange a CHECKSUM of the whole simulation periodically. If they
//     ever disagree, the match is dead and both sides must be told immediately.
//
// That last point is the one people skip and then spend a month debugging. A
// desync that is not detected is not a desync, it is two players having
// different, confident, contradictory experiences — and on a ladder with money
// attached it is indistinguishable from cheating.

import {
  step, queueBuild, queueTrain, queueOrder, queueAttack, queueHold, queueRally,
  queueErect, queueConvert, queueDisband, queueResign, queueRaise, queueForm,
  queueFormation, queueStance, queuePatrol, queueGuard,
  queueDiplomacy, queueTribute, queueChat, queueCast,
  RESOURCES,
} from "./sim.js";

/** Ticks between issuing a command and it taking effect. ~200ms at 20Hz. */
export const INPUT_DELAY = 4;

/** How often the two peers compare notes. */
export const CHECKSUM_EVERY = 20;

// --- Checksum ----------------------------------------------------------------

/**
 * A hash of everything that matters, over the RAW BITS of every float.
 *
 * Deliberately not rounded first. Rounding would hide exactly the divergence
 * this exists to catch — two engines disagreeing in the last bit of a position
 * is precisely how a desync starts, and it stays invisible for thousands of
 * ticks before a unit takes a different turn and the matches separate. Hash the
 * bits and it is caught on the tick it happens.
 */
const scratch = new Float64Array(1);
const scratchBits = new Uint32Array(scratch.buffer);

export function checksum(sim) {
  let h = 0x811c9dc5;

  const mixInt = (n) => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const mixFloat = (f) => {
    scratch[0] = f;
    mixInt(scratchBits[0]);
    mixInt(scratchBits[1]);
  };

  mixInt(sim.tick);
  mixInt(sim.over ? 1 : 0);
  mixInt(sim.winner === null ? -1 : sim.winner);
  mixInt(sim.nextId);

  for (const p of sim.players) {
    // Which garland, and whether it has set. A path changes what every building
    // and every unit the player owns is worth, so a drift here is the match.
    mixInt(p.path ? hashName(p.path) : -1);
    mixInt(p.pathLocked ? 1 : 0);
    // Every resource, not just the one that used to exist. A peer whose timber
    // drifted would look identical for as long as nobody bought anything that
    // needed timber, and then diverge at a moment with no apparent cause.
    mixFloat(p.gold);
    mixFloat(p.timber ?? 0);
    mixFloat(p.food ?? 0);
    mixFloat(p.goldRate ?? 1);
    mixInt(p.out ? 1 : 0);
  }

  // Order matters and is part of the state: two peers whose arrays have drifted
  // out of order have already diverged, even if the contents match.
  for (const b of sim.buildings) {
    mixInt(b.id);
    mixInt(b.owner);
    mixInt(b.tx);
    mixInt(b.ty);
    // x/y are derived from tx/ty at placement and cannot drift on their own, so
    // hashing them buys nothing in theory. They are hashed anyway: a desync
    // detector should assert on everything it can reach cheaply, because the
    // whole class of bug it exists to catch is "a thing I was sure could not
    // diverge, diverged".
    mixFloat(b.x);
    mixFloat(b.y);
    mixFloat(b.hp);
    mixInt(b.queue.length);
    mixInt(b.buildTimer | 0);
    mixInt(b.rally ? b.rally.tx * 1000 + b.rally.ty : -1);
    // What a depot is holding. Gold sitting in a warehouse is not in anyone's
    // treasury yet, so it is invisible to the player-gold hash above — and it is
    // computed every tick from peasants arriving and carts leaving, which is
    // exactly the kind of fresh arithmetic a desync detector exists for.
    // The hall's tier, and how far along the next one is. Both are computed
    // every tick from peasants standing on it, and the tier changes what every
    // unit the player owns is worth — a drift here is the whole match.
    mixInt(b.tier ?? 0);
    mixFloat(b.raising ? b.raising.work : -1);
    mixInt(b.raising ? b.raising.to : -1);
    mixFloat(b.maxHp);
    mixFloat(b.store.gold);
    mixFloat(b.store.timber);
    mixFloat(b.store.food);
  }

  // Foundations. Easy to forget because they are new and short-lived, and
  // exactly the wrong thing to leave out: how far a building has been raised is
  // a number both peers compute every tick from how many peasants are standing
  // on it, which is the freshest and least-tested arithmetic in the simulation.
  for (const s of sim.sites) {
    mixInt(s.id);
    mixInt(s.owner);
    mixInt(s.tx);
    mixInt(s.ty);
    mixFloat(s.work);
    mixFloat(s.hp);
    mixInt(s.builders | 0);
  }

  for (const u of sim.units) {
    mixInt(u.id);
    mixInt(u.owner);
    mixFloat(u.x);
    mixFloat(u.y);
    mixFloat(u.hp);
    mixFloat(u.maxHp);
    // Which battalion he stands in and how many shots he has left. A band shares
    // damage, so a drift in membership changes where every blow in the fight
    // lands; ammunition decides whether he shoots at all.
    mixInt(u.band ?? -1);
    mixInt(u.ammo ?? 0);
    mixInt(u.resupply ?? 0);
    mixInt(u.cooldown | 0);

    // Everything a unit INTENDS, not just where it is.
    //
    // This used to hash `u.goal`, a field that no longer exists — so it mixed a
    // constant and the detector was blind to every order in the game. Two peers
    // can agree on every position for many ticks while disagreeing about who is
    // mining what, and only diverge visibly once the gold lands. A desync
    // detector that only notices after the damage is done is worth very little
    // in a match with anything at stake.
    mixInt(u.order ? u.order.tx * 1000 + u.order.ty : -1);
    mixInt(u.chaseId ?? -1);
    mixInt(u.job ? JOB_CODE[u.job.kind] ?? 0 : -1);
    // An `erect` job has neither an id nor a tile, so the old expression came
    // out NaN and hashed the same for every sapper in the game. Each job kind
    // is asked for the number it actually has.
    mixInt(
      !u.job ? -1
        : u.job.id !== undefined ? u.job.id
          : u.job.tx !== undefined ? u.job.tx * 1000 + u.job.ty
            : JOB_CODE[u.job.kind] ?? 0
    );
    // How far along a sapper is with an engine, and which engine. Both are
    // computed every tick on both peers, so both must be watched.
    mixInt(u.job && u.job.work !== undefined ? u.job.work : -1);
    mixInt(u.job && u.job.type ? hashName(u.job.type) : -1);
    mixFloat(u.carrying ?? 0);
    // WHAT he is carrying, not just how much. Two peers can agree that a peasant
    // is holding twelve of something and disagree about whether it is grain.
    mixInt(RESOURCES.indexOf(u.carryKind ?? "gold"));
    mixInt(u.mineTimer | 0);

    // The whole list of waiting orders, not just the one in flight. A queue that
    // drifted apart would look identical for as long as the unit was busy with
    // its first step and then send two peers' armies to different places — the
    // longest-fused desync this game can produce, and the one most likely to be
    // blamed on the network rather than on the rules.
    mixInt(u.plan ? u.plan.length : 0);
    for (const step of u.plan ?? []) {
      mixInt(step.targetId ?? -1);
      mixInt(step.siteId ?? -1);
      mixInt(step.tx === undefined ? -1 : step.tx * 1000 + step.ty);
    }
  }

  return h >>> 0;
}

/** Stable numbers for job kinds — a string cannot be mixed into the hash. */
const JOB_CODE = {
  mine: 1, drop: 2, build: 3, erect: 4, convert: 5, collect: 6, deliver: 7,
  repair: 8, fell: 9, harvest: 10, raise: 11,
};

/** A stable small integer for a unit-type name, so a string can be mixed in. */
function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return h;
}

// --- Commands ----------------------------------------------------------------
//
// A command is plain JSON, because it goes down a wire. Applying one is the ONLY
// way either peer may touch the simulation.

export function applyCommand(sim, owner, cmd) {
  switch (cmd.k) {
    case "b":
      return queueBuild(sim, owner, cmd.type, cmd.tx, cmd.ty, cmd.units ?? null, !!cmd.q);
    case "t":
      return queueTrain(sim, owner, cmd.building, cmd.unit);
    case "o":
      return queueOrder(sim, owner, cmd.units, cmd.tx, cmd.ty, !!cmd.q);
    case "a":
      return queueAttack(sim, owner, cmd.units, cmd.target, !!cmd.q);
    case "h":
      return queueHold(sim, owner, cmd.units);
    case "r":
      return queueRally(sim, owner, cmd.building, cmd.tx, cmd.ty);
    case "e":
      return queueErect(sim, owner, cmd.sapper, cmd.unit);
    case "c":
      return queueConvert(sim, owner, cmd.witch, cmd.target);
    case "d":
      return queueDisband(sim, owner, cmd.units);
    case "q":
      return queueResign(sim, owner);
    case "u":
      return queueRaise(sim, owner, cmd.units ?? null);
    case "g":
      return queueForm(sim, owner, cmd.units);
    case "formation":
      return queueFormation(sim, owner, cmd.units, cmd.formation);
    case "stance":
      return queueStance(sim, owner, cmd.units, cmd.stance);
    case "patrol":
      return queuePatrol(sim, owner, cmd.units, cmd.tx, cmd.ty);
    case "guard":
      return queueGuard(sim, owner, cmd.units, cmd.targetId);
    case "dip":
      return queueDiplomacy(sim, owner, cmd.target, cmd.stance);
    case "trib":
      return queueTribute(sim, owner, cmd.target, cmd.resource, cmd.amount);
    case "chat":
      return queueChat(sim, owner, cmd.text, cmd.target);
    case "cast":
      return queueCast(sim, owner, cmd.unit, cmd.ability, cmd.tx, cmd.ty, cmd.target);
    default:
      return { ok: false, reason: "unknown command" };
  }
}

export const cmd = {
  // `q` is Ctrl-held: append rather than replace. It MUST travel with the
  // command — a modifier read off the local keyboard and applied locally would
  // give the two peers different orders from the same click.
  build: (type, tx, ty, units = null, q = false) => ({ k: "b", type, tx, ty, units: units ? [...units] : null, q }),
  train: (building, unit) => ({ k: "t", building, unit }),
  order: (units, tx, ty, q = false) => ({ k: "o", units: [...units], tx, ty, q }),
  attack: (units, target, q = false) => ({ k: "a", units: [...units], target, q }),
  hold: (units) => ({ k: "h", units: [...units] }),
  rally: (building, tx, ty) => ({ k: "r", building, tx, ty }),
  erect: (sapper, unit) => ({ k: "e", sapper, unit }),
  convert: (witch, target) => ({ k: "c", witch, target }),
  disband: (units) => ({ k: "d", units: [...units] }),
  resign: () => ({ k: "q" }),
  // Raising the hall a tier. Carries the selection for the same reason `build`
  // does: the men you had picked are the men who do the work.
  raise: (units = null) => ({ k: "u", units: units ? [...units] : null }),
  form: (units) => ({ k: "g", units: [...units] }),
  formation: (units, formation) => ({ k: "formation", units: [...units], formation }),
  stance: (units, stance) => ({ k: "stance", units: [...units], stance }),
  patrol: (units, tx, ty) => ({ k: "patrol", units: [...units], tx, ty }),
  guard: (units, targetId) => ({ k: "guard", units: [...units], targetId }),
  diplomacy: (target, stance) => ({ k: "dip", target, stance }),
  tribute: (target, resource, amount) => ({ k: "trib", target, resource, amount }),
  chat: (text, target = -1) => ({ k: "chat", text, target }),
  cast: (unit, ability, tx = 0, ty = 0, target = null) => ({ k: "cast", unit, ability, tx, ty, target }),
};

// --- The engine --------------------------------------------------------------

/**
 * Drive a simulation in lockstep with one remote peer.
 *
 * `send` is any function that gets a JSON-able frame to the other side. The
 * engine knows nothing about WebRTC, sockets or servers, which is what lets the
 * whole protocol be tested headlessly against a fake transport — and a lockstep
 * protocol that has only ever been tested through a real network is a protocol
 * nobody has actually tested.
 */
export function createLockstep({
  sim,
  localPlayer,
  send,
  // Every seat in the match, including your own. Defaults to a duel, which is
  // what every caller wanted before there were three-seat maps.
  seats = [0, 1],
  inputDelay = INPUT_DELAY,
  checksumEvery = CHECKSUM_EVERY,
  onDesync = null,
  onStall = null,
  onLost = null,
}) {
  // WHO IS STILL PLAYING, WHICH IS NOT THE SAME AS WHO STARTED.
  //
  // This used to be `const remotePlayer = localPlayer === 0 ? 1 : 0` and a frame
  // shaped `{ 0: null, 1: null }` — two seats, forever, in four separate places.
  // With three, a tick may only run once EVERY live seat has spoken, and a seat
  // that has gone must stop being waited for or the survivors stall on somebody
  // who is not coming back.
  const live = new Set(seats);
  // Seats whose chair is being held while they reconnect. Not waited for, not
  // eliminated — see `away`.
  const asleep = new Set();
  const quietFrom = new Map();

  // tick -> { seat: [cmd] }
  const frames = new Map();

  // tick -> checksum each seat claimed, and tick -> our own.
  //
  // BOTH sides are kept because a checksum almost never arrives while you are
  // still on the tick it describes — the peers reach the same tick at slightly
  // different wall-clock moments, so each one's sum lands a little after the
  // other has moved on. Comparing only at the moment of computing your own
  // means comparing against an empty map, every time, forever. The detector
  // looked like it worked and caught nothing.
  const remoteSums = new Map();
  const localSums = new Map();
  const SUM_HISTORY = 200; // ticks; plenty for any sane connection

  let pending = [];        // commands issued since the last frame was sent
  let sentUpTo = -1;       // last tick we have published a frame for
  let desynced = null;
  let stalledSince = null;

  /** The last tick each seat has given us commands for. */
  const heardThrough = new Map(seats.map((s) => [s, -1]));

  // How far a resumed match has been reconstructed to. Below this mark a seat
  // with no recorded frame did not go silent — it simply had nothing to say, and
  // an empty frame is the truth. See `catchUp`.
  let emptyThrough = -1;

  function frameFor(tick) {
    let f = frames.get(tick);
    if (!f) {
      f = {};
      for (const seat of seats) f[seat] = tick <= emptyThrough ? [] : null;
      frames.set(tick, f);
    }
    return f;
  }

  /** Queue a local command. It lands `inputDelay` ticks from now, on both peers. */
  function issue(command) {
    pending.push(command);
  }

  /**
   * Publish our commands for the tick they are scheduled to run on.
   *
   * Called once per tick, ALWAYS, including when nothing happened — see the
   * note about silence at the top.
   */
  function publish() {
    const target = sim.tick + inputDelay;

    // Nothing new to say yet — the simulation has not advanced since the last
    // frame went out, so every tick up to `target` is already published.
    //
    // Returning EARLY, before touching `pending`, is the whole point. This used
    // to fall through to the loop (which did nothing, the range being empty) and
    // then clear `pending` anyway, so any command issued while waiting on the
    // other peer was silently thrown away. It was caught by two browsers playing
    // a real match: a mine was ordered on legal, empty ground and simply never
    // appeared, on both peers, with no error — because publish ran twice between
    // ticks while the network caught up. With real jitter, orders would just
    // occasionally not happen.
    if (target <= sentUpTo) return;

    for (let t = sentUpTo + 1; t <= target; t++) {
      const commands = t === target ? pending : [];
      frameFor(t)[localPlayer] = commands;
      // `keep` marks the handful of frames that carry orders. Almost every frame
      // in a match is empty — twenty a second per player, and a whole twenty
      // minute game holds a few hundred real commands — so a relay that records
      // only these can hold an entire match in a few hundred entries instead of
      // seventy thousand. It is what makes reconnecting affordable, and the
      // relay still never looks inside `data`; it honours a flag.
      send({ type: "frame", tick: t, commands }, { keep: commands.length > 0, tick: t });
    }
    pending = [];
    sentUpTo = target;
  }

  function receive(message, from = null) {
    if (!message) return;

    if (message.type === "frame") {
      // `from` is the relay's own record of which socket sent this, never
      // anything the sender claimed, so a peer cannot post commands as somebody
      // else. It falls back to "the other one" for a duel, which is what the
      // tests and the two-seat path have always assumed.
      const seat = from ?? seats.find((s) => s !== localPlayer);
      if (!live.has(seat)) return;
      frameFor(message.tick)[seat] = message.commands ?? [];
      if (message.tick > (heardThrough.get(seat) ?? -1)) {
        heardThrough.set(seat, message.tick);
      }
      return;
    }

    if (message.type === "sum") {
      const seat = from ?? seats.find((s) => s !== localPlayer);
      if (!live.has(seat)) return;
      let bySeat = remoteSums.get(message.tick);
      if (!bySeat) remoteSums.set(message.tick, (bySeat = new Map()));
      bySeat.set(seat, message.sum >>> 0);
      compare(message.tick);
      return;
    }
  }

  /**
   * A seat has gone quiet but its chair is being held.
   *
   * DISTINCT FROM `lost`, AND THE DIFFERENCE IS THE WHOLE FEATURE. `lost` ends
   * that player's match — their hall falls, their army goes. `away` says only
   * "stop waiting for them": their frames run empty from the first tick they
   * never published, the rest of the match carries on at full speed, and if they
   * get back before the grace period expires they resume where everyone else is.
   *
   * The tick is computed exactly as `lost` computes it, and is identical on every
   * peer for exactly the same reason — one ordered relay stream means everybody
   * heard the same last word from them.
   */
  function away(seat) {
    if (!live.has(seat) || seat === localPlayer) return;
    live.delete(seat);
    asleep.add(seat);

    const through = heardThrough.get(seat) ?? -1;
    const from = Math.max(through + 1, sim.tick + 1);
    for (const [tick, f] of frames) {
      if (tick >= from && f[seat] === null) f[seat] = [];
    }
    quietFrom.set(seat, from);
    return from;
  }

  /**
   * They are back. Wait for them again — but only from a tick they can still
   * publish for, which is the future, not the gap they were absent for.
   *
   * The gap stays empty on every peer, including theirs: they rebuild it from
   * the same log everybody else played through.
   */
  function rejoin(seat) {
    if (!asleep.has(seat)) return;
    asleep.delete(seat);
    live.add(seat);
    heardThrough.set(seat, Math.max(heardThrough.get(seat) ?? -1, sim.tick));
    // Everything up to now is settled and empty for them. Anything above is
    // theirs to fill again.
    for (const [tick, f] of frames) {
      if (tick <= sim.tick && f[seat] === null) f[seat] = [];
    }
    quietFrom.delete(seat);
  }

  /**
   * Rebuild a match in progress from the relay's record of it.
   *
   * `log` is every frame that carried orders — `{ seat, tick, commands }`, in the
   * order the relay saw them. `through` is the highest tick anybody has published
   * for. Together they are a COMPLETE description of the match, because a tick
   * with no recorded frame was empty for everyone, and the simulation is a pure
   * function of its seed and its commands. That property was built for replays
   * and anti-cheat; reconnecting is the same feature wearing a different hat.
   *
   * Returns the tick reached. Measured at 0.05–0.08 ms/tick, a twenty minute
   * match reconstructs in about two seconds of CPU.
   */
  function catchUp(log, through) {
    // ORDER MATTERS HERE, AND IT COST A REBUILD THAT REPLAYED NOTHING.
    //
    // `emptyThrough` has to be set FIRST. Applying the log first creates frame
    // objects while the mark is still unset, so every seat WITHOUT an entry at
    // that tick is initialised to null — a frame nobody will ever fill, because
    // that tick is long past. `ready()` then refuses at the first logged tick and
    // the catch-up stops at zero, having faithfully replayed nothing at all.
    emptyThrough = through;

    for (const entry of log ?? []) {
      if (!seats.includes(entry.seat)) continue;
      frameFor(entry.tick)[entry.seat] = entry.commands ?? [];
    }

    for (const seat of seats) heardThrough.set(seat, through);
    // We are not going to republish the past. Everyone else already played it.
    sentUpTo = through;
    pending = [];

    let guard = through + 16;
    while (sim.tick < through && guard-- > 0) {
      if (!tryAdvance()) break;
    }
    return sim.tick;
  }

  /**
   * A seat has gone, and every remaining peer must drop it on the SAME tick.
   *
   * The tick is the last one they published, plus one. That is identical on
   * every survivor because all traffic goes through one relay: a single ordered
   * stream, fanned out reliably, so everybody received the same last frame from
   * the departing seat before the relay told them it was gone. This is a
   * property the old peer-to-peer mesh did not have — with two direct
   * connections there was no shared ordering for the survivors to agree on, and
   * "when did they leave" would have been a negotiation.
   *
   * Ticks the seat never published are filled with empty commands, so everyone
   * plays out the same last moments rather than freezing on a missing frame.
   */
  function lost(seat) {
    // A seat that is merely ASLEEP still has to be losable — that is what
    // happens when a grace period expires and they never came back. Checking
    // only `live` made a held chair unresignable, so the survivors would have
    // waited out the rest of the match for somebody who was never returning.
    if (!live.has(seat) && !asleep.has(seat)) return;
    // Read BEFORE clearing: if this seat was held for a while first, it leaves
    // at the moment it went quiet, not the moment we gave up on it. Otherwise
    // two survivors noticing the timeout a tick apart would resign it a tick
    // apart, and disagree for ever after.
    const quietAt = quietFrom.get(seat) ?? null;
    live.delete(seat);
    asleep.delete(seat);
    quietFrom.delete(seat);

    // The first tick they never published is where they leave. Every survivor
    // computes the same number, because everybody received the same frames from
    // them in the same order — and nobody can have run past it, since a tick
    // cannot run without their commands.
    const through = heardThrough.get(seat) ?? -1;
    // Clamped to a tick that has not run. A peer who vanished before publishing
    // anything has `through === -1`, and tick 0 is the starting state that
    // `tryAdvance` never runs — so their resignation would have been filed
    // against a moment that never comes and they would have sat on the board
    // for ever, unwaited-for and undefeatable. Every survivor still computes the
    // same number, because none of them can have advanced past `through`.
    const quits = quietAt ?? Math.max(through + 1, sim.tick + 1);
    frameFor(quits)[seat] = [{ k: "q" }];
    for (const [tick, f] of frames) {
      if (tick > quits && f[seat] === null) f[seat] = [];
    }
    // Anything still to come is theirs no longer.
    for (const bySeat of remoteSums.values()) bySeat.delete(seat);

    if (onLost) onLost(seat, quits);
  }

  /** Compare the sums for a tick, once every live seat has spoken for it. */
  function compare(tick) {
    if (desynced) return;
    const mine = localSums.get(tick);
    const theirs = remoteSums.get(tick);
    if (mine === undefined || !theirs) return;

    // Wait for everyone. With three seats, two agreeing and one differing is
    // still a dead match, and comparing against the first to answer would let
    // the third slip through.
    const others = [...live].filter((s) => s !== localPlayer);
    if (!others.every((s) => theirs.has(s))) return;

    localSums.delete(tick);
    remoteSums.delete(tick);

    for (const seat of others) {
      if (theirs.get(seat) !== mine) {
        desynced = { tick, mine, theirs: theirs.get(seat), seat };
        if (onDesync) onDesync(desynced);
        return;
      }
    }
  }

  /** Do we have everything needed to run the next tick? */
  function ready() {
    const next = sim.tick + 1;
    const f = frames.get(next);
    // No frame object at all, but the tick is below the rebuilt mark: nobody
    // said anything on it, which during a catch-up is a fact and not a wait.
    // Reading `frames` directly rather than through `frameFor` is what made a
    // rebuild stop at tick zero — every tick without a logged order looked like
    // a tick still to come.
    if (!f) return next <= emptyThrough;
    for (const seat of live) if (!f[seat]) return false;
    return true;
  }

  /**
   * Advance one tick once every live seat's commands have arrived.
   * Returns true if the simulation moved.
   */
  function tryAdvance(now = 0) {
    if (desynced || sim.over) return false;

    if (!ready()) {
      // Waiting on the network. Report it so the interface can say so rather
      // than simply appearing frozen, which is the single most confusing thing
      // a lockstep game can do to a player.
      if (stalledSince === null) stalledSince = now;
      if (onStall) onStall(now - stalledSince);
      return false;
    }
    stalledSince = null;

    const next = sim.tick + 1;
    const f = frameFor(next);

    // Apply every seat's commands in ASCENDING SEAT ORDER, not arrival order.
    // Arrival order is a property of the network and would differ per peer,
    // which is a desync by construction.
    for (const owner of seats) {
      for (const command of f[owner] ?? []) applyCommand(sim, owner, command);
    }

    step(sim);
    frames.delete(next);

    if (sim.tick % checksumEvery === 0) {
      const mine = checksum(sim);
      localSums.set(sim.tick, mine);
      send({ type: "sum", tick: sim.tick, sum: mine });
      compare(sim.tick);

      // Forget anything too old to still be in flight, so neither map grows
      // without bound over a long match.
      const cutoff = sim.tick - SUM_HISTORY;
      for (const t of localSums.keys()) if (t < cutoff) localSums.delete(t);
      for (const t of remoteSums.keys()) if (t < cutoff) remoteSums.delete(t);
    }

    return true;
  }

  return {
    issue,
    publish,
    receive,
    lost,
    away,
    rejoin,
    catchUp,
    tryAdvance,
    ready,
    get live() {
      return [...live];
    },
    get asleep() {
      return [...asleep];
    },
    get desynced() {
      return desynced;
    },
    get waiting() {
      return !ready();
    },
  };
}
