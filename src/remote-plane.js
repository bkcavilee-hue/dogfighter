// Remote-plane proxy. A network-driven plane shown in the scene to represent
// another player. We don't run physics for it — we interpolate between the
// 20Hz state snapshots received from the server.
import * as THREE from 'three';
import { getPlaneMesh } from './models.js';
import { PLANE_STATS } from './aircraft.js';

const _q  = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** Create a remote plane proxy from a player record. */
export function createRemotePlane(player) {
  const stats = PLANE_STATS[player.plane] || PLANE_STATS.interceptor;
  const mesh = getPlaneMesh(player.plane) || buildFallbackMesh();
  // Add team marker so the player ID is readable visually.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.4, 24),
    new THREE.MeshBasicMaterial({
      color: player.team === 'blue' ? 0x4caaff : 0xff7b6e,
      side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.6;
  mesh.add(ring);

  return {
    id: player.id,
    name: player.name,
    plane: player.plane,
    team: player.team,
    stats,
    mesh,
    // Interpolation buffer. We hold the previous and target states and blend.
    prevState: null,
    targetState: null,
    targetReceivedAt: 0,
    // Surface-compatible API so HUD / minimap / lock helpers can treat it
    // like a local plane.
    body: makeFakeBody(),
    HP: stats.maxHP,
    maxHP: stats.maxHP,
    boost: stats.maxBoost,
    maxBoost: stats.maxBoost,
    heat: 0,
    flares: 5,
    maxFlares: 5,
    missiles: stats.missiles,
    maxMissiles: stats.missiles,
    score: 0,
    speed: 0,
    alive: true,
    invincibleTimer: 0,
    isPlayer: false,
    _heading: 0,
    _pitch: 0,
    _maneuver: null,
  };
}

/** Apply a fresh state snapshot from the server. */
export function applyRemoteState(remote, state) {
  remote.prevState = remote.targetState;
  remote.targetState = state;
  remote.targetReceivedAt = performance.now();
  // Mirror non-positional state directly for HUD bars.
  remote.HP = state.HP ?? remote.HP;
  remote.alive = state.alive ?? true;
  remote.team = state.team ?? remote.team;
  remote.score = state.score ?? remote.score;
  remote._heading = state.heading ?? remote._heading;
  remote._pitch = state.pitch ?? remote._pitch;
}

/** Tick the proxy — interpolate the mesh + fake body to the target state. */
export function tickRemotePlane(remote, dt) {
  const t = remote.targetState;
  if (!t) return;
  const p = remote.prevState || t;

  // Time since we received target state, clamped to one network interval.
  const NET_INTERVAL = 1 / 20; // server tick
  const age = (performance.now() - remote.targetReceivedAt) / 1000;
  const alpha = Math.min(1, age / NET_INTERVAL);

  // Position: linear interp from prev → target.
  const px = p.x + (t.x - p.x) * alpha;
  const py = p.y + (t.y - p.y) * alpha;
  const pz = p.z + (t.z - p.z) * alpha;

  // Rotation: slerp between two quaternions reconstructed from heading/pitch.
  const aQ = quatFromHeadingPitch(_qa, p.heading, p.pitch);
  const bQ = quatFromHeadingPitch(_qb, t.heading, t.pitch);
  _q.copy(aQ).slerp(bQ, alpha);

  remote.mesh.position.set(px, py, pz);
  remote.mesh.quaternion.copy(_q);

  // Update the fake body so range/lock helpers work.
  remote.body._position.set(px, py, pz);
  remote.body._rotation.set(_q.x, _q.y, _q.z, _q.w);
  // Estimate velocity from prev → target diff.
  const ivd = NET_INTERVAL > 0 ? 1 / NET_INTERVAL : 0;
  remote.body._velocity.set(
    (t.x - p.x) * ivd, (t.y - p.y) * ivd, (t.z - p.z) * ivd,
  );

  remote.speed = remote.body._velocity.length();

  if (remote.alive) {
    remote.mesh.visible = true;
  } else {
    remote.mesh.visible = false;
  }
}

/** Build the network state payload for the LOCAL plane. */
export function buildLocalState(plane) {
  const t = plane.body.translation();
  return {
    x: t.x, y: t.y, z: t.z,
    heading: plane._heading || 0,
    pitch: plane._pitch || 0,
    HP: plane.HP,
    alive: plane.alive,
    score: plane.score,
    team: plane.team,
    plane: plane.type,
  };
}

/* ------------------------- helpers ----------------------------------- */
function quatFromHeadingPitch(out, heading = 0, pitch = 0) {
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
  out.copy(qy).multiply(qx);
  return out;
}

/** Adapter so remote planes look like local planes for translation/rotation/linvel. */
function makeFakeBody() {
  const _pos = new THREE.Vector3();
  const _rot = new THREE.Quaternion();
  const _vel = new THREE.Vector3();
  return {
    _position: _pos, _rotation: _rot, _velocity: _vel,
    translation() { return { x: _pos.x, y: _pos.y, z: _pos.z }; },
    rotation()    { return { x: _rot.x, y: _rot.y, z: _rot.z, w: _rot.w }; },
    linvel()      { return { x: _vel.x, y: _vel.y, z: _vel.z }; },
  };
}

function buildFallbackMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x888888 }),
  );
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  return g;
}
