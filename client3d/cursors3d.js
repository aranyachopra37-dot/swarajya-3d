// Dynamic Contextual In-Game Mouse Cursors for Swarajya 3D
// Generates crisp, high-DPI SVG RTS cursors with action icons and assignment chain links.

// 1. Default Himalayan Golden Dagger Pointer
const CURSOR_DEFAULT = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="%23000000" flood-opacity="0.8"/>
    </filter>
  </defs>
  <g filter="url(%23shadow)">
    <path d="M4,4 L18,14 L12,17 L17,26 L13,28 L8,19 L4,23 Z" fill="%23f4a261" stroke="%23264653" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M6,6 L15,13 L11,15 L14,22 L12,23 L9,16 L6,19 Z" fill="%23ffd166"/>
    <circle cx="10" cy="11" r="1.8" fill="%23e63946"/>
  </g>
</svg>`;

// 2. Gold Mining Pickaxe Cursor with Interlocking Golden Chain (⛏️ + 🔗)
const CURSOR_MINE = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="%23000000" flood-opacity="0.85"/>
    </filter>
  </defs>
  <g filter="url(%23shadow)">
    <!-- Pickaxe Head -->
    <path d="M12,5 C18,7 25,12 28,19 C26,17 21,15 17,16 L19,14 L15,10 Z" fill="%238a929a" stroke="%231a1a1a" stroke-width="1.5"/>
    <path d="M14,7 C19,9 23,13 25,18" stroke="%23ffd166" stroke-width="1.2" stroke-linecap="round"/>
    <!-- Wooden Shaft -->
    <line x1="16" y1="13" x2="5" y2="28" stroke="%238b5a2b" stroke-width="3" stroke-linecap="round"/>
    <!-- Gold Nugget Sparkles -->
    <polygon points="27,10 29,6 31,10 35,12 31,14 29,18 27,14 23,12" fill="%23ffd166" stroke="%23e76f51" stroke-width="0.8"/>
    
    <!-- Golden Assignment Chain Link -->
    <rect x="22" y="22" width="10" height="5" rx="2.5" fill="none" stroke="%23ffd166" stroke-width="1.8"/>
    <rect x="18" y="24" width="10" height="5" rx="2.5" fill="none" stroke="%23f4a261" stroke-width="1.8"/>
  </g>
</svg>`;

// 3. Woodcutting / Felling Axe Cursor with Golden Chain (🪓 + 🔗)
const CURSOR_FELL = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="%23000000" flood-opacity="0.85"/>
    </filter>
  </defs>
  <g filter="url(%23shadow)">
    <!-- Wooden Handle -->
    <line x1="16" y1="12" x2="6" y2="29" stroke="%23a0522d" stroke-width="3.2" stroke-linecap="round"/>
    <!-- Axe Blade -->
    <path d="M15,10 C18,5 26,6 29,12 C25,16 18,17 14,14 Z" fill="%23adb5bd" stroke="%23212529" stroke-width="1.6"/>
    <path d="M25,8 C27,10 27,12 26,14" stroke="%237fd48f" stroke-width="1.2"/>
    <!-- Pine Branch -->
    <path d="M26,18 L30,15 L28,20 L32,19 L28,24 Z" fill="%232d6a4f" stroke="%231b4332" stroke-width="0.8"/>
    <!-- Golden Assignment Chain Link -->
    <rect x="22" y="24" width="10" height="5" rx="2.5" fill="none" stroke="%23ffd166" stroke-width="1.8"/>
    <rect x="18" y="26" width="10" height="5" rx="2.5" fill="none" stroke="%23f4a261" stroke-width="1.8"/>
  </g>
</svg>`;

// 4. Harvesting Sickle Cursor (🌾)
const CURSOR_HARVEST = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="%23000000" flood-opacity="0.8"/>
    </filter>
  </defs>
  <g filter="url(%23shadow)">
    <!-- Sickle Blade -->
    <path d="M8,20 C8,10 18,4 26,8 C20,9 13,15 14,22 Z" fill="%23dee2e6" stroke="%23343a40" stroke-width="1.5"/>
    <line x1="8" y1="20" x2="4" y2="28" stroke="%238b5a2b" stroke-width="3" stroke-linecap="round"/>
    <!-- Wheat Stalk -->
    <path d="M20,18 Q25,16 28,11 M22,15 Q27,12 30,8 M24,19 Q29,17 31,14" stroke="%23e9c46a" stroke-width="1.8" stroke-linecap="round"/>
    <!-- Chain Link -->
    <rect x="22" y="23" width="9" height="4.5" rx="2.2" fill="none" stroke="%23ffd166" stroke-width="1.6"/>
  </g>
</svg>`;

