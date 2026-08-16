// 3D Ultra-Realistic Himalayan Alpine Environment, Majestic Tall Deodar Cedars & High-Performance Terrain for Swarajya (Three.js)

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
    this.groundTexture = null;
    this.groundBumpMap = null;
  }

  _createProceduralGroundTexture() {
    const { THREE } = this;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#3e5e3e";
    ctx.fillRect(0, 0, 512, 512);

    const imgData = ctx.getImageData(0, 0, 512, 512);
    const data = imgData.data;

    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4;
        
        // Multi-frequency fractal noise
        const n1 = Math.sin(x * 0.035) * Math.cos(y * 0.035);
        const n2 = Math.sin(x * 0.09 + y * 0.07) * 0.5;
        const n3 = Math.sin(x * 0.28 - y * 0.22) * 0.25;
        const nGrain = ((x * 19 + y * 47) % 29) / 29 - 0.5;
        const n = (n1 + n2 + n3) * 0.4 + nGrain * 0.35;

        let r = 62, g = 98, b = 60; // Lush alpine fescue grass
        if (n < -0.25) {
          // Rich loamy mountain peat / damp soil
          r = 75; g = 58; b = 46;
        } else if (n < 0.05) {
          // Dark forest moss undertone
          r = 48; g = 78; b = 48;
        } else if (n < 0.32) {
          // Vibrant sunny mountain grass
          r = 78; g = 120; b = 62;
        } else {
          // Alpine lichen / meadow turf
          r = 92; g = 135; b = 68;
        }

        // Natural slate pebble specs
        if ((x * 37 + y * 73) % 199 < 3) {
          r = 120; g = 125; b = 130;
        }

        data[i] = Math.max(0, Math.min(255, r + nGrain * 16));
        data[i + 1] = Math.max(0, Math.min(255, g + nGrain * 16));
        data[i + 2] = Math.max(0, Math.min(255, b + nGrain * 16));
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  _createProceduralGroundBumpMap() {
    const { THREE } = this;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(256, 256);
    const data = imgData.data;

    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const n1 = Math.sin(x * 0.08) * Math.cos(y * 0.08);
        const n2 = Math.sin(x * 0.22 + y * 0.18) * 0.5;
        const nGrain = ((x * 31 + y * 67) % 23) / 23;
        const val = Math.floor(Math.max(0, Math.min(255, 128 + (n1 + n2) * 55 + nGrain * 35)));
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  _createUnifiedTreeGeometry() {
    const { THREE } = this;
    const geometries = [];

    // 1. Weathered Cedar Bark Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.8, 1.4, 40, 5);
    trunkGeo.translate(0, 20, 0);
    const trunkColor = new THREE.Color(0x2e1f16);
    const trunkColors = new Float32Array(trunkGeo.attributes.position.count * 3);
    for (let i = 0; i < trunkGeo.attributes.position.count; i++) {
      trunkColors[i * 3] = trunkColor.r;
      trunkColors[i * 3 + 1] = trunkColor.g;
      trunkColors[i * 3 + 2] = trunkColor.b;
    }
    trunkGeo.setAttribute("color", new THREE.BufferAttribute(trunkColors, 3));
    geometries.push(trunkGeo);

    // 2. 4 Drooping Needle Tiers
    const tiers = [
      { r: 9.0, h: 15, y: 18, color: new THREE.Color(0x143423) },
      { r: 7.2, h: 13, y: 26, color: new THREE.Color(0x1b4332) },
      { r: 5.4, h: 11, y: 33, color: new THREE.Color(0x24553f) },
      { r: 3.6, h: 9, y: 39, color: new THREE.Color(0x2d6a4f) }
    ];

    tiers.forEach(t => {
      const cone = new THREE.ConeGeometry(t.r, t.h, 5);
      cone.translate(0, t.y, 0);
      const cols = new Float32Array(cone.attributes.position.count * 3);
      for (let i = 0; i < cone.attributes.position.count; i++) {
        cols[i * 3] = t.color.r;
        cols[i * 3 + 1] = t.color.g;
        cols[i * 3 + 2] = t.color.b;
      }
      cone.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      geometries.push(cone);
    });

    let totalVerts = 0;
    geometries.forEach(g => totalVerts += g.attributes.position.count);

    const mergedPos = new Float32Array(totalVerts * 3);
    const mergedNorm = new Float32Array(totalVerts * 3);
    const mergedCol = new Float32Array(totalVerts * 3);

    let offset = 0;
    geometries.forEach(g => {
      const p = g.attributes.position.array;
      const n = g.attributes.normal.array;
      const c = g.attributes.color.array;
      mergedPos.set(p, offset * 3);
      mergedNorm.set(n, offset * 3);
      mergedCol.set(c, offset * 3);
      offset += g.attributes.position.count;
    });

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute("position", new THREE.BufferAttribute(mergedPos, 3));
    mergedGeo.setAttribute("normal", new THREE.BufferAttribute(mergedNorm, 3));
    mergedGeo.setAttribute("color", new THREE.BufferAttribute(mergedCol, 3));
    return mergedGeo;
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

    this.groundTexture = this._createProceduralGroundTexture();
    this.groundBumpMap = this._createProceduralGroundBumpMap();

    const repeatScaleX = Math.max(12, w / 2);
    const repeatScaleY = Math.max(12, h / 2);
    this.groundTexture.repeat.set(repeatScaleX, repeatScaleY);
    this.groundBumpMap.repeat.set(repeatScaleX, repeatScaleY);

    // 1. Playable Terrain Mesh with Smooth Elevation Blending
    const segmentsX = w;
    const segmentsY = h;
    const geometry = new THREE.PlaneGeometry(worldW, worldH, segmentsX, segmentsY);
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position;
    const colorAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3);
    geometry.setAttribute("color", colorAttr);

    // Color definitions (Authentic Himalayan Nature Palette)
    const colorMeadow = new THREE.Color(0x3e6341);      // Deep valley meadow turf
    const colorMeadowSun = new THREE.Color(0x527e4e);   // Sunlit alpine grass
    const colorSoil = new THREE.Color(0x4a3b32);        // Rich loam & dirt path
    const colorHill = new THREE.Color(0x587854);        // High alpine plateau
    const colorSlateRock = new THREE.Color(0x424854);   // Dark slate granite crags
    const colorSnowCap = new THREE.Color(0xf4f7fa);     // Glacial snow peak
    const colorWaterBed = new THREE.Color(0x22333b);    // Silt riverbed
    const colorGoldEarth = new THREE.Color(0xc99355);   // Rich amber gold vein

    for (let i = 0; i < posAttr.count; i++) {
      const gx = Math.min(w - 1, Math.floor((i % (segmentsX + 1))));
      const gy = Math.min(h - 1, Math.floor(i / (segmentsX + 1)));
      const tileType = cells[gy * w + gx] !== undefined ? cells[gy * w + gx] : GROUND;

      let elevation = 0;
      let vertexColor = colorMeadow;

      if (tileType === HILL) {
        elevation = 24;
        vertexColor = colorHill;
      } else if (tileType === ROCK) {
        elevation = 56;
        vertexColor = colorSnowCap;
      } else if (tileType === WATER) {
        elevation = -4.5;
        vertexColor = colorWaterBed;
      } else if (tileType === GOLD) {
        elevation = 4;
        vertexColor = colorGoldEarth;
      } else {
        const n = Math.sin(gx * 0.4) * Math.cos(gy * 0.4);
        if (n > 0.3) vertexColor = colorMeadowSun;
        else if (n < -0.4) vertexColor = colorSoil;
        else vertexColor = colorMeadow;
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
      map: this.groundTexture,
      bumpMap: this.groundBumpMap,
      bumpScale: 0.75,
      roughness: 0.82,
      metalness: 0.05,
      flatShading: false,
    });

    this.terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    this.terrainMesh.position.set(worldW / 2, 0, worldH / 2);
    this.terrainMesh.receiveShadow = true;
    this.terrainGroup.add(this.terrainMesh);

    // 2. Extended Infinite Mountain Horizon Mesh
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

      const dx = Math.max(0, Math.abs(vx) - worldW / 2);
      const dz = Math.max(0, Math.abs(vz) - worldH / 2);
      const distFromEdge = Math.sqrt(dx * dx + dz * dz);

      let skirtElev = 0;
      let c = colorMeadow;

      if (distFromEdge > 10) {
        const distRatio = Math.min(1.0, distFromEdge / (worldW * 1.3));
        const ridgeFreq = Math.sin(vx * 0.0035) * Math.cos(vz * 0.0035);
        const cragDetail = Math.sin(vx * 0.016 + vz * 0.016) * 14;

        skirtElev = distRatio * (85 + ridgeFreq * 75) + cragDetail;
        if (skirtElev > 52) c = colorSnowCap;
        else if (skirtElev > 26) c = colorSlateRock;
        else c = colorHill;
      }

      skirtPos.setY(i, skirtElev);
      skirtCol.setXYZ(i, c.r, c.g, c.b);
    }

    skirtGeo.computeVertexNormals();
    const skirtMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.groundTexture,
      bumpMap: this.groundBumpMap,
      bumpScale: 0.6,
      roughness: 0.88,
      metalness: 0.04,
      flatShading: false,
    });
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.position.set(worldW / 2, 0, worldH / 2);
    skirtMesh.receiveShadow = true;
    this.terrainGroup.add(skirtMesh);

    // 3. Glacial Water System
    const waterGeo = new THREE.PlaneGeometry(skirtWidth, skirtHeight);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1a3a54,
      transparent: true,
      opacity: 0.85,
      roughness: 0.08,
      metalness: 0.85,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(worldW / 2, -1.8, worldH / 2);
    this.terrainGroup.add(waterMesh);

    // 4. Tall Himalayan Deodar Pines, Boulders, Gold Seams, and Grass Tufts
    const treePositions = [];
    const goldPositions = [];
    const boulderPositions = [];
    const grassTuftPositions = [];

    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const type = cells[ty * w + tx];
        const cx = (tx + 0.5) * TILE;
        const cz = (ty + 0.5) * TILE;

        if (type === FOREST) {
          // 2 dense tall trees per forest tile
          treePositions.push({ x: cx - 2.5, z: cz - 2.0, scale: 1.15, rot: (tx * 1.7) % 6.28 });
          treePositions.push({ x: cx + 2.5, z: cz + 2.0, scale: 0.95, rot: (ty * 2.3) % 6.28 });
        } else if (type === GOLD) {
          goldPositions.push({ x: cx, y: 4, z: cz });
        } else if (type === GROUND) {
          if ((tx * 13 + ty * 29) % 41 === 0) {
            boulderPositions.push({ x: cx + 4, y: 0, z: cz - 3 });
          }
          if ((tx * 17 + ty * 31) % 19 === 0) {
            grassTuftPositions.push({ x: cx - 4, z: cz + 3, scale: 1.0 });
          }
        }
      }
    }

    // 4A. TALL MULTI-TIER HIMALAYAN DEODAR CEDAR PINES (Single Unified InstancedMesh)
    if (treePositions.length > 0) {
      const unifiedTreeGeo = this._createUnifiedTreeGeometry();
      const treeMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.88,
        flatShading: true
      });
      const treeMesh = new THREE.InstancedMesh(unifiedTreeGeo, treeMat, treePositions.length);
      treeMesh.castShadow = true;
      treeMesh.receiveShadow = true;

      const dummy = new THREE.Object3D();
      treePositions.forEach((pos, i) => {
        const elev = this.getHeight(pos.x, pos.z);
        dummy.position.set(pos.x, elev, pos.z);
        dummy.scale.set(pos.scale, pos.scale, pos.scale);
        dummy.rotation.y = pos.rot;
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
        const elev = this.getHeight(pos.x, pos.z);
        dummy.position.set(pos.x, elev + 2, pos.z);
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
      const boulderGeo = new THREE.DodecahedronGeometry(2.8, 0);
      const boulderMat = new THREE.MeshStandardMaterial({ color: 0x545d6e, roughness: 0.95, flatShading: true });
      const boulderMesh = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderPositions.length);
      boulderMesh.castShadow = true;

      const dummy = new THREE.Object3D();
      boulderPositions.forEach((pos, i) => {
        const elev = this.getHeight(pos.x, pos.z);
        dummy.position.set(pos.x, elev + 1.2, pos.z);
        dummy.scale.set(1.0 + (i % 3) * 0.4, 0.75 + (i % 2) * 0.3, 1.1 + (i % 4) * 0.3);
        dummy.rotation.set((i * 1.2) % 3, (i * 0.8) % 3, 0);
        dummy.updateMatrix();
        boulderMesh.setMatrixAt(i, dummy.matrix);
      });
      boulderMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(boulderMesh);
    }

    // 4D. Instanced 3D Grass Tufts
    if (grassTuftPositions.length > 0) {
      const tuftGeo = new THREE.ConeGeometry(2.4, 4.2, 3);
      tuftGeo.translate(0, 2.1, 0);
      const tuftMat = new THREE.MeshStandardMaterial({ color: 0x5a8a4e, roughness: 0.9, flatShading: true });
      const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, grassTuftPositions.length);
      tuftMesh.castShadow = false;

      const dummy = new THREE.Object3D();
      grassTuftPositions.forEach((pos, i) => {
        const elev = this.getHeight(pos.x, pos.z);
        dummy.position.set(pos.x, elev, pos.z);
        dummy.scale.set(pos.scale * 0.9, pos.scale * 1.0, pos.scale * 0.9);
        dummy.rotation.y = (i * 1.7) % 6.28;
        dummy.updateMatrix();
        tuftMesh.setMatrixAt(i, dummy.matrix);
      });
      tuftMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(tuftMesh);
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
    if (tile === ROCK) return 56;
    if (tile === WATER) return -4.5;
    if (tile === GOLD) return 4;
    return 0;
  }
}
