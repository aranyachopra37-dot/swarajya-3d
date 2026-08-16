// The three moments that are not gameplay: the horn, the win, the loss.
//
// A match that begins because a timer started, and ends because a status line
// changed colour, has no shape. You do not remember it. Fighting games worked
// this out decades ago — the round is announced, the win is ANNOUNCED, and the
// announcement is half the reason anyone plays a second time.
//
// So: one full-screen herald, three occasions, and the same rule for all of
// them — **it must be skippable**. Ceremony you cannot get out of stops being
// ceremony on the third viewing and becomes a loading screen. Click, any key,
// or wait; whichever comes first.
//
// Nothing here can reach a simulation. It is handed numbers that have already
// happened and it draws them. That matters more than it sounds: this file is
// the only one in the project allowed to be theatrical, and keeping it strictly
// downstream is what makes that safe.

const HOLD_MS = { start: 2600, victory: 30000, defeat: 30000 };

let root = null;
let dismiss = null;

function ensureRoot() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "herald";
  root.className = "hidden";
  document.body.appendChild(root);

  // Skip on anything. The overlay swallows the click that dismissed it so it
  // cannot also land on the map underneath and order your army somewhere.
  root.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  window.addEventListener("keydown", (e) => {
    if (!root.classList.contains("hidden")) {
      e.preventDefault();
      close();
    }
  });
  return root;
}

function close() {
  if (!root || root.classList.contains("hidden")) return;
  root.classList.add("gone");
  const el = root;
  setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("gone");
    el.innerHTML = "";
  }, 420);
  if (dismiss) {
    clearTimeout(dismiss);
    dismiss = null;
  }
}

export const heraldOpen = () => Boolean(root && !root.classList.contains("hidden"));
export { close as closeHerald };

/**
 * Raise a herald.
 *
 * @param {object} spec
 * @param {"start"|"victory"|"defeat"} spec.kind
 * @param {string} spec.title      the big line
 * @param {string} [spec.crest]    one emblem, drawn large behind the title
 * @param {string} [spec.subtitle]
 * @param {Array<[string, string]>} [spec.figures]  label/value pairs
 * @param {string[]} [spec.steps]  numbered instructions, for a primer
 * @param {string} [spec.line]     a closing line, in the world's voice
 * @param {Array<{label: string, onPick: () => void}>} [spec.actions]
 * @param {() => void} [spec.onClose]
 */
export function herald({ kind, title, crest, subtitle, figures = [], steps = [], line, actions = [], onClose }) {
  const el = ensureRoot();
  el.className = `kind-${kind}`;
  el.innerHTML = "";

  const card = document.createElement("div");
  card.className = "herald-card";

  // The emblem and the title share a wrapper, so the emblem can be sized in
  // `em` of the TITLE rather than of the card's 16px body text — at 0.8em of the
  // card it came out as a 13px speck above a 66px headline.
  const head = document.createElement("div");
  head.className = "herald-head";

  if (crest) {
    const mark = document.createElement("div");
    mark.className = "herald-crest";
    mark.textContent = crest;
    head.appendChild(mark);
  }

  const h = document.createElement("div");
  h.className = "herald-title";

  // ONE SPAN PER LETTER, BUT GROUPED BY WORD.
  //
  // Per-letter spans are what let the title be built up rather than faded in.
  // They are also flex items, and a flex row wraps between any two of them — so
  // an unbroken run of them split "THE FIELD IS YOURS" across two lines as
  // "THE FIELD IS YOU / RS". A word wrapped in its own inline-block keeps the
  // letters animating individually and the word indivisible. The gap between
  // words is CSS, so there are no space characters here to go astray.
  let n = 0;
  for (const word of title.split(" ")) {
    const w = document.createElement("span");
    w.className = "hw";
    for (const ch of word) {
      const letter = document.createElement("span");
      letter.textContent = ch;
      letter.style.animationDelay = `${n++ * 42}ms`;
      w.appendChild(letter);
    }
    h.appendChild(w);
    n += 1; // the gap between words costs a beat too, so it reads as speech
  }

  head.appendChild(h);
  card.appendChild(head);

  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "herald-sub";
    sub.textContent = subtitle;
    card.appendChild(sub);
  }

  if (figures.length) {
    const grid = document.createElement("div");
    grid.className = "herald-figures";
    for (const [label, value] of figures) {
      const cell = document.createElement("div");
      cell.innerHTML =
        `<span class="hf-value">${value}</span><span class="hf-label">${label}</span>`;
      grid.appendChild(cell);
    }
    card.appendChild(grid);
  }

  // Numbered steps, for the one herald that is teaching rather than announcing.
  // The figures grid is wrong for this: it makes the NUMBER the loud thing and
  // the instruction a caption, when the instruction is the whole point.
  if (steps.length) {
    const list = document.createElement("ol");
    list.className = "herald-steps";
    for (const step of steps) {
      const item = document.createElement("li");
      item.textContent = step;
      list.appendChild(item);
    }
    card.appendChild(list);
  }

  if (line) {
    const quote = document.createElement("div");
    quote.className = "herald-line";
    quote.textContent = line;
    card.appendChild(quote);
  }

  if (actions.length) {
    const row = document.createElement("div");
    row.className = "herald-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
        action.onPick();
      });
      row.appendChild(button);
    }
    card.appendChild(row);
  }

  const hint = document.createElement("div");
  hint.className = "herald-hint";
  hint.textContent = actions.length ? "click anywhere to dismiss" : "";
  card.appendChild(hint);

  el.appendChild(card);
  el.classList.remove("hidden", "gone");

  if (dismiss) clearTimeout(dismiss);
  // The opening herald gets out of the way on its own — you did not ask to read
  // it and the match is already running behind it. A result does not: it is the
  // only record of what just happened, and it goes when you say so.
  dismiss = actions.length ? null : setTimeout(close, HOLD_MS[kind] ?? 3000);

  if (onClose) {
    const watch = setInterval(() => {
      if (!heraldOpen()) {
        clearInterval(watch);
        onClose();
      }
    }, 120);
  }
}

// --- The words ---------------------------------------------------------------
//
// Written down here rather than at the call sites so the two games cannot drift
// into different voices, and so a line can be changed without touching logic.

const OPENERS = [
  "The ground is chosen. What happens on it is not.",
  "Two halls, one road between them.",
  "Everything you build, somebody has to carry.",
  "Nobody remembers the peasants. Lose them and see how long you last.",
  "There is no honour in a full granary, and no victory without one.",
  "Take the field, or be taken off it.",
];

const WINS = [
  "They will call it a rout. It was a ledger.",
  "The hall is yours. The digging starts again tomorrow.",
  "An army is not killed. It is convinced.",
  "History will say you were always going to win. You know better.",
  "They came a long way to hand you this.",
];

const LOSSES = [
  "The hall burned with the granary full.",
  "You had the men. You did not have them THERE.",
  "Somebody else is counting your gold tonight.",
  "It was decided four minutes before it ended.",
  "Beaten, which is not the same as outnumbered.",
];

/** Deterministic pick, so a replay of the same match reads the same. */
const pick = (list, seed) => list[Math.abs(seed | 0) % list.length];

export const opener = (seed) => pick(OPENERS, seed);
export const winLine = (seed) => pick(WINS, seed);
export const lossLine = (seed) => pick(LOSSES, seed);
