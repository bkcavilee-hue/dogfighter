// UFO boss enemy. Drifts around the arena and fires homing missiles
// (MISSILE_SLOW profile) at the closest hostile player on a fixed cooldown.
// Tractor-beam cone and sustained beam laser removed per request.
//
// The boss exposes a "plane-like" surface (id, body{translation,rotation,
// linvel}, mesh, HP, alive, team, stats.colliderHalf) so existing helpers
// (minimap, soft-lock, weapon hit-tests, off-screen indicators) work
// without modification.
import * as THREE from 'three';
import { attachHpBar } from './enemy-hpbar.js';
import { fireMissile, MISSILE_SLOW } from './missiles.js';

const UFO_TEAM = 'ufo';
const UFO_HP = 700;                  // ~10× interceptor
const UFO_RADIUS = 8;
// Missile-fire profile (replaces the old sustained beam laser).
const UFO_MISSILE_RANGE = 1100;      // slightly longer than detection-cone fire range
const UFO_MISSILE_COOLDOWN = 4.0;    // seconds between launches when target available
const UFO_MISSILE_INITIAL_DELAY = 2.5; // grace period after spawn
const UFO_GREEN = 0x44ff77;
const UFO_DETECTION_RANGE = 1400;
const UFO_DRIFT_SPEED = 6;           // m/s drift between waypoints
const UFO_DRIFT_RADIUS = 200;        // wander region around origin
const UFO_SPAWN_Y = 380;             // matches engine.js spawn position

/** Build the visible UFO mesh.
 *
 *  Two-layer scene graph — outer Group (`root`) holds the spinning saucer
 *  AND the HP bar as siblings. The saucer (`spinner`) is the only thing
 *  that gets the multi-axis spin each frame; the HP bar stays world-up
 *  level so it reads as a damage indicator.
 *
 *  Returns { root, spinner, usedGlb } so the caller can attach the HP
 *  bar to root (not spinner) and drive spin on spinner.rotation each tick.
 */
function buildMesh(getMeshFn) {
  const root = new THREE.Group();
  let spinner = getMeshFn ? getMeshFn() : null;
  let usedGlb = false;
  if (spinner) {
    usedGlb = true;
    // BUG FIX: previously this overwrote BOTH `m.color` AND `m.emissive` on
    // every material in the GLB, which washed all surface detail / textures
    // out into a solid green silhouette. Materials are also shared between
    // the prototype and clones — so the override leaked across instances.
    // New behaviour: clone each material (so the prototype stays untouched),
    // then apply only a SUBTLE green emissive accent. The GLB's authored
    // base color / textures show through.
    spinner.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cloned = mats.map((m) => m.clone());
        for (const m of cloned) {
          if ('emissive' in m) m.emissive = new THREE.Color(UFO_GREEN);
          if ('emissiveIntensity' in m) m.emissiveIntensity = 0.25;
        }
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
      }
    });
    // NOTE: don't add a scale multiplier — preload in models.js already
    // scaled the GLB to UFO_TARGET_LENGTH (24m).
  } else {
    spinner = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(10, 12, 2.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x88ffaa, emissive: UFO_GREEN, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.4 }),
    );
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xaaffcc, emissive: UFO_GREEN, emissiveIntensity: 0.6, transparent: true, opacity: 0.75 }),
    );
    dome.position.y = 1.5;
    spinner.add(disc, dome);
  }
  root.add(spinner);
  root.userData.usedGlb = usedGlb;
  return { root, spinner, usedGlb };
}

/** Create a UFO boss entity. */
export function createUfoBoss({ scene, position, getMeshFn = null }) {
  const { root, spinner, usedGlb } = buildMesh(getMeshFn);
  root.position.copy(position);
  scene.add(root);

  // Bright green halo light — visible from far away.
  const halo = new THREE.PointLight(UFO_GREEN, 4.0, 600, 1.2);
  halo.position.copy(position).y += 4;
  scene.add(halo);

  // HP bar attached to ROOT (not spinner) so it doesn't tumble with
  // the saucer's spin. Hidden until first damage.
  const hpBar = attachHpBar(root, { width: 28, height: 2.0, yOffset: 22 });

  console.log(`[ufo] boss spawned at (${position.x.toFixed(0)},${position.y.toFixed(0)},${position.z.toFixed(0)}) using ${usedGlb ? 'GLB' : 'fallback geometry'}`);

  return {
    id: 'ufo-boss',
    name: 'UFO',
    type: 'ufo',
    team: UFO_TEAM,
    isPlayer: false,
    isUfo: true,
    HP: UFO_HP,
    maxHP: UFO_HP,
    score: 0,
    speed: 0,
    alive: true,
    invincibleTimer: 0,
    respawnTimer: 0,
    flares: 0,
    maxFlares: 0,
    missileCD: 0,
    missileReloadSec: 99,
    boost: 0,
    maxBoost: 0,
    heat: 0,
    // `mesh` is the root group — engine.js syncMesh treats it like a
    // plane mesh, so position sync goes through the parent transform.
    mesh: root,
    spinner,
    halo,
    hpBar,
    stats: {
      colliderHalf: { x: UFO_RADIUS, y: 4, z: UFO_RADIUS },
      maxHP: UFO_HP,
      missiles: 0,
    },
    body: makeStaticBody(position),
    color: UFO_GREEN,
    // Missile-launcher state (replaces the old beam state machine).
    _missileCD: UFO_MISSILE_INITIAL_DELAY,
    // Motion state.
    _spinX: Math.random() * 0.4 + 0.1,
    _spinY: Math.random() * 0.6 + 0.4,
    _spinZ: Math.random() * 0.3 + 0.1,
    _bobPhase: Math.random() * Math.PI * 2,
    _driftTarget: position.clone(),
    _driftTimer: 0,
  };
}

