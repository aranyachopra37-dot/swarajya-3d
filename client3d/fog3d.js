// 3D Fog of War & Line-of-Sight System for Swarajya (Three.js)
// Supports organic Himalayan mountain mist, tile exploration, and dynamic enemy concealment.

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { TILE, toTile } from "../dominion/grid.js";

export const FOW_UNEXPLORED = 0;
export const FOW_EXPLORED = 1;
export const FOW_VISIBLE = 2;

export class FogOfWar3D {
  /**
   * @param {THREE.Scene} scene 
   * @param {number} mapW - Tiles wide
   * @param {number} mapH - Tiles high
   */
  constructor(scene, mapW = 112, mapH = 84) {
    this.scene = scene;
    this.mapW = mapW;
    this.mapH = mapH;
    this.enabled = true;

    this.grid = new Uint8Array(mapW * mapH); // 0, 1, 2

    this._initFogPlane();
  }

  _initFogPlane() {
    const worldW = this.mapW * TILE;
    const worldH = this.mapH * TILE;

    // Create offscreen canvas for dynamic vision texture
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.mapW;
    this.canvas.height = this.mapH;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;

    // Fog overlay plane slightly elevated above ground
    const geo = new THREE.PlaneGeometry(worldW, worldH);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(worldW / 2, 2.5, worldH / 2);
    this.scene.add(this.mesh);

    this.imgData = this.ctx.createImageData(this.mapW, this.mapH);
  }

  /**
   * Resets fog for a new map.
   */
  reset(mapW, mapH) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.grid = new Uint8Array(mapW * mapH);

    this.canvas.width = mapW;
    this.canvas.height = mapH;
    this.imgData = this.ctx.createImageData(mapW, mapH);

    const worldW = mapW * TILE;
    const worldH = mapH * TILE;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(worldW, worldH);
    this.mesh.geometry.rotateX(-Math.PI / 2);
    this.mesh.position.set(worldW / 2, 2.5, worldH / 2);
  }

  /**
   * Updates line-of-sight and renders visibility mask.
   * @param {Object} sim - Simulation instance
   * @param {number} localPlayer - Local player seat ID (0)
   * @param {Map<number, THREE.Group>} unitMeshes
   * @param {Map<number, THREE.Group>} buildingMeshes
   */
  update(sim, localPlayer, unitMeshes, buildingMeshes) {
    if (!this.enabled) {
      this.mesh.visible = false;
      // Reveal all enemy units & buildings
      for (const mesh of unitMeshes.values()) mesh.visible = true;
      for (const mesh of buildingMeshes.values()) mesh.visible = true;
      return;
    }

    this.mesh.visible = true;

    // 1. Downgrade currently visible tiles to explored
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === FOW_VISIBLE) {
        this.grid[i] = FOW_EXPLORED;
      }
    }

    // 2. Reveal vision around friendly buildings
    for (const b of sim.buildings) {
      if (b.owner === localPlayer) {
        const tiles = b.spec ? b.spec.tiles : 2;
        const radius = b.spec ? (b.spec.isHeart ? 16 : (b.spec.sight || 10)) : 10;
        const cx = b.tx + Math.floor(tiles / 2);
        const cy = b.ty + Math.floor(tiles / 2);
        this._revealCircle(cx, cy, radius);
      }
    }

    // 3. Reveal vision around friendly units
    for (const u of sim.units) {
      if (u.owner === localPlayer) {
        const radius = u.spec ? (u.spec.sight || (u.spec.worker ? 7 : (u.spec.archer ? 13 : 9))) : 8;
        const tx = toTile(u.x);
        const ty = toTile(u.y);
        this._revealCircle(tx, ty, radius);
      }
    }

    // 4. Update dynamic fog texture
    const data = this.imgData.data;
    for (let i = 0; i < this.grid.length; i++) {
      const state = this.grid[i];
      const idx = i * 4;

      if (state === FOW_VISIBLE) {
        data[idx] = 15;     // R
        data[idx + 1] = 17; // G
        data[idx + 2] = 23; // B
        data[idx + 3] = 0;  // Fully transparent
      } else if (state === FOW_EXPLORED) {
        data[idx] = 15;
        data[idx + 1] = 17;
        data[idx + 2] = 23;
        data[idx + 3] = 140; // Shrouded (55% opacity)
      } else {
        data[idx] = 15;
        data[idx + 1] = 17;
        data[idx + 2] = 23;
        data[idx + 3] = 250; // Unexplored Black Mist (98% opacity)
      }
    }

    this.ctx.putImageData(this.imgData, 0, 0);
    this.texture.needsUpdate = true;

    // 5. Hide/Show enemy units based on current line-of-sight
    for (const u of sim.units) {
      const mesh = unitMeshes.get(u.id);
      if (mesh) {
        if (u.owner === localPlayer) {
          mesh.visible = true;
        } else {
          const tx = toTile(u.x);
          const ty = toTile(u.y);
          const visible = this.isVisible(tx, ty);
          mesh.visible = visible;
        }
      }
    }

    // 6. Hide/Show enemy buildings based on exploration
    for (const b of sim.buildings) {
      const mesh = buildingMeshes.get(b.id);
      if (mesh) {
        if (b.owner === localPlayer) {
          mesh.visible = true;
        } else {
          const visible = this.isExplored(b.tx, b.ty);
          mesh.visible = visible;
        }
      }
    }
  }

  _revealCircle(cx, cy, radius) {
    const rSq = radius * radius;
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(this.mapW - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(this.mapH - 1, cy + radius);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rSq) {
          this.grid[y * this.mapW + x] = FOW_VISIBLE;
        }
      }
    }
  }

  isVisible(tx, ty) {
    if (tx < 0 || tx >= this.mapW || ty < 0 || ty >= this.mapH) return false;
    return this.grid[ty * this.mapW + tx] === FOW_VISIBLE;
  }

  isExplored(tx, ty) {
    if (tx < 0 || tx >= this.mapW || ty < 0 || ty >= this.mapH) return false;
    return this.grid[ty * this.mapW + tx] >= FOW_EXPLORED;
  }
}
