const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://bestchess-pa1n-vagyuk.netlify.app');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

const users = {};   // { login: { salt, hash, wins, losses, draws, rating, rd, lastGameAt, avatar } }
const tokens = {};  // { token: login }
const rooms = {};   // { roomId: { players, logins, socketColors, fen, isRanked, finished, moveCount } }
const rankedQueue = []; // [{ socketId, login, joinedAt }]

const hashPassword = (password, salt) =>
    crypto.scryptSync(password, salt, 64).toString('hex');

// ========== СИСТЕМА РЕЙТИНГА CHESS.COM (GLICKO-1) ==========
const GLICKO = {
    INITIAL_RATING: 800, // Стартовый рейтинг (можно поставить 400 / 800 / 1200)
    INITIAL_RD: 350,     // Начальное отклонение рейтинга
    MIN_RD: 50,          // Минимальное RD (при 50 равная победа даёт ~+8, как на Chess.com)
    MIN_RATING: 100,     // Нижний порог рейтинга на Chess.com
    C_PER_DAY: 18.2,     // Скорость роста RD за день простоя (к 350 примерно за год)
    Q: Math.LN10 / 400
};

function getEffectiveRD(user, now = Date.now()) {
    const rd = user.rd ?? GLICKO.INITIAL_RD;
    if (!user.lastGameAt) return rd;
    const daysElapsed = Math.max(0, (now - user.lastGameAt) / (1000 * 60 * 60 * 24));
    return Math.min(
        GLICKKO_MAX_RD(),
        Math.sqrt(rd * rd + GLICKO.C_PER_DAY * GLICKO.C_PER_DAY * daysElapsed)
    );
}
function GLICKO_MAX_RD() { return GLICKO.INITIAL_RD; }

function glickoG(rd) {
    return 1 / Math.sqrt(1 + (3 * GLICKO.Q * GLICKO.Q * rd * rd) / (Math.PI * Math.PI));
}

function glickoExpected(r, rOpp, rdOpp) {
    return 1 / (1 + Math.pow(10, (-glickoG(rdOpp) * (r - rOpp)) / 400));
}

function computeGlickoUpdate(r, rd, rOpp, rdOpp, score) {
    const g = glickoG(rdOpp);
    const e = glickoExpected(r, rOpp, rdOpp);
    const d2 = 1 / (GLICKO.Q * GLICKO.Q * g * g * e * (1 - e));
    const invRd2 = 1 / (rd * rd);
    const denom = invRd2 + 1 / d2;

    const newRating = Math.max(
        GLICKO.MIN_RATING,
        r + (GLICKO.Q / denom) * g * (score - e)
    );
    const newRd = Math.max(GLICKO.MIN_RD, Math.sqrt(1 / denom));

    return { newRating, newRd };
}

function applyRankedMatchResult(room, winnerColor) {
    const whiteLogin = room.logins?.w;
    const blackLogin = room.logins?.b;
    const white = whiteLogin && users[whiteLogin];
    const black = blackLogin && users[blackLogin];
    if (!white || !black) return null;

    const now = Date.now();
    const rW = white.rating;
    const rB = black.rating;
    const rdW = getEffectiveRD(white, now);
    const rdB = getEffectiveRD(black, now);

    const scoreW = winnerColor === 'w' ? 1 : winnerColor === 'b' ? 0 : 0.5;
    const scoreB = 1 - scoreW;

    // Считаем оба результата из значений ДО матча
    const resW = computeGlickoUpdate(rW, rdW, rB, rdB, scoreW);
    const resB = computeGlickoUpdate(rB, rdB, rW, rdW, scoreB);

    const oldDisplayW = Math.round(rW);
    const oldDisplayB = Math.round(rB);

    white.rating = resW.newRating;
    white.rd = resW.newRd;
    white.lastGameAt = now;

    black.rating = resB.newRating;
    black.rd = resB.newRd;
    black.lastGameAt = now;

    if (winnerColor === 'w') {
        white.wins++;
        black.losses++;
    } else if (winnerColor === 'b') {
        black.wins++;
        white.losses++;
    } else {
        white.draws++;
        black.draws++;
    }

    const newDisplayW = Math.round(white.rating);
    const newDisplayB = Math.round(black.rating);

    return {
        w: {
            login: whiteLogin,
            oldRating: oldDisplayW,
            newRating: newDisplayW,
            delta: newDisplayW - oldDisplayW
        },
        b: {
            login: blackLogin,
            oldRating: oldDisplayB,
            newRating: newDisplayB,
            delta: newDisplayB - oldDisplayB
        }
    };
}

