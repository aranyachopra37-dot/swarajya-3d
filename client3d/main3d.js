// Swarajya 3D Client Entrypoint — Master Edition
// 20Hz Deterministic Sim + Minimap + Alignment Wheel + Dynamic Cursors + Lore Audio + 3D Construction Sites + Sky3D

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import {
  createSim, step, MAPS, TICKS_PER_SECOND,
  queueBuild, queueTrain, queueOrder, queueAttack, queueForm, canBuild,
  priceOf, BUILDINGS, UNITS
} from "../dominion/sim.js";
import { think, TIERS } from "../dominion/ai.js";
import { cmd, applyCommand } from "../dominion/net.js";
import { Terrain3D } from "./terrain3d.js";
import { RtsCamera3D } from "./camera3d.js";
import { Render3D } from "./render3d.js";
import { Sky3D } from "./sky3d.js";
import { Vfx3D } from "./vfx3d.js";
import { FogOfWar3D } from "./fog3d.js";
import { Multiplayer3D } from "./multiplayer3d.js";
import { CursorManager } from "./cursors3d.js";
import { LoreAudio3D } from "./lore_audio3d.js";
import { Minimap3D } from "./minimap3d.js";
import { Wheel3D } from "./wheel3d.js";
import { Chat3D } from "./chat3d.js";
import { Diplomacy3D } from "./diplomacy3d.js";
import { SolanaWalletManager } from "./solana_wallet.js";
import { FORMATIONS } from "./formations.js";
import { TILE, GOLD, FOREST, WATER } from "../dominion/grid.js";

const TICK_DURATION = 1.0 / TICKS_PER_SECOND; // 50ms per simulation tick

class Swarajya3DApp {
  constructor() {
    this.container = document.getElementById("canvas-container");
    this.selection = new Set();
    this.localPlayer = 0;
    this.currentMapId = "fourKings";
    this.currentAiTier = 1; // Durgadhyaksha
    this.fogOfWarEnabled = false;
    this.placingBuildingType = null;
    this.audioStarted = false;
    this.isOnline = false;

    this.dragStart = null;
    this.isBoxSelecting = false;
    this.selectBoxEl = document.getElementById("select-box");

    this.controlGroups = new Map();
    this.lastGroupTap = { key: null, time: 0 };
    this.orderMode = null;
    this.alwaysShowHealthBars = false;
    this.solanaWallet = new SolanaWalletManager();

    this._initThree();
    this._initSim(this.currentMapId);
    this._initInput();
    this._initMultiplayer();
    this._initMenuUI();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("autostart")) {
      this.matchStarted = true;
      const menuModal = document.getElementById("main-menu-modal");
      if (menuModal) menuModal.style.display = "none";
      setTimeout(() => {
        this._selectNextIdlePeasant();
      }, 500);
    }

