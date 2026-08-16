// Dominion — the glue. Runs the clock, reads the mouse, calls the simulation.
//
// Same discipline as Rout's main.js: nothing here changes simulation state
// directly. A drag becomes a selection, a click becomes a queued order, and the
// simulation applies it on the tick it belongs to. That is what will let two
// machines run the same match from the same inputs.

import {
  createSim, step, summary,
  canBuild, POP_CAP, committed, BUILDINGS, UNITS, TICKS_PER_SECOND, MAPS, MAP_IDS,
  RESOURCES, priceOf, canAfford, shortfall,
  MANOR_TIERS, MAX_MANOR_TIER, canRaise, manorTier, PATHS, canForm, granaryOf,
} from "./sim.js";
import { think, TIERS, MAX_TIER, tierAt } from "./ai.js";
import { createLockstep, cmd, applyCommand, checksum as netChecksum } from "./net.js";
import {
  host as linkHost, join as linkJoin, resume as linkResume,
  heldSeat, forgetSeat,
} from "./link.js";
import { relayAvailable } from "./netconfig.js";
// What you may say to the person you are fighting. Sent on the same channel as
// the commands but NOT through lockstep — see the note at the top of parley.js.
import { createParley, PHRASES } from "./parley.js";
import { TILE, toTile, GOLD } from "./grid.js";
// Dominion had no sound at all. Warden's audio engine is synthesised from
// scratch with no files behind it, so borrowing it costs nothing to download
// and nothing to maintain — the cues are already raised by the simulation.
import {
  initAudio, playCues, toggleMute, isMuted, setSfxVolume,
} from "../src/audio.js";
// Ceremony and score. Both are downstream of the simulation and can never reach
// back into it — a herald is handed numbers that have already happened.
import { herald, opener, winLine, lossLine, closeHerald } from "../src/herald.js";
import {
  siegeMusic, endMusic, setMusicMuted, menuMusic, pathMusic, setMusicVolume,
} from "../src/music.js";
import { draw, minimapRect, hasArt} from "./render.js";
import {
  createCamera, screenToWorld, zoomAt, panBy, centreOn, wholeMapZoom,
} from "./camera.js";

const canvas = document.getElementById("field");
const ctx = canvas.getContext("2d");

// --- The ladder --------------------------------------------------------------
//
// Progress is how far you have BEATEN, so the next opponent is always unlocked
// and no further. Kept in localStorage: losing a sandbox ladder to a cleared
// browser cache is a bad enough experience that it is worth the eight lines, and
// it is the seed of the escalating-opponent mode.
const SAVE_KEY = "dominion.ladder.v1";

function loadProgress() {
  const raw = Number(localStorage.getItem(SAVE_KEY));
  return Number.isFinite(raw) ? Math.max(0, Math.min(MAX_TIER, raw)) : 0;
}
function saveProgress(n) {
  try {
    localStorage.setItem(SAVE_KEY, String(Math.max(0, Math.min(MAX_TIER, n))));
  } catch {
    /* private browsing — the ladder just will not persist, which is survivable */
  }
}

let beaten = loadProgress();     // highest tier defeated, -1 means none
let tier = Math.min(beaten + (beaten >= 0 ? 0 : 0), MAX_TIER);
{
  // `?tier=N` picks the opponent straight from the URL. It exists for the same
  // reason `?warm=` does: headless Chrome has its own empty profile, so there is
  // no saved ladder progress there and no way to script a screenshot of a match
  // against anything but the first tier — which builds no stables and no towers,
  // so half the game is unphotographable.
  const asked = Number(new URLSearchParams(location.search).get("tier"));
  if (Number.isFinite(asked) && asked >= 0) tier = Math.min(asked | 0, MAX_TIER);
}
let scored = false;              // has this match already counted?

// Which ground the next match is fought on. Part of the SETUP, like the seed:
// both players must agree on it before the first tick or their simulations are
// not the same simulation at all, which is why it travels in the handshake.
let mapId = MAP_IDS[0];
{
  // The title screen sends its choice here as `?map=`. Anything unrecognised
  // falls back rather than failing — a stale link should still open a game.
  const asked = new URLSearchParams(location.search).get("map");
  if (asked && MAPS[asked]) mapId = asked;
}

/**
 * Why this page was opened.
 *
 * `?mode=friend` or an invite link's `?join=CODE` mean "I came here to play a
 * person" — and in that case the page must NOT build a match against the
 * computer. It always did, so an invite link dropped you into a ladder game
 * that ran on behind the lobby while you tried to connect. Harmless to the
 * simulation, baffling to look at, and the reason the first player to try a 1v1
 * said the game seemed far more complicated than what they wanted.
 */
const INVITE = new URLSearchParams(location.search).get("join");
const FRIEND_MODE =
  new URLSearchParams(location.search).get("mode") === "friend" || Boolean(INVITE);

function newMatch(seed) {
  const fresh = createSim(seed, mapId);
  // The handicap is part of the SETUP and is applied before the first tick, so
  // the match stays reproducible from its seed and inputs. Every opponent gets
  // it, not just seat 1 — on a three-seat map the third player was left on the
  // default name and no handicap, which read as a bug in the ladder.
  for (const p of fresh.players) {
    if (p.id === 0) continue;
    p.goldRate = tierAt(tier).handicap;
    p.name = tierAt(tier).name;
  }
  scored = false;
  return fresh;
}

let sim = newMatch(Math.floor(Date.now() / 86400000)); // a new layout each day

// --- One funnel for everything the player does -------------------------------
//
// Offline this applies the command straight away. Online it hands it to the
// lockstep engine, which schedules it a few ticks out and ships it to the other
// peer. Every input handler below calls THIS and never the simulation, so the
// mouse code has no idea whether the match is against a machine in this tab or
// a person on another continent — and cannot accidentally do something locally
// that the other side never hears about, which is the classic way a
// deterministic game quietly desyncs.
let net = null; // { lockstep, link, seat } while online

function issue(command) {
  if (net) {
    net.lockstep.issue(command);
    return { ok: true };
  }
  return applyLocal(command);
}

/**
 * Offline, a command is applied straight to the local simulation.
 *
 * Deliberately the SAME function the networked path uses, rather than a second
 * switch that looks like it. There was a second switch, it fell one argument
 * behind, and the result was a modifier key that worked in a match and did
 * nothing in a skirmish — a difference no test could see, because the duplicate
 * lived in a file that needs a browser to import.
 */
function applyLocal(command) {
  return applyCommand(sim, 0, command);
}

/** Which seat is the local player in? Always 0 offline, either seat online. */
const seat = () => (net ? net.seat : 0);

const cam = createCamera(canvas.width, canvas.height, sim.grid.worldW, sim.grid.worldH);

const selection = { unitIds: new Set(), buildingId: null };
let buildType = null;
let dragBox = null;
let dragStart = null;
let panning = null;
let minimapDrag = null;
// Which pan keys are held. Held rather than acted on directly so that pressing
// two together moves diagonally at the same speed as one moves straight.
const panKeys = new Set();
let pointer = null;
// Paused while the lobby is up. The page still BUILDS a simulation — the
// renderer and half the interface would need null checks everywhere otherwise —
// but it does not step one, so nobody arrives at a match already in progress
// against an opponent they never chose.
let running = !FRIEND_MODE;

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
let accumulator = 0;
let lastTime = performance.now();

// Start looking at your own manor rather than the top-left corner, and pull
// back on the bigger maps.
//
// Kingsmoor is three times the ground of the other two, and at 1:1 the opening
// view is a hall and some grass — it reads as a small map with a lot of walking
// rather than as a big one. Framing a fixed span of WORLD makes every map open
// showing about the same amount of country.
function frameHome() {
  const heart = sim.buildings.find((b) => b.owner === seat() && b.spec.isHeart);
  // Never tighter than the map allows: on a very large map the old floor of 0.5
  // was closer than the whole-map view, so the opening shot was a hall and some
  // grass with no way to understand where it sat.
  cam.zoom = Math.max(wholeMapZoom(cam), Math.min(1, canvas.width / 2100));
  if (heart) centreOn(cam, heart.x, heart.y);
}
frameHome();

// --- Interface ---------------------------------------------------------------

const goldEl = document.getElementById("gold");
const timberEl = document.getElementById("timber");
const foodEl = document.getElementById("food");
const pathEl = document.getElementById("path");
const selPanel = document.getElementById("selpanel");
const selHead = document.getElementById("selhead");
const selStats = document.getElementById("selstats");
const selOrder = document.getElementById("selorder");
const rosterEl = document.getElementById("roster");
const popEl = document.getElementById("pop");
const popCapEl = document.getElementById("popcap");
const peasantEl = document.getElementById("peasants");
const statusEl = document.getElementById("status");
const LETTER = { gold: "g", timber: "w", food: "f" };

/** "120g 40w" — only the resources this thing actually costs. */
function priceLabel(spec) {
  const price = priceOf(spec);
  return RESOURCES
    .filter((r) => price[r] > 0)
    .map((r) => `${price[r]}${LETTER[r]}`)
    .join(" ");
}

const buildBar = document.getElementById("buildbar");
const trainBar = document.getElementById("trainbar");
const logEl = document.getElementById("log");

/**
 * RAISING THE HALL LIVES IN THE BUILD BAR, NOT ON THE MANOR.
 *
 * It is the most important build decision in the game, and putting it behind
 * "select your manor first" would hide it from exactly the player who most needs
 * to find it. It sits first in the bar and names what it will make, so the tech
 * tree is legible without a manual: you can read "Keep 240g 220w" and know both
 * that halls have tiers and what the next one costs.
 */
const raiseButton = document.createElement("button");
raiseButton.dataset.raise = "1";
raiseButton.addEventListener("click", () => {
  const check = canRaise(sim, seat());
  if (!check.ok) {
    note(`Cannot raise your hall — ${check.reason}.`, "alert");
    return;
  }
  issue(cmd.raise([...selection.unitIds]));
  note(`Work begins on a ${check.next.name}. Peasants have to raise it.`);
});
buildBar.appendChild(raiseButton);

for (const [id, spec] of Object.entries(BUILDINGS)) {
  if (spec.isHeart) continue; // you never build another manor
  const button = document.createElement("button");
  // A PICTURE OF THE THING, BESIDE ITS NAME.
  //
  // "Akhara 120g 90w" tells a new player nothing at all — and the game is now
  // named almost entirely in Sanskrit, which is the identity we want and also a
  // wall between somebody and knowing which button makes soldiers. The sprite is
  // already loaded for the field; showing it here costs nothing and answers the
  // question before it is asked.
  // Only ask for art that exists. Walls and bridges are drawn from primitives
  // and have no sprite by design; requesting one is three 404s in the console
  // and three wasted round-trips.
  const icon = hasArt(id)
    ? `<img class="bicon" src="../assets/sprites/dom_${id}.png" alt="">` : "";
  button.innerHTML =
    `${icon}<span class="btext"><b>${spec.name}</b>` +
    `<span class="cost">${priceLabel(spec)}</span></span>`;
  button.title = spec.plain ? `${spec.plain}

${spec.lore}` : spec.lore;
  button.addEventListener("click", () => {
    buildType = buildType === id ? null : id;
    refreshBars();
  });
  button.dataset.build = id;
  buildBar.appendChild(button);
}

// What the train bar is currently showing, so it is only rebuilt when that
// changes. See the note inside refreshBars — rebuilding it every frame made
// every button in it unclickable.
let trainBarKey = null;
let queueLabel = null;