// ========== EXPRESS API ==========
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

app.post('/api/register', (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Заполни оба поля' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
    if (users[login]) return res.status(400).json({ error: 'Логин уже занят' });

    const salt = crypto.randomBytes(16).toString('hex');
    users[login] = {
        salt,
        hash: hashPassword(password, salt),
        wins: 0,
        losses: 0,
        draws: 0,
        rating: GLICKO.INITIAL_RATING,
        rd: GLICKO.INITIAL_RD,
        lastGameAt: null,
        avatar: null
    };

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
    const { wins, losses, draws, rating, rd, avatar } = users[login];
    res.json({
        login,
        wins,
        losses,
        draws: draws || 0,
        rating: Math.round(rating),
        rd: Math.round(getEffectiveRD(users[login])),
        avatar
    });
});

app.post('/api/avatar', (req, res) => {
    const login = tokens[req.headers.authorization];
    if (!login) return res.status(401).json({ error: 'Не авторизован' });

    const { image } = req.body;
    if (!image || !image.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Некорректное изображение' });
    }
    if (image.length > 400000) {
        return res.status(400).json({ error: 'Слишком большая картинка' });
    }
    users[login].avatar = image;
    res.json({ ok: true });
});

// ========== МАТЧМЕЙКИНГ РЕЙТИНГОВОЙ ИГРЫ ==========
function removeFromRankedQueue(socketId) {
    const idx = rankedQueue.findIndex(q => q.socketId === socketId);
    if (idx !== -1) rankedQueue.splice(idx, 1);
}

function tryMatchRankedPlayers() {
    if (rankedQueue.length < 2) return;
    const now = Date.now();

    for (let i = 0; i < rankedQueue.length; i++) {
        const a = rankedQueue[i];
        const userA = users[a.login];
        const sockA = io.sockets.sockets.get(a.socketId);
        if (!userA || !sockA) {
            rankedQueue.splice(i--, 1);
            continue;
        }

        for (let j = i + 1; j < rankedQueue.length; j++) {
            const b = rankedQueue[j];
            const userB = users[b.login];
            const sockB = io.sockets.sockets.get(b.socketId);
            if (!userB || !sockB) {
                rankedQueue.splice(j--, 1);
                continue;
            }
            if (a.login === b.login) continue;

            const waitSec = Math.max(now - a.joinedAt, now - b.joinedAt) / 1000;
            // Стартует с ±150 и расширяется на +100 каждые 5 секунд (как на Chess.com)
            const allowedDiff = waitSec >= 35 ? Infinity : 150 + Math.floor(waitSec / 5) * 100;

            if (Math.abs(userA.rating - userB.rating) <= allowedDiff) {
                rankedQueue.splice(j, 1);
                rankedQueue.splice(i, 1);

                const roomId = uuidv4().slice(0, 6);
                const aIsWhite = Math.random() < 0.5;
                const white = aIsWhite ? { sock: sockA, login: a.login, user: userA } : { sock: sockB, login: b.login, user: userB };
                const black = aIsWhite ? { sock: sockB, login: b.login, user: userB } : { sock: sockA, login: a.login, user: userA };

                rooms[roomId] = {
                    players: [white.sock.id, black.sock.id],
                    logins: { w: white.login, b: black.login },
                    socketColors: { [white.sock.id]: 'w', [black.sock.id]: 'b' },
                    fen: 'start',
                    isRanked: true,
                    finished: false,
                    moveCount: 0
                };

                white.sock.join(roomId);
                black.sock.join(roomId);
                white.sock.roomId = roomId;
                black.sock.roomId = roomId;

                const playersInfo = {
                    w: { login: white.login, rating: Math.round(white.user.rating) },
                    b: { login: black.login, rating: Math.round(black.user.rating) }
                };

                white.sock.emit('gameStarted', {
                    color: 'w',
                    fen: 'start',
                    roomId,
                    isRanked: true,
                    players: playersInfo
                });
                black.sock.emit('gameStarted', {
                    color: 'b',
                    fen: 'start',
                    roomId,
                    isRanked: true,
                    players: playersInfo
                });

                console.log(`Рейтинговая игра ${roomId}: ${white.login} (${playersInfo.w.rating}) vs ${black.login} (${playersInfo.b.rating})`);
                return;
            }
        }
    }
}

