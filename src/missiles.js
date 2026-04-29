// Homing missiles. Lightweight: no rigid body, just a position+velocity that
// steers toward a target with a capped turn rate. Renders as a small cylinder
// with a fading smoke trail.
import * as THREE from 'three';
import { applyDamage } from './gamestate.js';
import { spawnExplosion } from './fx.js';
import { sfxMissileLaunch, sfxExplosion } from './audio.js';

export const MISSILE = {
  initialSpeed: 35,
  maxSpeed: 120,                // slower — player boost (125) can outpace briefly, but missile is more agile
  acceleration: 50,             // m/s²
  turnRateDegPerSec: 90,        // how sharply it can chase
  ttl: 8.0,                     // seconds before it self-destructs
  damage: 45,
  hitRadius: 6.0,               // m
  lockConeDeg: 35,              // for acquisition (used by engine)
  lockRange: 700,
  trailMaxPoints: 24,
  trailSampleInterval: 0.04,    // s between trail samples
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/* -----------------------------------------------------------------------
 * Acquisition
 * --------------------------------------------------------------------- */
/**
 * Find the best missile target for a plane: enemy team, alive, in forward
 * cone, within range. Closest-and-most-centered wins.
 */
export function findMissileLock(plane, allPlanes) {
  const r = plane.body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const fwd = _v.set(0, 0, -1).applyQuaternion(q);
  const pp = plane.body.translation();
  const cosCone = Math.cos(THREE.MathUtils.degToRad(MISSILE.lockConeDeg));

  let best = null;
  let bestScore = -Infinity;
  for (const o of allPlanes) {
    if (o === plane || !o.alive || o.team === plane.team) continue;
    const op = o.body.translation();
    const dx = op.x - pp.x, dy = op.y - pp.y, dz = op.z - pp.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > MISSILE.lockRange) continue;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(dist, 1e-3);
    if (dot < cosCone) continue;
    const score = dot * 200 - dist; // prefer centered + close
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/* -----------------------------------------------------------------------
 * Spawn
 * --------------------------------------------------------------------- */
export function fireMissile({ shooter, target, scene }) {
  const r = shooter.body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const fwd = _v.set(0, 0, -1).applyQuaternion(q).clone();
  const t = shooter.body.translation();

  // Spawn a meter ahead of the nose so the missile doesn't collide with the
  // shooter on frame 1.
  const pos = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(fwd, 6);
  const vel = fwd.clone().multiplyScalar(MISSILE.initialSpeed);

  // Inherit shooter velocity so the missile doesn't appear to slow down.
  const sv = shooter.body.linvel();
  vel.add(new THREE.Vector3(sv.x, sv.y, sv.z).multiplyScalar(0.7));

  // Visual: small cylinder
  const geom = new THREE.CylinderGeometry(0.18, 0.18, 1.4, 8);
  geom.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xddd7c0, metalness: 0.4, roughness: 0.6 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  scene.add(mesh);

  // Trail: a Line that we extend each tick.
  const trailGeom = new THREE.BufferGeometry();
  trailGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MISSILE.trailMaxPoints * 3), 3));
  trailGeom.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({ color: 0xddddff, transparent: true, opacity: 0.55 });
  const trail = new THREE.Line(trailGeom, trailMat);
  scene.add(trail);

  sfxMissileLaunch();

  return {
    pos,
    vel,
    target,            // may go null if it dies
    shooter,
    speed: MISSILE.initialSpeed,
    ttl: MISSILE.ttl,
    mesh,
    trail,
    trailPoints: [pos.clone()],
    trailTimer: 0,
    alive: true,
  };
}

/* -----------------------------------------------------------------------
 * Tick all missiles
 * --------------------------------------------------------------------- */
