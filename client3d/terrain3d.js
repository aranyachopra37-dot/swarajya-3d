// 3D Realistic Himalayan Alpine Environment & Boundless Horizon Terrain for Swarajya (Three.js)
// Features playable terrain + Extended Outer Mountain Ranges & Snowy Horizon Skirt.

import { TILE, GROUND, ROCK, WATER, FOREST, HILL, GOLD } from "../dominion/grid.js";

export class Terrain3D {
  /**
   * @param {THREE.Scene} scene 
   * @param {THREE} THREE 
   */
  constructor(scene, THREE) {
    this.scene = scene;
    this.THREE = THREE;
    this.terrainGroup = new THREE.Group();
    this.scene.add(this.terrainGroup);

    this.grid = null;
    this.forestInstanced = null;
    this.goldInstanced = null;
    this.rockInstanced = null;
  }

  /**
   * Builds the 3D terrain from a grid instance.
   * @param {import('../dominion/grid.js').Grid} grid 
   */
  build(grid) {
    this.grid = grid;
    const { THREE } = this;
    const { w, h, cells } = grid;
    const worldW = w * TILE;
    const worldH = h * TILE;

    // 1. Primary Playable Terrain Mesh with Realistic Alpine Heightmap
    const segmentsX = w;
    const segmentsY = h;
    const geometry = new THREE.PlaneGeometry(worldW, worldH, segmentsX, segmentsY);
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position;
    const colorAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3);
    geometry.setAttribute("color", colorAttr);

    // Color definitions (Realistic Himalayan Alpine Palette)
    const colorMeadow = new THREE.Color(0x3a5a40);     // Lush lower valley meadow
    const colorMeadowLight = new THREE.Color(0x4f772d);// Sunny grass patch
    const colorHill = new THREE.Color(0x588157);       // Mid alpine terrace
    const colorSlateRock = new THREE.Color(0x4a4e69);  // Slate stone rock face
    const colorSnowCap = new THREE.Color(0xf8f9fa);    // Glacial snow peak
    const colorWater = new THREE.Color(0x1d3557);      // Mountain glacial stream
    const colorGold = new THREE.Color(0xd4a373);       // Copper-gold earth

    for (let i = 0; i < posAttr.count; i++) {
      const gx = Math.min(w - 1, Math.floor((i % (segmentsX + 1))));
      const gy = Math.min(h - 1, Math.floor(i / (segmentsX + 1)));
      const tileType = cells[gy * w + gx] !== undefined ? cells[gy * w + gx] : GROUND;

      let elevation = 0;
      let vertexColor = colorMeadow;

      if (tileType === HILL) {
        elevation = 24; // Mid-elevation terrace
        vertexColor = colorHill;
      } else if (tileType === ROCK) {
        elevation = 54; // Towering Himalayan Mountain Peak
        vertexColor = colorSnowCap; // Pure snow summit
      } else if (tileType === WATER) {
        elevation = -4.5;
        vertexColor = colorWater;
      } else if (tileType === GOLD) {
        elevation = 4;
        vertexColor = colorGold;
      } else {
        const noise = ((gx * 17 + gy * 31) % 5);
        vertexColor = noise > 2 ? colorMeadowLight : colorMeadow;
      }

      if (elevation > 20) {
        const crag = ((gx * 23 + gy * 47) % 11) * 0.9;
        elevation += crag;
      }

      posAttr.setY(i, elevation);
      colorAttr.setXYZ(i, vertexColor.r, vertexColor.g, vertexColor.b);
    }

