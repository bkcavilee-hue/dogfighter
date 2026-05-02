// UFO boss enemy. Drifts around the arena, fires a sustained green beam
// at the closest player. Tractor-beam cone removed per request.
//
// The boss exposes a "plane-like" surface (id, body{translation,rotation,
// linvel}, mesh, HP, alive, team, stats.colliderHalf) so existing helpers
// (minimap, soft-lock, weapon hit-tests, off-screen indicators) work
// without modification.
import * as THREE from 'three';
import { applyDamage } from './gamestate.js';
import { attachHpBar } from './enemy-hpbar.js';

const UFO_TEAM = 'ufo';
const UFO_HP = 700;                  // ~10× interceptor
const UFO_RADIUS = 8;
const UFO_LASER_RANGE = 900;
const UFO_LASER_DPS = 10;            // damage per second while sustained beam connects
const UFO_BEAM_CHARGE_SEC = 0.4;     // wind-up before beam ignites
const UFO_BEAM_RECOVER_SEC = 0.6;    // brief pause if target lost / dies
const UFO_GREEN = 0x44ff77;
const UFO_DETECTION_RANGE = 1400;
const UFO_DRIFT_SPEED = 6;           // m/s drift between waypoints
const UFO_DRIFT_RADIUS = 200;        // wander region around origin
const UFO_SPAWN_Y = 480;             // matches engine.js spawn position

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
    spinner.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if ('emissive' in m) m.emissive = new THREE.Color(UFO_GREEN);
          if ('emissiveIntensity' in m) m.emissiveIntensity = 0.8;
          if ('color' in m) m.color = new THREE.Color(0x88ffaa);
        }
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
    // Sustained beam state.
    _beamState: 'idle',
    _beamTimer: 0,
    _beamTarget: null,
    _beamLine: null,
    _beamLight: null,
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

/** Per-frame tick: drift / spin / bob, then sustained beam state machine. */
export function updateUfoBoss(ufo, allPlanes, scene, dt, camera = null) {
  if (!ufo.alive) {
    // Cleanup runs whenever the UFO is no longer alive — no longer
    // gated on HP <= 0 (mesh would have leaked if alive flipped some
    // other way).
    if (ufo.mesh && ufo.mesh.parent) {
      if (ufo.hpBar) ufo.hpBar.dispose();
      scene.remove(ufo.mesh);
      if (ufo.halo) scene.remove(ufo.halo);
      if (ufo._beamLine) {
        scene.remove(ufo._beamLine);
        ufo._beamLine.geometry.dispose();
        ufo._beamLine.material.dispose();
        ufo._beamLine = null;
      }
      if (ufo._beamLight) {
        scene.remove(ufo._beamLight);
        ufo._beamLight = null;
      }
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

  // ---- Sustained beam state machine --------------------------------
  ufo._beamTimer = Math.max(0, ufo._beamTimer - dt);
  switch (ufo._beamState) {
    case 'idle':
      if (target) {
        ufo._beamState = 'charging';
        ufo._beamTimer = UFO_BEAM_CHARGE_SEC;
        ufo._beamTarget = target;
      }
      break;
    case 'charging':
      if (!target) {
        ufo._beamState = 'idle';
        ufo._beamTarget = null;
      } else if (ufo._beamTimer <= 0) {
        ufo._beamState = 'firing';
        ufo._beamTarget = target;
      }
      break;
    case 'firing': {
      // FIX: drop to recover when target dies, switches identity, OR
      // moves beyond laser range. Previously the beam stayed visually
      // attached to a fleeing target while doing zero damage.
      const tgt = ufo._beamTarget;
      const lost = !target || target !== tgt || !tgt?.alive;
      let outOfRange = false;
      if (!lost && tgt) {
        const tp = tgt.body.translation();
        const rx = tp.x - newX, ry = tp.y - newY, rz = tp.z - newZ;
        outOfRange = (rx * rx + ry * ry + rz * rz) > UFO_LASER_RANGE * UFO_LASER_RANGE;
      }
      if (lost || outOfRange) {
        ufo._beamState = 'recover';
        ufo._beamTimer = UFO_BEAM_RECOVER_SEC;
        ufo._beamTarget = null;
      } else {
        applyBeamDamage(ufo, tgt, dt);
      }
      break;
    }
    case 'recover':
      if (ufo._beamTimer <= 0) ufo._beamState = 'idle';
      break;
  }

  // ---- Beam visual: a green line from boss to target while charging
  //      or firing. Pulses thicker/brighter when firing.
  const showBeam = (ufo._beamState === 'charging' || ufo._beamState === 'firing') && (ufo._beamTarget || target);
  if (showBeam) {
    const tgt = ufo._beamTarget || target;
    const tp = tgt.body.translation();
    const origin = new THREE.Vector3(newX, newY + 2, newZ);
    const end = new THREE.Vector3(tp.x, tp.y, tp.z);
    if (!ufo._beamLine) {
      const geom = new THREE.BufferGeometry().setFromPoints([origin, end]);
      const mat = new THREE.LineBasicMaterial({
        color: UFO_GREEN, transparent: true, opacity: 1.0,
      });
      ufo._beamLine = new THREE.Line(geom, mat);
      scene.add(ufo._beamLine);
      ufo._beamLight = new THREE.PointLight(UFO_GREEN, 1.5, 80, 1.5);
      scene.add(ufo._beamLight);
    }
    const positions = ufo._beamLine.geometry.attributes.position.array;
    positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
    positions[3] = end.x;    positions[4] = end.y;    positions[5] = end.z;
    ufo._beamLine.geometry.attributes.position.needsUpdate = true;
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.04);
    ufo._beamLine.material.opacity = ufo._beamState === 'firing' ? pulse : pulse * 0.55;
    if (ufo._beamLight) {
      ufo._beamLight.position.copy(origin).lerp(end, 0.5);
      ufo._beamLight.intensity = ufo._beamState === 'firing' ? 1.5 : 0.6;
    }
  } else if (ufo._beamLine) {
    scene.remove(ufo._beamLine);
    ufo._beamLine.geometry.dispose();
    ufo._beamLine.material.dispose();
    ufo._beamLine = null;
    if (ufo._beamLight) scene.remove(ufo._beamLight);
    ufo._beamLight = null;
  }
}

/** Continuous DPS application — only counts when target is in range. */
function applyBeamDamage(ufo, target, dt) {
  if (!target || !target.alive) return;
  const pos = ufo.body.translation();
  const tp = target.body.translation();
  const dx = tp.x - pos.x, dy = tp.y - pos.y, dz = tp.z - pos.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > UFO_LASER_RANGE) return;
  applyDamage(target, UFO_LASER_DPS * dt, ufo);
}
