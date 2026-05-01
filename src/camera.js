// Top-down chase camera at ~55° pitch. Follows the player's plane with a
// little smoothing and bank-influenced offset.
import * as THREE from 'three';

const _targetPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(
    72, window.innerWidth / window.innerHeight, 1, 12000
  );
  cam.position.set(0, 120, 80);
  cam.lookAt(0, 0, 0);
  return cam;
}

export const cameraConfig = {
  height: 4,           // meters above plane in its LOCAL frame
  back: 18,            // meters behind plane in its LOCAL frame
  followLerp: 0.18,
  lookLerp: 0.22,
  rotLerp: 0.20,       // how aggressively the camera matches plane rotation
  lookAheadMeters: 90,
};

let _smoothedLookAt = new THREE.Vector3();
let _initialized = false;

// Cockpit-chase camera: locked to the jet's local frame, so when the jet
// banks/pitches/yaws the camera does too — the world rolls around the
// player. Camera offset (height, back) is in the jet's LOCAL coordinates,
// not world. lookAt is also a fixed forward point in the local frame.
export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // Local offset: behind (+Z), above (+Y) the plane in its own frame.
  const localOffset = _camPos.set(0, cameraConfig.height, cameraConfig.back).applyQuaternion(_q);
  const desiredCamPos = _v.copy(_targetPos).add(localOffset);

  // Look-at point: forward (-Z) of the plane in its own frame.
  const lookAhead = _smoothedLookAt.copy(_targetPos)
    .add(_forward.set(0, 0, -cameraConfig.lookAheadMeters).applyQuaternion(_q));

  if (!_initialized) {
    camera.position.copy(desiredCamPos);
    camera.quaternion.copy(_q);
    _initialized = true;
  } else {
    camera.position.lerp(desiredCamPos, cameraConfig.followLerp);
    // Slerp camera quaternion toward jet quaternion so banks/pitches feel
    // physical instead of snappy.
    camera.quaternion.slerp(_q, cameraConfig.rotLerp);
  }

  // Always re-aim at the look-ahead so the player sees what they're flying
  // into. Combined with the slerp, this gives a slight settle on the jet.
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.lookAt(lookAhead);
}

// Mouse wheel zoom — adjusts height/back proportionally.
export function attachZoom(camera) {
  window.addEventListener('wheel', (e) => {
    const delta = Math.sign(e.deltaY);
    cameraConfig.height = THREE.MathUtils.clamp(cameraConfig.height + delta * 3, 4, 60);
    cameraConfig.back   = THREE.MathUtils.clamp(cameraConfig.back   + delta * 4, 20, 110);
  }, { passive: true });
}

export function onResize(camera, renderer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
