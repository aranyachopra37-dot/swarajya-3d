// The wire: one WebSocket to the relay, open for the whole match.
//
// WHAT THIS REPLACED, AND WHY
//
// This used to be WebRTC. Two peers exchanged an SDP offer and answer through
// the relay, opened a direct DataChannel, and the relay dropped out — no server
// in the middle, no bandwidth cost, the purist's answer.
//
// It did not connect. A real match was attempted between two houses and nothing
// moved: signalling succeeded, both players saw "connecting…", and neither ever
// saw another thing. Three separate reasons, all of them structural:
//
//   1. NO TURN. A direct connection needs a path through both NATs. STUN finds
//      one for most home routers and finds NOTHING when either end is behind a
//      symmetric NAT or carrier-grade NAT — which is most mobile networks and a
//      good share of ISPs. TURN is the fallback that relays the media, and it
//      was never configured (`/health` still reports `"turn":false`). Without
//      it, those pairs simply cannot connect, ever, no matter how long they wait.
//
//   2. NON-TRICKLE ICE. Candidates were gathered up front and packed into the
//      offer, with a four-second cap. Anything discovered after that was thrown
//      away, so even a workable path could be missed.
//
//   3. NOTHING WATCHED THE OUTCOME. The only route into the match was the
//      channel's `onopen`. There was no timeout and no failure branch, so "the
//      connection did not form" and "the connection has not formed YET" looked
//      identical — forever. That is the part that made it a bad experience
//      rather than merely a broken one.
//
// So the match now runs over the socket that already worked. The relay is a
// Durable Object that both players are already connected to, and it already
// forwards opaque payloads between them — it was written not to care what is
// inside, which turned out to be the useful decision in this whole file.
//
// WHAT IT COSTS
//
// A hop through Cloudflare's edge instead of a direct line: tens of
// milliseconds, absorbed by INPUT_DELAY, which exists for exactly this. An RTS
// is not a shooter; Age of Empires shipped with a third of a second of command
// lag and nobody minded.
//
// In requests: Durable Objects bill 20 incoming WebSocket messages as one
// request, and lockstep sends 20 frames a second per player. That is two
// requests a second for a whole match, against 100,000 a day free — about
// thirteen hours of continuous play. The direct connection was saving something
// that was never scarce.
//
// WHAT IT GIVES UP
//
// The relay can now see the command stream. It could not before. For two
// friends playing a game this is not a threat worth a transport that does not
// connect — but it is a real change, and if this ever carries a ladder with
// anything at stake, the answer is to sign frames, not to go back to WebRTC.

import { RELAY_URL } from "./netconfig.js";

/** How long to wait for the relay itself. Generous; it is one round trip. */
const CONNECT_TIMEOUT = 10000;

/** How long a guest waits for the host's opening details after joining. */
const HELLO_TIMEOUT = 15000;

/**
 * How long to keep trying to get a lost seat back. Deliberately shorter than the
 * relay's grace period, so the player hears the bad news from the game rather
 * than from a screen that stopped changing.
 */
const RECLAIM_WINDOW = 75000;

/** Where a held seat is remembered, so a reload can also get back in. */
const SEAT_KEY = "dominion.seat";

/** A remembered seat, if there is one and it is recent enough to still be held. */
export function heldSeat() {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const held = JSON.parse(raw);
    if (!held?.code || !held?.token) return null;
    // Older than any grace period could be: not worth a doomed attempt.
    if (Date.now() - (held.at ?? 0) > 5 * 60 * 1000) return forgetSeat();
    return held;
  } catch {
    return null;
  }
}

export function forgetSeat() {
  try { sessionStorage.removeItem(SEAT_KEY); } catch { /* nothing to do */ }
  return null;
}

/**
 * A socket that reports every way it can end.
 *
 * Every failure below arrives as a rejected promise or an `onClose` with a
 * reason a player can read. Nothing is allowed to simply stop happening — that
 * was the actual defect, and it is worth more than the transport change.
 */
function openSocket() {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocket(RELAY_URL);
    } catch (err) {
      return reject(new Error(`the relay address is not usable (${err.message})`));
    }

    const bail = setTimeout(() => {
      socket.close();
      reject(new Error("the relay did not answer in ten seconds"));
    }, CONNECT_TIMEOUT);

    socket.addEventListener("open", () => {
      clearTimeout(bail);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(bail);
      reject(new Error("could not reach the relay"));
    });
  });
}

