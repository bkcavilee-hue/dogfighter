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
  height: 14,          // meters above plane (world space)
  back: 32,            // meters behind plane (world space, along horizontal heading)
  // Higher lerps = camera tracks heading changes more aggressively, so
  // the view actively follows where the jet is pointed instead of lagging
  // behind during turns.
  followLerp: 0.32,
  lookLerp: 0.40,
  lookAheadMeters: 70,
};

let _smoothedLookAt = new THREE.Vector3();
let _initialized = false;

// Camera B: fixed world-up chase. Camera sits behind+above the plane in
// WORLD space (not the plane's local frame). Horizon never tilts — the
// plane visibly banks/pitches beneath the camera. Classic arcade flight.
const _planeQ = new THREE.Quaternion();
const _camForward = new THREE.Vector3();

export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _planeQ.set(r.x, r.y, r.z, r.w);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // Project the plane's forward onto the horizontal (XZ) plane — bank and
  // pitch don't move the camera, just heading.
  _camForward.set(0, 0, -1).applyQuaternion(_planeQ);
  _camForward.y = 0;
  if (_camForward.lengthSq() < 1e-4) _camForward.set(0, 0, -1);
  _camForward.normalize();

  // World-space behind+above offset.
  const desiredCamPos = _v.copy(_targetPos)
    .addScaledVector(_camForward, -cameraConfig.back)
    .add(new THREE.Vector3(0, cameraConfig.height, 0));

  // Look-at slightly ahead so the player sees what they're flying into.
  const lookAhead = _smoothedLookAt.copy(_targetPos)
    .addScaledVector(_camForward, cameraConfig.lookAheadMeters);

  if (!_initialized) {
    camera.position.copy(desiredCamPos);
    _smoothedLookAt.copy(lookAhead);
    _initialized = true;
  } else {
    camera.position.lerp(desiredCamPos, cameraConfig.followLerp);
    _smoothedLookAt.lerp(lookAhead, cameraConfig.lookLerp);
  }

  camera.up.set(0, 1, 0); // hard-locked world-up
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
