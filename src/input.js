// Centralized input state. Uses KeyboardEvent.code so layout doesn't matter.
// WASD and arrow keys are interchangeable. Double-tapping a direction triggers
// a maneuver: W = loop, A = roll-left, D = roll-right, S = flares.
export const input = {
  climb: false,     // W or ArrowUp
  dive: false,      // S or ArrowDown
  left: false,      // A or ArrowLeft
  right: false,     // D or ArrowRight
  boost: false,     // Space
  fire: false,      // E or LMB
  missile: false,   // Q (held)
  // Edge triggers (consumed once per tap):
  loopTap: false,        // W×2 or ArrowUp×2 → backflip / alley-oop
  rollLeftTap: false,    // A×2 or ArrowLeft×2
  rollRightTap: false,   // D×2 or ArrowRight×2
  flareTap: false,       // S×2 or ArrowDown×2
  missilePressed: false, // Q first-press
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
    // Inverted pitch: W / ArrowUp pushes the nose DOWN (dive); S / ArrowDown
    // pulls UP (climb). Matches classic flight-sim sticks.
    case 'KeyW':
    case 'ArrowUp':
      if (!input.dive) tap('loop');   // double-tap W still triggers loop
      input.dive = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      if (!input.climb) tap('flare'); // double-tap S still triggers flares
      input.climb = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      if (!input.left) tap('rollL');
      input.left = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      if (!input.right) tap('rollR');
      input.right = true;
      break;
    case 'Space': input.boost = true; break;
    case 'KeyE': input.fire = true; break;
    case 'KeyQ':
      if (!input.missile) input.missilePressed = true;
      input.missile = true;
      break;
  }
}

function keyUp(code) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':    input.dive = false; break;
    case 'KeyS':
    case 'ArrowDown':  input.climb = false; break;
    case 'KeyA':
    case 'ArrowLeft':  input.left = false; break;
    case 'KeyD':
    case 'ArrowRight': input.right = false; break;
    case 'Space':      input.boost = false; break;
    case 'KeyE':       input.fire = false; break;
    case 'KeyQ':       input.missile = false; break;
  }
}

export function initInput() {
  window.addEventListener('keydown', (e) => {
    // Browser extensions / password managers can dispatch synthetic keydowns
    // without `code` set — guard so we don't crash startup.
    if (!e.code) return;
    // Stop arrows from scrolling the page.
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
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

function _consume(key) {
  if (input[key]) { input[key] = false; return true; }
  return false;
}