function refreshBars() {
  const tier = manorTier(sim, seat());
  const hall = sim.buildings.find((b) => b.owner === seat() && b.spec.isHeart);

  // The hall button says what it is FOR at every point in its life: what it will
  // build, how far along that is, or that there is nothing left to build.
  if (hall && hall.raising) {
    const done = Math.round((hall.raising.work / hall.raising.needed) * 100);
    raiseButton.innerHTML =
      `<b>${MANOR_TIERS[hall.raising.to].name}</b> <span class="cost">${done}%</span>`;
    raiseButton.title = "Being raised. Right-click your hall with peasants to help.";
  } else if (tier >= MAX_MANOR_TIER) {
    raiseButton.innerHTML = `<b>${MANOR_TIERS[tier].name}</b> <span class="cost">—</span>`;
    raiseButton.title = "A Palace is the last stone.";
  } else {
    const next = MANOR_TIERS[tier + 1];
    raiseButton.innerHTML = `<b>${next.name}</b> <span class="cost">${priceLabel(next)}</span>`;
    raiseButton.title = next.lore;
  }
  raiseButton.classList.toggle("unaffordable", !canRaise(sim, seat()).ok);

  for (const button of buildBar.children) {
    if (button.dataset.raise) continue;
    const spec = BUILDINGS[button.dataset.build];
    button.classList.toggle("selected", buildType === button.dataset.build);

    // LOCKED IS NOT THE SAME AS UNAFFORDABLE, AND MUST NOT LOOK THE SAME.
    //
    // A player who reads "you cannot afford this" about a building no amount of
    // gold will unlock goes and mines for five minutes to find out nothing
    // changed. The gate has to name the thing that opens it — and there are now
    // two kinds of gate, a tier you have not reached and a path you did not
    // take. The second is the one that must be unmistakable, because it is the
    // only lock in the game that can be permanent.
    const path = sim.players[seat()].path;
    const lockedBy =
      (spec.needsTier ?? 0) > tier
        ? `Needs a ${MANOR_TIERS[spec.needsTier].name}. Raise your hall.`
        : spec.path && path && spec.path !== path
          ? `You took the ${PATHS[path].name} path. This belongs to ${PATHS[spec.path].name}.`
          : null;

    button.classList.toggle("locked", lockedBy !== null);
    button.classList.toggle(
      "unaffordable", !lockedBy && !canAfford(sim.players[seat()], spec)
    );
    // A path-house nobody has committed to yet is the most consequential button
    // on the bar, so it says what it will cost you as well as what it costs.
    button.title = lockedBy
      ? `${lockedBy}

${spec.plain ?? ""}`
      : spec.path && !path
        ? `${spec.lore}

Raising this takes the ${PATHS[spec.path].name} path — ` +
          `${PATHS[spec.path].title}. The other two close.

${spec.plain ?? ""}`
        : (spec.plain ? `${spec.plain}

${spec.lore}` : spec.lore);
    button.classList.toggle("commits", Boolean(spec.path) && !path && !lockedBy);
  }

  // The train bar serves whatever is selected that can MAKE something — a
  // building with a queue, or a sapper standing in a field with a catapult in
  // him. Two bars for the two cases would be two things to find; one bar that
  // knows what you have selected is one.
  const b = sim.buildings.find((x) => x.id === selection.buildingId);
  const sapper = selection.unitIds.size
    ? sim.units.find((u) => selection.unitIds.has(u.id) && u.owner === seat() && u.spec.erects)
    : null;
  const trains = b && b.owner === seat()
    ? b.spec.trains
    : sapper ? sapper.spec.erects : null;

  // REBUILD ONLY WHEN WHAT IT SHOWS CHANGES, NEVER EVERY FRAME.
  //
  // This function runs once per rendered frame, and it used to start by wiping
  // `trainBar.innerHTML` and creating the buttons again. A DOM click only fires
  // when the mousedown and the mouseup land on the SAME element — so at 60fps
  // the button you pressed was destroyed and replaced before you let go, no
  // click event was ever produced, and training was completely unreachable from
  // the interface. Twice reported as "clicking does nothing", twice mistaken for
  // an affordability problem and papered over with better messages.
  //
  // The build bar was never affected because its buttons are created once at
  // startup and this function only toggles their classes. That asymmetry is the
  // whole tell: you could place buildings and could not train anything.
  //
  // Anything rebuilt from a render loop is unclickable. The fix is to key the
  // rebuild on the CONTENT, and to update state in place the rest of the time.
  const signature = trains
    ? `${b ? b.id : `sapper${sapper.id}`}:${trains.join(",")}`
    : "none";
  const fresh = signature !== trainBarKey;
  trainBarKey = signature;

  if (fresh) {
    trainBar.innerHTML = "";
    queueLabel = null;
  }
  if (!trains) {
    if (!fresh) return;
    // Tell them what to do about it, not just what is missing, and let the
    // advice follow what they actually have. With the peasant economy the first
    // thing a new player needs is almost never a barracks — it is more peasants.
    const has = (id) => sim.buildings.some((x) => x.owner === seat() && x.spec.id === id);
    const peasants = sim.units.filter((u) => u.owner === seat() && u.spec.worker).length;
    trainBar.innerHTML = `<span class="hint">${
      peasants < 5
        ? "Click your hall to raise more people — they mine the gold and build everything."
        : has("barracks")
          ? "Click a Barracks or Stables to train troops."
          : "Mark out a Barracks, send peasants to raise it, then click it to train troops."
    }</span>`;
    return;
  }
  if (fresh) {
    for (const unitId of trains) {
      const spec = UNITS[unitId];
      const button = document.createElement("button");
      button.innerHTML =
        `<img class="bicon" src="../assets/sprites/dom_${unitId}.png" alt="" ` +
        `onerror="this.style.display='none'">` +
        `<span class="btext"><b>${spec.name}</b>` +
        `<span class="cost">${priceLabel(spec)}</span></span>`;
      button.dataset.train = unitId;

      // Say something when it cannot be afforded, rather than nothing.
      //
      // The simulation drops a train order it cannot pay for and says nothing at
      // all, which is correct for the simulation and terrible for the player.
      //
      // The building is looked up when the button is PRESSED rather than
      // captured here, because this element now outlives many frames and the
      // building it refers to can be destroyed in any of them.
      button.addEventListener("click", () => {
        if (!canAfford(sim.players[seat()], spec)) {
          const lack = shortfall(sim.players[seat()], spec);
          note(`Not enough for a ${spec.name} — ${lack} short.`, "alert");
          return;
        }
        if (committed(sim, seat()) >= POP_CAP) {
          note(`No room for another ${spec.name} — you are at the population limit.`, "alert");
          return;
        }

        // A sapper erects where he stands; a building queues. Looked up at press
        // time rather than captured, because this element outlives many frames
        // and what it refers to can die in any of them.
        const hand = selection.unitIds.size
          ? sim.units.find((u) => selection.unitIds.has(u.id) && u.owner === seat() && u.spec.erects)
          : null;
        if (hand && hand.spec.erects.includes(unitId)) {
          issue(cmd.erect(hand.id, unitId));
          note(`${spec.name} going up — the sapper must stand still to do it.`);
          return;
        }

        const owner = sim.buildings.find((x) => x.id === selection.buildingId);
        if (!owner || owner.owner !== seat() || !owner.spec.trains?.includes(unitId)) return;
        issue(cmd.train(owner.id, unitId));
        note(`${spec.name} ordered.`);
      });
      trainBar.appendChild(button);
    }

    queueLabel = document.createElement("span");
    queueLabel.className = "hint";
    trainBar.appendChild(queueLabel);
  }

  // Per-frame state, applied to the buttons that are already there.
  for (const button of trainBar.querySelectorAll("button[data-train]")) {
    const spec = UNITS[button.dataset.train];
    const short = canAfford(sim.players[seat()], spec)
      ? "" : shortfall(sim.players[seat()], spec);
    button.classList.toggle("unaffordable", short !== "");
    button.title = short
      ? `${short} more needed.

${spec.plain ?? ""}`
      : (spec.plain ?? spec.name);
  }
  if (queueLabel) {
    queueLabel.textContent = b && b.queue.length
      ? `queued: ${b.queue.length}`
      : sapper ? "erects where he stands" : "";
  }
}

// --- Saying things to the player ---------------------------------------------
//
// EVERYTHING USED TO GO IN ONE BOX UNDER THE MAP, AND THAT IS WHERE IT DIED.
//
// A player in a real-time game is looking at the map. A scrolling list below it,
// carrying "Spearman ordered", "Cannot build there", "Your Watch Tower is
// rubble" and the opponent's chat at identical weight, is a list nobody reads —
// so the one line that mattered went past unseen among nine that did not.
//
// Split by what the player has to DO about it:
//
//   alert  something is wrong or urgent. Over the map, held longest, loud.
//   event  something happened in the battle. Over the map, brief.
//   say    the other player spoke. Over the map, marked as theirs.
//   info   acknowledgements and setup. History only; never interrupts.
//
// The first three appear ON the canvas because that is where the eyes are. All
// four are kept in the history below, so nothing is lost — the difference is
// only whether it fights for attention.
const TOAST_MS = { alert: 5200, event: 3400, say: 6000 };

function note(text, level = "info") {
  const line = document.createElement("div");
  line.className = `log-${level}`;
  line.textContent = text;
  logEl.appendChild(line);
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;

  if (level !== "info") toast(text, level);
}

const toastEl = document.getElementById("toasts");

function toast(text, level) {
  const item = document.createElement("div");
  item.className = `toast toast-${level}`;
  item.textContent = text;

  // An alert about an attack is only useful if it takes you there. The toast
  // layer ignores the mouse so it never eats a click meant for the map; this one
  // element opts back in.
  if (level === "alert" && alarmAt) {
    item.classList.add("toast-goto");
    item.addEventListener("click", () => {
      centreOn(cam, alarmAt.x, alarmAt.y);
      item.remove();
    });
  }
  toastEl.appendChild(item);
  // Three at once is already a lot to read while playing.
  while (toastEl.children.length > 3) toastEl.removeChild(toastEl.firstChild);

  const life = TOAST_MS[level] ?? 3400;
  setTimeout(() => item.classList.add("fading"), life);
  setTimeout(() => item.remove(), life + 600);
}

// --- Mouse -------------------------------------------------------------------

function screenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

/** Did this click land on the minimap rather than the world? */
function minimapHit(s) {
  const m = minimapRect(ctx, sim);
  return s.x >= m.x0 && s.x <= m.x0 + m.w && s.y >= m.y0 && s.y <= m.y0 + m.h ? m : null;
}

canvas.addEventListener("mousedown", (event) => {
  const s = screenPoint(event);

  if (event.button === 1) {
    event.preventDefault();
    panning = s;
    return;
  }

  const m = minimapHit(s);
  if (m && event.button === 0) {
    centreOn(cam, (s.x - m.x0) / m.scale, (s.y - m.y0) / m.scale);
    // Keep following the mouse, so the minimap can be DRAGGED rather than only
    // clicked. Sweeping across it to look along a front is the fastest way to
    // read a big map, and click-only makes you stab at it repeatedly.
    minimapDrag = m;
    return;
  }

  if (event.button === 0) {
    // Always record the press, including while a building is selected.
    //
    // This used to bail out here when `buildType` was set, with a comment
    // saying placement was "handled on click" — and there was no click handler.
    // Nothing was listening. Pressing the mouse with a building selected set no
    // drag box, so mouseup returned immediately, so `pickAt` never ran and the
    // whole placement path was unreachable. The game looked alive and simply
    // could not be played.
    dragStart = s;
    dragBox = { x0: s.x, y0: s.y, x1: s.x, y1: s.y };
  }
});

/**
 * Double-click takes every unit of that type you can SEE.
 *
 * "On screen" rather than "within N pixels", because it is the rule every RTS
 * uses and it is the only one a player can predict without being told a number:
 * what you can see is what you get. Sixty archers standing together are all on
 * screen; the two you left guarding a warehouse across the map are not, and
 * quietly dragging them into the same order would be worse than not selecting
 * them at all.
 */
