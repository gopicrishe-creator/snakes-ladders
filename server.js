'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const G = require('./src/game');
const board = require('./src/board');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'rooms.json');
const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // rooms are cleaned up after 12h

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/** code -> room. Rooms hold no sockets, so they serialise cleanly. */
const rooms = new Map();

/* --------------------------------------------------------------- persistence */

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const room of raw.rooms || []) {
      if (Date.now() - room.createdAt > ROOM_TTL_MS) continue;
      room.players.forEach((p) => { p.connected = false; });
      rooms.set(room.code, room);
    }
    console.log(`[snl] restored ${rooms.size} room(s) from disk`);
  } catch (err) {
    console.error('[snl] could not restore rooms:', err.message);
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify({ rooms: [...rooms.values()] }));
    } catch (err) {
      console.error('[snl] could not save rooms:', err.message);
    }
  }, 400);
}

setInterval(() => {
  for (const [code, room] of rooms) {
    if (Date.now() - room.createdAt > ROOM_TTL_MS) rooms.delete(code);
  }
}, 60 * 60 * 1000).unref();

/* ------------------------------------------------------------------ http app */

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// The client gets its board data from the server, never from its own copy.
app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(
    `window.SNL_CONFIG=${JSON.stringify({
      snakes: board.SNAKES,
      ladders: board.LADDERS,
      finalSquare: board.FINAL_SQUARE,
      maxPlayers: board.MAX_PLAYERS,
      colors: board.PLAYER_COLORS,
    })};`,
  );
});

app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  if (!room) return res.status(404).json({ exists: false });
  return res.json({
    exists: true,
    status: room.status,
    players: room.players.length,
    max: board.MAX_PLAYERS,
  });
});

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

/* ------------------------------------------------------------------- sockets */

async function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  save();
  const sockets = await io.in(code).fetchSockets();
  for (const s of sockets) {
    s.emit('state', G.viewFor(room, { role: s.data.role, playerId: s.data.playerId }));
  }
}

function fail(socket, message) {
  socket.emit('notice', { level: 'error', message });
}

/** Wraps an engine call: report the error, or broadcast the new truth. */
async function apply(socket, room, result) {
  if (!result.ok) return fail(socket, result.error);
  await broadcast(room.code);
  return null;
}

function requireAdmin(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) { fail(socket, 'That room no longer exists.'); return null; }
  if (socket.data.role !== 'admin' || room.adminSession !== socket.data.sessionId) {
    fail(socket, 'Only the host can do that.');
    return null;
  }
  return room;
}

io.on('connection', (socket) => {
  socket.data = { role: null, code: null, playerId: null, sessionId: null };

  /* ---- host creates or resumes a room ---- */
  socket.on('admin:create', async ({ sessionId } = {}) => {
    const room = G.createRoom((c) => rooms.has(c));
    room.adminSession = sessionId || `host-${room.code}`;
    rooms.set(room.code, room);
    G.logEvent(room, 'admin', `Room ${room.code} created.`);

    socket.data = { role: 'admin', code: room.code, playerId: null, sessionId: room.adminSession };
    socket.join(room.code);
    socket.emit('joined', { role: 'admin', code: room.code, sessionId: room.adminSession });
    await broadcast(room.code);
  });

  socket.on('admin:attach', async ({ code, sessionId } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return fail(socket, 'No room with that code. Create a new one.');
    if (room.adminSession && sessionId && room.adminSession !== sessionId) {
      return fail(socket, 'Another host is already running this room.');
    }
    room.adminSession = room.adminSession || sessionId;
    socket.data = { role: 'admin', code: room.code, playerId: null, sessionId: room.adminSession };
    socket.join(room.code);
    socket.emit('joined', { role: 'admin', code: room.code, sessionId: room.adminSession });
    return broadcast(room.code);
  });

  /* ---- player joins or reconnects ---- */
  socket.on('player:join', async ({ code, name, sessionId } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return fail(socket, 'No room with that code. Check it with your host.');

    const result = G.addPlayer(room, name, sessionId);
    if (!result.ok) return fail(socket, result.error);

    socket.data = { role: 'player', code: room.code, playerId: result.player.id, sessionId };
    socket.join(room.code);
    socket.emit('joined', {
      role: 'player',
      code: room.code,
      playerId: result.player.id,
      name: result.player.name,
      hex: result.player.hex,
      rejoined: !!result.rejoined,
    });
    return broadcast(room.code);
  });

  /* ---- gameplay ---- */
  socket.on('player:roll', async () => {
    const room = rooms.get(socket.data.code);
    if (!room) return fail(socket, 'That room no longer exists.');
    if (socket.data.role !== 'player') return fail(socket, 'Only players roll the dice.');
    return apply(socket, room, G.rollDice(room, socket.data.playerId));
  });

  socket.on('player:answered', async () => {
    const room = rooms.get(socket.data.code);
    if (!room) return fail(socket, 'That room no longer exists.');
    if (socket.data.role !== 'player') return fail(socket, 'Only the player can submit their answer.');
    return apply(socket, room, G.submitAnswer(room, socket.data.playerId, false));
  });

  /* ---- host controls ---- */
  const adminActions = {
    'admin:start': (room) => G.startGame(room),
    'admin:pause': (room) => G.pauseGame(room),
    'admin:resume': (room) => G.resumeGame(room),
    'admin:reset': (room) => G.resetGame(room),
    'admin:end': (room) => G.endGame(room),
    'admin:skipTurn': (room) => G.skipTurn(room),
    'admin:forceAnswer': (room) => G.submitAnswer(room, null, true),
  };

  for (const [event, fn] of Object.entries(adminActions)) {
    socket.on(event, async () => {
      const room = requireAdmin(socket);
      if (!room) return null;
      return apply(socket, room, fn(room));
    });
  }

  socket.on('admin:removePlayer', async ({ playerId } = {}) => {
    const room = requireAdmin(socket);
    if (!room) return null;
    return apply(socket, room, G.removePlayerIfWaiting(room, playerId));
  });

  /* ---- presence ---- */
  socket.on('disconnect', async () => {
    const { code, role, playerId } = socket.data;
    const room = rooms.get(code);
    if (!room) return;

    if (role === 'player' && playerId) {
      // Only mark offline if no other tab of theirs is still connected.
      const sockets = await io.in(code).fetchSockets();
      const stillHere = sockets.some((s) => s.data.playerId === playerId);
      if (!stillHere) {
        const player = G.findPlayer(room, playerId);
        if (player && player.connected) {
          player.connected = false;
          G.logEvent(room, 'leave', `${player.name} disconnected.`);
          const active = G.activePlayer(room);
          if (active && active.id === playerId && room.status === 'running') {
            G.logEvent(room, 'warning', `It is ${player.name}'s turn but they are offline. Host can skip the turn.`);
          }
        }
      }
    }

    if (role === 'admin') {
      const sockets = await io.in(code).fetchSockets();
      const adminStillHere = sockets.some((s) => s.data.role === 'admin');
      if (!adminStillHere) {
        G.logEvent(room, 'warning', 'Host disconnected. The board is frozen until they return.');
      }
    }

    await broadcast(code);
  });
});

load();
server.listen(PORT, () => {
  console.log(`\n  Snakes & Ladders is running.`);
  console.log(`  Host dashboard : http://localhost:${PORT}/admin`);
  console.log(`  Player join    : http://localhost:${PORT}/\n`);
});

module.exports = { app, server, io, rooms };
