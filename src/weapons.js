// Machine-gun fire with heat/overheat.
// Projectiles are simple raycasts each frame — no per-bullet rigid bodies.
// Tracer visuals are short line segments that fade out.
import * as THREE from 'three';
import { applyDamage } from './gamestate.js';
import { spawnMuzzleFlash, spawnHitSpark } from './fx.js';
import { sfxGunshot } from './audio.js';

const GUN = {
  fireRatePerSec: 14,
  heatPerShot: 4.0,        // less heat per shot
  heatCoolPerSec: 28,      // cools much faster
  overheatThreshold: 100,
  cooldownAfterOverheat: 0.4,  // was 1.5; ~2s less between overheat → fire-again
  damage: 5,
  range: 600,
  spreadDeg: 0.6,
  aimAssistMaxAngleDeg: 26,    // beyond this angle, no assist (was 18°)
  aimAssistBase: 0.75,         // strength when you just started firing (was 0.55)
  aimAssistMax:  0.99,         // strength at full lock-on confidence
  lockRampSeconds: 0.3,        // faster lock build-up (was 0.4)
  lockDecayPerSec: 0.7,        // slower decay = stickier lock (was 1.0)
};

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Find the gun-aim-assist soft-lock target (forward cone + max range). */
const SOFT_LOCK = { coneDeg: 35, range: 600 }; // wider/longer than before for easier aim
const _v3 = new THREE.Vector3();
export function findSoftLock(plane, allPlanes) {
  const r = plane.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const fwd = _v3.set(0, 0, -1).applyQuaternion(_q);
  const pp = plane.body.translation();
  const cosCone = Math.cos(THREE.MathUtils.degToRad(SOFT_LOCK.coneDeg));
  let best = null, bestScore = -Infinity;
  for (const o of allPlanes) {
    if (o === plane || !o.alive || o.team === plane.team) continue;
    const op = o.body.translation();
    const dx = op.x - pp.x, dy = op.y - pp.y, dz = op.z - pp.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > SOFT_LOCK.range) continue;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(dist, 1e-3);
    if (dot < cosCone) continue;
    const score = dot * 200 - dist;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

export function createWeaponState() {
  return {
    fireAccumulator: 0,
    overheated: false,
    overheatTimer: 0,
    tracers: [],          // { line, ttl }
    lockConfidence: 0,    // 0..1 — ramps while firing on a soft-locked target
    lockTargetId: null,   // id of the target the lock is built up on
  };
}

/**
 * @param {Object} plane         - the firing plane
 * @param {Object} weapon        - state from createWeaponState()
 * @param {boolean} fire         - whether the trigger is pulled this frame
 * @param {Array} otherPlanes    - potential targets (typically enemy team only)
 * @param {THREE.Scene} scene    - to add tracer meshes
 * @param {number} dt            - seconds
 * @param {Object|null} softLock - optional aim-assist target (player only)
 */
export function updateWeapons(plane, weapon, fire, otherPlanes, scene, dt, softLock = null, onHit = null) {
  // --- Lock-on confidence ramp ---------------------------------------
  // Confidence builds while firing AND a soft-lock target exists. Decays
  // when not firing or no target. If the soft-lock target changes, reset.
  const lockingNow = fire && softLock && softLock.alive;
  if (lockingNow) {
    if (weapon.lockTargetId !== softLock.id) {
      weapon.lockConfidence = 0;
      weapon.lockTargetId = softLock.id;
    }
    weapon.lockConfidence = Math.min(1, weapon.lockConfidence + dt / GUN.lockRampSeconds);
  } else {
    weapon.lockConfidence = Math.max(0, weapon.lockConfidence - dt * GUN.lockDecayPerSec);
    if (weapon.lockConfidence === 0) weapon.lockTargetId = null;
  }

  // Cool down heat
  plane.heat = Math.max(0, plane.heat - GUN.heatCoolPerSec * dt);

  if (weapon.overheated) {
    weapon.overheatTimer -= dt;
    if (weapon.overheatTimer <= 0 && plane.heat < 30) {
      weapon.overheated = false;
    }
  }

  if (fire && !weapon.overheated && plane.alive) {
    weapon.fireAccumulator += dt;
    const interval = 1 / GUN.fireRatePerSec;
    while (weapon.fireAccumulator >= interval) {
      weapon.fireAccumulator -= interval;
      // softLock is only set for the player; treat that as the marker for
      // "player shot" → use the bigger hit volume. AI keeps the tight one.
      const hitRadiusBoost = softLock !== null ? 2.0 : 0.4;
      fireShot(plane, weapon, otherPlanes, scene, softLock, onHit, hitRadiusBoost);

      plane.heat += GUN.heatPerShot;
      if (plane.heat >= GUN.overheatThreshold) {
        plane.heat = GUN.overheatThreshold;
        weapon.overheated = true;
        weapon.overheatTimer = GUN.cooldownAfterOverheat;
        break;
      }
    }
  } else {
    weapon.fireAccumulator = 0;
  }

  // Update tracers
  for (let i = weapon.tracers.length - 1; i >= 0; i--) {
    const t = weapon.tracers[i];
    t.ttl -= dt;
    t.line.material.opacity = Math.max(0, t.ttl / 0.12);
    if (t.ttl <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      weapon.tracers.splice(i, 1);
    }
  }
}

function fireShot(plane, weapon, otherPlanes, scene, softLock, onHit, hitRadiusBoost = 0.4) {
  const t = plane.body.translation();
  const r = plane.body.rotation();
  _origin.set(t.x, t.y, t.z);
  _q.set(r.x, r.y, r.z, r.w);
  _dir.set(0, 0, -1).applyQuaternion(_q);

  // Aim assist: bend shot toward soft-locked target if angle is small enough.
  // Strength ramps from BASE → MAX with weapon.lockConfidence.
  if (softLock && softLock.alive) {
    const tt = softLock.body.translation();
    const tv = softLock.body.linvel();
    // Slight lead so high-speed crossings hit too.
    const lead = 0.08;
    const desired = new THREE.Vector3(
      tt.x + tv.x * lead - _origin.x,
      tt.y + tv.y * lead - _origin.y,
      tt.z + tv.z * lead - _origin.z
    ).normalize();
    const cosAngle = THREE.MathUtils.clamp(_dir.dot(desired), -1, 1);
    const angle = Math.acos(cosAngle);
    if (angle < THREE.MathUtils.degToRad(GUN.aimAssistMaxAngleDeg)) {
      const strength = GUN.aimAssistBase +
        (GUN.aimAssistMax - GUN.aimAssistBase) * weapon.lockConfidence;
      _dir.lerp(desired, strength).normalize();
    }
  }

  // Apply spread.
  const spread = THREE.MathUtils.degToRad(GUN.spreadDeg);
  _dir.x += (Math.random() - 0.5) * spread;
  _dir.y += (Math.random() - 0.5) * spread;
  _dir.z += (Math.random() - 0.5) * spread;
  _dir.normalize();

  // Hit test against other planes (sphere approximation).
  let hitTarget = null;
  let hitDist = GUN.range;
  for (const target of otherPlanes) {
    if (!target.alive || target === plane) continue;
    const tt = target.body.translation();
    const toTarget = new THREE.Vector3(tt.x - _origin.x, tt.y - _origin.y, tt.z - _origin.z);
    const along = toTarget.dot(_dir);
    if (along < 0 || along > hitDist) continue;
    const perpSq = toTarget.lengthSq() - along * along;
    const radius = Math.max(target.stats.colliderHalf.x, target.stats.colliderHalf.z) + hitRadiusBoost;
    if (perpSq <= radius * radius) {
      hitTarget = target;
      hitDist = along;
    }
  }

  if (hitTarget) {
    if (onHit) onHit(hitTarget, GUN.damage, 'gun');
    else applyDamage(hitTarget, GUN.damage, plane);
    const tt = hitTarget.body.translation();
    spawnHitSpark(scene, new THREE.Vector3(tt.x, tt.y, tt.z));
  }

  // Muzzle flash + gunshot SFX
  spawnMuzzleFlash(scene, plane);
  sfxGunshot();

  // Tracer visual
  const end = _origin.clone().addScaledVector(_dir, hitDist);
  const geom = new THREE.BufferGeometry().setFromPoints([_origin.clone(), end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 1 });
  const line = new THREE.Line(geom, mat);
  scene.add(line);
  weapon.tracers.push({ line, ttl: 0.12 });
}
