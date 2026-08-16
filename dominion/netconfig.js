// Where the network bits live. The only file you edit to point at your own
// infrastructure.
//
// Everything here is PUBLIC by definition: it is shipped to the browser, so
// anyone can read it. A relay URL is fine to publish; that is the whole of what
// is left here.
//
// This file used to be three times longer, and most of it was ICE and TURN
// configuration for a direct peer-to-peer connection. There is no direct
// connection any more — see the long note at the top of `link.js` for what
// happened and why the relay carries the match now. STUN, TURN credentials,
// static fallback lists and the `/ice` endpoint all went with it. The relay
// still answers `/ice`; nothing asks.

/**
 * The relay. It introduces two players by a short code and then carries the
 * match between them, for as long as it lasts.
 *
 * MUST be wss:// in production. A page served over https may not open a plain
 * ws:// socket, and the failure is confusing — the socket simply never opens.
 *
 * Set to "" and the 1v1 buttons say so plainly rather than half-working.
 */
export const RELAY_URL =
  readOverride("relay") ?? "wss://dominion-relay.shambhala-casting.workers.dev/ws";

/** Is a relay configured at all? Without one there is no online play. */
export const relayAvailable = () => Boolean(RELAY_URL);

/**
 * `?relay=` on the URL, for trying a server without a redeploy.
 *
 * Restricted to wss:// on purpose. Allowing ws:// from a query string would let
 * a link downgrade someone's connection, and allowing arbitrary schemes is worse
 * — this value is handed straight to `new WebSocket`.
 */
function readOverride(name) {
  try {
    const value = new URLSearchParams(location.search).get(name);
    if (!value) return null;
    const url = new URL(value);
    if (url.protocol === "wss:") return url.href;
    // localhost is the one exception, because you cannot get a certificate for
    // it and testing the relay locally is the whole point of having one.
    if (
      url.protocol === "ws:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return url.href;
    }
  } catch {
    /* not a URL, or no location (node) */
  }
  return null;
}
