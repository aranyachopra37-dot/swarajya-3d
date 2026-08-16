// Sound, synthesised in the browser. No files, no downloads, no CDN.
//
// WHY SYNTHESIS RATHER THAN GENERATED AUDIO FILES
//
// There is no text-to-audio model installed locally (the folders exist but are
// empty; the only audio asset is LTX's audio VAE, which is a piece of a video
// pipeline, not an effects generator). But even with one, this is the better
// choice for these particular sounds:
//
//   * The sounds a tower defense needs — a bell toll, a cannon crack, a bow
//     release, the roar of a line breaking — are physically simple. A bell IS a
//     stack of inharmonic partials decaying at different rates. Synthesis does
//     not approximate that, it does the actual thing.
//   * Every sound varies for free. A cannon fired twenty times sounds slightly
//     different each time rather than betraying itself as one sample on repeat,
//     and a Reliquary tolls deeper than a Bell Tower because the pitch is a
//     parameter, not a second file.
//   * Zero bytes, which keeps the per-player serving cost at nothing.
//
// Generated audio would be worth it for an ambient music bed or voice lines.
// It is not worth it for impacts.
//
// Nothing here can affect the game. Sound cues are raised by the simulation and
// drained here; a muted battle and a loud one play out identically.

let ctx = null;
let master = null;
let muted = false;

/**
 * How loud the effects are, 0..1.
 *
 * A mute button is a blunt instrument: the honest complaint about game audio is
 * almost never "I want silence", it is "this is louder than the thing I am
 * listening to". A level keeps the cues you want to hear — a building
 * finishing, a fight starting — without them competing with the music or with
 * whatever else is playing.
 *
 * Kept separate from `muted` so that turning the sound off and on again returns
 * you to YOUR level rather than to a default somebody else chose.
 */
let sfxLevel = 0.9;

// A crowded frame can raise a dozen cues at once. Without a cap they stack into
// a wall of noise and clip.
const MAX_PER_FRAME = 4;

/**
 * RECORDED CUES, LAYERED OVER THE SYNTHESISED ONES.
 *
 * The note above still stands for impacts, and the synth voices stay: they vary
 * for free and cost nothing. But a handful of original recorded effects were
 * generated for this project, and for the heavier moments — a building going
 * up, a company mustering, a battle won — a real sample has a body that three
 * oscillators do not.
 *
 * So a cue with a sample plays the sample; a cue without one falls through to
 * the synth voice exactly as before. Nothing here can fail loudly:
 *
 *   * a file that will not fetch is skipped, permanently, after one warning;
 *   * a file that will not decode is skipped the same way;
 *   * a cue with no sample and no voice is simply not played.
 *
 * A MISSING AUDIO FILE MUST NEVER CRASH THE GAME. Audio is generated and large,
 * so a fresh checkout may not have any of it, and the game has to run silent
 * rather than not run.
 */
/**
 * A CUE MUST BE SHORT, AND THE FIRST SET WAS NOT.
 *
 * The original five recordings were every one of them 2.02 seconds long. That is
 * fine for a victory sting, which happens once, and completely wrong for
 * `trained`, which fires every time a peasant appears — the reported experience
 * was "too loud and long, feels like some gun", and that is exactly what two
 * seconds of audio every few seconds sounds like.
 *
 * These are cut to well under half a second, with the leading silence stripped
 * so the sound lands the instant the event does. Victory keeps the long
 * recording, because it happens once and is allowed to breathe.
 */
const SAMPLES = {
  build: "./assets/audio/cues/build.mp3",
  trained: "./assets/audio/cues/trained.mp3",
  hit: "./assets/audio/cues/hit.mp3",
  die: "./assets/audio/cues/die.mp3",
  order: "./assets/audio/cues/order.mp3",
  collapse: "./assets/audio/cues/collapse.mp3",
  devotion: "./assets/audio/cues/devotion.mp3",
  victory: "./assets/audio/sfx/sfx_victory.mp3",
};

/** Decoded buffers, by cue. `null` means "tried and failed — do not retry". */
const buffers = new Map();

function loadSample(cue) {
  if (buffers.has(cue) || !SAMPLES[cue] || !ctx) return;
  buffers.set(cue, undefined); // in flight, so a busy frame does not refetch
  fetch(SAMPLES[cue])
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buf) => buffers.set(cue, buf))
    .catch(() => {
      buffers.set(cue, null);
      console.info(`[audio] no sample for "${cue}" — using the synthesised one.`);
    });
}

