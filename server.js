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
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingPlayers = [];
const rooms = {};
let totalOnlinePlayers = 0;

function broadcastPlayerCounts() {
    io.emit('update_counts', { totalOnline: totalOnlinePlayers, inQueue: waitingPlayers.length });
}

io.on('connection', (socket) => {
    totalOnlinePlayers++;
    console.log('A player connected:', socket.id);
    broadcastPlayerCounts();

    waitingPlayers.push(socket);
    socket.emit('waiting_for_opponent');

    if (waitingPlayers.length >= 2) {
        const p1 = waitingPlayers.shift();
        const p2 = waitingPlayers.shift();

        const roomId = `room_${Math.random().toString(36).substring(2, 9)}`;
        p1.join(roomId);
        p2.join(roomId);

        rooms[roomId] = { p1: p1.id, p2: p2.id };

        io.to(p1.id).emit('assigned_role', { playerIndex: 1, roomId, team: 'player' });
        io.to(p2.id).emit('assigned_role', { playerIndex: 2, roomId, team: 'enemy' });

        io.to(roomId).emit('start_match');
        console.log(`Match started in room: ${roomId}`);
        broadcastPlayerCounts();
    }

    socket.on('spawn_unit', (data) => {
        socket.to(data.roomId).emit('spawn_unit', data);
    });

    socket.on('player_move', (data) => {
        socket.to(data.roomId).emit('opponent_move', data);
    });

    socket.on('fire_projectile', (data) => {
        socket.to(data.roomId).emit('opponent_fire', data);
    });

    socket.on('destroy_unit', (data) => {
        socket.to(data.roomId).emit('opponent_destroy', data);
    });

    socket.on('check_game_over', (data) => {
        io.to(data.roomId).emit('trigger_game_over', data);
    });

    socket.on('request_restart', (data) => {
        io.to(data.roomId).emit('restart_game');
    });

    socket.on('disconnect', () => {
        totalOnlinePlayers = Math.max(0, totalOnlinePlayers - 1);
        console.log('A player disconnected:', socket.id);
        
        waitingPlayers = waitingPlayers.filter(s => s.id !== socket.id);

        for (const roomId in rooms) {
            if (rooms[roomId].p1 === socket.id || rooms[roomId].p2 === socket.id) {
                io.to(roomId).emit('opponent_disconnected');
                delete rooms[roomId];
            }
        }
        broadcastPlayerCounts();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});
