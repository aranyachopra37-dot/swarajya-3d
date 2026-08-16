// 3D Ultra-Realistic Himalayan Alpine Environment, Majestic Tall Deodar Cedars & Boundless Horizon Terrain for Swarajya (Three.js)
// Features multi-octave procedural ground textures, bump mapping, smooth natural terrain relief,
// and 38-50 unit tall multi-tier Himalayan Deodar Pines (Cedrus deodara).

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

    // 1. High-Density Organic Terrain Mesh (Subdivided 2x for smooth rolling slopes)
    const segmentsX = w * 2;
    const segmentsY = h * 2;
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
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);

      // Convert world X, Z to grid tile float coordinates
      const fx = (vx + worldW / 2) / TILE;
      const fz = (vz + worldH / 2) / TILE;

      const gx0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
      const gy0 = Math.max(0, Math.min(h - 1, Math.floor(fz)));
      const gx1 = Math.min(w - 1, gx0 + 1);
      const gy1 = Math.min(h - 1, gy0 + 1);

      const rx = fx - gx0;
      const rz = fz - gy0;

      const t00 = cells[gy0 * w + gx0] ?? GROUND;
      const t10 = cells[gy0 * w + gx1] ?? GROUND;
      const t01 = cells[gy1 * w + gx0] ?? GROUND;
      const t11 = cells[gy1 * w + gx1] ?? GROUND;

      const getBaseElev = (t) => {
        if (t === HILL) return 24;
        if (t === ROCK) return 56;
        if (t === WATER) return -4.5;
        if (t === GOLD) return 4;
        return 0;
      };

      const e00 = getBaseElev(t00);
      const e10 = getBaseElev(t10);
      const e01 = getBaseElev(t01);
      const e11 = getBaseElev(t11);

      // Bilinear interpolation of terrain height
      const e0 = e00 + (e10 - e00) * rx;
      const e1 = e01 + (e11 - e01) * rx;
      let elevation = e0 + (e1 - e0) * rz;

      // Natural micro-terrain undulation on open ground
      const microRoll = Math.sin(fx * 1.8) * Math.cos(fz * 1.8) * 0.75 + Math.sin(fx * 4.2 + fz * 3.7) * 0.35;
      elevation += microRoll;

      if (elevation > 18) {
        const crag = Math.sin(fx * 3.1 + fz * 2.7) * 2.2 + Math.cos(fx * 7.5 - fz * 6.2) * 1.2;
        elevation += crag;
      }

      // Vertex color determination
      let vertexColor = colorMeadow;
      const centerTile = cells[gy0 * w + gx0] ?? GROUND;

      if (centerTile === WATER) {
        vertexColor = colorWaterBed;
      } else if (centerTile === GOLD) {
        vertexColor = colorGoldEarth;
      } else if (elevation > 46) {
        vertexColor = colorSnowCap;
      } else if (elevation > 22) {
        vertexColor = colorSlateRock;
      } else if (elevation > 10) {
        vertexColor = colorHill;
      } else {
        const n = Math.sin(fx * 2.4) * Math.cos(fz * 2.4);
        if (n > 0.3) vertexColor = colorMeadowSun;
        else if (n < -0.4) vertexColor = colorSoil;
        else vertexColor = colorMeadow;
      }

      posAttr.setY(i, elevation);
      colorAttr.setXYZ(i, vertexColor.r, vertexColor.g, vertexColor.b);
    }

    geometry.computeVertexNormals();

    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.groundTexture,
      bumpMap: this.groundBumpMap,
      bumpScale: 0.85,
      roughness: 0.82,
      metalness: 0.05,
      flatShading: false, // Smooth realistic natural slopes
    });

    this.terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    this.terrainMesh.position.set(worldW / 2, 0, worldH / 2);
    this.terrainMesh.receiveShadow = true;
    this.terrainGroup.add(this.terrainMesh);

    // 2. Extended Infinite Mountain Horizon Mesh
    const skirtWidth = worldW * 4.2;
    const skirtHeight = worldH * 4.2;
    const skirtSegsX = 96;
    const skirtSegsY = 96;
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
        const ridgeFreq = Math.sin(vx * 0.0032) * Math.cos(vz * 0.0032);
        const cragDetail = Math.sin(vx * 0.016 + vz * 0.016) * 14;

        skirtElev = distRatio * (85 + ridgeFreq * 75) + cragDetail;
        if (skirtElev > 52) {
          c = colorSnowCap;
        } else if (skirtElev > 26) {
          c = colorSlateRock;
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
      map: this.groundTexture,
      bumpMap: this.groundBumpMap,
      bumpScale: 0.65,
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
          // Spawn 2-3 dense tall trees per forest tile
          treePositions.push({ x: cx - 2.5, z: cz - 2.0, scale: 1.15, rot: (tx * 1.7) % 6.28 });
          treePositions.push({ x: cx + 3.0, z: cz + 2.5, scale: 0.95, rot: (ty * 2.3) % 6.28 });
          if ((tx + ty) % 2 === 0) {
            treePositions.push({ x: cx - 1.0, z: cz + 3.5, scale: 1.3, rot: (tx * 3.1) % 6.28 });
          }
        } else if (type === GOLD) {
          goldPositions.push({ x: cx, y: 4, z: cz });
        } else if (type === GROUND) {
          if ((tx * 13 + ty * 29) % 37 === 0) {
            boulderPositions.push({ x: cx + 4, y: 0, z: cz - 3 });
          }
          if ((tx * 17 + ty * 31) % 11 === 0) {
            grassTuftPositions.push({ x: cx - 4, z: cz + 3, scale: 1.0 });
            grassTuftPositions.push({ x: cx + 3, z: cz - 2, scale: 0.8 });
          }
        }
      }
    }

    // 4A. TALL MULTI-TIER HIMALAYAN DEODAR CEDAR PINES (Height: 38 - 52 units!)
    if (treePositions.length > 0) {
      const treeGroup = new THREE.Group();

      // Weathered Cedar Bark Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.8, 1.4, 40, 6);
      trunkGeo.translate(0, 20, 0);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2e1f16, roughness: 0.95 });
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
      trunkInst.castShadow = true;
      trunkInst.receiveShadow = true;

      // Tier 1 (Lowest Broad Needle Tier)
      const t1Geo = new THREE.ConeGeometry(9.0, 15, 6);
      t1Geo.translate(0, 18, 0);
      const needleMat1 = new THREE.MeshStandardMaterial({ color: 0x143423, roughness: 0.88, flatShading: true });
      const t1Inst = new THREE.InstancedMesh(t1Geo, needleMat1, treePositions.length);
      t1Inst.castShadow = true;

      // Tier 2 (Mid Tier)
      const t2Geo = new THREE.ConeGeometry(7.2, 13, 6);
      t2Geo.translate(0, 26, 0);
      const needleMat2 = new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.88, flatShading: true });
      const t2Inst = new THREE.InstancedMesh(t2Geo, needleMat2, treePositions.length);
      t2Inst.castShadow = true;

      // Tier 3 (Upper Tier)
      const t3Geo = new THREE.ConeGeometry(5.4, 11, 6);
      t3Geo.translate(0, 33, 0);
      const needleMat3 = new THREE.MeshStandardMaterial({ color: 0x24553f, roughness: 0.88, flatShading: true });
      const t3Inst = new THREE.InstancedMesh(t3Geo, needleMat3, treePositions.length);
      t3Inst.castShadow = true;

      // Tier 4 (Crown Needle Apex)
      const t4Geo = new THREE.ConeGeometry(3.6, 9, 6);
      t4Geo.translate(0, 39, 0);
      const needleMat4 = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.88, flatShading: true });
      const t4Inst = new THREE.InstancedMesh(t4Geo, needleMat4, treePositions.length);
      t4Inst.castShadow = true;

      const dummy = new THREE.Object3D();
      treePositions.forEach((pos, i) => {
        const elev = this.getHeight(pos.x, pos.z);
        dummy.position.set(pos.x, elev, pos.z);
        dummy.scale.set(pos.scale, pos.scale, pos.scale);
        dummy.rotation.y = pos.rot;
        dummy.updateMatrix();

        trunkInst.setMatrixAt(i, dummy.matrix);
        t1Inst.setMatrixAt(i, dummy.matrix);
        t2Inst.setMatrixAt(i, dummy.matrix);
        t3Inst.setMatrixAt(i, dummy.matrix);
        t4Inst.setMatrixAt(i, dummy.matrix);
      });

      trunkInst.instanceMatrix.needsUpdate = true;
      t1Inst.instanceMatrix.needsUpdate = true;
      t2Inst.instanceMatrix.needsUpdate = true;
      t3Inst.instanceMatrix.needsUpdate = true;
      t4Inst.instanceMatrix.needsUpdate = true;

      this.terrainGroup.add(trunkInst);
      this.terrainGroup.add(t1Inst);
      this.terrainGroup.add(t2Inst);
      this.terrainGroup.add(t3Inst);
      this.terrainGroup.add(t4Inst);
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

    // 4D. Instanced 3D Grass Tufts & Wildflower Clusters
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
        dummy.scale.set(pos.scale * (0.8 + (i % 3) * 0.2), pos.scale * (0.9 + (i % 2) * 0.3), pos.scale);
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
