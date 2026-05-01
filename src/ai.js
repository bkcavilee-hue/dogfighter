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
    fireRange: 140, fireConeDeg: 14,        // wider cone = misses more
    detectionRange: 1100, boostRange: 500,
    evadeOnDamageProb: 0.55, evadeMin: 2.2, evadeMax: 3.6,
    lowHP: 0.35,
    missileFireCD: 12,                       // longer missile cooldown
    missileLockDelay: 1.8,
    yawAimGain: 1.0,
    pitchAimGain: 1.4,
  },
  veteran: {
    label: 'Veteran',
    fireRange: 180, fireConeDeg: 9,
    detectionRange: 1400, boostRange: 450,
    evadeOnDamageProb: 0.7, evadeMin: 1.8, evadeMax: 3.0,
    lowHP: 0.30,
    missileFireCD: 9,
    missileLockDelay: 1.0,
    yawAimGain: 1.4,
    pitchAimGain: 1.8,
  },
  ace: {
    label: 'Ace',
    fireRange: 220, fireConeDeg: 6,
    detectionRange: 1700, boostRange: 400,
    evadeOnDamageProb: 0.85, evadeMin: 1.5, evadeMax: 2.4,
    lowHP: 0.25,
    missileFireCD: 7,
    missileLockDelay: 0.7,
    yawAimGain: 1.7,
    pitchAimGain: 2.2,
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
const _aimVec = new THREE.Vector3();
const _fwdVec = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();

export function updateAI(plane, brain, allPlanes, dt) {
  // Star Fox controls: AI uses BANK to turn (banking induces yaw).
  const intent = { bank: 0, rudder: 0, pitch: 0, boost: false, fire: false, missileFire: false };
  if (!plane.alive) {
    brain.lastHP = null;
    return intent;
  }
  const cfg = brain.cfg;

  // --- Boundary checks: pull AI back from the X/Z edges and from the
  //     altitude ceiling so it stays in the playable volume.
  const pos = plane.body.translation();
  const halfW = ARENA.width / 2;
  const halfD = ARENA.depth / 2;
  const edgeBuffer = 250;
  const ceilingBuffer = 100;
  const nearEdge =
    Math.abs(pos.x) > halfW - edgeBuffer ||
    Math.abs(pos.z) > halfD - edgeBuffer;
  const tooHigh = pos.y > ARENA.maxAltitude - ceilingBuffer;

  // Cache AI's quaternion + its inverse for local-frame aim math.
  const r = plane.body.rotation();
  _qA.set(r.x, r.y, r.z, r.w);
  _qInv.copy(_qA).invert();

  if (nearEdge) {
    // Steer toward origin: express toward-origin in local frame; .x tells us
    // whether origin is to our right (+) or left (-) — flip sign so positive
    // yaw means "turn left" (matches the player's A key).
    const toOrigin = _aimVec.set(-pos.x, 0, -pos.z).normalize();
    toOrigin.applyQuaternion(_qInv);
    intent.bank = THREE.MathUtils.clamp(-toOrigin.x * 2.0, -1, 1);
    intent.pitch = tooHigh ? -1 : 0;
    intent.boost = false;
    return intent;
  }
  if (tooHigh) {
    intent.pitch = -1;             // dive
    intent.boost = false;
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
    intent.bank = brain.evadeYawDir;
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
    intent.bank = Math.sin(performance.now() * 0.0003 + (plane.id?.charCodeAt(0) ?? 0)) * 0.3;
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
  const aimX = tp.x + tv.x * leadTime - pp.x;
  const aimY = tp.y + tv.y * leadTime - pp.y;
  const aimZ = tp.z + tv.z * leadTime - pp.z;

  // Express the aim direction in the plane's LOCAL frame. Components:
  //   localAim.x: target's right offset  (+ = to our right)
  //   localAim.y: target's up    offset  (+ = above us)
  //   localAim.z: target's depth offset  (- = in front, since fwd = -Z)
  // Bank input is sign-flipped because intent.bank=+1 means "bank left",
  // but a target on our LEFT has localAim.x < 0.
  const localAim = _aimVec.set(aimX, aimY, aimZ).normalize();
  localAim.applyQuaternion(_qInv);
  intent.bank  = THREE.MathUtils.clamp(-localAim.x * cfg.yawAimGain, -1, 1);
  intent.pitch = THREE.MathUtils.clamp( localAim.y * cfg.pitchAimGain, -1, 1);

  intent.boost = dist > cfg.boostRange;

  // --- Gunfire ---------------------------------------------------------
  const inRange = dist < cfg.fireRange;
  // Angle between current forward and the aim direction. Below the cone
  // threshold and we shoot.
  const fwd = _fwdVec.set(0, 0, -1).applyQuaternion(_qA);
  const cosAim = THREE.MathUtils.clamp(fwd.dot(_aimVec.set(aimX, aimY, aimZ).normalize()), -1, 1);
  const aimAngle = Math.acos(cosAim);
  const inCone = aimAngle < THREE.MathUtils.degToRad(cfg.fireConeDeg);
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
