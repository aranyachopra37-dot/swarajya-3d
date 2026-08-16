// In-Game Tactical Diplomacy, Alliances & Resource Tribute System for Swarajya 3D

export class Diplomacy3D {
  /**
   * @param {HTMLElement} container 
   * @param {(targetSeat: number, stance: string) => void} onSetStance 
   * @param {(targetSeat: number, res: string, amount: number) => void} onSendTribute 
   */
  constructor(container = document.body, onSetStance = () => {}, onSendTribute = () => {}) {
    this.container = container;
    this.onSetStance = onSetStance;
    this.onSendTribute = onSendTribute;
    this.isOpen = false;

    this._createDOM();
    this._bindKeys();
  }

  _createDOM() {
    this.modal = document.createElement("div");
    this.modal.id = "diplomacy-modal";
    this.modal.style.display = "none";
    this.modal.innerHTML = `
      <div class="diplomacy-card">
        <div class="diplomacy-header">
          <h2>🤝 TACTICAL DIPLOMACY & ALLIANCES</h2>
          <button id="dip-close-btn" class="dip-close">✕</button>
        </div>
        <p class="dip-subtitle">Form sacred mountain pacts, declare rivalries, and send resource tributes.</p>

        <div id="diplomacy-player-list"></div>

        <div class="dip-footer">
          <small>Press <strong>[D]</strong> to toggle diplomacy modal anytime.</small>
        </div>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #diplomacy-modal {
        position: absolute;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: rgba(8, 10, 16, 0.82);
        backdrop-filter: blur(14px);
        z-index: 1050;
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
      }
      .diplomacy-card {
        background: rgba(18, 22, 32, 0.98);
        border: 1px solid #3b4252;
        border-radius: 12px;
        padding: 24px 30px;
        width: 580px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.9);
      }
      .diplomacy-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }
      .diplomacy-header h2 {
        font-size: 16px;
        color: #f4a261;
        letter-spacing: 0.1em;
      }
      .dip-close {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 18px;
        cursor: pointer;
      }
      .dip-subtitle {
        font-size: 11px;
        color: #9ca3af;
        margin-bottom: 18px;
      }
      #diplomacy-player-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 18px;
      }
      .dip-player-row {
        background: #141822;
        border: 1px solid #2b3140;
        border-radius: 8px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .dip-player-info {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .dip-player-color {
        width: 14px;
        height: 14px;
        border-radius: 50%;
      }
      .dip-player-name {
        font-size: 13px;
        font-weight: bold;
        color: #f3f4f6;
      }
      .dip-stance-buttons {
        display: flex;
        gap: 6px;
      }
      .dip-btn {
        background: #1f2430;
        border: 1px solid #374151;
        color: #9ca3af;
        border-radius: 4px;
        padding: 5px 10px;
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .dip-btn.active.ally { background: #2d6a4f; color: #d8f3dc; border-color: #52b788; font-weight: bold; }
      .dip-btn.active.neutral { background: #3d405b; color: #f4f1de; border-color: #e07a5f; font-weight: bold; }
      .dip-btn.active.enemy { background: #78290f; color: #ffccd5; border-color: #e63946; font-weight: bold; }
      .dip-tribute-group {
        display: flex;
        gap: 4px;
        margin-left: 12px;
        border-left: 1px solid #2b3140;
        padding-left: 10px;
      }
      .trib-btn {
        background: #181d27;
        border: 1px solid #374151;
        border-radius: 4px;
        padding: 4px 7px;
        font-size: 10px;
        cursor: pointer;
        color: #d1d5db;
      }
      .trib-btn:hover { background: #2b3140; border-color: #ffd166; }
      .dip-footer {
        text-align: center;
        font-size: 11px;
        color: #6b7280;
        border-top: 1px solid #2b3140;
        padding-top: 10px;
      }
    `;
    document.head.appendChild(style);
    this.container.appendChild(this.modal);

    this.playerListEl = this.modal.querySelector("#diplomacy-player-list");
    this.closeBtn = this.modal.querySelector("#dip-close-btn");
    this.closeBtn.addEventListener("click", () => this.close());
  }

  _bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyD" && !e.ctrlKey && !e.metaKey) {
        // Don't toggle if user is typing in chat input
        const chatInput = document.getElementById("rts-chat-input");
        if (document.activeElement === chatInput) return;
        this.toggle();
      } else if (e.code === "Escape" && this.isOpen) {
        this.close();
      }
    });
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.isOpen = true;
    this.modal.style.display = "flex";
  }

  close() {
    this.isOpen = false;
    this.modal.style.display = "none";
  }

  /**
   * Updates the diplomacy panel with current players and relationships.
   */
  update(sim, localPlayer = 0) {
    if (!sim) return;
    this.playerListEl.innerHTML = "";

    sim.players.forEach((p, idx) => {
      if (idx === localPlayer) return;

      const currentStance = sim.diplomacy ? (sim.diplomacy[localPlayer]?.[idx] || "enemy") : "enemy";
      const row = document.createElement("div");
      row.className = "dip-player-row";

      row.innerHTML = `
        <div class="dip-player-info">
          <div class="dip-player-color" style="background: ${p.colour};"></div>
          <div>
            <div class="dip-player-name">${p.name}</div>
            <div style="font-size:10px; color:#9ca3af;">${p.out ? "Out of match" : "Active Realm"}</div>
          </div>
        </div>

        <div style="display:flex; align-items:center;">
          <div class="dip-stance-buttons">
            <button class="dip-btn ally ${currentStance === "ally" ? "active" : ""}" data-seat="${idx}" data-stance="ally">🤝 Ally</button>
            <button class="dip-btn neutral ${currentStance === "neutral" ? "active" : ""}" data-seat="${idx}" data-stance="neutral">⚖️ Neutral</button>
            <button class="dip-btn enemy ${currentStance === "enemy" ? "active" : ""}" data-seat="${idx}" data-stance="enemy">⚔️ Enemy</button>
          </div>

          <div class="dip-tribute-group">
            <button class="trib-btn" title="Send 50 Gold" data-seat="${idx}" data-res="gold">+50 🟡</button>
            <button class="trib-btn" title="Send 50 Timber" data-seat="${idx}" data-res="timber">+50 🌲</button>
            <button class="trib-btn" title="Send 50 Food" data-seat="${idx}" data-res="food">+50 🌾</button>
          </div>
        </div>
      `;

      row.querySelectorAll(".dip-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const seat = parseInt(btn.getAttribute("data-seat"), 10);
          const stance = btn.getAttribute("data-stance");
          this.onSetStance(seat, stance);
          this.update(sim, localPlayer);
        });
      });

      row.querySelectorAll(".trib-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const seat = parseInt(btn.getAttribute("data-seat"), 10);
          const res = btn.getAttribute("data-res");
          this.onSendTribute(seat, res, 50);
        });
      });

      this.playerListEl.appendChild(row);
    });
  }
}
