// Music.
//
// The tracks in art/gen_music.py were always keyed to the three creeds — the
// comment there says the point is "so the music can follow the alignment the
// player is drifting toward" — and until now nothing played them. This is that.
//
// Two rules, and they are the same rules the sound effects follow:
//
//   1. **Nothing here can reach the simulation.** This module only ever READS
//      `sim.devotion` and `sim.over`. A muted game and a loud one play out
//      identically, and a replay is unaffected, because music is downstream of
//      the battle and never an input to it.
//   2. **A missing file is not an error.** Audio is large and generated, so any
//      track may be absent on a fresh checkout. Every load failure is swallowed
//      and the game simply runs quieter — exactly how assets.js treats sprites.
//
// Plain <audio> elements rather than Web Audio: these are minutes-long streams,
// and decoding them into memory to gain nothing would be silly. Crossfades are
// done on `.volume`, which is all this needs.

const TRACKS = {
  // The title theme. Original audio generated for this project and owned by it,
  // dropped in alongside the older menu bed rather than replacing it — the two
  // are different rooms, and `title` is the one the main menu wants.
  title: "./assets/audio/title.m4a",
  // One bed per path, and a tenser neutral one for before you have chosen.
  vanashira: "./assets/audio/path_vanashira.mp3",
  matrika: "./assets/audio/path_matrika.mp3",
  kankala: "./assets/audio/path_kankala.mp3",
  field: "./assets/audio/siege_bed.mp3",
  menu: "./assets/audio/menu.ogg",
  siege: "./assets/audio/siege.ogg",
  order: "./assets/audio/order.ogg",
  wild: "./assets/audio/wild.ogg",
  forge: "./assets/audio/forge.ogg",
  victory: "./assets/audio/victory.ogg",
  defeat: "./assets/audio/defeat.ogg",
};

// Stingers play once over the top of whatever is going on and then stop. The
// bed underneath ducks rather than cutting, so a win does not feel like a
// dropped needle.
const ONE_SHOT = new Set(["victory", "defeat"]);

/**
 * The score's level, 0..1, multiplied into every bed and stinger.
 *
 * Music and effects want separate controls: a player who wants to hear the game
 * but not the soundtrack is the common case, and one master slider cannot serve
 * them. Held apart from `muted` so switching the score off and on returns to the
 * level the player chose.
 */
let musicLevel = 1;

export function setMusicVolume(level) {
  musicLevel = Math.max(0, Math.min(1, level));
  for (const [id, el] of players) {
    if (id === current) el.volume = bedVolume();
    else if (id === stinger) el.volume = muted ? 0 : 0.55 * musicLevel;
  }
}

export function musicVolume() {
  return musicLevel;
}

const BED_VOLUME = 0.34;
// The title theme is mixed hotter than the in-match beds on purpose: it plays
// against a still menu with nothing competing, where the battle music plays
// under horns, hits and collapsing buildings.
const TITLE_VOLUME = 0.40;
const DUCKED_VOLUME = 0.10;
const FADE_MS = 900;

const players = new Map();
let current = null;      // id of the bed that should be playing
let stinger = null;
let muted = false;
let fadeTimer = null;

function player(id) {
  if (players.has(id)) return players.get(id);

  const src = TRACKS[id];
  if (!src) return null;

  const el = new Audio();
  el.src = src;
  el.loop = !ONE_SHOT.has(id);
  el.volume = 0;
  el.preload = "auto";
  // A track that is not there is normal, not broken. Log it once and carry on.
  el.addEventListener("error", () => {
    if (!el.dataset.warned) {
      el.dataset.warned = "1";
      console.warn(`[music] missing track: ${src}`);
    }
  });

  players.set(id, el);
  return el;
}

/** Try to play, and do not let an autoplay refusal throw into the game loop. */
function attempt(el) {
  const promise = el.play();
  if (promise && typeof promise.catch === "function") promise.catch(() => {});
}

function fadeTo(el, target, ms = FADE_MS) {
  if (!el) return;
  const from = el.volume;
  const startedAt = performance.now();

  const tickFade = (now) => {
    const t = Math.min(1, (now - startedAt) / ms);
    el.volume = Math.max(0, Math.min(1, from + (target - from) * t));
    if (t < 1) requestAnimationFrame(tickFade);
    else if (target === 0) el.pause();
  };
  requestAnimationFrame(tickFade);
}

function bedVolume(id = current) {
  if (muted) return 0;
  if (stinger) return DUCKED_VOLUME * musicLevel;
  return (id === "title" ? TITLE_VOLUME : BED_VOLUME) * musicLevel;
}

