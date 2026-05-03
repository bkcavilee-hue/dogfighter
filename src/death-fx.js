// Death tumble: when a plane dies, snapshot its mesh + transform, detach
// from its physics body, and let it fall with random angular velocity for a
// few seconds before fading + cleaning up. Replaces the abrupt mesh.visible
// = false hide with something that reads as a real wreckage moment.
import * as THREE from 'three';

const TUMBLE_TTL = 3.0;          // s before disappearance
const TUMBLE_GRAVITY = 22;       // m/s²
const TUMBLE_INITIAL_DROP = 5;   // initial downward velocity bias

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

const tumbles = []; // { mesh, vel, angVel, ttl }

/** Spawn a tumbling clone of the dying plane's mesh. */
export function spawnDeathTumble(scene, plane) {
  if (!plane.mesh) return;
  // Clone the mesh so it lives independently of the original.
  const tumble = plane.mesh.clone(true);
  // BUG FIX: Object3D.clone(true) shares MATERIAL instances with the
  // source by reference. Without this deep-clone the fade pass below
  // (m.opacity = fade) writes opacity 0 onto the player's *live* mesh's
  // material, so the jet stays invisible after respawn. Deep-clone every
  // material so the tumble fades only itself.
  tumble.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => m.clone())
        : o.material.clone();
    }
  });
  // Copy world transform.
  plane.mesh.getWorldPosition(tumble.position);
  plane.mesh.getWorldQuaternion(tumble.quaternion);
  // Inherit the plane's current velocity, slightly biased downward.
  const lin = plane.body.linvel?.() || { x: 0, y: 0, z: 0 };
  const vel = new THREE.Vector3(
    lin.x + (Math.random() - 0.5) * 8,
    lin.y - TUMBLE_INITIAL_DROP - Math.random() * 4,
    lin.z + (Math.random() - 0.5) * 8,
  );
  // Random angular velocity for the tumble.
  const angVel = new THREE.Vector3(
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 6,
    (Math.random() - 0.5) * 10,
  );
  scene.add(tumble);
  tumbles.push({ mesh: tumble, vel, angVel, ttl: TUMBLE_TTL });
}

export function tickDeathTumbles(scene, dt) {
  for (let i = tumbles.length - 1; i >= 0; i--) {
    const t = tumbles[i];
    t.ttl -= dt;
    // Velocity + gravity.
    t.vel.y -= TUMBLE_GRAVITY * dt;
    t.mesh.position.addScaledVector(t.vel, dt);
    // Angular velocity → quaternion delta around each axis, in local frame.
    _q.setFromAxisAngle(_v.set(1, 0, 0), t.angVel.x * dt);
    t.mesh.quaternion.multiply(_q);
    _q.setFromAxisAngle(_v.set(0, 1, 0), t.angVel.y * dt);
    t.mesh.quaternion.multiply(_q);
    _q.setFromAxisAngle(_v.set(0, 0, 1), t.angVel.z * dt);
    t.mesh.quaternion.multiply(_q);

    // Fade + remove.
    if (t.ttl <= 0.6) {
      const fade = Math.max(0, t.ttl / 0.6);
      t.mesh.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.transparent = true;
            m.opacity = fade;
          }
        }
      });
    }
    if (t.ttl <= 0 || t.mesh.position.y < -50) {
      scene.remove(t.mesh);
      tumbles.splice(i, 1);
    }
  }
}
