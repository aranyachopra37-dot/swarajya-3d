// High-Fidelity 3D Entity & Architecture Renderer for Swarajya (Three.js)
// Supports realistic terrain height alignment, physical gravity trajectories, and distinct equipment.

import { TILE } from "../dominion/grid.js";
import { lutTrig } from "./lut_trig.js";

// Player Theme Colors (Himalayan Palette)
export const OWNER_COLORS = [
  0xf4a261, // Player 0: Saffron Gold
  0xe63946, // Player 1: Crimson Red
  0x457b9d, // Player 2: Himalayan Indigo
  0x2a9d8f, // Player 3: Jade Green
];

export class Render3D {
  /**
   * @param {THREE.Scene} scene 
   * @param {THREE} THREE 
   * @param {import('./terrain3d.js').Terrain3D} terrain
   */
  constructor(scene, THREE, terrain = null) {
    this.scene = scene;
    this.THREE = THREE;
    this.terrain = terrain;

    this.unitMeshes = new Map();       // unitId -> THREE.Group
    this.buildingMeshes = new Map();   // buildingId -> THREE.Group
    this.siteMeshes = new Map();       // siteId -> THREE.Group
    this.projectileMeshes = new Map(); // projKey -> THREE.Mesh
    
    this.entityGroup = new THREE.Group();
    this.scene.add(this.entityGroup);

    this._initSharedMaterials();
  }

  setTerrain(terrain) {
    this.terrain = terrain;
  }