canvas.addEventListener("dblclick", (event) => {
  event.preventDefault();
  const world = screenToWorld(cam, ...Object.values(screenPoint(event)));

  const under = sim.units.find(
    (u) => u.owner === seat() &&
      (u.x - world.x) ** 2 + (u.y - world.y) ** 2 <= (u.spec.radius + 5) ** 2
  );
  if (!under) return;

  const left = cam.x;
  const top = cam.y;
  const right = cam.x + canvas.width / cam.zoom;
  const bottom = cam.y + canvas.height / cam.zoom;

  selection.unitIds.clear();
  selection.buildingId = null;
  for (const u of sim.units) {
    if (u.owner !== seat() || u.spec.id !== under.spec.id) continue;
    if (u.x < left || u.x > right || u.y < top || u.y > bottom) continue;
    selection.unitIds.add(u.id);
  }
  refreshBars();
  note(`${selection.unitIds.size} ${under.spec.name}${selection.unitIds.size === 1 ? "" : "s"} selected.`);
});

canvas.addEventListener("mousemove", (event) => {
  const s = screenPoint(event);
  pointer = screenToWorld(cam, s.x, s.y);
  edgePointer = s;

  if (panning) {
    panBy(cam, s.x - panning.x, s.y - panning.y);
    panning = s;
  }
  if (minimapDrag) {
    centreOn(cam, (s.x - minimapDrag.x0) / minimapDrag.scale, (s.y - minimapDrag.y0) / minimapDrag.scale);
  }
  if (dragBox) {
    dragBox.x1 = s.x;
    dragBox.y1 = s.y;
  }
});

window.addEventListener("mouseup", (event) => {
  panning = null;
  minimapDrag = null;
  if (!dragBox) return;

  // A drag only means "select" when you are not holding a building. With one
  // selected the press is always a placement, at the point you pressed — a
  // few pixels of wobble between press and release should not silently turn a
  // build order into an empty box-select.
  const moved =
    !buildType &&
    (Math.abs(dragBox.x1 - dragBox.x0) > 4 || Math.abs(dragBox.y1 - dragBox.y0) > 4);

  if (moved) {
    // Drag across the field to take everything of yours inside it — the one
    // interaction the whole genre rests on.
    const a = screenToWorld(cam, Math.min(dragBox.x0, dragBox.x1), Math.min(dragBox.y0, dragBox.y1));
    const b = screenToWorld(cam, Math.max(dragBox.x0, dragBox.x1), Math.max(dragBox.y0, dragBox.y1));

    selection.unitIds.clear();
    selection.buildingId = null;
    for (const u of sim.units) {
      if (u.owner !== seat()) continue;
      if (u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y) selection.unitIds.add(u.id);
    }
    if (selection.unitIds.size) note(`${selection.unitIds.size} selected.`);
  } else {
    pickAt(
      screenToWorld(cam, dragBox.x0, dragBox.y0),
      event.shiftKey || event.ctrlKey,
      event.ctrlKey
    );
  }

  dragBox = null;
  dragStart = null;
  refreshBars();
});

/**
 * A plain click: place a building, or select the one thing under the cursor.
 *
 * Placing a building drops you out of build mode unless shift is held, which is
 * what every RTS does and what a player expects. Staying in build mode meant the
 * next click — usually aimed at the thing you had just built, to select it and
 * start training — silently tried to build ANOTHER one instead, and quietly
 * failed for want of gold. Nothing looked broken; the game just refused to
 * proceed.
 */
function pickAt(world, keepBuilding = false, queued = false) {
  if (buildType) {
    const tx = toTile(world.x);
    const ty = toTile(world.y);
    const check = canBuild(sim, seat(), buildType, tx, ty);
    if (check.ok) {
      // The peasants you had selected are sent with the order, so a queued
      // foundation lands on THEIR list rather than on whoever happens to be idle
      // when it is placed. Ctrl also keeps the building held, because marking
      // out five in a row and re-clicking the button between each is not a
      // queue, it is five separate chores.
      issue(cmd.build(buildType, tx, ty, selection.unitIds, queued));
      if (!keepBuilding) buildType = null;
    } else {
      note(`Cannot build there — ${check.reason}.`, "alert");
    }
    return;
  }

  selection.unitIds.clear();
  selection.buildingId = null;

  for (const u of sim.units) {
    if (u.owner !== seat()) continue;
    const dx = u.x - world.x;
    const dy = u.y - world.y;
    if (dx * dx + dy * dy <= (u.spec.radius + 4) ** 2) {
      selection.unitIds.add(u.id);
      return;
    }
  }

  const tx = toTile(world.x);
  const ty = toTile(world.y);
  for (const b of sim.buildings) {
    if (b.owner !== seat()) continue;
    if (tx >= b.tx && tx < b.tx + b.spec.tiles && ty >= b.ty && ty < b.ty + b.spec.tiles) {
      selection.buildingId = b.id;
      return;
    }
  }
}

/**
 * Right-click. One button, and what it MEANS depends on what is under it.
 *
 * The interface deliberately does not decide: it sends the tile and the
 * simulation works out whether that was "mine this", "raise that", "kill him" or
 * "walk there" — see `resolveOrder` in sim.js. Two reasons. A human clicking a
 * gold seam and the AI deciding to work one then travel the identical code path,
 * so neither can do something the other cannot. And in a lockstep 1v1 the
 * meaning of a click has to be derived from state both peers agree on, not from
 * whatever this browser happened to have under the cursor.
 *
 * What is left here is only the parts the simulation cannot know: which enemy
 * UNIT was clicked (a unit is not a tile), and what to tell the player happened.
 */
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (buildType) {
    buildType = null;
    refreshBars();
    note("Foundation cancelled.");
    return;
  }

  // Ctrl held means "and then" rather than "instead". Every order below passes
  // it straight through to the simulation, which is the only thing allowed to
  // decide what a click meant.
  const q = event.ctrlKey;

  const world = screenToWorld(cam, ...Object.values(screenPoint(event)));
  const tx = toTile(world.x);
  const ty = toTile(world.y);

  // A building selected and nothing else means "send your new men there".
  if (selection.unitIds.size === 0 && selection.buildingId !== null) {
    const b = sim.buildings.find((x) => x.id === selection.buildingId);
    if (b && b.owner === seat() && b.spec.trains) {
      issue(cmd.rally(b.id, tx, ty));
      note(`${b.spec.name} will muster there.`);
      return;
    }
  }

  if (selection.unitIds.size === 0) return;

  // Clicking an enemy MAN is an attack order — a unit is not a tile, so the
  // simulation cannot work this one out from coordinates alone.
  const prey = sim.units.find(
    (u) => u.owner !== seat() && Math.hypot(u.x - world.x, u.y - world.y) <= u.spec.radius + 8
  );
  if (prey) {
    // A witch does not attack — she takes. Right-clicking an enemy with one
    // selected starts the incantation instead of a hopeless three-damage brawl.
    const witch = sim.units.find(
      (u) => selection.unitIds.has(u.id) && u.owner === seat() && u.spec.converts
    );
    if (witch) {
      issue(cmd.convert(witch.id, prey.id));
      note(`The witch begins on the ${prey.spec.name} — a minute, if she lives.`, "event");
      const rest = [...selection.unitIds].filter((id) => id !== witch.id);
      if (rest.length) issue(cmd.attack(rest, prey.id, q));
      return;
    }
    issue(cmd.attack(selection.unitIds, prey.id, q));
    note(
      q
        ? `${selection.unitIds.size} will deal with the ${prey.spec.name} in turn.`
        : `${selection.unitIds.size} onto the ${prey.spec.name}.`
    );
    return;
  }

  issue(cmd.order(selection.unitIds, tx, ty, q));
  note(q ? `Then: ${describeOrder(tx, ty, selection.unitIds.size)}` : describeOrder(tx, ty, selection.unitIds.size));
});

/** What the player just told them to do, in words. */
function describeOrder(tx, ty, count) {
  const cell = sim.grid.cells[ty * sim.grid.w + tx];
  const workers = [...selection.unitIds].filter((id) =>
    sim.units.find((u) => u.id === id && u.spec.worker)
  ).length;

  if (workers > 0 && cell === GOLD) return `${workers} to the gold.`;

  const site = sim.sites.find(
    (s) => s.owner === seat() && s.tiles.some(([x, y]) => x === tx && y === ty)
  );
  if (workers > 0 && site) return `${workers} raising the ${site.spec.name}.`;

  const hurt = sim.buildings.find(
    (b) => b.owner === seat() && b.hp < b.maxHp &&
      b.tiles.some(([x, y]) => x === tx && y === ty)
  );
  if (workers > 0 && hurt) return `${workers} mending the ${hurt.spec.name}.`;

  const enemy = sim.buildings.find(
    (b) => b.owner !== seat() && b.tiles.some(([x, y]) => x === tx && y === ty)
  );
  if (enemy) return `${count} onto the ${enemy.spec.name}.`;

  return `${count} moving.`;
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const s = screenPoint(event);
  zoomAt(cam, s.x, s.y, event.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

canvas.addEventListener("auxclick", (e) => e.preventDefault());

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    buildType = null;
    selection.unitIds.clear();
    selection.buildingId = null;
    refreshBars();
  }
  // Z for the whole map. A player on a big map needs one keystroke that answers
  // "where am I", and hunting for it on a scroll wheel is not that.
  if (event.key === "z" || event.key === "Z") {
    cam.zoom = wholeMapZoom(cam);
    centreOn(cam, sim.grid.worldW / 2, sim.grid.worldH / 2);
    return;
  }
  // G to form up, and the same key to break formation. See `queueForm`.
  if (event.key === "g" || event.key === "G") {
    if (selection.unitIds.size === 0) {
      note("Select soldiers first, then G to form them up.", "alert");
      return;
    }
    const check = canForm(sim, seat(), [...selection.unitIds]);
    if (!check.ok) {
      note(`Cannot form up — ${check.reason}.`, "alert");
      return;
    }
    issue(cmd.form([...selection.unitIds]));
    note(check.breaking
      ? "Breaking formation."
      : `${check.size} ${UNITS[check.kind].name}s forming up — they will share every blow.`);
    return;
  }
  // F for fullscreen. The maps are 200 tiles wide now; a window is a keyhole.
  if (event.key === "f" || event.key === "F") {
    const root = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => {
      note("This browser would not go fullscreen.", "alert");
    });
    return;
  }
  if (event.key === "h" || event.key === "H") {
    const heart = sim.buildings.find((b) => b.owner === seat() && b.spec.isHeart);
    if (heart) centreOn(cam, heart.x, heart.y);
  }
  if (event.key === " ") {
    event.preventDefault();
    // There is no pause in a 1v1, and there cannot be a private one.
    //
    // Pausing stops the loop, the loop is what publishes frames, and a peer that
    // stops publishing stalls the other one — who sees a frozen game and no
    // reason for it. One player could silently halt the other's match by
    // pressing space, and the only clue was "waiting for the other player".
    if (net) {
      note("There is no pausing an online match — the other player is waiting.", "alert");
      return;
    }
    running = !running;
    statusEl.textContent = running ? "" : "paused";
    return;
  }

  // Delete disbands. Confirmed only by being an odd key to press by accident —
  // and it goes through the command funnel like everything else, because
  // removing a unit locally would desync the match on the next tick.
  if (event.key === "Delete") {
    if (selection.unitIds.size === 0) return;
    const n = selection.unitIds.size;
    issue(cmd.disband(selection.unitIds));
    selection.unitIds.clear();
    note(`${n} disbanded.`, "event");
    return;
  }

  // X stops the selection where it is. In a game where nothing moves unless you
  // say so, being able to say "stop" is not a luxury. (S is WASD panning.)
  if (event.key === "x" || event.key === "X") {
    if (selection.unitIds.size === 0) return;
    issue(cmd.hold(selection.unitIds));
    note(`${selection.unitIds.size} holding.`);
    return;
  }

  // Q jumps to the last place something of yours was hit. NOT A — A is already
  // WASD-left, and a key that both pans the camera and teleports it is a key
  // that will do the wrong one at the worst moment. Clicking the alert does the
  // same thing, and is what most people will find first.
  if (event.key === "q" || event.key === "Q") {
    if (!alarmAt) return;
    centreOn(cam, alarmAt.x, alarmAt.y);
    note("Looking at the attack.", "info");
    return;
  }

  // Period cycles to the next peasant with nothing to do, and centres on him.
  // (see the pan-key handler below for arrows and WASD)
  //
  // Every economy game has this key and it is always the most-used one, because
  // an idle peasant is invisible — he is not doing anything, so nothing on
  // screen draws your eye to him — and he is pure loss for as long as you do
  // not notice.
  if (event.key === ".") {
    const idle = sim.units
      .filter((u) => u.owner === seat() && u.spec.worker && !u.job)
      .sort((a, b) => a.id - b.id);
    if (idle.length === 0) {
      note("No peasant is idle.", "alert");
      return;
    }
    const after = idle.find((u) => u.id > (lastIdle ?? -1)) ?? idle[0];
    lastIdle = after.id;
    selection.unitIds.clear();
    selection.buildingId = null;
    selection.unitIds.add(after.id);
    centreOn(cam, after.x, after.y);
    note(`Idle peasant (${idle.length} standing about).`);
  }
});

