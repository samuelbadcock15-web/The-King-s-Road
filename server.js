const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize 6 fixed lobbies
const NUM_ROOMS = 6;
const lobbies = {};

for (let i = 1; i <= NUM_ROOMS; i++) {
    const id = `room_${i}`;
    lobbies[id] = {
        id,
        name: `Arena ${i}`,
        status: 'open', // 'open', 'in-progress'
        players: {}     // socketId -> { role: 'player'|'enemy', ready: boolean }
    };
}

function broadcastLobbyState() {
    const overview = Object.values(lobbies).map(r => ({
        id: r.id,
        name: r.name,
        status: r.status,
        playerCount: Object.keys(r.players).length,
        isFull: Object.keys(r.players).length >= 2
    }));
    io.emit('lobby_list_update', overview);
}

function getPlayerRoom(socketId) {
    for (const rId in lobbies) {
        if (lobbies[rId].players[socketId]) return lobbies[rId];
    }
    return null;
}

function leaveCurrentRoom(socket) {
    const room = getPlayerRoom(socket.id);
    if (!room) return;

    delete room.players[socket.id];
    socket.leave(room.id);

    if (room.status === 'in-progress') {
        io.to(room.id).emit('opponent_disconnected');
        room.status = 'open';
        room.players = {};
    } else {
        io.to(room.id).emit('room_detail_update', room);
    }
    broadcastLobbyState();
}

io.on('connection', (socket) => {
    // Send initial lobby list
    broadcastLobbyState();

    socket.on('join_room', (roomId) => {
        const room = lobbies[roomId];
        if (!room) return;

        // Leave any room currently in
        leaveCurrentRoom(socket);

        const currentCount = Object.keys(room.players).length;
        if (currentCount >= 2 || room.status !== 'open') {
            socket.emit('join_error', 'Room is full or currently in-game.');
            return;
        }

        const role = currentCount === 0 ? 'player' : 'enemy';
        room.players[socket.id] = { role, ready: false };
        socket.join(room.id);

        socket.emit('joined_room_success', { roomId: room.id, role });
        io.to(room.id).emit('room_detail_update', room);
        broadcastLobbyState();
    });

    socket.on('toggle_ready', () => {
        const room = getPlayerRoom(socket.id);
        if (!room || room.status !== 'open') return;

        const p = room.players[socket.id];
        if (p) p.ready = !p.ready;

        io.to(room.id).emit('room_detail_update', room);

        // Check if both are ready to start
        const playerIds = Object.keys(room.players);
        if (playerIds.length === 2 && playerIds.every(id => room.players[id].ready)) {
            room.status = 'in-progress';
            playerIds.forEach(id => {
                io.to(id).emit('assigned_role', {
                    roomId: room.id,
                    team: room.players[id].role
                });
            });
            broadcastLobbyState();
        }
    });

    socket.on('leave_room', () => {
        leaveCurrentRoom(socket);
    });

    // Relay actions
    socket.on('spawn_unit', (data) => socket.to(data.roomId).emit('spawn_unit', data));
    socket.on('unit_order_move', (data) => socket.to(data.roomId).emit('unit_order_move', data));
    socket.on('buy_structure', (data) => socket.to(data.roomId).emit('buy_structure', data));
    socket.on('upgrade_structure', (data) => socket.to(data.roomId).emit('upgrade_structure', data));
    socket.on('toggle_gate', (data) => socket.to(data.roomId).emit('toggle_gate', data));

    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});
