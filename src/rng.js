// A seeded random number generator.
//
// Why not just use Math.random()? Because Math.random() gives different numbers
// every time you run the game. We need the opposite: given the same seed, the
// game must play out *identically* every time, on every machine.
//
// That property is what lets us verify scores later (the server re-runs your
// inputs and checks it gets your score) and what lets every player face the
// exact same daily board. It has to be true from the very first line of code —
// it cannot be bolted on later.
//
// This is "mulberry32", a small, fast, well-known generator.

export function makeRng(seed) {
  let state = seed >>> 0; // >>> 0 forces it to a 32-bit unsigned integer

  // Returns a number from 0 (inclusive) to 1 (exclusive), like Math.random().
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Whole number from min to max, inclusive of both.
export function randInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}