let lastIdle = null;

// --- Getting about the map ---------------------------------------------------
//
// Middle-drag used to be the ONLY way to pan, which on a laptop trackpad means
// there is no way to pan at all — there is no middle button to hold. On the
// 112x84 map that makes two thirds of the world unreachable, and the map reads
// as broken rather than big. Four ways now, all of them standard somewhere:
// arrow keys, WASD, pushing the pointer into the edge of the view, and dragging
// the minimap. Middle-drag still works.
const PAN_KEYS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
};
const KEY_PAN_SPEED = 22;   // screen pixels per frame at 1x zoom
const EDGE_MARGIN = 26;     // how close to the edge starts a scroll
const EDGE_PAN_SPEED = 16;

window.addEventListener("keydown", (event) => {
  // S belongs to WASD here rather than to Stop. Stop moved to X, because half a
  // WASD is worse than an unusual stop key — a player who presses W and A and
  // then finds S does something else entirely has learned that the controls lie.
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (PAN_KEYS[key]) {
    panKeys.add(key);
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  panKeys.delete(key);
});
// Held keys with the window unfocused would otherwise scroll for ever.
window.addEventListener("blur", () => panKeys.clear());

let edgePointer = null;
canvas.addEventListener("mouseleave", () => { edgePointer = null; });

/** One frame of camera movement from the keyboard and the screen edges. */
function panFromInput() {
  let dx = 0;
  let dy = 0;
  for (const key of panKeys) {
    dx += PAN_KEYS[key][0];
    dy += PAN_KEYS[key][1];
  }
  if (dx || dy) {
    // Normalised, so holding two keys does not move you 1.41x faster diagonally.
    const len = Math.sqrt(dx * dx + dy * dy);
    panBy(cam, (-dx / len) * KEY_PAN_SPEED, (-dy / len) * KEY_PAN_SPEED);
  }

  if (edgePointer && !panning && !minimapDrag && !dragBox) {
    let ex = 0;
    let ey = 0;
    if (edgePointer.x < EDGE_MARGIN) ex = 1;
    else if (edgePointer.x > canvas.width - EDGE_MARGIN) ex = -1;
    if (edgePointer.y < EDGE_MARGIN) ey = 1;
    else if (edgePointer.y > canvas.height - EDGE_MARGIN) ey = -1;
    if (ex || ey) panBy(cam, ex * EDGE_PAN_SPEED, ey * EDGE_PAN_SPEED);
  }
}

function restart(seed) {
  sim = newMatch(seed);
  selection.unitIds.clear();
  selection.buildingId = null;
  buildType = null;
  logEl.innerHTML = "";
  statusEl.textContent = "";
  frameHome();
  accumulator = 0;
  lastTime = performance.now();
  refreshLadder();
  refreshMaps();
  note(`${tierAt(tier).name} — ${tierAt(tier).blurb}`);
  openingHerald();
}

document.getElementById("restart").addEventListener("click", () => restart(sim.seed + 1));

// --- Ground ------------------------------------------------------------------
//
// Two maps that ask different questions: Two Gates has a way round, the Narrows
// does not. Changing it starts a new match, because a map cannot be swapped
// under a battle that is already running on it.
const mapBar = document.getElementById("mapbar");

function refreshMaps() {
  mapBar.innerHTML = "";

  const label = document.createElement("span");
  label.className = "hint";
  label.textContent = "ground:";
  mapBar.appendChild(label);

  for (const id of MAP_IDS) {
    const map = MAPS[id];
    const button = document.createElement("button");
    button.textContent = map.name;
    button.title = map.blurb;
    button.classList.toggle("selected", id === mapId);
    // Online, the ground was agreed in the handshake — one player quietly
    // rebuilding the map would desync the match on its very first tick.
    button.disabled = Boolean(net);
    button.addEventListener("click", () => {
      if (net || id === mapId) return;
      mapId = id;
      restart(sim.seed + 1);
      note(`${map.name} — ${map.blurb}`);
    });
    mapBar.appendChild(button);
  }
}

// Browsers refuse to start audio until the page has been interacted with, so it
// begins on the first click or key rather than at load.
for (const kind of ["click", "keydown", "pointerdown"]) {
  window.addEventListener(kind, () => initAudio(), { once: true });
}

// Setup is folded away while you play, and opening it pauses — every control in
// there changes the match you are in or starts a different one, and reading a
// map list while your peasants are being killed is not a choice anyone wants.
const setupPanel = document.getElementById("setup");
const setupToggle = document.getElementById("setup-toggle");
let pausedBySetup = false;

setupToggle.addEventListener("click", () => {
  const open = setupPanel.classList.toggle("hidden") === false;
  setupToggle.classList.toggle("open", open);
  setupToggle.textContent = open ? "Close setup" : "Match setup";

  if (open && running) {
    running = false;
    pausedBySetup = true;
    statusEl.textContent = "paused — match setup";
  } else if (!open && pausedBySetup) {
    running = true;
    pausedBySetup = false;
    statusEl.textContent = "";
    lastTime = performance.now();
    accumulator = 0;
  }
});

// Music is a separate switch from effects, and remembers itself.
//
// One "sound" button for both is the wrong shape: plenty of people want the
// horns and the fighting but not a score playing under a call, and being made
// to choose between silence and both is why they turn everything off.
const MUSIC_KEY = "dominion.music.v1";
/**
 * Volume levels, remembered across sessions.
 *
 * Stored as 0..100 integers because a slider IS an integer control; round
 * tripping through a float means the handle can come back a hair off where the
 * player left it.
 */
const SFX_VOL_KEY = "dominion.sfxVolume";
const MUS_VOL_KEY = "dominion.musicVolume";

function readLevel(key, fallback) {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : fallback;
}

let musicOff = localStorage.getItem(MUSIC_KEY) === "off";
setMusicMuted(musicOff);

// --- Volume, per system ------------------------------------------------------
//
// Two levels rather than one, because "the game audible, the soundtrack off" is
// a real and common preference that a single master control cannot express.
const sfxSlider = document.getElementById("sfxvol");
const musSlider = document.getElementById("musvol");

if (sfxSlider) {
  sfxSlider.value = String(readLevel(SFX_VOL_KEY, 90));
  setSfxVolume(Number(sfxSlider.value) / 100);
  sfxSlider.addEventListener("input", () => {
    setSfxVolume(Number(sfxSlider.value) / 100);
    try { localStorage.setItem(SFX_VOL_KEY, sfxSlider.value); } catch { /* private browsing */ }
  });
}
if (musSlider) {
  musSlider.value = String(readLevel(MUS_VOL_KEY, 100));
  setMusicVolume(Number(musSlider.value) / 100);
  musSlider.addEventListener("input", () => {
    setMusicVolume(Number(musSlider.value) / 100);
    try { localStorage.setItem(MUS_VOL_KEY, musSlider.value); } catch { /* private browsing */ }
  });
}

const musicBtn = document.getElementById("music");
function refreshMusic() {
  musicBtn.textContent = musicOff ? "Score: off" : "Score: on";
}
musicBtn.addEventListener("click", () => {
  musicOff = !musicOff;
  setMusicMuted(musicOff);
  try {
    localStorage.setItem(MUSIC_KEY, musicOff ? "off" : "on");
  } catch {
    /* private browsing; the setting just will not persist */
  }
  if (!musicOff) siegeMusic();
  refreshMusic();
});
refreshMusic();

document.getElementById("help").addEventListener("click", () => primer(true));

// The prototype notice, shut for good once shut. It is honest and worth saying
// once; it is not worth the top of the screen every session.
{
  const proto = document.getElementById("proto");
  const HIDE_KEY = "dominion.proto.v1";
  if (localStorage.getItem(HIDE_KEY) === "hidden") proto.classList.add("hidden");
  document.getElementById("proto-hide").addEventListener("click", () => {
    proto.classList.add("hidden");
    try {
      localStorage.setItem(HIDE_KEY, "hidden");
    } catch {
      /* private browsing; it will be back next time, which is survivable */
    }
  });
}

const soundBtn = document.getElementById("sound");
function refreshSound() {
  soundBtn.textContent = isMuted() ? "Sound: off" : "Sound: on";
}
soundBtn.addEventListener("click", () => {
  initAudio();
  toggleMute();
  refreshSound();
});
refreshSound();

// --- Opponent picker ---------------------------------------------------------

const ladderBar = document.getElementById("ladder");

function refreshLadder() {
  ladderBar.innerHTML = "";

  const label = document.createElement("span");
  label.className = "hint";
  label.textContent = "opponent:";
  ladderBar.appendChild(label);

  TIERS.forEach((t, i) => {
    const unlocked = i <= beaten + 1;
    const button = document.createElement("button");
    button.innerHTML =
      `<b>${i + 1}. ${t.name}</b>` +
      (t.handicap !== 1 ? ` <span class="cost">+${Math.round((t.handicap - 1) * 100)}% gold</span>` : "");
    button.title = unlocked
      ? `${t.blurb}${t.handicap !== 1 ? "\n\nThis one is handed extra income — the only tier that is." : ""}`
      : `Beat ${TIERS[i - 1].name} to unlock.`;
    button.classList.toggle("selected", i === tier);
    button.disabled = !unlocked;
    if (!unlocked) button.classList.add("unaffordable");
    button.addEventListener("click", () => {
      if (i === tier) return;
      tier = i;
      restart(sim.seed);
    });
    ladderBar.appendChild(button);
  });
}

// --- Online 1v1 --------------------------------------------------------------

const netStatus = document.getElementById("net-status");

function setNetStatus(text, kind = "") {
  netStatus.textContent = text;
  netStatus.className = `hint ${kind}`;
}

/**
 * Two peers stopped agreeing. Do not quietly carry on: two players having
 * different, confident, contradictory matches is worse than stopping, and on a
 * ladder with anything at stake it is indistinguishable from cheating.
 *
 * Shared with the rebuild path after a reconnect, which needs the identical
 * behaviour — a match resumed from the log is held to exactly the same standard
 * as one that never dropped.
 */
function netDesync(d) {
  running = false;
  setNetStatus(`desync at tick ${d.tick} — match void`, "bad");
  note(
    `The machines stopped agreeing at tick ${d.tick} ` +
      `(${d.mine} vs ${d.theirs}). The match cannot continue honestly.`
  );
}

function netStall(ms) {
  if (ms > 400) setNetStatus(`waiting for the other player… ${(ms / 1000).toFixed(1)}s`, "bad");
}

/**
 * Begin an online match once the channel is open.
 *
 * Both peers build the SAME simulation from the seed the host chose, and from
 * here neither of them ever sends a position or a health value again — only
 * commands, and a checksum to prove they still agree.
 */
function startNetMatch(link, mySeat, seed, ground) {
  // The host's choice of ground wins. Taking it from the handshake rather than
  // from this tab's own picker is the whole point: two peers on different maps
  // would desync on tick one, and the checksum would correctly call the match
  // void for what is really a setup mistake.
  mapId = MAPS[ground] ? ground : MAP_IDS[0];
  sim = createSim(seed, mapId);
  for (const p of sim.players) {
    p.name = p.id === mySeat ? "You" : `Player ${p.id + 1}`;
  }

  const lockstep = createLockstep({
    sim,
    localPlayer: mySeat,
    // One seat per start on the map. The engine waits for every live seat before
    // it will run a tick, so this number has to match the world, not the room.
    seats: sim.players.map((p) => p.id),
    send: (m, meta) => link.send(m, meta),
    onDesync: netDesync,
    onStall: netStall,
  });

  net = { lockstep, link, seat: mySeat };
  parley = createParley({
    send: (message) => link.send(message),
    onSaid: speak,
  });
  refreshParley();
  selection.unitIds.clear();
  selection.buildingId = null;
  logEl.innerHTML = "";
  scored = true; // the ladder does not count online matches
  accumulator = 0;
  lastTime = performance.now();
  running = true;

  frameHome();

  // Every signalling panel goes away, not just the paste one: the room code and
  // the invite link are meaningless once you are connected, and leaving them on
  // screen invites a third person to try the code.
  hideAllNet();
  closeLobby();

  // The practice controls are HIDDEN online, not merely disabled.
  //
  // A ground picker and five ladder opponents that quietly do nothing are worse
  // than absent: they are five things to wonder about while somebody is
  // attacking you. `refreshMaps()` already locked them; locked and visible was
  // the wrong half of the idea.
  document.getElementById("practice-rows").classList.add("hidden");
  refreshMaps(); // the picker locks itself while online
  // "west" and "east" is a duel's vocabulary and there is no east on a map with
  // three corners.
  setNetStatus(
    sim.players.length > 2
      ? `online — you are player ${mySeat + 1} of ${sim.players.length}`
      : `online — you are the ${mySeat === 0 ? "west" : "east"} manor`,
    "live"
  );
  note(
    `Connected. All ${sim.players.length} machines are running the same battle ` +
    "from the same seed.",
    "event"
  );
  refreshLadder();
  openingHerald();
}

// A handle for driving and inspecting a match from outside the render loop.
//
// This exists because a networked match cannot otherwise be verified: the loop
// runs on requestAnimationFrame, and a browser pane that is not being displayed
// stops compositing and stops calling it — so two tabs that have genuinely
// connected sit at tick 0 looking broken. `pump` advances the lockstep by hand,
// which is the only way to prove two separate browsers actually agree.
//
// Same category as the `?map=` affordance and tools/shot.mjs: a way to check
// from the outside what a human would otherwise have to eyeball. Read-only apart
// from `pump`, and it drives the same code path the loop does rather than a
// parallel one, so it cannot pass while the real thing is broken.
window.__dominion = {
  get sim() { return sim; },
  get net() { return net; },
  // Exposed so a script can work out where on the screen a given building is
  // and click it for real, rather than reaching past the mouse code and calling
  // the simulation directly — which is exactly how the "nothing happens when I
  // click" bug survived a full test suite.
  get cam() { return cam; },
  get selection() { return { units: [...selection.unitIds], building: selection.buildingId }; },
  // One frame of keyboard/edge panning. The camera is driven from the render
  // loop, and a browser pane that is not being displayed never runs one — so
  // without this there is no way to check from a script that the pan keys work,
  // which is exactly the gap the "nothing happens when I click" bug lived in.
  panTick: () => panFromInput(),
  // One refresh of the button bars, for the same reason panTick exists: they are
  // driven from the render loop, a pane that is not displayed never runs one,
  // and the bug this was written to catch — a button rebuilt between mousedown
  // and mouseup never firing a click — is INVISIBLE unless the refresh happens
  // in the middle of a press.
  tickUI: () => refreshBars(),
  get seat() { return seat(); },
  checksum: () => netChecksum(sim),
  status: () => ({
    tick: sim.tick,
    online: !!net,
    seat: seat(),
    waiting: net ? net.lockstep.waiting : false,
    desynced: net ? net.lockstep.desynced : null,
    gold: sim.players.map((p) => Math.floor(p.gold)),
    units: sim.players.map((p) => sim.units.filter((u) => u.owner === p.id).length),
    buildings: sim.buildings.map((b) => `${b.owner}:${b.spec.id}`).join(","),
  }),
  pump(n = 1) {
    let ran = 0;
    for (let i = 0; i < n; i++) {
      if (!net) break;
      net.lockstep.publish();
      if (!net.lockstep.tryAdvance(performance.now())) break;
      ran += 1;
    }
    sim.events.length = 0;
    sim.sounds.length = 0;
    return ran;
  },
};

const netHandlers = () => ({
  onMessage: (m, from) => {
    // A parley is not a command and must never reach the lockstep engine: it
    // carries no tick, and anything the engine does not recognise arriving in
    // the command stream is a desync waiting to happen.
    if (parley && parley.receive(m, from)) return;
    if (net) net.lockstep.receive(m, from);
  },
  // One player gone, the rest playing on — only possible with three seats. The
  // engine turns it into a resignation on a tick every survivor agrees about.
  onLost: (seat) => {
    if (!net) return;
    net.lockstep.lost(seat);
    note(`${sim.players[seat]?.name ?? "A player"} has left the match.`, "alert");
  },

  // SOMEBODY'S CONNECTION DROPPED, AND THE MATCH DOES NOT STOP FOR IT.
  //
  // Their chair is held while they try to get back. We stop waiting for their
  // orders — otherwise one person's wifi freezes everybody, which is the thing
  // the pause key was taken away to prevent — and their army simply stands
  // there, which is exactly as much advantage as being disconnected should give.
  onAway: (seat, waitedSeconds) => {
    if (seat === seat0()) {
      // It is OUR connection that went. Nothing to do but say so honestly and
      // keep trying; the link is already working on it.
      setNetStatus(
        waitedSeconds ? `connection lost — getting back in (${waitedSeconds}s)` : "connection lost — getting back in",
        "bad"
      );
      return;
    }
    if (!net) return;
    net.lockstep.away(seat);
    note(`${sim.players[seat]?.name ?? "A player"} lost their connection. Holding their seat.`, "alert");
    setNetStatus(`${sim.players[seat]?.name ?? "a player"} is reconnecting…`, "bad");
  },

  onBack: (seat) => {
    if (!net) return;
    net.lockstep.rejoin(seat);
    note(`${sim.players[seat]?.name ?? "A player"} is back.`, "event");
    setNetStatus(`online — you are player ${net.seat + 1} of ${sim.players.length}`, "live");
  },

  /**
   * We got our seat back. Rebuild the match from the relay's record of it.
   *
   * The simulation is thrown away and built again from the seed, then replayed
   * through every command that has been issued. That is not a heavy hammer, it
   * is the cheapest correct option: a match is a pure function of its seed and
   * its commands, so a rebuild is exact by construction where patching a
   * half-advanced simulation would be a guess. Measured at 0.05–0.08 ms/tick, a
   * twenty minute match comes back in about two seconds.
   */
  onResume: ({ seat, setup, log, through }) => {
    const ground = MAPS[setup?.mapId] ? setup.mapId : MAP_IDS[0];
    mapId = ground;
    sim = createSim(setup.seed, ground);
    for (const p of sim.players) p.name = p.id === seat ? "You" : `Player ${p.id + 1}`;

    const lockstep = createLockstep({
      sim,
      localPlayer: seat,
      seats: sim.players.map((p) => p.id),
      send: (m, meta) => net.link.send(m, meta),
      onDesync: netDesync,
      onStall: netStall,
    });

    const at = lockstep.catchUp(log, through);
    net = { lockstep, link: net.link, seat };

    selection.unitIds.clear();
    selection.buildingId = null;
    accumulator = 0;
    lastTime = performance.now();
    running = true;
    frameHome();
    refreshBars();

    setNetStatus(`online — you are player ${seat + 1} of ${sim.players.length}`, "live");
    note(`Back in, at ${Math.floor(at / TICKS_PER_SECOND)}s. Nothing was missed — the match was rebuilt from its orders.`, "event");
  },

  // ALWAYS say why, and always stop the clock. A connection that ends without
  // saying so leaves the game running against a player who is not there, which
  // reads as "my units stopped responding" rather than "the match is over".
  onClose: (reason) => {
    running = false;
    setNetStatus(reason ? `match ended — ${reason}` : "the other player disconnected", "bad");
    note(reason ? `The match ended: ${reason}.` : "The other player disconnected.", "alert");
  },
});

/** Which seat we are, safely, before or after a rebuild. */
const seat0 = () => (net ? net.seat : 0);

// --- Starting a match ---------------------------------------------------------
//
// The relay turns "paste this 1.1KB blob at each other" into "tell them KX7PM",
// and now also carries the match itself. One code, one socket, one failure mode.
const roomBox = document.getElementById("net-room");
const roomCodeEl = document.getElementById("net-code");
const roomLinkEl = document.getElementById("net-link");
const joinBox = document.getElementById("net-joinbox");
const joinInput = document.getElementById("net-joincode");

function showRoom(code) {
  const link = new URL(location.href);
  link.searchParams.delete("warm");
  link.searchParams.delete("tier");
  link.searchParams.set("join", code);

  roomCodeEl.textContent = code;
  roomLinkEl.value = link.href;
  roomBox.classList.remove("hidden");

  // The lobby is the copy anybody actually reads; the panel inside "Match setup"
  // is the old home and stays only so a match started from inside a running
  // game still shows its code.
  lobbyCodeEl.textContent = code;
  lobbyLinkEl.value = link.href;
  lobbyHostNoteEl.textContent = "Send them the link. The room waits twenty minutes.";
  renderSeats(1);
}

function hideAllNet() {
  roomBox.classList.add("hidden");
  joinBox.classList.add("hidden");
}

/** The seed is the host's to choose, and travels with the offer. */
const freshSeed = () => (Date.now() % 100000) | 0;

/**
 * Host a match.
 *
 * One path now, not three. The link resolves only when the other player is
 * genuinely connected and has confirmed the seed, so reaching the next line
 * means the match can actually start — there is no longer a state where both
 * players are told "connecting" by something that has already failed.
 */
async function hostMatch() {
  const seed = freshSeed();
  hideAllNet();
  setNetStatus("opening a room…");

  try {
    const link = await linkHost({
      seed,
      players: lobbySeats,
      // Read when the guests arrive, not now — the host may still be choosing.
      ground: () => mapId,
      onCode: (code) => {
        showRoom(code);
        setNetStatus(`room ${code} — waiting for the other player`);
      },
      onPeer: (filled, seats) => {
        renderSeats(filled);
        lobbyHostNoteEl.textContent =
          filled >= seats
            ? "Everyone is in. Starting…"
            : `${filled} of ${seats} here — waiting for the rest.`;
        setNetStatus(filled >= seats ? "everyone is here — starting…" : `${filled}/${seats} here`);
      },
      ...netHandlers(),
    });
    startNetMatch(link, 0, seed, link.mapId);
  } catch (error) {
    setNetStatus(`could not host — ${error.message}`, "bad");
    lobbyHostNoteEl.textContent = `Could not open the room: ${error.message}.`;
    lobbyCodeEl.textContent = "·····";
    roomBox.classList.add("hidden");
  }
}

/** Join a match by code. Same story: it either starts or it says why not. */
async function joinMatch(code) {
  hideAllNet();
  setNetStatus(`joining ${code}…`);

  try {
    const link = await linkJoin(code, {
      ...netHandlers(),
      onPeer: (filled, seats) => {
        lobbyJoinNoteEl.textContent =
          filled >= seats ? "In. Waiting for the host…" : `${filled} of ${seats} here…`;
      },
    });
    // The seat is the relay's to hand out, not this tab's to assume. It used to
    // be a hardcoded 1, which is right for a duel and wrong the moment a third
    // person joins — two guests would both have believed they were player 2.
    startNetMatch(link, link.seat, link.seed, link.mapId);
  } catch (error) {
    setNetStatus(`could not join — ${error.message}`, "bad");
    // In the lobby this is the ONLY thing on screen, so it has to carry the
    // whole explanation — and leave the player able to try again rather than
    // stranded on a dead screen.
    lobbyJoinNoteEl.textContent = `Could not join ${code} — ${error.message}.`;
    if (lobbyEl.classList.contains("hidden")) note(`Could not join ${code}: ${error.message}.`, "alert");
  }
}

document.getElementById("net-host").addEventListener("click", () => {
  if (!relayAvailable()) {
    return setNetStatus("this build has no relay configured", "bad");
  }
  hostMatch();
});

document.getElementById("net-join").addEventListener("click", () => {
  if (!relayAvailable()) {
    return setNetStatus("this build has no relay configured", "bad");
  }
  hideAllNet();
  joinBox.classList.remove("hidden");
  joinInput.value = "";
  joinInput.focus();
  setNetStatus("type the code they gave you");
});

document.getElementById("net-joingo").addEventListener("click", () => {
  const code = joinInput.value.trim().toUpperCase();
  if (code.length < 4) return setNetStatus("that code looks too short", "bad");
  joinMatch(code);
});
joinInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.getElementById("net-joingo").click();
});

