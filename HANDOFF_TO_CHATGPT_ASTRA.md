# 🏔️ SWARAJYA 3D — MASTER HANDOFF TO CHATGPT ASTRA

> **Author / Engine**: Antigravity AI  
> **Target Agent**: ChatGPT Astra  
> **Workspace**: `D:\abstract\` (Web & Desktop RTS Engine)  
> **Live Web**: [https://swarajya.shaolinpanda.com](https://swarajya.shaolinpanda.com) | [https://swarajya.shaolinpanda.com/arena.html](https://swarajya.shaolinpanda.com/arena.html)  
> **GitHub Pages**: [https://aranyachopra37-dot.github.io/swarajya-3d/](https://aranyachopra37-dot.github.io/swarajya-3d/)  
> **Status**: **100% Production Ready • 29/29 Unit Tests Passing • Dual-Chain Mainnet Deployed**

---

## 📌 1. EXECUTIVE SUMMARY & PROJECT ESSENCE

**Swarajya 3D** is a high-performance, 3D WebGL / Native Desktop Real-Time Strategy (RTS) game modeled after the classic mechanics of ***Warrior Kings: Battles* (2003)** and rich **Himalayan Siddha lore**. 

It features:
- **20Hz Deterministic Lockstep Engine**: Integer-cost Dijkstra flow-fields (`dominion/grid.js` and `dominion/sim.js`), zero-divergence simulation, full multiplayer replay & referee verification.
- **Dual-Chain Web3 Ecosystem**:
  - **Abstract Mainnet (Chain ID 2741)**: Leaderboard & 1v1 Escrow smart contracts verified on Abscan.
  - **Solana Mainnet (SVM Anchor Program)**: High-speed 1v1 Wager Arena with automated 4% protocol rake to creator treasury and 96% instant winner pot.
- **Warrior Kings Mechanics**: Fortified Manor starts ($5\times 5$ perimeter walls + interactive gatehouse), wall-mounting for ranged units ($+50\%$ range, $+35\%$ defense), Grama (village) farming economics with supply carts, tactical military formations (*Pankti, Garuḍa, Vajra*), tactical stances, and Sacred Himalayan Tirthas.
- **Dedicated 1v1 Solana Wager Arena (`arena.html`)**: Streamlined, high-speed **Gold-Only Economic Mode** (5–8 minute esports matches) with one-click Twitter/Discord match invite generator.

---

## 👛 2. ON-CHAIN ADDRESSES, SMART CONTRACTS & TREASURY

### **A. Solana Mainnet (SVM Anchor Program)**
* **Official Creator Treasury Wallet**:
  $$\mathbf{4U1j9CsfSLRKCgM2jt4Fksxo1hX2UQ1gtpNF5UnSwXYv}$$
  *(All 4% protocol wager rakes and secondary cNFT royalties deposit automatically here)*
* **Anchor Escrow Program**: `D:\abstract\solana\programs\swarajya_battleground\src\lib.rs`
  * Wager Presets: Free / 0.05 SOL / 0.10 SOL / 0.50 SOL
  * Fee Split: **96% to Victor**, **4% Creator Treasury Rake**
* **Universal Solana Wallet Connector**: `D:\abstract\game\client3d\solana_wallet.js`
  * Multi-provider detection: Phantom (`window.phantom.solana`), Solflare (`window.solflare`), Backpack (`window.backpack`), Coinbase Solana (`window.coinbaseSolana`), generic `window.solana`.
  * Fallback manual base58 address entry with `localStorage` persistence and multi-RPC balance fetching (`api.mainnet-beta.solana.com`, `rpc.ankr.com/solana`).

### **B. Abstract Mainnet (Chain ID 2741 - ZK EVM)**
* **Admin / AGW Wallet**: `0xE9892d66AecB2471C5FCfc9a75681D57e50Ce20e`
* **Verified Smart Contracts**:
  * **`Battleground` (1v1 Escrow)**: [`0xAf7B7d8969c606de25D2fa05996D78EB841caE90`](https://abscan.org/address/0xAf7B7d8969c606de25D2fa05996D78EB841caE90)
  * **`GameScore` (Leaderboard)**: [`0x9e7e104ADD9F1D7b253BCD7D6A056f96B15c0C26`](https://abscan.org/address/0x9e7e104ADD9F1D7b253BCD7D6A056f96B15c0C26)
  * **`HelloAbstract` (Genesis)**: [`0x41dddac182d38E26Ff6C35d0BFE263A4704e9D60`](https://abscan.org/address/0x41dddac182d38E26Ff6C35d0BFE263A4704e9D60)

---

## 🏛️ 3. CORE ARCHITECTURE & CODEBASE STRUCTURE

```text
D:\abstract\
├── game\                         # Core Game Engine & Web/Desktop Assets
│   ├── swarajya3d.html           # Main 3D Game Client & Skirmish / Campaign Hub
│   ├── arena.html                # Dedicated 1v1 Solana Wager Arena & Marketing Portal
│   ├── editor.html               # Himalayan Map & Scenario Sculptor Editor
│   ├── docs.html                 # Complete Gameplay Docs & Lore Wiki
│   ├── client3d\                 # Three.js 3D WebGL Rendering Layer
│   │   ├── main3d.js             # Main 3D Controller, RTS Camera, Audio & HUD
│   │   ├── entities3d.js         # Unit, Building & Himalayan Mesh Rendering
│   │   ├── terrain3d.js          # Procedural 3D Terrain, Water Shader & Heightmap
│   │   ├── solana_wallet.js      # Solana Universal Multi-Wallet Manager
│   │   ├── lore_audio.js         # Procedural Audio & Himalayan Lore Sitar/Flute Music
│   │   └── multiplayer.js        # WebRTC / WebSocket Lockstep Peer-to-Peer Relay
│   ├── dominion\                 # Core Deterministic Simulation & AI
│   │   ├── sim.js                # Deterministic 20Hz Simulation State & Game Rules
│   │   ├── grid.js               # Integer-Cost Flow-Field & Dijkstra Pathfinding
│   │   └── ai.js                 # Multi-Tiered Himalayan AI Opponents
│   ├── desktop\                  # Electron Native Desktop Engine
│   │   ├── main.cjs              # Cloud Auto-Sync & Local Offline Fallback
│   │   └── package.json          # Electron Packaging Configuration
│   └── test\                     # Automated Unit Test Suite (29 Tests)
│       ├── four_kings.test.js
│       ├── campaign_chapters_and_cutscenes.test.js
│       ├── manor_perimeter_and_gold_only.test.js
│       ├── sacred_tirthas.test.js
│       ├── wall_mounting_and_gates.test.js
│       ├── control_groups_and_orders.test.js
│       ├── formations_and_stances.test.js
│       ├── warrior_kings_features.test.js
│       ├── heroes_and_spells.test.js
│       ├── diplomacy_and_new_units.test.js
│       └── rally_and_queue.test.js
├── solana\                       # Solana SVM Program (Anchor)
│   └── programs\swarajya_battleground\src\lib.rs
├── swarajya-web-dist\            # Production Distribution Directory (GitHub Pages Git Repo)
├── create_desktop_shortcut.ps1   # PowerShell Desktop Shortcut Generator
├── launch_desktop_game.bat       # One-Click Desktop Launcher
└── README.md                     # Repository Documentation
```

---

## ⚔️ 4. GAMEPLAY MECHANICS & VERIFIED FEATURES

### **1. 🏰 Fortified Manor Courtyards (*Warrior Kings: Battles*)**
* Every starting Manor spawns enclosed within a **$5\times 5$ Stone Wall Perimeter (`Prakara`)** with an outward-facing **Interactive Gatehouse (`Dwara`)**.
* Friendly units and carts pass freely; enemy troops are blocked and must siege the wall/gate.
* Ranged units (*Dhanurdhara* archers / *Yogini* mystics) gain **$+50\%$ Range** and **$+35\%$ Defense** when positioned on walls.

### **2. 🟡 Gold-Only Economic Mode (Novice / 1v1 Arena Mode)**
* Toggleable in match settings or URL (`?gold_only=1`).
* Converts all building and unit costs strictly to **Gold**.
* Waives timber/food requirements and disables starvation upkeep for fast-paced 5–8 minute tactical matches.

### **3. 🌾 Village Economy & Supply Carts**
* **Grama (Village Warehouse)**: Acts as a rural hub that auto-trains farmers (*Krishaka*) who automatically cultivate surrounding farmlands.
* Spawns 1 free supply cart upon construction.

### **4. 🔱 Formations, Stances & Sacred Tirthas**
* **Formations**: *Pankti* (Line), *Garuḍa* (Wedge), *Vajra* (Diamond).
* **Tactical Stances**: Aggressive, Defensive, Stand Ground, Hold Fire.
* **Tirthas**: Shrines of Surya (+15% attack aura), Kavacha (+25% building HP aura), Agni, and Vayu.
* **Heroes**: *Chhatrapati* (Vajra Shockwave), *Maharani* (Sudarshana Shield), *Acharya* (Mahapralaya Storm).

---

## 🖥️ 5. DESKTOP APP & AUTO-UPDATE ENGINE

* **Desktop Shortcut**: `C:\Users\Lenovo\Desktop\Swarajya 3D.lnk` (pointing to `D:\abstract\launch_desktop_game.bat`).
* **Cloud Auto-Sync**: When launched, Electron (`desktop/main.cjs`) checks the live repository / domain for updates and seamlessly runs the latest build, with automatic offline local fallback.

---

## 🧪 6. HOW TO RUN TESTS & VERIFY

To run the full 29-test automated test suite:
```powershell
cd D:\abstract\game
node --test test/four_kings.test.js test/campaign_chapters_and_cutscenes.test.js test/manor_perimeter_and_gold_only.test.js test/sacred_tirthas.test.js test/wall_mounting_and_gates.test.js test/control_groups_and_orders.test.js test/formations_and_stances.test.js test/warrior_kings_features.test.js test/heroes_and_spells.test.js test/diplomacy_and_new_units.test.js test/rally_and_queue.test.js
```
*(All 29 tests pass deterministically with 0 failures).*

---

## 🚀 7. HOW TO DEPLOY UPDATES TO GITHUB PAGES & CLOUDFLARE

When code changes are made in `game/`:
```powershell
cd D:\abstract
# 1. Sync game files to web dist
Copy-Item -Path "game\client3d\*" -Destination "swarajya-web-dist\client3d" -Recurse -Force
Copy-Item -Path "game\dominion\*" -Destination "swarajya-web-dist\dominion" -Recurse -Force
Copy-Item -Path "game\swarajya3d.html" -Destination "swarajya-web-dist\index.html" -Force
Copy-Item -Path "game\swarajya3d.html" -Destination "swarajya-web-dist\swarajya3d.html" -Force
Copy-Item -Path "game\arena.html" -Destination "swarajya-web-dist\arena.html" -Force
Copy-Item -Path "game\docs.html" -Destination "swarajya-web-dist\docs.html" -Force
Copy-Item -Path "game\editor.html" -Destination "swarajya-web-dist\editor.html" -Force
Copy-Item -Path "game\CNAME" -Destination "swarajya-web-dist\CNAME" -Force

