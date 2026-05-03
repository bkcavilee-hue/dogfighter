// Centralized input state. Uses KeyboardEvent.code so layout doesn't matter.
// Movement is ARROW KEYS only. W is a dedicated flare key (single press).
// Double-tapping arrows triggers maneuvers: ↑×2 loop, ←×2 roll-left, →×2 roll-right.
export const input = {
  climb: false,     // ArrowUp    — pitch up
  dive: false,      // ArrowDown  — pitch down
  left: false,      // ArrowLeft  — yaw left (with auto-bank)
  right: false,     // ArrowRight — yaw right
  boost: false,     // Space
  fire: false,      // E or LMB
  missile: false,   // Q (held)
  // Edge triggers (consumed once per tap):
  loopTap: false,        // ArrowUp×2 → backflip / alley-oop
  rollLeftTap: false,    // ArrowLeft×2
  rollRightTap: false,   // ArrowRight×2
  flareTap: false,       // W (single press)
  missilePressed: false, // Q first-press
  tabPressed: false,     // Tab — cycle next lock candidate
  shiftPressed: false,   // Shift — commit lock / unlock
  cameraTogglePressed: false, // C — cycle camera mode (hybrid/cockpit/classic)
  // Direct camera-mode select. Each consumed once per press. Zero-arg consumers
  // below — engine reads them and calls setCameraMode() with the matching name.
  cam1Pressed: false,    // 1 → cockpit
  cam2Pressed: false,    // 2 → hybrid
  cam3Pressed: false,    // 3 → classic
};

const DOUBLE_TAP_MS = 280;
// Maneuver double-taps live on arrow keys only now.
//   ArrowUp    → loop
//   ArrowLeft  → roll left
//   ArrowRight → roll right
const tapHistory = { loop: [], rollL: [], rollR: [] };

function tap(maneuver) {
  const now = performance.now();
  const hist = tapHistory[maneuver];
  hist.push(now);
  while (hist.length && now - hist[0] > DOUBLE_TAP_MS) hist.shift();
  if (hist.length >= 2) {
    if (maneuver === 'loop')       input.loopTap = true;
    else if (maneuver === 'rollL') input.rollLeftTap = true;
    else if (maneuver === 'rollR') input.rollRightTap = true;
    hist.length = 0;
  }
}

function keyDown(code) {
  switch (code) {
    // Standard arcade pitch: ArrowUp = nose UP (climb), ArrowDown = nose DOWN.
    case 'ArrowUp':
      if (!input.climb) tap('loop');
      input.climb = true;
      break;
    case 'ArrowDown':
      input.dive = true;
      break;
    case 'ArrowLeft':
      if (!input.left) tap('rollL');
      input.left = true;
      break;
    case 'ArrowRight':
      if (!input.right) tap('rollR');
      input.right = true;
      break;
    case 'KeyW':
      // W = drop flares (single press, edge-triggered).
      input.flareTap = true;
      break;
    case 'Space': input.boost = true; break;
    case 'KeyE': input.fire = true; break;
    case 'KeyQ':
      if (!input.missile) input.missilePressed = true;
      input.missile = true;
      break;
    case 'Tab':
      input.tabPressed = true;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      input.shiftPressed = true;
      break;
    case 'KeyC':
      input.cameraTogglePressed = true;
      break;
    case 'Digit1':
    case 'Numpad1':
      input.cam1Pressed = true;
      break;
    case 'Digit2':
    case 'Numpad2':
      input.cam2Pressed = true;
      break;
    case 'Digit3':
    case 'Numpad3':
      input.cam3Pressed = true;
      break;
  }
}

function keyUp(code) {
  switch (code) {
    case 'ArrowUp':    input.climb = false; break;
    case 'ArrowDown':  input.dive = false; break;
    case 'ArrowLeft':  input.left = false; break;
    case 'ArrowRight': input.right = false; break;
    case 'Space':      input.boost = false; break;
    case 'KeyE':       input.fire = false; break;
    case 'KeyQ':       input.missile = false; break;
  }
}

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (!e.code) return;
    // Stop arrows / Space / Tab from scrolling-or-focus-jumping the page.
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    keyDown(e.code);
  });
  window.addEventListener('keyup', (e) => {
    if (!e.code) return;
    keyUp(e.code);
  });
  window.addEventListener('mousedown', (e) => { if (e.button === 0) input.fire = true; });
  window.addEventListener('mouseup',   (e) => { if (e.button === 0) input.fire = false; });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(input)) input[k] = false;
  });
}

/* Edge-trigger consumers — return true once per tap. */
export const consumeLoopTap        = () => _consume('loopTap');
export const consumeRollLeftTap    = () => _consume('rollLeftTap');
export const consumeRollRightTap   = () => _consume('rollRightTap');
export const consumeFlareTap       = () => _consume('flareTap');
export const consumeMissileTap     = () => _consume('missilePressed');
export const consumeTabTap         = () => _consume('tabPressed');
export const consumeShiftTap       = () => _consume('shiftPressed');
export const consumeCameraToggle   = () => _consume('cameraTogglePressed');
export const consumeCam1           = () => _consume('cam1Pressed');
export const consumeCam2           = () => _consume('cam2Pressed');
export const consumeCam3           = () => _consume('cam3Pressed');

function _consume(key) {
  if (input[key]) { input[key] = false; return true; }
  return false;
}
