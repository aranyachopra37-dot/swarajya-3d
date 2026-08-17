// 3D Particle Effects, Floating Damage Numbers, and Screen Shake for Swarajya (Three.js)

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
    this._initCanvasPool();
  }

  setQuality(quality) {
    this.quality = quality;
  }

  _initCanvasPool() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 128;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext("2d");
  }

  /**
   * Triggers screen shake for heavy siege impacts.
   * @param {number} amount - Intensity (e.g. 3.0 to 8.0)
   */
  shake(amount = 4.0) {
    this.shakeIntensity = Math.min(12.0, this.shakeIntensity + amount);
  }

  /**
   * Spawns floating damage text in 3D world space.
   * @param {number} x - World X
   * @param {number} y - World Y (elevation)
   * @param {number} z - World Z
   * @param {number|string} text - Damage amount
   * @param {string} type - "normal" | "flank" | "rear"
   */
  spawnDamageText(x, y, z, text, type = "normal") {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    ctx.font = "bold 32px ui-monospace, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

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

    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillText(text, 66, 34); // drop shadow
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale * 0.5, 1);
    sprite.position.set(x, y + 10, z);

    this.vfxGroup.add(sprite);

    this.damageTexts.push({
      sprite,
      vy: 14 + Math.random() * 6,
      vx: (Math.random() - 0.5) * 6,
      life: 0.9,
      maxLife: 0.9,
    });
  }

  /**
   * Spawns dust / stone rubble particles.
   * @param {number} x 
   * @param {number} y 
   * @param {number} z 
   * @param {number} count 
   * @param {number} hexColor 
   */
  spawnDebris(x, y, z, count = 8, hexColor = 0x8b8b8b) {
    const geo = new THREE.DodecahedronGeometry(1.2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: hexColor, roughness: 0.8 });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y + 2, z);
      this.vfxGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 20;
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 12 + Math.random() * 18,
        vz: Math.sin(angle) * speed,
        rotX: Math.random() * 5,
        rotY: Math.random() * 5,
        life: 0.8 + Math.random() * 0.4,
        maxLife: 1.2,
      });
    }
  }

  /**
   * Frame update for particles, damage numbers, and camera shake.
   * @param {number} dt - Seconds elapsed
   */
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
        item.sprite.material.map.dispose();
        this.damageTexts.splice(i, 1);
      }
    }

    // 2. Update Debris Particles
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
        p.mesh.geometry.dispose();
        this.particles.splice(i, 1);
      }
    }

    // 3. Update Lightning & Energy Beams
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      const bolt = this.lightnings[i];
      bolt.life -= dt;
      bolt.line.material.opacity = Math.max(0, bolt.life / bolt.maxLife);
      if (bolt.light) bolt.light.intensity = Math.max(0, (bolt.life / bolt.maxLife) * 8);

      if (bolt.life <= 0) {
        this.vfxGroup.remove(bolt.line);
        if (bolt.light) this.vfxGroup.remove(bolt.light);
        bolt.line.geometry.dispose();
        bolt.line.material.dispose();
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
      ring.mesh.material.opacity = Math.max(0, (ring.life / ring.maxLife) * 0.7);

      if (ring.life <= 0) {
        this.vfxGroup.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
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

  /**
   * Spawns Vajra chain lightning connecting multiple points.
   * @param {Array<{x: number, y: number, z: number}>} points
   */
  spawnVajraLightning(points) {
    if (!points || points.length < 2) return;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segments = 6;
      const vertices = [];
      vertices.push(new THREE.Vector3(p1.x, p1.y + 6, p1.z));

      for (let s = 1; s < segments; s++) {
        const t = s / segments;
        const ix = p1.x + (p2.x - p1.x) * t + (Math.random() - 0.5) * 8;
        const iy = (p1.y + 6) + (p2.y - p1.y) * t + (Math.random() - 0.5) * 6;
        const iz = p1.z + (p2.z - p1.z) * t + (Math.random() - 0.5) * 8;
        vertices.push(new THREE.Vector3(ix, iy, iz));
      }
      vertices.push(new THREE.Vector3(p2.x, p2.y + 6, p2.z));

      const geo = new THREE.BufferGeometry().setFromPoints(vertices);
      const mat = new THREE.LineBasicMaterial({ color: 0x00f5d4, linewidth: 3, transparent: true, opacity: 1.0 });
      const line = new THREE.Line(geo, mat);
      this.vfxGroup.add(line);

      const light = new THREE.PointLight(0x00f5d4, 6, 40);
      light.position.set(p2.x, p2.y + 8, p2.z);
      this.vfxGroup.add(light);

      this.lightnings.push({ line, light, life: 0.35, maxLife: 0.35 });
    }
  }

  /**
   * Spawns Kavacha spiritual ward dome / sphere.
   */
  spawnKavachaWard(x, y, z, radius = 70) {
    const geo = new THREE.RingGeometry(0.8, 1.0, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00bbf9, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 1.5, z);
    this.vfxGroup.add(mesh);

    this.energyRings.push({
      mesh,
      startRadius: 2,
      endRadius: radius,
      life: 0.8,
      maxLife: 0.8
    });
  }

  /**
   * Spawns Battlecry golden radiance ring shockwave.
   */
  spawnBattlecryAura(x, y, z, radius = 100) {
    const geo = new THREE.RingGeometry(0.85, 1.0, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 1.8, z);
    this.vfxGroup.add(mesh);

    this.energyRings.push({
      mesh,
      startRadius: 4,
      endRadius: radius,
      life: 1.0,
      maxLife: 1.0
    });
  }

  /**
   * Spawns Prana golden sparkle dissolve when units fall.
   */
  spawnPranaDissolve(x, y, z, hexColor = 0xffd166) {
    const count = 14;
    const geo = new THREE.SphereGeometry(0.6, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + (Math.random() - 0.5) * 6, y + 2 + Math.random() * 4, z + (Math.random() - 0.5) * 6);
      this.vfxGroup.add(mesh);

      this.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 8,
        vy: 12 + Math.random() * 16,
        vz: (Math.random() - 0.5) * 8,
        rotX: 0,
        rotY: 0,
        life: 1.0 + Math.random() * 0.5,
        maxLife: 1.5,
      });
    }
  }
}