    geometry.computeVertexNormals();

    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.08,
      flatShading: true,
    });

    this.terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    this.terrainMesh.position.set(worldW / 2, 0, worldH / 2);
    this.terrainMesh.receiveShadow = true;
    this.terrainGroup.add(this.terrainMesh);

    // 2. Extended Infinite Mountain Horizon Mesh (Surrounds the map boundary)
    const skirtWidth = worldW * 4.0;
    const skirtHeight = worldH * 4.0;
    const skirtSegsX = 64;
    const skirtSegsY = 64;
    const skirtGeo = new THREE.PlaneGeometry(skirtWidth, skirtHeight, skirtSegsX, skirtSegsY);
    skirtGeo.rotateX(-Math.PI / 2);

    const skirtPos = skirtGeo.attributes.position;
    const skirtCol = new THREE.BufferAttribute(new Float32Array(skirtPos.count * 3), 3);
    skirtGeo.setAttribute("color", skirtCol);

    for (let i = 0; i < skirtPos.count; i++) {
      const vx = skirtPos.getX(i);
      const vz = skirtPos.getZ(i);

      // Distance outside the playable map bounding box
      const dx = Math.max(0, Math.abs(vx) - worldW / 2);
      const dz = Math.max(0, Math.abs(vz) - worldH / 2);
      const distFromEdge = Math.sqrt(dx * dx + dz * dz);

      let skirtElev = 0;
      let c = colorMeadow;

      if (distFromEdge > 10) {
        // Build towering outer Himalayan mountain ridges that rise into the distance
        const distRatio = Math.min(1.0, distFromEdge / (worldW * 1.2));
        const ridgeFreq = Math.sin(vx * 0.0035) * Math.cos(vz * 0.0035);
        const cragDetail = Math.sin(vx * 0.015 + vz * 0.015) * 12;

        skirtElev = distRatio * (75 + ridgeFreq * 65) + cragDetail;
        if (skirtElev > 50) {
          c = colorSnowCap; // Glacial snowy mountain summits
        } else if (skirtElev > 25) {
          c = colorSlateRock; // Steep granite rock ridges
        } else {
          c = colorHill;
        }
      }

      skirtPos.setY(i, skirtElev);
      skirtCol.setXYZ(i, c.r, c.g, c.b);
    }

    skirtGeo.computeVertexNormals();
    const skirtMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.position.set(worldW / 2, 0, worldH / 2);
    skirtMesh.receiveShadow = true;
    this.terrainGroup.add(skirtMesh);

    // 3. Glacial Water System (Extended)
    const waterGeo = new THREE.PlaneGeometry(skirtWidth, skirtHeight);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1d3557,
      transparent: true,
      opacity: 0.82,
      roughness: 0.08,
      metalness: 0.7,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(worldW / 2, -1.8, worldH / 2);
    this.terrainGroup.add(waterMesh);

    // 4. Environmental Props (Pines, Boulders, Gold Seams, Bushes)
    const treePositions = [];
    const goldPositions = [];
    const boulderPositions = [];
    const bushPositions = [];

    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const type = cells[ty * w + tx];
        const cx = (tx + 0.5) * TILE;
        const cz = (ty + 0.5) * TILE;

        if (type === FOREST) {
          treePositions.push({ x: cx, y: 0, z: cz });
        } else if (type === GOLD) {
          goldPositions.push({ x: cx, y: 4, z: cz });
        } else if (type === GROUND && (tx * 13 + ty * 29) % 37 === 0) {
          boulderPositions.push({ x: cx + 4, y: 0, z: cz - 3 });
        } else if (type === GROUND && (tx * 19 + ty * 31) % 43 === 0) {
          bushPositions.push({ x: cx - 5, y: 0, z: cz + 4 });
        }
      }
    }

    // 4A. Instanced Multi-Tier Deodar Pines
    if (treePositions.length > 0) {
      const treeGroupGeo = new THREE.ConeGeometry(5.4, 18, 5);
      treeGroupGeo.translate(0, 9, 0);

      const treeMat = new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.92, flatShading: true });
      const treeMesh = new THREE.InstancedMesh(treeGroupGeo, treeMat, treePositions.length);
      treeMesh.castShadow = true;
      treeMesh.receiveShadow = true;

      const dummy = new THREE.Object3D();
      treePositions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.scale.set(0.9 + (i % 3) * 0.25, 0.95 + (i % 4) * 0.2, 0.9 + (i % 3) * 0.25);
        dummy.rotation.y = (i * 1.37) % (Math.PI * 2);
        dummy.updateMatrix();
        treeMesh.setMatrixAt(i, dummy.matrix);
      });
      treeMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(treeMesh);
    }

    // 4B. Instanced Glowing Gold Ore Seams
    if (goldPositions.length > 0) {
      const goldGeo = new THREE.DodecahedronGeometry(4.2, 0);
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffb703,
        roughness: 0.25,
        metalness: 0.9,
        emissive: 0xd4a373,
        emissiveIntensity: 0.45,
      });
      const goldMesh = new THREE.InstancedMesh(goldGeo, goldMat, goldPositions.length);
      goldMesh.castShadow = true;

      const dummy = new THREE.Object3D();
      goldPositions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.rotation.set((i * 0.7) % 3, (i * 1.1) % 3, (i * 0.5) % 3);
        dummy.scale.set(1.2, 1.4, 1.2);
        dummy.updateMatrix();
        goldMesh.setMatrixAt(i, dummy.matrix);
      });
      goldMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(goldMesh);
    }

    // 4C. Instanced Granite Boulders
    if (boulderPositions.length > 0) {
      const boulderGeo = new THREE.DodecahedronGeometry(2.6, 0);
      const boulderMat = new THREE.MeshStandardMaterial({ color: 0x5c677d, roughness: 0.95, flatShading: true });
      const boulderMesh = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderPositions.length);
      boulderMesh.castShadow = true;

      const dummy = new THREE.Object3D();
      boulderPositions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y + 1, pos.z);
        dummy.scale.set(1.0 + (i % 3) * 0.3, 0.7 + (i % 2) * 0.2, 1.1 + (i % 4) * 0.2);
        dummy.rotation.set((i * 1.2) % 3, (i * 0.8) % 3, 0);
        dummy.updateMatrix();
        boulderMesh.setMatrixAt(i, dummy.matrix);
      });
      boulderMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(boulderMesh);
    }

    // 4D. Instanced Mountain Shrub Bushes
    if (bushPositions.length > 0) {
      const bushGeo = new THREE.SphereGeometry(2.4, 5, 4);
      const bushMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9, flatShading: true });
      const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, bushPositions.length);
      bushMesh.castShadow = true;

      const dummy = new THREE.Object3D();
      bushPositions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y + 1.2, pos.z);
        dummy.scale.set(1.1 + (i % 2) * 0.3, 0.7, 1.1 + (i % 3) * 0.2);
        dummy.updateMatrix();
        bushMesh.setMatrixAt(i, dummy.matrix);
      });
      bushMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(bushMesh);
    }
  }

  /**
   * Queries terrain height at any world coordinates (X, Z).
   * @param {number} worldX 
   * @param {number} worldZ 
   * @returns {number} Elevation in 3D world units
   */
  getHeight(worldX, worldZ) {
    if (!this.grid) return 0;
    const tx = Math.max(0, Math.min(this.grid.w - 1, Math.floor(worldX / TILE)));
    const ty = Math.max(0, Math.min(this.grid.h - 1, Math.floor(worldZ / TILE)));
    const tile = this.grid.cells[ty * this.grid.w + tx];
    if (tile === HILL) return 24;
    if (tile === ROCK) return 54;
    if (tile === WATER) return -4.5;
    if (tile === GOLD) return 4;
    return 0;
  }
}
