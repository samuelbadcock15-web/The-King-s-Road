const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingPlayers = [];
const rooms = {};

io.on('connection', (socket) => {
    console.log(`--> Player connected: ${socket.id}`);

    waitingPlayers.push(socket);
    socket.emit('waiting_for_opponent');

    if (waitingPlayers.length >= 2) {
        const p1 = waitingPlayers.shift();
        const p2 = waitingPlayers.shift();

        const roomId = `room_${Math.random().toString(36).substring(2, 9)}`;
        p1.join(roomId);
        p2.join(roomId);

        rooms[roomId] = { p1: p1.id, p2: p2.id };

        io.to(p1.id).emit('assigned_role', { roomId, team: 'player' });
        io.to(p2.id).emit('assigned_role', { roomId, team: 'enemy' });

        console.log(`=== MATCH STARTED === Room: ${roomId} | P1: ${p1.id} vs P2: ${p2.id}`);
    }

    // Relay actions securely to the opponent in the same room
    socket.on('spawn_unit', (data) => socket.to(data.roomId).emit('spawn_unit', data));
    socket.on('buy_structure', (data) => socket.to(data.roomId).emit('buy_structure', data));
    socket.on('upgrade_structure', (data) => socket.to(data.roomId).emit('upgrade_structure', data));
    socket.on('toggle_gate', (data) => socket.to(data.roomId).emit('toggle_gate', data));

    socket.on('disconnect', () => {
        console.log(`<-- Player disconnected: ${socket.id}`);
        waitingPlayers = waitingPlayers.filter(s => s.id !== socket.id);

        for (const roomId in rooms) {
            if (rooms[roomId].p1 === socket.id || rooms[roomId].p2 === socket.id) {
                io.to(roomId).emit('opponent_disconnected');
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});
