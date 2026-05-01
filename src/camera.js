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

// Yaw-follow camera (Camera C): the camera tracks the jet's heading and
// follows pitch SOFTLY (~40%), but never rolls. World-up is preserved so
// the horizon stays level even when the jet banks hard.
const _planeQ = new THREE.Quaternion();
const _camQ = new THREE.Quaternion();
const _yawQ = new THREE.Quaternion();
const _pitchQ = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _camForward = new THREE.Vector3();

export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _planeQ.set(r.x, r.y, r.z, r.w);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // Extract heading (yaw around world Y) from the jet's forward vector.
  _camForward.set(0, 0, -1).applyQuaternion(_planeQ);
  const heading = Math.atan2(-_camForward.x, -_camForward.z);
  // Extract pitch from forward.y; soft-follow at PITCH_FOLLOW.
  const pitch = Math.asin(THREE.MathUtils.clamp(_camForward.y, -1, 1));
  const PITCH_FOLLOW = 0.4;

  // Build camera orientation: yaw + softened pitch, NO roll.
  _yawQ.setFromAxisAngle(_Y, heading);
  _pitchQ.setFromAxisAngle(_X, pitch * PITCH_FOLLOW);
  _camQ.copy(_yawQ).multiply(_pitchQ);

  // Position offset in this synthetic frame: behind + above, no bank.
  const localOffset = _camPos.set(0, cameraConfig.height, cameraConfig.back).applyQuaternion(_camQ);
  const desiredCamPos = _v.copy(_targetPos).add(localOffset);

  // Look-at point ahead of the plane along its TRUE forward — so steep
  // dives still look like dives even if the camera pitch follow is soft.
  const lookAhead = _smoothedLookAt.copy(_targetPos)
    .add(_forward.set(0, 0, -1).applyQuaternion(_planeQ).multiplyScalar(cameraConfig.lookAheadMeters));

  if (!_initialized) {
    camera.position.copy(desiredCamPos);
    _smoothedLookAt.copy(lookAhead);
    _initialized = true;
  } else {
    camera.position.lerp(desiredCamPos, cameraConfig.followLerp);
    _smoothedLookAt.lerp(lookAhead, cameraConfig.lookLerp);
  }

  // World-up always so the horizon stays level. lookAt builds a roll-free
  // orientation toward the look-ahead point.
  camera.up.set(0, 1, 0);
  camera.lookAt(_smoothedLookAt);
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
