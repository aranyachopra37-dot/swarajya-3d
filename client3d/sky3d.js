// Dynamic Sky, Sun/Moon Arc, Day-Night Cycle, and Weather System for Swarajya (Three.js)
// 1 real-time minute = 1 in-game hour (24 minutes = 1 full day-night cycle).

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class Sky3D {
  /**
   * @param {THREE.Scene} scene 
   * @param {THREE.DirectionalLight} dirLight 
   * @param {THREE.HemisphereLight} hemiLight 
   * @param {string} weatherType - "clear" | "snow" | "rain" | "mist"
   */
  constructor(scene, dirLight, hemiLight, weatherType = "snow") {
    this.scene = scene;
    this.dirLight = dirLight;
    this.hemiLight = hemiLight;
    this.weatherType = weatherType;

    // Time: 0.0 to 24.0 (starts at 8:00 AM bright morning)
    this.timeOfDay = 8.0;
    this.timeScale = 1.0 / 60.0; // 1 real sec = 1/60 in-game hour (1 min = 1 hour)

    this.weatherParticles = [];
    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);

    this._initSkyDome();
    this._initWeather();
    this.updateLighting();
  }

  _initSkyDome() {
    // Hemispherical sky dome with gradient vertex colors
    const skyGeo = new THREE.SphereGeometry(1800, 32, 16);
    // Invert geometry so inside is visible
    skyGeo.scale(-1, 1, 1);

    this.skyMaterial = new THREE.MeshBasicMaterial({
      color: 0x87ceeb,
      side: THREE.BackSide,
      fog: false,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.scene.add(this.skyMesh);

    // Sun Sprite
    const sunCanvas = document.createElement("canvas");
    sunCanvas.width = 128;
    sunCanvas.height = 128;
    const sCtx = sunCanvas.getContext("2d");
    const grad = sCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255, 255, 240, 1)");
    grad.addColorStop(0.3, "rgba(255, 220, 120, 0.8)");
    grad.addColorStop(0.7, "rgba(255, 180, 80, 0.2)");
    grad.addColorStop(1, "rgba(255, 140, 40, 0)");
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 128, 128);

    const sunTexture = new THREE.CanvasTexture(sunCanvas);
    const sunMat = new THREE.SpriteMaterial({ map: sunTexture, transparent: true, blending: THREE.AdditiveBlending });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(160, 160, 1);
    this.scene.add(this.sunSprite);
  }

  _initWeather() {
    // Create Alpine Snow or Mountain Rain particles
    const count = this.weatherType === "snow" ? 600 : (this.weatherType === "rain" ? 800 : 0);
    if (count === 0) return;

    const isSnow = this.weatherType === "snow";
    const geo = isSnow ? new THREE.SphereGeometry(0.8, 4, 4) : new THREE.CylinderGeometry(0.1, 0.1, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: isSnow ? 0xffffff : 0xa0c4ff,
      transparent: true,
      opacity: isSnow ? 0.75 : 0.45,
    });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 1200,
        Math.random() * 250 + 10,
        (Math.random() - 0.5) * 1200
      );
      this.particleGroup.add(mesh);
      this.weatherParticles.push({
        mesh,
        vy: isSnow ? -(12 + Math.random() * 10) : -(70 + Math.random() * 30),
        vx: isSnow ? (Math.random() - 0.5) * 8 : (Math.random() - 0.5) * 4,
        vz: isSnow ? (Math.random() - 0.5) * 8 : (Math.random() - 0.5) * 4,
      });
    }
  }

  setWeather(type) {
    this.weatherType = type;
    // Clear existing particles
    for (const p of this.weatherParticles) {
      this.particleGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.weatherParticles = [];
    this._initWeather();
  }

  /**
   * Advances the day-night cycle by dt seconds.
   * @param {number} dt - Frame delta time in seconds
   * @param {THREE.Vector3} cameraTarget - Center of player focus
   */
  update(dt, cameraTarget) {
    // Advance in-game time (1 real minute = 1 in-game hour)
    this.timeOfDay = (this.timeOfDay + dt * this.timeScale) % 24.0;

    this.updateLighting();

    // Center weather around camera focus
    if (cameraTarget) {
      this.particleGroup.position.set(cameraTarget.x, 0, cameraTarget.z);
      this.skyMesh.position.set(cameraTarget.x, 0, cameraTarget.z);
    }

    // Animate falling weather particles
    for (const p of this.weatherParticles) {
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;

      if (p.mesh.position.y < 0) {
        p.mesh.position.y = 250;
        p.mesh.position.x = (Math.random() - 0.5) * 1200;
        p.mesh.position.z = (Math.random() - 0.5) * 1200;
      }
    }
  }

  updateLighting() {
    const hour = this.timeOfDay;
    // Solar Angle: 6:00 is sunrise (0 rad), 12:00 is noon (PI/2 rad), 18:00 is sunset (PI rad)
    const sunAngle = ((hour - 6.0) / 12.0) * Math.PI;
    const isDay = hour >= 5.5 && hour <= 18.5;

    const sunDist = 1200;
    const sunX = Math.cos(sunAngle) * sunDist;
    const sunY = Math.sin(sunAngle) * sunDist;
    const sunZ = 200; // Slight southern slant

    this.sunSprite.position.set(
      this.skyMesh.position.x + sunX,
      this.skyMesh.position.y + Math.max(-100, sunY),
      this.skyMesh.position.z + sunZ
    );

    let skyColor, sunColor, sunIntensity, hemiSky, hemiGround, fogColor;

    if (hour >= 6.0 && hour < 8.0) {
      // Himalayan Alpenglow / Golden Dawn
      const t = (hour - 6.0) / 2.0;
      skyColor = new THREE.Color().lerpColors(new THREE.Color(0x3a2e39), new THREE.Color(0xf4a261), t);
      sunColor = new THREE.Color(0xffaa5e);
      sunIntensity = 0.6 + t * 0.7;
      hemiSky = new THREE.Color(0xffd166);
      hemiGround = new THREE.Color(0x264653);
      fogColor = new THREE.Color(0xd4a373);
    } else if (hour >= 8.0 && hour < 16.5) {
      // Crisp Alpine Daylight
      skyColor = new THREE.Color(0x8ecae6);
      sunColor = new THREE.Color(0xfff3b0);
      sunIntensity = 1.45;
      hemiSky = new THREE.Color(0xffffff);
      hemiGround = new THREE.Color(0x3d405b);
      fogColor = new THREE.Color(0xcce3de);
    } else if (hour >= 16.5 && hour < 19.0) {
      // Fiery Himalayan Sunset
      const t = (hour - 16.5) / 2.5;
      skyColor = new THREE.Color().lerpColors(new THREE.Color(0x8ecae6), new THREE.Color(0x78290f), t);
      sunColor = new THREE.Color(0xe76f51);
      sunIntensity = 1.2 * (1.0 - t * 0.5);
      hemiSky = new THREE.Color(0xf4a261);
      hemiGround = new THREE.Color(0x1d3557);
      fogColor = new THREE.Color(0x9d4edd);
    } else {
      // Starry Indigo Himalayan Night
      skyColor = new THREE.Color(0x0b0d17);
      sunColor = new THREE.Color(0x8ecae6); // Moon Light
      sunIntensity = 0.35;
      hemiSky = new THREE.Color(0x1d3557);
      hemiGround = new THREE.Color(0x05070c);
      fogColor = new THREE.Color(0x0f111a);
    }

    this.skyMaterial.color.copy(skyColor);
    if (this.scene.fog) {
      this.scene.fog.color.copy(fogColor);
    }
    this.scene.background = skyColor;

    this.dirLight.color.copy(sunColor);
    this.dirLight.intensity = Math.max(0.2, sunIntensity);
    this.dirLight.position.set(sunX * 0.4, Math.max(80, sunY * 0.4), sunZ * 0.4);

    this.hemiLight.color.copy(hemiSky);
    this.hemiLight.groundColor.copy(hemiGround);

    this.sunSprite.visible = isDay;
  }

  getTimeFormatted() {
    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const padM = m < 10 ? `0${m}` : `${m}`;
    return `${displayH}:${padM} ${period}`;
  }
}