/** Play a decoded sample, if we have one. Returns whether it played. */
function playSample(cue, when) {
  const buf = buffers.get(cue);
  if (!buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  // Quieter than the synth layer, and quieter again for the cue that fires most
  // often. A sound you hear two hundred times in a match should sit under the
  // one you hear twice.
  gain.gain.value = cue === "trained" || cue === "order" ? 0.28 : 0.42;
  src.connect(gain).connect(master);
  src.start(when);
  return true;
}

export function isMuted() {
  return muted;
}

/** Set the effects level, 0..1. Applies at once and survives a mute. */
export function setSfxVolume(level) {
  sfxLevel = Math.max(0, Math.min(1, level));
  if (master && !muted) master.gain.value = sfxLevel;
}

export function sfxVolume() {
  return sfxLevel;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : sfxLevel;
  return muted;
}

/**
 * Browsers refuse to start audio until the user has interacted with the page,
 * so this is called from the first click or keypress rather than at load.
 */
export function initAudio() {
  if (ctx) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : sfxLevel;

  // A touch of gentle limiting, so a cascade of routs does not clip.
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -18;
  squash.ratio.value = 6;
  master.connect(squash).connect(ctx.destination);
}

// --- Building blocks ---------------------------------------------------------

function env(node, at, peak, attack, decay) {
  const g = node.gain;
  g.setValueAtTime(0.0001, at);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

function tone(freq, at, peak, attack, decay, type = "sine", detune = 0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  osc.detune.value = detune;
  env(gain, at, peak, attack, decay);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

/** A burst of filtered noise — the basis of every impact in the game. */
function noise(at, peak, decay, filterFrom, filterTo, q = 1) {
  const frames = Math.ceil(ctx.sampleRate * (decay + 0.05));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = q;
  filter.frequency.setValueAtTime(filterFrom, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, filterTo), at + decay);

  const gain = ctx.createGain();
  env(gain, at, peak, 0.005, decay);

  src.connect(filter).connect(gain).connect(master);
  src.start(at);
  src.stop(at + decay + 0.05);
}

/**
 * A struck bell. Real bells are inharmonic — their partials are not whole
 * multiples of the fundamental, which is exactly why a bell sounds like a bell
 * and a sine wave does not.
 */
function bell(root, at, peak, decay) {
  const partials = [
    [0.5, 0.32, 1.0],   // hum
    [1.0, 0.5, 0.85],   // strike
    [1.19, 0.28, 0.6],
    [1.56, 0.22, 0.45],
    [2.0, 0.18, 0.35],
    [2.66, 0.12, 0.22],
    [3.42, 0.08, 0.16],
  ];
  for (const [ratio, amp, life] of partials) {
    tone(root * ratio, at, peak * amp, 0.004, decay * life, "sine");
  }
}

const vary = (n, amount) => n * (1 + (Math.random() * 2 - 1) * amount);

// --- The sounds --------------------------------------------------------------

const VOICES = {
  fire_archer: (t) => {
    noise(t, 0.13, 0.08, 3200, 900);                 // bowstring
    tone(vary(520, 0.06), t, 0.05, 0.004, 0.09, "triangle");
  },

  fire_thorn: (t) => {
    noise(t, 0.10, 0.07, 2400, 600, 3);
    tone(vary(300, 0.1), t, 0.05, 0.003, 0.1, "sawtooth");
  },

  // A caltrop going in. Short, bright and metallic rather than a bang — nobody
  // fired anything, somebody just stepped on iron.
  spikes: (t) => {
    noise(t, 0.07, 0.05, 5200, 2600, 6);
    tone(vary(1750, 0.12), t, 0.035, 0.002, 0.06, "square");
    tone(vary(2400, 0.12), t + 0.01, 0.02, 0.002, 0.05, "triangle");
  },

  fire_cannon: (t) => {
    noise(t, 0.5, 0.34, vary(1500, 0.15), 90);       // the crack
    tone(vary(58, 0.08), t, 0.42, 0.006, 0.32, "sine");   // the thump
    tone(vary(96, 0.08), t, 0.16, 0.006, 0.16, "square");
  },

  fire_bombard: (t) => {
    noise(t, 0.62, 0.6, vary(1100, 0.12), 60);
    tone(vary(38, 0.06), t, 0.55, 0.01, 0.65, "sine");
    tone(vary(70, 0.06), t, 0.2, 0.01, 0.3, "square");
  },

  fire_bell: (t) => bell(vary(430, 0.02), t, 0.34, 1.5),
  fire_reliquary: (t) => {
    bell(vary(268, 0.015), t, 0.42, 2.6);            // deeper, longer
    bell(vary(536, 0.015), t + 0.05, 0.14, 1.4);
  },

  fire_bloodthorn: (t) => {
    noise(t, 0.18, 0.22, 1700, 260, 5);
    tone(vary(150, 0.12), t, 0.1, 0.01, 0.24, "sawtooth");
  },

  // A line breaking: a swell of voices, not an impact.
  rout: (t) => {
    noise(t, 0.34, 0.85, 1500, 380, 0.7);
    tone(vary(190, 0.05), t, 0.11, 0.09, 0.6, "sawtooth");
    tone(vary(143, 0.05), t, 0.09, 0.12, 0.75, "sawtooth");
  },

  destroy: (t) => {
    noise(t, 0.4, 0.36, 2600, 120);
    tone(vary(84, 0.1), t, 0.22, 0.006, 0.26, "square");
  },

  // Your own building coming down: wood and stone, not a hit on the enemy.
  tower_lost: (t) => {
    noise(t, 0.45, 0.7, 1100, 80, 1.5);
    tone(vary(70, 0.08), t, 0.3, 0.01, 0.5, "square");
    tone(vary(104, 0.08), t + 0.08, 0.16, 0.01, 0.35, "triangle");
  },

  gate_hit: (t) => {
    noise(t, 0.42, 0.5, 700, 70, 2);
    tone(vary(46, 0.05), t, 0.5, 0.01, 0.55, "sine");
  },

  // A war horn: you have just invited them to come early.
  call: (t) => {
    tone(196, t, 0.2, 0.05, 0.5, "sawtooth");
    tone(294, t + 0.02, 0.16, 0.06, 0.5, "sawtooth");
    tone(392, t + 0.22, 0.18, 0.05, 0.6, "sawtooth");
    noise(t, 0.06, 0.5, 900, 300);
  },

  rally: (t) => {
    tone(300, t, 0.14, 0.03, 0.16, "square");
    tone(400, t + 0.09, 0.14, 0.03, 0.16, "square");
    tone(600, t + 0.18, 0.16, 0.03, 0.3, "square");
  },

  // --- Dominion ---------------------------------------------------------
  // The strategy mode had no sound at all. These reuse the same synthesised
  // voices as everything above — no files, nothing to download — and are kept
  // deliberately quiet and short: an RTS fires them dozens of times a second
  // during a fight, and anything with a tail turns a battle into a drone.

  /** A blow landing. Dry and small; there are a great many of them. */
  hit: (t) => {
    noise(t, 0.05, 0.04, 2600, 700, 2);
    tone(vary(190, 0.12), t, 0.03, 0.002, 0.05, "square");
  },

  /** Somebody falls. */
  die: (t) => {
    noise(t, 0.09, 0.10, 1400, 260, 1);
    tone(vary(140, 0.1), t, 0.05, 0.004, 0.16, "sawtooth");
  },

  /** A unit walks out of the barracks. */
  trained: (t) => {
    tone(392, t, 0.05, 0.006, 0.10, "triangle");
    tone(587, t + 0.05, 0.05, 0.006, 0.12, "triangle");
  },

  /** Orders acknowledged — the quietest thing in the game, and the commonest. */
  order: (t) => {
    tone(880, t, 0.025, 0.002, 0.05, "sine");
  },

  /** A building coming down. The one Dominion sound allowed any weight. */
  collapse: (t) => {
    noise(t, 0.42, 0.5, 900, 70, 1);
    tone(vary(70, 0.1), t, 0.22, 0.01, 0.5, "sawtooth");
    tone(vary(104, 0.1), t + 0.04, 0.12, 0.01, 0.4, "triangle");
  },

  build: (t) => {
    noise(t, 0.2, 0.1, 1800, 400, 2);
    tone(vary(210, 0.05), t, 0.14, 0.004, 0.11, "triangle");
    tone(vary(150, 0.05), t + 0.06, 0.1, 0.004, 0.13, "triangle");
  },

  devotion: (t) => {
    bell(360, t, 0.2, 1.6);
    bell(540, t + 0.13, 0.16, 1.5);
    bell(720, t + 0.26, 0.14, 1.9);
  },

  victory: (t) => {
    bell(320, t, 0.3, 2.2);
    bell(480, t + 0.18, 0.26, 2.2);
    bell(640, t + 0.36, 0.24, 2.8);
  },

  defeat: (t) => {
    bell(190, t, 0.34, 3.0);
    bell(150, t + 0.3, 0.3, 3.4);
    noise(t, 0.25, 1.4, 500, 60);
  },
};

/**
 * Play the cues raised by the simulation this frame.
 * Duplicates are collapsed: eight archers firing on the same tick should sound
 * like a volley, not like eight separate identical clicks stacked on top of
 * each other.
 */
export function playCues(cues) {
  if (!ctx || muted || cues.length === 0) return;
  if (ctx.state === "suspended") ctx.resume();

  const seen = new Map();
  for (const cue of cues) seen.set(cue, (seen.get(cue) ?? 0) + 1);

  let played = 0;
  for (const [cue, count] of seen) {
    const voice = VOICES[cue];
    if (!voice && !SAMPLES[cue]) continue;
    if (played >= MAX_PER_FRAME) break;

    // Fetch on first use rather than up front: a player who never builds
    // anything never pays for the build sound.
    loadSample(cue);

    // Up to two of the same cue, the second nudged later so it reads as a
    // volley rather than a flam.
    const repeats = Math.min(2, count);
    for (let i = 0; i < repeats; i++) {
      const when = ctx.currentTime + i * 0.035;
      // A recorded cue if we have one, the synthesised one if not. Never both:
      // they are the same event and stacking them just sounds like a mistake.
      if (!playSample(cue, when) && voice) voice(when);
    }
    played += 1;
  }
}
