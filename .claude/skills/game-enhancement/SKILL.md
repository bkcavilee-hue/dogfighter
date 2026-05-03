---
name: game-enhancement
description: Workflow for adding a HUD-driven game enhancement to DogFighter (e.g. missile-incoming warning, lock-on icon polish, low-health vignette, hit-marker, kill-feed). Use when the user asks to add or improve any visible feedback element tied to game state. Triggers on phrases like "add a HUD element", "show a warning when X", "improve the lock-on icon", "add an indicator for Y".
---

# Game-enhancement workflow

DogFighter is a single-loop arcade game. Every visual enhancement follows the same four-stage pipeline. Use this checklist whenever you add or upgrade a HUD/feedback element.

The four stages: **State → Wire → Render → Verify**

---

## 1. STATE — what does this depend on?

Every enhancement is a function of game state. Before touching UI, identify the source.

Common state sources in this codebase:

| State | Lives in | Read-only or mutable |
|-------|----------|---------------------|
| Player HP, boost, heat, flares | `player` (aircraft.js) | mutable |
| Missile array (in-flight) | `missiles[]` (engine.js) | mutable |
| Soft-lock target | `playerSoftLock` (engine.js) | recomputed every frame |
| Missile-lock target | `playerMissileLock` (engine.js) | recomputed every frame |
| Lock confidence (0..1) | `playerWeapon.lockConfidence` (weapons.js) | mutable |
| Camera mode | `getCameraMode()` (camera.js) | enum |
| Match score / time | `match` (match.js) | mutable |
| Incoming missiles (homing on player) | derive: `missiles.filter(m => m.target === player && m.alive)` | derived |
| AI target list | `allPlanes` (rebuilt each tick) | array |

If the state you need doesn't exist yet, **add it at the source first** — don't compute it inside the renderer. Renderers should be pure-ish: state in, pixels out.

---

## 2. WIRE — pass it down to the renderer

Two patterns in this codebase:

**A. HUD bar / chip element** (HTML in `ui.js`)
- Add the DOM node in `createHUD()` (top of ui.js).
- Add a setter call inside `updateHUD(player)` or `updateMatchHUD(match)` — both run every frame.
- For frequently-changing text, cache the previous value and skip DOM writes when unchanged (avoid layout thrash).

**B. Reticle overlay** (canvas in `ui.js` `updateReticle`)
- Extend the `updateReticle(camera, player, enemies, softLock, missileLock, lockConfidence, incomingMissiles, manualTarget, manualCommitted)` signature with a new arg.
- Update the call site in `engine.js` (search for `updateReticle(`) and pass the new state.
- Inside `updateReticle`, add a draw call between existing layers — the canvas is already cleared each frame.

**Anti-pattern**: don't reach into module-level state from inside the renderer. Pass it in.

---

## 3. RENDER — draw it

For HUD HTML elements:
- Use the existing CSS pattern (look at `#missileBar`, `.bar-fill`, `.stat`).
- Pulse / fade animations: prefer CSS `transition: opacity 0.2s` + a `.warning` class toggle over per-frame JS.

For canvas overlays:
- Use `_rctx` (the reticle's 2d context, already in scope inside `updateReticle`).
- Match the existing color palette:
  - Friendly / soft-lock: `#a8ffb8` green
  - Missile lock / hostile: `#ff5555` red
  - Warning: `#ffaa44` orange
  - Neutral text: `#cfe`
- Pulse pattern: `0.6 + 0.4 * Math.sin(performance.now() * 0.012)` (matches missile-incoming arrows).
- Always set `ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 2` before text labels for readability over terrain.
- Draw at SCREEN edge for off-screen indicators (see `drawScreenEdgeArrow`); draw IN-WORLD-projected for tracked targets (see `_project`).

For scene-space effects (3D world, not HUD):
- Add to `fx.js` (sparks, flashes) or `decor.js` (passive ambient).
- Pool short-lived geometry in module-scope arrays, dispose on TTL expiry — see `tickFX(dt)`.

---

## 4. VERIFY — prove it works

Always verify in the browser preview before declaring done.

1. `preview_start { name: 'vite' }` (skip if already running).
2. Reload via `preview_eval { window.location.reload() }`.
3. Take a screenshot of the menu, click LAUNCH MATCH via `preview_eval`.
4. Trigger the state change you just wired:
   - HP change → dispatch a fake key + AI hit, or eval an `applyDamage` if exposed
   - Missile fired → dispatch `KeyQ`
   - Lock acquired → fly toward an enemy via held `ArrowUp` / `ArrowLeft`
5. `preview_screenshot` — confirm the element renders correctly.
6. `preview_console_logs { level: 'error' }` — confirm no errors.

Don't ask the user "does this work?" — verify yourself, then share the screenshot.

---

## Common enhancement recipes

### Missile-incoming warning (audio + visual flash)
- State: `incomingMissiles = missiles.filter(m => m.target === player && m.alive)`
- Wire: pass to `updateReticle` (already passed; see `drawIncomingMissiles`)
- Render: full-screen edge vignette pulse when `incomingMissiles.length > 0`. Reuse the pattern from `spawnDamageFlash` in gamestate.js — a fixed-position div with radial gradient, opacity toggled.
- Audio: `sfxLockWarning()` already exists; trigger once per new missile (track which missile IDs you've already chirped for).

### Lock-on icon polish
- State: `playerWeapon.lockConfidence` (0..1) and `playerMissileLock`.
- Render in `updateReticle`: animate the bracket from wide-corners → tight-corners as confidence climbs. Color shift from yellow (low) → red (full). Add a circular progress ring around the target reticle filling clockwise.
- The existing missile-lock bracket draw is around `if (missileLock && missileLock.alive)` — extend with confidence-driven sizing.

### Low-health vignette
- State: `player.HP / player.maxHP`
- Render: a fixed-position div with red radial gradient. Opacity = `Math.max(0, 0.6 - hpFrac * 0.6)`. Pulse the opacity at low HP using CSS animation.
- Use the existing `_flashEl` pattern in gamestate.js as a starting point.

### Hit marker (you-hit-something feedback)
- State: hook into `onHit` callbacks in engine.js (`missileOnHit`, the gun's `onHit`).
- Render: small `+` or `X` flash at screen center for 120ms. Reuse `_rctx` from updateReticle.
- Audio: `sfxHit()` (already exists for being-hit; consider a distinct `sfxHitConfirm` if scope allows).

### Kill feed
- State: extend `applyDamage` to record kills into a small ring buffer when `target.HP <= 0 && source !== target`.
- Wire: read the buffer inside `updateMatchHUD`.
- Render: stack of fading text rows in the top-right, each entry "PLAYER → ENEMY". Auto-fade after 3s.

---

## Don'ts

- Don't add per-frame `console.log` — chokes the dev server.
- Don't allocate `new THREE.Vector3()` / `new Color()` inside the render loop — use module-level temps (every existing renderer does this).
- Don't gate features on `process.env` or build flags — this is a single-bundle Vite app, just toggle with a constant at the top of the file.
- Don't add a UI element that has no state change to react to. If it's static, it goes in the HTML, not the canvas.
