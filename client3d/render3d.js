// High-Fidelity 3D Articulated Humanoid Characters, Unit Animations & VFX for Swarajya (Three.js)
// Features jointed human bodies (torso, head, 2 legs, 2 arms) with realistic walk cycles,
// pickaxe mining strikes, axe wood-felling chops, archery string-draw releases, spear thrust lunges,
// and golden assignment chain links connecting workers to resource nodes!

import { TILE } from "../dominion/grid.js";
import { lutTrig } from "./lut_trig.js";

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
    this.chainLines = new Map();       // unitId -> THREE.Line
    
    this.entityGroup = new THREE.Group();
    this.scene.add(this.entityGroup);

    this.animTime = 0;
    this._initSharedMaterials();
  }

  setTerrain(terrain) {
    this.terrain = terrain;
  }

  _initSharedMaterials() {
    const { THREE } = this;
    this.materials = {
      skin: new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.8 }),
      skinDark: new THREE.MeshStandardMaterial({ color: 0x8d5b4c, roughness: 0.85 }),
      hairDark: new THREE.MeshStandardMaterial({ color: 0x1f2421, roughness: 0.9 }),
      clothRobe: new THREE.MeshStandardMaterial({ color: 0xe9d8a6, roughness: 0.9 }),
      clothPants: new THREE.MeshStandardMaterial({ color: 0x6c584c, roughness: 0.85 }),
      leatherBrigandine: new THREE.MeshStandardMaterial({ color: 0x78290f, roughness: 0.6 }),
      strawHat: new THREE.MeshStandardMaterial({ color: 0xddb892, roughness: 0.85 }),
      wickerBasket: new THREE.MeshStandardMaterial({ color: 0x936639, roughness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.75 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.8 }),
      cedarTimber: new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.7 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x8a929a, roughness: 0.85 }),
      stoneDark: new THREE.MeshStandardMaterial({ color: 0x3d434d, roughness: 0.9 }),
      roofSlate: new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.5 }),
      roofGold: new THREE.MeshStandardMaterial({ color: 0xd4a373, metalness: 0.7, roughness: 0.35 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.85, roughness: 0.25 }),
      ironBright: new THREE.MeshStandardMaterial({ color: 0xced4da, metalness: 0.9, roughness: 0.2 }),
      bronzeArmor: new THREE.MeshStandardMaterial({ color: 0xc8963e, metalness: 0.8, roughness: 0.3 }),
      furBear: new THREE.MeshStandardMaterial({ color: 0x2e1f18, roughness: 0.95 }),
      soilTilled: new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.95 }),
      fieldWheat: new THREE.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.7 }),
      scaffolding: new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.7 }),
      foundationStone: new THREE.MeshStandardMaterial({ color: 0x6c757d, roughness: 0.95 }),
      healthBg: new THREE.MeshBasicMaterial({ color: 0x1f2430 }),
      healthFill: new THREE.MeshBasicMaterial({ color: 0x52b788 }),
      progressFill: new THREE.MeshBasicMaterial({ color: 0xffb703 }),
      ownerMaterials: OWNER_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 })),
      ownerRings: OWNER_COLORS.map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })),
      selectionRing: new THREE.MeshBasicMaterial({ color: 0x7fd48f, side: THREE.DoubleSide }),
      projectileArrow: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4 }),
      projectileStone: new THREE.MeshStandardMaterial({ color: 0x57606f, roughness: 0.9 }),
      chainLineMat: new THREE.LineBasicMaterial({ color: 0xffd166, linewidth: 2, transparent: true, opacity: 0.75 }),
    };
  }

  render(sim, alpha, selection = new Set(), dt = 0.016) {
    this.animTime += dt;
    this._renderBuildings(sim, selection);
    this._renderSites(sim, selection);
    this._renderUnits(sim, alpha, selection);
    this._renderProjectiles(sim, alpha);
    this._renderAssignmentChains(sim, selection);
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

      const hpBar = mesh.getObjectByName("hpBarFill");
      if (hpBar) {
        const hpPct = Math.max(0, Math.min(1, b.hp / (b.maxHp || 1)));
        hpBar.scale.set(hpPct, 1, 1);
        hpBar.position.x = -(1 - hpPct) * 8;
        hpBar.parent.visible = selection.has(b.id) || hpPct < 0.98;
      }
    }

    for (const [id, mesh] of this.buildingMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.entityGroup.remove(mesh);
        this.buildingMeshes.delete(id);
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
      const soilBaseGeo = new THREE.BoxGeometry(size * 0.94, 2, size * 0.94);
      const soilBase = new THREE.Mesh(soilBaseGeo, this.materials.soilTilled);
      soilBase.position.y = 1;
      soilBase.receiveShadow = true;
      group.add(soilBase);

      const rowCount = 5;
      for (let r = 0; r < rowCount; r++) {
        const rowOffset = -half * 0.7 + (r * (size * 0.7 / (rowCount - 1)));
        const furrowGeo = new THREE.BoxGeometry(size * 0.82, 3.5, 3.5);
        const furrow = new THREE.Mesh(furrowGeo, this.materials.fieldWheat);
        furrow.position.set(0, 3.2, rowOffset);
        furrow.castShadow = true;
        group.add(furrow);
      }

      const shedGeo = new THREE.BoxGeometry(7, 6, 7);
      const shed = new THREE.Mesh(shedGeo, this.materials.woodDark);
      shed.position.set(half * 0.65, 4, half * 0.65);
      group.add(shed);

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

    const hpGroup = new THREE.Group();
    hpGroup.name = "hpBar";
    hpGroup.position.set(0, 38, 0);
    hpGroup.visible = false;

    const hpBg = new THREE.Mesh(new THREE.BoxGeometry(16, 1.8, 0.6), this.materials.healthBg);
    hpGroup.add(hpBg);

    const hpFill = new THREE.Mesh(new THREE.BoxGeometry(15.4, 1.4, 0.7), this.materials.healthFill);
    hpFill.name = "hpBarFill";
    hpGroup.add(hpFill);

    group.add(hpGroup);
    return group;
  }

  // --- 3D CONSTRUCTION SITES -------------------------------------------------

  _renderSites(sim, selection) {
    const { THREE } = this;
    const activeIds = new Set();
    const sites = sim.sites || [];

    for (const s of sites) {
      activeIds.add(s.id);
      let mesh = this.siteMeshes.get(s.id);

      if (!mesh) {
        mesh = this._createSiteMesh(s);
        this.siteMeshes.set(s.id, mesh);
        this.entityGroup.add(mesh);
      }

      const tiles = s.spec ? s.spec.tiles : 2;
      const sx = (s.tx + tiles / 2) * TILE;
      const sz = (s.ty + tiles / 2) * TILE;
      const elev = this.terrain ? this.terrain.getHeight(sx, sz) : 0;
      mesh.position.set(sx, elev, sz);

      const progress = s.work !== undefined && s.spec && s.spec.work
        ? Math.max(0.05, Math.min(1.0, s.work / s.spec.work))
        : Math.max(0.05, Math.min(1.0, (s.hp || 10) / (s.maxHp || 100)));

      const risingStructure = mesh.getObjectByName("risingStructure");
      if (risingStructure) {
        risingStructure.scale.y = progress;
      }

      const barFill = mesh.getObjectByName("progressBarFill");
      if (barFill) {
        barFill.scale.set(progress, 1, 1);
        barFill.position.x = -(1 - progress) * 8;
      }
    }

    for (const [id, mesh] of this.siteMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.entityGroup.remove(mesh);
        this.siteMeshes.delete(id);
      }
    }
  }

  _createSiteMesh(s) {
    const { THREE } = this;
    const group = new THREE.Group();
    const tiles = s.spec ? s.spec.tiles : 2;
    const size = tiles * TILE;
    const half = size / 2;

    const trenchGeo = new THREE.BoxGeometry(size * 0.95, 3, size * 0.95);
    const trench = new THREE.Mesh(trenchGeo, this.materials.foundationStone);
    trench.position.y = 1.5;
    trench.receiveShadow = true;
    group.add(trench);

    const poleGeo = new THREE.CylinderGeometry(0.6, 0.6, 18);
    for (const [px, pz] of [
      [-half * 0.85, -half * 0.85],
      [half * 0.85, -half * 0.85],
      [-half * 0.85, half * 0.85],
      [half * 0.85, half * 0.85]
    ]) {
      const pole = new THREE.Mesh(poleGeo, this.materials.scaffolding);
      pole.position.set(px, 9, pz);
      pole.castShadow = true;
      group.add(pole);
    }

    const structGeo = new THREE.BoxGeometry(size * 0.75, 14, size * 0.75);
    structGeo.translate(0, 7, 0);
    const structMesh = new THREE.Mesh(structGeo, this.materials.cedarTimber);
    structMesh.name = "risingStructure";
    structMesh.position.y = 2;
    structMesh.scale.set(1, 0.05, 1);
    structMesh.castShadow = true;
    group.add(structMesh);

    const barGroup = new THREE.Group();
    barGroup.name = "progressBar";
    barGroup.position.set(0, 24, 0);

    const bgGeo = new THREE.BoxGeometry(16, 2.2, 0.8);
    const bgMesh = new THREE.Mesh(bgGeo, this.materials.healthBg);
    barGroup.add(bgMesh);

    const fillGeo = new THREE.BoxGeometry(15.2, 1.6, 0.9);
    const fillMesh = new THREE.Mesh(fillGeo, this.materials.progressFill);
    fillMesh.name = "progressBarFill";
    barGroup.add(fillMesh);

    group.add(barGroup);
    return group;
  }

  // --- ARTICULATED HUMANOID UNITS & ANIMATION --------------------------------

  _renderUnits(sim, alpha, selection) {
    const activeIds = new Set();
    const t = this.animTime;

    for (const u of sim.units) {
      activeIds.add(u.id);
      let mesh = this.unitMeshes.get(u.id);

      if (!mesh) {
        mesh = this._createHumanoidUnitMesh(u);
        this.unitMeshes.set(u.id, mesh);
        this.entityGroup.add(mesh);
      }

      const prevX = u.prevX !== undefined ? u.prevX : u.x;
      const prevY = u.prevY !== undefined ? u.prevY : u.y;
      const curX = prevX + (u.x - prevX) * alpha;
      const curZ = prevY + (u.y - prevY) * alpha;

      const isMoving = Math.abs(u.x - prevX) > 0.04 || Math.abs(u.y - prevY) > 0.04;
      const elev = this.terrain ? this.terrain.getHeight(curX, curZ) : 0;

      // 1. Root Position & Walking Bob
      let bobY = 0;
      let strideSway = 0;
      if (isMoving) {
        bobY = Math.abs(Math.sin(t * 12 + u.id)) * 0.9;
        strideSway = Math.sin(t * 12 + u.id) * 0.05;
      }
      mesh.position.set(curX, elev + bobY, curZ);
      mesh.rotation.z = strideSway;

      if (u.heading !== undefined) {
        const [cosH, sinH] = lutTrig(u.heading);
        mesh.rotation.y = Math.atan2(sinH, cosH);
      }

      // 2. Articulated Legs Walk Cycle
      const legL = mesh.getObjectByName("legLeft");
      const legR = mesh.getObjectByName("legRight");
      if (legL && legR) {
        if (isMoving) {
          const legAngle = Math.sin(t * 12 + u.id) * 0.65;
          legL.rotation.x = legAngle;
          legR.rotation.x = -legAngle;
        } else {
          legL.rotation.x = 0;
          legR.rotation.x = 0;
        }
      }

      // 3. Articulated Arms: Mining, Woodcutting, Archery, Spear Thrust
      const armR = mesh.getObjectByName("armRight");
      const armL = mesh.getObjectByName("armLeft");
      const weaponR = mesh.getObjectByName("weaponRight");

      const isWorker = u.spec && u.spec.worker;
      const isFighting = u.targetId != null;

      if (isWorker && armR) {
        if (u.job && u.job.kind === "mine") {
          // Overhead Pickaxe Strike down into gold rock
          const strikeCycle = (t * 6 + (u.id % 3)) % 1.0;
          if (strikeCycle < 0.4) {
            armR.rotation.x = -1.2 + (strikeCycle / 0.4) * 0.4; // Windup
          } else if (strikeCycle < 0.6) {
            armR.rotation.x = -0.8 + ((strikeCycle - 0.4) / 0.2) * 1.8; // Fast downward strike!
          } else {
            armR.rotation.x = 1.0 - ((strikeCycle - 0.6) / 0.4) * 2.2; // Return
          }
        } else if (u.job && (u.job.kind === "fell" || u.job.kind === "build")) {
          // Horizontal Axe / Mallet Chop
          armR.rotation.x = 0.2;
          armR.rotation.z = -0.3 + Math.sin(t * 9 + u.id) * 0.75;
        } else if (isMoving) {
          armR.rotation.x = -Math.sin(t * 12 + u.id) * 0.5;
          armR.rotation.z = 0;
        } else {
          armR.rotation.x = 0;
          armR.rotation.z = 0;
        }
      } else if (u.spec && u.spec.id === "archer" && armR && armL) {
        if (isFighting) {
          // Archery Draw & Release Cycle
          const drawCycle = (t * 4 + (u.id % 2)) % 1.0;
          armL.rotation.x = -1.4; // Bow held forward
          if (drawCycle < 0.7) {
            armR.rotation.x = -1.3; // Right arm drawing string back to cheek
            armR.position.z = -1.0 + drawCycle * 0.8;
          } else {
            armR.rotation.x = -0.5; // Release twang
            armR.position.z = 0;
          }
        } else {
          armL.rotation.x = isMoving ? Math.sin(t * 12 + u.id) * 0.4 : 0;
          armR.rotation.x = isMoving ? -Math.sin(t * 12 + u.id) * 0.4 : 0;
        }
      } else if (u.spec && u.spec.id === "spearman" && armR) {
        if (isFighting) {
          // Rapid Trident Thrust Strike
          const thrust = Math.sin(t * 14 + u.id) * 4.5;
          armR.rotation.x = -1.3;
          if (weaponR) weaponR.position.z = Math.max(0, thrust);
        } else {
          armR.rotation.x = isMoving ? -Math.sin(t * 12 + u.id) * 0.4 : 0;
          if (weaponR) weaponR.position.z = 0;
        }
      }

      // Selection & Cargo
      const selRing = mesh.getObjectByName("selectionRing");
      if (selRing) {
        selRing.visible = selection.has(u.id);
      }

      const cargoGold = mesh.getObjectByName("cargoGold");
      if (cargoGold) {
        cargoGold.visible = (u.carrying || 0) > 0 && u.carryKind === "gold";
      }
      const cargoWood = mesh.getObjectByName("cargoWood");
      if (cargoWood) {
        cargoWood.visible = (u.carrying || 0) > 0 && u.carryKind === "timber";
      }
    }

    for (const [id, mesh] of this.unitMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.entityGroup.remove(mesh);
        this.unitMeshes.delete(id);
      }
    }
  }

  // --- ARTICULATED HUMANOID CHARACTER BUILDER --------------------------------

  _createHumanoidUnitMesh(u) {
    const { THREE } = this;
    const group = new THREE.Group();
    const ownerMat = this.materials.ownerMaterials[u.owner] || this.materials.ownerMaterials[0];
    const ownerRingMat = this.materials.ownerRings[u.owner] || this.materials.ownerRings[0];
    const r = u.radius || 6;
    const uType = u.spec ? u.spec.id : u.type;

    if (uType === "peasant") {
      // 1. Torso & Chuba Robe
      const torsoGeo = new THREE.CylinderGeometry(1.6, 2.2, 5.5, 8);
      const torso = new THREE.Mesh(torsoGeo, this.materials.clothRobe);
      torso.position.y = 7.5;
      torso.castShadow = true;
      group.add(torso);

      // Waistband Sash
      const sashGeo = new THREE.CylinderGeometry(1.8, 1.8, 1.4, 8);
      const sash = new THREE.Mesh(sashGeo, ownerMat);
      sash.position.y = 5.6;
      group.add(sash);

      // 2. Head with Conical Mountain Topi
      const headGroup = new THREE.Group();
      headGroup.position.y = 11.2;
      const headGeo = new THREE.SphereGeometry(1.5, 8, 8);
      const head = new THREE.Mesh(headGeo, this.materials.skin);
      headGroup.add(head);

      const hatGeo = new THREE.ConeGeometry(3.4, 2.0, 8);
      const hat = new THREE.Mesh(hatGeo, this.materials.strawHat);
      hat.position.y = 1.4;
      hat.castShadow = true;
      headGroup.add(hat);
      group.add(headGroup);

      // 3. Articulated Legs (Left & Right)
      const legGeo = new THREE.CylinderGeometry(0.65, 0.55, 5.0, 6);
      legGeo.translate(0, -2.5, 0);

      const legL = new THREE.Group();
      legL.name = "legLeft";
      legL.position.set(-1.0, 5.2, 0);
      const legLMesh = new THREE.Mesh(legGeo, this.materials.clothPants);
      legL.add(legLMesh);
      group.add(legL);

      const legR = new THREE.Group();
      legR.name = "legRight";
      legR.position.set(1.0, 5.2, 0);
      const legRMesh = new THREE.Mesh(legGeo, this.materials.clothPants);
      legR.add(legRMesh);
      group.add(legR);

      // 4. Articulated Arms (Left & Right)
      const armGeo = new THREE.CylinderGeometry(0.5, 0.45, 4.5, 6);
      armGeo.translate(0, -2.2, 0);

      const armL = new THREE.Group();
      armL.name = "armLeft";
      armL.position.set(-2.0, 9.5, 0);
      const armLMesh = new THREE.Mesh(armGeo, this.materials.skin);
      armL.add(armLMesh);
      group.add(armL);

      const armR = new THREE.Group();
      armR.name = "armRight";
      armR.position.set(2.0, 9.5, 0);
      const armRMesh = new THREE.Mesh(armGeo, this.materials.skin);
      armR.add(armRMesh);

      // Pickaxe Tool attached to Right Hand
      const toolGroup = new THREE.Group();
      toolGroup.name = "weaponRight";
      toolGroup.position.set(0, -4.2, 0);

      const shaftGeo = new THREE.CylinderGeometry(0.2, 0.2, 7.5);
      const shaft = new THREE.Mesh(shaftGeo, this.materials.wood);
      shaft.position.y = 1.0;
      toolGroup.add(shaft);

      const pickHeadGeo = new THREE.ConeGeometry(1.4, 3.6, 4);
      pickHeadGeo.rotateZ(Math.PI / 2);
      const pickHead = new THREE.Mesh(pickHeadGeo, this.materials.iron);
      pickHead.position.y = 4.2;
      toolGroup.add(pickHead);
      armR.add(toolGroup);
      group.add(armR);

      // 5. Wicker Basket (Khilta) on Back with Cargo
      const basketGeo = new THREE.CylinderGeometry(1.9, 1.4, 4.8, 8);
      const basket = new THREE.Mesh(basketGeo, this.materials.wickerBasket);
      basket.position.set(0, 7.8, -1.8);
      basket.rotation.x = -0.15;
      basket.castShadow = true;
      group.add(basket);

      const goldCargo = new THREE.Mesh(new THREE.DodecahedronGeometry(1.3, 0), this.materials.roofGold);
      goldCargo.name = "cargoGold";
      goldCargo.position.set(0, 9.6, -1.8);
      goldCargo.visible = false;
      group.add(goldCargo);

      const woodCargo = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4.2), this.materials.cedarTimber);
      woodCargo.name = "cargoWood";
      woodCargo.position.set(0, 9.6, -1.8);
      woodCargo.visible = false;
      group.add(woodCargo);

    } else if (uType === "archer") {
      // Archer: Brigandine Armor, Bow & Quiver
      const torsoGeo = new THREE.CylinderGeometry(1.7, 2.1, 5.5, 8);
      const torso = new THREE.Mesh(torsoGeo, this.materials.leatherBrigandine);
      torso.position.y = 7.5;
      torso.castShadow = true;
      group.add(torso);

      const headGeo = new THREE.SphereGeometry(1.5, 8, 8);
      const head = new THREE.Mesh(headGeo, this.materials.skin);
      head.position.y = 11.2;
      group.add(head);

      const armGeo = new THREE.CylinderGeometry(0.5, 0.45, 4.5, 6);
      armGeo.translate(0, -2.2, 0);

      const legGeo = new THREE.CylinderGeometry(0.65, 0.55, 5.0, 6);
      legGeo.translate(0, -2.5, 0);

      const legL = new THREE.Group();
      legL.name = "legLeft";
      legL.position.set(-1.0, 5.2, 0);
      legL.add(new THREE.Mesh(legGeo, this.materials.clothPants));
      group.add(legL);

      const legR = new THREE.Group();
      legR.name = "legRight";
      legR.position.set(1.0, 5.2, 0);
      legR.add(new THREE.Mesh(legGeo, this.materials.clothPants));
      group.add(legR);

      const armL = new THREE.Group();
      armL.name = "armLeft";
      armL.position.set(-2.0, 9.5, 0);
      armL.add(new THREE.Mesh(armGeo, this.materials.skin));

      // Reflex Composite Bow in Left Hand
      const bowGeo = new THREE.TorusGeometry(3.6, 0.28, 6, 12, Math.PI);
      const bow = new THREE.Mesh(bowGeo, this.materials.woodDark);
      bow.position.set(0, -4.2, 0);
      bow.rotation.y = Math.PI / 2;
      armL.add(bow);
      group.add(armL);

      const armR = new THREE.Group();
      armR.name = "armRight";
      armR.position.set(2.0, 9.5, 0);
      armR.add(new THREE.Mesh(armGeo, this.materials.skin));
      group.add(armR);

      // Quiver on Back
      const quiverGeo = new THREE.CylinderGeometry(0.7, 0.5, 4.8, 6);
      const quiver = new THREE.Mesh(quiverGeo, ownerMat);
      quiver.position.set(0.8, 8.5, -1.4);
      quiver.rotation.z = 0.35;
      group.add(quiver);

    } else if (uType === "guardian") {
      const torsoGeo = new THREE.CylinderGeometry(2.4, 2.8, 7.0, 8);
      const torso = new THREE.Mesh(torsoGeo, this.materials.bronzeArmor);
      torso.position.y = 8.5;
      torso.castShadow = true;
      group.add(torso);

      const helmGeo = new THREE.SphereGeometry(2.0, 8, 8);
      const helm = new THREE.Mesh(helmGeo, this.materials.iron);
      helm.position.y = 13.0;
      group.add(helm);

      const shieldGeo = new THREE.BoxGeometry(1.4, 9.0, 6.0);
      const shield = new THREE.Mesh(shieldGeo, ownerMat);
      shield.position.set(-3.2, 8.0, 1.0);
      group.add(shield);

      const weaponR = new THREE.Group();
      weaponR.name = "weaponRight";
      const axeShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 10), this.materials.wood);
      axeShaft.position.set(3.0, 8.0, 0);
      weaponR.add(axeShaft);
      const axeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.0, 3.0), this.materials.ironBright);
      axeBlade.position.set(3.0, 12.0, 1.0);
      weaponR.add(axeBlade);
      group.add(weaponR);

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

    } else {
      // Spearman: Bronze Armor, Shield & Long Trishula Trident
      const torsoGeo = new THREE.CylinderGeometry(1.8, 2.2, 6.0, 8);
      const torso = new THREE.Mesh(torsoGeo, this.materials.bronzeArmor);
      torso.position.y = 7.5;
      torso.castShadow = true;
      group.add(torso);

      const helmGeo = new THREE.ConeGeometry(2.0, 2.8, 8);
      const helm = new THREE.Mesh(helmGeo, this.materials.bronzeArmor);
      helm.position.y = 12.0;
      group.add(helm);

      const legGeo = new THREE.CylinderGeometry(0.65, 0.55, 5.0, 6);
      legGeo.translate(0, -2.5, 0);
      const legL = new THREE.Group();
      legL.name = "legLeft";
      legL.position.set(-1.0, 5.0, 0);
      legL.add(new THREE.Mesh(legGeo, this.materials.clothPants));
      group.add(legL);

      const legR = new THREE.Group();
      legR.name = "legRight";
      legR.position.set(1.0, 5.0, 0);
      legR.add(new THREE.Mesh(legGeo, this.materials.clothPants));
      group.add(legR);

      const armGeo = new THREE.CylinderGeometry(0.5, 0.45, 4.5, 6);
      armGeo.translate(0, -2.2, 0);
      const armL = new THREE.Group();
      armL.name = "armLeft";
      armL.position.set(-2.0, 9.5, 0);
      armL.add(new THREE.Mesh(armGeo, this.materials.skin));

      const dhalShieldGeo = new THREE.CylinderGeometry(2.8, 2.8, 0.6, 12);
      dhalShieldGeo.rotateZ(Math.PI / 2);
      const dhalShield = new THREE.Mesh(dhalShieldGeo, ownerMat);
      dhalShield.position.set(-0.8, -2.2, 0);
      armL.add(dhalShield);
      group.add(armL);

      const armR = new THREE.Group();
      armR.name = "armRight";
      armR.position.set(2.0, 9.5, 0);
      armR.add(new THREE.Mesh(armGeo, this.materials.skin));

      const weaponR = new THREE.Group();
      weaponR.name = "weaponRight";
      const tridentShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 18), this.materials.iron);
      tridentShaft.position.set(0, 4.0, 0);
      weaponR.add(tridentShaft);

      const trishulProng = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.5, 4), this.materials.ironBright);
      trishulProng.position.set(0, 13.5, 0);
      weaponR.add(trishulProng);
      armR.add(weaponR);
      group.add(armR);
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

  // --- ASSIGNMENT CHAIN LINKS (PEASANT TO TARGET RESOURCE) --------------------

  _renderAssignmentChains(sim, selection) {
    const { THREE } = this;
    const activeUnitIds = new Set();

    for (const u of sim.units) {
      if (u.spec && u.spec.worker && u.job && selection.has(u.id)) {
        let targetX = null;
        let targetZ = null;

        if (u.job.tx !== undefined && u.job.ty !== undefined) {
          targetX = (u.job.tx + 0.5) * TILE;
          targetZ = (u.job.ty + 0.5) * TILE;
        } else if (u.job.id) {
          const site = (sim.sites || []).find(s => s.id === u.job.id);
          const building = sim.buildings.find(b => b.id === u.job.id);
          const tgt = site || building;
          if (tgt) {
            const tiles = tgt.spec ? tgt.spec.tiles : 2;
            targetX = (tgt.tx + tiles / 2) * TILE;
            targetZ = (tgt.ty + tiles / 2) * TILE;
          }
        }

        if (targetX !== null && targetZ !== null) {
          activeUnitIds.add(u.id);
          let line = this.chainLines.get(u.id);

          const uElev = this.terrain ? this.terrain.getHeight(u.x, u.y) : 0;
          const tElev = this.terrain ? this.terrain.getHeight(targetX, targetZ) : 0;

          const points = [
            new THREE.Vector3(u.x, uElev + 7, u.y),
            new THREE.Vector3((u.x + targetX) / 2, Math.max(uElev, tElev) + 12, (u.y + targetZ) / 2),
            new THREE.Vector3(targetX, tElev + 4, targetZ),
          ];

          if (!line) {
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            line = new THREE.Line(geo, this.materials.chainLineMat);
            this.chainLines.set(u.id, line);
            this.entityGroup.add(line);
          } else {
            line.geometry.setFromPoints(points);
          }
        }
      }
    }

    for (const [id, line] of this.chainLines.entries()) {
      if (!activeUnitIds.has(id)) {
        this.entityGroup.remove(line);
        this.chainLines.delete(id);
      }
    }
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
