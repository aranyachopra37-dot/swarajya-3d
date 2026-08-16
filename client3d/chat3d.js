// In-Game RTS Tactical Chat & Channel Broadcast System for Swarajya 3D
// Supports:
// 1. Full Chat History View upon pressing [Enter]
// 2. Channel Sections: [ALL], [ALLIES], and Individual Realm Whispers
// 3. [Tab] Key to cycle channels & auto-scroll
// 4. Multi-AI interactive diplomacy dialogue

export class Chat3D {
  /**
   * @param {HTMLElement} container 
   * @param {(text: string, targetSeat: number) => void} onSendMessage 
   */
  constructor(container = document.body, onSendMessage = () => {}) {
    this.container = container;
    this.onSendMessage = onSendMessage;
    this.isOpen = false;
    this.history = [];
    this.currentChannel = "all"; // "all" | "allies" | number (seatId)
    this.sim = null;
    this.localPlayer = 0;

    this._createDOM();
    this._bindKeys();
  }

  setSim(sim, localPlayer = 0) {
    this.sim = sim;
    this.localPlayer = localPlayer;
    this._refreshChannelTabs();
  }

  _createDOM() {
    this.panel = document.createElement("div");
    this.panel.id = "rts-chat-panel";
    this.panel.className = "chat-closed";
    this.panel.innerHTML = `
      <div id="rts-chat-channels-bar" style="display:none;">
        <button class="chat-tab-btn active" data-chan="all">🌐 ALL</button>
        <button class="chat-tab-btn" data-chan="allies">🤝 ALLIES</button>
        <div id="rts-chat-players-tabs" style="display:flex; gap:4px;"></div>
      </div>
      <div id="rts-chat-log"></div>
      <div id="rts-chat-input-row" style="display:none;">
        <span id="rts-chat-prefix">🌐 [ALL]:</span>
        <input type="text" id="rts-chat-input" placeholder="Type message... (Press [Tab] to cycle channel)" maxlength="140" />
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #rts-chat-panel {
        position: absolute;
        bottom: 120px;
        left: 20px;
        width: 440px;
        z-index: 100;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        font-family: 'Fira Code', ui-monospace, "Cascadia Mono", Consolas, monospace;
        transition: all 0.2s ease;
      }
      #rts-chat-panel.chat-closed {
        pointer-events: none;
        max-height: 220px;
        background: transparent;
      }
      #rts-chat-panel.chat-open {
        pointer-events: auto;
        height: 320px;
        background: rgba(14, 18, 28, 0.94);
        border: 1px solid rgba(244, 162, 97, 0.35);
        border-radius: 8px;
        padding: 10px;
        backdrop-filter: blur(14px);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75);
      }
      #rts-chat-channels-bar {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 6px;
        overflow-x: auto;
      }
      .chat-tab-btn {
        background: #19202f;
        border: 1px solid #3b4252;
        color: #9ca3af;
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 10px;
        font-family: inherit;
        font-weight: bold;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
      }
      .chat-tab-btn:hover {
        background: #2b3346;
        color: #ffd166;
        border-color: #ffd166;
      }
      .chat-tab-btn.active {
        background: #f4a261;
        color: #0b0d13;
        border-color: #f4a261;
      }
      #rts-chat-log {
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow-y: auto;
        flex: 1;
        margin-bottom: 6px;
        padding-right: 4px;
      }
      #rts-chat-log::-webkit-scrollbar {
        width: 5px;
      }
      #rts-chat-log::-webkit-scrollbar-thumb {
        background: rgba(244, 162, 97, 0.4);
        border-radius: 3px;
      }
      .chat-msg {
        background: rgba(18, 24, 36, 0.85);
        border-left: 3px solid #f4a261;
        border-radius: 4px;
        padding: 5px 10px;
        font-size: 11px;
        line-height: 1.4;
        color: #e5e7eb;
        backdrop-filter: blur(8px);
        box-shadow: 0 2px 10px rgba(0,0,0,0.4);
        animation: chatFade 0.2s ease;
        transition: opacity 1s ease;
      }
      .chat-closed .chat-msg {
        max-width: 380px;
      }
      .chat-msg.system { border-left-color: #ffd166; color: #ffd166; font-style: italic; }
      .chat-msg.diplomacy { border-left-color: #52b788; color: #a7f3d0; }
      .chat-msg.whisper { border-left-color: #a78bfa; color: #ddd6fe; }
      .chat-msg.allies { border-left-color: #38bdf8; color: #bae6fd; }
      .chat-badge {
        font-size: 9px;
        font-weight: bold;
        padding: 1px 4px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.12);
        margin-right: 6px;
      }
      .chat-author { font-weight: bold; margin-right: 6px; }
      #rts-chat-input-row {
        display: flex;
        align-items: center;
        background: rgba(22, 28, 42, 0.95);
        border: 1px solid #4b5563;
        border-radius: 6px;
        padding: 6px 10px;
        gap: 8px;
      }
      #rts-chat-prefix { font-size: 11px; color: #f4a261; font-weight: bold; white-space: nowrap; }
      #rts-chat-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #f9fafb;
        font-family: inherit;
        font-size: 12px;
      }
      @keyframes chatFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
    this.container.appendChild(this.panel);

    this.logEl = this.panel.querySelector("#rts-chat-log");
    this.channelsBar = this.panel.querySelector("#rts-chat-channels-bar");
    this.playersTabsEl = this.panel.querySelector("#rts-chat-players-tabs");
    this.inputRow = this.panel.querySelector("#rts-chat-input-row");
    this.inputEl = this.panel.querySelector("#rts-chat-input");
    this.prefixEl = this.panel.querySelector("#rts-chat-prefix");

    this.channelsBar.querySelectorAll(".chat-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const chan = btn.getAttribute("data-chan");
        this.setChannel(chan);
      });
    });
  }

  _bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "Enter") {
        if (this.isOpen) {
          this._submitMessage();
        } else {
          this.open();
        }
      } else if (e.code === "Escape" && this.isOpen) {
        this.close();
      } else if (e.code === "Tab" && this.isOpen) {
        e.preventDefault();
        this._cycleChannel();
      }
    });
  }

  _refreshChannelTabs() {
    if (!this.sim) return;
    this.playersTabsEl.innerHTML = "";

    this.sim.players.forEach((p, idx) => {
      if (idx === this.localPlayer) return;
      const btn = document.createElement("button");
      btn.className = `chat-tab-btn ${this.currentChannel === String(idx) ? "active" : ""}`;
      btn.setAttribute("data-chan", String(idx));
      btn.textContent = `👤 ${p.name.split(" ")[0] || `P${idx+1}`}`;
      btn.addEventListener("click", () => this.setChannel(String(idx)));
      this.playersTabsEl.appendChild(btn);
    });
  }

  setChannel(chan) {
    this.currentChannel = chan;
    this.channelsBar.querySelectorAll(".chat-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-chan") === String(chan));
    });

    if (chan === "all") {
      this.prefixEl.textContent = "🌐 [ALL]:";
      this.inputEl.placeholder = "Broadcast to everyone... ([Tab] to switch)";
    } else if (chan === "allies") {
      this.prefixEl.textContent = "🤝 [ALLIES]:";
      this.inputEl.placeholder = "Message allied players... ([Tab] to switch)";
    } else {
      const pIdx = parseInt(chan, 10);
      const pName = this.sim?.players[pIdx]?.name || `Player ${pIdx + 1}`;
      this.prefixEl.textContent = `👤 [TO ${pName}]:`;
      this.inputEl.placeholder = `Whisper to ${pName}... ([Tab] to switch)`;
    }

    this._renderHistory();
    this.inputEl.focus();
  }

  _cycleChannel() {
    const available = ["all", "allies"];
    if (this.sim) {
      this.sim.players.forEach((p, idx) => {
        if (idx !== this.localPlayer) available.push(String(idx));
      });
    }

    const curIdx = available.indexOf(String(this.currentChannel));
    const nextIdx = (curIdx + 1) % available.length;
    this.setChannel(available[nextIdx]);
  }

  open() {
    this.isOpen = true;
    this.panel.className = "chat-open";
    this.channelsBar.style.display = "flex";
    this.inputRow.style.display = "flex";
    this._refreshChannelTabs();
    this._renderHistory();
    this.inputEl.value = "";
    this.inputEl.focus();
    this._scrollToBottom();
  }

  close() {
    this.isOpen = false;
    this.panel.className = "chat-closed";
    this.channelsBar.style.display = "none";
    this.inputRow.style.display = "none";
    this.inputEl.blur();
    this._renderRecentToasts();
  }

  _submitMessage() {
    const text = this.inputEl.value.trim();
    if (text) {
      let target = -1;
      if (this.currentChannel === "allies") target = -2;
      else if (this.currentChannel !== "all") target = parseInt(this.currentChannel, 10);

      this.onSendMessage(text, target);
    }
    this.close();
  }

  /**
   * Adds an incoming message to history and displays it.
   */
  addMessage({ author = "System", text, type = "normal", color = "#f4a261", channel = "all", target = -1 }) {
    const msg = {
      id: Date.now() + Math.random(),
      author,
      text,
      type,
      color,
      channel,
      target,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    this.history.push(msg);

    if (this.isOpen) {
      this._renderHistory();
      this._scrollToBottom();
    } else {
      this._renderRecentToasts();
    }
  }

  _renderHistory() {
    this.logEl.innerHTML = "";

    const visibleMsgs = this.history.filter(m => {
      if (this.currentChannel === "all") return true;
      if (this.currentChannel === "allies") return m.channel === "allies" || m.type === "system" || m.type === "diplomacy";
      const targetSeat = parseInt(this.currentChannel, 10);
      return m.target === targetSeat || m.author.includes(`Player ${targetSeat + 1}`) || m.type === "system";
    });

    visibleMsgs.forEach(m => {
      const msgEl = document.createElement("div");
      msgEl.className = `chat-msg ${m.type}`;
      msgEl.style.opacity = "1";

      let chanBadge = "";
      if (m.channel === "allies") chanBadge = `<span class="chat-badge" style="color:#38bdf8;">ALLIES</span>`;
      else if (m.target >= 0) chanBadge = `<span class="chat-badge" style="color:#a78bfa;">WHISPER</span>`;

      if (m.type !== "system") {
        msgEl.innerHTML = `${chanBadge}<span class="chat-author" style="color:${m.color};">[${m.author}]:</span><span>${m.text}</span>`;
      } else {
        msgEl.innerHTML = `<span>📜 ${m.text}</span>`;
      }

      this.logEl.appendChild(msgEl);
    });

    this._scrollToBottom();
  }

  _renderRecentToasts() {
    this.logEl.innerHTML = "";
    const recent = this.history.slice(-5);

    recent.forEach(m => {
      const msgEl = document.createElement("div");
      msgEl.className = `chat-msg ${m.type}`;

      let chanBadge = "";
      if (m.channel === "allies") chanBadge = `<span class="chat-badge" style="color:#38bdf8;">ALLIES</span>`;
      else if (m.target >= 0) chanBadge = `<span class="chat-badge" style="color:#a78bfa;">WHISPER</span>`;

      if (m.type !== "system") {
        msgEl.innerHTML = `${chanBadge}<span class="chat-author" style="color:${m.color};">[${m.author}]:</span><span>${m.text}</span>`;
      } else {
        msgEl.innerHTML = `<span>📜 ${m.text}</span>`;
      }

      this.logEl.appendChild(msgEl);

      // Auto fade toast after 10s
      setTimeout(() => {
        if (!this.isOpen && msgEl.parentNode) {
          msgEl.style.opacity = "0.2";
        }
      }, 10000);
    });

    this._scrollToBottom();
  }

  _scrollToBottom() {
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /**
   * Generates AI thematic response for single player.
   */
  handleAiResponse(sim, userText, targetSeat = -1) {
    const txt = userText.toLowerCase();
    const aiSeats = sim.players.filter(p => p.id !== 0 && !p.out);
    if (aiSeats.length === 0) return;

    let targetAi = null;
    if (targetSeat >= 0) {
      targetAi = sim.players[targetSeat];
    } else {
      targetAi = aiSeats[Math.floor(Math.random() * aiSeats.length)];
    }

    if (!targetAi) return;

    let reply = "";
    if (txt.includes("ally") || txt.includes("peace") || txt.includes("pact")) {
      reply = "By the heights of Vanashira, our tridents shall not cross. Honour the mountain pact!";
    } else if (txt.includes("gold") || txt.includes("tribute") || txt.includes("help") || txt.includes("resource")) {
      reply = "The mountain streams provide. Send carts to our Kosha depot and we shall share.";
    } else if (txt.includes("attack") || txt.includes("war") || txt.includes("charge")) {
      reply = "The Nagada drums are beating! Our vanguard marches upon the enemy hall!";
    } else {
      reply = "The sacred Kailash trial watches us all. Show your strength upon the field!";
    }

    setTimeout(() => {
      this.addMessage({
        author: targetAi.name,
        text: reply,
        type: targetSeat >= 0 ? "whisper" : "normal",
        color: targetAi.colour || "#e63946",
        channel: targetSeat >= 0 ? "whisper" : (targetSeat === -2 ? "allies" : "all"),
        target: 0
      });
    }, 600 + Math.random() * 500);
  }
}