function makeStaticBody(position) {
  const _pos = new THREE.Vector3().copy(position);
  const _rot = new THREE.Quaternion();
  const _vel = new THREE.Vector3();
  return {
    _position: _pos, _rotation: _rot, _velocity: _vel,
    translation() { return { x: _pos.x, y: _pos.y, z: _pos.z }; },
    rotation()    { return { x: _rot.x, y: _rot.y, z: _rot.z, w: _rot.w }; },
    linvel()      { return { x: 0, y: 0, z: 0 }; },
    setTranslation(p) { _pos.set(p.x, p.y, p.z); },
    setLinvel() { /* static */ },
    setAngvel() { /* static */ },
    setRotation(q) { _rot.set(q.x, q.y, q.z, q.w); },
  };
}

/** Per-frame tick: drift / spin / bob, then missile-launcher cooldown.
 *  `missiles` array is appended to when the UFO fires a homing missile.
 */
export function updateUfoBoss(ufo, allPlanes, scene, dt, camera = null, missiles = null) {
  if (!ufo.alive) {
    // Cleanup runs whenever the UFO is no longer alive — no longer
    // gated on HP <= 0 (mesh would have leaked if alive flipped some
    // other way).
    if (ufo.mesh && ufo.mesh.parent) {
      if (ufo.hpBar) ufo.hpBar.dispose();
      scene.remove(ufo.mesh);
      if (ufo.halo) scene.remove(ufo.halo);
      ufo.mesh = null;
    }
    return;
  }

  if (ufo.hpBar && camera) ufo.hpBar.update(camera, ufo.HP, ufo.maxHP);

  // ---- Motion: drift + bob ----------------------------------------
  ufo._driftTimer -= dt;
  if (ufo._driftTimer <= 0) {
    const r = UFO_DRIFT_RADIUS;
    // Drift target altitude stays near the spawn altitude rather than
    // dropping to the old hard-coded 350m floor.
    ufo._driftTarget.set(
      (Math.random() - 0.5) * 2 * r,
      UFO_SPAWN_Y + (Math.random() - 0.5) * 80,
      (Math.random() - 0.5) * 2 * r,
    );
    ufo._driftTimer = 6 + Math.random() * 4;
  }
  const cur = ufo.body.translation();
  const dx = ufo._driftTarget.x - cur.x;
  const dy = ufo._driftTarget.y - cur.y;
  const dz = ufo._driftTarget.z - cur.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const step = Math.min(UFO_DRIFT_SPEED * dt, dist);
  ufo._bobPhase += dt;
  const bob = Math.sin(ufo._bobPhase * 0.6) * 4;
  const newX = cur.x + (dx / dist) * step;
  const newY = cur.y + (dy / dist) * step + bob * dt;
  const newZ = cur.z + (dz / dist) * step;
  ufo.body.setTranslation({ x: newX, y: newY, z: newZ });
  ufo.mesh.position.set(newX, newY, newZ);
  if (ufo.halo) ufo.halo.position.set(newX, newY + 4, newZ);

  // Multi-axis spin — only on the SPINNER child group, never the root.
  // Keeps the HP bar (sibling of spinner) world-up level.
  if (ufo.spinner) {
    ufo.spinner.rotation.y += ufo._spinY * dt;
    ufo.spinner.rotation.x += ufo._spinX * dt * 0.4;
    ufo.spinner.rotation.z += ufo._spinZ * dt * 0.3;
  }

  // ---- Find closest hostile target ---------------------------------
  let target = null;
  let bestDistSq = UFO_DETECTION_RANGE * UFO_DETECTION_RANGE;
  for (const p of allPlanes) {
    if (!p.alive || p.team === ufo.team) continue;
    const tp = p.body.translation();
    const ddx = tp.x - newX, ddy = tp.y - newY, ddz = tp.z - newZ;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d < bestDistSq) { bestDistSq = d; target = p; }
  }

  // ---- Missile launcher: cooldown-based fire on the closest hostile.
  // The UFO tilts the missile origin slightly forward+up of the saucer's
  // centroid so the missile doesn't spawn inside the dome. Uses MISSILE_SLOW
  // profile so the player has time to flare or evade.
  ufo._missileCD = Math.max(0, ufo._missileCD - dt);
  if (target && missiles && ufo._missileCD <= 0) {
    const tp = target.body.translation();
    const rx = tp.x - newX, ry = tp.y - newY, rz = tp.z - newZ;
    const distSq = rx * rx + ry * ry + rz * rz;
    if (distSq <= UFO_MISSILE_RANGE * UFO_MISSILE_RANGE) {
      const shot = fireMissile({
        shooter: ufo,
        target,
        scene,
        profile: MISSILE_SLOW,
      });
      // The UFO's static body has identity rotation, so fireMissile would
      // launch the missile down world -Z by default. Re-aim it directly at
      // the target with proper offset so it doesn't spawn inside the saucer.
      const dist = Math.sqrt(distSq) || 1;
      const dx = rx / dist, dy = ry / dist, dz = rz / dist;
      shot.pos.set(newX + dx * 10, newY + dy * 10 + 2, newZ + dz * 10);
      shot.vel.set(dx * MISSILE_SLOW.initialSpeed, dy * MISSILE_SLOW.initialSpeed, dz * MISSILE_SLOW.initialSpeed);
      shot.mesh.position.copy(shot.pos);
      missiles.push(shot);
      ufo._missileCD = UFO_MISSILE_COOLDOWN;
    }
  }
}
