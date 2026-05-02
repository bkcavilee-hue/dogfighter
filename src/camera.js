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
  height: 9,           // meters above plane (in plane's local up)
  back: 26,            // meters behind plane (along plane's local forward)
  // Higher lerps = camera tracks heading changes more aggressively, so
  // the view actively follows where the jet is pointed instead of lagging
  // behind during turns.
  followLerp: 0.32,
  lookLerp: 0.40,
  // Look closer to the plane (was 70) so the jet is centered on screen
  // rather than dropped to the bottom of the frame by the look-ahead.
  lookAheadMeters: 18,
};

let _smoothedLookAt = new THREE.Vector3();
let _initialized = false;

// Fixed world-up chase. The camera sits behind+above the jet in WORLD
// space, following only the jet's HORIZONTAL heading (compass direction).
// Pitch and roll never move the camera. Horizon is permanently level.
// When the jet pitches up or rolls or loops, the camera holds steady and
// the jet visibly maneuvers in front of it.
const _planeQ = new THREE.Quaternion();
const _camForward = new THREE.Vector3();

export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _planeQ.set(r.x, r.y, r.z, r.w);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // Project the jet's forward onto the horizontal (XZ) plane — pitch
  // and roll don't move the camera, just heading.
  _camForward.set(0, 0, -1).applyQuaternion(_planeQ);
  _camForward.y = 0;
  if (_camForward.lengthSq() < 1e-4) _camForward.set(0, 0, -1);
  _camForward.normalize();

  // Behind along the heading + above in WORLD up. Constant offsets so
  // the camera sits at a fixed altitude relative to the jet regardless
  // of nose attitude.
  const desiredCamPos = _v.copy(_targetPos)
    .addScaledVector(_camForward, -cameraConfig.back)
    .add(new THREE.Vector3(0, cameraConfig.height, 0));

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

  camera.up.set(0, 1, 0); // hard-locked world-up — horizon never tilts
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
