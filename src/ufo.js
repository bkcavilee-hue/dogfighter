// UFO boss enemy. One spawns at the center of the arena; rotates slowly
// in place; periodically fires three green lasers in a 120°-spaced
// triangle aimed at the closest player.
//
// The boss exposes a "plane-like" surface (id, body{translation,rotation,
// linvel}, mesh, HP, alive, team, stats.colliderHalf) so existing helpers
// (minimap, soft-lock, weapon hit-tests, off-screen indicators) work
// without modification.
import * as THREE from 'three';
import { applyDamage } from './gamestate.js';
import { getArenaModel } from './models.js';
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

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Build the visible UFO mesh. Uses the loaded GLB if available, falls back
 *  to a simple disc + ring otherwise. Tints everything green. */
function buildMesh(getMeshFn) {
  let mesh = getMeshFn ? getMeshFn() : null;
  let usedGlb = false;
  if (mesh) {
    usedGlb = true;
    // Tint all sub-materials green by overriding emissive on every mesh.
    mesh.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if ('emissive' in m) m.emissive = new THREE.Color(UFO_GREEN);
          if ('emissiveIntensity' in m) m.emissiveIntensity = 0.8;
          if ('color' in m) m.color = new THREE.Color(0x88ffaa);
        }
      }
    });
    // NOTE: do NOT add a scale multiplier here. The preload step in
    // models.js already scaled the GLB to UFO_TARGET_LENGTH (24m).
  } else {
    mesh = new THREE.Group();
    // Fallback geometry sized to roughly match UFO_TARGET_LENGTH (24m wide).
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(10, 12, 2.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x88ffaa, emissive: UFO_GREEN, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.4 }),
    );
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xaaffcc, emissive: UFO_GREEN, emissiveIntensity: 0.6, transparent: true, opacity: 0.75 }),
    );
    dome.position.y = 1.5;
    mesh.add(disc, dome);
  }
  mesh.userData.usedGlb = usedGlb;
  // Tractor-beam cone — sized for a 24m UFO. Was 8m × 50m back when the
  // UFO mesh was double-scaled; now the cone lives in the UFO's actual
  // local frame, so we keep it modest so it doesn't dominate the view.
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(5, 28, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color: UFO_GREEN, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  cone.rotation.x = Math.PI; // tip points down
  cone.position.y = -16;     // hangs below the saucer
  cone.userData.isTractor = true;
  mesh.add(cone);
  return mesh;
}

/** Create a UFO boss entity. */
export function createUfoBoss({ scene, position, getMeshFn = null }) {
  const mesh = buildMesh(getMeshFn);
  mesh.position.copy(position);
  scene.add(mesh);

  // Add a brighter green point light so it's visible from far away.
  const halo = new THREE.PointLight(UFO_GREEN, 4.0, 600, 1.2);
  halo.position.copy(position).y += 4;
  scene.add(halo);

  // Damage indicator that floats above the UFO. Shown after first hit.
  const hpBar = attachHpBar(mesh, { width: 28, height: 2.0, yOffset: 22 });

  // Boot-time verification log — confirms the GLB loaded vs fallback.
  const usedGlb = !!mesh.userData.usedGlb;
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
    mesh,
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
    _beamState: 'idle',             // 'idle' | 'charging' | 'firing' | 'recover'
    _beamTimer: 0,
    _beamTarget: null,
    _beamLine: null,
    _beamLight: null,
    // Motion state.
    _spinX: Math.random() * 0.4 + 0.1,   // rad/s
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
    if (ufo.HP <= 0 && ufo.mesh && ufo.mesh.parent) {
      if (ufo.hpBar) ufo.hpBar.dispose();
      scene.remove(ufo.mesh);
      if (ufo.halo) scene.remove(ufo.halo);
      if (ufo._beamLine) scene.remove(ufo._beamLine);
      if (ufo._beamLight) scene.remove(ufo._beamLight);
      ufo.mesh = null;
    }
    return;
  }

  if (ufo.hpBar && camera) ufo.hpBar.update(camera, ufo.HP, ufo.maxHP);

  // ---- Motion: drift + bob + multi-axis spin ----------------------
  ufo._driftTimer -= dt;
  if (ufo._driftTimer <= 0) {
    const r = UFO_DRIFT_RADIUS;
    ufo._driftTarget.set(
      (Math.random() - 0.5) * 2 * r,
      350 + (Math.random() - 0.5) * 80,
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

  // Multi-axis spin
  ufo.mesh.rotation.y += ufo._spinY * dt;
  ufo.mesh.rotation.x += ufo._spinX * dt * 0.4;
  ufo.mesh.rotation.z += ufo._spinZ * dt * 0.3;

  // Tractor cone visibility — pulses when charging, holds bright when firing.
  const cone = ufo.mesh.children.find((c) => c.userData?.isTractor);
  if (cone) {
    let target = 0;
    if (ufo._beamState === 'charging') target = 0.4;
    else if (ufo._beamState === 'firing') target = 0.65;
    cone._opSmooth = (cone._opSmooth ?? 0);
    cone._opSmooth += (target - cone._opSmooth) * Math.min(1, 8 * dt);
    cone.material.opacity = cone._opSmooth;
    cone.visible = cone._opSmooth > 0.01;
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
    case 'firing':
      if (!target || target !== ufo._beamTarget || !ufo._beamTarget?.alive) {
        ufo._beamState = 'recover';
        ufo._beamTimer = UFO_BEAM_RECOVER_SEC;
        ufo._beamTarget = null;
      } else {
        applyBeamDamage(ufo, ufo._beamTarget, dt);
      }
      break;
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