export function updateMissiles(missiles, allPlanes, scene, dt, onHit = null) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    if (!m.alive) {
      destroyMissile(m, scene);
      missiles.splice(i, 1);
      continue;
    }

    // --- Steering ----------------------------------------------------
    if (m.target && m.target.alive) {
      // Target may be a plane (.body) or a flare (.pos/.vel).
      const tp = m.target.body ? m.target.body.translation() : m.target.pos;
      const tv = m.target.body ? m.target.body.linvel()      : m.target.vel;
      // Lead the target a little.
      const lead = 0.25;
      const desiredDir = _v.set(
        tp.x + tv.x * lead - m.pos.x,
        tp.y + tv.y * lead - m.pos.y,
        tp.z + tv.z * lead - m.pos.z
      ).normalize();

      const curDir = _v2.copy(m.vel).normalize();
      const cosAngle = THREE.MathUtils.clamp(curDir.dot(desiredDir), -1, 1);
      const angle = Math.acos(cosAngle);
      const maxTurn = THREE.MathUtils.degToRad(MISSILE.turnRateDegPerSec) * dt;
      const t = angle > 1e-4 ? Math.min(1, maxTurn / angle) : 1;
      curDir.lerp(desiredDir, t).normalize();

      m.speed = Math.min(MISSILE.maxSpeed, m.speed + MISSILE.acceleration * dt);
      m.vel.copy(curDir.multiplyScalar(m.speed));
    } else {
      // Lost target → fly straight.
      m.target = null;
    }

    // --- Move --------------------------------------------------------
    m.pos.addScaledVector(m.vel, dt);
    m.mesh.position.copy(m.pos);
    if (m.vel.lengthSq() > 1e-4) {
      m.mesh.lookAt(m.pos.clone().add(m.vel));
    }

    // --- Trail -------------------------------------------------------
    m.trailTimer -= dt;
    if (m.trailTimer <= 0) {
      m.trailTimer = MISSILE.trailSampleInterval;
      m.trailPoints.push(m.pos.clone());
      if (m.trailPoints.length > MISSILE.trailMaxPoints) m.trailPoints.shift();
      const arr = m.trail.geometry.attributes.position.array;
      for (let p = 0; p < m.trailPoints.length; p++) {
        arr[p * 3 + 0] = m.trailPoints[p].x;
        arr[p * 3 + 1] = m.trailPoints[p].y;
        arr[p * 3 + 2] = m.trailPoints[p].z;
      }
      m.trail.geometry.attributes.position.needsUpdate = true;
      m.trail.geometry.setDrawRange(0, m.trailPoints.length);
    }

    // --- Lifetime ----------------------------------------------------
    m.ttl -= dt;
    if (m.ttl <= 0) {
      m.alive = false;
      continue;
    }

    // --- Flare detonation: if chasing a flare and we reach it, fizzle.
    if (m.target && !m.target.body) {
      const fp = m.target.pos;
      const dx = fp.x - m.pos.x, dy = fp.y - m.pos.y, dz = fp.z - m.pos.z;
      if (dx * dx + dy * dy + dz * dz < (MISSILE.hitRadius * 1.5) ** 2) {
        spawnExplosion(scene, m.pos.clone(), { count: 14, radius: 5, ttl: 0.6, color: 0xfff0a0 });
        sfxExplosion();
        m.alive = false;
        continue;
      }
    }

    // --- Hit test against all planes (skip shooter for first 0.3s) --
    for (const p of allPlanes) {
      if (!p.alive) continue;
      if (p === m.shooter && (MISSILE.ttl - m.ttl) < 0.3) continue;
      if (p.team === m.shooter.team) continue; // no friendly fire
      const pp = p.body.translation();
      const dx = pp.x - m.pos.x, dy = pp.y - m.pos.y, dz = pp.z - m.pos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const r = MISSILE.hitRadius + Math.max(p.stats.colliderHalf.x, p.stats.colliderHalf.z);
      if (distSq < r * r) {
        if (onHit) onHit(p, MISSILE.damage, 'missile', m.shooter);
        else applyDamage(p, MISSILE.damage, m.shooter);
        spawnExplosion(scene, m.pos.clone(), { count: 32, radius: 9, ttl: 1.0 });
        sfxExplosion();
        m.alive = false;
        break;
      }
    }
  }
}

function destroyMissile(m, scene) {
  scene.remove(m.mesh);
  m.mesh.geometry.dispose();
  m.mesh.material.dispose();
  scene.remove(m.trail);
  m.trail.geometry.dispose();
  m.trail.material.dispose();
}
