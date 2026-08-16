// Procedural Himalayan Lore Soundscape & Meditation Synthesizer for Swarajya 3D
// Generates continuous Tanpura drone, Singing Bowls (108/216/432/528 Hz), Bansuri breath, and Pakhawaj war drums.

export class LoreAudio3D {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.isStarted = false;
    this.droneOscs = [];
    this.bowlTimer = null;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
    this.musicGain.connect(this.masterGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
    this.sfxGain.connect(this.masterGain);

    this._startHimalayanDrone();
    this._scheduleSingingBowls();
    this.isStarted = true;
  }

  setMusicVolume(v) {
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
    }
  }

  setSfxVolume(v) {
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);
    }
  }

  /**
   * Continuous Tanpura Drone in D (Sa-Pa-Sa) with warm microtonal beating.
   */
  _startHimalayanDrone() {
    if (!this.ctx) return;
    const freqs = [
      73.42,   // D2 (Kharaj Sa)
      110.00,  // A2 (Pancham Pa)
      146.83,  // D3 (Madhya Sa)
      147.20,  // D3 microtonal shimmer
      220.00,  // A3
      293.66,  // D4 harmonic
    ];

    const droneFilter = this.ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.setValueAtTime(480, this.ctx.currentTime);
    droneFilter.Q.setValueAtTime(2.5, this.ctx.currentTime);
    droneFilter.connect(this.musicGain);

    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = idx % 2 === 0 ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.04 / (idx + 1), this.ctx.currentTime);

      // Gentle LFO swell for string resonance
      const lfo = this.ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.12 + idx * 0.05, this.ctx.currentTime);
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(0.015 / (idx + 1), this.ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start();

      osc.connect(gain);
      gain.connect(droneFilter);
      osc.start();
      this.droneOscs.push(osc);
    });
  }

  /**
   * Periodic Tibetan Singing Bowl chime (Sacred frequencies: 108Hz, 216Hz, 432Hz, 528Hz).
   */
  _scheduleSingingBowls() {
    const playBowl = () => {
      if (!this.ctx) return;
      const sacredFrequencies = [216, 288, 324, 432, 528, 648];
      const f = sacredFrequencies[Math.floor(Math.random() * sacredFrequencies.length)];
      this.strikeSingingBowl(f, 0.18, 7.5);

      const nextDelay = 8000 + Math.random() * 12000;
      this.bowlTimer = setTimeout(playBowl, nextDelay);
    };

    this.bowlTimer = setTimeout(playBowl, 2500);
  }

  /**
   * Resonant Tibetan Singing Bowl strike with natural metallic shimmer.
   */
  strikeSingingBowl(freq = 432, gainLevel = 0.2, decay = 6.0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const harmonics = [1.0, 2.01, 3.03, 4.2];
    harmonics.forEach((h, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * h, now);

      const g = this.ctx.createGain();
      const initialGain = (gainLevel / (idx + 1)) * (idx === 0 ? 1.0 : 0.4);
      g.gain.setValueAtTime(initialGain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay * (1 - idx * 0.15));

      osc.connect(g);
      g.connect(this.musicGain);

      osc.start(now);
      osc.stop(now + decay);
    });
  }

  /**
   * Pakhawaj / Nagada resonant war drum thud for orders and attacks.
   */
  playWarDrum(pitch = 65, intensity = 0.6) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitch * 2.2, now);
    osc.frequency.exponentialRampToValueAtTime(pitch, now + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.5);
  }

  /**
   * High Crystalline Temple Bell (Ghanta) chime.
   */
  playTempleBell(freq = 864) {
    if (!this.ctx) return;
    this.strikeSingingBowl(freq, 0.25, 4.5);
  }
}
