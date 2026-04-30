// Aircraft factory + flight controls.
// Geometry is a placeholder built from Three.js primitives so the game runs
// with zero asset files. Swap to a real .glb later by replacing
// `buildPlaceholderMesh` with a GLTFLoader call.
import * as THREE from 'three';
import { RAPIER, createRigidBody, createCollider } from './physics.js';
import { getPlaneMesh } from './models.js';

/** Stat presets per plane class — direct from the design doc. */
export const PLANE_STATS = {
  interceptor: {
    color: 0x4cb1ff,
    maxHP: 70,
    maxBoost: 140,
    boostDrainPerSec: 50,
    boostRegenPerSec: 38,
    minSpeed: 32,
    maxSpeed: 50,
    boostSpeed: 88,
    turnRateDegPerSec: 160,
    pitchRateDegPerSec: 130,
    rollRateDegPerSec: 240,
    missiles: 2,
    colliderHalf: { x: 1.4, y: 0.5, z: 1.8 },
    mass: 0.9,
  },
  striker: {
    color: 0xffaa3a,
    maxHP: 90,
    maxBoost: 130,
    boostDrainPerSec: 46,
    boostRegenPerSec: 42,
    minSpeed: 28,
    maxSpeed: 42,
    boostSpeed: 76,
    turnRateDegPerSec: 130,
    pitchRateDegPerSec: 110,
    rollRateDegPerSec: 200,
    missiles: 3,
    colliderHalf: { x: 1.6, y: 0.55, z: 2.0 },
    mass: 1.1,
  },
  bruiser: {
    color: 0xc04848,
    maxHP: 130,
    maxBoost: 120,
    boostDrainPerSec: 40,
    boostRegenPerSec: 46,
    minSpeed: 22,
    maxSpeed: 35,
    boostSpeed: 60,
    turnRateDegPerSec: 95,
    pitchRateDegPerSec: 85,
    rollRateDegPerSec: 150,
    missiles: 4,
    colliderHalf: { x: 2.0, y: 0.7, z: 2.5 },
    mass: 1.5,
  },
};

/** Build a chunky placeholder plane out of primitives. */
function buildPlaceholderMesh(color) {
  const group = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const matWing = new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.7 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.7 });

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, 3.2, 12), matBody);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 12), matBody);
  nose.position.z = -2.0;
  nose.rotation.x = -Math.PI / 2;
  group.add(nose);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), matGlass);
  cockpit.position.set(0, 0.35, -0.4);
  group.add(cockpit);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.1), matWing);
  wing.position.z = 0.2;
  group.add(wing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.6), matWing);
  tailWing.position.set(0, 0.15, 1.5);
  group.add(tailWing);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.7), matWing);
  fin.position.set(0, 0.45, 1.5);
  group.add(fin);

  group.traverse((c) => { c.castShadow = false; c.receiveShadow = false; });
  return group;
}

/** Slap a small colored disc under the plane so team is readable at a glance. */
function addTeamMarker(mesh, team) {
  const color = team === 'blue' ? 0x4caaff : 0xff7b6e;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.4, 24),
    new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.6;
  ring.userData.isTeamMarker = true;
  mesh.add(ring);
}

