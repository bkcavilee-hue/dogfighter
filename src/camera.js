// Top-down chase camera at ~55° pitch. Follows the player's plane with a
// little smoothing and bank-influenced offset.
//
// Three camera modes (toggle with C):
//   'hybrid'  (C-mode, default): mesh stays visually flat, world horizon
//             tilts to convey climbs/dives. Body still pitches mechanically.
//   'cockpit' (B-mode): camera RIGID-locks to plane orientation. Plane
//             appears motionless, world tumbles around it. No horizon lock.
//   'classic' (original): plane mesh pitches with body, camera horizon-
//             locked with clamped pitch. Pre-fixed-mesh behavior.
import * as THREE from 'three';

// Cockpit is the default — preferred feel per playtest. Order also
// determines the C-key cycle: cockpit → hybrid → classic → cockpit.
export const CAMERA_MODES = ['cockpit', 'hybrid', 'classic'];
let _mode = 'cockpit';
export function getCameraMode() { return _mode; }
export function setCameraMode(m) {
  if (CAMERA_MODES.includes(m)) _mode = m;
}
export function cycleCameraMode() {
  const i = CAMERA_MODES.indexOf(_mode);
  _mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
  return _mode;
}

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
  height: 7,           // meters above plane (in plane's local up)
  back: 18,            // meters behind plane (along plane's local forward)
  // Higher lerps = camera tracks heading changes more aggressively, so
  // the view actively follows where the jet is pointed instead of lagging
  // behind during turns.
  followLerp: 0.32,
  lookLerp: 0.40,
  // Look closer to the plane (was 70) so the jet is centered on screen
  // rather than dropped to the bottom of the frame by the look-ahead.
  lookAheadMeters: 14,
  // Cockpit-mode offset (mouse-wheel adjustable too).
  cockpitBack: 16,
  cockpitHeight: 5,
};

let _smoothedLookAt = new THREE.Vector3();
let _initialized = false;

// Horizon-locked boosted-follow chase camera.
//
//   • Camera forward = blend of (jet's local forward) and (velocity dir),
//     so the camera leads slightly toward where the jet is actually going
//     rather than only where its nose points.
//   • Pitch tilt is allowed but CLAMPED to ±MAX_PITCH (default 45°) so a
//     loop or vertical climb can never invert the camera.
//   • Camera's up is hard-locked to world up — horizon stays level
//     forever, no roll.
//   • Heading (yaw) is smoothed; if the jet's nose passes through near-
//     vertical and the horizontal projection becomes tiny, we HOLD the
//     previous heading so the camera doesn't snap 180°.
const _planeQ = new THREE.Quaternion();
const _localFwd = new THREE.Vector3(0, 0, -1);
const _velDir = new THREE.Vector3(0, 0, -1);
const _blendDir = new THREE.Vector3(0, 0, -1);
const _smoothedHeading = new THREE.Vector3(0, 0, -1);   // unit, in XZ plane
const _camForward = new THREE.Vector3(0, 0, -1);        // final, with clamped pitch
const _worldUpVec = new THREE.Vector3(0, 1, 0);

const VEL_BLEND = 0.30;                                   // 0 = nose only, 1 = velocity only
const MAX_PITCH = (50 * Math.PI) / 180;                   // ±50°
const PITCH_FOLLOW_GAIN = 0.65;                           // 0 = no pitch tilt, 1 = full
let _smoothedPitch = 0;

// Cockpit-mode reusable temporaries.
const _cockpitOffset = new THREE.Vector3();
const _cockpitFwd = new THREE.Vector3();