/**
 * A message pump with two modes.
 *
 * During the handshake the caller awaits specific messages. Once the match
 * begins there is nobody awaiting anything and every payload has to be pushed
 * at the lockstep engine instead, so `stream(fn)` switches it over. Keeping one
 * object across both is what lets the socket stay open — the old code had a
 * handshake pump that closed itself, because signalling was all it was for.
 */
function pump(socket) {
  const queue = [];
  const waiters = [];
  let failure = null;
  let onPayload = null;   // set by stream(); takes over once the match starts
  let onGone = null;
  let onSeatLost = null;
  let onSeatAway = null;
  let onSeatBack = null;

  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // junk from the wire is never fatal
    }

    // In streaming mode a forwarded payload goes straight through, and anything
    // else is the relay telling us the room ended.
    if (onPayload) {
      if (msg.t === "signal") return onPayload(msg.data, msg.from);
      // One seat has gone but the room lives on — only possible with three
      // players. Distinct from "closed", which ends the match for everybody.
      if (msg.t === "gone") return onSeatLost?.(msg.seat);
      // Held, not gone. The others stop waiting for that seat but its player is
      // still expected back — see `depart` in rooms.mjs.
      if (msg.t === "away") return onSeatAway?.(msg.seat);
      if (msg.t === "back") return onSeatBack?.(msg.seat);
      if (msg.t === "closed") return onGone?.(msg.reason ?? "the room closed");
      if (msg.t === "error") return onGone?.(msg.reason ?? "the relay refused");
      return;
    }

    if (waiters.length) waiters.shift().resolve(msg);
    else queue.push(msg);
  });

  const fail = (reason) => {
    failure = failure ?? new Error(reason);
    while (waiters.length) waiters.shift().reject(failure);
    if (onPayload) onGone?.(reason);
  };
  socket.addEventListener("close", () => fail("the connection to the relay closed"));
  socket.addEventListener("error", () => fail("the connection to the relay failed"));

  return {
    send: (msg) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(msg)),
    close: () => socket.close(),
    stream(payload, gone, seatLost, seatAway, seatBack) {
      onPayload = payload;
      onGone = gone;
      onSeatLost = seatLost;
      onSeatAway = seatAway;
      onSeatBack = seatBack;
      // Anything that arrived between the last await and this call would
      // otherwise sit in the queue unread. In practice that is the first frame
      // from a peer who started a fraction earlier — and losing frame one of a
      // lockstep match stalls it permanently.
      while (queue.length) {
        const msg = queue.shift();
        if (msg.t === "signal") payload(msg.data, msg.from);
      }
      if (failure) gone(failure.message);
    },
    next(timeout, what = "the relay went quiet") {
      if (failure) return Promise.reject(failure);
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = timeout ? setTimeout(() => reject(new Error(what)), timeout) : null;
        waiters.push({
          resolve: (m) => { clearTimeout(timer); resolve(m); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
      });
    },
    async expect(t, timeout, what) {
      return this.expectAny([t], timeout, what);
    },
    /**
     * Wait for one of several kinds, stepping over the rest.
     *
     * The strict version — anything unexpected is fatal — was wrong the moment a
     * room could hold three. A guest waiting for the host to send the seed also
     * receives 'peer' when the THIRD player arrives, and it killed the join with
     * "expected signal from the relay, got peer". The second player never saw it
     * in a duel, because in a duel the second player is the last to arrive.
     *
     * Errors and a closed room are still fatal. Everything else is lobby news:
     * reported to the caller, and then waited past.
     */
    async expectAny(types, timeout, what, notice = null) {
      for (;;) {
        const msg = await this.next(timeout, what);
        if (msg.t === "error") throw new Error(msg.reason ?? "the relay refused");
        if (msg.t === "closed") throw new Error(msg.reason ?? "the room closed");
        if (types.includes(msg.t)) return msg;
        notice?.(msg);
      }
    },
  };
}

/**
 * Wrap a pump as the match transport.
 *
 * `send` is the shape `createLockstep` and `createParley` already expect, so
 * neither of them knows or cares that the transport changed.
 */