/** Create an aircraft entity. */
export function createAircraft({
  type = 'interceptor',
  position = { x: 0, y: 80, z: 0 },
  team = 'red',
  isPlayer = false,
  id = crypto.randomUUID?.() || String(Math.random()),
} = {}) {
  const stats = PLANE_STATS[type];
  // Prefer real GLB; fall back to placeholder if it didn't preload.
  const mesh = getPlaneMesh(type) || buildPlaceholderMesh(team === 'blue' ? 0x4caaff : stats.color);
  // Add a subtle team marker so red and blue are distinguishable when GLBs
  // are used (since real models share the same texture).
  addTeamMarker(mesh, team);

  const body = createRigidBody(position, null, 'dynamic');
  body.setLinearDamping(0.6);
  body.setAngularDamping(2.4);
  const cdesc = RAPIER.ColliderDesc
    .cuboid(stats.colliderHalf.x, stats.colliderHalf.y, stats.colliderHalf.z)
    .setDensity(stats.mass)
    .setRestitution(0.05);
  createCollider(body, cdesc);

  return {
    id,
    type,
    team,
    isPlayer,
    stats,
    mesh,
    body,
    // Runtime state
    HP: stats.maxHP,
    maxHP: stats.maxHP,
    boost: stats.maxBoost,
    maxBoost: stats.maxBoost,
    heat: 0,
    // Unlimited missiles, gated by a slow recharge cooldown.
    missileCD: 0,                 // seconds until next missile is ready
    missileReloadSec: 7,          // duration of full recharge
    flares: 5,
    maxFlares: 5,
    score: 0,
    speed: 0,
    throttle: 0.6,
    boostActive: false,
    invincibleTimer: 0,
    respawnTimer: 0,
    alive: true,
    // Maneuver state (loop / roll). Set by updateAircraft when triggered.
    _maneuver: null,
    _maneuverCD: 0,
  };
}

const _v3 = new THREE.Vector3();
const _q  = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0); // local right   (pitch axis)
const _axisY = new THREE.Vector3(0, 1, 0); // local up      (yaw axis)
const _axisZ = new THREE.Vector3(0, 0, 1); // local forward (roll axis)
const _qc    = new THREE.Quaternion();

/**
 * Arcade flight model — driven by an `intent` object so the same code drives
 * both the player and AI.
 *
 *   intent = {
 *     yaw:    -1..1   (left = +1, right = -1, matches A/D)
 *     pitch:  -1..1   (climb = +1, dive = -1, matches W/S)
 *     boost:  bool
 *     loopTap, rollLeftTap, rollRightTap: edge-triggered maneuvers
 *   }
 */
// Maneuvers are visual on the MESH (`visualAxis`/`visualAngle`) and never
// change the body's rotation — the camera stays steady because the underlying
// flight orientation isn't disturbed. Dodges add a lateral velocity push.
const MANEUVERS = {
  // Forward alley-oop: mesh does a 360° pitch while plane keeps cruising.
  loop:  {
    visualAxis: new THREE.Vector3(1, 0, 0),
    duration: 0.85, invuln: 0.4, cd: 4.0,
    dodgeSpeed: 0, dodgeDir: 0,
  },
  // Roll-left dodge: mesh rolls left, plane shoves leftward.
  rollL: {
    visualAxis: new THREE.Vector3(0, 0, 1),
    duration: 0.45, invuln: 0.35, cd: 2.5,
    dodgeSpeed: 45, dodgeDir: -1,
  },
  // Roll-right dodge: mirror of rollL.
  rollR: {
    visualAxis: new THREE.Vector3(0, 0, -1),
    duration: 0.45, invuln: 0.35, cd: 2.5,
    dodgeSpeed: 45, dodgeDir: 1,
  },
};

