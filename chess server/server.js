const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Разрешаем подключение на Netlify
const io = new Server(server, {
    cors: {
        origin: [
            "https://bestchess-pa1n-vagyuk.netlify.app",
            "http://localhost:3000",
            "http://127.0.0.1:5500"
        ],
        methods: ["GET", "POST"]
    }
});


app.get('/', (req, res) => {
    res.send('Chess server is running');
});

// Хранилище комнат: { roomId: { players: [socketId1, socketId2], fen: 'start' } }
const rooms = {};

io.on('connection', (socket) => {
    console.log('Подключился:', socket.id);

    // Создание комнаты (нажимает «Быстрый»)
    socket.on('createRoom', () => {
        const roomId = uuidv4().slice(0, 6);
        rooms[roomId] = { players: [socket.id], fen: 'start' };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.emit('roomCreated', roomId);
        console.log(`Комната ${roomId} создана игроком ${socket.id}`);
    });

    // Подключение по ссылке (друг)
    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('errorMsg', 'Комната не существует');
            return;
        }
        if (room.players.length >= 2) {
            socket.emit('errorMsg', 'Комната уже заполнена');
            return;
        }
        room.players.push(socket.id);
        socket.join(roomId);
        socket.roomId = roomId;

        // Рандомный выбор цвета создателя
        const creatorColor = Math.random() < 0.5 ? 'w' : 'b';
        const joinerColor = creatorColor === 'w' ? 'b' : 'w';

        // Обоим игрокам — их цвет и текущая позиция
        socket.emit('gameStarted', { color: joinerColor, fen: room.fen });
        io.to(room.players[0]).emit('gameStarted', { color: creatorColor, fen: room.fen });

        console.log(`Игрок ${socket.id} зашёл в комнату ${roomId}. Создатель: ${creatorColor === 'w' ? 'белые' : 'черные'}`);
    });

    // Пересылка хода
    socket.on('move', ({ roomId, move, fen }) => {
        if (rooms[roomId]) {
            rooms[roomId].fen = fen;
            socket.to(roomId).emit('opponentMove', { move, fen });
        }
    });

    // Отключение
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            socket.to(roomId).emit('opponentLeft');
            delete rooms[roomId];
            console.log(`Комната ${roomId} удалена (игрок отключился)`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});