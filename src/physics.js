// Rapier 3D physics wrapper. Uses the rapier3d-compat package, which bundles
// the WASM blob inline so no extra Vite plumbing is required.
import RAPIER from '@dimforge/rapier3d-compat';

let initialized = false;
export let world = null;

export async function initPhysics(gravity = { x: 0, y: -9.81, z: 0 }) {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
  world = new RAPIER.World(gravity);
  world.timestep = 1 / 60;
  return world;
}

export { RAPIER };

/**
 * Create a rigid body and return it. `position` and `rotation` are plain
 * objects ({x,y,z} / {x,y,z,w}) — caller can pass THREE Vector3/Quaternion.
 */
export function createRigidBody(position, rotation, type = 'dynamic') {
  let desc;
  switch (type) {
    case 'static':
      desc = RAPIER.RigidBodyDesc.fixed();
      break;
    case 'kinematic':
      desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
      break;
    default:
      desc = RAPIER.RigidBodyDesc.dynamic();
  }
  desc.setTranslation(position.x, position.y, position.z);
  if (rotation) {
    desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
  }
  return world.createRigidBody(desc);
}

export function createCollider(body, colliderDesc) {
  return world.createCollider(colliderDesc, body);
}

/** Copy Rapier transform into a Three.js mesh. */
export function syncMesh(mesh, body) {
  const t = body.translation();
  const r = body.rotation();
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(r.x, r.y, r.z, r.w);
}
