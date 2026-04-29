// Dogfighter realtime server.
// - Express serves the built client (production) and a health check.
// - Socket.IO handles lobby + per-room game messages.
// - Game state is CLIENT-AUTHORITATIVE: the server only relays state updates
//   and events between players in the same room. No physics here.

import express from 'express';
import { createServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './room-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'dist');

const app = express();
const httpServer = createServer(app);

// In production we serve the Vite-built bundle from the same origin so the
// client can connect to socket.io with no CORS hassles. In dev, the Vite dev
// server runs on 5174 and connects cross-origin (allowed below).
app.use(express.static(PUBLIC_DIR));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

const io = new IOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const rooms = new RoomManager();

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected (${io.engine.clientsCount} total)`);

  /* ------------------------- Lobby --------------------------------- */
  socket.on('lobby:list', (cb) => {
    if (typeof cb === 'function') cb({ rooms: rooms.list() });
  });

  socket.on('lobby:create', (data, cb) => {
    try {
      const room = rooms.create({ name: data?.name, mode: data?.mode });
      const { player } = rooms.join(room.id, {
        socketId: socket.id,
        name: data?.playerName,
        plane: data?.plane,
      });
      socket.join(room.id);
      io.emit('lobby:roomList', { rooms: rooms.list() });
      if (typeof cb === 'function') cb({ ok: true, roomId: room.id, you: player, players: room.players });
    } catch (err) {
      if (typeof cb === 'function') cb({ ok: false, error: err.message });
    }
  });

  socket.on('lobby:join', (data, cb) => {
    try {
      const { room, player } = rooms.join(data?.roomId, {
        socketId: socket.id,
        name: data?.playerName,
        plane: data?.plane,
      });
      socket.join(room.id);
      // Notify the joiner of the current player list
      if (typeof cb === 'function') cb({ ok: true, roomId: room.id, you: player, players: room.players });
      // Notify others in the room of the new arrival
      socket.to(room.id).emit('lobby:playerJoined', { player });
      io.emit('lobby:roomList', { rooms: rooms.list() });
    } catch (err) {
      if (typeof cb === 'function') cb({ ok: false, error: err.message });
    }
  });

  socket.on('lobby:leave', () => doLeave());

  /* -------------------- In-game state relay ----------------------- */
  // Relay player state at whatever rate the client sends (~20Hz). We do NOT
  // validate or transform — we trust the client and just rebroadcast.
  socket.on('game:state', (state) => {
    const room = rooms.getRoomBySocket(socket.id);
    if (!room) return;
    socket.to(room.id).volatile.emit('game:state', { id: socket.id, state });
  });

  // Discrete events: shoot, missile-fire, hit, death, etc.
  socket.on('game:event', (event) => {
    const room = rooms.getRoomBySocket(socket.id);
    if (!room) return;
    socket.to(room.id).emit('game:event', { id: socket.id, event });
  });

  // Bot states: the room "host" pushes states for every AI bot it owns.
  // Server simply relays each one so other clients can render the bots.
  socket.on('game:bot-states', (states) => {
    const room = rooms.getRoomBySocket(socket.id);
    if (!room || !Array.isArray(states)) return;
    for (const entry of states) {
      if (entry?.id && entry?.state) {
        socket.to(room.id).volatile.emit('game:state', { id: entry.id, state: entry.state });
      }
    }
  });

  socket.on('disconnect', () => {
    doLeave();
    console.log(`[-] ${socket.id} disconnected (${io.engine.clientsCount} total)`);
  });

  function doLeave() {
    const result = rooms.leave(socket.id);
    if (!result) return;
    socket.leave(result.roomId);
    io.to(result.roomId).emit('lobby:playerLeft', { playerId: result.playerId });
    io.emit('lobby:roomList', { rooms: rooms.list() });
  }
});

httpServer.listen(PORT, () => {
  console.log(`Dogfighter server listening on :${PORT}`);
  console.log(`  Health:    http://localhost:${PORT}/health`);
  console.log(`  Static:    ${PUBLIC_DIR}`);
});
