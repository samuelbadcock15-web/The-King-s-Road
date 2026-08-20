const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingPlayer = null;
const rooms = {};
let totalOnlinePlayers = 0;

function broadcastPlayerCounts() {
    io.emit('update_counts', { totalOnline: totalOnlinePlayers, inQueue: waitingPlayer ? 1 : 0 });
}

io.on('connection', (socket) => {
    totalOnlinePlayers++;
    console.log('A player connected:', socket.id);
    broadcastPlayerCounts();

    if (!waitingPlayer) {
        waitingPlayer = socket;
        socket.emit('waiting_for_opponent');
    } else {
        const roomId = `room_${Math.random().toString(36).substring(2, 9)}`;
        socket.join(roomId);
        waitingPlayer.join(roomId);

        rooms[roomId] = {
            p1: waitingPlayer.id,
            p2: socket.id
        };

        io.to(waitingPlayer.id).emit('assigned_role', { playerIndex: 1, roomId, team: 'player' });
        io.to(socket.id).emit('assigned_role', { playerIndex: 2, roomId, team: 'enemy' });

        io.to(roomId).emit('start_match');
        waitingPlayer = null;
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
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }
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