    this._initLoop();
  }

  _initThree() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x8ecae6, 0.00035);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 5, 8000);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3d405b, 0.85);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff3b0, 1.45);
    this.dirLight.position.set(150, 250, 150);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 1600;
    const d = 600;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);

    // 3D Placement Ghost Box
    const ghostGeo = new THREE.BoxGeometry(TILE * 2, 8, TILE * 2);
    this.ghostMaterial = new THREE.MeshStandardMaterial({
      color: 0x52b788,
      transparent: true,
      opacity: 0.6,
    });
    this.ghostMesh = new THREE.Mesh(ghostGeo, this.ghostMaterial);
    this.ghostMesh.visible = false;
    this.scene.add(this.ghostMesh);

    // Dynamic Systems
    this.vfx = new Vfx3D(this.scene, this.camera);
    this.sky = new Sky3D(this.scene, this.dirLight, hemiLight, "snow");
    this.cursors = new CursorManager(document.body);
    this.loreAudio = new LoreAudio3D();
    this.wheel = new Wheel3D(document.body);

    window.addEventListener("resize", () => this._onResize());
  }

  _initSim(mapId = "twoGates", seed = 94301, localPlayer = 0, scenarioId = null, goldOnly = false) {
    if (this.terrain) this.terrain.dispose();
    if (this.renderer3D) this.renderer3D.dispose();

    this.localPlayer = localPlayer;
    this.currentMapId = mapId;
    this.currentScenarioId = scenarioId;
    this.sim = createSim(seed, mapId, scenarioId, goldOnly);

    const actualMapId = this.sim.scenario ? this.sim.scenario.mapId : mapId;
    const map = MAPS[actualMapId] || MAPS.kailashSanctum || MAPS.trishulPass;
    const worldW = map.w * TILE;
    const worldH = map.h * TILE;

    this.terrain = new Terrain3D(this.scene, THREE);
    this.terrain.build(this.sim.grid);

    this.renderer3D = new Render3D(this.scene, THREE, this.terrain);
    this.rtsCamera = new RtsCamera3D(this.camera, this.renderer.domElement, { width: worldW, height: worldH });

    // Cinematic default camera pitch (42 degrees)
    this.rtsCamera.targetPitch = 42 * (Math.PI / 180);
    this.rtsCamera.targetDistance = 380;

    if (!this.minimap) {
      this.minimap = new Minimap3D(document.body, this.rtsCamera, this.camera);
    }
    this.minimap.initTerrain(this.sim);

    if (this.loreAudio) {
      this.loreAudio.setMapTerrain(actualMapId);
    }

    if (this.sky) {
      this.sky.setWeather(map.weather || (actualMapId === "kailashSanctum" || actualMapId === "trishulPass" ? "snow" : "clear"));
    }

    if (!this.fog) {
      this.fog = new FogOfWar3D(this.scene, map.w, map.h);
    } else {
      this.fog.reset(map.w, map.h);
    }
    this.fog.enabled = this.fogOfWarEnabled;

    if (this.scene.fog) {
      this.scene.fog.density = this.fogOfWarEnabled ? 0.0012 : 0.00035;
    }

    // Campaign HUD display
    const campHud = document.getElementById("campaign-hud");
    if (campHud) {
      if (this.sim.scenario) {
        campHud.style.display = "block";
        const titleEl = document.getElementById("campaign-title");
        if (titleEl) titleEl.innerText = this.sim.scenario.title;
      } else {
        campHud.style.display = "none";
      }
    }

    // Focus on starting Manor
    const localManor = this.sim.buildings.find(b => b.owner === this.localPlayer && b.spec.isHeart);
    if (localManor) {
      const mx = (localManor.tx + localManor.spec.tiles / 2) * TILE;
      const mz = (localManor.ty + localManor.spec.tiles / 2) * TILE;
      this.rtsCamera.focusOn(mx, mz);
    }

    if (!this.chat) {
      this.chat = new Chat3D(document.body, (text, target) => {
        this._dispatchCommand(cmd.chat(text, target));
      });
    }
    this.chat.setSim(this.sim, this.localPlayer);

    if (!this.diplomacy) {
      this.diplomacy = new Diplomacy3D(
        document.body,
        (seat, stance) => this._dispatchCommand(cmd.diplomacy(seat, stance)),
        (seat, res, amt) => this._dispatchCommand(cmd.tribute(seat, res, amt))
      );
    }
  }

  startCampaign(chapterId) {
    this._ensureAudio();
    this.matchStarted = true;
    this.isOnline = false;
    this.fogOfWarEnabled = false;
    this._initSim(null, 94301, 0, chapterId);

    const menuModal = document.getElementById("main-menu-modal");
    if (menuModal) menuModal.style.display = "none";

    const sc = this.sim.scenario;
    if (sc && sc.dialogue && sc.dialogue.length > 0) {
      this._playIntroCutscene(sc);
    }
  }

  _playIntroCutscene(sc) {
    const overlay = document.getElementById("cinematic-overlay");
    if (!overlay) return;
    overlay.style.display = "block";
    this.inCutscene = true;

    let stepIdx = 0;
    const dialogues = sc.dialogue || [];

    const enemyManor = this.sim.buildings.find(b => b.owner !== this.localPlayer && b.spec.isHeart);
    const localManor = this.sim.buildings.find(b => b.owner === this.localPlayer && b.spec.isHeart);

    const showStep = () => {
      if (!this.inCutscene || stepIdx >= dialogues.length) {
        this.skipCutscene();
        return;
      }
      const d = dialogues[stepIdx];
      const avatarEl = document.getElementById("cinematic-avatar");
      const speakerEl = document.getElementById("cinematic-speaker");
      const textEl = document.getElementById("cinematic-text");
      if (avatarEl) avatarEl.textContent = d.avatar || "👑";
      if (speakerEl) speakerEl.textContent = `${d.speaker} (${d.role})`;
      if (textEl) textEl.textContent = d.text;
      this.loreAudio.playTempleBell(648 + stepIdx * 72);

      // Smooth camera pan
      if (stepIdx === 0 && enemyManor) {
        this.rtsCamera.target.set(enemyManor.x, 0, enemyManor.y);
      } else if (localManor) {
        this.rtsCamera.target.set(localManor.x, 0, localManor.y);
      }

      stepIdx++;
      this.cutsceneTimer = setTimeout(showStep, 4800);
    };

    showStep();
  }

  skipCutscene() {
    this.inCutscene = false;
    if (this.cutsceneTimer) clearTimeout(this.cutsceneTimer);
    const overlay = document.getElementById("cinematic-overlay");
    if (overlay) overlay.style.display = "none";

    const localManor = this.sim.buildings.find(b => b.owner === this.localPlayer && b.spec.isHeart);
    if (localManor) {
      this.rtsCamera.focusOn(localManor.x, localManor.y);
    }
  }

  _initMultiplayer() {
    this.mp = new Multiplayer3D({
      onStatus: (status, data) => {
        const statusEl = document.getElementById("mp-status-msg");
        if (!statusEl) return;

        if (status === "waiting_for_peer") {
          statusEl.innerHTML = `<span style="color:#7fd48f">Room Created!</span> Share Code: <strong style="font-size:16px; color:#ffd166; letter-spacing:0.1em;">${data.room}</strong><br><span style="font-size:11px; color:#9ca3af;">Waiting for your friend in Vietnam to join...</span>`;
        } else if (status === "match_ready") {
          statusEl.innerHTML = `<span style="color:#7fd48f">Player Connected! Starting Match...</span>`;
        } else if (status === "joining_room") {
          statusEl.innerHTML = `<span style="color:#ffd166">Joining Room ${data.code}...</span>`;
        } else if (status === "error") {
          statusEl.innerHTML = `<span style="color:#ef476f">${data.reason || data.error || "Connection error"}</span>`;
        } else if (status === "peer_lost") {
          this.vfx.shake(6.0);
        }
      },
      onMatchStart: (config) => {
        this.isOnline = true;
        this.fogOfWarEnabled = config.fogOfWar;
        this._initSim(config.mapId, config.seed, config.localPlayer);
        this.mp.initLockstep(this.sim);

        const menuModal = document.getElementById("main-menu-modal");
        if (menuModal) menuModal.style.display = "none";
      }
    });
  }

  _ensureAudio() {
    if (!this.audioStarted) {
      this.loreAudio.init();
      this.loreAudio.setMapTerrain(this.currentMapId);
      this.audioStarted = true;
    }
  }

  _initInput() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const dom = this.renderer.domElement;

    window.addEventListener("keydown", (e) => {
      this._ensureAudio();
      if (this.chat && this.chat.isOpen) return;

      if (this.inCutscene && (e.code === "Space" || e.key === "Escape")) {
        e.preventDefault();
        this.skipCutscene();
        return;
      }

      const chatInput = document.getElementById("rts-chat-input");
      if (document.activeElement === chatInput) return;

      if (e.key === "." || e.key === "e") {
        this._selectNextIdlePeasant();
      } else if (e.code === "Space") {
        e.preventDefault();
        this._focusCameraOnSelectionOrBase();
      } else if (e.key === "Alt" || e.key === "Tab") {
        e.preventDefault();
        this.alwaysShowHealthBars = !this.alwaysShowHealthBars;
        if (this.renderer3D) this.renderer3D.alwaysShowHealthBars = this.alwaysShowHealthBars;
      } else if (e.key === "Escape") {
        if (this.placingBuildingType) {
          this.placingBuildingType = null;
          this.ghostMesh.visible = false;
        } else if (this.orderMode) {
          this.orderMode = null;
          this.cursors.setCursor("default");
        } else if (this.selection.size > 0) {
          this.selection.clear();
          this._updateContextualHUD();
        } else {
          this._toggleGameMenu();
        }
        return;
      } else if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        // Control Group Binding: Ctrl + 1..9
        e.preventDefault();
        const grp = parseInt(e.key);
        const selIds = Array.from(this.selection).filter(id => this.sim.units.some(u => u.id === id && u.owner === this.localPlayer));
        if (selIds.length > 0) {
          this.controlGroups.set(grp, new Set(selIds));
          this.loreAudio.playWarDrum(80, 0.6);
          this._renderControlGroupBadges();
        }
      } else if (!e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        // Control Group Recall: 1..9 (Single tap to select, Double tap to center camera)
        const grp = parseInt(e.key);
        if (this.controlGroups.has(grp)) {
          const grpSet = this.controlGroups.get(grp);
          const validIds = Array.from(grpSet).filter(id => this.sim.units.some(u => u.id === id && u.owner === this.localPlayer && u.hp > 0));
          if (validIds.length > 0) {
            this.selection = new Set(validIds);
            this._updateContextualHUD();
            const now = Date.now();
            if (this.lastGroupTap.key === grp && (now - this.lastGroupTap.time) < 380) {
              const units = this.sim.units.filter(u => validIds.includes(u.id));
              const avgX = units.reduce((acc, u) => acc + u.x, 0) / units.length;
              const avgZ = units.reduce((acc, u) => acc + u.y, 0) / units.length;
              this.rtsCamera.target.set(avgX, 0, avgZ);
              this.loreAudio.playTempleBell(720);
            }
            this.lastGroupTap = { key: grp, time: now };
          }
        }
      } else if (this.selection.size > 0) {
        const selIds = Array.from(this.selection).filter(id => this.sim.units.some(u => u.id === id && u.owner === this.localPlayer));
        if (selIds.length > 0) {
          if (e.key === "p" || e.key === "P") {
            this.orderMode = "patrol";
            this.cursors.setCursor("attack");
          } else if (e.key === "g" || e.key === "G") {
            this.orderMode = "guard";
            this.cursors.setCursor("attack");
          } else if (e.key === "f" || e.key === "F") {
            const forms = ["line", "wedge", "square", "scatter", "none"];
            const curForm = this.sim.units.find(u => u.id === selIds[0])?.formation || "none";
            const nextForm = forms[(forms.indexOf(curForm) + 1) % forms.length];
            this._dispatchCommand(cmd.formation(selIds, nextForm));
            this.loreAudio.playWarDrum(70, 0.6);
            this._updateContextualHUD();
          } else if (e.key === "z" || e.key === "Z") {
            this._dispatchCommand(cmd.stance(selIds, "aggressive"));
            this.loreAudio.playWarDrum(80, 0.6);
            this._updateContextualHUD();
          } else if (e.key === "x" || e.key === "X") {
            this._dispatchCommand(cmd.stance(selIds, "defensive"));
            this.loreAudio.playWarDrum(65, 0.6);
            this._updateContextualHUD();
          } else if (e.key === "c" || e.key === "C") {
            this._dispatchCommand(cmd.stance(selIds, "stand_ground"));
            this.loreAudio.playWarDrum(50, 0.6);
            this._updateContextualHUD();
          } else if (e.key === "v" || e.key === "V") {
            this._dispatchCommand(cmd.stance(selIds, "hold_fire"));
            this.loreAudio.playWarDrum(40, 0.4);
            this._updateContextualHUD();
          }
        }
      }
    });

    dom.addEventListener("mousemove", (e) => {
      const pt = this._getGroundIntersection(e);

      if (this.placingBuildingType) {
        if (pt) {
          const spec = BUILDINGS[this.placingBuildingType];
          const bw = spec ? spec.tiles : 2;
          const tx = Math.floor(pt.x / TILE);
          const ty = Math.floor(pt.z / TILE);
          const check = canBuild(this.sim, this.localPlayer, this.placingBuildingType, tx, ty);
          const elev = this.terrain ? this.terrain.getHeight(pt.x, pt.z) : 0;

          this.ghostMesh.position.set((tx + bw / 2) * TILE, elev + 4, (ty + bw / 2) * TILE);
          this.ghostMesh.scale.set(bw, 1, bw);
          this.ghostMaterial.color.setHex(check.ok ? 0x52b788 : 0xe63946);
          this.ghostMesh.visible = true;
          this.cursors.setCursor("build");
        }
      } else if (this.isBoxSelecting && this.dragStart) {
        const curX = e.clientX;
        const curY = e.clientY;
        const left = Math.min(this.dragStart.x, curX);
        const top = Math.min(this.dragStart.y, curY);
        const width = Math.abs(curX - this.dragStart.x);
        const height = Math.abs(curY - this.dragStart.y);

        this.selectBoxEl.style.left = `${left}px`;
        this.selectBoxEl.style.top = `${top}px`;
        this.selectBoxEl.style.width = `${width}px`;
        this.selectBoxEl.style.height = `${height}px`;
        this.selectBoxEl.style.display = "block";
      } else {
        this.ghostMesh.visible = false;
        this._updateCursorState(pt);
      }
    });

    dom.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this._ensureAudio();
      if (e.button === 0) {
        if (this.placingBuildingType) {
          this._confirmBuildingPlacement(e);
        } else {
          this.dragStart = { x: e.clientX, y: e.clientY };
          this.isBoxSelecting = true;
        }
      } else if (e.button === 2) {
        if (this.placingBuildingType) {
          this.placingBuildingType = null;
          this.ghostMesh.visible = false;
        } else {
          this._handleRightClick(e);
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0 && this.isBoxSelecting) {
        this.isBoxSelecting = false;
        this.selectBoxEl.style.display = "none";

        if (this.dragStart) {
          const dx = Math.abs(e.clientX - this.dragStart.x);
          const dy = Math.abs(e.clientY - this.dragStart.y);

          if (dx > 8 || dy > 8) {
            this._handleBoxSelect(this.dragStart, { x: e.clientX, y: e.clientY });
          } else {
            this._handleLeftClick(e);
          }
        }
        this.dragStart = null;
      }
    });

    dom.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _updateCursorState(pt) {
    if (!pt) {
      this.cursors.setCursor("default");
      return;
    }

    const tx = Math.floor(pt.x / TILE);
    const ty = Math.floor(pt.z / TILE);
    const inMap = tx >= 0 && tx < this.sim.grid.w && ty >= 0 && ty < this.sim.grid.h;
    const tile = inMap ? this.sim.grid.cells[ty * this.sim.grid.w + tx] : -1;

    const selIds = Array.from(this.selection);
    const selUnits = this.sim.units.filter(u => selIds.includes(u.id));
    const hasWorker = selUnits.some(u => u.spec.worker);

    for (const u of this.sim.units) {
      if (u.owner !== this.localPlayer) {
        const dx = u.x - pt.x;
        const dz = u.y - pt.z;
        if (dx * dx + dz * dz <= (u.radius + 16) ** 2) {
          this.cursors.setCursor("attack");
          return;
        }
      }
    }
    for (const b of this.sim.buildings) {
      if (b.owner !== this.localPlayer) {
        const bx = (b.tx + b.spec.tiles / 2) * TILE;
        const bz = (b.ty + b.spec.tiles / 2) * TILE;
        const half = (b.spec.tiles * TILE) / 2;
        if (Math.abs(bx - pt.x) <= half + 12 && Math.abs(bz - pt.z) <= half + 12) {
          this.cursors.setCursor("attack");
          return;
        }
      }
    }

    if (hasWorker) {
      if (tile === GOLD) {
        this.cursors.setCursor("mine");
        return;
      }
      if (tile === FOREST) {
        this.cursors.setCursor("fell");
        return;
      }
      const site = (this.sim.sites || []).find(s => s.owner === this.localPlayer && s.tx <= tx && tx < s.tx + s.spec.tiles && s.ty <= ty && ty < s.ty + s.spec.tiles);
      if (site) {
        this.cursors.setCursor("build");
        return;
      }
    }

    for (const u of this.sim.units) {
      if (u.owner === this.localPlayer) {
        const dx = u.x - pt.x;
        const dz = u.y - pt.z;
        if (dx * dx + dz * dz <= (u.radius + 14) ** 2) {
          this.cursors.setCursor("select");
          return;
        }
      }
    }

    if (this.selection.size > 0 && inMap && tile !== WATER) {
      this.cursors.setCursor("move");
      return;
    }

    this.cursors.setCursor("default");
  }

  _handleBoxSelect(p1, p2) {
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    this.selection.clear();

    for (const u of this.sim.units) {
      if (u.owner === this.localPlayer) {
        const elev = this.terrain ? this.terrain.getHeight(u.x, u.y) : 0;
        const screenPos = this._worldToScreen(u.x, elev, u.y);
        if (screenPos.x >= minX && screenPos.x <= maxX && screenPos.y >= minY && screenPos.y <= maxY) {
          this.selection.add(u.id);
        }
      }
    }

    this._updateContextualHUD();
  }

  _worldToScreen(x, y, z) {
    const vec = new THREE.Vector3(x, y, z);
    vec.project(this.camera);
    return {
      x: ((vec.x + 1) * window.innerWidth) / 2,
      y: ((-vec.y + 1) * window.innerHeight) / 2,
    };
  }

  _selectNextIdlePeasant() {
    const idlePeasants = this.sim.units.filter(
      u => u.owner === this.localPlayer && u.spec.worker && !u.job && !u.order
    );
    if (idlePeasants.length > 0) {
      const p = idlePeasants[0];
      this.selection.clear();
      this.selection.add(p.id);
      this.rtsCamera.focusOn(p.x, p.y);
      this._updateContextualHUD();
    }
  }

  _focusCameraOnSelectionOrBase() {
    if (!this.sim) return;

    if (this.selection.size > 0) {
      const selIds = Array.from(this.selection);
      const selUnits = this.sim.units.filter(u => selIds.includes(u.id));
      const selBuildings = this.sim.buildings.filter(b => selIds.includes(b.id));

      if (selUnits.length > 0) {
        let avgX = 0, avgY = 0;
        for (const u of selUnits) {
          avgX += u.x;
          avgY += u.y;
        }
        avgX /= selUnits.length;
        avgY /= selUnits.length;
        this.rtsCamera.focusOn(avgX, avgY);
        return;
      } else if (selBuildings.length > 0) {
        const b = selBuildings[0];
        const bx = (b.tx + (b.spec ? b.spec.tiles : 2) / 2) * TILE;
        const bz = (b.ty + (b.spec ? b.spec.tiles : 2) / 2) * TILE;
        this.rtsCamera.focusOn(bx, bz);
        return;
      }
    }

    // Default: focus on starting Manor (hall)
    const localManor = this.sim.buildings.find(b => b.owner === this.localPlayer && b.spec.isHeart);
    if (localManor) {
      const mx = (localManor.tx + localManor.spec.tiles / 2) * TILE;
      const mz = (localManor.ty + localManor.spec.tiles / 2) * TILE;
      this.rtsCamera.focusOn(mx, mz);
    }
  }

  _showNotice(msg, color = "#ffd166") {
    let noticeEl = document.getElementById("hud-game-notice");
    if (!noticeEl) {
      noticeEl = document.createElement("div");
      noticeEl.id = "hud-game-notice";
      noticeEl.style.cssText = "position:absolute; top:110px; left:50%; transform:translateX(-50%); background:rgba(16,20,29,0.92); border:1px solid #f4a261; border-radius:6px; padding:6px 14px; font-size:12px; font-family:'Cinzel',serif; font-weight:bold; color:#ffd166; z-index:150; pointer-events:none; transition:opacity 0.3s ease; backdrop-filter:blur(8px); box-shadow:0 4px 16px rgba(0,0,0,0.6);";
      document.body.appendChild(noticeEl);
    }
    noticeEl.textContent = msg;
    noticeEl.style.color = color;
    noticeEl.style.borderColor = color;
    noticeEl.style.opacity = "1";
    noticeEl.style.display = "block";

    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      if (noticeEl) noticeEl.style.opacity = "0";
    }, 2200);
  }

  _toggleWalletDrawer() {
    const modal = document.getElementById("web3-wallet-modal");
    if (modal) {
      modal.style.display = modal.style.display === "flex" ? "none" : "flex";
    }
  }

  async _connectSolanaWallet() {
    try {
      const info = await this.solanaWallet.connect();
      const statusEl = document.getElementById("sol-wallet-status");
      const pubkeyEl = document.getElementById("sol-wallet-pubkey");
      const balEl = document.getElementById("sol-wallet-balance");
      const btnEl = document.getElementById("sol-connect-btn");

      if (statusEl) statusEl.textContent = `✓ Connected: ${info.name}`;
      if (pubkeyEl) pubkeyEl.textContent = info.address;
      if (balEl) balEl.textContent = `Balance: ${info.balance.toFixed(4)} SOL`;
      if (btnEl) btnEl.textContent = `🟣 Connected (${this.solanaWallet.getShortAddress()})`;

      const mpAddr = document.getElementById("mp-sol-addr");
      if (mpAddr) mpAddr.textContent = `${this.solanaWallet.getShortAddress()} (${info.balance.toFixed(2)} SOL)`;

      this._showNotice(`✓ Solana Wallet Connected: ${this.solanaWallet.getShortAddress()}`, "#c77dff");
      this.loreAudio.playTempleBell(720);
    } catch (err) {
      alert(err.message || "Failed to connect Solana wallet.");
    }
  }

  _submitScoreToChain() {
    this._showNotice("⚡ Victory submitted to Abstract On-Chain Leaderboard!", "#7fd48f");
    this.loreAudio.playTempleBell(864);
  }

  _initMenuUI() {
    const startBtn = document.getElementById("menu-start-btn");
    const hostBtn = document.getElementById("menu-host-btn");
    const joinBtn = document.getElementById("menu-join-btn");
    const joinCodeInput = document.getElementById("menu-join-code");
    const menuModal = document.getElementById("main-menu-modal");
    const openMenuBtn = document.getElementById("open-menu-btn");
    const fowCheck = document.getElementById("menu-fow-check");
    const mapSelect = document.getElementById("menu-map-select");
    const aiSelect = document.getElementById("menu-ai-select");
    const sfxSlider = document.getElementById("sfx-volume");
    const musicSlider = document.getElementById("music-volume");

    if (mapSelect) {
      mapSelect.innerHTML = Object.values(MAPS)
        .map(m => `<option value="${m.id}" ${m.id === this.currentMapId ? "selected" : ""}>${m.name} (${m.w}x${m.h})</option>`)
        .join("");
    }

    if (aiSelect) {
      aiSelect.innerHTML = TIERS
        .map((t, idx) => `<option value="${idx}" ${idx === this.currentAiTier ? "selected" : ""}>Tier ${idx}: ${t.name}</option>`)
        .join("");
    }

    if (fowCheck) {
      fowCheck.checked = this.fogOfWarEnabled;
    }

    const goldOnlyCheck = document.getElementById("menu-gold-only-check");

    if (startBtn) {
      startBtn.addEventListener("click", () => {
        this._ensureAudio();
        this.isOnline = false;
        this.currentMapId = mapSelect.value;
        this.currentAiTier = parseInt(aiSelect.value, 10);
        this.fogOfWarEnabled = fowCheck.checked;
        const goldOnly = goldOnlyCheck ? goldOnlyCheck.checked : false;

        this._initSim(this.currentMapId, 94301, 0, null, goldOnly);
        menuModal.style.display = "none";
      });
    }

    if (hostBtn) {
      hostBtn.addEventListener("click", () => {
        this._ensureAudio();
        this.currentMapId = mapSelect.value;
        this.fogOfWarEnabled = fowCheck.checked;
        this.mp.hostRoom(this.currentMapId, this.fogOfWarEnabled);
      });
    }

    if (joinBtn && joinCodeInput) {
      joinBtn.addEventListener("click", () => {
        this._ensureAudio();
        const code = joinCodeInput.value;
        if (code) {
          this.mp.joinRoom(code);
        }
      });
    }

    const openDipBtn = document.getElementById("open-dip-btn");
    if (openDipBtn) {
      openDipBtn.addEventListener("click", () => {
        if (this.diplomacy) {
          this.diplomacy.toggle();
          this.diplomacy.update(this.sim, this.localPlayer);
        }
      });
    }

    if (openMenuBtn) {
      openMenuBtn.addEventListener("click", () => this._toggleGameMenu());
    }

    if (sfxSlider) {
      sfxSlider.addEventListener("input", (e) => {
        const v = parseFloat(e.target.value);
        this.loreAudio.setSfxVolume(v);
      });
    }

    if (musicSlider) {
      musicSlider.addEventListener("input", (e) => {
        const v = parseFloat(e.target.value);
        this.loreAudio.setMusicVolume(v);
      });
    }

    // Quality selector buttons
    const savedQuality = localStorage.getItem("swarajya_graphics_quality") || "high";
    this.setGraphicsQuality(savedQuality);

    const qBtns = document.querySelectorAll(".quality-btn");
    qBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.setGraphicsQuality(btn.dataset.quality);
      });
    });
  }

  setGraphicsQuality(quality) {
    this.graphicsQuality = quality;
    try {
      localStorage.setItem("swarajya_graphics_quality", quality);
    } catch (e) {}

    if (this.renderer3D) this.renderer3D.setQuality(quality);
    if (this.sky) this.sky.setQuality(quality);
    if (this.vfx) this.vfx.setQuality(quality);

    if (quality === "low") {
      this.renderer.shadowMap.enabled = false;
      this.renderer.setPixelRatio(1.0);
      if (this.scene.fog) this.scene.fog.density = 0.00015;
    } else if (quality === "medium") {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.BasicShadowMap;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      if (this.scene.fog) this.scene.fog.density = 0.0003;
    } else {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
      if (this.scene.fog) this.scene.fog.density = 0.00035;
    }

    const qBtns = document.querySelectorAll(".quality-btn");
    qBtns.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.quality === quality);
    });
  }

  _toggleGameMenu() {
    const menuModal = document.getElementById("main-menu-modal");
    if (!menuModal) return;
    menuModal.style.display = (menuModal.style.display === "none" || menuModal.style.display === "") ? "flex" : "none";
  }

  _dispatchCommand(command) {
    if (this.isOnline && this.mp && this.mp.lockstep) {
      this.mp.lockstep.issue(command);
    } else {
      applyCommand(this.sim, this.localPlayer, command);
    }
  }

  _confirmBuildingPlacement(e) {
    const pt = this._getGroundIntersection(e);
    if (!pt) return;

    const tx = Math.floor(pt.x / TILE);
    const ty = Math.floor(pt.z / TILE);

    const check = canBuild(this.sim, this.localPlayer, this.placingBuildingType, tx, ty);
    if (check.ok) {
      let peasants = this.sim.units
        .filter(u => this.selection.has(u.id) && u.owner === this.localPlayer && u.spec.worker)
        .map(u => u.id);

      if (peasants.length === 0) {
        peasants = this.sim.units
          .filter(u => u.owner === this.localPlayer && u.spec.worker)
          .map(u => u.id);
      }

      // If holding Ctrl, queue the build order on peasants' plan!
      const isQueued = Boolean(e.ctrlKey);
      this._dispatchCommand(cmd.build(this.placingBuildingType, tx, ty, peasants, isQueued));
      const elev = this.terrain ? this.terrain.getHeight(pt.x, pt.z) : 0;
      this.vfx.spawnDebris(pt.x, elev, pt.z, 14, 0xd4a373);
      this.loreAudio.playTempleBell(648);
    } else {
      this._showNotice(`⚠️ ${check.reason || "Cannot build here"}`, "#e63946");
      this.loreAudio.playWarDrum(45, 0.4);
    }

    // If Ctrl is held, stay in building placement mode to allow placing 10 walls / 5 farms in a row!
    if (!e.ctrlKey) {
      this.placingBuildingType = null;
      this.ghostMesh.visible = false;
    }
  }

  _getGroundIntersection(e) {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, target) ? target : null;
  }

  _handleLeftClick(e) {
    const pt = this._getGroundIntersection(e);
    if (!pt) return;

    if (this.orderMode === "patrol") {
      const tx = Math.floor(pt.x / TILE);
      const ty = Math.floor(pt.z / TILE);
      const selIds = Array.from(this.selection).filter(id => this.sim.units.some(u => u.id === id && u.owner === this.localPlayer));
      if (selIds.length > 0) {
        this._dispatchCommand(cmd.patrol(selIds, tx, ty));
        this.loreAudio.playWarDrum(70, 0.6);
      }
      this.orderMode = null;
      this.cursors.setCursor("default");
      this._updateContextualHUD();
      return;
    }

    if (this.orderMode === "guard") {
      const clickRadius = Math.max(14, this.rtsCamera.distance * 0.03);
      let target = null;
      for (const u of this.sim.units) {
        if (u.owner === this.localPlayer) {
          const dx = u.x - pt.x;
          const dz = u.y - pt.z;
          if (dx * dx + dz * dz <= ((u.spec.radius || 8) + clickRadius) ** 2) {
            target = u;
            break;
          }
        }
      }
      if (!target) {
        for (const b of this.sim.buildings) {
          if (b.owner === this.localPlayer) {
            const bx = (b.tx + b.spec.tiles / 2) * TILE;
            const bz = (b.ty + b.spec.tiles / 2) * TILE;
            const half = (b.spec.tiles * TILE) / 2;
            if (Math.abs(bx - pt.x) <= half + clickRadius && Math.abs(bz - pt.z) <= half + clickRadius) {
              target = b;
              break;
            }
          }
        }
      }

      if (target) {
        const selIds = Array.from(this.selection).filter(id => this.sim.units.some(u => u.id === id && u.owner === this.localPlayer));
        if (selIds.length > 0) {
          this._dispatchCommand(cmd.guard(selIds, target.id));
          this.loreAudio.playWarDrum(70, 0.6);
        }
      }
      this.orderMode = null;
      this.cursors.setCursor("default");
      this._updateContextualHUD();
      return;
    }

    const now = performance.now();
    const clickRadius = Math.max(14, this.rtsCamera.distance * 0.03);

    // Check if player clicked an owned unit
    let clickedUnit = null;
    for (const u of this.sim.units) {
      if (u.owner === this.localPlayer) {
        const dx = u.x - pt.x;
        const dz = u.y - pt.z;
        if (dx * dx + dz * dz <= ((u.spec.radius || 8) + clickRadius) ** 2) {
          clickedUnit = u;
          break;
        }
      }
    }

    if (clickedUnit) {
      const isDoubleClick = (
        this.lastClickTarget &&
        (this.lastClickTarget.id === clickedUnit.id || this.lastClickTarget.specId === clickedUnit.spec.id) &&
        (now - this.lastClickTarget.time) < 400
      );

      this.selection.clear();

      if (isDoubleClick) {
        // DOUBLE CLICK: Select ALL friendly units of the same type within screen radius!
        const selectRadius = 450;
        let count = 0;
        for (const u of this.sim.units) {
          if (u.owner === this.localPlayer && u.spec.id === clickedUnit.spec.id) {
            const dx = u.x - clickedUnit.x;
            const dz = u.y - clickedUnit.y;
            if (dx * dx + dz * dz <= selectRadius * selectRadius) {
              this.selection.add(u.id);
              count++;
            }
          }
        }
        this.loreAudio.playWarDrum(70, 0.75);
        this.lastClickTarget = null;
      } else {
        // SINGLE CLICK: Select just this unit
        this.selection.add(clickedUnit.id);
        this.lastClickTarget = {
          id: clickedUnit.id,
          specId: clickedUnit.spec.id,
          time: now,
        };
      }

      this._updateContextualHUD();
      return;
    }

    this.lastClickTarget = null;
    this.selection.clear();

    for (const b of this.sim.buildings) {
      if (b.owner === this.localPlayer) {
        const bx = (b.tx + b.spec.tiles / 2) * TILE;
        const bz = (b.ty + b.spec.tiles / 2) * TILE;
        const half = (b.spec.tiles * TILE) / 2;
        if (Math.abs(bx - pt.x) <= half + clickRadius && Math.abs(bz - pt.z) <= half + clickRadius) {
          this.selection.add(b.id);
          this._updateContextualHUD();
          return;
        }
      }
    }

    if (this.sim.sites) {
      for (const s of this.sim.sites) {
        if (s.owner === this.localPlayer) {
          const tiles = s.spec ? s.spec.tiles : 2;
          const sx = (s.tx + tiles / 2) * TILE;
          const sz = (s.ty + tiles / 2) * TILE;
          const half = (tiles * TILE) / 2;
          if (Math.abs(sx - pt.x) <= half + clickRadius && Math.abs(sz - pt.z) <= half + clickRadius) {
            this.selection.add(s.id);
            this._updateContextualHUD();
            return;
          }
        }
      }
    }

    this._updateContextualHUD();
  }

  _handleRightClick(e) {
    if (this.placingBuildingType) {
      this.placingBuildingType = null;
      this.ghostMesh.visible = false;
      this.cursors.setCursor("default");
      return;
    }
    if (this.orderMode) {
      this.orderMode = null;
      this.cursors.setCursor("default");
      this._updateContextualHUD();
      return;
    }
    if (this.selection.size === 0) return;
    const pt = this._getGroundIntersection(e);
    if (!pt) return;

    const targetTileX = Math.floor(pt.x / TILE);
    const targetTileY = Math.floor(pt.z / TILE);

    // 1. If any owned buildings are selected, right-click sets their Rally Point!
    const selBuildings = this.sim.buildings.filter(b => this.selection.has(b.id) && b.owner === this.localPlayer);
    if (selBuildings.length > 0) {
      for (const b of selBuildings) {
        this._dispatchCommand(cmd.rally(b.id, targetTileX, targetTileY));
      }
      this.loreAudio.playWarDrum(75, 0.5);
      const elev = this.terrain ? this.terrain.getHeight(pt.x, pt.z) : 0;
      this.vfx.spawnDebris(pt.x, elev, pt.z, 8, 0xffd166);
      this._updateContextualHUD();
      return;
    }

    // 2. Unit Attack & Movement Orders
    const unitIds = Array.from(this.selection).filter(id => this.sim.units.some(u => u.id === id));
    if (unitIds.length === 0) return;

    const clickRadius = Math.max(14, this.rtsCamera.distance * 0.03);

    const isQueued = Boolean(e.ctrlKey);

    for (const u of this.sim.units) {
      if (u.owner !== this.localPlayer) {
        const dx = u.x - pt.x;
        const dz = u.y - pt.z;
        if (dx * dx + dz * dz <= (u.radius + clickRadius) ** 2) {
          this._dispatchCommand(cmd.attack(unitIds, u.id, isQueued));
          const elev = this.terrain ? this.terrain.getHeight(u.x, u.y) : 0;
          this.vfx.spawnDebris(u.x, elev, u.y, 4, 0xef476f);
          this.loreAudio.playWarDrum(55, 0.7);
          return;
        }
      }
    }

    for (const b of this.sim.buildings) {
      if (b.owner !== this.localPlayer) {
        const bx = (b.tx + b.spec.tiles / 2) * TILE;
        const bz = (b.ty + b.spec.tiles / 2) * TILE;
        const half = (b.spec.tiles * TILE) / 2;
        if (Math.abs(bx - pt.x) <= half + clickRadius && Math.abs(bz - pt.z) <= half + clickRadius) {
          this._dispatchCommand(cmd.attack(unitIds, b.id, isQueued));
          const elev = this.terrain ? this.terrain.getHeight(bx, bz) : 0;
          this.vfx.spawnDebris(bx, elev, bz, 6, 0x8b5a2b);
          this.loreAudio.playWarDrum(50, 0.8);
          return;
        }
      }
    }

    this._dispatchCommand(cmd.order(unitIds, targetTileX, targetTileY, isQueued));
    this.loreAudio.playWarDrum(75, 0.4);
  }

  _initLoop() {
    this.lastTime = performance.now();
    this.accumulator = 0;

    const loop = (now) => {
      try {
        const dt = Math.min(0.1, (now - this.lastTime) / 1000.0);
        this.lastTime = now;
        this.accumulator = Math.min(0.2, this.accumulator + dt);
        let subSteps = 0;
        while (this.accumulator >= TICK_DURATION && subSteps < 4) {
          subSteps++;
          for (const u of this.sim.units) {
            u.prevX = u.x;
            u.prevY = u.y;
          }

          if (this.isOnline && this.mp && this.mp.lockstep) {
            this.mp.lockstep.publish();
            this.mp.lockstep.tryAdvance(now);
          } else {
            if (!this.sim.over) {
              const numAi = this.sim.players.length - 1;
              for (let seat = 1; seat < this.sim.players.length; seat++) {
                if (numAi <= 1 || (this.sim.tick % numAi) === (seat - 1)) {
                  think(this.sim, seat, this.currentAiTier);
                }
              }
            }
            step(this.sim);
          }

          if (this.audioStarted && this.sim.sounds && this.sim.sounds.length > 0) {
            for (const s of this.sim.sounds) {
              if (s.cue === "build") this.loreAudio.playTempleBell(648);
              else if (s.cue === "trained") this.loreAudio.playWarDrum(80, 0.35);
              else if (s.cue === "hit") this.loreAudio.playWarDrum(55, 0.4);
              else if (s.cue === "collapse") this.loreAudio.playWarDrum(40, 0.8);
              else if (s.cue === "order") this.loreAudio.playWarDrum(75, 0.3);
              else if (s.cue === "devotion") this.loreAudio.playTempleBell(720);
            }
            this.sim.sounds.length = 0;
          }

          if (this.sim.events && this.sim.events.length > 0) {
            for (const ev of this.sim.events) {
              if (ev.type === "chat") {
                const author = this.sim.players[ev.from]?.name || `Player ${ev.from + 1}`;
                const col = this.sim.players[ev.from]?.colour || "#f4a261";
                if (this.chat) {
                  const chan = ev.target === -2 ? "allies" : (ev.target >= 0 ? "whisper" : "all");
                  this.chat.addMessage({
                    author,
                    text: ev.text,
                    type: ev.target >= 0 ? "whisper" : (ev.target === -2 ? "allies" : "normal"),
                    color: col,
                    channel: chan,
                    target: ev.target,
                  });
                  if (!this.isOnline && ev.from === this.localPlayer) {
                    this.chat.handleAiResponse(this.sim, ev.text, ev.target);
                  }
                }
              } else if (ev.type === "diplomacy_change") {
                const pFrom = this.sim.players[ev.from]?.name || `Player ${ev.from + 1}`;
                const pTo = this.sim.players[ev.to]?.name || `Player ${ev.to + 1}`;
                if (this.chat) {
                  this.chat.addMessage({
                    author: "Diplomacy",
                    text: `${pFrom} is now ${ev.stance.toUpperCase()} with ${pTo}`,
                    type: "diplomacy",
                  });
                }
                this.loreAudio.playTempleBell(648);
              } else if (ev.type === "tribute") {
                const pFrom = this.sim.players[ev.from]?.name || `Player ${ev.from + 1}`;
                const pTo = this.sim.players[ev.to]?.name || `Player ${ev.to + 1}`;
                if (this.chat) {
                  this.chat.addMessage({
                    author: "Tribute",
                    text: `${pFrom} gifted ${ev.amount} ${ev.resource} to ${pTo}!`,
                    type: "system",
                  });
                }
                this.loreAudio.playTempleBell(720);
              } else if (ev.type === "vfx_vajra") {
                if (this.vfx) {
                  const pts = [{ x: ev.fromX, y: 0, z: ev.fromY }, ...ev.targets.map(t => ({ x: t.x, y: 0, z: t.y }))];
                  this.vfx.spawnVajraLightning(pts);
                  for (const t of ev.targets) {
                    this.vfx.spawnDamageText(t.x, 0, t.y, 65, "flank");
                  }
                }
              } else if (ev.type === "vfx_kavacha") {
                if (this.vfx) {
                  this.vfx.spawnKavachaWard(ev.x, 0, ev.y, ev.radius);
                }
              } else if (ev.type === "vfx_battlecry") {
                if (this.vfx) {
                  const u = this.sim.units.find(x => x.id === ev.unitId);
                  if (u) this.vfx.spawnBattlecryAura(u.x, 0, u.y, ev.radius);
                }
              } else if (ev.type === "vfx_prana_death") {
                if (this.vfx) {
                  this.vfx.spawnPranaDissolve(ev.x, 0, ev.y);
                }
              }
            }
            this.sim.events.length = 0;
          }

          // Live Campaign Objectives Tracking
          if (this.sim.scenario && this.sim.scenario.objectives) {
            const listEl = document.getElementById("campaign-objectives-list");
            if (listEl) {
              listEl.innerHTML = this.sim.scenario.objectives.map(o => `
                <div style="display:flex; align-items:center; gap:6px; color:${o.done ? '#7fd48f' : '#d1d5db'};">
                  <span>${o.done ? '✓' : '◻'}</span>
                  <span style="${o.done ? 'text-decoration:line-through; opacity:0.7;' : ''}">${o.desc} ${o.total ? `(${o.count || 0}/${o.total})` : ''}</span>
                </div>
              `).join("");
            }
          }

          const playerPath = this.sim.players[this.localPlayer]?.path;
          if (playerPath && this.currentPath !== playerPath) {
            this.currentPath = playerPath;
            this.loreAudio.playTempleBell(648);
          }

          this.accumulator -= TICK_DURATION;
        }
        if (subSteps >= 4) this.accumulator = 0;

        const alpha = this.accumulator / TICK_DURATION;

        this.rtsCamera.update(dt);
        if (this.sky) {
          this.sky.update(dt, this.rtsCamera.target);
        }
        this.vfx.update(dt);
        this.renderer3D.render(this.sim, alpha, this.selection, dt);

        if (this.fog) {
          this.fog.update(this.sim, this.localPlayer, this.renderer3D.unitMeshes, this.renderer3D.buildingMeshes);
        }

        if (this.minimap) {
          this.minimap.update(this.localPlayer);
        }
        if (this.wheel) {
          this.wheel.update(this.sim.players[this.localPlayer]);
        }

        this.renderer.render(this.scene, this.camera);

        this._updateSelectionInfoOnly();
        this._updateTopHUD();
        this._checkEndState();
      } catch (err) {
        console.error("[Swarajya Game Loop Recovery]", err);
      } finally {
        requestAnimationFrame(loop);
      }
    };

    requestAnimationFrame(loop);
  }

  _checkEndState() {
    if (this.sim.over) {
      const banner = document.getElementById("victory-banner");
      if (banner && !banner.classList.contains("visible")) {
        banner.classList.add("visible");
        const won = this.sim.winner === this.localPlayer;
        if (won) this.loreAudio.playTempleBell(864);
        else this.loreAudio.playWarDrum(45, 0.9);
        banner.querySelector("h2").textContent = won ? "VICTORY — SWARAJYA CLAIMED" : "DEFEAT — HALL DESTROYED";
        banner.querySelector("h2").style.color = won ? "#7fd48f" : "#e63946";
      }
    }
  }

  _updateTopHUD() {
    const p = this.sim.players[this.localPlayer];
    if (!p) return;

    if (this.sim.goldOnlyMode) {
      document.getElementById("hud-gold").textContent = `${Math.floor(p.gold)}`;
      document.getElementById("hud-timber").textContent = `— (Gold Only)`;
      document.getElementById("hud-food").textContent = `∞ (Abundant)`;
    } else {
      document.getElementById("hud-gold").textContent = `${Math.floor(p.gold)}`;
      document.getElementById("hud-timber").textContent = `${Math.floor(p.timber)}`;
      document.getElementById("hud-food").textContent = `${Math.floor(p.food)} / 2000`;
    }
    document.getElementById("hud-pop").textContent = `${this.sim.units.filter(u => u.owner === this.localPlayer).length} / 240`;

    if (this.sky) {
      const timeEl = document.getElementById("hud-time");
      if (timeEl) timeEl.textContent = this.sky.getTimeFormatted();
    }

    // Active Himalayan Tirtha Blessings Banner
    let tirthaBanner = document.getElementById("hud-tirtha-blessings");
    if (!tirthaBanner) {
      tirthaBanner = document.createElement("div");
      tirthaBanner.id = "hud-tirtha-blessings";
      tirthaBanner.style.cssText = "position:absolute; top:52px; left:50%; transform:translateX(-50%); display:flex; gap:8px; z-index:110; pointer-events:none;";
      document.body.appendChild(tirthaBanner);
    }
    if (this.sim.tirthas) {
      const activeTirthas = this.sim.tirthas.filter(t => t.controller === this.localPlayer);
      tirthaBanner.innerHTML = activeTirthas.map(t => `
        <div style="background:rgba(20,24,36,0.85); border:1px solid ${t.spec.color}; color:${t.spec.color}; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold; box-shadow:0 0 10px ${t.spec.color}44;">
          ✨ ${t.spec.name}: ${t.spec.desc}
        </div>
      `).join("");
    }
  }

  _updateSelectionInfoOnly() {
    const infoCard = document.getElementById("selection-info");
    if (!infoCard) return;

    if (this.selection.size === 0) {
      infoCard.style.display = "none";
      return;
    }

    const selIds = Array.from(this.selection);
    const selUnits = this.sim.units.filter(u => selIds.includes(u.id));
    const selBuildings = this.sim.buildings.filter(b => selIds.includes(b.id));
    const selSites = this.sim.sites ? this.sim.sites.filter(s => selIds.includes(s.id)) : [];

    if (selSites.length === 1) {
      const s = selSites[0];
      const totalNeeded = s.needed || (s.spec ? s.spec.buildWork : 100);
      const buildPct = totalNeeded > 0 ? Math.max(0, Math.min(100, Math.round(((s.work || 0) / totalNeeded) * 100))) : 0;
      const hpPct = Math.round((s.hp / (s.maxHp || 100)) * 100);

      infoCard.innerHTML = `
        <div class="sel-title">${s.spec ? s.spec.name : "Structure"} [Foundation]</div>
        <div class="sel-bar"><div class="sel-fill" style="width:${hpPct}%; background:#f4a261;"></div></div>
        <div class="sel-stats">HP: ${Math.round(s.hp)} / ${s.maxHp || 100}</div>
        <div style="margin-top:8px; background:#141824; border:1px solid #f4a261; border-radius:6px; padding:6px 8px; text-align:left;">
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px;">
            <span style="color:#ffd166; font-weight:bold;">🔨 Construction Progress</span>
            <span style="color:#7fd48f; font-weight:bold;">${buildPct}%</span>
          </div>
          <div style="height:7px; background:#1f2430; border-radius:3px; overflow:hidden; margin-bottom:6px; border:1px solid #374151;">
            <div style="height:100%; width:${buildPct}%; background:linear-gradient(90deg, #e76f51, #f4a261); transition:width 0.1s linear;"></div>
          </div>
          <div style="font-size:10px; color:#9ca3af;">
            👷 Active Builders: <strong style="color:#ffd166;">${s.builders || 0}</strong> peasants
          </div>
        </div>
      `;
      infoCard.style.display = "block";
    } else if (selUnits.length === 1) {
      const u = selUnits[0];
      const hpPct = Math.round((u.hp / u.maxHp) * 100);
      let carryHtml = "";
      if (u.spec.worker && u.carrying > 0) {
        const sym = u.carryKind === "gold" ? "🟡" : u.carryKind === "timber" ? "🌲" : "🌾";
        carryHtml = `<div style="font-size:11px; color:#ffd166; margin-top:2px;">Carrying: ${sym} ${u.carrying} ${u.carryKind}</div>`;
      }

      let heroHtml = "";
      if (u.isHero) {
        const nextXp = [0, 100, 250, 500, 1000][u.level || 1] || 1000;
        const prevXp = [0, 0, 100, 250, 500][u.level || 1] || 0;
        const xpPct = Math.min(100, Math.max(0, Math.round(((u.xp - prevXp) / Math.max(1, nextXp - prevXp)) * 100)));
        const auraName = u.heroType === "senapati" ? "🛡️ Aura of Valour (+25% Atk Spd, +15 Armor)" : "🌿 Aura of Prana (+2.4 HP/s Regen)";
        heroHtml = `
          <div style="margin-top:6px; background:#181224; border:1px solid #ffd166; border-radius:6px; padding:6px 8px; text-align:left;">
            <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px;">
              <span style="color:#ffd166; font-weight:bold;">👑 Level ${u.level || 1} Hero</span>
              <span style="color:#9b5de5; font-weight:bold;">XP: ${u.xp || 0} / ${nextXp}</span>
            </div>
            <div style="height:6px; background:#1f2430; border-radius:3px; overflow:hidden; margin-bottom:4px;">
              <div style="height:100%; width:${xpPct}%; background:linear-gradient(90deg, #9b5de5, #ffd166);"></div>
            </div>
            <div style="font-size:10px; color:#a7f3d0;">${auraName}</div>
          </div>
        `;
      }

      let stanceBadge = "";
      if (!u.spec.worker) {
        const stanceNames = {
          aggressive: "⚔️ Aggressive [Z]",
          defensive: "🛡️ Defensive [X]",
          stand_ground: "🛑 Stand Ground [C]",
          hold_fire: "🤫 Hold Fire [V]"
        };
        const formNames = {
          none: "Standard",
          line: "Pankti (Line)",
          wedge: "Garuda (Wedge)",
          square: "Vajra (Square)",
          scatter: "Skirmish (Scatter)"
        };
        stanceBadge = `
          <div style="display:flex; justify-content:space-between; gap:6px; margin-top:6px; font-size:10px;">
            <span style="background:#1f2937; color:#ffd166; padding:2px 6px; border-radius:4px; border:1px solid #374151;">${stanceNames[u.stance || "aggressive"]}</span>
            <span style="background:#1f2937; color:#7fd48f; padding:2px 6px; border-radius:4px; border:1px solid #374151;">${formNames[u.formation || "none"]} [F]</span>
          </div>
        `;
      }

      infoCard.innerHTML = `
        <div class="sel-title">${u.spec.name}</div>
        <div class="sel-bar"><div class="sel-fill" style="width:${hpPct}%"></div></div>
        <div class="sel-stats">HP: ${Math.round(u.hp)} / ${u.maxHp} | Dmg: ${u.spec.damage || 0}</div>
        ${carryHtml}
        ${heroHtml}
        ${stanceBadge}
      `;
      infoCard.style.display = "block";
    } else if (selBuildings.length === 1) {
      const b = selBuildings[0];
      const hpPct = Math.round((b.hp / b.maxHp) * 100);

      let trainingHtml = "";
      if (b.raising && b.raising.needed > 0) {
        const raisePct = Math.max(0, Math.min(100, Math.round(((b.raising.work || 0) / b.raising.needed) * 100)));
        const targetTierName = b.raising.to === 1 ? "Keep (Shira Durg)" : "Palace (Mahapeeth)";
        trainingHtml = `
          <div style="margin-top:8px; background:#141824; border:1px solid #9b5de5; border-radius:6px; padding:6px 8px; text-align:left;">
            <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px;">
              <span style="color:#d4a373; font-weight:bold;">🏰 Upgrading: ${targetTierName}</span>
              <span style="color:#7fd48f; font-weight:bold;">${raisePct}%</span>
            </div>
            <div style="height:7px; background:#1f2430; border-radius:3px; overflow:hidden; margin-bottom:6px; border:1px solid #374151;">
              <div style="height:100%; width:${raisePct}%; background:linear-gradient(90deg, #9b5de5, #ffd166); transition:width 0.1s linear;"></div>
            </div>
            <div style="font-size:10px; color:#9ca3af;">
              Builders Raising Hall
            </div>
          </div>
        `;
      } else if (b.queue && b.queue.length > 0) {
        const activeUnitId = b.queue[0];
        const activeSpec = UNITS[activeUnitId];
        const totalTicks = activeSpec ? activeSpec.buildTicks : 100;
        const trainPct = Math.max(0, Math.min(100, Math.round(((totalTicks - (b.buildTimer || 0)) / totalTicks) * 100)));
        const queueChips = b.queue.map((uId, i) => `
          <span style="font-size:10px; background:${i === 0 ? '#457b9d' : '#2a3142'}; color:#fff; padding:2px 6px; border-radius:3px; border:1px solid ${i === 0 ? '#ffd166' : '#4b5563'};">
            ${i === 0 ? '▶ ' : ''}${UNITS[uId]?.name || uId}
          </span>
        `).join(" ");

        trainingHtml = `
          <div style="margin-top:8px; background:#141824; border:1px solid #e09f3e; border-radius:6px; padding:6px 8px; text-align:left;">
            <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px;">
              <span style="color:#ffd166; font-weight:bold;">⏳ Training: ${activeSpec?.name || activeUnitId}</span>
              <span style="color:#7fd48f; font-weight:bold;">${trainPct}%</span>
            </div>
            <div style="height:7px; background:#1f2430; border-radius:3px; overflow:hidden; margin-bottom:6px; border:1px solid #374151;">
              <div style="height:100%; width:${trainPct}%; background:linear-gradient(90deg, #f4a261, #ffd166); transition:width 0.1s linear;"></div>
            </div>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
              <span style="font-size:10px; color:#9ca3af;">Queue (${b.queue.length}):</span>
              ${queueChips}
            </div>
          </div>
        `;
      }

      let rallyHtml = "";
      if (b.owner === this.localPlayer) {
        if (b.rally) {
          rallyHtml = `<div style="font-size:10px; color:#ffd166; margin-top:5px;">🚩 Rally Target: [${b.rally.tx}, ${b.rally.ty}] <span style="color:#9ca3af;">(Right-click map to move)</span></div>`;
        } else {
          rallyHtml = `<div style="font-size:10px; color:#9ca3af; margin-top:5px;">🚩 Rally: Right-click ground/resource to direct spawn</div>`;
        }
      }

      infoCard.innerHTML = `
        <div class="sel-title">${b.spec.name}</div>
        <div class="sel-bar"><div class="sel-fill" style="width:${hpPct}%"></div></div>
        <div class="sel-stats">HP: ${Math.round(b.hp)} / ${b.maxHp}</div>
        ${trainingHtml}
        ${rallyHtml}
      `;
      infoCard.style.display = "block";
    } else if (selUnits.length > 1) {
      const u0 = selUnits[0];
      const formNames = {
        none: "Standard",
        line: "Pankti (Line)",
        wedge: "Garuda (Wedge)",
        square: "Vajra (Square)",
        scatter: "Skirmish (Scatter)"
      };
      infoCard.innerHTML = `
        <div class="sel-title">${selUnits.length} Units Selected</div>
        <div style="margin-top:6px; font-size:11px; color:#7fd48f;">Formation: <strong>${formNames[u0.formation || "none"]}</strong> [F]</div>
      `;
      infoCard.style.display = "block";
    }
  }

  _updateContextualHUD() {
    const actionBar = document.getElementById("action-bar");
    this._updateSelectionInfoOnly();

    if (this.selection.size === 0) {
      if (actionBar) actionBar.style.display = "none";
      return;
    }

    const selIds = Array.from(this.selection);
    const selUnits = this.sim.units.filter(u => selIds.includes(u.id));
    const selBuildings = this.sim.buildings.filter(b => selIds.includes(b.id));

    let actions = [];

    const hasWorker = selUnits.some(u => u.spec.worker);
    const manor = selBuildings.find(b => b.spec.isHeart);
    const warehouse = selBuildings.find(b => b.spec.id === "warehouse");
    const barracks = selBuildings.find(b => b.spec.id === "barracks");
    const armory = selBuildings.find(b => b.spec.id === "armory");
    const factory = selBuildings.find(b => b.spec.id === "factory");

    if (selUnits.length === 1 && selUnits[0].spec.abilities) {
      const u = selUnits[0];
      for (const abId of u.spec.abilities) {
        const cd = (u.cooldowns && u.cooldowns[abId]) || 0;
        const abNames = {
          vajra: "⚡ Vajra Storm",
          kavacha: "🛡️ Kavacha Ward",
          trample: "🌪️ Trample Charge",
          agni: "🔥 Agni Fire",
          battlecry: "📯 War Horn"
        };
        const abDescs = {
          vajra: "Chain lightning for 65 damage across 4 foes",
          kavacha: "Spiritual barrier (+60 shield for 10s)",
          trample: "Charge forward at 2x speed with knockback",
          agni: "Flaming boulder creating ground fire zone",
          battlecry: "Celestial horn granting +35% damage"
        };
        actions.push({
          id: `cast_${abId}`,
          label: abNames[abId] || abId,
          cost: cd > 0 ? `⏳ ${Math.ceil(cd / 20)}s` : "Cast",
          desc: abDescs[abId] || "Cast ability",
          abilityId: abId,
          unitId: u.id,
        });
      }
    } else if (hasWorker) {
      actions = [
        { id: "build_farm", label: "Kshetra (Farm)", cost: "40g 30w", desc: "Grows grain" },
        { id: "build_warehouse", label: "Grama (Village)", cost: "60g 50w", desc: "Rural hub that trains farmers directly and provides 1 free cart" },
        { id: "build_wall", label: "Prakara (Wall)", cost: "8g 18w", desc: "Stone wall segment with mountable ramparts" },
        { id: "build_gate", label: "Dwara (Gate)", cost: "45g 60w", desc: "Fortified gatehouse with auto-opening doors" },
        { id: "build_barracks", label: "Akhara (Barracks)", cost: "120g 90w", desc: "Martial training" },
        { id: "build_armory", label: "Khadga Shala (Armory)", cost: "160g 140w", desc: "Foundry & War Chariots" },
        { id: "build_watchBeacon", label: "Dhvaja (Beacon)", cost: "50g 80w", desc: "Mountain watch beacon" },
        { id: "build_bastion", label: "Shira Durg (Bastion)", cost: "200g 200w", desc: "Purusha Path" },
        { id: "build_lair", label: "Mantra Shala (Lair)", cost: "360g 180w", desc: "Shakti Path" },
        { id: "build_factory", label: "Asthi Shala (Factory)", cost: "190g 160w", desc: "Abheda Path" },
      ];
    } else if (manor) {
      actions = [
        { id: "train_peasant", label: "Praja (Peasant)", cost: "50g", desc: "Worker" },
        { id: "train_senapati", label: "👑 Senapati Indra", cost: "200g 120f", desc: "Himalayan Commander & Hero" },
        { id: "train_acharya", label: "🔮 Kaula Acharya", cost: "220g 140f", desc: "Tantric Sage & Hero" },
      ];
    } else if (warehouse) {
      actions = [
        { id: "train_peasant", label: "Krishaka (Farmer)", cost: "50g", desc: "Village farmer who auto-constructs and harvests nearby farms" },
        { id: "train_cart", label: "Shakata (Cart)", cost: "50g 30w", desc: "Resource transport cart" },
      ];
    } else if (barracks) {
      actions = [
        { id: "train_spearman", label: "Shulin (Spearman)", cost: "70g 10f", desc: "Frontline spear" },
        { id: "train_archer", label: "Dhanurdhara (Archer)", cost: "80g 15w 10f", desc: "Ranged archer" },
        { id: "train_yogini", label: "Yogini (Dakini)", cost: "110g 70f", desc: "Tantric lightning mystic" },
      ];
    } else if (armory) {
      actions = [
        { id: "train_ratha", label: "Ratha (Chariot)", cost: "120g 90w 50f", desc: "Mobile ballista engine" },
      ];
    } else if (factory) {
      actions = [
        { id: "train_catapult", label: "Shila Yantra (Catapult)", cost: "180g 150w", desc: "Siege engine" },
        { id: "train_ram", label: "Dwaraghna (Ram)", cost: "140g 120w", desc: "Gate ram" },
      ];
    } else if (selUnits.length >= 1 && !hasWorker) {
      actions = [
        { id: "order_patrol", label: "🚶 Patrol", cost: "[P]", desc: "Patrol between current post and waypoint" },
        { id: "order_guard", label: "🛡️ Guard", cost: "[G]", desc: "Escort and defend an ally or structure" },
        { id: "form_line", label: "⚔️ Line", cost: "[F]", desc: "Pankti: Broad firing front" },
        { id: "form_wedge", label: "🔺 Wedge", cost: "Charge", desc: "Garuda: Shock spearhead" },
        { id: "form_square", label: "🛡️ Square", cost: "Ward", desc: "Vajra: 360 defense box" },
        { id: "form_scatter", label: "💨 Scatter", cost: "Skirmish", desc: "Dispersed to dodge siege" },
        { id: "stance_aggressive", label: "⚔️ Aggressive", cost: "[Z]", desc: "Pursue foes on sight" },
        { id: "stance_defensive", label: "🛡️ Defensive", cost: "[X]", desc: "Guard local ground" },
        { id: "stance_stand_ground", label: "🛑 Stand Ground", cost: "[C]", desc: "Hold position strictly" },
        { id: "stance_hold_fire", label: "🤫 Hold Fire", cost: "[V]", desc: "Stealth / No auto-attack" },
      ];
    }

    if (actions.length > 0) {
      actionBar.innerHTML = actions.map(a => `
        <button class="action-btn" data-action="${a.id}" title="${a.desc}">
          <span class="btn-label">${a.label}</span>
          <span class="btn-cost">${a.cost}</span>
        </button>
      `).join("");
      actionBar.style.display = "flex";

      actionBar.onclick = (e) => {
        const btn = e.target.closest(".action-btn");
        if (!btn) return;
        const act = btn.dataset.action;

        if (act === "order_patrol") {
          this.orderMode = "patrol";
          this.cursors.setCursor("attack");
        } else if (act === "order_guard") {
          this.orderMode = "guard";
          this.cursors.setCursor("attack");
        } else if (act.startsWith("cast_") && selUnits.length === 1) {
          const abilityId = act.replace("cast_", "");
          const u = selUnits[0];
          this._dispatchCommand(cmd.cast(u.id, abilityId, u.tx, u.ty));
        } else if (act === "train_peasant" && manor) {
          this._dispatchCommand(cmd.train(manor.id, "peasant"));
        } else if (act === "train_senapati" && manor) {
          this._dispatchCommand(cmd.train(manor.id, "senapati"));
        } else if (act === "train_acharya" && manor) {
          this._dispatchCommand(cmd.train(manor.id, "acharya"));
        } else if (act === "train_spearman" && barracks) {
          this._dispatchCommand(cmd.train(barracks.id, "spearman"));
        } else if (act === "train_archer" && barracks) {
          this._dispatchCommand(cmd.train(barracks.id, "archer"));
        } else if (act === "train_yogini" && barracks) {
          this._dispatchCommand(cmd.train(barracks.id, "yogini"));
        } else if (act === "train_ratha" && armory) {
          this._dispatchCommand(cmd.train(armory.id, "ratha"));
        } else if (act === "train_catapult" && factory) {
          this._dispatchCommand(cmd.train(factory.id, "catapult"));
        } else if (act === "train_ram" && factory) {
          this._dispatchCommand(cmd.train(factory.id, "ram"));
        } else if (act.startsWith("form_")) {
          const f = act.replace("form_", "");
          this._dispatchCommand(cmd.formation(Array.from(this.selection), f));
          this.loreAudio.playWarDrum(70, 0.6);
          this._updateContextualHUD();
        } else if (act.startsWith("stance_")) {
          const s = act.replace("stance_", "");
          this._dispatchCommand(cmd.stance(Array.from(this.selection), s));
          this.loreAudio.playWarDrum(65, 0.6);
          this._updateContextualHUD();
        } else if (act.startsWith("build_")) {
          this.placingBuildingType = act.replace("build_", "");
        }
      };
    } else {
      actionBar.style.display = "none";
    }
  }

  _renderControlGroupBadges() {
    let container = document.getElementById("control-groups-bar");
    if (!container) {
      container = document.createElement("div");
      container.id = "control-groups-bar";
      container.style.cssText = "position:absolute; bottom:110px; left:20px; display:flex; gap:6px; z-index:120; pointer-events:auto;";
      document.body.appendChild(container);
    }

    const chips = [];
    for (let i = 1; i <= 9; i++) {
      if (this.controlGroups.has(i)) {
        const grp = this.controlGroups.get(i);
        const validCount = Array.from(grp).filter(id => this.sim.units.some(u => u.id === id && u.owner === this.localPlayer && u.hp > 0)).length;
        if (validCount > 0) {
          chips.push(`
            <button class="grp-chip" data-grp="${i}" style="background:rgba(20,24,36,0.92); border:1px solid #ffd166; color:#fff; border-radius:4px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.5);">
              [${i}] 🛡️ ${validCount}
            </button>
          `);
        }
      }
    }

    container.innerHTML = chips.join("");
    container.onclick = (e) => {
      const btn = e.target.closest(".grp-chip");
      if (!btn) return;
      const grp = parseInt(btn.dataset.grp);
      if (this.controlGroups.has(grp)) {
        const validIds = Array.from(this.controlGroups.get(grp)).filter(id => this.sim.units.some(u => u.id === id && u.owner === this.localPlayer && u.hp > 0));
        if (validIds.length > 0) {
          this.selection = new Set(validIds);
          this._updateContextualHUD();
          const units = this.sim.units.filter(u => validIds.includes(u.id));
          const avgX = units.reduce((acc, u) => acc + u.x, 0) / units.length;
          const avgZ = units.reduce((acc, u) => acc + u.y, 0) / units.length;
          this.rtsCamera.target.set(avgX, 0, avgZ);
          this.loreAudio.playTempleBell(720);
        }
      }
    };
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.app3D = new Swarajya3DApp();
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("autostart") === "1") {
    setTimeout(() => {
      if (window.app3D) window.app3D._startMatch();
    }, 200);
  }
});
