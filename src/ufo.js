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

const UFO_TEAM = 'ufo';            // distinct so all human teams treat it as an enemy
const UFO_HP = 700;                // ~10× a normal interceptor
const UFO_RADIUS = 8;              // collider for hit detection
const UFO_LASER_RANGE = 900;
const UFO_LASER_DAMAGE = 6;
const UFO_LASER_COOLDOWN = 3.0;    // s between volleys
const UFO_LASER_TTL = 0.25;        // visual lifetime per beam
const UFO_GREEN = 0x44ff77;
const UFO_DETECTION_RANGE = 1400;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Build the visible UFO mesh. Uses the loaded GLB if available, falls back
 *  to a simple disc + ring otherwise. Tints everything green. */
function buildMesh(getMeshFn) {
  let mesh = getMeshFn ? getMeshFn() : null;
  if (mesh) {
    // Tint all sub-materials green by overriding emissive on every mesh.
    mesh.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if ('emissive' in m) m.emissive = new THREE.Color(UFO_GREEN);
          if ('emissiveIntensity' in m) m.emissiveIntensity = 0.6;
          if ('color' in m) m.color = new THREE.Color(0x88ffaa);
        }
      }
    });
    // Scale up — UFO mesh defaults to plane-sized; we want it imposing.
    mesh.scale.setScalar(2.4);
  } else {
    // Fallback: glowing green disc with a top dome.
    mesh = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 9, 2, 24),
      new THREE.MeshStandardMaterial({ color: 0x88ffaa, emissive: UFO_GREEN, emissiveIntensity: 0.7, metalness: 0.5, roughness: 0.4 }),
    );
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xaaffcc, emissive: UFO_GREEN, emissiveIntensity: 0.4, transparent: true, opacity: 0.7 }),
    );
    dome.position.y = 1;
    mesh.add(disc, dome);
  }
  return mesh;
}

/** Create a UFO boss entity. */
export function createUfoBoss({ scene, position, getMeshFn = null }) {
  const mesh = buildMesh(getMeshFn);
  mesh.position.copy(position);
  scene.add(mesh);

  // Add a brighter green point light so it's visible from far away.
  const halo = new THREE.PointLight(UFO_GREEN, 1.5, 200, 1.4);
  halo.position.copy(position).y += 4;
  scene.add(halo);

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
    stats: {
      colliderHalf: { x: UFO_RADIUS, y: 4, z: UFO_RADIUS },
      maxHP: UFO_HP,
      missiles: 0,
    },
    body: makeStaticBody(position),
    _laserCD: 1.5,                  // first volley after a short delay
    _activeBeams: [],               // visual beam meshes
    color: UFO_GREEN,               // for minimap to use
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

/** Per-frame tick: hover spin, periodic 3-laser volleys at the closest target. */
export function updateUfoBoss(ufo, allPlanes, scene, dt) {
  if (!ufo.alive) {
    if (ufo.HP <= 0 && ufo.mesh.parent) {
      // Cleanup on death
      scene.remove(ufo.mesh);
      if (ufo.halo) scene.remove(ufo.halo);
      ufo.mesh = null;
    }
    return;
  }

  // Slow spin for visual flair.
  ufo.mesh.rotation.y += 0.6 * dt;

  // Find closest hostile (anything not on team UFO).
  let target = null;
  let bestDistSq = UFO_DETECTION_RANGE * UFO_DETECTION_RANGE;
  const pos = ufo.body.translation();
  for (const p of allPlanes) {
    if (!p.alive || p.team === ufo.team) continue;
    const tp = p.body.translation();
    const dx = tp.x - pos.x, dy = tp.y - pos.y, dz = tp.z - pos.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDistSq) {
      bestDistSq = d;
      target = p;
    }
  }

  // Cooldown ticking + volley.
  ufo._laserCD = Math.max(0, ufo._laserCD - dt);
  if (target && ufo._laserCD <= 0) {
    fireLaserVolley(ufo, target, allPlanes, scene);
    ufo._laserCD = UFO_LASER_COOLDOWN;
  }

  // Visual beam decay.
  for (let i = ufo._activeBeams.length - 1; i >= 0; i--) {
    const b = ufo._activeBeams[i];
    b.ttl -= dt;
    b.line.material.opacity = Math.max(0, b.ttl / UFO_LASER_TTL);
    if (b.ttl <= 0) {
      scene.remove(b.line);
      b.line.geometry.dispose();
      b.line.material.dispose();
      ufo._activeBeams.splice(i, 1);
    }
  }
}

/** Fire 3 lasers in a triangle (120° apart) — center direction aims at target. */
function fireLaserVolley(ufo, target, allPlanes, scene) {
  const pos = ufo.body.translation();
  const tp = target.body.translation();
  // Base direction toward target on horizontal plane (XZ); add small Y tilt.
  const baseDir = _v.set(tp.x - pos.x, 0, tp.z - pos.z).normalize();
  const baseAngle = Math.atan2(-baseDir.x, -baseDir.z);

  for (let i = 0; i < 3; i++) {
    const angle = baseAngle + (i * (Math.PI * 2 / 3));
    const dir = _v2.set(-Math.sin(angle), 0, -Math.cos(angle)).normalize();
    fireSingleLaser(ufo, dir, allPlanes, scene);
  }
}

function fireSingleLaser(ufo, dir, allPlanes, scene) {
  const pos = ufo.body.translation();
  const origin = new THREE.Vector3(pos.x, pos.y + 2, pos.z);

  // Hit-test: closest enemy plane along the ray within range.
  let hitDist = UFO_LASER_RANGE;
  let hitTarget = null;
  for (const p of allPlanes) {
    if (!p.alive || p.team === ufo.team) continue;
    const tp = p.body.translation();
    const to = _v.set(tp.x - origin.x, tp.y - origin.y, tp.z - origin.z);
    const along = to.dot(dir);
    if (along < 0 || along > hitDist) continue;
    const perpSq = to.lengthSq() - along * along;
    const r = (p.stats.colliderHalf?.x ?? 1.5) + 1.0;
    if (perpSq <= r * r) {
      hitTarget = p;
      hitDist = along;
    }
  }
  if (hitTarget) applyDamage(hitTarget, UFO_LASER_DAMAGE, ufo);

  // Visual beam.
  const end = origin.clone().addScaledVector(dir, hitDist);
  const geom = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const mat = new THREE.LineBasicMaterial({
    color: UFO_GREEN, transparent: true, opacity: 1, linewidth: 2,
  });
  const line = new THREE.Line(geom, mat);
  scene.add(line);
  ufo._activeBeams.push({ line, ttl: UFO_LASER_TTL });
}