export function updateAircraft(plane, intent, dt) {
  if (!plane.alive) return;
  const s = plane.stats;
  const body = plane.body;

  // --- Boost ----------------------------------------------------------
  const wantsBoost = !!intent.boost && plane.boost > 0;
  plane.boostActive = wantsBoost;
  if (wantsBoost) {
    plane.boost = Math.max(0, plane.boost - s.boostDrainPerSec * dt);
  } else {
    plane.boost = Math.min(s.maxBoost, plane.boost + s.boostRegenPerSec * dt);
  }
  const speed = plane.boostActive ? s.boostSpeed : s.maxSpeed;

  // --- Cooldowns ------------------------------------------------------
  if (plane._maneuverCD > 0) plane._maneuverCD -= dt;
  if (plane.invincibleTimer > 0) plane.invincibleTimer -= dt;
  if (plane.missileCD > 0) plane.missileCD = Math.max(0, plane.missileCD - dt);

  // --- Read current orientation as a quaternion ----------------------
  const r = body.rotation();
  const q = _q.set(r.x, r.y, r.z, r.w);

  // --- Trigger a new maneuver -----------------------------------------
  if (!plane._maneuver && plane._maneuverCD <= 0) {
    let preset = null;
    if (intent.loopTap)        preset = MANEUVERS.loop;
    else if (intent.rollLeftTap)  preset = MANEUVERS.rollL;
    else if (intent.rollRightTap) preset = MANEUVERS.rollR;
    if (preset) {
      plane._maneuver = { ...preset, timer: preset.duration, visualAngle: 0 };
      plane.invincibleTimer = preset.invuln;
      plane._maneuverCD = preset.cd;
    }
  }

  // --- Execute maneuver (mesh-only rotation; body keeps cruising) ----
  if (plane._maneuver) {
    const m = plane._maneuver;
    m.visualAngle = (1 - m.timer / m.duration) * Math.PI * 2;

    const fwd = _v3.set(0, 0, -1).applyQuaternion(q);
    let vx = fwd.x * speed, vy = fwd.y * speed, vz = fwd.z * speed;
    if (m.dodgeSpeed) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const push = m.dodgeSpeed * m.dodgeDir;
      vx += right.x * push;
      vy += right.y * push;
      vz += right.z * push;
    }
    body.setLinvel({ x: vx, y: vy, z: vz }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    m.timer -= dt;
    if (m.timer <= 0) plane._maneuver = null;
    plane.speed = speed;
    return;
  }

  // --- Normal flight: pitch + yaw applied as LOCAL-FRAME rotations ---
  // Quaternion-only model — no Euler heading/pitch state is kept. This
  // means continuous pitch input traces a real vertical loop (no clamp
  // needed) and yaw always feels right relative to the cockpit.
  const yawAxisTarget = THREE.MathUtils.clamp(intent.yaw || 0, -1, 1);
  if (plane._yawSmoothed === undefined) plane._yawSmoothed = 0;
  plane._yawSmoothed += (yawAxisTarget - plane._yawSmoothed) * Math.min(1, 6.0 * dt);

  const pitchAxisTarget = THREE.MathUtils.clamp(intent.pitch || 0, -1, 1);
  if (plane._pitchSmoothed === undefined) plane._pitchSmoothed = 0;
  plane._pitchSmoothed += (pitchAxisTarget - plane._pitchSmoothed) * Math.min(1, 6.0 * dt);

  const yawDelta   = plane._yawSmoothed   * THREE.MathUtils.degToRad(s.turnRateDegPerSec)  * dt;
  let pitchDelta   = plane._pitchSmoothed * THREE.MathUtils.degToRad(s.pitchRateDegPerSec) * dt;

  // Clamp the pitch to ±80° so the camera, AI, and minimap stay in their
  // sane Euler-friendly ranges. We measure current pitch from the forward
  // vector's Y component (asin(fwd.y)) and never let the delta push past
  // the limit.
  const fwdNow = _v3.set(0, 0, -1).applyQuaternion(q);
  const currentPitch = Math.asin(THREE.MathUtils.clamp(fwdNow.y, -1, 1));
  const PITCH_LIMIT = THREE.MathUtils.degToRad(80);
  const newPitch = THREE.MathUtils.clamp(currentPitch + pitchDelta, -PITCH_LIMIT, PITCH_LIMIT);
  pitchDelta = newPitch - currentPitch;

  // Apply pitch then yaw in the plane's LOCAL frame.
  const dqPitch = _qa.setFromAxisAngle(_axisX, pitchDelta);
  const dqYaw   = _qb.setFromAxisAngle(_axisY, yawDelta);
  q.multiply(dqPitch).multiply(dqYaw);
  q.normalize();

  body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);

  const forward = _v3.set(0, 0, -1).applyQuaternion(q);
  body.setLinvel({ x: forward.x * speed, y: forward.y * speed, z: forward.z * speed }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);

  plane.speed = speed;
}
