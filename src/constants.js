// Shared constants, in their own file so modules can use them without importing
// each other in a circle.

export const TICKS_PER_SECOND = 60;

// --- Placement rules ---------------------------------------------------------
export const MIN_TOWER_GAP = 28; // towers cannot be crammed on top of each other
export const FIELD_MARGIN = 18;  // keep towers fully on screen