function asLink(relay, ctx) {
  const { seed, mapId, seat, seats, code, token } = ctx;
  const { onMessage, onClose, onLost, onAway, onBack, onResume } = ctx;

  // The host announces what the world was built from, once, so that anybody
  // reconnecting later can rebuild it. It rides on the first frame rather than
  // costing a message of its own.
  let setupPending = seat === 0 ? { seed, mapId, seats } : null;
  let gaveUp = false;

  // REMEMBERED ACROSS A RELOAD, ON PURPOSE.
  //
  // The token is what proves this chair is yours. Held only in memory it covers
  // a dropped socket and nothing else — and 'my browser crashed' or 'I hit
  // refresh' is at least as common as a wifi blip, and looks identical to the
  // player. sessionStorage is the right shelf: it survives a reload and dies
  // with the tab, so a seat cannot be reclaimed from a browser session that has
  // moved on to something else.
  try {
    sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code, seat, token, at: Date.now() }));
  } catch { /* private mode, or storage full: reconnect degrades, nothing breaks */ }

  const link = {
    seed, mapId, seat, seats, code, token,

    send(message, meta) {
      const envelope = { t: "signal", data: message };
      // Envelope fields, never inside `data`: the relay uses them to record a
      // rebuildable log without ever parsing the payload. See rooms.mjs.
      if (meta) {
        if (meta.keep) envelope.keep = true;
        if (meta.tick !== undefined) envelope.tick = meta.tick;
      }
      if (setupPending) {
        envelope.setup = setupPending;
        setupPending = null;
      }
      relay.send(envelope);
    },

    close() {
      gaveUp = true;
      forgetSeat();
      relay.send({ t: "bye" });
      relay.close();
    },
  };

  /**
   * The socket died mid-match. Try to get the seat back.
   *
   * The relay holds a dropped player's chair for a grace period, so this is
   * worth attempting rather than declaring the match over — a wifi blip should
   * not end a twenty minute game. Backs off between attempts and gives up before
   * the relay does, so the player is told by us rather than by silence.
   */
  async function reclaim() {
    if (gaveUp || !code || !token) return onClose?.("the connection to the relay closed");

    const started = Date.now();
    let wait = 800;
    while (!gaveUp && Date.now() - started < RECLAIM_WINDOW) {
      onAway?.(seat, Math.round((Date.now() - started) / 1000));
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 1.6, 6000);
      if (gaveUp) return;

      try {
        const socket = await openSocket();
        const fresh = pump(socket);
        fresh.send({ t: "rejoin", code, seat, token });
        const resumed = await fresh.expect("resume", CONNECT_TIMEOUT, "the relay did not answer");
        relay = fresh;
        wire(fresh);
        return onResume?.({
          seat: resumed.seat ?? seat,
          seats: resumed.seats ?? seats,
          setup: resumed.setup,
          log: resumed.log ?? [],
          through: resumed.through ?? -1,
        });
      } catch {
        // Room gone, seat given away, or the relay is still unreachable. Either
        // it is worth another try or the loop will run out and say so.
      }
    }
    if (!gaveUp) onClose?.("could not get back into the match");
  }

  function wire(r) {
    r.stream(
      // `from` is the relay's record of who sent it, not a claim in the payload.
      // With three players a frame has to say whose it is, and letting the sender
      // say would let one peer post commands as another.
      (payload, from) => onMessage?.(payload, from),
      (reason) => { if (!gaveUp) reclaim(); else onClose?.(reason); },
      (goneSeat) => onLost?.(goneSeat),
      (awaySeat) => onAway?.(awaySeat, null),
      (backSeat) => onBack?.(backSeat)
    );
  }
  wire(relay);
  return link;
}

/**
 * Host a match.
 *
 * `onCode` fires the moment the relay hands back a room code — before anyone
 * has joined — because that is the string the player has to go and share.
 * Resolves with a live link once every other seat has confirmed it is ready.
 */
