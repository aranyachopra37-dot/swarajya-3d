// Glue: runs the clock, reads the mouse, calls the simulation, calls the renderer.
//
// The fixed timestep matters. Browsers do not call us at a reliable rate, so if
// the game advanced by "however much time passed" the same inputs would produce
// different outcomes on different machines and verifiable replays would be
// impossible. We accumulate real time and spend it in whole 1/60s ticks.
//
// Nothing here changes the simulation directly. Clicks become recorded inputs;
// the simulation applies them itself.

import {
  createSim, step, queuePlacement, queueCallWave, nextCallable, tiers, TICKS_PER_SECOND,
} from "./sim.js";
import { TOWERS, TOWER_IDS, FAMILIES, FAMILY_IDS, isUnlocked, tierFor } from "./towers.js";
import { MAPS, MAP_IDS } from "./maps.js";
import { describeAlignment, CREED_LORE, WORLD, tierLine } from "./lore.js";
import { draw } from "./render.js";
import { loadSprites } from "./assets.js";
import { createCamera, screenToWorld, zoomAt, panBy, resetCamera } from "./camera.js";
import { initAudio, playCues, toggleMute, isMuted } from "./audio.js";
import { startMusic, updateMusic, menuMusic, setMusicMuted } from "./music.js";
import { initMenu, showMenu, hideMenu } from "./menu.js";
import { makeReplay, replayFilename, REPLAY_VERSION } from "./replay.js";

// A fresh battle every day, so the ladder has a "today" — and overridable from
// the URL, which is what makes a challenge link mean anything.
let seed = Math.floor(Date.now() / 86400000);

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const logEl = document.getElementById("log");
const barEl = document.getElementById("build");
const alignEl = document.getElementById("alignment");

let mapId = "longRoad";
let sim = createSim(seed, mapId);
let selected = "archer";
let pointer = null;
const camera = createCamera(canvas.width, canvas.height);

// The battle only advances while this is true. The title screen sets it false,
// which is the whole reason a menu is safe: otherwise waves would spawn and the
// gate would fall behind an overlay nobody was watching. It cannot affect a
// replay — the simulation counts ticks, never wall-clock time, so a tick that is
// never stepped simply never happened.
let running = false;

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
let accumulator = 0;
let lastTime = performance.now();

// --- Map picker --------------------------------------------------------------

function startMap(id) {
  mapId = id;
  sim = createSim(seed, mapId);
  // Reset the clock as well as the accumulator. Coming back from a menu that has
  // been open for a minute would otherwise hand the loop a minute of owed time
  // and fast-forward the opening waves.
  accumulator = 0;
  lastTime = performance.now();
  running = true;
  logEl.textContent = "";
  note(MAPS[id].name, true);
  note(MAPS[id].blurb);
  note(WORLD.openers[Math.floor(Math.random() * WORLD.openers.length)]);
  resetCamera(camera);
  hideMenu();

  // Choosing a map is a click, which is the gesture browsers demand before any
  // audio may start.
  initAudio();
  startMusic(id);
}

// --- Build bar ---------------------------------------------------------------

const buttons = new Map();

for (const id of TOWER_IDS) {
  const spec = TOWERS[id];
  const button = document.createElement("button");
  button.className = "tower";
  button.title = `${spec.lore}\n\n${
    spec.requires ? `Needs ${spec.requires.devotion} ${spec.requires.family} buildings.` : ""
  }`;
  button.innerHTML =
    `<span class="swatch" style="background:${spec.colour}"></span>` +
    `<span class="name">${spec.name}</span>` +
    `<span class="family">${spec.family ?? "—"}</span>` +
    `<span class="cost">${spec.cost}g</span>`;
  button.addEventListener("click", () => selectTower(id));
  barEl.appendChild(button);
  buttons.set(id, button);
}

