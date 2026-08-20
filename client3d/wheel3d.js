// Himalayan Mandala Alignment Wheel for Swarajya 3D (Bottom-Left HUD)
// Displays player Creed Path (Purusha, Shakti, Abheda) and spiritual devotion level.

export class Wheel3D {
  /**
   * @param {HTMLElement} containerEl 
   */
  constructor(containerEl) {
    this.container = containerEl;
    this._setupDOM();
  }

  _setupDOM() {
    this.wrapper = document.createElement("div");
    this.wrapper.id = "alignment-wheel-wrapper";
    this.wrapper.style.cssText = `
      position: absolute;
      bottom: 12px;
      left: 12px;
      width: 100px;
      height: 100px;
      z-index: 15;
      pointer-events: none;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.75));
    `;

    this.wrapper.innerHTML = `
      <svg width="100" height="100" viewBox="0 0 130 130">
        <defs>
          <radialGradient id="wheelCenterGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffd166" stop-opacity="0.9"/>
            <stop offset="80%" stop-color="#f4a261" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="#264653" stop-opacity="0.9"/>
          </radialGradient>
        </defs>

        <!-- Outer Bronze Ring -->
        <circle cx="65" cy="65" r="58" fill="none" stroke="#d4a373" stroke-width="3"/>
        <circle cx="65" cy="65" r="54" fill="#141822" stroke="#4a5568" stroke-width="1.5"/>

        <!-- Three Sacred Path Petals -->
        <!-- Top Petal: Purusha (Divine Law) -->
        <path id="petal-purusha" d="M65,65 L52,22 Q65,12 78,22 Z" fill="#457b9d" stroke="#d4a373" stroke-width="1.2" opacity="0.45"/>
        <!-- Bottom-Right Petal: Shakti (Beasts & Nature) -->
        <path id="petal-shakti" d="M65,65 L102,82 Q108,98 90,105 Z" fill="#2a9d8f" stroke="#d4a373" stroke-width="1.2" opacity="0.45"/>
        <!-- Bottom-Left Petal: Abheda (Siege Mechanics) -->
        <path id="petal-abheda" d="M65,65 L28,82 Q22,98 40,105 Z" fill="#e76f51" stroke="#d4a373" stroke-width="1.2" opacity="0.45"/>

        <!-- Sacred Center Bindu / Gem -->
        <circle id="wheel-bindu" cx="65" cy="65" r="16" fill="url(#wheelCenterGrad)" stroke="#ffd166" stroke-width="2"/>
        <circle cx="65" cy="65" r="7" fill="#ffffff" opacity="0.8"/>

        <!-- Path Labels -->
        <text x="65" y="32" font-size="9" fill="#e5e7eb" font-weight="bold" text-anchor="middle" font-family="monospace">PURUSHA</text>
        <text x="96" y="96" font-size="8" fill="#e5e7eb" font-weight="bold" text-anchor="middle" font-family="monospace">SHAKTI</text>
        <text x="34" y="96" font-size="8" fill="#e5e7eb" font-weight="bold" text-anchor="middle" font-family="monospace">ABHEDA</text>
      </svg>
    `;

    this.container.appendChild(this.wrapper);
  }

  update(player) {
    if (!player) return;
    const path = player.path; // "vanashira" (purusha), "matrika" (shakti), "kankala" (abheda)

    const pPurusha = this.wrapper.querySelector("#petal-purusha");
    const pShakti = this.wrapper.querySelector("#petal-shakti");
    const pAbheda = this.wrapper.querySelector("#petal-abheda");
    const bindu = this.wrapper.querySelector("#wheel-bindu");

    if (pPurusha) pPurusha.setAttribute("opacity", path === "vanashira" ? "1.0" : "0.4");
    if (pShakti) pShakti.setAttribute("opacity", path === "matrika" ? "1.0" : "0.4");
    if (pAbheda) pAbheda.setAttribute("opacity", path === "kankala" ? "1.0" : "0.4");

    if (bindu) {
      if (path === "vanashira") bindu.setAttribute("fill", "#457b9d");
      else if (path === "matrika") bindu.setAttribute("fill", "#2a9d8f");
      else if (path === "kankala") bindu.setAttribute("fill", "#e76f51");
    }
  }
}
