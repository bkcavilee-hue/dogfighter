// AI controller. Outputs an `intent` object compatible with updateAircraft.
//
// State machine:
//   HUNT   — fly toward nearest enemy, boost if far, fire when in cone.
//   EVADE  — recently took damage or HP low: hard turn + climb + boost,
//            then return to HUNT.
//   PATROL — no targets in range: cruise straight (default).
//
// AI doesn't read keyboard. It reads the world and writes an intent.
import * as THREE from 'three';
import { findMissileLock, MISSILE } from './missiles.js';
import { ARENA } from './arena.js';

// Difficulty presets. Each AI has one of these baked in via createAIBrain.
export const DIFFICULTY = {
  rookie: {
    label: 'Rookie',
    fireRange: 160, fireConeDeg: 9,
    detectionRange: 1100, boostRange: 500,
    evadeOnDamageProb: 0.55, evadeMin: 2.2, evadeMax: 3.6,
    lowHP: 0.35,
    missileFireCD: 9,        // s between missile launches
    missileLockDelay: 1.4,   // s of holding lock before firing
    yawAimGain: 1.1,         // less aggressive aim correction
    pitchAimGain: 1.6,
  },
  veteran: {
    label: 'Veteran',
    fireRange: 200, fireConeDeg: 5,
    detectionRange: 1500, boostRange: 450,
    evadeOnDamageProb: 0.7, evadeMin: 1.8, evadeMax: 3.0,
    lowHP: 0.30,
    missileFireCD: 6,
    missileLockDelay: 0.7,
    yawAimGain: 1.6,
    pitchAimGain: 2.2,
  },
  ace: {
    label: 'Ace',
    fireRange: 240, fireConeDeg: 3,
    detectionRange: 1800, boostRange: 400,
    evadeOnDamageProb: 0.85, evadeMin: 1.5, evadeMax: 2.4,
    lowHP: 0.25,
    missileFireCD: 4,
    missileLockDelay: 0.4,
    yawAimGain: 2.0,
    pitchAimGain: 2.6,
  },
};

export function createAIBrain(difficulty = 'veteran') {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.veteran;
  return {
    state: 'patrol',
    difficulty,
    cfg,
    evadeTimer: 0,
    evadeYawDir: 1,
    evadePitchDir: 1,
    lastHP: null,
    reactionTimer: 0,
    targetId: null,
    fireHoldTimer: 0,
    missileCD: 3.0,         // initial delay before first missile launch
    missileLockTimer: 0,    // how long the same target has been within missile cone
  };
}

const _v = new THREE.Vector3();

