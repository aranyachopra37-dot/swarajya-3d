// The title screen.
//
// It is an overlay over the running page rather than a separate document, so
// nothing has to be torn down and rebuilt when the player comes back to it — the
// battle underneath keeps its state, its log and its camera.
//
// The one thing that genuinely matters here: **the simulation is paused while
// this is up.** `main.js` owns a `running` flag and does not call `step()` when
// it is false. Without that, waves would spawn, regiments would walk and the
// gate would fall behind a menu nobody was looking at. Pausing cannot affect a
// replay, because the simulation counts ticks and never wall-clock time — an
// unstepped tick simply does not exist.
//
// This file reads the same data the game does (MAPS, CREED_LORE, WORLD) rather
// than restating any of it, so the menu cannot drift out of step with the rules.

import { MAPS, MAP_IDS, TERRAIN } from "./maps.js";
import { CREED_LORE, WORLD } from "./lore.js";
import { FAMILIES } from "./towers.js";
import { REPLAY_VERSION } from "./replay.js";
// Only the map TABLE, which is plain data. None of Dominion's simulation runs
// on this page — the menu just needs to know what grounds exist and what they
// are called.
import { MAPS as DOM_MAPS, MAP_IDS as DOM_MAP_IDS } from "../dominion/sim.js";

const menuEl = document.getElementById("menu");
const creedsEl = document.getElementById("creeds");
const mapsEl = document.getElementById("menu-maps");
const howtoEl = document.getElementById("howto");
const howtoBtn = document.getElementById("howto-toggle");
const footEl = document.getElementById("menu-foot");

/** Which terrain a map actually contains, so a card can advertise it. */
function terrainsOf(map) {
  const kinds = new Set((map.terrain ?? []).map((zone) => zone.kind));
  return [...kinds].map((k) => TERRAIN[k]?.name ?? k);
}

function buildCreeds() {
  // Ordered as the ages run — what was here before the Empire, the Empire, and
  // what replaces it — rather than in whatever order the data happens to sit in.
  for (const id of ["WILD", "ORDER", "FORGE"]) {
    const creed = CREED_LORE[id];
    const family = FAMILIES[id];

    const card = document.createElement("div");
    card.className = "creed";
    card.style.borderTopColor = family.colour;
    card.innerHTML =
      `<h3 style="color:${family.colour}">${creed.name}</h3>` +
      `<div class="age">${creed.age} — ${creed.era}</div>` +
      `<p>${creed.boon}</p>`;
    creedsEl.appendChild(card);
  }
}

function buildMaps(onPick) {
  for (const id of MAP_IDS) {
    const map = MAPS[id];
    const terrain = terrainsOf(map);

    const card = document.createElement("button");
    card.className = "map-card";
    card.innerHTML =
      `<span class="mname">${map.name}</span>` +
      `<span class="mblurb">${map.blurb}</span>` +
      `<span class="mmeta">Gate ${map.gateHealth}` +
      (terrain.length
        ? ` · <span class="terr">${terrain.join(" · ")}</span>`
        : " · open ground") +
      `</span>`;
    card.addEventListener("click", () => onPick(id));
    mapsEl.appendChild(card);
  }
}

/**
 * The menu's panes, and what "Back" means from each.
 *
 * A flat list with one hardcoded back target was fine while the menu was two
 * deep. It is three deep now — game, then who you are playing, then where — and
 * "Back" that always jumped to the top would throw away two decisions to undo
 * one. The parent is declared next to the pane so the two cannot disagree.
 */
const PANES = {
  modes:    { el: "mode-pane",      parent: null },
  maps:     { el: "map-pane",       parent: "modes" },     // Warden's grounds
  domKind:  { el: "dom-kind-pane",  parent: "modes" },     // computer or people
  domMaps:  { el: "dom-pane",       parent: "domKind" },   // Dominion's grounds
};

let pane = "modes";

/**
 * Show one step of the menu and hide the others.
 *
 * Module-level rather than local to initMenu, because `showMenu` needs it too:
 * when it only knew about two of the panes, coming back from a battle left
 * Dominion's ground picker on screen underneath Warden's.
 *
 * @param {keyof PANES} which
 */
