// Top-down chase camera at ~55° pitch. Follows the player's plane with a
// little smoothing and bank-influenced offset.
import * as THREE from 'three';

const _targetPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _q = new THREE.Quaternion();

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(
    60, window.innerWidth / window.innerHeight, 1, 12000
  );
  cam.position.set(0, 120, 80);
  cam.lookAt(0, 0, 0);
  return cam;
}

export const cameraConfig = {
  height: 16,        // meters above plane
  back: 24,          // meters behind plane (along -forward)
  followLerp: 0.10,  // position smoothing
  lookLerp: 0.18,    // look-at smoothing
  lookAheadMeters: 45, // how far in front of the plane the camera aims
};

let _smoothedLookAt = new THREE.Vector3();
let _initialized = false;

export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _forward.set(0, 0, -1).applyQuaternion(_q);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // Use full forward vector (including pitch) for behind-shoulder chase —
  // when the plane dives, the camera dives with it.
  const back = _forward.clone().normalize();

  _camPos.copy(_targetPos)
    .addScaledVector(back, -cameraConfig.back)
    .add(new THREE.Vector3(0, cameraConfig.height, 0));

  // Look at a point in FRONT of the plane so the player can see what they're
  // flying into, not stare at their own tail.
  const lookAhead = _targetPos.clone().addScaledVector(back, cameraConfig.lookAheadMeters);

  if (!_initialized) {
    camera.position.copy(_camPos);
    _smoothedLookAt.copy(lookAhead);
    _initialized = true;
  } else {
    camera.position.lerp(_camPos, cameraConfig.followLerp);
    _smoothedLookAt.lerp(lookAhead, cameraConfig.lookLerp);
  }

  camera.lookAt(_smoothedLookAt);
}

// Mouse wheel zoom — adjusts height/back proportionally.
export function attachZoom(camera) {
  window.addEventListener('wheel', (e) => {
    const delta = Math.sign(e.deltaY);
    cameraConfig.height = THREE.MathUtils.clamp(cameraConfig.height + delta * 3, 8, 80);
    cameraConfig.back   = THREE.MathUtils.clamp(cameraConfig.back   + delta * 4, 14, 110);
  }, { passive: true });
}

export function onResize(camera, renderer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