function selectTower(id) {
  if (!isUnlocked(TOWERS[id], sim.devotion)) {
    const need = TOWERS[id].requires;
    note(`${TOWERS[id].name} needs ${need.devotion} ${need.family} buildings.`);
    return;
  }
  selected = id;
  for (const [key, button] of buttons) button.classList.toggle("selected", key === id);
}

selectTower("archer");

function refreshUi() {
  refreshCallButton();
  refreshReplayButton();

  for (const [id, button] of buttons) {
    const spec = TOWERS[id];
    const locked = !isUnlocked(spec, sim.devotion);
    button.classList.toggle("locked", locked);
    button.classList.toggle("unaffordable", !locked && sim.gold < spec.cost);
  }

  const t = tiers(sim);
  alignEl.innerHTML = `<strong>${describeAlignment(sim.devotion, t)}</strong> ` +
    FAMILY_IDS.map((id) => {
      const tier = t[id];
      if (tier === 0) return "";
      return `<span class="boon" style="color:${FAMILIES[id].colour}">${
        CREED_LORE[id].name
      } ${"I".repeat(tier)} — ${FAMILIES[id].boonText.replace("per tier", `×${tier}`)}</span>`;
    }).join("");
}

window.addEventListener("keydown", (event) => {
  const index = Number(event.key) - 1;
  if (index >= 0 && index < TOWER_IDS.length) selectTower(TOWER_IDS[index]);
  if (event.key === "r" || event.key === "R") resetCamera(camera);
  if (event.key === "Escape") {
    if (!pauseEl.classList.contains("hidden")) closePause();
    else openPause();
  }
  if (event.code === "Space") {
    event.preventDefault();
    callWave();
  }
});

const callBtn = document.getElementById("call");

function callWave() {
  const result = queueCallWave(sim);
  if (!result.ok) note(result.reason);
}

callBtn.addEventListener("click", callWave);

function refreshCallButton() {
  const call = nextCallable(sim);
  if (!call || sim.over) {
    callBtn.disabled = true;
    callBtn.textContent = "No wave to call";
    return;
  }
  callBtn.disabled = false;
  callBtn.innerHTML =
    `Call wave ${call.wave + 1} <span class="early">${call.seconds.toFixed(1)}s early</span> ` +
    `<span class="cost">+${call.gold}g</span> <span class="pts">+${call.score}</span>`;
}

// --- Pointer -----------------------------------------------------------------

/** Where the mouse is in canvas pixels — before the camera is taken into account. */
function screenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

/** Where the mouse is on the battlefield. This is what the simulation cares about. */
function worldPoint(event) {
  const s = screenPoint(event);
  const w = screenToWorld(camera, s.x, s.y);
  return { x: Math.round(w.x), y: Math.round(w.y) };
}

let dragging = null;

canvas.addEventListener("mousemove", (event) => {
  pointer = worldPoint(event);

  if (dragging) {
    const s = screenPoint(event);
    panBy(camera, s.x - dragging.x, s.y - dragging.y);
    dragging = s;
  }
});

canvas.addEventListener("mouseleave", () => {
  pointer = null;
  dragging = null;
});

// Middle button drags the map. Rotation was asked for and is not possible with
// flat sprites painted from one angle — see the note at the top of camera.js.
canvas.addEventListener("mousedown", (event) => {
  if (event.button === 1) {
    event.preventDefault();
    dragging = screenPoint(event);
  }
});

window.addEventListener("mouseup", () => (dragging = null));
canvas.addEventListener("auxclick", (e) => e.preventDefault());
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const s = screenPoint(event);
    zoomAt(camera, s.x, s.y, event.deltaY < 0 ? 1.12 : 1 / 1.12);
  },
  { passive: false }
);

canvas.addEventListener("click", (event) => {
  const point = worldPoint(event);
  const result = queuePlacement(sim, selected, point.x, point.y);
  if (!result.ok) note(result.reason);
});

