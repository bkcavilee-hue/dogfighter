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

// Angle-following chase camera. Sits behind + above the plane in the
// plane's LOCAL frame (using its full pitch+yaw quaternion), so the
// camera tilts with the nose. Because the jet never rolls (see aircraft.js)
// the camera's up vector stays in the vertical plane and the horizon
// never goes side-tilted — only pitches up/down with the jet.
const _planeQ = new THREE.Quaternion();
const _camForward = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _smoothedUp = new THREE.Vector3(0, 1, 0);

export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _planeQ.set(r.x, r.y, r.z, r.w);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // Plane's full forward (includes pitch — jet has no roll, see aircraft.js).
  _camForward.set(0, 0, -1).applyQuaternion(_planeQ).normalize();
  // Plane's local up — perpendicular to forward, lying in the vertical
  // plane containing the heading.
  _camUp.set(0, 1, 0).applyQuaternion(_planeQ).normalize();

  // Behind + above in the JET's frame, so when the jet pitches up the
  // camera swings down-back behind the tail; when it pitches down the
  // camera swings up-back. Same on-screen position for the jet at all
  // attitudes.
  const desiredCamPos = _v.copy(_targetPos)
    .addScaledVector(_camForward, -cameraConfig.back)
    .addScaledVector(_camUp, cameraConfig.height);

  const lookAhead = _smoothedLookAt.copy(_targetPos)
    .addScaledVector(_camForward, cameraConfig.lookAheadMeters);

  if (!_initialized) {
    camera.position.copy(desiredCamPos);
    _smoothedLookAt.copy(lookAhead);
    _smoothedUp.copy(_camUp);
    _initialized = true;
  } else {
    camera.position.lerp(desiredCamPos, cameraConfig.followLerp);
    _smoothedLookAt.lerp(lookAhead, cameraConfig.lookLerp);
    _smoothedUp.lerp(_camUp, cameraConfig.lookLerp).normalize();
  }

  camera.up.copy(_smoothedUp);
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