document.getElementById("net-copylink").addEventListener("click", () => {
  roomLinkEl.select();
  navigator.clipboard?.writeText(roomLinkEl.value);
  setNetStatus("link copied — send it to the other player");
});

// --- The lobby ----------------------------------------------------------------
//
// Everything about opening and joining a room, on a screen of its own with none
// of the game behind it. The old room controls lived inside "Match setup",
// alongside the ground picker and the five ladder opponents — so the first
// thing anyone saw when they wanted to play a friend was a page of settings for
// the game they had not chosen.

const lobbyEl = document.getElementById("lobby");
const lobbyNoteEl = document.getElementById("lobby-note");
const lobbyCodeEl = document.getElementById("lobby-code");
const lobbyLinkEl = document.getElementById("lobby-link");
const lobbySeatListEl = document.getElementById("lobby-seatlist");
const lobbyHostNoteEl = document.getElementById("lobby-hostnote");
const lobbyJoinNoteEl = document.getElementById("lobby-joinnote");
const lobbyJoinCodeEl = document.getElementById("lobby-joincode");

/** How many people this room is for. Two until the N-seat work lands. */
let lobbySeats = 2;

function showLobbyStep(which) {
  for (const name of ["choose", "host", "join"]) {
    document.getElementById(`lobby-${name}`).classList.toggle("hidden", name !== which);
  }
  document.getElementById("lobby-back").classList.toggle("hidden", which === "choose");
}

