// Procedural sound effects via Web Audio API. No external audio files —
// every sound is synthesized from oscillators and noise so the game runs
// with zero asset dependencies.
//
// Browsers won't let us start audio until the user has interacted with the
// page; call `unlockAudio` from any user-initiated event handler (button
// click, key press) to resume the suspended context.

let ctx = null;
let masterGain = null;
let noiseBuffer = null;

export function initAudio() {
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);
    // Pre-generate 1s of white noise; sound functions reuse it.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch (e) {
    console.warn('[audio] init failed:', e);
  }
}

export function unlockAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v));
}

function noiseSource() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

/* -----------------------------------------------------------------------
 * Sound effects
 * --------------------------------------------------------------------- */

/** Quick, dry crack. Throttled by the caller via firing rate. */
export function sfxGunshot() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(420 + Math.random() * 60, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.05);
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(g).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.07);

  // Add a tiny noise click for "punch".
  const n = noiseSource();
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.10, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 1500;
  n.connect(filt).connect(ng).connect(masterGain);
  n.start(t);
  n.stop(t + 0.05);
}

/** Whoosh — descending noise + short pitch sweep. */
export function sfxMissileLaunch() {
  if (!ctx) return;
  const t = ctx.currentTime;
  // Noise whoosh
  const n = noiseSource();
  const ng = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.setValueAtTime(2400, t);
  filt.frequency.exponentialRampToValueAtTime(400, t + 0.6);
  filt.Q.value = 1.8;
  ng.gain.setValueAtTime(0.0, t);
  ng.gain.linearRampToValueAtTime(0.45, t + 0.05);
  ng.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
  n.connect(filt).connect(ng).connect(masterGain);
  n.start(t);
  n.stop(t + 0.65);
  // Sub thump
  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.2);
  og.gain.setValueAtTime(0.4, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o.connect(og).connect(masterGain);
  o.start(t);
  o.stop(t + 0.3);
}

/** Boom — low rumble, mid crack, decay. */
export function sfxExplosion() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const ng = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(2200, t);
  filt.frequency.exponentialRampToValueAtTime(150, t + 0.6);
  ng.gain.setValueAtTime(0.0, t);
  ng.gain.linearRampToValueAtTime(0.7, t + 0.02);
  ng.gain.exponentialRampToValueAtTime(0.005, t + 0.7);
  n.connect(filt).connect(ng).connect(masterGain);
  n.start(t);
  n.stop(t + 0.75);
  // Sub thump
  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(80, t);
  o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
  og.gain.setValueAtTime(0.6, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(og).connect(masterGain);
  o.start(t);
  o.stop(t + 0.55);
}

/** Hit on player — sharp metallic thunk. */
export function sfxHit() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.06);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  o.connect(g).connect(masterGain);
  o.start(t);
  o.stop(t + 0.09);
}

/** Missile inbound warning — repeating beep tone. Call once per detection. */
export function sfxLockWarning() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = 1100;
  g.gain.setValueAtTime(0.0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.01);
  g.gain.linearRampToValueAtTime(0.0, t + 0.10);
  o.connect(g).connect(masterGain);
  o.start(t);
  o.stop(t + 0.12);
}

/** Flare deploy — short low pop. */
export function sfxFlare() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const ng = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 1800;
  ng.gain.setValueAtTime(0.3, t);
  ng.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
  n.connect(filt).connect(ng).connect(masterGain);
  n.start(t);
  n.stop(t + 0.2);
}

/** Maneuver swoosh (loop / dodge). */
export function sfxManeuver() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const ng = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.setValueAtTime(800, t);
  filt.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
  filt.Q.value = 4;
  ng.gain.setValueAtTime(0.0, t);
  ng.gain.linearRampToValueAtTime(0.35, t + 0.05);
  ng.gain.exponentialRampToValueAtTime(0.005, t + 0.3);
  n.connect(filt).connect(ng).connect(masterGain);
  n.start(t);
  n.stop(t + 0.35);
}
