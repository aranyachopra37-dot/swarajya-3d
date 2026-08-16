// 3D Terrain & Environment Renderer for Swarajya (Three.js)
// Generates stylized Himalayan terrain, water bodies, gold seams, and pine forests.

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

    // 1. Base Terrain Mesh with Heightmap deformation
    const segmentsX = w;
    const segmentsY = h;
    const geometry = new THREE.PlaneGeometry(worldW, worldH, segmentsX, segmentsY);
    geometry.rotateX(-Math.PI / 2); // Lay flat on X-Z plane

    const posAttr = geometry.attributes.position;
    const colorAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3);
    geometry.setAttribute("color", colorAttr);

    // Color definitions (Himalayan alpine palette)
    const colorGround = new THREE.Color(0x3a5a40); // Mountain grass
    const colorHill = new THREE.Color(0x588157);   // High meadow
    const colorRock = new THREE.Color(0x4a4e69);   // Slate stone
    const colorWater = new THREE.Color(0x22577a);  // Cold river
    const colorGold = new THREE.Color(0xd4a373);   // Copper-gold earth

    for (let i = 0; i < posAttr.count; i++) {
      const gx = Math.min(w - 1, Math.floor((i % (segmentsX + 1))));
      const gy = Math.min(h - 1, Math.floor(i / (segmentsX + 1)));
      const tileType = cells[gy * w + gx] !== undefined ? cells[gy * w + gx] : GROUND;

      let elevation = 0;
      let vertexColor = colorGround;

      if (tileType === HILL) {
        elevation = 10;
        vertexColor = colorHill;
      } else if (tileType === ROCK) {
        elevation = 16;
        vertexColor = colorRock;
      } else if (tileType === WATER) {
        elevation = -3;
        vertexColor = colorWater;
      } else if (tileType === GOLD) {
        elevation = 3;
        vertexColor = colorGold;
      }

      posAttr.setY(i, elevation);
      colorAttr.setXYZ(i, vertexColor.r, vertexColor.g, vertexColor.b);
    }

    geometry.computeVertexNormals();

    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true,
    });

    this.terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    this.terrainMesh.position.set(worldW / 2, 0, worldH / 2);
    this.terrainMesh.receiveShadow = true;
    this.terrainGroup.add(this.terrainMesh);

    // 2. Water Stream Mesh
    const waterGeo = new THREE.PlaneGeometry(worldW, worldH);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1d3557,
      transparent: true,
      opacity: 0.75,
      roughness: 0.1,
      metalness: 0.6,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(worldW / 2, -1.2, worldH / 2);
    this.terrainGroup.add(waterMesh);

    // 3. Environmental Props Placement
    const treePositions = [];
    const goldPositions = [];

    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const type = cells[ty * w + tx];
        const cx = (tx + 0.5) * TILE;
        const cz = (ty + 0.5) * TILE;

        if (type === FOREST) {
          treePositions.push({ x: cx, y: 0, z: cz });
        } else if (type === GOLD) {
          goldPositions.push({ x: cx, y: 3, z: cz });
        }
      }
    }

    // 3A. Instanced Pine / Deodar Trees
    if (treePositions.length > 0) {
      const treeConeGeo = new THREE.ConeGeometry(5, 14, 5);
      treeConeGeo.translate(0, 7, 0);

      const treeMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9, flatShading: true });
      const treeMesh = new THREE.InstancedMesh(treeConeGeo, treeMat, treePositions.length);
      treeMesh.castShadow = true;
      treeMesh.receiveShadow = true;

      const dummy = new THREE.Object3D();
      treePositions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.scale.set(0.9 + (i % 3) * 0.2, 0.9 + (i % 4) * 0.2, 0.9 + (i % 3) * 0.2);
        dummy.rotation.y = (i * 1.37) % (Math.PI * 2);
        dummy.updateMatrix();
        treeMesh.setMatrixAt(i, dummy.matrix);
      });
      treeMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(treeMesh);
    }

    // 3B. Instanced Gold Crystal Formations
    if (goldPositions.length > 0) {
      const goldGeo = new THREE.DodecahedronGeometry(3.5, 0);
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffb703,
        roughness: 0.3,
        metalness: 0.85,
        emissive: 0xd4a373,
        emissiveIntensity: 0.2,
      });
      const goldMesh = new THREE.InstancedMesh(goldGeo, goldMat, goldPositions.length);
      goldMesh.castShadow = true;

      const dummy = new THREE.Object3D();
      goldPositions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.rotation.set((i * 0.7) % 3, (i * 1.1) % 3, (i * 0.5) % 3);
        dummy.scale.set(1.1, 1.3, 1.1);
        dummy.updateMatrix();
        goldMesh.setMatrixAt(i, dummy.matrix);
      });
      goldMesh.instanceMatrix.needsUpdate = true;
      this.terrainGroup.add(goldMesh);
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
    if (tile === HILL) return 10;
    if (tile === ROCK) return 16;
    if (tile === WATER) return -3;
    if (tile === GOLD) return 3;
    return 0;
  }
}
