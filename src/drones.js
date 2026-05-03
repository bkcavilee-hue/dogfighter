// UFO2 drones: 3 small flying enemies orbiting the desert center. Each
// fires a rapid-fire low-DPS laser at the closest player. (Mines used to
// be deployed by drones — the mine system was removed.)
import * as THREE from 'three';
import { applyDamage } from './gamestate.js';
import { attachHpBar } from './enemy-hpbar.js';

const DRONE_TEAM = 'ufo';
const DRONE_HP = 25;                          // weaker — was 60, easier to pop
const DRONE_RADIUS = 3.0;
const DRONE_LASER_DAMAGE = 0.7;             // also softer per-shot damage
const DRONE_LASER_RANGE = 500;
const DRONE_LASER_TTL = 0.08;
const DRONE_LASER_COLOR = 0x44ff77;
const DRONE_DETECTION_RANGE = 700;
const DRONE_ORBIT_RADIUS = 220;
const DRONE_ORBIT_SPEED = 0.25;             // rad/sec base
const DRONE_HEIGHT = 320;
// Burst fire pattern.
const DRONE_BURST_COUNT = 3;
const DRONE_BURST_SHOT_INTERVAL = 0.13;     // s between shots in a burst
const DRONE_BURST_REST = 1.5;               // s between bursts

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/* ------------------------- Drones ----------------------------------- */

export function createDrones({ scene, getMeshFn = null }) {
  const drones = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const x = Math.cos(angle) * DRONE_ORBIT_RADIUS;
    const z = Math.sin(angle) * DRONE_ORBIT_RADIUS;
    drones.push(createDrone({ scene, getMeshFn, position: new THREE.Vector3(x, DRONE_HEIGHT, z), orbitPhase: angle, index: i }));
  }
  // Verify all 3 drones spawned with their meshes attached to the scene.
  const usedGlb = !!getMeshFn && drones.every((d) => d.mesh && d.mesh.children.length > 0);
  console.log(`[ufo] ${drones.length} drone(s) spawned using ${usedGlb ? 'GLB' : 'fallback geometry'}`);
  return drones;
}

function createDrone({ scene, getMeshFn, position, orbitPhase, index }) {
  let mesh = getMeshFn ? getMeshFn() : null;
  if (mesh) {
    mesh.scale.setScalar(0.7);
    mesh.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if ('emissive' in m) m.emissive = new THREE.Color(DRONE_LASER_COLOR);
          if ('emissiveIntensity' in m) m.emissiveIntensity = 0.5;
        }
      }
    });
  } else {
    mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.5, 1),
      new THREE.MeshStandardMaterial({
        color: 0x99ffaa, emissive: DRONE_LASER_COLOR, emissiveIntensity: 0.7,
        metalness: 0.5, roughness: 0.4,
      }),
    );
  }
  mesh.position.copy(position);
  scene.add(mesh);

  const halo = new THREE.PointLight(DRONE_LASER_COLOR, 0.8, 80, 1.4);
  halo.position.copy(position);
  scene.add(halo);

  // Drone damage indicator — smaller bar than the boss.
  const hpBar = attachHpBar(mesh, { width: 8, height: 0.7, yOffset: 5 });

  return {
    id: `drone-${index}`,
    name: `DRONE-${index + 1}`,
    type: 'drone',
    team: DRONE_TEAM,
    isUfo: true,
    isPlayer: false,
    HP: DRONE_HP, maxHP: DRONE_HP,
    score: 0, speed: 0,
    alive: true,
    invincibleTimer: 0,
    respawnTimer: 0,
    flares: 0, maxFlares: 0,
    missileCD: 0, missileReloadSec: 99,
    boost: 0, maxBoost: 0, heat: 0,
    mesh, halo, hpBar,
    stats: { colliderHalf: { x: DRONE_RADIUS, y: DRONE_RADIUS, z: DRONE_RADIUS }, maxHP: DRONE_HP, missiles: 0 },
    body: makeOrbitBody(position),
    orbitPhase,
    orbitRadius: DRONE_ORBIT_RADIUS,
    color: DRONE_LASER_COLOR,
    // Burst fire state
    _burstShotsLeft: 0,
    _burstNextShotAt: 0,
    _burstRestTimer: 0,
    _activeBeams: [],
    // Multi-axis spin & bob (per-drone seeds)
    _spinX: Math.random() * 0.6 + 0.3,
    _spinY: Math.random() * 1.2 + 0.6,
    _spinZ: Math.random() * 0.6 + 0.3,
    _bobPhase: Math.random() * Math.PI * 2,
    _bobAmp: 8 + Math.random() * 4,
    _bobSpeed: 0.6 + Math.random() * 0.5,
  };
}

function makeOrbitBody(position) {
  const _pos = new THREE.Vector3().copy(position);
  const _rot = new THREE.Quaternion();
  return {
    _position: _pos, _rotation: _rot,
    translation() { return { x: _pos.x, y: _pos.y, z: _pos.z }; },
    rotation()    { return { x: _rot.x, y: _rot.y, z: _rot.z, w: _rot.w }; },
    linvel()      { return { x: 0, y: 0, z: 0 }; },
    setTranslation(p) { _pos.set(p.x, p.y, p.z); },
    setLinvel() {},
    setAngvel() {},
    setRotation(q) { _rot.set(q.x, q.y, q.z, q.w); },
  };
}