export function updateAI(plane, brain, allPlanes, dt) {
  const intent = { yaw: 0, pitch: 0, boost: false, fire: false, missileFire: false };
  if (!plane.alive) {
    brain.lastHP = null;
    return intent;
  }
  const cfg = brain.cfg;

  // --- Boundary check: if near the arena edge, override yaw to turn back
  //     toward center. Prevents AI from flying out of bounds.
  const pos = plane.body.translation();
  const halfW = ARENA.width / 2;
  const halfD = ARENA.depth / 2;
  const edgeBuffer = 250; // m — start steering back when this close to the edge
  const nearEdge =
    Math.abs(pos.x) > halfW - edgeBuffer ||
    Math.abs(pos.z) > halfD - edgeBuffer;
  if (nearEdge) {
    // Compute desired heading toward origin and override yaw input.
    const desiredHeading = Math.atan2(-(0 - pos.x), -(0 - pos.z));
    let yawDelta = desiredHeading - (plane._heading ?? 0);
    while (yawDelta > Math.PI) yawDelta -= 2 * Math.PI;
    while (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;
    intent.yaw = THREE.MathUtils.clamp(yawDelta * 2.0, -1, 1);
    intent.pitch = 0; // level out
    intent.boost = false;
    return intent;
  }

  // --- Damage detection -----------------------------------------------
  if (brain.lastHP !== null && plane.HP < brain.lastHP) {
    if (Math.random() < cfg.evadeOnDamageProb && brain.state !== 'evade') {
      enterEvade(brain);
    }
  }
  brain.lastHP = plane.HP;

  if (plane.HP / plane.maxHP < cfg.lowHP && brain.state !== 'evade') {
    enterEvade(brain);
  }

  // --- Missile cooldown always ticks ---------------------------------
  brain.missileCD = Math.max(0, brain.missileCD - dt);

  // --- Find target -----------------------------------------------------
  const target = findClosestEnemy(plane, allPlanes);

  // --- State: EVADE ----------------------------------------------------
  if (brain.state === 'evade') {
    brain.evadeTimer -= dt;
    intent.yaw = brain.evadeYawDir;
    intent.pitch = 0.7 * brain.evadePitchDir;
    intent.boost = true;
    if (brain.evadeTimer <= 0) {
      brain.state = target ? 'hunt' : 'patrol';
    }
    return intent;
  }

  // --- State: PATROL (no target in range) -----------------------------
  if (!target) {
    brain.state = 'patrol';
    intent.yaw = Math.sin(performance.now() * 0.0003 + (plane.id?.charCodeAt(0) ?? 0)) * 0.3;
    brain.missileLockTimer = 0;
    return intent;
  }

  brain.state = 'hunt';

  // --- State: HUNT — turn toward target -------------------------------
  const tp = target.body.translation();
  const pp = plane.body.translation();
  const dx = tp.x - pp.x;
  const dy = tp.y - pp.y;
  const dz = tp.z - pp.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > cfg.detectionRange) {
    brain.state = 'patrol';
    brain.missileLockTimer = 0;
    return intent;
  }

  const tv = target.body.linvel();
  const leadTime = dist / Math.max(plane.stats.maxSpeed, 1) * 0.6;
  const aimX = tp.x + tv.x * leadTime;
  const aimY = tp.y + tv.y * leadTime;
  const aimZ = tp.z + tv.z * leadTime;

  const adx = aimX - pp.x;
  const ady = aimY - pp.y;
  const adz = aimZ - pp.z;
  const aimHoriz = Math.sqrt(adx * adx + adz * adz);

  const desiredHeading = Math.atan2(-adx, -adz);
  let yawDelta = desiredHeading - (plane._heading ?? 0);
  while (yawDelta > Math.PI) yawDelta -= 2 * Math.PI;
  while (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;
  intent.yaw = THREE.MathUtils.clamp(yawDelta * cfg.yawAimGain, -1, 1);

  const desiredPitch = Math.atan2(ady, Math.max(aimHoriz, 1));
  const pitchDelta = desiredPitch - (plane._pitch ?? 0);
  intent.pitch = THREE.MathUtils.clamp(pitchDelta * cfg.pitchAimGain, -1, 1);

  intent.boost = dist > cfg.boostRange;

  // --- Gunfire ---------------------------------------------------------
  const inRange = dist < cfg.fireRange;
  const inCone = Math.abs(yawDelta) < THREE.MathUtils.degToRad(cfg.fireConeDeg) &&
                 Math.abs(pitchDelta) < THREE.MathUtils.degToRad(cfg.fireConeDeg);
  if (inRange && inCone) brain.fireHoldTimer = 0.15;
  if (brain.fireHoldTimer > 0) {
    brain.fireHoldTimer -= dt;
    intent.fire = true;
  }

  // --- Missile fire ----------------------------------------------------
  // Hold lock for missileLockDelay seconds before firing. Skip if cooldown
  // hasn't elapsed or if the AI has none left.
  if (plane.missiles > 0 && brain.missileCD <= 0) {
    const missileLock = findMissileLock(plane, allPlanes);
    if (missileLock === target) {
      brain.missileLockTimer += dt;
      if (brain.missileLockTimer >= cfg.missileLockDelay) {
        intent.missileFire = true;
        intent.missileTarget = target;
        brain.missileCD = cfg.missileFireCD;
        brain.missileLockTimer = 0;
      }
    } else {
      brain.missileLockTimer = 0;
    }
  } else {
    brain.missileLockTimer = 0;
  }

  return intent;
}

function enterEvade(brain) {
  brain.state = 'evade';
  brain.evadeTimer = brain.cfg.evadeMin + Math.random() * (brain.cfg.evadeMax - brain.cfg.evadeMin);
  brain.evadeYawDir = Math.random() < 0.5 ? -1 : 1;
  brain.evadePitchDir = Math.random() < 0.7 ? 1 : -1;
  brain.missileLockTimer = 0;
}

function findClosestEnemy(plane, allPlanes) {
  let best = null;
  let bestDist = Infinity;
  const pp = plane.body.translation();
  for (const o of allPlanes) {
    if (o === plane || !o.alive || o.team === plane.team) continue;
    const op = o.body.translation();
    const dx = op.x - pp.x, dy = op.y - pp.y, dz = op.z - pp.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return best;
}