function showPane(which) {
  pane = which;
  for (const [name, spec] of Object.entries(PANES)) {
    document.getElementById(spec.el)?.classList.toggle("hidden", name !== which);
  }
  document.getElementById("menu-back")?.classList.toggle("hidden", !PANES[which].parent);
}

/**
 * The Dominion half of the ground picker.
 *
 * It imports Dominion's map table rather than restating it, for the same reason
 * the Warden cards read MAPS: a second list of map names is a second thing to
 * forget to update. The chosen map travels as `?map=`, which dominion.html
 * already understands.
 */
function buildDominionMaps() {
  const host = document.getElementById("dom-maps");
  if (!host) return;

  for (const id of DOM_MAP_IDS) {
    const map = DOM_MAPS[id];
    const card = document.createElement("button");
    card.className = "map-card";
    card.innerHTML =
      `<span class="mname">${map.name}</span>` +
      `<span class="mblurb">${map.blurb}</span>` +
      `<span class="mmeta">Real-time strategy · ladder or 1v1</span>`;
    card.addEventListener("click", () => {
      location.href = `./dominion.html?map=${encodeURIComponent(id)}`;
    });
    host.appendChild(card);
  }
}

/**
 * Wire the menu up.
 *
 * `onStart(mapId)` begins a battle. `refreshMute()` is handed in rather than
 * imported so the menu never owns audio state — there is one mute flag in
 * audio.js and both buttons read it.
 */
export function initMenu({ onStart, onMute, isMuted }) {
  buildCreeds();
  buildMaps((id) => {
    hideMenu();
    onStart(id);
  });

  // Which game first, then which ground. There was no product-level menu at all
  // before this: opening the site dropped you straight into Warden's map picker
  // as though it were the only thing here, and Dominion was a link hiding in a
  // row of buttons at the bottom. Dominion's cards are built from Dominion's own
  // map table, so the two pages cannot disagree about what exists.
  buildDominionMaps();

  document.getElementById("mode-warden").addEventListener("click", () => showPane("maps"));
  document.getElementById("mode-dominion").addEventListener("click", () => showPane("domKind"));
  document.getElementById("dom-practice").addEventListener("click", () => showPane("domMaps"));

  // Straight to the lobby, with no ground picked. On a shared map only one
  // person's choice can win, so the host chooses there — asking here and then
  // silently overriding it would be worse than not asking.
  document.getElementById("dom-friend").addEventListener("click", () => {
    location.href = "./dominion.html?mode=friend";
  });

  document.getElementById("menu-back").addEventListener("click", () => {
    showPane(PANES[pane].parent ?? "modes");
  });
  showPane("modes");

  // A different opener each time the menu is shown. They are the same lines the
  // battle uses, so the voice is consistent.
  footEl.textContent =
    `${WORLD.openers[Math.floor(Math.random() * WORLD.openers.length)]}` +
    `   ·   rules v${REPLAY_VERSION}`;

  howtoBtn.addEventListener("click", () => {
    const open = howtoEl.classList.toggle("hidden") === false;
    howtoBtn.textContent = open ? "Hide" : "How to play";
    if (open) howtoEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  const muteBtn = document.getElementById("menu-mute");
  muteBtn.addEventListener("click", () => {
    onMute();
    syncMute();
  });

  function syncMute() {
    muteBtn.textContent = isMuted() ? "Sound: off" : "Sound: on";
  }
  syncMute();

  return { syncMute };
}

/**
 * @param {keyof PANES | null} pane which step to land on, or null to leave the
 * menu exactly as it was.
 *
 * The default is null on purpose. This used to force the MAP picker every time
 * it ran, and since it also runs once at startup — after the mode picker has
 * just been set up — the site opened on "choose your ground" as though Warden
 * were the only game here. Coming back from a battle still wants the map picker,
 * so that caller asks for it explicitly.
 */
export function showMenu(pane = null) {
  menuEl.classList.remove("hidden");
  document.body.classList.remove("playing");
  if (pane) showPane(pane);
  // Re-roll the opener, so coming back to the menu is not the same screen.
  footEl.textContent =
    `${WORLD.openers[Math.floor(Math.random() * WORLD.openers.length)]}` +
    `   ·   rules v${REPLAY_VERSION}`;
}

export function hideMenu() {
  menuEl.classList.add("hidden");
  document.body.classList.add("playing");
}
