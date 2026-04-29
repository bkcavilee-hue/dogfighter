// Multiplayer client. Wraps socket.io-client with a small typed API and
// handles the lifecycle: connect → lobby ops → in-game state sync.
//
// Game model is CLIENT-AUTHORITATIVE: each client publishes its own plane
// state (position/orientation/HP) at fixed intervals; the server fans those
// out to other clients in the same room. Shoot/missile/death are sent as
// discrete events.
import { io } from 'socket.io-client';

const STATE_HZ = 20;
const STATE_INTERVAL_MS = 1000 / STATE_HZ;

// Pick the server URL: same-origin in production (when the server serves the
// built bundle), localhost:3000 in dev (Vite is on 5174).
function resolveServerURL() {
  const isDev = window.location.port === '5174' || window.location.port === '5173';
  if (isDev) return 'http://localhost:3000';
  return window.location.origin;
}

export class Network {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.you = null;             // { id, name, plane, team } once joined
    this.roomId = null;
    this.players = [];           // remote players in our room (excludes us)
    this.roster = [];            // FULL ordered roster including us (join order)
    this._stateTimer = null;
    this._buildState = null;     // function returning the current local state
    this._listeners = {
      roomList: new Set(),
      playerJoined: new Set(),
      playerLeft: new Set(),
      remoteState: new Set(),    // (playerId, state) => void
      remoteEvent: new Set(),    // (playerId, event) => void
      connected: new Set(),
      disconnected: new Set(),
    };
  }

  connect() {
    if (this.socket) return;
    // Try websocket first, fall back to polling. Some proxies/CDNs strip
    // WebSocket upgrades; without polling fallback the client just hangs.
    this.socket = io(resolveServerURL(), {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      console.log('[MP] connected to', resolveServerURL(), '— socket id:', this.socket.id);
      this._fire('connected');
    });
    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      console.warn('[MP] disconnected:', reason);
      this._fire('disconnected');
    });
    this.socket.on('connect_error', (err) => {
      console.error('[MP] connect_error:', err.message);
    });

    this.socket.on('lobby:roomList', ({ rooms }) => this._fire('roomList', rooms));
    this.socket.on('lobby:playerJoined', ({ player }) => {
      // Idempotent: ignore duplicate joins for the same id (which can happen
      // if a peer reconnects/rejoins before the server processed their leave).
      if (this.roster.some((p) => p.id === player.id)) return;
      if (this.players.some((p) => p.id === player.id)) return;
      console.log('[MP] player joined:', player.name, player.id);
      this.players.push(player);
      this.roster.push(player);
      this._fire('playerJoined', player);
    });
    this.socket.on('lobby:playerLeft', ({ playerId }) => {
      console.log('[MP] player left:', playerId);
      this.players = this.players.filter((p) => p.id !== playerId);
      this.roster = this.roster.filter((p) => p.id !== playerId);
      this._fire('playerLeft', playerId);
    });
    this.socket.on('game:state', ({ id, state }) => this._fire('remoteState', id, state));
    this.socket.on('game:event', ({ id, event }) => this._fire('remoteEvent', id, event));
  }

  /* ------------------- Lobby ops (Promise-based) -------------------- */
  listRooms() {
    return new Promise((resolve) => {
      this.socket.emit('lobby:list', (res) => resolve(res?.rooms || []));
    });
  }

  createRoom({ name, mode, playerName, plane }) {
    return new Promise((resolve, reject) => {
      this.socket.emit('lobby:create', { name, mode, playerName, plane }, (res) => {
        if (res?.ok) {
          this.you = res.you;
          this.roomId = res.roomId;
          this.roster = res.players.slice();          // full ordered list (just us at first)
          this.players = res.players.filter((p) => p.id !== this.you.id);
          console.log(`[MP] created room "${name}" (${res.roomId}); you are ${this.you.name} (${this.you.team})`);
          resolve(res);
        } else reject(new Error(res?.error || 'create failed'));
      });
    });
  }

  joinRoom({ roomId, playerName, plane }) {
    return new Promise((resolve, reject) => {
      this.socket.emit('lobby:join', { roomId, playerName, plane }, (res) => {
        if (res?.ok) {
          this.you = res.you;
          this.roomId = res.roomId;
          this.roster = res.players.slice();          // full ordered list as the server sees it
          this.players = res.players.filter((p) => p.id !== this.you.id);
          console.log(`[MP] joined room ${res.roomId}; you are ${this.you.name} (${this.you.team}); ${this.players.length} other player(s)`);
          resolve(res);
        } else reject(new Error(res?.error || 'join failed'));
      });
    });
  }

  leaveRoom() {
    if (!this.socket || !this.roomId) return;
    this.socket.emit('lobby:leave');
    this.roomId = null;
    this.you = null;
    this.players = [];
    this.roster = [];
    this.stopStateLoop();
  }

  /**
   * Host = the FIRST player in the join-order roster. If the host leaves,
   * the next player in line takes over automatically because everyone reads
   * from the same ordered list. Returns the player record or null.
   */
  getHost() {
    return this.roster[0] || null;
  }
  isHost() {
    return !!this.you && this.getHost()?.id === this.you.id;
  }

  /* -------------------- In-game state push ------------------------- */
  /** Provide a function the loop can call to build the local plane state. */
  startStateLoop(buildStateFn) {
    this._buildState = buildStateFn;
    if (this._stateTimer) clearInterval(this._stateTimer);
    this._stateTimer = setInterval(() => {
      if (!this.connected || !this.roomId) return;
      const state = this._buildState();
      if (state) this.socket.volatile.emit('game:state', state);
    }, STATE_INTERVAL_MS);
  }

  stopStateLoop() {
    if (this._stateTimer) {
      clearInterval(this._stateTimer);
      this._stateTimer = null;
    }
    this._buildState = null;
  }

  /** Send a discrete event (shoot, missile, hit, death). */
  sendEvent(event) {
    if (!this.connected || !this.roomId) return;
    this.socket.emit('game:event', event);
  }

  /** Push state for an array of AI bots owned by this client (host only). */
  sendBotStates(states) {
    if (!this.connected || !this.roomId || !states.length) return;
    this.socket.volatile.emit('game:bot-states', states);
  }

  /* ------------------------ Listeners ------------------------------ */
  on(channel, fn) {
    const set = this._listeners[channel];
    if (!set) throw new Error('Unknown channel: ' + channel);
    set.add(fn);
    return () => set.delete(fn);
  }

  _fire(channel, ...args) {
    const set = this._listeners[channel];
    if (!set) return;
    for (const fn of set) {
      try { fn(...args); } catch (err) { console.warn('listener error', err); }
    }
  }
}

// Module-level singleton — only one connection per page session.
export const network = new Network();
