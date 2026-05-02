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
//
// Anti-flip: we keep a persistent smoothed horizontal heading. When the
// jet's nose is near vertical (live horizontal forward is degenerate),
// we HOLD the previous heading instead of letting it snap 180°. As soon
// as the jet pitches back near horizontal, the smoothed heading eases
// to the new live value. This eliminates the "camera flips when looping"
// failure mode.
const _planeQ = new THREE.Quaternion();
const _liveForward = new THREE.Vector3(0, 0, -1);
const _smoothedHeading = new THREE.Vector3(0, 0, -1);
const _worldUpVec = new THREE.Vector3(0, 1, 0);

export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _planeQ.set(r.x, r.y, r.z, r.w);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // Live horizontal forward of the jet (XZ projection).
  _liveForward.set(0, 0, -1).applyQuaternion(_planeQ);
  _liveForward.y = 0;
  const horizMag2 = _liveForward.lengthSq();
  // Only update the smoothed heading when the live one is stable. Below
  // ~25° from vertical (sin(25°)² ≈ 0.18) the horizontal projection is
  // too small to trust — hold the previous heading so the camera stays
  // put while the jet pitches through the singularity.
  if (horizMag2 > 0.18) {
    _liveForward.normalize();
    if (!_initialized) {
      _smoothedHeading.copy(_liveForward);
    } else {
      _smoothedHeading.lerp(_liveForward, cameraConfig.followLerp);
      _smoothedHeading.y = 0;
      if (_smoothedHeading.lengthSq() > 1e-6) _smoothedHeading.normalize();
    }
  }
  // (else: keep _smoothedHeading from last stable frame.)

  // Behind along the smoothed heading + above in WORLD up.
  const desiredCamPos = _v.copy(_targetPos)
    .addScaledVector(_smoothedHeading, -cameraConfig.back)
    .addScaledVector(_worldUpVec, cameraConfig.height);

  const lookAhead = _smoothedLookAt.copy(_targetPos)
    .addScaledVector(_smoothedHeading, cameraConfig.lookAheadMeters);

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