export async function host({
  seed, ground, players = 2, onCode, onPeer,
  onMessage, onClose, onLost, onAway, onBack, onResume,
}) {
  const socket = await openSocket();
  const relay = pump(socket);

  try {
    relay.send({ t: "host", seats: players });
    const room = await relay.expect("room", CONNECT_TIMEOUT, "the relay did not open a room");
    const seats = room.seats ?? players;
    onCode(room.code, seats);

    // No timeout: the host is waiting for humans to read a message, open a link
    // and type. That takes as long as it takes and is not an error.
    //
    // The count can go DOWN as well as up. Somebody who joins a three-seat room
    // and then closes the tab frees their chair, and a host that only counted
    // arrivals would sit for ever believing the room was one player fuller than
    // it was.
    let filled = 1;
    while (filled < seats) {
      const msg = await relay.expectAny(["peer", "gone"]);
      filled = msg.t === "peer" ? msg.filled ?? filled + 1 : Math.max(1, filled - 1);
      onPeer?.(filled, seats);
    }

    // The seed and the map travel now, so everyone builds the same world.
    // Getting this wrong is a desync on tick one that looks like a netcode bug
    // and is really a setup mistake.
    //
    // `ground` is a FUNCTION, read here rather than captured when the room
    // opened. The host sits on this screen with a ground picker in front of
    // them for as long as it takes their friends to arrive, and the first
    // version locked the choice in at open time — so changing it while waiting
    // did nothing at all, silently, with the buttons still highlighting.
    const mapId = ground();
    relay.send({ t: "signal", data: { hello: 1, seed, mapId, seats } });

    // Everyone confirms, not just the first to answer. With three players,
    // starting on one confirmation would leave the third building its world
    // while the other two had already run a hundred ticks without it.
    const confirmed = new Set();
    while (confirmed.size < seats - 1) {
      const reply = await relay.expectAny(
        ["signal"], HELLO_TIMEOUT, "somebody never confirmed"
      );
      if (!reply.data || reply.data.ready !== 1) {
        throw new Error("a player sent something unexpected");
      }
      confirmed.add(reply.from);
    }

    return asLink(relay, {
      seed, mapId, seat: 0, seats, code: room.code, token: room.token,
      onMessage, onClose, onLost, onAway, onBack, onResume,
    });
  } catch (error) {
    relay.send({ t: "bye" });
    relay.close();
    throw error;
  }
}

/**
 * Reclaim a seat from a page that has just loaded.
 *
 * Same handshake `reclaim` performs after a dropped socket, but starting from
 * nothing — which is the case when the tab was closed, the browser crashed, or
 * somebody pressed refresh mid-match.
 */
export async function resume(held, handlers = {}) {
  const socket = await openSocket();
  const relay = pump(socket);
  try {
    relay.send({ t: "rejoin", code: held.code, seat: held.seat, token: held.token });
    const got = await relay.expect("resume", CONNECT_TIMEOUT, "the relay did not answer");
    const setup = got.setup ?? {};
    return {
      link: asLink(relay, {
        seed: setup.seed, mapId: setup.mapId,
        seat: got.seat ?? held.seat, seats: got.seats ?? setup.seats ?? 2,
        code: held.code, token: held.token, ...handlers,
      }),
      setup, log: got.log ?? [], through: got.through ?? -1,
      seat: got.seat ?? held.seat,
    };
  } catch (error) {
    relay.close();
    forgetSeat();
    throw error;
  }
}

/** Join a match by code. Resolves with a live link, or throws saying why not. */
export async function join(code, {
  onMessage, onClose, onLost, onPeer, onAway, onBack, onResume,
} = {}) {
  const socket = await openSocket();
  const relay = pump(socket);

  try {
    relay.send({ t: "join", code: String(code).trim().toUpperCase() });
    const seatMsg = await relay.expect("joined", CONNECT_TIMEOUT, "the relay did not answer the join");
    const seat = seatMsg.seat ?? 1;
    onPeer?.(seatMsg.filled ?? 2, seatMsg.seats ?? 2);

    // The host only sends this once the room is full, so on a three-seat map
    // this is also the wait for the third player. No shorter timeout for that:
    // it is a human reading a message, same as the host's wait.
    // Steps over the arrival of anybody who joins after us — which is exactly
    // what broke the first three-player match: seat 1 was waiting here when seat
    // 2 arrived, and the relay is quite right to mention it.
    const hello = await relay.expectAny(
      ["signal"], null, "the host never sent the match details",
      (msg) => {
        if (msg.t === "peer") onPeer?.(msg.filled ?? 0, msg.seats ?? 0);
      }
    );
    const { seed, mapId, seats } = hello.data ?? {};
    if (typeof seed !== "number") throw new Error("the host sent no seed");

    relay.send({ t: "signal", data: { ready: 1 } });
    return asLink(relay, {
      seed, mapId, seat, seats: seats ?? 2,
      code: String(code).trim().toUpperCase(), token: seatMsg.token,
      onMessage, onClose, onLost, onAway, onBack, onResume,
    });
  } catch (error) {
    relay.send({ t: "bye" });
    relay.close();
    throw error;
  }
}
