// Interactive 3D Tactical Minimap for Swarajya (Three.js + 2D Canvas)
// Renders terrain topology, gold deposits, woods, entity radar blips, and camera FOV frustum.

import { TILE, GROUND, ROCK, WATER, FOREST, HILL, GOLD } from "../dominion/grid.js";
import { OWNER_COLORS } from "./render3d.js";

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
    this.canvas.width = 180;
    this.canvas.height = 135;
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
      width: 184px;
      height: 139px;
      border: 2px solid #d4a373;
      border-radius: 8px;
      background: #0f131a;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.85);
      z-index: 25;
      overflow: hidden;
      cursor: crosshair;
      backdrop-filter: blur(8px);
    `;

    this.canvas.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
    `;

    this.wrapper.appendChild(this.canvas);
    this.container.appendChild(this.wrapper);
  }

  _bindEvents() {
    const handleMinimapClick = (e) => {
      if (!this.sim || !this.sim.grid) return;
      const rect = this.canvas.getBoundingClientRect();
      const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

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
      handleMinimapClick(e);
    };

    const onPointerMove = (e) => {
      if (this.isDragging) {
        e.stopPropagation();
        e.preventDefault();
        handleMinimapClick(e);
      }
    };

    const onPointerUp = (e) => {
      if (this.isDragging) {
        e.stopPropagation();
        this.isDragging = false;
      }
    };

    this.wrapper.addEventListener("pointerdown", onPointerDown);
    this.wrapper.addEventListener("mousedown", onPointerDown);
    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("mousedown", onPointerDown);
    this.canvas.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleMinimapClick(e);
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("mouseup", onPointerUp);
  }

  /**
   * Pre-renders static terrain bitmap for performance.
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

        let r = 58, g = 90, b = 64; // Grass
        if (type === HILL) { r = 88; g = 129; b = 87; }
        else if (type === ROCK) { r = 240; g = 244; b = 248; } // Snow Peak
        else if (type === WATER) { r = 29; g = 53; b = 87; }   // River
        else if (type === FOREST) { r = 27; g = 67; b = 50; }  // Pine Woods
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
   * Draws dynamic radar blips and camera frustum.
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

    // 2. Draw Buildings
    for (const b of this.sim.buildings) {
      const bx = (b.tx + (b.spec ? b.spec.tiles : 2) / 2) * TILE;
      const bz = (b.ty + (b.spec ? b.spec.tiles : 2) / 2) * TILE;
      const mx = bx * scaleX;
      const my = bz * scaleY;
      const bSize = (b.spec ? b.spec.tiles : 2) * 2.2;

      ctx.fillStyle = b.owner === localPlayer ? "#7fd48f" : "#e63946";
      ctx.fillRect(mx - bSize / 2, my - bSize / 2, bSize, bSize);
    }

    // 3. Draw Units
    for (const u of this.sim.units) {
      const mx = u.x * scaleX;
      const my = u.y * scaleY;

      ctx.fillStyle = u.owner === localPlayer ? "#ffd166" : "#e63946";
      ctx.beginPath();
      ctx.arc(mx, my, u.spec.worker ? 1.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Draw Camera Viewpoint Frustum
    const camTarget = this.rtsCamera.target;
    const ctxCamX = camTarget.x * scaleX;
    const ctxCamY = camTarget.z * scaleY;

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(ctxCamX, ctxCamY, 4.5, 0, Math.PI * 2);
    ctx.stroke();

    // Camera field-of-view cone indicator
    const yaw = this.rtsCamera.yaw;
    const fovLen = 14;
    const leftAngle = yaw - Math.PI / 2 - 0.45;
    const rightAngle = yaw - Math.PI / 2 + 0.45;

    ctx.beginPath();
    ctx.moveTo(ctxCamX, ctxCamY);
    ctx.lineTo(ctxCamX + Math.cos(leftAngle) * fovLen, ctxCamY + Math.sin(leftAngle) * fovLen);
    ctx.lineTo(ctxCamX + Math.cos(rightAngle) * fovLen, ctxCamY + Math.sin(rightAngle) * fovLen);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.fill();
    ctx.stroke();
  }
}
