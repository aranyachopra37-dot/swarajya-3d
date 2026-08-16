// Parley — what you are allowed to say to the person you are fighting.
//
// TWO DECISIONS, BOTH DELIBERATE.
//
// **It is not free text.** Not because typing is hard, but because free text
// between strangers is a moderation problem, and a moderation problem is a
// thing you must then staff for ever. A fixed list needs none of that, cannot
// be used to abuse anyone, works without a keyboard, and — the part that
// actually matters — keeps both players speaking in the game's voice. "gg ez"
// and "Well fought. You had me at the ford." are not the same game.
//
// **It never touches the simulation.** A parley is sent on the same data
// channel as the commands, but it is NOT a lockstep command: it carries no
// tick, it is not replayed, and the lockstep engine ignores it entirely. If it
// went through the command stream, a dropped or duplicated message would be a
// desync — a chat message would be able to void a match. Here the worst a lost
// parley can do is go unheard.
//
// The rate limit is per sender and generous enough that nobody notices it, and
// tight enough that a stuck key cannot bury the other player's screen.

export const PARLEY_KIND = "parley";

/**
 * The whole vocabulary.
 *
 * Grouped so the row reads left to right as an emotional arc — greeting,
 * respect, threat, mercy — rather than as an alphabetised list. `mark` is what
 * shows on the button; `say` is what the other player reads.
 */
export const PHRASES = [
  { id: "hail",    mark: "🤝", say: "Well met." },
  { id: "ready",   mark: "⏳", say: "Whenever you are ready." },
  { id: "ground",  mark: "🗺", say: "Good ground. Bad luck." },
  { id: "respect", mark: "🛡", say: "That was well done." },
  { id: "close",   mark: "⚔", say: "Closer than either of us will admit." },
  { id: "come",    mark: "🔥", say: "Come and take it." },
  { id: "watch",   mark: "🐎", say: "Watch your peasants." },
  { id: "gold",    mark: "💰", say: "You are digging on borrowed time." },
  { id: "wait",    mark: "🕯", say: "A moment — I am back shortly." },
  { id: "yield",   mark: "🏳", say: "I yield. The field is yours." },
  { id: "fought",  mark: "👑", say: "Well fought." },
];

const BY_ID = new Map(PHRASES.map((p) => [p.id, p]));

/** Only ids from the table above ever cross the wire, so nothing else can. */
export const phraseFor = (id) => BY_ID.get(id) ?? null;

// Four in ten seconds. Enough to greet, warn and concede in quick succession;
// not enough to paper over somebody's screen.
const WINDOW_MS = 10_000;
const ALLOWANCE = 4;

export function createParley({ send, onSaid }) {
  const sentAt = [];
  const heardAt = [];

  const allow = (log) => {
    const now = Date.now();
    while (log.length && now - log[0] > WINDOW_MS) log.shift();
    if (log.length >= ALLOWANCE) return false;
    log.push(now);
    return true;
  };

  return {
    /** The local player pressed a phrase. */
    say(id) {
      const phrase = phraseFor(id);
      if (!phrase) return { ok: false, reason: "no such phrase" };
      if (!allow(sentAt)) return { ok: false, reason: "give them a moment" };

      send({ type: PARLEY_KIND, id });
      onSaid({ mine: true, ...phrase });
      return { ok: true };
    },

    /**
     * Something arrived on the channel. Returns true if it was a parley and has
     * been dealt with, so the caller knows not to hand it to lockstep.
     *
     * The far end is not trusted: an id that is not in the table is dropped, and
     * the rate limit applies to what is RECEIVED as well as what is sent — a
     * modified client cannot flood a screen it does not own.
     */
    receive(message, from = null) {
      if (!message || message.type !== PARLEY_KIND) return false;
      const phrase = phraseFor(message.id);
      // WHO SAID IT MATTERS ONCE THERE ARE THREE OF YOU. "Them" is enough in a
      // duel and useless in a free-for-all: "I am coming for you" means one
      // thing from the player you are already fighting and quite another from
      // the one you thought was busy elsewhere.
      if (phrase && allow(heardAt)) onSaid({ mine: false, from, ...phrase });
      return true;
    },
  };
}
