// In-Game RTS Chat & Tactical Broadcast System for Swarajya 3D
// Supports global/team chat, lockstep messaging, diplomacy alerts, and AI interactive banter.

export class Chat3D {
  /**
   * @param {HTMLElement} container 
   * @param {(text: string, targetSeat: number) => void} onSendMessage 
   */
  constructor(container = document.body, onSendMessage = () => {}) {
    this.container = container;
    this.onSendMessage = onSendMessage;
    this.isOpen = false;
    this.messages = [];

    this._createDOM();
    this._bindKeys();
  }

  _createDOM() {
    this.panel = document.createElement("div");
    this.panel.id = "rts-chat-panel";
    this.panel.innerHTML = `
      <div id="rts-chat-log"></div>
      <div id="rts-chat-input-row" style="display:none;">
        <span id="rts-chat-prefix">📜 [ALL]:</span>
        <input type="text" id="rts-chat-input" placeholder="Press Enter to send message / orders..." maxlength="120" />
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #rts-chat-panel {
        position: absolute;
        bottom: 120px;
        left: 20px;
        width: 380px;
        max-height: 220px;
        z-index: 100;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
      }
      #rts-chat-log {
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow-y: hidden;
        margin-bottom: 6px;
      }
      .chat-msg {
        background: rgba(14, 18, 26, 0.85);
        border-left: 3px solid #f4a261;
        border-radius: 4px;
        padding: 4px 10px;
        font-size: 11px;
        line-height: 1.4;
        color: #e5e7eb;
        backdrop-filter: blur(8px);
        box-shadow: 0 2px 10px rgba(0,0,0,0.4);
        animation: chatFade 0.25s ease;
        transition: opacity 1s ease;
      }
      .chat-msg.system { border-left-color: #ffd166; color: #ffd166; font-style: italic; }
      .chat-msg.diplomacy { border-left-color: #7fd48f; color: #a7f3d0; }
      .chat-msg.enemy { border-left-color: #e63946; }
      .chat-author { font-weight: bold; margin-right: 6px; }
      #rts-chat-input-row {
        pointer-events: auto;
        display: flex;
        align-items: center;
        background: rgba(18, 22, 32, 0.95);
        border: 1px solid #4b5563;
        border-radius: 6px;
        padding: 4px 8px;
        gap: 8px;
        backdrop-filter: blur(12px);
      }
      #rts-chat-prefix { font-size: 11px; color: #f4a261; font-weight: bold; }
      #rts-chat-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: #f9fafb;
        font-family: inherit;
        font-size: 12px;
      }
      @keyframes chatFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
    this.container.appendChild(this.panel);

    this.logEl = this.panel.querySelector("#rts-chat-log");
    this.inputRow = this.panel.querySelector("#rts-chat-input-row");
    this.inputEl = this.panel.querySelector("#rts-chat-input");
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
      }
    });
  }

  open() {
    this.isOpen = true;
    this.inputRow.style.display = "flex";
    this.inputEl.value = "";
    this.inputEl.focus();
  }

  close() {
    this.isOpen = false;
    this.inputRow.style.display = "none";
    this.inputEl.blur();
  }

  _submitMessage() {
    const text = this.inputEl.value.trim();
    if (text) {
      this.onSendMessage(text, -1);
    }
    this.close();
  }

  /**
   * Adds an incoming message to the chat feed.
   */
  addMessage({ author = "System", text, type = "normal", color = "#f4a261" }) {
    const msgEl = document.createElement("div");
    msgEl.className = `chat-msg ${type}`;
    if (type !== "system") {
      msgEl.innerHTML = `<span class="chat-author" style="color:${color};">[${author}]:</span>${text}`;
    } else {
      msgEl.innerHTML = `<span>📜 ${text}</span>`;
    }

    this.logEl.appendChild(msgEl);
    if (this.logEl.children.length > 8) {
      this.logEl.removeChild(this.logEl.firstChild);
    }

    // Auto fade after 12 seconds
    setTimeout(() => {
      if (msgEl.parentNode) {
        msgEl.style.opacity = "0.2";
      }
    }, 12000);
  }

  /**
   * Generates AI thematic response for single player.
   */
  handleAiResponse(sim, userText) {
    const txt = userText.toLowerCase();
    const aiSeats = sim.players.filter(p => p.id !== 0 && !p.out);
    if (aiSeats.length === 0) return;

    const targetAi = aiSeats[Math.floor(Math.random() * aiSeats.length)];
    let reply = "";

    if (txt.includes("ally") || txt.includes("peace") || txt.includes("pact")) {
      reply = "By the heights of Vanashira, our tridents shall not cross. Honour the mountain pact!";
    } else if (txt.includes("gold") || txt.includes("tribute") || txt.includes("help")) {
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
        type: "normal",
        color: targetAi.colour || "#e63946",
      });
    }, 800 + Math.random() * 600);
  }
}
