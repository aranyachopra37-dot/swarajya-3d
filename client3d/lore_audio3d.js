// Terrain-Adaptive Procedural Himalayan & Vedic Lore Soundscape Synthesizer for Swarajya 3D (Web Audio API)
// Adapts musical scales, drones, resonance filters, and instruments based on the active map terrain and biome.

export class LoreAudio3D {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.droneGain = null;
    this.ambientGain = null;

    this.isStarted = false;
    this.activeBiome = "alpine_himalaya";
    this.droneOscs = [];
    this.ambientNodes = [];
    this.periodicTimer = null;
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

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.setValueAtTime(0.65, this.ctx.currentTime);
    this.droneGain.connect(this.musicGain);

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    this.ambientGain.connect(this.musicGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
    this.sfxGain.connect(this.masterGain);

    this._startBiomeMusic(this.activeBiome);
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
   * Switches the music soundscape to match the map terrain / biome.
   * @param {string} mapId 
   */
  setMapTerrain(mapId) {
    let biome = "alpine_himalaya";
    if (mapId === "kailashSanctum" || mapId === "trishulPass") {
      biome = "alpine_himalaya";
    } else if (mapId === "hingol" || mapId === "ashenReach") {
      biome = "red_desert_gorge";
    } else if (mapId === "kingsmoor" || mapId === "twoGates" || mapId === "narrows") {
      biome = "river_valley";
    } else if (mapId === "threeCrowns" || mapId === "theSunder") {
      biome = "sacred_disc";
    }

    if (this.activeBiome === biome && this.droneOscs.length > 0) return;
    this.activeBiome = biome;

    if (this.isStarted && this.ctx) {
      this._stopActiveSoundscape();
      this._startBiomeMusic(biome);
    }
  }

  _stopActiveSoundscape() {
    if (this.periodicTimer) {
      clearTimeout(this.periodicTimer);
      this.periodicTimer = null;
    }
    this.droneOscs.forEach(node => {
      try { node.stop(); node.disconnect(); } catch {}
    });
    this.droneOscs = [];
    this.ambientNodes.forEach(node => {
      try { node.stop(); node.disconnect(); } catch {}
    });
    this.ambientNodes = [];
  }

  _startBiomeMusic(biome) {
    if (!this.ctx) return;

    if (biome === "alpine_himalaya") {
      // 1. Alpine Mountain Peak: Sa-Pa-Sa Tanpura in D + Singing Bowls
      this._startDrone([73.42, 110.0, 146.83, 147.2, 220.0, 293.66], 480, 2.5);
      this._startWindNoise(320, 0.12);
      this._schedulePeriodic(() => {
        const bowls = [216, 288, 324, 432, 528, 648];
        const f = bowls[Math.floor(Math.random() * bowls.length)];
        this.strikeSingingBowl(f, 0.18, 7.5);
      }, 7000, 13000);

    } else if (biome === "red_desert_gorge") {
      // 2. Red Desert / Canyon: Raga Marwa / Puriya in C# + Arid Wind + Pulse
      this._startDrone([69.3, 103.83, 138.59, 139.1, 207.65, 277.18], 360, 3.8);
      this._startWindNoise(220, 0.18);
      this._schedulePeriodic(() => {
        this.playWarDrum(52, 0.45);
        setTimeout(() => this.playWarDrum(48, 0.35), 450);
      }, 5000, 9000);

    } else if (biome === "river_valley") {
      // 3. Verdant River Valley / Plains: Raga Yaman in G + Santoor Shimmer
      this._startDrone([98.0, 146.83, 196.0, 196.5, 246.94, 293.66], 650, 1.8);
      this._schedulePeriodic(() => {
        const notes = [293.66, 329.63, 369.99, 392.0, 440.0, 493.88, 587.33];
        const f = notes[Math.floor(Math.random() * notes.length)];
        this.pluckSantoor(f, 0.12);
      }, 2500, 5000);

    } else if (biome === "sacred_disc") {
      // 4. Sacred Coastal / Circular Plateau: Deep Vedic Dhrupad in E + Gongs
      this._startDrone([82.41, 123.47, 164.81, 165.2, 246.94, 329.63], 420, 3.0);
      this._schedulePeriodic(() => {
        this.playTempleBell(432, 0.22, 6.0);
      }, 8000, 15000);
    }
  }

  _startDrone(freqs, filterFreq, filterQ) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFreq, this.ctx.currentTime);
    filter.Q.setValueAtTime(filterQ, this.ctx.currentTime);
    filter.connect(this.droneGain);

    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = idx % 2 === 0 ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.04 / (idx + 1), this.ctx.currentTime);

      const lfo = this.ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.1 + idx * 0.04, this.ctx.currentTime);
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(0.015 / (idx + 1), this.ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start();

      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      this.droneOscs.push(osc);
      this.droneOscs.push(lfo);
    });
  }

  _startWindNoise(cutoff = 300, vol = 0.1) {
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(cutoff, this.ctx.currentTime);
    filter.Q.setValueAtTime(4.0, this.ctx.currentTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambientGain);

    whiteNoise.start();
    this.ambientNodes.push(whiteNoise);
  }

  _schedulePeriodic(fn, minDelay, maxDelay) {
    const run = () => {
      if (!this.ctx) return;
      fn();
      const nextDelay = minDelay + Math.random() * (maxDelay - minDelay);
      this.periodicTimer = setTimeout(run, nextDelay);
    };
    this.periodicTimer = setTimeout(run, minDelay);
  }

  /**
   * Resonant Tibetan Singing Bowl strike.
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
   * Santoor pluck for verdant plains.
   */
  pluckSantoor(freq = 330, gainLevel = 0.15) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainLevel, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

    osc.connect(gain);
    gain.connect(this.musicGain);

    osc.start(now);
    osc.stop(now + 2.0);
  }

  /**
   * Temple Bell / Ghanta chime.
   */
  playTempleBell(freq = 720, volume = 0.2, decay = 3.5) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + decay + 0.1);
  }

  /**
   * Pakhawaj / Nagada war drum.
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
}