function openLobby(step = "choose") {
  lobbyEl.classList.remove("hidden");
  document.body.classList.add("lobbying");
  showLobbyStep(step);
}

function closeLobby() {
  lobbyEl.classList.add("hidden");
  document.body.classList.remove("lobbying");
}

function lobbyNote(text, kind = "") {
  lobbyNoteEl.textContent = text;
  lobbyNoteEl.className = kind;
}

/**
 * Who is in the room so far.
 *
 * A code and no feedback is the worst possible waiting screen: there is no way
 * to tell whether your friend typed it wrong, is still reading the message, or
 * arrived a minute ago and you missed it.
 */
function renderSeats(filled = 1) {
  lobbySeatListEl.innerHTML = "";
  for (let i = 0; i < lobbySeats; i++) {
    const row = document.createElement("div");
    const here = i < filled;
    row.className = `seat-row${here ? " filled" : ""}${i === 0 ? " you" : ""}`;
    row.innerHTML =
      `<span class="seat-who">${i === 0 ? "You" : `Player ${i + 1}`}</span>` +
      `<span class="seat-wait">${here ? "ready" : "waiting…"}</span>`;
    lobbySeatListEl.appendChild(row);
  }
}

/** The ground the host picks. Only the host's choice can win, so only they see it. */
function buildLobbyGrounds() {
  const host = document.getElementById("lobby-grounds");
  host.innerHTML = "";
  // Only grounds built for this many players. A three-seat map in a two-player
  // room would create a third hall with nobody behind it: no orders, no AI, and
  // a manor that cannot lose because nobody is attacking it.
  const fits = MAP_IDS.filter((id) => (MAPS[id].seats ?? 2) === lobbySeats);
  if (!fits.includes(mapId)) mapId = fits[0];
  for (const id of fits) {
    const button = document.createElement("button");
    button.textContent = MAPS[id].name;
    button.classList.toggle("selected", id === mapId);
    button.addEventListener("click", () => {
      mapId = id;
      buildLobbyGrounds();
    });
    host.appendChild(button);
  }
}

function buildLobbySeatPicker() {
  const host = document.getElementById("lobby-seats");
  host.innerHTML = "";
  for (const n of [2, 3]) {
    const button = document.createElement("button");
    button.textContent = `${n} players`;
    button.classList.toggle("selected", n === lobbySeats);
    // Only offer a size some ground was built for. Three players needs a map
    // with three starts, and there is one.
    const grounds = MAP_IDS.filter((id) => (MAPS[id].seats ?? 2) === n);
    button.disabled = grounds.length === 0;
    button.title = grounds.length ? "" : `No ground is built for ${n} players yet`;
    button.addEventListener("click", () => {
      lobbySeats = n;
      buildLobbySeatPicker();
      // The grounds depend on the size — a two-seat map cannot hold three — and
      // forgetting this left the picker offering maps the room could not use.
      buildLobbyGrounds();
      renderSeats(0);
    });
    host.appendChild(button);
  }
}

/**
 * How many players, and where — BOTH decided before the room is opened.
 *
 * They used to be pickers sitting next to a live room code, which does not work
 * and did not: the relay allocates the seats when the room is created, so
 * choosing three afterwards showed three chairs in the lobby while the room
 * itself only had two — and the ground list kept offering two-seat maps because
 * nothing refreshed it. Both are the same mistake as the ground picker that was
 * read at open time instead of at start time: an control that looks live and is
 * not.
 */
document.getElementById("lobby-create").addEventListener("click", () => {
  showLobbyStep("host");
  buildLobbySeatPicker();
  buildLobbyGrounds();
  renderSeats(0);
  document.getElementById("lobby-open-room").classList.add("hidden");
  document.getElementById("lobby-open").classList.remove("hidden");
  lobbyCodeEl.textContent = "·····";
  lobbyLinkEl.value = "";
  lobbyHostNoteEl.textContent = "";
});

document.getElementById("lobby-open").addEventListener("click", async () => {
  // The size is fixed from here: the relay has allocated the chairs.
  for (const b of document.querySelectorAll("#lobby-seats button")) b.disabled = true;
  document.getElementById("lobby-open").classList.add("hidden");
  document.getElementById("lobby-open-room").classList.remove("hidden");
  renderSeats(1);
  lobbyHostNoteEl.textContent = "Opening a room…";
  await hostMatch();
});

document.getElementById("lobby-joinstep").addEventListener("click", () => {
  showLobbyStep("join");
  lobbyJoinCodeEl.value = "";
  lobbyJoinCodeEl.focus();
  lobbyJoinNoteEl.textContent = "";
});

document.getElementById("lobby-joingo").addEventListener("click", () => {
  const code = lobbyJoinCodeEl.value.trim().toUpperCase();
  if (code.length < 4) {
    lobbyJoinNoteEl.textContent = "That code looks too short.";
    return;
  }
  lobbyJoinNoteEl.textContent = `Joining ${code}…`;
  joinMatch(code);
});
lobbyJoinCodeEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.getElementById("lobby-joingo").click();
});

document.getElementById("lobby-copy").addEventListener("click", () => {
  lobbyLinkEl.select();
  navigator.clipboard?.writeText(lobbyLinkEl.value);
  lobbyHostNoteEl.textContent = "Link copied. Send it to them.";
});

document.getElementById("lobby-back").addEventListener("click", () => showLobbyStep("choose"));
document.getElementById("lobby-leave").addEventListener("click", () => {
  location.href = "./index.html";
});

// `?lobby=host|join` freezes a lobby step on screen without opening a room.
//
// Same family as `?warm=`, `?tier=` and `?herald=`: the host step only exists
// between clicking a button and somebody arriving, so it cannot be photographed
// or judged from outside without this. Design you cannot look at is design you
// are guessing at.
{
  const want = new URLSearchParams(location.search).get("lobby");
  if (want === "host" || want === "join") {
    openLobby(want);
    if (want === "host") {
      buildLobbySeatPicker();
      buildLobbyGrounds();
      renderSeats(1);
      lobbyCodeEl.textContent = "KX7PM";
      lobbyLinkEl.value = `${location.origin}/dominion.html?mode=friend&join=KX7PM`;
      lobbyHostNoteEl.textContent = "Send them the link. The room waits twenty minutes.";
    }
  }
}

/**
 * A match this tab was already in, before it reloaded.
 *
 * Checked BEFORE the invite link, because a player whose browser crashed will
 * very often reopen the same link — and joining afresh is the wrong answer when
 * their seat is still being held with their army in it.
 */
async function resumeHeldSeat() {
  const held = heldSeat();
  if (!held) return false;

  openLobby("choose");
  lobbyNote(`Getting you back into ${held.code}…`);
  const handlers = netHandlers();
  try {
    const got = await linkResume(held, handlers);
    // `onResume` builds the simulation and the engine; it needs the link in
    // place first, because that is what it will publish through.
    net = { lockstep: null, link: got.link, seat: got.seat };
    handlers.onResume(got);
    return true;
  } catch (error) {
    forgetSeat();
    lobbyNote(`That match could not be rejoined — ${error.message}.`, "bad");
    return false;
  }
}

// The invite link goes straight to the code box with the code already in it.
// One click from a message to a match is the whole reason the link exists.
if (FRIEND_MODE && !new URLSearchParams(location.search).get("lobby")) {
  // A seat we already hold beats the invite link: a player whose browser crashed
  // will usually reopen the same link, and joining afresh is the wrong answer
  // while their army is still standing on the board waiting for them.
  resumeHeldSeat().then((back) => {
    if (back) return;
    if (!relayAvailable()) {
      openLobby("choose");
      lobbyNote("This build has no relay configured, so online play is off.", "bad");
    } else if (INVITE) {
      openLobby("join");
      lobbyJoinCodeEl.value = INVITE.trim().toUpperCase();
      lobbyJoinNoteEl.textContent = `Joining ${lobbyJoinCodeEl.value}…`;
      joinMatch(lobbyJoinCodeEl.value);
    } else {
      openLobby("choose");
    }
  });
}

// --- One way in ---------------------------------------------------------------
//
// There used to be a second path here: swap 1.1KB connection blobs by hand, no
// relay involved. It existed because the relay was a single point of failure
// for STARTING a match, and losing it should have cost convenience rather than
// the mode.
//
// It is gone, because it was not a fallback. It produced the identical WebRTC
// connection as the relay path, so it failed for exactly the same reason and in
// exactly the same silence — with the added indignity of asking two people to
// copy base64 at each other first. A fallback that shares the failure mode of
// the thing it backs up is not redundancy, it is a second way to lose.
//
// The relay is now the only path, and it is the one that was already working:
// signalling never failed in the match that broke, the direct connection did.

// --- Being told you are under attack -----------------------------------------
//
// THE SINGLE MOST IMPORTANT THING THE GAME CAN SAY, AND IT SAID NOTHING.
//
// On a map three times the size of a screen, the first sign that your peasants
// were being killed was noticing the gold had stopped. There was no message, no
// sound, and no way to find the fight — you learned about it from the result
// screen. Every RTS ever made says "your base is under attack" for this reason.
//
// Implemented by watching health, not by adding a rule: the simulation is
// unchanged, this only reads it. One alert at a time, on a cooldown, because an
// alert per hit during a real assault is a wall of red that tells you less than
// one line would.
const ATTACK_COOLDOWN = 9000;
let lastAlarm = 0;
let lastSeenHp = new Map();
let alarmAt = null;   // where to jump to, if there is somewhere

