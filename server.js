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

// Initialize 6 fixed rooms
const rooms = {};
for (let i = 1; i <= 6; i++) {
    const roomId = `room_${i}`;
    rooms[roomId] = {
        id: roomId,
        name: `Arena 0${i}`,
        players: {},
        status: 'open'
    };
}

function getLobbiesSummary() {
    const list = [];
    for (const rId in rooms) {
        const r = rooms[rId];
        const pKeys = Object.keys(r.players);
        list.push({
            id: r.id,
            name: r.name,
            playerCount: pKeys.length,
            status: r.status,
            players: pKeys.map(id => ({
                id,
                ready: r.players[id].ready,
                team: r.players[id].team
            }))
        });
    }
    return list;
}

function broadcastLobbyState() {
    io.emit('lobbies_update', getLobbiesSummary());
}

function removePlayerFromCurrentRoom(socket) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (room.players[socket.id]) {
            delete room.players[socket.id];
            socket.leave(roomId);

            if (room.status === 'in_game') {
                io.to(roomId).emit('opponent_disconnected');
                room.status = 'open';
                room.players = {};
            } else {
                io.to(roomId).emit('room_player_left', { socketId: socket.id });
            }
            broadcastLobbyState();
            break;
        }
    }
}

io.on('connection', (socket) => {
    console.log(`--> Player connected: ${socket.id}`);

    socket.emit('lobbies_update', getLobbiesSummary());

    socket.on('join_room', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        if (room.status === 'in_game') {
            socket.emit('lobby_error', 'This match is currently in progress!');
            return;
        }

        const currentPlayers = Object.keys(room.players);
        if (currentPlayers.length >= 2) {
            socket.emit('lobby_error', 'This room is already full!');
            return;
        }

        removePlayerFromCurrentRoom(socket);

        const assignedTeam = currentPlayers.length === 0 ? 'player' : (room.players[currentPlayers[0]].team === 'player' ? 'enemy' : 'player');

        room.players[socket.id] = {
            team: assignedTeam,
            ready: false
        };

        socket.join(roomId);
        socket.emit('room_joined', {
            roomId: room.id,
            name: room.name,
            team: assignedTeam,
            players: room.players
        });

        broadcastLobbyState();
    });

    socket.on('leave_room', () => {
        removePlayerFromCurrentRoom(socket);
        socket.emit('left_room_success');
        broadcastLobbyState();
    });

    socket.on('toggle_ready', (roomId) => {
        const room = rooms[roomId];
        if (!room || !room.players[socket.id]) return;

        room.players[socket.id].ready = !room.players[socket.id].ready;
        broadcastLobbyState();

        const playerIds = Object.keys(room.players);
        const allReady = playerIds.length === 2 && playerIds.every(id => room.players[id].ready);

        if (allReady) {
            room.status = 'in_game';
            broadcastLobbyState();

            const p1 = playerIds[0];
            const p2 = playerIds[1];

            io.to(p1).emit('start_match_countdown', { roomId, team: room.players[p1].team });
            io.to(p2).emit('start_match_countdown', { roomId, team: room.players[p2].team });

            console.log(`=== MATCH STARTED === Room: ${roomId} | P1: ${p1} vs P2: ${p2}`);
        }
    });

    // In-game Relay Events
    socket.on('spawn_unit', (data) => {
        socket.to(data.roomId).emit('spawn_unit', data);
    });

    socket.on('unit_order_move', (data) => {
        socket.to(data.roomId).emit('unit_order_move', data);
    });

    socket.on('buy_structure', (data) => {
        socket.to(data.roomId).emit('buy_structure', data);
    });

    socket.on('upgrade_structure', (data) => {
        socket.to(data.roomId).emit('upgrade_structure', data);
    });

    socket.on('upgrade_unit', (data) => {
        socket.to(data.roomId).emit('upgrade_unit', data);
    });

    socket.on('toggle_gate', (data) => {
        socket.to(data.roomId).emit('toggle_gate', data);
    });

    socket.on('unit_attack', (data) => {
        socket.to(data.roomId).emit('unit_attack', data);
    });

    socket.on('structure_attack', (data) => {
        socket.to(data.roomId).emit('structure_attack', data);
    });

    socket.on('unit_killed', (data) => {
        socket.to(data.roomId).emit('unit_killed', data);
    });

    socket.on('structure_destroyed', (data) => {
        socket.to(data.roomId).emit('structure_destroyed', data);
    });

    socket.on('base_attack', (data) => {
        socket.to(data.roomId).emit('base_attack', data);
    });

    socket.on('tank_shot_fx', (data) => {
        socket.to(data.roomId).emit('tank_shot_fx', data);
    });

    socket.on('laser_shot_fx', (data) => {
        socket.to(data.roomId).emit('laser_shot_fx', data);
    });

    socket.on('game_over_trigger', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            room.status = 'open';
            room.players = {};
        }
        io.to(data.roomId).emit('game_over_sync', data);
        broadcastLobbyState();
    });

    socket.on('disconnect', () => {
        console.log(`<-- Player disconnected: ${socket.id}`);
        removePlayerFromCurrentRoom(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});