export function updateChaseCamera(camera, plane) {
  if (!plane) return;
  const r = plane.body.rotation();
  _planeQ.set(r.x, r.y, r.z, r.w);

  const t = plane.body.translation();
  _targetPos.set(t.x, t.y, t.z);

  // ----- COCKPIT MODE: rigid follow, no horizon lock -----------------------
  // Camera adopts plane orientation so the plane appears motionless and the
  // world tumbles around it. Disorienting but immersive.
  if (_mode === 'cockpit') {
    // Behind & slightly above in the plane's LOCAL frame (+Z is back from
    // forward, +Y is up). Both values are wheel-adjustable via cameraConfig
    // so scroll zoom-out works in cockpit mode too.
    _cockpitOffset.set(0, cameraConfig.cockpitHeight, cameraConfig.cockpitBack).applyQuaternion(_planeQ);
    camera.position.copy(_targetPos).add(_cockpitOffset);
    camera.quaternion.copy(_planeQ);
    // Three's camera looks down -Z; plane forward is -Z, so quaternions match.
    return;
  }
  // -----------------------------------------------------------------------

  // Jet's local forward (full 3D — includes pitch).
  _localFwd.set(0, 0, -1).applyQuaternion(_planeQ);

  // Velocity direction — only meaningful at non-trivial speed.
  const v = plane.body.linvel();
  _velDir.set(v.x, v.y, v.z);
  if (_velDir.lengthSq() > 1) _velDir.normalize();
  else _velDir.copy(_localFwd);

  // Blended camera-look direction (slightly biased toward where the jet
  // is actually moving, not just where the nose points).
  _blendDir.copy(_localFwd).multiplyScalar(1 - VEL_BLEND)
    .addScaledVector(_velDir, VEL_BLEND);
  if (_blendDir.lengthSq() < 1e-6) _blendDir.copy(_localFwd);
  else _blendDir.normalize();

  // ----- HEADING (yaw) on the XZ plane -----------------------------------
  // Project blendDir onto XZ. If the projection is too small (jet nose
  // near vertical), HOLD the previous heading to prevent snap. Threshold
  // raised to 0.30 so we hold across a wider near-vertical band and the
  // camera doesn't whip around when the player pitches steeply.
  const horizX = _blendDir.x, horizZ = _blendDir.z;
  const horizMag2 = horizX * horizX + horizZ * horizZ;
  if (horizMag2 > 0.30) {
    const inv = 1 / Math.sqrt(horizMag2);
    const hx = horizX * inv, hz = horizZ * inv;
    if (!_initialized) {
      _smoothedHeading.set(hx, 0, hz);
    } else {
      _smoothedHeading.x += (hx - _smoothedHeading.x) * cameraConfig.followLerp;
      _smoothedHeading.z += (hz - _smoothedHeading.z) * cameraConfig.followLerp;
      _smoothedHeading.y = 0;
      const m2 = _smoothedHeading.lengthSq();
      if (m2 > 1e-6) _smoothedHeading.multiplyScalar(1 / Math.sqrt(m2));
    }
  }
  // (else: keep _smoothedHeading from previous frame.)

  // ----- PITCH (clamped) -------------------------------------------------
  // Raw pitch derived from blend direction's Y component, scaled by
  // PITCH_FOLLOW_GAIN so the camera tilts less than the jet does.
  // Hybrid mode pushes the gain higher because the mesh stays flat — the
  // camera/horizon must carry the climb/dive signal alone.
  const gain = (_mode === 'hybrid') ? 0.90 : PITCH_FOLLOW_GAIN;
  const rawPitch = Math.asin(THREE.MathUtils.clamp(_blendDir.y, -1, 1));
  const targetPitch = THREE.MathUtils.clamp(
    rawPitch * gain,
    -MAX_PITCH, MAX_PITCH,
  );
  _smoothedPitch += (targetPitch - _smoothedPitch) * cameraConfig.lookLerp;

  // Reconstruct the final camera-look direction from smoothed heading
  // (XZ unit) lifted by the smoothed pitch about the world-horizontal.
  const cosP = Math.cos(_smoothedPitch);
  const sinP = Math.sin(_smoothedPitch);
  _camForward.set(
    _smoothedHeading.x * cosP,
    sinP,
    _smoothedHeading.z * cosP,
  );

  // ----- POSITION & LOOK-AT ---------------------------------------------
  // Camera sits BEHIND the look direction and above in WORLD up (so the
  // horizon stays flat regardless of pitch).
  const desiredCamPos = _v.copy(_targetPos)
    .addScaledVector(_camForward, -cameraConfig.back)
    .addScaledVector(_worldUpVec, cameraConfig.height);

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

  camera.up.set(0, 1, 0);   // hard-locked world-up — horizon never tilts
  camera.lookAt(_smoothedLookAt);
}

// Mouse wheel zoom — adjusts height/back proportionally for ALL camera
// modes. Range is intentionally generous on the upper end (back: 18→250m)
// so the player can pull WAY out for a strategic view of the dogfight.
// Cockpit mode has its own (smaller) cockpitBack/cockpitHeight pair so
// scroll works there too without nesting the camera 200m back of a tail.
export function attachZoom(camera) {
  window.addEventListener('wheel', (e) => {
    const delta = Math.sign(e.deltaY);
    cameraConfig.height = THREE.MathUtils.clamp(cameraConfig.height + delta * 3, 4, 120);
    cameraConfig.back   = THREE.MathUtils.clamp(cameraConfig.back   + delta * 6, 12, 250);
    cameraConfig.cockpitHeight = THREE.MathUtils.clamp(cameraConfig.cockpitHeight + delta * 1, 3, 30);
    cameraConfig.cockpitBack   = THREE.MathUtils.clamp(cameraConfig.cockpitBack + delta * 2, 8, 80);
  }, { passive: true });
}

export function onResize(camera, renderer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
