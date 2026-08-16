// Tactical Formations & Flanking Math for Swarajya 3D
// Deterministic positioning and directional damage calculation using 256-angle LUT.

import { lutTrig, lutAngle, lutRotate, ANGLE_STEPS } from "./lut_trig.js";

export const FORMATIONS = {
  line: {
    id: "line",
    name: "Pankti (Line)",
    desc: "Broad front. Maximum archery volley coverage and frontline wall.",
    spacing: 14,
    getOffsets: (count) => {
      const offsets = [];
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        // Line across perpendicular axis (X), depth 0 (Y)
        offsets.push([(i - half) * 14, 0]);
      }
      return offsets;
    }
  },
  wedge: {
    id: "wedge",
    name: "Garuda (Wedge)",
    desc: "V-formation charge. Breaches through enemy lines with frontal armor bonus.",
    spacing: 16,
    getOffsets: (count) => {
      const offsets = [];
      offsets.push([0, 12]); // Point man at apex
      let side = 1;
      let row = 1;
      for (let i = 1; i < count; i++) {
        offsets.push([side * row * 12, 12 - row * 10]);
        if (side === 1) {
          side = -1;
        } else {
          side = 1;
          row++;
        }
      }
      return offsets;
    }
  },
  square: {
    id: "square",
    name: "Vajra (Square / Box)",
    desc: "Defensive perimeter. 360-degree protection, immune to rear flank bonus.",
    spacing: 14,
    getOffsets: (count) => {
      const offsets = [];
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const halfX = ((cols - 1) * 14) / 2;
      const halfY = ((rows - 1) * 14) / 2;

      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        offsets.push([col * 14 - halfX, row * 14 - halfY]);
      }
      return offsets;
    }
  }
};

/**
 * Calculates flanking damage multiplier based on attacker and defender facing angles.
 * @param {number} attackerHeading - 0..255 angle bin
 * @param {number} defenderHeading - 0..255 angle bin
 * @param {string|null} defenderFormation - Formation type
 * @returns {number} Damage multiplier (1.0 = front, 1.5 = flank, 2.0 = rear)
 */
export function getFlankingMultiplier(attackerHeading, defenderHeading, defenderFormation = null) {
  // Vajra (Square) formation is immune to flanking and rear critical hits
  if (defenderFormation === "square") return 1.0;

  // Angular difference on 256 discrete scale
  let diff = Math.abs((attackerHeading - defenderHeading) & 255);
  if (diff > 128) diff = 256 - diff;

  // Frontal clash: headings roughly opposite (~128 angle difference) -> 1.0x
  // Flanking: attack from sides (~64 angle difference) -> 1.5x
  // Rear attack: attacker facing same direction as defender (diff <= 32) -> 2.0x
  if (diff <= 32) {
    return 2.0; // Rear Strike (Critical)
  } else if (diff <= 96) {
    return 1.5; // Flank Strike
  }
  return 1.0; // Frontal Engagement
}

/**
 * Arranges a battalion of units into formed world-space positions.
 * @param {Array<{x: number, y: number}>} units 
 * @param {number} targetX 
 * @param {number} targetY 
 * @param {number} heading - 0..255 angle index
 * @param {string} formationType 
 * @returns {Array<{unit: Object, targetX: number, targetY: number}>}
 */
export function calculateFormationSlots(units, targetX, targetY, heading, formationType = "line") {
  const form = FORMATIONS[formationType] || FORMATIONS.line;
  const offsets = form.getOffsets(units.length);

  return units.map((u, i) => {
    const [ox, oy] = offsets[i] || [0, 0];
    const [rx, ry] = lutRotate(ox, oy, heading);
    return {
      unit: u,
      targetX: targetX + rx,
      targetY: targetY + ry
    };
  });
}
