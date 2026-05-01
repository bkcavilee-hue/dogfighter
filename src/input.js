// Centralized input state. Uses KeyboardEvent.code so layout doesn't matter.
// WASD and arrow keys are interchangeable. Double-tapping a direction triggers
// a maneuver: W = loop, A = roll-left, D = roll-right, S = flares.
export const input = {
  climb: false,     // W or ArrowUp   — pitch up
  dive: false,      // S or ArrowDown — pitch down
  bankL: false,     // A or ArrowLeft  — bank left (Star Fox: bank → turn)
  bankR: false,     // D or ArrowRight — bank right
  rudderL: false,   // Z — rudder yaw left (independent of bank)
  rudderR: false,   // X — rudder yaw right
  boost: false,     // Space
  fire: false,      // E or LMB
  missile: false,   // Q (held)
  // Edge triggers (consumed once per tap):
  loopTap: false,        // W×2 or ArrowUp×2 → backflip / alley-oop
  rollLeftTap: false,    // A×2 or ArrowLeft×2
  rollRightTap: false,   // D×2 or ArrowRight×2
  flareTap: false,       // S×2 or ArrowDown×2
  missilePressed: false, // Q first-press
  tabPressed: false,     // Tab — cycle next lock candidate
  shiftPressed: false,   // Shift — commit lock / unlock
};

const DOUBLE_TAP_MS = 280;
// Track double-taps by MANEUVER, not by logical pitch action — that way
// inverting pitch doesn't move the loop/flare maneuvers around.
//   W / ArrowUp    → loop  (regardless of whether W is climb or dive)
//   S / ArrowDown  → flares
//   A / ArrowLeft  → roll left
//   D / ArrowRight → roll right
const tapHistory = { loop: [], flare: [], rollL: [], rollR: [] };

function tap(maneuver) {
  const now = performance.now();
  const hist = tapHistory[maneuver];
  hist.push(now);
  while (hist.length && now - hist[0] > DOUBLE_TAP_MS) hist.shift();
  if (hist.length >= 2) {
    if (maneuver === 'loop')       input.loopTap = true;
    else if (maneuver === 'flare') input.flareTap = true;
    else if (maneuver === 'rollL') input.rollLeftTap = true;
    else if (maneuver === 'rollR') input.rollRightTap = true;
    hist.length = 0;
  }
}

function keyDown(code) {
  switch (code) {
    // Standard arcade pitch: W / ArrowUp climbs, S / ArrowDown dives.
    case 'KeyW':
    case 'ArrowUp':
      if (!input.climb) tap('loop');   // double-tap W still triggers loop
      input.climb = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      if (!input.dive) tap('flare');   // double-tap S still triggers flares
      input.dive = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      if (!input.bankL) tap('rollL');
      input.bankL = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      if (!input.bankR) tap('rollR');
      input.bankR = true;
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
    case 'KeyZ': input.rudderL = true; break;
    case 'KeyX': input.rudderR = true; break;
  }
}

function keyUp(code) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':    input.climb = false; break;
    case 'KeyS':
    case 'ArrowDown':  input.dive = false; break;
    case 'KeyA':
    case 'ArrowLeft':  input.bankL = false; break;
    case 'KeyD':
    case 'ArrowRight': input.bankR = false; break;
    case 'KeyZ':       input.rudderL = false; break;
    case 'KeyX':       input.rudderR = false; break;
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

function _consume(key) {
  if (input[key]) { input[key] = false; return true; }
  return false;
}
