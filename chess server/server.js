const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

const crypto = require('crypto');

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://bestchess-pa1n-vagyuk.netlify.app');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') return res.sendStatus(204);  // preflight-запрос браузера
    next();
});

const users = {};   // { логин: { salt, hash, wins, losses, avatar } }
const tokens = {};  // { токен: логин }

const hashPassword = (password, salt) =>
    crypto.scryptSync(password, salt, 64).toString('hex');

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
app.post('/api/register', (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Заполни оба поля' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
    if (users[login]) return res.status(400).json({ error: 'Логин уже занят' });

    const salt = crypto.randomBytes(16).toString('hex');
    users[login] = { salt, hash: hashPassword(password, salt), wins: 0, losses: 0, avatar: null };

    const token = crypto.randomBytes(32).toString('hex');
    tokens[token] = login;
    res.json({ token, login });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    const user = users[login];
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const hash = hashPassword(password, user.salt);
    if (hash !== user.hash) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const token = crypto.randomBytes(32).toString('hex');
    tokens[token] = login;
    res.json({ token, login });
});

app.get('/api/profile', (req, res) => {
    const login = tokens[req.headers.authorization];
    if (!login) return res.status(401).json({ error: 'Не авторизован' });
    const { wins, losses, avatar } = users[login];
    res.json({ login, wins, losses, rating: 0, avatar });
});
app.post('/api/avatar', (req, res) => {
    const login = tokens[req.headers.authorization];
    if (!login) return res.status(401).json({ error: 'Не авторизован' });

    const { image } = req.body;
    if (!image || !image.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Некорректное изображение' });
    }
    if (image.length > 400000) {   // ~300 КБ после сжатия
        return res.status(400).json({ error: 'Слишком большая картинка' });
    }
    users[login].avatar = image;
    res.json({ ok: true });
});

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

    // Синхронизация маны и способностей
    socket.on('abilitySync', (data) => {
        if (data && data.roomId && rooms[data.roomId]) {
            if (data.fen) rooms[data.roomId].fen = data.fen;
            socket.to(data.roomId).emit('abilitySync', data);
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