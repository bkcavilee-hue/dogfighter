// Decoy flares. When deployed, every in-flight missile that's homing on the
// dropper has its target swapped to the nearest flare, which it then chases
// to oblivion. Flares are pure visuals — no rigid body, just particles.
import * as THREE from 'three';

export const FLARE = {
  countPerDeploy: 4,         // flares ejected per S double-tap
  ttl: 3.0,                  // how long each flare lives
  ejectSpeed: 18,            // m/s back/sideways from plane
  gravity: 6,                // mild downward drift
  decoyRadius: 250,          // missile within this can be lured
  fadeAt: 0.5,               // start fading visual at half life
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

let _flareGeom = null;
let _flareMat = null;
function ensureAssets() {
  if (!_flareGeom) {
    _flareGeom = new THREE.SphereGeometry(0.6, 8, 6);
    _flareMat = new THREE.MeshBasicMaterial({
      color: 0xfff0a0, transparent: true, opacity: 1.0,
    });
  }
}

/** Drop a fan of flares behind a plane. Returns the new flares (already in scene). */
export function deployFlares(plane, scene) {
  ensureAssets();
  const r = plane.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const fwd = _v.set(0, 0, -1).applyQuaternion(_q).clone();
  const up  = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
  const t = plane.body.translation();
  const planeVel = plane.body.linvel();

  const newFlares = [];
  for (let i = 0; i < FLARE.countPerDeploy; i++) {
    const angle = (i - (FLARE.countPerDeploy - 1) / 2) * 0.45;
    // Ejection direction: backward + spread sideways + slight up
    const dir = fwd.clone().multiplyScalar(-1)
      .addScaledVector(right, Math.sin(angle))
      .addScaledVector(up, 0.25)
      .normalize();
    const startPos = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(fwd, -2);
    const vel = dir.multiplyScalar(FLARE.ejectSpeed)
      .add(new THREE.Vector3(planeVel.x, planeVel.y, planeVel.z).multiplyScalar(0.6));

    const mesh = new THREE.Mesh(_flareGeom, _flareMat.clone());
    mesh.position.copy(startPos);
    scene.add(mesh);

    newFlares.push({
      pos: startPos,
      vel,
      ttl: FLARE.ttl,
      mesh,
      dropper: plane,
      alive: true,
    });
  }
  return newFlares;
}

/** Tick all flares: move, age, remove dead. */
export function updateFlares(flares, scene, dt) {
  for (let i = flares.length - 1; i >= 0; i--) {
    const f = flares[i];
    if (!f.alive) {
      destroy(f, scene);
      flares.splice(i, 1);
      continue;
    }
    f.vel.y -= FLARE.gravity * dt;
    f.pos.addScaledVector(f.vel, dt);
    f.mesh.position.copy(f.pos);
    f.ttl -= dt;
    const lifeFrac = f.ttl / FLARE.ttl;
    if (lifeFrac < FLARE.fadeAt) {
      f.mesh.material.opacity = lifeFrac / FLARE.fadeAt;
    }
    // Pulsing scale for visual flair
    const pulse = 1 + 0.3 * Math.sin(performance.now() * 0.04 + i);
    f.mesh.scale.setScalar(pulse);
    if (f.ttl <= 0) f.alive = false;
  }
}

/** Find the nearest live flare to a position, within decoy radius. */
export function nearestFlare(pos, flares) {
  let best = null, bestSq = FLARE.decoyRadius * FLARE.decoyRadius;
  for (const f of flares) {
    if (!f.alive) continue;
    const dx = f.pos.x - pos.x, dy = f.pos.y - pos.y, dz = f.pos.z - pos.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestSq) { bestSq = d; best = f; }
  }
  return best;
}

function destroy(f, scene) {
  scene.remove(f.mesh);
  f.mesh.material.dispose();
}
