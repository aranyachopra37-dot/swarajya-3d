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
    this.shakeIntensity = 0;
    this.shakeDecay = 5.0;

    this.vfxGroup = new THREE.Group();
    this.scene.add(this.vfxGroup);

    this._initCanvasPool();
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

    // 3. Update Camera Shake
    if (this.shakeIntensity > 0.05) {
      const ox = (Math.random() - 0.5) * this.shakeIntensity;
      const oy = (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.x += ox;
      this.camera.position.y += oy;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);
    }
  }
}