# 2. Commit and Push
cd D:\abstract\swarajya-web-dist
git add -A
git commit -m "Update Swarajya 3D build"
git push origin main
```

### **Cloudflare DNS Setup for `swarajya.shaolinpanda.com`**:
* Type: `CNAME`
* Name: `swarajya`
* Target: `aranyachopra37-dot.github.io`
* Proxy status: **Proxied (Orange Cloud)** *(Terminates SSL instantly for zero browser warnings)*
* SSL/TLS Encryption mode: **Full**

---

## 🎯 8. KEY OPERATOR / USER DIRECTIVES

1. **Treasury Rule**: All Solana protocol fees ($4\%$) MUST deposit directly to `4U1j9CsfSLRKCgM2jt4Fksxo1hX2UQ1gtpNF5UnSwXYv`.
2. **Vault Safety**: Never modify, move, or delete files in `E:\ai work` or media in `E:\BSH casting work\bsh work screen recoding`.
3. **Determinism Rule**: Never use `Math.sin`, `Math.cos`, or `Math.pow` inside simulation step logic (`dominion/sim.js`); only use exact IEEE-754 ops (`Math.sqrt`, `+ - * /`).

---

**Handover complete. ChatGPT Astra is fully equipped to maintain, expand, and operate Swarajya 3D.**
