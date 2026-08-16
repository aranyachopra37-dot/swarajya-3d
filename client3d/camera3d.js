// 3D RTS Physics-Damped Camera Controller for Swarajya (Three.js)
// Supports panoramic zoom-out to view the entire battlefield, adaptive pan speed, and smooth inertia.

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class RtsCamera3D {
  /**
   * @param {THREE.Camera} camera 
   * @param {HTMLElement} domElement 
   * @param {{width: number, height: number}} mapBounds 
   */
  constructor(camera, domElement, mapBounds = { width: 4000, height: 4000 }) {
    this.camera = camera;
    this.domElement = domElement;
    this.mapBounds = mapBounds;

    // Target focal point on the ground (X-Z plane)
    this.target = new THREE.Vector3(mapBounds.width / 2, 0, mapBounds.height / 2);
    this.targetVelocity = new THREE.Vector3(0, 0, 0);
    
    // Spherical orbit parameters with high-altitude panoramic range
    this.distance = 320;
    this.targetDistance = 320;
    this.minDistance = 50;
    this.maxDistance = 3500; // Allows full-map panoramic observation
    
    this.pitch = 55 * (Math.PI / 180);
    this.targetPitch = 55 * (Math.PI / 180);
    this.minPitch = 12 * (Math.PI / 180); // Low-angle cinematic vista
    this.maxPitch = 85 * (Math.PI / 180); // Top-down tactical view
    
    this.yaw = 0;
    this.targetYaw = 0;

    // Adaptive pan speed
    this.basePanSpeed = 420;
    this.keys = {
      KeyW: false, KeyS: false, KeyA: false, KeyD: false,
      ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false
    };
    
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };

    this._bindEvents();
    this.updatePosition();
  }

  _bindEvents() {
    window.addEventListener("keydown", (e) => {
      if (this.keys.hasOwnProperty(e.code)) {
        this.keys[e.code] = true;
      }
    });

    window.addEventListener("keyup", (e) => {
      if (this.keys.hasOwnProperty(e.code)) {
        this.keys[e.code] = false;
      }
    });

    this.domElement.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = 1 + Math.sign(e.deltaY) * 0.16;
      this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.targetDistance * zoomFactor));
    }, { passive: false });

    this.domElement.addEventListener("mousedown", (e) => {
      if (e.button === 1 || e.button === 2) { // Middle or Right click orbit
        this.isDragging = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };

        this.targetYaw -= dx * 0.0055;
        this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.targetPitch + dy * 0.0045));
      }
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });
  }

  /**
   * Jump camera directly to focus on an entity or position.
   */
  focusOn(x, z) {
    this.target.x = x;
    this.target.z = z;
    this.targetVelocity.set(0, 0, 0);
    this.updatePosition();
  }

  /**
   * Updates camera position from spherical parameters around the focal target.
   */
  updatePosition() {
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const cosYaw = Math.cos(this.yaw);
    const sinYaw = Math.sin(this.yaw);

    const cx = this.target.x + this.distance * cosPitch * sinYaw;
    const cy = this.target.y + this.distance * sinPitch;
    const cz = this.target.z + this.distance * cosPitch * cosYaw;

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
  }

  /**
   * Frame update with smooth inertial physics for camera motion.
   * @param {number} dt - Seconds elapsed since last render frame
   */
  update(dt) {
    // 1. Smooth interpolation for zoom and orbit angles
    const damp = Math.min(1.0, dt * 10.0);
    this.distance += (this.targetDistance - this.distance) * damp;
    this.pitch += (this.targetPitch - this.pitch) * damp;
    this.yaw += (this.targetYaw - this.yaw) * damp;

    // 2. Keyboard Input Direction
    let inputForward = 0;
    let inputRight = 0;

    if (this.keys.KeyW || this.keys.ArrowUp) inputForward += 1;
    if (this.keys.KeyS || this.keys.ArrowDown) inputForward -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) inputRight += 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) inputRight -= 1;

    // Adaptive speed: moving when zoomed out is faster
    const altitudeScale = Math.max(1.0, this.distance / 250.0);
    const currentSpeed = this.basePanSpeed * altitudeScale;

    if (inputForward !== 0 || inputRight !== 0) {
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const moveVec = new THREE.Vector3();
      moveVec.addScaledVector(forward, inputForward);
      moveVec.addScaledVector(right, inputRight);
      moveVec.normalize();

      this.targetVelocity.x = moveVec.x * currentSpeed;
      this.targetVelocity.z = moveVec.z * currentSpeed;
    } else {
      // Smooth friction deceleration
      const friction = Math.max(0, 1.0 - dt * 9.0);
      this.targetVelocity.x *= friction;
      this.targetVelocity.z *= friction;
    }

    this.target.x += this.targetVelocity.x * dt;
    this.target.z += this.targetVelocity.z * dt;

    // Map bounds clamping with generous panoramic margin
    const margin = this.distance * 0.4;
    const minX = -margin;
    const maxX = this.mapBounds.width + margin;
    const minZ = -margin;
    const maxZ = this.mapBounds.height + margin;

    this.target.x = Math.max(minX, Math.min(maxX, this.target.x));
    this.target.z = Math.max(minZ, Math.min(maxZ, this.target.z));

    this.updatePosition();
  }
}
