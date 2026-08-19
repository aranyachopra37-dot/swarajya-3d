// Interactive 3D Tactical Minimap for Swarajya (Three.js + 2D Canvas)
// Renders terrain topology, gold deposits, woods, entity radar blips, home base beacon, and live camera viewport frustum.

import { TILE, GROUND, ROCK, WATER, FOREST, HILL, GOLD } from "../dominion/grid.js";

export class Minimap3D {
  /**
   * @param {HTMLElement} containerEl 
   * @param {import('./camera3d.js').RtsCamera3D} rtsCamera 
   * @param {THREE.Camera} camera
   */
  constructor(containerEl, rtsCamera, camera) {
    this.container = containerEl;
    this.rtsCamera = rtsCamera;
    this.camera = camera;

    this.canvas = document.createElement("canvas");
    this.canvas.width = 190;
    this.canvas.height = 145;
    this.canvas.id = "minimap-canvas";
    this.ctx = this.canvas.getContext("2d");

    this.bgCanvas = document.createElement("canvas");
    this.bgCtx = this.bgCanvas.getContext("2d");

    this.sim = null;
    this.isDragging = false;

    this._setupDOM();
    this._bindEvents();
  }

  _setupDOM() {
    this.wrapper = document.createElement("div");
    this.wrapper.id = "minimap-wrapper";
    this.wrapper.style.cssText = `
      position: absolute;
      bottom: 18px;
      right: 18px;
      width: 194px;
      height: 149px;
      border: 2px solid #ffd166;
      border-radius: 8px;
      background: #0d1117;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.9);
      z-index: 50;
      overflow: hidden;
      cursor: crosshair;
      backdrop-filter: blur(8px);
      user-select: none;
    `;

    this.canvas.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
      cursor: crosshair;
    `;

    this.wrapper.appendChild(this.canvas);
    this.container.appendChild(this.wrapper);
  }

  _bindEvents() {
    const handleMinimapInteraction = (e) => {
      if (!this.sim || !this.sim.grid) return;
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      const xPct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const yPct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

      const worldW = this.sim.grid.w * TILE;
      const worldH = this.sim.grid.h * TILE;

      const targetX = xPct * worldW;
      const targetZ = yPct * worldH;

      this.rtsCamera.focusOn(targetX, targetZ);
    };

    const onPointerDown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.isDragging = true;
      handleMinimapInteraction(e);
    };

    const onPointerMove = (e) => {
      if (this.isDragging) {
        e.stopPropagation();
        e.preventDefault();
        handleMinimapInteraction(e);
      }
    };

    const onPointerUp = (e) => {
      if (this.isDragging) {
        e.stopPropagation();
        this.isDragging = false;
      }
    };

    this.wrapper.addEventListener("pointerdown", onPointerDown, { passive: false });
    this.wrapper.addEventListener("mousedown", onPointerDown, { passive: false });
    this.canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    this.canvas.addEventListener("mousedown", onPointerDown, { passive: false });

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("mousemove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("mouseup", onPointerUp);
  }

  /**
   * Pre-renders static terrain bitmap for high-performance rendering.
   */
  initTerrain(sim) {
    this.sim = sim;
    const { w, h, cells } = sim.grid;

    this.bgCanvas.width = w;
    this.bgCanvas.height = h;

    const imgData = this.bgCtx.createImageData(w, h);
    const data = imgData.data;

    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const idx = (ty * w + tx);
        const pIdx = idx * 4;
        const type = cells[idx];

        let r = 52, g = 86, b = 58; // Lush Alpine Grass
        if (type === HILL) { r = 88; g = 120; b = 84; }
        else if (type === ROCK) { r = 240; g = 244; b = 248; } // Snow Peak
        else if (type === WATER) { r = 26; g = 58; b = 84; }   // Glacial River
        else if (type === FOREST) { r = 20; g = 52; b = 35; }  // Pine Woods
        else if (type === GOLD) { r = 255; g = 183; b = 3; }   // Gold Seam

        data[pIdx] = r;
        data[pIdx + 1] = g;
        data[pIdx + 2] = b;
        data[pIdx + 3] = 255;
      }
    }

    this.bgCtx.putImageData(imgData, 0, 0);
  }

  /**
   * Draws dynamic radar blips, home base, and active camera viewport frustum.
   */
  update(localPlayer = 0) {
    if (!this.sim || !this.sim.grid) return;
    const { w, h } = this.sim.grid;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, cw, ch);

    // 1. Draw Static Terrain Background
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bgCanvas, 0, 0, cw, ch);

    const worldW = w * TILE;
    const worldH = h * TILE;
    const scaleX = cw / worldW;
    const scaleY = ch / worldH;

    // 2. Draw Buildings & Construction Sites
    for (const b of this.sim.buildings) {
      const bx = (b.tx + (b.spec ? b.spec.tiles : 2) / 2) * TILE;
      const bz = (b.ty + (b.spec ? b.spec.tiles : 2) / 2) * TILE;
      const mx = bx * scaleX;
      const my = bz * scaleY;
      const bSize = (b.spec ? b.spec.tiles : 2) * 2.4;

      if (b.owner === localPlayer) {
        ctx.fillStyle = b.spec.isHeart ? "#ffd166" : "#7fd48f";
      } else {
        ctx.fillStyle = "#e63946";
      }
      ctx.fillRect(mx - bSize / 2, my - bSize / 2, bSize, bSize);

      // Home Base Icon (Star marker on starting Manor)
      if (b.owner === localPlayer && b.spec.isHeart) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(mx - bSize / 2 - 1, my - bSize / 2 - 1, bSize + 2, bSize + 2);
      }
    }

    // Construction Sites
    if (this.sim.sites) {
      for (const s of this.sim.sites) {
        const sx = (s.tx + (s.spec ? s.spec.tiles : 2) / 2) * TILE;
        const sz = (s.ty + (s.spec ? s.spec.tiles : 2) / 2) * TILE;
        const mx = sx * scaleX;
        const my = sz * scaleY;
        ctx.fillStyle = "#f4a261";
        ctx.fillRect(mx - 2, my - 2, 4, 4);
      }
    }

    // 2.5 Draw Sacred Himalayan Tirthas (Shrines)
    if (this.sim.tirthas) {
      for (const t of this.sim.tirthas) {
        const mx = t.x * scaleX;
        const my = t.y * scaleY;
        ctx.fillStyle = t.controller === localPlayer ? "#7fd48f" : (t.controller !== null ? "#e63946" : t.spec.color);
        ctx.beginPath();
        ctx.arc(mx, my, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 3. Draw Units
    for (const u of this.sim.units) {
      const mx = u.x * scaleX;
      const my = u.y * scaleY;

      ctx.fillStyle = u.owner === localPlayer ? "#ffe6a7" : "#e63946";
      ctx.beginPath();
      ctx.arc(mx, my, u.spec.worker ? 1.8 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Draw Camera Viewport Frustum Box (High-Contrast Golden Rect)
    const camTarget = this.rtsCamera.target;
    const ctxCamX = camTarget.x * scaleX;
    const ctxCamY = camTarget.z * scaleY;

    // Viewport approximate coverage box based on camera distance and pitch
    const dist = this.rtsCamera.distance;
    const boxW = Math.max(16, (dist * 1.3) * scaleX);
    const boxH = Math.max(12, (dist * 0.95) * scaleY);

    ctx.fillStyle = "rgba(255, 209, 102, 0.22)";
    ctx.fillRect(ctxCamX - boxW / 2, ctxCamY - boxH / 2, boxW, boxH);

    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2.0;
    ctx.strokeRect(ctxCamX - boxW / 2, ctxCamY - boxH / 2, boxW, boxH);

    // Glowing Camera Center Blip
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ctxCamX, ctxCamY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
