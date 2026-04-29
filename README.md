# Dogfighter

3D top-down dogfighting shooter. Three.js + Rapier (WASM) + Socket.IO.

## Local dev

```bash
npm install
npm run dev:all     # Vite (5174) + Node server (3000) in parallel
```

Open http://localhost:5174. For multiplayer, open a second browser window
(or another machine on your LAN — see "LAN testing" below).

## Solo / multiplayer

- **SOLO** tab in the intro screen: 1 vs 2 AI bots in FFA. AI difficulty mix
  is configurable in `src/engine.js` (`createAIBrain('rookie' | 'veteran' | 'ace')`).
- **MULTIPLAYER** tab: connects to the server, lists rooms, lets you
  create / join. Mode dropdown picks **FFA** (every player is their own team)
  or **2v2** (alternating red/blue, friendly-fire off).

## Production build + deploy

```bash
npm run build       # vite → dist/
npm start           # node server/index.js (serves dist/ + socket.io on $PORT)
```

The server reads `process.env.PORT`, defaulting to 3000.

### Railway

1. Push this repo to GitHub.
2. New project on [railway.app](https://railway.app) → "Deploy from GitHub" → select repo.
3. Railway auto-detects Node and runs `npm start`. It also runs `npm run build` if listed in `package.json` scripts (it is, via `npm install` lifecycle hooks).
4. Add a public domain in the project settings.

### Render

1. New "Web Service" → connect repo.
2. Build command: `npm install && npm run build`.
3. Start command: `npm start`.
4. Free tier sleeps after 15 min idle (cold starts ~10 s).

### Fly.io

1. `fly launch` from the repo root, accept the auto-detected Node template.
2. `fly deploy`.
3. Multi-region: `fly regions add iad lhr nrt` for global low-latency.

### LAN testing (two machines, no deploy)

Find your machine's LAN IP (`ifconfig` / `ipconfig`). On the other machine,
open `http://<your-lan-ip>:5174`. The client auto-detects dev mode and
connects to `:3000` on the same host.

If your LAN IP differs from `localhost`, edit
[`src/networking.js`](src/networking.js) `resolveServerURL` to point to it
explicitly during dev.

## Project layout

```
src/                Client (Vite-built)
  engine.js         Main loop wiring
  physics.js        Rapier wrapper
  arena.js          Procedural terrain + ocean + sky (heightmap collision)
  aircraft.js       Plane factory + flight controls + maneuvers
  weapons.js        Machine gun (heat, lock-on confidence, aim assist)
  missiles.js       Homing missiles
  flares.js         Decoys
  ai.js             AI brains + difficulty tiers
  gamestate.js      HP, damage, respawn
  match.js          Match state machine, FFA / 2v2 win conditions
  ui.js             HUD, minimap, lobby, end-of-match screen
  audio.js          Procedural Web Audio sound effects
  fx.js             Particle FX, contrails
  models.js         GLB loader + island heightmap baking
  camera.js         Behind-shoulder chase camera
  networking.js     Socket.IO client wrapper
  remote-plane.js   Remote-player proxy (interpolation)
  input.js          Keyboard + double-tap detection

server/
  index.js          Express + Socket.IO entrypoint
  room-manager.js   In-memory rooms

public/assets/
  models/           Plane GLBs (interceptor, striker, bruiser)
  maps/             Island + ocean GLBs
```

## Controls

| Key | Action |
|-----|--------|
| WASD or arrows | Climb / dive / turn |
| Space | Boost |
| E or LMB | Fire gun |
| Q | Launch missile (when locked) |
| W ×2 | Loop (visual) |
| A ×2 / D ×2 | Lateral barrel-roll dodge |
| S ×2 | Drop flares (decoys) |
| Mouse wheel | Zoom |