// 5. Mason Hammer / Construction Cursor (🔨)
const CURSOR_BUILD = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="%23000000" flood-opacity="0.8"/>
    </filter>
  </defs>
  <g filter="url(%23shadow)">
    <!-- Mallet Handle -->
    <line x1="14" y1="15" x2="5" y2="28" stroke="%23a0522d" stroke-width="3.2" stroke-linecap="round"/>
    <!-- Hammer Head -->
    <polygon points="12,8 24,16 20,22 8,14" fill="%23495057" stroke="%23212529" stroke-width="1.6"/>
    <polygon points="13,9 22,15 19,19 10,13" fill="%236c757d"/>
    <!-- Impact Sparks -->
    <line x1="26" y1="12" x2="31" y2="9" stroke="%23f4a261" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="28" y1="17" x2="33" y2="18" stroke="%23f4a261" stroke-width="1.5" stroke-linecap="round"/>
  </g>
</svg>`;

// 6. Attack Crossed Swords Cursor (⚔️)
const CURSOR_ATTACK = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="%23e63946" flood-opacity="0.9"/>
    </filter>
  </defs>
  <g filter="url(%23glow)">
    <!-- Blade 1 -->
    <line x1="6" y1="6" x2="26" y2="26" stroke="%23f8f9fa" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="5" y1="11" x2="11" y2="5" stroke="%23e63946" stroke-width="2"/>
    <circle cx="5" cy="5" r="2.2" fill="%23ffd166"/>
    <!-- Blade 2 -->
    <line x1="26" y1="6" x2="6" y2="26" stroke="%23f8f9fa" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="25" y1="11" x2="19" y2="5" stroke="%23e63946" stroke-width="2"/>
    <circle cx="27" cy="5" r="2.2" fill="%23ffd166"/>
  </g>
</svg>`;

// 7. Tactical Move / Navigation Target Cursor (🧭)
const CURSOR_MOVE = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="%23000000" flood-opacity="0.8"/>
    </filter>
  </defs>
  <g filter="url(%23shadow)">
    <!-- Target Outer Ring -->
    <circle cx="16" cy="16" r="10" fill="none" stroke="%2352b788" stroke-width="2" stroke-dasharray="3,2"/>
    <circle cx="16" cy="16" r="4" fill="%2352b788" opacity="0.6"/>
    <circle cx="16" cy="16" r="1.5" fill="%23ffffff"/>
    <!-- Cardinal Crosshairs -->
    <line x1="16" y1="2" x2="16" y2="7" stroke="%237fd48f" stroke-width="2"/>
    <line x1="16" y1="25" x2="16" y2="30" stroke="%237fd48f" stroke-width="2"/>
    <line x1="2" y1="16" x2="7" y2="16" stroke="%237fd48f" stroke-width="2"/>
    <line x1="25" y1="16" x2="30" y2="16" stroke="%237fd48f" stroke-width="2"/>
  </g>
</svg>`;

// 8. Select / Friendly Hand Cursor (✋)
const CURSOR_SELECT = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="%23000000" flood-opacity="0.8"/>
    </filter>
  </defs>
  <g filter="url(%23shadow)">
    <path d="M12,18 L12,9 C12,7.5 13.5,7.5 13.5,9 L13.5,16 M14,16 L14,6 C14,4.5 15.5,4.5 15.5,6 L15.5,16 M16,16 L16,7.5 C16,6 17.5,6 17.5,7.5 L17.5,17 M18,17 L18,11 C18,9.5 19.5,9.5 19.5,11 L19.5,20 C19.5,25 15,28 11,27 C8.5,26.5 7,24 8.5,22 L11,18 C11.5,17 12,17 12,18 Z" fill="%23ffd166" stroke="%23d4a373" stroke-width="1.5" stroke-linejoin="round"/>
  </g>
</svg>`;

export class CursorManager {
  /**
   * @param {HTMLElement} targetElement 
   */
  constructor(targetElement = document.body) {
    this.target = targetElement;
    this.currentMode = "default";
    this.setCursor("default");
  }

  /**
   * Sets the contextual cursor type.
   * @param {'default'|'mine'|'fell'|'harvest'|'build'|'attack'|'move'|'select'} mode 
   */
  setCursor(mode) {
    if (this.currentMode === mode) return;
    this.currentMode = mode;

    let url = CURSOR_DEFAULT;
    let hotX = 4;
    let hotY = 4;

    switch (mode) {
      case "mine":
        url = CURSOR_MINE;
        hotX = 14;
        hotY = 8;
        break;
      case "fell":
        url = CURSOR_FELL;
        hotX = 16;
        hotY = 8;
        break;
      case "harvest":
        url = CURSOR_HARVEST;
        hotX = 10;
        hotY = 10;
        break;
      case "build":
        url = CURSOR_BUILD;
        hotX = 14;
        hotY = 14;
        break;
      case "attack":
        url = CURSOR_ATTACK;
        hotX = 16;
        hotY = 16;
        break;
      case "move":
        url = CURSOR_MOVE;
        hotX = 16;
        hotY = 16;
        break;
      case "select":
        url = CURSOR_SELECT;
        hotX = 14;
        hotY = 6;
        break;
      default:
        url = CURSOR_DEFAULT;
        hotX = 4;
        hotY = 4;
        break;
    }

    this.target.style.cursor = `url("${url}") ${hotX} ${hotY}, auto`;
  }
}
