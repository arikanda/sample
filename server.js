const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const rooms = new Map();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/socket.io')) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  next();
});

function clean(value, max = 40) { return String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max); }
function roomState(room) { return rooms.get(room) || { people: new Map(), voice: new Set(), live: new Set(), camera: new Set(), messages: [] }; }
function emitPeople(room) {
  const state = roomState(room);
  io.to(room).emit('people', [...state.people].map(([id, name]) => ({ id, name, voice: state.voice.has(id), live: state.live.has(id), camera: state.camera.has(id) })));
}

io.on('connection', socket => {
  socket.on('room:join', ({ room: rawRoom, name: rawName } = {}) => {
    const room = clean(rawRoom, 32).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'hangout';
    const name = clean(rawName, 24) || 'Friend';
    socket.data.room = room;
    socket.data.name = name;
    socket.join(room);
    const state = roomState(room);
    state.people.set(socket.id, name);
    rooms.set(room, state);
    socket.emit('room:ready', { room, messages: state.messages.slice(-100) });
    emitPeople(room);
  });

  socket.on('chat:send', text => {
    const { room, name } = socket.data;
    if (!room) return;
    const body = clean(text, 1000);
    if (!body) return;
    const message = { id: `${Date.now()}-${socket.id}`, name, body, at: Date.now() };
    const state = roomState(room);
    state.messages.push(message);
    if (state.messages.length > 200) state.messages.shift();
    io.to(room).emit('chat:message', message);
  });
  socket.on('profile:rename', rawName => {
    const { room } = socket.data;
    if (!room) return;
    const name = clean(rawName, 24) || 'Friend';
    socket.data.name = name;
    roomState(room).people.set(socket.id, name);
    io.to(room).emit('profile:renamed', { id: socket.id, name });
    emitPeople(room);
  });

  socket.on('voice:join', () => {
    const { room } = socket.data;
    if (!room) return;
    const state = roomState(room);
    state.voice.add(socket.id);
    socket.emit('voice:peers', [...state.voice].filter(id => id !== socket.id).map(id => ({ id, name: state.people.get(id) })));
    socket.to(room).emit('voice:peer-joined', { id: socket.id, name: socket.data.name });
    emitPeople(room);
  });
  socket.on('voice:leave', () => {
    const { room } = socket.data;
    if (!room) return;
    roomState(room).voice.delete(socket.id);
    roomState(room).live.delete(socket.id);
    roomState(room).camera.delete(socket.id);
    socket.to(room).emit('voice:peer-left', socket.id);
    emitPeople(room);
  });
  socket.on('stream:state', live => {
    const { room } = socket.data;
    if (!room || !roomState(room).voice.has(socket.id)) return;
    if (live) roomState(room).live.add(socket.id);
    else roomState(room).live.delete(socket.id);
    emitPeople(room);
  });
  socket.on('camera:state', enabled => {
    const { room } = socket.data;
    if (!room || !roomState(room).voice.has(socket.id)) return;
    if (enabled) roomState(room).camera.add(socket.id);
    else roomState(room).camera.delete(socket.id);
    emitPeople(room);
  });
  socket.on('rtc:signal', ({ to, data } = {}) => {
    if (socket.data.room && roomState(socket.data.room).voice.has(socket.id) && roomState(socket.data.room).voice.has(to))
      io.to(to).emit('rtc:signal', { from: socket.id, data });
  });
  socket.on('disconnect', () => {
    const { room } = socket.data;
    if (!room) return;
    const state = roomState(room);
    state.people.delete(socket.id);
    state.voice.delete(socket.id);
    state.live.delete(socket.id);
    state.camera.delete(socket.id);
    socket.to(room).emit('voice:peer-left', socket.id);
    emitPeople(room);
    if (!state.people.size) rooms.delete(room);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`STARs is ready at http://localhost:${port}`));