setInterval(tryMatchRankedPlayers, 1000);

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log('Подключился:', socket.id);

    socket.on('authenticate', (token) => {
        socket.login = token && tokens[token] ? tokens[token] : null;
        if (!socket.login) removeFromRankedQueue(socket.id);
    });

    socket.on('findRanked', () => {
        if (!socket.login || !users[socket.login]) {
            socket.emit('rankedError', 'Для рейтинговой игры нужно войти в аккаунт.');
            return;
        }
        if (rankedQueue.some(q => q.socketId === socket.id || q.login === socket.login)) {
            return;
        }
        rankedQueue.push({ socketId: socket.id, login: socket.login, joinedAt: Date.now() });
        socket.emit('rankedSearching', { rating: Math.round(users[socket.login].rating) });
        tryMatchRankedPlayers();
    });

    socket.on('cancelRanked', () => {
        removeFromRankedQueue(socket.id);
    });

    // Создание комнаты (нажимает «Быстрый»)
    socket.on('createRoom', () => {
        const roomId = uuidv4().slice(0, 6);
        rooms[roomId] = {
            players: [socket.id],
            logins: {},
            socketColors: {},
            fen: 'start',
            isRanked: false,
            finished: false,
            moveCount: 0
        };
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
        const hostId = room.players[0];
        room.players.push(socket.id);
        socket.join(roomId);
        socket.roomId = roomId;

        const creatorColor = Math.random() < 0.5 ? 'w' : 'b';
        const joinerColor = creatorColor === 'w' ? 'b' : 'w';
        room.socketColors[hostId] = creatorColor;
        room.socketColors[socket.id] = joinerColor;

        socket.emit('gameStarted', { color: joinerColor, fen: room.fen, roomId, isRanked: false });
        io.to(hostId).emit('gameStarted', { color: creatorColor, fen: room.fen, roomId, isRanked: false });
    });

    // Пересылка хода
    socket.on('move', ({ roomId, move, fen }) => {
        const room = rooms[roomId];
        if (room && !room.finished) {
            room.fen = fen;
            room.moveCount++;
            socket.to(roomId).emit('opponentMove', { move, fen });
        }
    });

    // Синхронизация маны и способностей
    socket.on('abilitySync', (data) => {
        const room = data && data.roomId && rooms[data.roomId];
        if (room && !room.finished) {
            if (data.fen) room.fen = data.fen;
            if (data.kind === 'customMove' || data.kind === 'midRebalance') {
                room.moveCount++;
            }
            socket.to(data.roomId).emit('abilitySync', data);
        }
    });

    // Окончание партии (мат / пат / ничья)
    socket.on('gameOver', ({ roomId, reason, winnerColor }) => {
        const room = rooms[roomId];
        if (!room || room.finished) return;
        if (!room.players.includes(socket.id)) return;

        room.finished = true;
        const ratingChanges = room.isRanked ? applyRankedMatchResult(room, winnerColor) : null;
        io.to(roomId).emit('gameEnded', { reason, winnerColor, ratingChanges });
    });

    // Сдача
    socket.on('resign', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.finished) return;
        const myColor = room.socketColors?.[socket.id];
        if (!myColor) return;

        const winnerColor = myColor === 'w' ? 'b' : 'w';
        room.finished = true;
        const ratingChanges = room.isRanked ? applyRankedMatchResult(room, winnerColor) : null;
        io.to(roomId).emit('gameEnded', { reason: 'resign', winnerColor, ratingChanges });
    });

    // Отключение
    socket.on('disconnect', () => {
        removeFromRankedQueue(socket.id);
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            if (!room.finished) {
                if (room.isRanked) {
                    room.finished = true;
                    if (room.moveCount > 0) {
                        const myColor = room.socketColors[socket.id];
                        const winnerColor = myColor === 'w' ? 'b' : 'w';
                        const ratingChanges = applyRankedMatchResult(room, winnerColor);
                        socket.to(roomId).emit('gameEnded', {
                            reason: 'abandon',
                            winnerColor,
                            ratingChanges
                        });
                    } else {
                        // На Chess.com выход до первого хода отменяет партию без потери рейтинга
                        socket.to(roomId).emit('gameEnded', {
                            reason: 'abort',
                            winnerColor: null,
                            ratingChanges: null
                        });
                    }
                } else {
                    socket.to(roomId).emit('opponentLeft');
                }
            }
            delete rooms[roomId];
            console.log(`Комната ${roomId} удалена`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});