function watchForAttacks() {
  const now = performance.now();
  let hit = null;

  for (const thing of [...sim.buildings, ...sim.sites, ...sim.units]) {
    if (thing.owner !== seat()) continue;
    const was = lastSeenHp.get(thing.id);
    lastSeenHp.set(thing.id, thing.hp);
    if (was !== undefined && thing.hp < was && !hit) hit = thing;
  }

  if (!hit || now - lastAlarm < ATTACK_COOLDOWN) return;
  lastAlarm = now;
  alarmAt = { x: hit.x, y: hit.y };

  const what = hit.spec.isHeart
    ? "Your manor is under attack"
    : hit.spec.worker
      ? "Your peasants are being killed"
      : hit.spec.trains || hit.spec.dropOff || hit.spec.attack
        ? `Your ${hit.spec.name} is under attack`
        : "You are under attack";
  note(`${what} — click here, or press Q`, "alert");
  playCues(["gate_hit"]);
}

// --- Parley ------------------------------------------------------------------

let parley = null;
const parleyBar = document.getElementById("parleybar");
const parleySaid = document.getElementById("parley-said");

/** Show a line, from either side, and let it fade. */
function speak({ mine, mark, say, from = null }) {
  // "them" is enough in a duel and ambiguous with three players — the whole
  // value of a taunt is knowing which of your two enemies sent it.
  const who = mine
    ? "you"
    : from !== null && sim.players.length > 2
      ? `P${from + 1}`
      : "them";
  const line = document.createElement("div");
  line.className = `said ${mine ? "mine" : "theirs"}`;
  line.innerHTML = `<span class="said-mark">${mark}</span>` +
    `<span class="said-who">${who}</span>` +
    `<span class="said-text"></span>`;
  line.querySelector(".said-text").textContent = say;
  parleySaid.appendChild(line);
  // The transcript is a conversation, not a log: three lines is plenty and the
  // oldest goes when a fourth arrives.
  while (parleySaid.children.length > 3) parleySaid.removeChild(parleySaid.firstChild);
  setTimeout(() => line.classList.add("fading"), 6000);
  setTimeout(() => line.remove(), 7000);

  const speaker = mine
    ? "You"
    : sim.players[from ?? (1 - seat())]?.name ?? "They";
  note(`${speaker}: ${say}`, mine ? "info" : "say");
}

function buildParleyBar() {
  parleyBar.innerHTML = "";
  for (const phrase of PHRASES) {
    const button = document.createElement("button");
    button.className = "parley-key";
    button.textContent = phrase.mark;
    button.title = phrase.say;
    button.addEventListener("click", () => {
      const result = parley?.say(phrase.id);
      if (result && !result.ok) note(result.reason, "alert");
    });
    parleyBar.appendChild(button);
  }
}
buildParleyBar();

/** The bar only means anything with somebody on the other end. */
function refreshParley() {
  parleyBar.classList.toggle("hidden", !net);
}
refreshParley();

/**
 * WHAT YOU OWN, BY TYPE, AND WHAT CONDITION IT IS IN.
 *
 * The lesson from watching three Warrior Kings replays: the useful question in a
 * big match is not "what is under my cursor" but "what is my army made of, and
 * is it healthy". They answer it with a permanent stack of rows down the right
 * edge, and it is the single most transferable thing in their interface.
 *
 * Health is aggregated per type rather than shown per unit, because "101
 * spearmen at 94%" is a fact you can act on and a hundred little bars is not.
 *
 * Workers are left out. They are not the army, they are the economy — the
 * peasant count already has its own place in the HUD, and putting Praja at the
 * top of this list would bury the soldiers under the thing you never send to
 * fight.
 */
function refreshRoster() {
  const mine = sim.units.filter(
    (u) => u.owner === seat() && !u.spec.worker && !u.spec.hauler
  );
  if (mine.length === 0) {
    rosterEl.classList.add("hidden");
    return;
  }
  rosterEl.classList.remove("hidden");

  const byType = new Map();
  for (const u of mine) {
    let row = byType.get(u.spec.id);
    if (!row) {
      row = { spec: u.spec, n: 0, hp: 0, maxHp: 0, band: 0 };
      byType.set(u.spec.id, row);
    }
    row.n += 1;
    row.hp += u.hp;
    row.maxHp += u.maxHp;
    if (u.band != null) row.band += 1;
  }

  // Biggest first, then by name, so the list does not reshuffle every time a
  // single man dies — a list that jumps around is a list nobody reads.
  const rows = [...byType.values()].sort(
    (a, b) => b.n - a.n || a.spec.name.localeCompare(b.spec.name)
  );

  rosterEl.innerHTML = rows.map((r) => {
    const frac = r.maxHp > 0 ? r.hp / r.maxHp : 0;
    const state = frac > 0.66 ? "" : frac > 0.33 ? "hurt" : "dying";
    // A formed-up type is marked, because whether a battalion is standing is
    // exactly the thing you want to know before you commit it.
    const formed = r.band === r.n && r.n > 1 ? " ⚑" : "";
    return `<div class="rrow">` +
      `<span class="rname">${r.spec.name}${formed}</span>` +
      `<span class="rcount">${r.n}</span>` +
      `<span class="rbar"><i class="${state}" style="width:${Math.round(frac * 100)}%"></i></span>` +
      `</div>`;
  }).join("");
}

/**
 * WHAT IS SELECTED, IN WORDS.
 *
 * Health, damage, reach, pace and current order for whatever is under the
 * cursor's last click. None of it was shown anywhere before: you could select a
 * Behemoth and a spearman together and the game told you nothing about either.
 *
 * A MIXED SELECTION IS SUMMARISED, NOT AVERAGED. Averaging a Behemoth with two
 * peasants produces a creature that does not exist and numbers nobody can act
 * on; listing the types and their counts is both honest and more useful, because
 * what the player actually wants to know is "what have I got hold of".
 */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What a unit is doing right now, in the words a player would use. */
const JOB_WORDS = {
  mine: "mining", fell: "felling", harvest: "farming", drop: "hauling",
  build: "building", raise: "raising the hall", repair: "mending",
  erect: "assembling", convert: "converting", collect: "loading", deliver: "delivering",
};

function refreshSelection() {
  const picked = sim.units.filter((u) => selection.unitIds.has(u.id));
  const building = sim.buildings.find((b) => b.id === selection.buildingId);

  if (picked.length === 0 && !building) {
    selPanel.classList.add("hidden");
    return;
  }
  selPanel.classList.remove("hidden");

  const stat = (label, value) =>
    `<span class="stat">${label} <b>${value}</b></span>`;

  if (building) {
    const tierName = building.spec.isHeart ? MANOR_TIERS[building.tier].name : building.spec.name;
    const gun = building.spec.isHeart
      ? MANOR_TIERS[building.tier].attack : building.spec.attack;
    selHead.textContent =
      `${tierName}${building.owner === seat() ? "" : " (enemy)"}`;
    const bits = [stat("hp", `${Math.ceil(building.hp)} / ${building.maxHp}`)];
    if (gun) {
      bits.push(stat("damage", gun.damage));
      bits.push(stat("reach", Math.round(gun.range / 32) + " tiles"));
    }
    // A depot's holdings, which used to be invisible: gold sitting in a
    // warehouse is not spendable and the player had no way to see how much was
    // waiting on a cart.
    if (building.spec.depot) {
      for (const r of RESOURCES) {
        if (building.store[r] > 0) bits.push(stat(r, Math.floor(building.store[r])));
      }
    }
    if (building.queue.length) bits.push(stat("training", building.queue.length));
    selStats.innerHTML = bits.join("");
    selOrder.textContent = building.raising
      ? `being raised to a ${MANOR_TIERS[building.raising.to].name} — ` +
        `${Math.round((building.raising.work / building.raising.needed) * 100)}%`
      : building.spec.lore ?? "";
    return;
  }

  const byType = new Map();
  for (const u of picked) {
    byType.set(u.spec.id, (byType.get(u.spec.id) ?? 0) + 1);
  }

  if (byType.size === 1) {
    const u = picked[0];
    const formed = picked.filter((x) => x.band != null).length;
    selHead.textContent =
      (picked.length === 1 ? u.spec.name : plural(picked.length, u.spec.name)) +
      (formed === picked.length && picked.length > 1 ? " — battalion" : "");
    const hp = picked.reduce((a, x) => a + x.hp, 0);
    const maxHp = picked.reduce((a, x) => a + x.maxHp, 0);
    const bits = [stat("hp", `${Math.ceil(hp)} / ${maxHp}`)];
    if (u.spec.damage > 0) {
      bits.push(stat("damage", u.spec.damage));
      // Damage per second, because "9 damage on a 20 tick reload" is a number
      // only the person who wrote it can compare with another number.
      bits.push(stat("dps", (u.spec.damage / (u.spec.reload / TICKS_PER_SECOND)).toFixed(1)));
      bits.push(stat("reach", (u.spec.range / 32).toFixed(1) + " tiles"));
    }
    if (u.spec.speed > 0) bits.push(stat("pace", Math.round(u.spec.speed)));
    if (u.spec.ammo) {
      const shots = picked.reduce((a, x) => a + (x.ammo ?? 0), 0);
      const full = picked.length * u.spec.ammo;
      bits.push(stat("shots", `${shots} / ${full}`));
    }
    if (u.spec.capacity) bits.push(stat("carries", u.spec.capacity));
    const laden = picked.filter((x) => x.carrying > 0);
    if (laden.length) {
      const total = laden.reduce((a, x) => a + x.carrying, 0);
      bits.push(stat("carrying", `${Math.floor(total)} ${laden[0].carryKind}`));
    }
    selStats.innerHTML = bits.join("");
  } else {
    selHead.textContent = plural(picked.length, "unit");
    selStats.innerHTML = [...byType.entries()]
      .map(([id, n]) => stat(UNITS[id].name, n))
      .join("");
  }

  // What they are doing, counted rather than guessed at.
  const doing = new Map();
  for (const u of picked) {
    const word = u.job ? (JOB_WORDS[u.job.kind] ?? u.job.kind)
      : u.chaseId != null ? "attacking"
        : u.holding ? "holding"
          : u.order ? "moving" : "idle";
    doing.set(word, (doing.get(word) ?? 0) + 1);
  }
  selOrder.textContent = [...doing.entries()]
    .map(([word, n]) => (picked.length === 1 ? word : `${n} ${word}`))
    .join(" · ");
}

// --- The three moments -------------------------------------------------------
//
// A match that starts because a timer started, and ends because a status line
// changed colour, has no shape and nobody remembers it. See src/herald.js.

/** How long the match ran, as something a person would say. */
function spell(ticks) {
  const total = Math.round(ticks / TICKS_PER_SECOND);
  const m = Math.floor(total / 60);
  return m > 0 ? `${m}m ${String(total % 60).padStart(2, "0")}s` : `${total}s`;
}

/** Everything the herald reports is counted from the match, not guessed. */
function tally() {
  const mine = sim.units.filter((u) => u.owner === seat());
  return [
    ["held", spell(sim.tick)],
    ["peasants", String(mine.filter((u) => u.spec.worker).length)],
    ["soldiers", String(mine.filter((u) => !u.spec.worker).length)],
    ["gold", String(Math.floor(sim.players[seat()].gold))],
    ["timber", String(Math.floor(sim.players[seat()].timber))],
    ["food", String(Math.floor(sim.players[seat()].food))],
    ["standing", String(sim.buildings.filter((b) => b.owner === seat()).length)],
  ];
}

