// Online 1v1 Lockstep Multiplayer Transport for Swarajya 3D (WebSockets)
// Automatically handles local and global public relay connections across countries.

import { createLockstep, applyCommand } from "../dominion/net.js";

const DEFAULT_PUBLIC_RELAY = "wss://short-cities-take.loca.lt";

export class Multiplayer3D {
  /**
   * @param {Object} opts
   * @param {string} [opts.relayUrl]
   * @param {(state: string, data: any) => void} opts.onStatus
   * @param {(matchConfig: Object) => void} opts.onMatchStart
   */
  constructor({ relayUrl, onStatus, onMatchStart }) {
    if (relayUrl) {
      this.relayUrl = relayUrl;
    } else if (window.location.protocol === "https:") {
      this.relayUrl = DEFAULT_PUBLIC_RELAY;
    } else {
      this.relayUrl = `ws://${window.location.hostname || "localhost"}:8787`;
    }

    this.onStatus = onStatus || (() => {});
    this.onMatchStart = onMatchStart || (() => {});

    this.ws = null;
    this.roomCode = null;
    this.seat = null;
    this.token = null;
    this.isHost = false;
    this.lockstep = null;
  }

  setRelayUrl(url) {
    this.relayUrl = url;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Connects to relay server.
   */
  _connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return resolve(this.ws);
      }

      this.ws = new WebSocket(this.relayUrl);

      this.ws.onopen = () => {
        this.onStatus("connected", { url: this.relayUrl });
        resolve(this.ws);
      };

      this.ws.onerror = (err) => {
        this.onStatus("error", { error: "Failed to connect to relay server." });
        reject(err);
      };

      this.ws.onclose = () => {
        this.onStatus("disconnected", {});
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch (e) {
          console.error("Invalid message from relay:", event.data);
        }
      };
    });
  }

  /**
   * Hosts a new 1v1 online room.
   * @param {string} mapId 
   * @param {boolean} fogOfWar 
   */
  async hostRoom(mapId = "fourKings", fogOfWar = false, seats = 4) {
    await this._connect();
    this.isHost = true;
    this.onStatus("creating_room", {});

    const seed = Math.floor(Math.random() * 900000) + 100000;
    const meta = { mapId, fogOfWar, seed, seats };

    this.ws.send(JSON.stringify({
      type: "create",
      seats: seats || 4,
      meta,
    }));
  }

  /**
   * Joins an existing room with a 5-letter code.
   * @param {string} code 
   */
  async joinRoom(code) {
    await this._connect();
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();
    this.onStatus("joining_room", { code: this.roomCode });

    this.ws.send(JSON.stringify({
      type: "join",
      room: this.roomCode,
    }));
  }

  _handleMessage(msg) {
    if (msg.type === "created") {
      this.roomCode = msg.room;
      this.seat = msg.seat; // 0
      this.token = msg.token;
      this.meta = msg.meta;
      this.onStatus("waiting_for_peer", { room: this.roomCode, meta: this.meta });
    } else if (msg.type === "joined") {
      this.roomCode = msg.room;
      this.seat = msg.seat; // 1
      this.token = msg.token;
      this.meta = msg.meta;
      this.onStatus("match_ready", { room: this.roomCode, seat: this.seat, meta: this.meta });
      this.onMatchStart({
        isOnline: true,
        localPlayer: this.seat,
        mapId: this.meta.mapId,
        fogOfWar: this.meta.fogOfWar,
        seed: this.meta.seed,
        seats: [0, 1],
      });
    } else if (msg.type === "peer_joined") {
      this.onStatus("match_ready", { room: this.roomCode, seat: this.seat, meta: this.meta });
      this.onMatchStart({
        isOnline: true,
        localPlayer: this.seat,
        mapId: this.meta.mapId,
        fogOfWar: this.meta.fogOfWar,
        seed: this.meta.seed,
        seats: [0, 1],
      });
    } else if (msg.type === "peer_left") {
      this.onStatus("peer_left", { seat: msg.seat });
      if (this.lockstep) {
        this.lockstep.lost(msg.seat);
      }
    } else if (msg.type === "data" || msg.type === "frame" || msg.type === "sum") {
      if (this.lockstep) {
        const payload = msg.data !== undefined ? msg.data : msg;
        this.lockstep.receive(payload, msg.from);
      }
    } else if (msg.type === "error") {
      this.onStatus("error", { reason: msg.reason });
    }
  }

  /**
   * Initializes lockstep engine over WebSocket stream.
   * @param {Object} sim - Deterministic simulation instance
   */
  initLockstep(sim) {
    this.lockstep = createLockstep({
      sim,
      localPlayer: this.seat,
      seats: [0, 1],
      send: (frame, meta = {}) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: "data",
            data: frame,
            ...meta
          }));
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
