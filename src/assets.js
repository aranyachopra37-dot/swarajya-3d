// Sprite loading.
//
// Rendering is the only thing that touches these. The simulation has no idea
// images exist, which is what keeps it runnable headless in node for score
// verification — and means a missing or slow-loading sprite can never change the
// outcome of a battle, only how it looks.

const NAMES = [
  // units
  "levy", "shieldwall", "outriders", "ram", "bearer",
  "warlord", "zealots", "hirelings", "siegeTower", "barrowWight", "shade",
  // buildings
  "archer", "bell", "reliquary", "cannon", "bombard", "thorn", "bloodthorn",
  "scout", "marksman", "barge", "snare", "spikes",
  // Ground textures, loaded through the same forgiving path as sprites: if they
  // are missing the battlefield simply renders in flat colour, as it always did.
  "tex_ground", "tex_road",
  // Dominion. Shared with Warden through this one loader on purpose: both pages
  // sit at the site root, so `./assets/sprites/` resolves the same from either,
  // and there is no second cache to keep in step.
  "dom_manor", "dom_warehouse", "dom_barracks", "dom_stables", "dom_watchtower",
  "dom_factory", "dom_lair",
  "dom_peasant", "dom_spearman", "dom_archer", "dom_warRider", "dom_huntress",
  "dom_cart", "dom_sapper", "dom_catapult", "dom_mangonel", "dom_ram",
  "dom_dragon", "dom_behemoth", "dom_witch",
];

export const sprites = {};

let loaded = 0;
let attempted = 0;

/** True once every sprite has either loaded or definitively failed. */
export function spritesReady() {
  return attempted === NAMES.length;
}

/** How many actually made it — the renderer falls back per-sprite, not globally. */
export function spritesLoaded() {
  return loaded;
}

let started = false;

export function loadSprites() {
  // Idempotent. Calling it twice used to double the attempt count, which meant
  // spritesReady() compared against the wrong total and never became true.
  if (started) return;
  started = true;

  for (const name of NAMES) {
    const img = new Image();

    img.onload = () => {
      sprites[name] = img;
      loaded += 1;
      attempted += 1;
    };

    // A missing sprite is not fatal. The renderer draws its old block-of-squares
    // for anything absent, so the game stays playable while art is in progress.
    img.onerror = () => {
      console.warn(`[assets] missing sprite: ${name}`);
      attempted += 1;
    };

    img.src = `./assets/sprites/${name}.png`;
  }
}