/** Crossfade the background bed to `id`. Does nothing if it is already playing. */
function playBed(id) {
  if (current === id) return;

  const outgoing = current ? players.get(current) : null;
  if (outgoing) fadeTo(outgoing, 0);

  current = id;
  const el = player(id);
  if (!el) return;

  el.currentTime = el.currentTime || 0;
  attempt(el);
  fadeTo(el, bedVolume());
}

export function menuMusic() {
  // The title theme first. If the file is absent — audio is generated and may
  // not be in a fresh checkout — `player()` returns null, `playBed` falls
  // through, and the older menu bed covers it. A missing track is quiet, never
  // broken.
  playBed(TRACKS.title ? "title" : "menu");
}

/**
 * A battle has begun. The opening bed is the neutral siege theme — you have not
 * built anything yet, so you are not anyone yet.
 */
export function startMusic() {
  clearStinger();
  playBed("siege");
}

function clearStinger() {
  if (!stinger) return;
  const el = players.get(stinger);
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  stinger = null;
  if (fadeTimer) clearTimeout(fadeTimer);
  fadeTimer = null;
}

function playStinger(id) {
  if (stinger === id) return;
  clearStinger();

  const el = player(id);
  if (!el) return;

  stinger = id;
  el.currentTime = 0;
  el.volume = muted ? 0 : 0.55;
  attempt(el);

  // Duck the bed under it, and bring it back when the stinger is done.
  const bed = current ? players.get(current) : null;
  if (bed) fadeTo(bed, bedVolume(), 400);
}

/**
 * Called every frame. Picks the bed from what the player has actually built,
 * which is the same thing the alignment readout uses — so the music agrees with
 * the label on screen without either knowing about the other.
 */
export function updateMusic(sim) {
  if (!sim) return;

  if (sim.over) {
    playStinger(sim.gateHealth > 0 ? "victory" : "defeat");
    return;
  }

  // Whoever you have given the most buildings to. Ties fall back to the neutral
  // siege bed, which is the honest answer to "you are two things at once".
  let leader = null;
  let best = 0;
  let tied = false;

  for (const [creed, count] of Object.entries(sim.devotion)) {
    if (count > best) {
      best = count;
      leader = creed;
      tied = false;
    } else if (count === best && count > 0) {
      tied = true;
    }
  }

  // Two buildings before the music commits. One is an accident; two is a choice.
  const bed = !leader || tied || best < 2 ? "siege" : leader.toLowerCase();
  playBed(bed);
}

/**
 * Which bed is currently playing, and which stinger if any.
 *
 * Purely for inspection. The players are detached <audio> objects that never
 * enter the DOM, so without this there is no way to check from outside that the
 * music is following the alignment it claims to follow — and "the music is
 * wrong" is exactly the kind of bug nobody notices until someone else plays it.
 */
/**
 * A result stinger, without knowing anything about whose simulation it is.
 *
 * `updateMusic` reads Warden's shape — `sim.devotion`, `sim.gateHealth` — which
 * is right for Warden and useless to Dominion, whose match ends when a manor
 * falls and which has no creeds at all. Rather than teach this module a second
 * game's data, both games can say "that one won" and the module stays ignorant.
 */
export function endMusic(won) {
  playStinger(won ? "victory" : "defeat");
}

/** The neutral bed, for a game with no alignment to follow. */
export function siegeMusic() {
  playBed("siege");
}

/**
 * THE MATCH FOLLOWS THE PATH YOU TOOK.
 *
 * Dominion played one bed — `siege` — from the first tick to the last, for
 * matches that now run twenty minutes. This file's own opening comment says the
 * three tracks exist "so the music can follow the alignment the player is
 * drifting toward", and until now nothing did that in this mode: the beds were
 * keyed to Warden's creeds, which no longer exist.
 *
 * The three paths ARE that alignment, and there are exactly three beds. Neutral
 * siege until a path-house stands, then the bed that belongs to the garland —
 * so the moment you commit is a moment you can hear, which is the right weight
 * for a choice that closes two of three doors.
 *
 * Reuses the existing tracks rather than waiting for new ones. `order` is the
 * steady one and goes to the steadfast; `wild` is the restless one and goes to
 * the kinetic; `forge` is the working one and goes to the house of engines.
 */
// Original tracks, written for these three paths rather than borrowed from
// Warden's creeds. The old order/wild/forge beds stay in TRACKS for Warden.
const PATH_BEDS = {
  vanashira: "vanashira",
  matrika: "matrika",
  kankala: "kankala",
};

export function pathMusic(path) {
  playBed(path ? (PATH_BEDS[path] ?? "field") : "field");
}

export function musicState() {
  return { bed: current, stinger };
}

export function setMusicMuted(value) {
  muted = value;
  for (const [id, el] of players) {
    if (id === current) el.volume = bedVolume();
    else if (id === stinger) el.volume = muted ? 0 : 0.55 * musicLevel;
  }
}