function note(text, big = false) {
  const line = document.createElement("div");
  line.className = big ? "big" : "warn";
  line.textContent = big ? text : `— ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// --- Loop --------------------------------------------------------------------

function frame(now) {
  accumulator += now - lastTime;
  lastTime = now;

  // Paused at the title screen. Time is dropped rather than banked, or the first
  // frame after Start would spend everything the menu was open for at once.
  if (!running) {
    accumulator = 0;
    requestAnimationFrame(frame);
    return;
  }

  let ticks = 0;
  while (accumulator >= MS_PER_TICK && ticks < 5) {
    step(sim);
    accumulator -= MS_PER_TICK;
    ticks += 1;
  }
  if (accumulator > MS_PER_TICK * 20) accumulator = 0;

  drainEvents();

  // Sound cues are drained whether or not audio is running, so a muted game
  // never builds up a backlog that blares out the moment it is unmuted.
  const cues = sim.sounds.splice(0, sim.sounds.length);
  playCues(cues);

  // The music follows who you are becoming. Nothing here can reach the
  // simulation — it only reads devotion and whether the battle has ended.
  updateMusic(sim);

  if (sim.over && !shown) {
    shown = true;
    showResult();
  }
  if (!sim.over) shown = false;

  refreshUi();

  const ghost = pointer
    ? { tower: selected, spec: TOWERS[selected], x: pointer.x, y: pointer.y }
    : null;
  draw(ctx, sim, ghost, pointer, camera);

  requestAnimationFrame(frame);
}

function drainEvents() {
  if (sim.events.length === 0) return;

  for (const event of sim.events) {
    const line = document.createElement("div");
    if (event.big) line.className = "big";
    const seconds = (event.tick / TICKS_PER_SECOND).toFixed(1).padStart(5, " ");
    line.textContent = `${seconds}s  ${event.text}`;
    logEl.appendChild(line);

    // Devotion deepening is the one moment worth spending lore on — it is the
    // game telling you who you have quietly become.
    if (event.creed) {
      const flavour = tierLine(event.creed, event.tier);
      if (flavour) {
        const quote = document.createElement("div");
        quote.className = "lore";
        quote.textContent = `        ${flavour}`;
        logEl.appendChild(quote);
      }
    }
  }

  sim.events.length = 0;
  logEl.scrollTop = logEl.scrollHeight;
}

// Browsers will not start audio until the user has interacted with the page, so
// the menu theme cannot simply begin at load — it starts on the first click or
// keypress, which on the title screen is usually the mouse moving over a card.
for (const event of ["click", "keydown", "pointerdown"]) {
  window.addEventListener(
    event,
    () => {
      initAudio();
      if (!document.body.classList.contains("playing")) menuMusic();
    },
    { once: true }
  );
}

// --- Replay export -----------------------------------------------------------

const replayBtn = document.getElementById("pause-replay");

replayBtn.addEventListener("click", () => {
  const replay = makeReplay(sim);
  const blob = new Blob([JSON.stringify(replay, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = replayFilename(replay);
  link.click();
  URL.revokeObjectURL(url);

  note(
    `Replay saved — ${replay.inputs.length} inputs, claiming ${replay.claim.score} points. ` +
      `Verify it with: node scripts/submit-score.mjs <file>`,
    true
  );
});

function refreshReplayButton() {
  const played = sim.inputs.length > 0;
  replayBtn.disabled = !played;
  replayBtn.textContent = sim.over
    ? `Save replay (${sim.score} pts)`
    : played
      ? "Save replay so far"
      : "Save replay";
}

const muteBtn = document.getElementById("pause-mute");
function refreshMuteLabel() {
  muteBtn.textContent = isMuted() ? "Sound: off" : "Sound: on";
}
muteBtn.addEventListener("click", () => {
  initAudio();
  toggleMute();
  setMusicMuted(isMuted());
  refreshMuteLabel();
  menu.syncMute();
});
refreshMuteLabel();

// --- Title screen ------------------------------------------------------------

const menu = initMenu({
  onStart: startMap,
  onMute: () => {
    initAudio();
    toggleMute();
    setMusicMuted(isMuted());
    refreshMuteLabel();
  },
  isMuted,
});

/**
 * Leave the battle and open the menu.
 *
 * @param {"modes"|"maps"} pane "Choose another road" wants the map list;
 * "Back to title" genuinely means the top of the menu, where the game is
 * chosen. They used to do exactly the same thing, which made the title button
 * look broken.
 */
function toTitle(pane = "maps") {
  running = false;
  closeOverlays();
  showMenu(pane);
  menuMusic();
}

// --- Pause -------------------------------------------------------------------

const pauseEl = document.getElementById("pause");
const resultEl = document.getElementById("result");

function closeOverlays() {
  pauseEl.classList.add("hidden");
  resultEl.classList.add("hidden");
}

function openPause() {
  if (sim.over || !document.body.classList.contains("playing")) return;
  running = false;
  pauseEl.classList.remove("hidden");
  refreshMuteLabel();
}

function closePause() {
  pauseEl.classList.add("hidden");
  if (!sim.over) {
    running = true;
    lastTime = performance.now();
    accumulator = 0;
  }
}

document.getElementById("pause-open").addEventListener("click", openPause);
document.getElementById("pause-resume").addEventListener("click", closePause);
document.getElementById("pause-restart").addEventListener("click", () => {
  closeOverlays();
  startMap(mapId);
});
document.getElementById("pause-maps").addEventListener("click", () => toTitle("maps"));
document.getElementById("pause-title").addEventListener("click", () => toTitle("modes"));

// --- The result, and the challenge ------------------------------------------
//
// Every player on a seed faces the identical battle. That is the whole basis of
// the ladder, and it is also the only reason a score is worth showing anyone:
// "12,480 on The Hairpin" means nothing on its own and means everything when the
// seed travels with it, because the person you send it to can play the very same
// battle and find out whether they are better than you. The card exists to carry
// the seed, not the boast.

const cardCanvas = document.getElementById("card");
let shown = false;

function challengeUrl() {
  const base = location.origin + location.pathname;
  return `${base}?map=${sim.map.id}&seed=${sim.seed}`;
}

function drawResultCard() {
  const c = cardCanvas.getContext("2d");
  const W = cardCanvas.width;
  const H = cardCanvas.height;
  const held = sim.gateHealth > 0;

  c.fillStyle = "#12141a";
  c.fillRect(0, 0, W, H);

  const glow = c.createRadialGradient(W / 2, 0, 20, W / 2, 0, H * 1.2);
  glow.addColorStop(0, held ? "rgba(232,200,119,0.20)" : "rgba(212,127,127,0.18)");
  glow.addColorStop(1, "transparent");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  c.textAlign = "center";
  c.fillStyle = "#f2e6c4";
  c.font = "600 15px Georgia, serif";
  c.fillText("R O U T", W / 2, 40);

  c.fillStyle = held ? "#7fd48f" : "#d47f7f";
  c.font = "600 26px Georgia, serif";
  c.fillText(held ? "The field is held" : "The gate has fallen", W / 2, 84);

  c.fillStyle = "#f2e6c4";
  c.font = "700 74px Georgia, serif";
  c.fillText(sim.score.toLocaleString(), W / 2, 168);

  c.fillStyle = "#8b93a7";
  c.font = "12px ui-monospace, monospace";
  c.fillText(
    `${sim.map.name.toUpperCase()}   ·   SEED ${sim.seed}   ·   RULES v${REPLAY_VERSION}`,
    W / 2, 196
  );

  // The three numbers that describe how you did it, not just how well.
  const stats = [
    ["BROKEN", sim.routed],
    ["KILLED", sim.destroyed],
    ["GATE", `${Math.max(0, Math.round((sim.gateHealth / sim.map.gateHealth) * 100))}%`],
  ];
  stats.forEach(([label, value], i) => {
    const x = W / 2 + (i - 1) * 150;
    c.fillStyle = "#e8c877";
    c.font = "600 26px Georgia, serif";
    c.fillText(String(value), x, 250);
    c.fillStyle = "#6c7488";
    c.font = "10px ui-monospace, monospace";
    c.fillText(label, x, 268);
  });

  c.fillStyle = "#b3a887";
  c.font = "italic 14px Georgia, serif";
  c.fillText(
    held ? "“An army is not killed. It is convinced.”" : "“They had further to run than you had to stand.”",
    W / 2, 306
  );

  c.fillStyle = "#5f677c";
  c.font = "11px ui-monospace, monospace";
  c.fillText("same seed, same battle — beat it", W / 2, 336);
}

function showResult() {
  drawResultCard();
  document.getElementById("card-hint").textContent =
    "Anyone opening your link fights this exact battle — same map, same waves, same order.";
  resultEl.classList.remove("hidden");
}

document.getElementById("card-save").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = `rout-${sim.map.id}-${sim.seed}-${sim.score}.png`;
  link.href = cardCanvas.toDataURL("image/png");
  link.click();
});

document.getElementById("card-copy").addEventListener("click", async () => {
  const held = sim.gateHealth > 0;
  const text =
    `Rout — ${held ? "held" : "lost"} ${sim.map.name} for ${sim.score.toLocaleString()} points ` +
    `(${sim.routed} broken, ${sim.destroyed} killed).\nSame battle, same seed: ${challengeUrl()}`;
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("card-hint").textContent = "Copied. Go and provoke somebody.";
  } catch {
    document.getElementById("card-hint").textContent = text;
  }
});

document.getElementById("card-again").addEventListener("click", () => {
  closeOverlays();
  startMap(mapId);
});
document.getElementById("card-title").addEventListener("click", () => toTitle("maps"));

// A handle for driving and inspecting a battle from outside the render loop.
//
// The loop runs on requestAnimationFrame, and a browser pane that is not being
// displayed stops compositing and stops calling it — so anything that only
// happens during play (the result card, the end of a battle, a wave landing)
// cannot be checked from the outside without this. It drives the same functions
// the loop does rather than a parallel copy, so it cannot pass while the real
// thing is broken. Same affordance Dominion has, for the same reason.
window.__rout = {
  get sim() { return sim; },
  status: () => ({
    tick: sim.tick,
    map: sim.map.id,
    seed: sim.seed,
    score: sim.score,
    gate: sim.gateHealth,
    over: sim.over,
    running,
  }),
  /** Advance the simulation by hand, exactly as the loop would. */
  step(n = 1) {
    for (let i = 0; i < n && !sim.over; i++) step(sim);
    sim.events.length = 0;
    sim.sounds.length = 0;
    return sim.tick;
  },
  /** Run to the end of the battle, then show the card the loop would show. */
  finish(limit = 60 * 60 * 12) {
    for (let i = 0; i < limit && !sim.over; i++) step(sim);
    sim.events.length = 0;
    sim.sounds.length = 0;
    if (sim.over) showResult();
    return this.status();
  },
  challengeUrl: () => challengeUrl(),
};

// --- Starting state ----------------------------------------------------------
//
// `?map=…&seed=…` is what makes a challenge link work: it drops you straight into
// the identical battle somebody else just played. It doubles as the tooling hook
// — headless Chrome can render a page but cannot click one, so without a way in
// there is no way to screenshot the battle interface at all.
const params = new URLSearchParams(location.search);
const wanted = params.get("map");
const wantedSeed = Number(params.get("seed"));
if (Number.isFinite(wantedSeed) && wantedSeed > 0) seed = wantedSeed;
if (wanted && MAPS[wanted]) startMap(wanted);
else showMenu();

loadSprites();

// No `startMap` here any more. The game used to drop you straight into The Long
// Road on load; now the title screen decides when a battle begins, and the
// opening line moved into startMap so it is printed per battle rather than once
// per session.
requestAnimationFrame(frame);
