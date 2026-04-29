// Pure in-memory room store. No persistence — restart wipes state.
// Each room holds up to MAX_PLAYERS_PER_ROOM clients. Rooms are auto-deleted
// when the last player leaves.

import { randomUUID } from 'node:crypto';

const MAX_PLAYERS_PER_ROOM = 6;
const MAX_ROOMS = 50;

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Map<string, string>} socketId → roomId */
    this.socketToRoom = new Map();
  }

  list() {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      mode: r.mode,
      players: r.players.length,
      maxPlayers: r.maxPlayers,
    }));
  }

  create({ name, mode = 'ffa' }) {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error('Server full — too many rooms');
    }
    const id = randomUUID().slice(0, 8);
    const room = {
      id,
      name: (name || 'Room').slice(0, 32),
      mode,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      players: [],
      createdAt: Date.now(),
    };
    this.rooms.set(id, room);
    return room;
  }

  /** Add a socket to a room. Returns the player record + the room. */
  join(roomId, { socketId, name, plane }) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.players.length >= room.maxPlayers) throw new Error('Room is full');
    if (this.socketToRoom.has(socketId)) {
      // Auto-leave previous room if user rejoins.
      this.leave(socketId);
    }
    const player = {
      id: socketId,
      name: (name || 'Pilot').slice(0, 24),
      plane: plane || 'interceptor',
      team: assignTeam(room, socketId),
      joinedAt: Date.now(),
    };
    room.players.push(player);
    this.socketToRoom.set(socketId, roomId);
    return { room, player };
  }

  /** Remove socket's player from its room. Returns { roomId, playerId } or null. */
  leave(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    this.socketToRoom.delete(socketId);
    if (!room) return { roomId, playerId: socketId };
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx >= 0) room.players.splice(idx, 1);
    if (room.players.length === 0) this.rooms.delete(roomId);
    return { roomId, playerId: socketId };
  }

  getRoomBySocket(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }
}

/**
 * Team assignment depends on room mode:
 *  - 'ffa'    : every player is their own team (uses socket id) so all others
 *               are enemies and friendly-fire checks naturally allow everyone.
 *  - 'team2v2': alternates red/blue to balance.
 */
function assignTeam(room, socketId) {
  if (room.mode === 'ffa') return socketId;
  const red = room.players.filter((p) => p.team === 'red').length;
  const blue = room.players.filter((p) => p.team === 'blue').length;
  return red <= blue ? 'red' : 'blue';
}