/* Per-frame: orbit and fire laser. */
export function updateDrones(drones, allPlanes, scene, dt, camera = null) {
  for (const d of drones) {
    if (!d.alive) {
      if (d.HP <= 0 && d.mesh && d.mesh.parent) {
        if (d.hpBar) d.hpBar.dispose();
        scene.remove(d.mesh);
        if (d.halo) scene.remove(d.halo);
        d.mesh = null;
      }
      continue;
    }
    if (d.hpBar && camera) d.hpBar.update(camera, d.HP, d.maxHP);

    // Orbit + vertical bob.
    d.orbitPhase += DRONE_ORBIT_SPEED * dt;
    d._bobPhase += d._bobSpeed * dt;
    const x = Math.cos(d.orbitPhase) * d.orbitRadius;
    const z = Math.sin(d.orbitPhase) * d.orbitRadius;
    const y = DRONE_HEIGHT + Math.sin(d._bobPhase) * d._bobAmp;
    d.body._position.set(x, y, z);
    d.mesh.position.set(x, y, z);
    // Multi-axis spin
    d.mesh.rotation.y += d._spinY * dt;
    d.mesh.rotation.x += d._spinX * dt * 0.5;
    d.mesh.rotation.z += d._spinZ * dt * 0.4;
    if (d.halo) d.halo.position.set(x, y, z);

    // Find closest hostile.
    const target = findClosest(d, allPlanes);

    // Burst-fire state machine: BURSTING → RESTING → BURSTING …
    if (target) {
      d._burstRestTimer = Math.max(0, d._burstRestTimer - dt);
      d._burstNextShotAt = Math.max(0, d._burstNextShotAt - dt);
      if (d._burstShotsLeft > 0) {
        if (d._burstNextShotAt <= 0) {
          fireDroneLaser(d, target, allPlanes, scene);
          d._burstShotsLeft -= 1;
          d._burstNextShotAt = DRONE_BURST_SHOT_INTERVAL;
          if (d._burstShotsLeft === 0) d._burstRestTimer = DRONE_BURST_REST;
        }
      } else if (d._burstRestTimer <= 0) {
        d._burstShotsLeft = DRONE_BURST_COUNT;
        d._burstNextShotAt = 0;
      }
    } else {
      d._burstShotsLeft = 0;
      d._burstRestTimer = 0;
    }

    // Tick lasers.
    for (let i = d._activeBeams.length - 1; i >= 0; i--) {
      const b = d._activeBeams[i];
      b.ttl -= dt;
      b.line.material.opacity = Math.max(0, b.ttl / DRONE_LASER_TTL);
      if (b.ttl <= 0) {
        scene.remove(b.line);
        b.line.geometry.dispose();
        b.line.material.dispose();
        d._activeBeams.splice(i, 1);
      }
    }
  }
}

function findClosest(drone, allPlanes) {
  let best = null;
  let bestSq = DRONE_DETECTION_RANGE * DRONE_DETECTION_RANGE;
  const dp = drone.body.translation();
  for (const p of allPlanes) {
    if (!p.alive || p.team === drone.team) continue;
    const tp = p.body.translation();
    const dx = tp.x - dp.x, dy = tp.y - dp.y, dz = tp.z - dp.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestSq) { bestSq = d; best = p; }
  }
  return best;
}

function fireDroneLaser(drone, target, allPlanes, scene) {
  const dp = drone.body.translation();
  const tp = target.body.translation();
  const origin = new THREE.Vector3(dp.x, dp.y, dp.z);
  const dir = _v.set(tp.x - dp.x, tp.y - dp.y, tp.z - dp.z).normalize();

  let hitDist = DRONE_LASER_RANGE;
  let hitTarget = null;
  for (const p of allPlanes) {
    if (!p.alive || p.team === drone.team) continue;
    const pp = p.body.translation();
    const to = _v2.set(pp.x - origin.x, pp.y - origin.y, pp.z - origin.z);
    const along = to.dot(dir);
    if (along < 0 || along > hitDist) continue;
    const perpSq = to.lengthSq() - along * along;
    const r = (p.stats.colliderHalf?.x ?? 1.5) + 0.6;
    if (perpSq <= r * r) {
      hitTarget = p;
      hitDist = along;
    }
  }
  if (hitTarget) applyDamage(hitTarget, DRONE_LASER_DAMAGE, drone);

  const end = origin.clone().addScaledVector(dir, hitDist);
  const geom = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const mat = new THREE.LineBasicMaterial({ color: DRONE_LASER_COLOR, transparent: true, opacity: 1 });
  const line = new THREE.Line(geom, mat);
  scene.add(line);
  drone._activeBeams.push({ line, ttl: DRONE_LASER_TTL });
}