// --- The first time anyone opens this -----------------------------------------
//
// Your opponent has never played it. The opening herald names the ground and
// blows a horn, which is atmosphere, not instruction — and a real-time strategy
// game with a peasant economy has three rules a newcomer cannot guess:
// buildings do not build themselves, troops do not move themselves, and gold
// does not arrive by itself.
//
// Shown once, remembered, and reachable afterwards from the map hint. A tutorial
// nobody can dismiss is worse than no tutorial; one nobody can find again is
// almost as bad.
const SEEN_KEY = "dominion.primer.v1";

function primer(force = false) {
  if (!force && localStorage.getItem(SEEN_KEY) === "yes") return false;
  try {
    localStorage.setItem(SEEN_KEY, "yes");
  } catch {
    /* private browsing; it will just show again */
  }

  herald({
    kind: "start",
    crest: "⚒",
    title: "Four rules",
    subtitle: "everything else you can work out",
    steps: [
      "Click your hall and raise Praja. They are your whole economy.",
      "You need three things. Right-click a gold SEAM to mine, a WOOD to fell " +
        "for timber, and your own FARM to bring in food. Buildings cost timber; " +
        "soldiers cost food, and go on eating it for as long as they live.",
      "Right-click a foundation to raise it. Buildings do not build themselves.",
      "Troops muster and wait. Select them and right-click to move, " +
        "or right-click an enemy to attack.",
    ],
    line: "An army you cannot feed starves. Raise one and you have started a clock.",
    actions: [{ label: "Understood", onPick: () => {} }],
  });
  return true;
}

function openingHerald() {
  // The primer takes precedence on a first visit: two heralds at once would
  // stack, and the one that teaches you to play matters more than the one that
  // names the field.
  if (primer()) return;

  const map = MAPS[mapId];
  const foe = net
    ? (seat() === 0 ? "the east manor" : "the west manor")
    : tierAt(tier).name;

  herald({
    kind: "start",
    crest: "⚔",
    title: map.name,
    subtitle: net ? `1v1 · you hold ${seat() === 0 ? "the west" : "the east"}` : `against ${foe}`,
    line: opener(sim.seed),
  });
  // The horn. `call` is the war horn already in the synthesiser — the same one
  // Warden uses when you invite a wave early, which is exactly the right
  // association: something has been set in motion that cannot be called back.
  initAudio();
  playCues(["call"]);
  siegeMusic();
}

function declareResult(won) {
  const ladder = !net && won && tier < MAX_TIER
    ? `${TIERS[tier + 1].name} awaits`
    : null;

  // The one moment in the match that deserves a recorded sound rather than a
  // synthesised one. Raised here rather than from the simulation because a win
  // is a thing that happens to the PLAYER, not a thing that happens on the
  // field — the loser must not hear it.
  if (won) playCues(["victory"]);

  herald({
    kind: won ? "victory" : "defeat",
    crest: won ? "♛" : "†",
    title: won ? "The field is yours" : "Your hall has fallen",
    subtitle: ladder ?? (net ? "1v1" : tierAt(tier).name),
    figures: tally(),
    line: won ? winLine(sim.seed) : lossLine(sim.seed),
    actions: [
      { label: "Fight again", onPick: () => restart(sim.seed + 1) },
      { label: "Back to the menu", onPick: () => { location.href = "./"; } },
    ],
  });
}

// --- Loop --------------------------------------------------------------------

function frame(now) {
  accumulator += now - lastTime;
  lastTime = now;

  if (!running || sim.over) accumulator = 0;

  let ticks = 0;
  while (accumulator >= MS_PER_TICK && ticks < 5) {
    if (net) {
      // Online: the simulation only moves when BOTH peers' commands for the
      // next tick have arrived. Publishing happens every tick regardless, even
      // with nothing to say — silence is indistinguishable from a lost packet.
      net.lockstep.publish();
      if (!net.lockstep.tryAdvance(now)) break;
    } else {
      // Every seat that is not yours is played by the ladder AI. This was
      // `think(sim, 1, tier)` — correct while every map had exactly two starts,
      // and on a three-seat map it left the third hall standing there doing
      // nothing at all while two players fought over it.
      for (const p of sim.players) {
        if (p.id !== seat() && !p.out) think(sim, p.id, tier);
      }
      step(sim);
    }
    accumulator -= MS_PER_TICK;
    ticks += 1;
  }
  if (accumulator > MS_PER_TICK * 20) accumulator = 0;

  // Battle events are the only thing the SIMULATION says, and they are always
  // worth seeing: a building finished, a foundation pulled down, a manor lost.
  for (const event of sim.events) note(event.text, event.big ? "alert" : "event");
  sim.events.length = 0;
  // ONLY WHAT IS YOURS, PLUS THE WORLD'S OWN NOISES.
  //
  // Every cue used to be played to everybody: you heard the enemy training
  // people, raising buildings and losing men, from anywhere on a map that is now
  // two hundred and eighty tiles across. That reads as a noisy, confusing game
  // and it is really the game telling you things you cannot see.
  //
  // A cue with no owner belongs to the world — a seam running dry, a bridge
  // going into the water, the ring of a fight — and everybody hears those.
  playCues(
    sim.sounds
      .splice(0, sim.sounds.length)
      .filter((c) => c.owner === null || c.owner === seat())
      .map((c) => c.name)
  );

  watchForAttacks();

  // Selections go stale as things die.
  for (const id of [...selection.unitIds]) {
    if (!sim.units.some((u) => u.id === id)) selection.unitIds.delete(id);
  }

  goldEl.textContent = Math.floor(sim.players[seat()].gold);
  timberEl.textContent = Math.floor(sim.players[seat()].timber);
  // Grain as stock-over-capacity, the way Warrior Kings shows it. A bare number
  // cannot tell you the barns are full, and full barns are the moment to build
  // another storehouse — which is the whole point of the ceiling.
  const barns = granaryOf(sim, seat());
  const grain = Math.floor(sim.players[seat()].food);
  foodEl.textContent = `${grain} / ${barns}`;
  foodEl.classList.toggle("full", barns > 0 && grain >= barns - 1);

  // Your garland, once you have one. Blank until then rather than "none": an
  // empty space reads as "not yet", and the word "none" reads as a choice made.
  const path = sim.players[seat()].path;
  pathEl.textContent = path
    ? PATHS[path].name + (sim.players[seat()].pathLocked ? " (set)" : "")
    : "";

  refreshSelection();
  refreshRoster();

  // The bed follows the garland. `pathMusic` is a no-op when the bed is already
  // the right one, so calling it every frame costs nothing and means the switch
  // happens on the tick the house finishes rather than at some later checkpoint.
  if (!musicOff) pathMusic(sim.players[seat()].path);
  // Peasants and soldiers counted separately. They are not interchangeable —
  // one number for both hides the single most important thing about your
  // position, which is whether you have an economy or an army and how lopsided
  // it is.
  const mine = sim.units.filter((u) => u.owner === seat());
  const theirs = sim.units.filter((u) => u.owner !== seat());
  const workers = mine.filter((u) => u.spec.worker).length;
  const idlers = mine.filter((u) => u.spec.worker && !u.job).length;
  peasantEl.textContent = idlers > 0 ? `${workers} (${idlers} idle)` : String(workers);
  peasantEl.classList.toggle("warn", idlers > 0);
  // "yours v theirs" is right for a duel and hides the shape of a free-for-all:
  // 20 v 40 could be two enemies of twenty each, or one of forty who has already
  // eaten the other. With three seats each rival is counted separately.
  const rivals = sim.players
    .filter((p) => p.id !== seat() && !p.out)
    .map((p) => sim.units.filter((u) => u.owner === p.id && !u.spec.worker).length);
  popEl.textContent = `${mine.length - workers} v ${rivals.join(" v ") || "—"}`;
  // Population is only worth showing when it is close enough to matter; a
  // permanent "12/120" is noise for the first ten minutes of every match.
  const used = committed(sim, seat());
  popCapEl.textContent = used > POP_CAP * 0.6 ? `${used}/${POP_CAP}` : "";
  popCapEl.classList.toggle("warn", used >= POP_CAP);
  if (sim.over && !scored) {
    scored = true;
    const won = sim.winner === seat();

    if (won && !net) {
      const climbed = tier > beaten;
      if (climbed) {
        beaten = tier;
        saveProgress(beaten);
      }
      statusEl.textContent =
        tier < MAX_TIER
          ? `${tierAt(tier).name} is beaten — ${TIERS[tier + 1].name} awaits.`
          : "The Pretender is beaten. There is nobody left to fight.";
      if (climbed && tier < MAX_TIER) note(`${TIERS[tier + 1].name} unlocked.`);
      refreshLadder();
    } else if (!won) {
      statusEl.textContent = net
        ? "Your manor has fallen."
        : `Your manor has fallen to the ${tierAt(tier).name}.`;
    }
    endMusic(won);
    declareResult(won);
  }
  refreshBars();

  const ghost = buildType && pointer
    ? {
        type: buildType,
        tx: toTile(pointer.x),
        ty: toTile(pointer.y),
        ok: canBuild(sim, 0, buildType, toTile(pointer.x), toTile(pointer.y)).ok,
      }
    : null;

  panFromInput();
  draw(ctx, sim, { cam, selection, dragBox, ghost, pointer });
  requestAnimationFrame(frame);
}

// `?warm=N` fast-forwards N ticks of an offline match before the first frame is
// ever drawn.
//
// This exists for the same reason tools/shot.mjs does. Headless Chrome renders
// the page but never runs requestAnimationFrame — there is no compositor to
// drive it — so a screenshot of a live match always came back as tick zero: two
// manors on an empty field. That made it impossible to check from a script
// whether troops, projectiles or building art actually looked right. Warming up
// runs the SAME think/step pair the loop runs, so what it produces is a real
// match state and not a mock-up of one.
{
  const warm = Number(new URLSearchParams(location.search).get("warm"));
  if (Number.isFinite(warm) && warm > 0) {
    // BOTH sides are played by the ladder AI while warming. Warming only the
    // opponent produced a picture of a fully developed enemy army standing over
    // an empty field, which is a screenshot of nothing. This is an inspection
    // tool, so it should show the game being played.
    for (let i = 0; i < Math.min(warm, 20000) && !sim.over; i++) {
      for (const p of sim.players) if (!p.out) think(sim, p.id, tier);
      step(sim);
    }
    sim.events.length = 0;
    sim.sounds.length = 0;
    const heart = sim.buildings.find((b) => b.owner === 0 && b.spec.isHeart);
    if (heart) centreOn(cam, heart.x, heart.y);
  }
}

refreshBars();
refreshLadder();
refreshMaps();
// The opening herald fires for the FIRST match too, not only for restarts. The
// first one is the only one most people will ever see.
{
  // `?herald=start|victory|defeat` freezes one of the three moments on screen.
  //
  // Same family as `?warm=` and `?tier=`: the opening herald dismisses itself
  // after two and a half seconds, and a result only appears when a match ends,
  // so neither can be photographed or judged from outside without this. Design
  // you cannot look at is design you are guessing at.
  const params = new URLSearchParams(location.search);
  const show = params.get("herald");
  if (show === "victory" || show === "defeat") declareResult(show === "victory");
  // Not while the lobby is up: the opening herald announces a battle, and there
  // is no battle yet. `startNetMatch` fires it when the match actually begins.
  else if (!params.get("warm") && !FRIEND_MODE) openingHerald();
}
if (!FRIEND_MODE) note(`${tierAt(tier).name} — ${tierAt(tier).blurb}`);
note(
  "Peasants are everything: right-click a gold seam to work it, and right-click " +
  "a foundation to raise it. Nothing you build appears on its own."
);
note(
  "Your troops muster at their barracks and wait. Select them and right-click to " +
  "move, or right-click an enemy to attack. Press . to find an idle peasant."
);
note(
  "Hold Ctrl to give orders in a queue: several right-clicks draw a route they " +
  "will march in turn, and several foundations become a peasant's list of work."
);
requestAnimationFrame(frame);
