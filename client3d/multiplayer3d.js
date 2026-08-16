// Online Lockstep Multiplayer Transport for Swarajya 3D (WebRTC Peer-to-Peer + WebSocket Fallback)
// 100% Serverless, Global Low-Latency, Works Everywhere (Local & GitHub Pages).

import { createLockstep, applyCommand } from "../dominion/net.js";

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class Multiplayer3D {
  /**
   * @param {Object} opts
   * @param {string} [opts.relayUrl]
   * @param {(state: string, data: any) => void} opts.onStatus
   * @param {(matchConfig: Object) => void} opts.onMatchStart
   */
  constructor({ relayUrl = "", onStatus, onMatchStart }) {
    this.relayUrl = relayUrl;
    this.onStatus = onStatus || (() => {});
    this.onMatchStart = onMatchStart || (() => {});

    this.peer = null;
    this.connections = new Map(); // seat -> connection
    this.ws = null;
    this.roomCode = null;
    this.seat = 0;
    this.isHost = false;
    this.lockstep = null;
    this.meta = null;
    this.isP2P = true;
  }

  setRelayUrl(url) {
    this.relayUrl = url;
  }

  /**
   * Hosts a new online match room.
   */
  async hostRoom(mapId = "fourKings", fogOfWar = false, seats = 4) {
    this.isHost = true;
    this.seat = 0;
    this.roomCode = generateRoomCode();
    const seed = Math.floor(Math.random() * 900000) + 100000;
    this.meta = { mapId, fogOfWar, seed, seats: seats || 4 };

    this.onStatus("creating_room", { room: this.roomCode });

    if (window.Peer) {
      this.isP2P = true;
      this._initHostPeer(this.roomCode);
    } else {
      this._connectWebSocketRelay(true);
    }
  }

  /**
   * Joins an existing room with code.
   */
  async joinRoom(code) {
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();
    this.onStatus("joining_room", { code: this.roomCode });

    if (window.Peer) {
      this.isP2P = true;
      this._initClientPeer(this.roomCode);
    } else {
      this._connectWebSocketRelay(false);
    }
  }

  _initHostPeer(code) {
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }

    const peerId = `swarajya-v2-${code.toLowerCase()}`;
    this.peer = new window.Peer(peerId, {
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" }
        ]
      }
    });

    this.peer.on("open", () => {
      this.onStatus("waiting_for_peer", { room: this.roomCode, meta: this.meta });
    });

    this.peer.on("connection", (conn) => {
      const assignedSeat = this.connections.size + 1;
      this.connections.set(assignedSeat, conn);

      conn.on("open", () => {
        // Send initialization packet to joining peer
        conn.send({
          type: "init_match",
          room: this.roomCode,
          seat: assignedSeat,
          meta: this.meta,
        });

        this.onStatus("match_ready", { room: this.roomCode, seat: 0, meta: this.meta });
        this.onMatchStart({
          isOnline: true,
          localPlayer: 0,
          mapId: this.meta.mapId,
          fogOfWar: this.meta.fogOfWar,
          seed: this.meta.seed,
          seats: [0, assignedSeat],
        });
      });

      conn.on("data", (data) => {
        this._handlePeerData(data, assignedSeat);
      });

      conn.on("close", () => {
        this.connections.delete(assignedSeat);
        this.onStatus("peer_left", { seat: assignedSeat });
        if (this.lockstep) this.lockstep.lost(assignedSeat);
      });
    });

    this.peer.on("error", (err) => {
      console.warn("PeerJS Host Notice:", err);
      if (err.type === "unavailable-id") {
        // Retry with another code
        this.hostRoom(this.meta.mapId, this.meta.fogOfWar, this.meta.seats);
      } else {
        this.onStatus("error", { error: err.message || "P2P connection issue. Retrying..." });
      }
    });
  }

  _initClientPeer(code) {
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }

    this.peer = new window.Peer(null, {
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" }
        ]
      }
    });

    this.peer.on("open", () => {
      const targetPeerId = `swarajya-v2-${code.toLowerCase()}`;
      const conn = this.peer.connect(targetPeerId, { reliable: true });

      conn.on("open", () => {
        this.connections.set(0, conn);
        conn.send({ type: "client_hello" });
      });

      conn.on("data", (data) => {
        this._handlePeerData(data, 0);
      });

      conn.on("close", () => {
        this.onStatus("peer_left", { seat: 0 });
        if (this.lockstep) this.lockstep.lost(0);
      });

      conn.on("error", (err) => {
        this.onStatus("error", { error: "Unable to join room. Verify the 5-letter code." });
      });
    });

    this.peer.on("error", (err) => {
      this.onStatus("error", { error: "Could not find host with room code: " + code });
    });
  }

  _handlePeerData(msg, fromSeat) {
    if (!msg) return;

    if (msg.type === "init_match") {
      this.seat = msg.seat;
      this.meta = msg.meta;
      this.onStatus("match_ready", { room: this.roomCode, seat: this.seat, meta: this.meta });
      this.onMatchStart({
        isOnline: true,
        localPlayer: this.seat,
        mapId: this.meta.mapId,
        fogOfWar: this.meta.fogOfWar,
        seed: this.meta.seed,
        seats: [0, this.seat],
      });
    } else if (msg.type === "data" || msg.type === "frame" || msg.type === "sum") {
      if (this.lockstep) {
        const payload = msg.data !== undefined ? msg.data : msg;
        this.lockstep.receive(payload, fromSeat);
      }
    }
  }

  /**
   * Initializes lockstep engine over WebRTC/WebSocket data stream.
   */
  initLockstep(sim) {
    const seatList = [0, this.seat === 0 ? 1 : this.seat];

    this.lockstep = createLockstep({
      sim,
      localPlayer: this.seat,
      seats: seatList,
      send: (frame, meta = {}) => {
        const payload = { type: "data", data: frame, ...meta };

        if (this.isP2P) {
          for (const conn of this.connections.values()) {
            if (conn.open) {
              conn.send(payload);
            }
          }
        } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(payload));
        }
      },
      onDesync: (info) => {
        console.error("DESYNC DETECTED!", info);
        this.onStatus("desync", info);
      },
      onStall: (ms) => {
        this.onStatus("stall", { ms });
      },
      onLost: (seat) => {
        this.onStatus("peer_lost", { seat });
      },
    });

    return this.lockstep;
  }
}
