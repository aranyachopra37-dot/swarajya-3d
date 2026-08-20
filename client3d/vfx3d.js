// 3D Particle Effects, Floating Damage Numbers, and Screen Shake for Swarajya (Three.js)
// Zero-allocation particle pooling, shared geometries, and high-performance WebGL memory safety.

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class Vfx3D {
  /**
   * @param {THREE.Scene} scene 
   * @param {THREE.Camera} camera 
   */
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this.particles = [];
    this.damageTexts = [];
    this.lightnings = [];
    this.energyRings = [];
    this.shakeIntensity = 0;
    this.shakeDecay = 5.0;

    this.vfxGroup = new THREE.Group();
    this.scene.add(this.vfxGroup);

    this.quality = "high";
    this._initSharedResources();
  }

  setQuality(quality) {
    this.quality = quality;
    if (quality === "low") {
      this.clearAll();
    }
  }

  clearAll() {
    for (const p of this.particles) this.vfxGroup.remove(p.mesh);
    for (const d of this.damageTexts) this.vfxGroup.remove(d.sprite);
    for (const l of this.lightnings) {
      this.vfxGroup.remove(l.line);
      if (l.light) this.vfxGroup.remove(l.light);
      if (l.line.geometry) l.line.geometry.dispose();
    }
    for (const r of this.energyRings) this.vfxGroup.remove(r.mesh);

    this.particles.length = 0;
    this.damageTexts.length = 0;
    this.lightnings.length = 0;
    this.energyRings.length = 0;
  }

  _initSharedResources() {
    this.debrisGeo = new THREE.DodecahedronGeometry(1.0, 0);
    this.pranaGeo = new THREE.SphereGeometry(0.5, 5, 5);

    const wardGeo = new THREE.RingGeometry(0.8, 1.0, 24);
    wardGeo.rotateX(-Math.PI / 2);
    this.wardGeo = wardGeo;

    const bcGeo = new THREE.RingGeometry(0.85, 1.0, 24);
    bcGeo.rotateX(-Math.PI / 2);
    this.battlecryGeo = bcGeo;

    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x8b8b8b, roughness: 0.85 });
    this.woodDebrisMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
    this.pranaMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 });
    this.wardMat = new THREE.MeshBasicMaterial({ color: 0x00bbf9, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    this.battlecryMat = new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });

    // Texture Cache for common damage numbers to avoid creating HTML5 canvases in loop
    this.textTextureCache = new Map();
  }

  _getTextTexture(text, color) {
    const key = `${text}_${color}`;
    if (this.textTextureCache.has(key)) return this.textTextureCache.get(key);

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    ctx.font = "bold 32px ui-monospace, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillText(text, 66, 34); // shadow
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    if (this.textTextureCache.size < 64) {
      this.textTextureCache.set(key, texture);
    }
    return texture;
  }

  shake(amount = 4.0) {
    if (this.quality === "low") return;
    this.shakeIntensity = Math.min(10.0, this.shakeIntensity + amount);
  }

  spawnDamageText(x, y, z, text, type = "normal") {
    if (this.quality === "low") return;
    if (this.damageTexts.length > (this.quality === "medium" ? 15 : 35)) return;

    let color = "#ffffff";
    let scale = 12;
    if (type === "flank") {
      color = "#ffd166";
      scale = 15;
    } else if (type === "rear") {
      color = "#ef476f";
      scale = 18;
      text = `${text}!`;
    }

    const texture = this._getTextTexture(String(text), color);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale * 0.5, 1);
    sprite.position.set(x, y + 10, z);

    this.vfxGroup.add(sprite);

    this.damageTexts.push({
      sprite,
      vy: 14 + Math.random() * 6,
      vx: (Math.random() - 0.5) * 6,
      life: 0.8,
      maxLife: 0.8,
    });
  }

  spawnDebris(x, y, z, count = 6, hexColor = 0x8b8b8b) {
    if (this.quality === "low") return;
    const maxAllowed = this.quality === "medium" ? 25 : 60;
    if (this.particles.length >= maxAllowed) return;

    const mat = hexColor === 0x8b5a2b ? this.woodDebrisMat : this.debrisMat;
    const actualCount = this.quality === "medium" ? Math.min(3, count) : count;

    for (let i = 0; i < actualCount; i++) {
      const mesh = new THREE.Mesh(this.debrisGeo, mat);
      mesh.position.set(x, y + 2, z);
      this.vfxGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 8 + Math.random() * 16;
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 10 + Math.random() * 14,
        vz: Math.sin(angle) * speed,
        rotX: Math.random() * 4,
        rotY: Math.random() * 4,
        life: 0.7 + Math.random() * 0.3,
        maxLife: 1.0,
      });
    }
  }

  update(dt) {
    // 1. Update Damage Numbers
    for (let i = this.damageTexts.length - 1; i >= 0; i--) {
      const item = this.damageTexts[i];
      item.life -= dt;
      item.sprite.position.y += item.vy * dt;
      item.sprite.position.x += item.vx * dt;
      item.sprite.material.opacity = Math.max(0, item.life / item.maxLife);

      if (item.life <= 0) {
        this.vfxGroup.remove(item.sprite);
        item.sprite.material.dispose();
        this.damageTexts.splice(i, 1);
      }
    }

    // 2. Update Debris Particles (Safe cleanup without disposing shared static geometry!)
    const gravity = -45;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy += gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;

      p.mesh.rotation.x += p.rotX * dt;
      p.mesh.rotation.y += p.rotY * dt;

      const scale = Math.max(0.1, p.life / p.maxLife);
      p.mesh.scale.set(scale, scale, scale);

      if (p.life <= 0) {
        this.vfxGroup.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    // 3. Update Lightning & Energy Beams
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      const bolt = this.lightnings[i];
      bolt.life -= dt;
      bolt.line.material.opacity = Math.max(0, bolt.life / bolt.maxLife);
      if (bolt.light) bolt.light.intensity = Math.max(0, (bolt.life / bolt.maxLife) * 6);

      if (bolt.life <= 0) {
        this.vfxGroup.remove(bolt.line);
        if (bolt.light) this.vfxGroup.remove(bolt.light);
        if (bolt.line.geometry) bolt.line.geometry.dispose();
        if (bolt.line.material) bolt.line.material.dispose();
        this.lightnings.splice(i, 1);
      }
    }

    // 4. Update Expanding Energy Rings & Shields
    for (let i = this.energyRings.length - 1; i >= 0; i--) {
      const ring = this.energyRings[i];
      ring.life -= dt;
      const progress = 1 - (ring.life / ring.maxLife);
      const currentRadius = ring.startRadius + (ring.endRadius - ring.startRadius) * progress;
      ring.mesh.scale.set(currentRadius, currentRadius, currentRadius);

      if (ring.life <= 0) {
        this.vfxGroup.remove(ring.mesh);
        this.energyRings.splice(i, 1);
      }
    }

    // 5. Update Camera Shake
    if (this.shakeIntensity > 0.05) {
      const ox = (Math.random() - 0.5) * this.shakeIntensity;
      const oy = (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.x += ox;
      this.camera.position.y += oy;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);
    }
  }

  spawnVajraLightning(points) {
    if (this.quality === "low" || !points || points.length < 2) return;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segments = this.quality === "medium" ? 3 : 5;
      const vertices = [];
      vertices.push(new THREE.Vector3(p1.x, p1.y + 6, p1.z));

      for (let s = 1; s < segments; s++) {
        const t = s / segments;
        const ix = p1.x + (p2.x - p1.x) * t + (Math.random() - 0.5) * 6;
        const iy = (p1.y + 6) + (p2.y - p1.y) * t + (Math.random() - 0.5) * 4;
        const iz = p1.z + (p2.z - p1.z) * t + (Math.random() - 0.5) * 6;
        vertices.push(new THREE.Vector3(ix, iy, iz));
      }
      vertices.push(new THREE.Vector3(p2.x, p2.y + 6, p2.z));

      const geo = new THREE.BufferGeometry().setFromPoints(vertices);
      const mat = new THREE.LineBasicMaterial({ color: 0x00f5d4, linewidth: 2, transparent: true, opacity: 1.0 });
      const line = new THREE.Line(geo, mat);
      this.vfxGroup.add(line);

      this.lightnings.push({ line, life: 0.25, maxLife: 0.25 });
    }
  }

  spawnKavachaWard(x, y, z, radius = 70) {
    if (this.quality === "low") return;
    const mesh = new THREE.Mesh(this.wardGeo, this.wardMat);
    mesh.position.set(x, y + 1.5, z);
    this.vfxGroup.add(mesh);

    this.energyRings.push({
      mesh,
      startRadius: 2,
      endRadius: radius,
      life: 0.7,
      maxLife: 0.7
    });
  }

  spawnBattlecryAura(x, y, z, radius = 100) {
    if (this.quality === "low") return;
    const mesh = new THREE.Mesh(this.battlecryGeo, this.battlecryMat);
    mesh.position.set(x, y + 1.8, z);
    this.vfxGroup.add(mesh);

    this.energyRings.push({
      mesh,
      startRadius: 4,
      endRadius: radius,
      life: 0.8,
      maxLife: 0.8
    });
  }

  spawnPranaDissolve(x, y, z) {
    if (this.quality === "low") return;
    const count = this.quality === "medium" ? 4 : 8;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.pranaGeo, this.pranaMat);
      mesh.position.set(x + (Math.random() - 0.5) * 5, y + 2 + Math.random() * 3, z + (Math.random() - 0.5) * 5);
      this.vfxGroup.add(mesh);

      this.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 6,
        vy: 10 + Math.random() * 12,
        vz: (Math.random() - 0.5) * 6,
        rotX: 0,
        rotY: 0,
        life: 0.8 + Math.random() * 0.4,
        maxLife: 1.2,
      });
    }
  }
}