  _initSharedMaterials() {
    const { THREE } = this;
    this.materials = {
      wood: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.75 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.8 }),
      cedarTimber: new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.7 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x8a929a, roughness: 0.85 }),
      stoneDark: new THREE.MeshStandardMaterial({ color: 0x3d434d, roughness: 0.9 }),
      roofSlate: new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.5 }),
      roofGold: new THREE.MeshStandardMaterial({ color: 0xd4a373, metalness: 0.7, roughness: 0.35 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2f3542, metalness: 0.85, roughness: 0.3 }),
      bronzeArmor: new THREE.MeshStandardMaterial({ color: 0xc8963e, metalness: 0.75, roughness: 0.3 }),
      furBear: new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.95 }),
      fieldWheat: new THREE.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.8 }),
      scaffolding: new THREE.MeshStandardMaterial({ color: 0xd4a373, wireframe: true }),
      ownerMaterials: OWNER_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 })),
      ownerRings: OWNER_COLORS.map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })),
      selectionRing: new THREE.MeshBasicMaterial({ color: 0x7fd48f, side: THREE.DoubleSide }),
      projectileArrow: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4 }),
      projectileStone: new THREE.MeshStandardMaterial({ color: 0x57606f, roughness: 0.9 }),
    };
  }

  render(sim, alpha, selection = new Set()) {
    this._renderBuildings(sim, selection);
    this._renderSites(sim, selection);
    this._renderUnits(sim, alpha, selection);
    this._renderProjectiles(sim, alpha);
  }

  // --- BUILDINGS -------------------------------------------------------------

  _renderBuildings(sim, selection) {
    const activeIds = new Set();

    for (const b of sim.buildings) {
      activeIds.add(b.id);
      let mesh = this.buildingMeshes.get(b.id);

      if (!mesh) {
        mesh = this._createBuildingMesh(b);
        this.buildingMeshes.set(b.id, mesh);
        this.entityGroup.add(mesh);
      }

      const tiles = b.spec ? b.spec.tiles : 2;
      const bx = (b.tx + tiles / 2) * TILE;
      const bz = (b.ty + tiles / 2) * TILE;
      const elev = this.terrain ? this.terrain.getHeight(bx, bz) : 0;
      mesh.position.set(bx, elev, bz);

      const selRing = mesh.getObjectByName("selectionRing");
      if (selRing) {
        selRing.visible = selection.has(b.id);
      }
    }

    for (const [id, mesh] of this.buildingMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.entityGroup.remove(mesh);
        this.buildingMeshes.delete(id);
      }
    }
  }

  _renderSites(sim, selection) {
    const { THREE } = this;
    const activeIds = new Set();
    const sites = sim.sites || [];

    for (const s of sites) {
      activeIds.add(s.id);
      let mesh = this.siteMeshes.get(s.id);

      if (!mesh) {
        const size = (s.spec ? s.spec.tiles : 2) * TILE;
        const geo = new THREE.BoxGeometry(size * 0.92, 8, size * 0.92);
        mesh = new THREE.Mesh(geo, this.materials.scaffolding);
        this.siteMeshes.set(s.id, mesh);
        this.entityGroup.add(mesh);
      }

      const tiles = s.spec ? s.spec.tiles : 2;
      const sx = (s.tx + tiles / 2) * TILE;
      const sz = (s.ty + tiles / 2) * TILE;
      const elev = this.terrain ? this.terrain.getHeight(sx, sz) : 0;
      mesh.position.set(sx, elev + 4, sz);
    }

    for (const [id, mesh] of this.siteMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.entityGroup.remove(mesh);
        this.siteMeshes.delete(id);
      }
    }
  }

  _createBuildingMesh(b) {
    const { THREE } = this;
    const group = new THREE.Group();
    const tiles = b.spec ? b.spec.tiles : 2;
    const size = tiles * TILE;
    const half = size / 2;
    const bType = b.spec ? b.spec.id : "generic";

    const ownerMat = this.materials.ownerMaterials[b.owner] || this.materials.wood;

    if (bType === "manor") {
      // Asana Pagoda Manor
      const baseGeo = new THREE.BoxGeometry(size * 0.88, 16, size * 0.88);
      const baseMesh = new THREE.Mesh(baseGeo, this.materials.stone);
      baseMesh.position.y = 8;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      group.add(baseMesh);

      const midGeo = new THREE.BoxGeometry(size * 0.68, 14, size * 0.68);
      const midMesh = new THREE.Mesh(midGeo, this.materials.cedarTimber);
      midMesh.position.y = 21;
      midMesh.castShadow = true;
      group.add(midMesh);

      const roof1Geo = new THREE.ConeGeometry(size * 0.78, 8, 4);
      roof1Geo.rotateY(Math.PI / 4);
      const roof1Mesh = new THREE.Mesh(roof1Geo, this.materials.roofSlate);
      roof1Mesh.position.y = 27;
      roof1Mesh.castShadow = true;
      group.add(roof1Mesh);

      const topGeo = new THREE.BoxGeometry(size * 0.44, 10, size * 0.44);
      const topMesh = new THREE.Mesh(topGeo, this.materials.woodDark);
      topMesh.position.y = 33;
      group.add(topMesh);

      const roof2Geo = new THREE.ConeGeometry(size * 0.52, 9, 4);
      roof2Geo.rotateY(Math.PI / 4);
      const roof2Mesh = new THREE.Mesh(roof2Geo, this.materials.roofGold);
      roof2Mesh.position.y = 40;
      roof2Mesh.castShadow = true;
      group.add(roof2Mesh);

      const mastGeo = new THREE.CylinderGeometry(0.5, 0.5, 16);
      const mast = new THREE.Mesh(mastGeo, this.materials.iron);
      mast.position.y = 48;
      group.add(mast);

      const pennantGeo = new THREE.PlaneGeometry(10, 6);
      const pennant = new THREE.Mesh(pennantGeo, ownerMat);
      pennant.position.set(5, 51, 0);
      group.add(pennant);

    } else if (bType === "warehouse") {
      const storeGeo = new THREE.BoxGeometry(size * 0.84, 14, size * 0.84);
      const storeMesh = new THREE.Mesh(storeGeo, this.materials.stoneDark);
      storeMesh.position.y = 7;
      storeMesh.castShadow = true;
      group.add(storeMesh);

      const roofGeo = new THREE.ConeGeometry(size * 0.7, 10, 4);
      roofGeo.rotateY(Math.PI / 4);
      const roofMesh = new THREE.Mesh(roofGeo, this.materials.roofGold);
      roofMesh.position.y = 18;
      roofMesh.castShadow = true;
      group.add(roofMesh);

    } else if (bType === "barracks") {
      const floorGeo = new THREE.BoxGeometry(size * 0.88, 4, size * 0.88);
      const floorMesh = new THREE.Mesh(floorGeo, this.materials.stone);
      floorMesh.position.y = 2;
      group.add(floorMesh);

      const pillarGeo = new THREE.CylinderGeometry(1.4, 1.4, 16);
      for (const [px, pz] of [[-half * 0.65, -half * 0.65], [half * 0.65, -half * 0.65], [-half * 0.65, half * 0.65], [half * 0.65, half * 0.65]]) {
        const pillar = new THREE.Mesh(pillarGeo, this.materials.cedarTimber);
        pillar.position.set(px, 10, pz);
        pillar.castShadow = true;
        group.add(pillar);
      }

      const roofGeo = new THREE.ConeGeometry(size * 0.74, 9, 4);
      roofGeo.rotateY(Math.PI / 4);
      const roofMesh = new THREE.Mesh(roofGeo, this.materials.roofSlate);
      roofMesh.position.y = 21;
      roofMesh.castShadow = true;
      group.add(roofMesh);

    } else if (bType === "farm") {
      const wallGeo = new THREE.BoxGeometry(size * 0.92, 3, size * 0.92);
      const wallMesh = new THREE.Mesh(wallGeo, this.materials.stone);
      wallMesh.position.y = 1.5;
      group.add(wallMesh);

      const fieldGeo = new THREE.BoxGeometry(size * 0.84, 2, size * 0.84);
      const fieldMesh = new THREE.Mesh(fieldGeo, this.materials.fieldWheat);
      fieldMesh.position.y = 3;
      group.add(fieldMesh);

    } else if (bType === "tower") {
      const towerGeo = new THREE.CylinderGeometry(4.5, 6.5, 32, 8);
      const towerMesh = new THREE.Mesh(towerGeo, this.materials.stone);
      towerMesh.position.y = 16;
      towerMesh.castShadow = true;
      group.add(towerMesh);

      const capGeo = new THREE.ConeGeometry(7, 8, 8);
      const capMesh = new THREE.Mesh(capGeo, this.materials.roofSlate);
      capMesh.position.y = 35;
      capMesh.castShadow = true;
      group.add(capMesh);

    } else if (bType === "bastion") {
      const fortGeo = new THREE.BoxGeometry(size * 0.94, 24, size * 0.94);
      const fortMesh = new THREE.Mesh(fortGeo, this.materials.stone);
      fortMesh.position.y = 12;
      fortMesh.castShadow = true;
      group.add(fortMesh);

      const towerGeo = new THREE.CylinderGeometry(7, 8, 16, 8);
      const towerMesh = new THREE.Mesh(towerGeo, this.materials.stoneDark);
      towerMesh.position.y = 29;
      towerMesh.castShadow = true;
      group.add(towerMesh);

    } else if (bType === "lair") {
      const ringGeo = new THREE.CylinderGeometry(half * 0.9, half * 0.9, 12, 16);
      const ringMesh = new THREE.Mesh(ringGeo, this.materials.stoneDark);
      ringMesh.position.y = 6;
      ringMesh.castShadow = true;
      group.add(ringMesh);

      const spireGeo = new THREE.ConeGeometry(half * 0.8, 16, 8);
      const spireMesh = new THREE.Mesh(spireGeo, this.materials.roofGold);
      spireMesh.position.y = 18;
      spireMesh.castShadow = true;
      group.add(spireMesh);

    } else if (bType === "factory") {
      const gantryGeo = new THREE.BoxGeometry(size * 0.88, 16, size * 0.88);
      const gantryMesh = new THREE.Mesh(gantryGeo, this.materials.woodDark);
      gantryMesh.position.y = 8;
      gantryMesh.castShadow = true;
      group.add(gantryMesh);

      const chimneyGeo = new THREE.CylinderGeometry(2, 3, 14, 8);
      const chimneyMesh = new THREE.Mesh(chimneyGeo, this.materials.iron);
      chimneyMesh.position.set(half * 0.4, 18, half * 0.4);
      group.add(chimneyMesh);

    } else {
      const boxGeo = new THREE.BoxGeometry(size * 0.8, 12, size * 0.8);
      const boxMesh = new THREE.Mesh(boxGeo, this.materials.stone);
      boxMesh.position.y = 6;
      boxMesh.castShadow = true;
      group.add(boxMesh);
    }

    const ringGeo = new THREE.RingGeometry(half * 1.05, half * 1.25, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeo, this.materials.selectionRing);
    ringMesh.name = "selectionRing";
    ringMesh.position.y = 0.25;
    ringMesh.visible = false;
    group.add(ringMesh);

    return group;
  }

  // --- UNITS -----------------------------------------------------------------

  _renderUnits(sim, alpha, selection) {
    const activeIds = new Set();

    for (const u of sim.units) {
      activeIds.add(u.id);
      let mesh = this.unitMeshes.get(u.id);

      if (!mesh) {
        mesh = this._createUnitMesh(u);
        this.unitMeshes.set(u.id, mesh);
        this.entityGroup.add(mesh);
      }

      const prevX = u.prevX !== undefined ? u.prevX : u.x;
      const prevY = u.prevY !== undefined ? u.prevY : u.y;
      const curX = prevX + (u.x - prevX) * alpha;
      const curZ = prevY + (u.y - prevY) * alpha;

      const elev = this.terrain ? this.terrain.getHeight(curX, curZ) : 0;
      mesh.position.set(curX, elev, curZ);

      if (u.heading !== undefined) {
        const [cosH, sinH] = lutTrig(u.heading);
        mesh.rotation.y = Math.atan2(sinH, cosH);
      }

      const selRing = mesh.getObjectByName("selectionRing");
      if (selRing) {
        selRing.visible = selection.has(u.id);
      }
    }

    for (const [id, mesh] of this.unitMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.entityGroup.remove(mesh);
        this.unitMeshes.delete(id);
      }
    }
  }

  _createUnitMesh(u) {
    const { THREE } = this;
    const group = new THREE.Group();
    const ownerMat = this.materials.ownerMaterials[u.owner] || this.materials.ownerMaterials[0];
    const ownerRingMat = this.materials.ownerRings[u.owner] || this.materials.ownerRings[0];
    const r = u.radius || 6;
    const uType = u.spec ? u.spec.id : u.type;

    if (uType === "cart") {
      const cartBed = new THREE.BoxGeometry(11, 4, 7.5);
      const bedMesh = new THREE.Mesh(cartBed, this.materials.wood);
      bedMesh.position.y = 4.5;
      bedMesh.castShadow = true;
      group.add(bedMesh);

      const wheelGeo = new THREE.CylinderGeometry(3.5, 3.5, 1.6, 12);
      wheelGeo.rotateZ(Math.PI / 2);
      const w1 = new THREE.Mesh(wheelGeo, this.materials.woodDark);
      w1.position.set(0, 3.5, 4.4);
      group.add(w1);
      const w2 = new THREE.Mesh(wheelGeo, this.materials.woodDark);
      w2.position.set(0, 3.5, -4.4);
      group.add(w2);

    } else if (uType === "guardian") {
      const bodyGeo = new THREE.CylinderGeometry(3.5, 4.2, 12, 8);
      const bodyMesh = new THREE.Mesh(bodyGeo, this.materials.bronzeArmor);
      bodyMesh.position.y = 7;
      bodyMesh.castShadow = true;
      group.add(bodyMesh);

      const helmGeo = new THREE.SphereGeometry(3, 8, 8);
      const helm = new THREE.Mesh(helmGeo, this.materials.iron);
      helm.position.y = 14;
      group.add(helm);

      const shieldGeo = new THREE.BoxGeometry(1.6, 11, 8);
      const shield = new THREE.Mesh(shieldGeo, ownerMat);
      shield.position.set(-4, 7.5, 1);
      group.add(shield);

      const tridentGeo = new THREE.CylinderGeometry(0.45, 0.45, 20);
      const trident = new THREE.Mesh(tridentGeo, this.materials.iron);
      trident.position.set(4, 9.5, 0);
      group.add(trident);

    } else if (uType === "behemoth") {
      const bearGeo = new THREE.BoxGeometry(16, 9, 10);
      const bearMesh = new THREE.Mesh(bearGeo, this.materials.furBear);
      bearMesh.position.y = 6.5;
      bearMesh.castShadow = true;
      group.add(bearMesh);

      const headGeo = new THREE.SphereGeometry(4.5, 8, 8);
      const head = new THREE.Mesh(headGeo, this.materials.furBear);
      head.position.set(9, 7.5, 0);
      group.add(head);

      const riderGeo = new THREE.CylinderGeometry(2, 2.5, 9, 8);
      const rider = new THREE.Mesh(riderGeo, ownerMat);
      rider.position.set(-1, 14, 0);
      group.add(rider);

    } else if (uType === "catapult") {
      const frameGeo = new THREE.BoxGeometry(18, 4, 11);
      const frame = new THREE.Mesh(frameGeo, this.materials.woodDark);
      frame.position.y = 3;
      frame.castShadow = true;
      group.add(frame);

      const armGeo = new THREE.CylinderGeometry(0.9, 0.9, 22);
      armGeo.rotateZ(0.65);
      const arm = new THREE.Mesh(armGeo, this.materials.cedarTimber);
      arm.position.set(2, 11, 0);
      group.add(arm);

    } else if (uType === "ram") {
      const mantleGeo = new THREE.BoxGeometry(16, 10, 9);
      const mantle = new THREE.Mesh(mantleGeo, this.materials.woodDark);
      mantle.position.y = 6;
      mantle.castShadow = true;
      group.add(mantle);

      const ramHeadGeo = new THREE.CylinderGeometry(1.5, 2, 8, 8);
      ramHeadGeo.rotateZ(Math.PI / 2);
      const ramHead = new THREE.Mesh(ramHeadGeo, this.materials.iron);
      ramHead.position.set(10, 5, 0);
      group.add(ramHead);

    } else if (uType === "peasant") {
      const bodyGeo = new THREE.CylinderGeometry(2, 2.6, 9, 8);
      const body = new THREE.Mesh(bodyGeo, ownerMat);
      body.position.y = 5.5;
      body.castShadow = true;
      group.add(body);

      const headGeo = new THREE.SphereGeometry(2.2, 8, 8);
      const head = new THREE.Mesh(headGeo, this.materials.stoneDark);
      head.position.y = 11.5;
      group.add(head);

      const toolGeo = new THREE.CylinderGeometry(0.3, 0.3, 10);
      const tool = new THREE.Mesh(toolGeo, this.materials.wood);
      tool.position.set(2.2, 8, 0);
      tool.rotation.z = -0.3;
      group.add(tool);

    } else if (uType === "archer") {
      const bodyGeo = new THREE.CylinderGeometry(2, 2.5, 9, 8);
      const body = new THREE.Mesh(bodyGeo, ownerMat);
      body.position.y = 5.5;
      body.castShadow = true;
      group.add(body);

      const headGeo = new THREE.SphereGeometry(2.2, 8, 8);
      const head = new THREE.Mesh(headGeo, this.materials.stoneDark);
      head.position.y = 11.5;
      group.add(head);

      const bowGeo = new THREE.TorusGeometry(4, 0.3, 6, 12, Math.PI);
      const bow = new THREE.Mesh(bowGeo, this.materials.woodDark);
      bow.position.set(2.8, 8, 0);
      bow.rotation.y = Math.PI / 2;
      group.add(bow);

    } else {
      const bodyGeo = new THREE.CylinderGeometry(2.2, 2.8, 9.5, 8);
      const body = new THREE.Mesh(bodyGeo, ownerMat);
      body.position.y = 5.5;
      body.castShadow = true;
      group.add(body);

      const helmGeo = new THREE.ConeGeometry(2.4, 3, 8);
      const helm = new THREE.Mesh(helmGeo, this.materials.bronzeArmor);
      helm.position.y = 12.5;
      group.add(helm);

      const spearGeo = new THREE.CylinderGeometry(0.3, 0.3, 18);
      const spear = new THREE.Mesh(spearGeo, this.materials.iron);
      spear.position.set(2.6, 9.5, 0.5);
      spear.rotation.z = -0.15;
      group.add(spear);
    }

    const ownerRingGeo = new THREE.RingGeometry(r * 0.8, r * 1.15, 16);
    ownerRingGeo.rotateX(-Math.PI / 2);
    const ownerRing = new THREE.Mesh(ownerRingGeo, ownerRingMat);
    ownerRing.position.y = 0.15;
    group.add(ownerRing);

    const selRingGeo = new THREE.RingGeometry(r * 1.2, r * 1.45, 16);
    selRingGeo.rotateX(-Math.PI / 2);
    const selRing = new THREE.Mesh(selRingGeo, this.materials.selectionRing);
    selRing.name = "selectionRing";
    selRing.position.y = 0.2;
    selRing.visible = false;
    group.add(selRing);

    return group;
  }

  // --- PROJECTILES -----------------------------------------------------------

  _renderProjectiles(sim, alpha) {
    const { THREE } = this;
    const projectiles = sim.projectiles || [];
    const activeKeys = new Set();

    projectiles.forEach((p, idx) => {
      const key = `proj_${idx}`;
      activeKeys.add(key);

      let mesh = this.projectileMeshes.get(key);
      if (!mesh) {
        const geo = p.siege ? new THREE.SphereGeometry(2.4, 6, 6) : new THREE.CylinderGeometry(0.25, 0.25, 6);
        geo.rotateX(Math.PI / 2);
        mesh = new THREE.Mesh(geo, p.siege ? this.materials.projectileStone : this.materials.projectileArrow);
        this.projectileMeshes.set(key, mesh);
        this.entityGroup.add(mesh);
      }

      const progress = p.t / p.totalTicks;
      const curX = p.startX + (p.targetX - p.startX) * progress;
      const curZ = p.startY + (p.targetY - p.startY) * progress;
      
      const startElev = this.terrain ? this.terrain.getHeight(p.startX, p.startY) : 0;
      const endElev = this.terrain ? this.terrain.getHeight(p.targetX, p.targetY) : 0;
      const baseElev = startElev + (endElev - startElev) * progress;

      const maxArcHeight = p.siege ? 50 : 28;
      const curY = baseElev + 4 + 4 * maxArcHeight * progress * (1 - progress);

      mesh.position.set(curX, curY, curZ);
      mesh.lookAt(p.targetX, curY - (progress > 0.5 ? 10 : -10), p.targetY);
    });

    for (const [key, mesh] of this.projectileMeshes.entries()) {
      if (!activeKeys.has(key)) {
        this.entityGroup.remove(mesh);
        this.projectileMeshes.delete(key);
      }
    }
  }
}
