document.addEventListener('DOMContentLoaded', () => {
    let board = null;
    const game = new Chess();

    const moveHistory = document.getElementById('move-history');
    let moveCount = 1;
    let userColor = 'w';

    let stockfish = null;

    // ========== ЗВУКИ ==========
    function playChessSound(actionType) {
        let audioPath = actionType === 'capture' ? 'sounds/capture.mp3' : 'sounds/move.mp3';
        const audio = new Audio(audioPath);
        audio.play().catch(error => console.log("звук заблокирован", error));
    }

    // ========== STOCKFISH (режим с ботом) ==========
    try {
        stockfish = new Worker('stockfish-19-lite-single.js');
        stockfish.postMessage('setoption name Skill Level value 5');
        stockfish.onmessage = function (event) {
            const message = event.data;
            if (typeof message === 'string' && message.startsWith('bestmove')) {
                const bestMove = message.split(' ')[1];
                if (bestMove === '(none)') return;
                const from = bestMove.substring(0, 2);
                const to = bestMove.substring(2, 4);
                const promotion = bestMove.length > 4 ? bestMove[4] : 'q';
                const move = game.move({ from, to, promotion });
                if (move) {
                    playChessSound(move.captured ? 'capture' : 'move');
                    board.position(game.fen());
                    recordMove(move.san, moveCount);
                    moveCount++;
                    checkGameOver();
                }
            }
        };
    } catch (e) {
        console.error("Не удалось загрузить Stockfish:", e);
    }

    const makeSmartMove = () => {
        if (game.game_over() || !stockfish) return;
        stockfish.postMessage(`position fen ${game.fen()}`);
        stockfish.postMessage('go movetime 1000');
    };

    // ========== ОБЩИЕ ФУНКЦИИ ==========
    const checkGameOver = () => {
        if (!game.game_over()) return;
        setTimeout(() => {
            if (game.in_checkmate()) {
                alert(game.turn() === 'w'
                    ? "Шах и мат! Победили черные."
                    : "Шах и мат! Победили белые.");
            } else if (game.in_stalemate()) {
                alert("Пат! Ничья.");
            } else if (game.in_draw()) {
                alert("Ничья!");
            }
        }, 100);
    };

    const recordMove = (move, count) => {
        const formattedMove = count % 2 === 1 ? `${Math.ceil(count / 2)}. ${move}` : `${move} -`;
        moveHistory.textContent += formattedMove + ' ';
        moveHistory.scrollTop = moveHistory.scrollHeight;
    };

    // ========== СОКЕТ ==========
    const BACKEND_URL = 'https://chess-server-nnkd.onrender.com';
    const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

    let currentRoomId = null;
    let isOnlineMode = false;

    // ========== ОБРАБОТЧИКИ ДОСКИ ==========
    const onDragStart = (source, piece) => {
        return !game.game_over() && piece.search(userColor) === 0;
    };

    const onDrop = (source, target) => {
        const move = game.move({ from: source, to: target, promotion: 'q' });
        if (move === null) return 'snapback';

        playChessSound(move.captured ? 'capture' : 'move');
        recordMove(move.san, moveCount);
        moveCount++;
        checkGameOver();

        if (isOnlineMode && currentRoomId) {
            socket.emit('move', {
                roomId: currentRoomId,
                move: move,
                fen: game.fen()
            });
        } else {
            window.setTimeout(makeSmartMove, 250);
        }
    };

    const onSnapEnd = () => {
        board.position(game.fen());
    };

    const boardConfig = {
        showNotation: true,
        draggable: true,
        position: 'start',
        onDragStart,
        onDrop,
        onSnapEnd,
        moveSpeed: 'fast',
        snapBackSpeed: 500,
        snapSpeed: 100,
    };

    board = Chessboard('board', boardConfig);

    // ========== КНОПКИ В ИГРЕ ==========
    document.querySelector('.play-again').addEventListener('click', () => {
        if (isOnlineMode) {
            alert('В онлайн-режиме реванш пока не поддерживается. Создайте новую игру.');
            return;
        }
        game.reset();
        board.start();
        if (board.orientation() !== 'white') board.orientation('white');
        moveHistory.textContent = '';
        moveCount = 1;
        userColor = 'w';
    });

    document.querySelector('.flip-board').addEventListener('click', () => {
        board.flip();
        if (!isOnlineMode) {
            makeSmartMove();
            userColor = userColor === 'w' ? 'b' : 'w';
        }
    });

    window.addEventListener('resize', () => board.resize());

    // ========== ТАЧ-СОБЫТИЯ ==========
    let isTouchingPiece = false;
    $('#board').on('touchstart', '.piece-417db', () => { isTouchingPiece = true; });
    $('#board').on('touchmove', (e) => { if (isTouchingPiece) e.preventDefault(); });
    $('#board').on('touchend touchcancel', () => { isTouchingPiece = false; });

    // ========== МЕНЮ ==========
    const menuScreen = document.getElementById('main-menu');
    const gameScreen = document.getElementById('game-screen');

    const startGame = () => {
        menuScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        setTimeout(() => board.resize(), 50);
    };

    document.getElementById('btn-bot').addEventListener('click', () => {
        isOnlineMode = false;
        currentRoomId = null;
        startGame();
        game.reset();
        board.start();
        userColor = 'w';
        if (board.orientation() !== 'white') board.orientation('white');
        moveHistory.textContent = '';
        moveCount = 1;
    });

    // «Быстрый» = онлайн-игра
    document.getElementById('btn-online').addEventListener('click', () => {
        console.log('Быстрый: открываю модалку');
        document.getElementById('share-link').value = 'Создаём игру...';
        document.getElementById('link-modal').classList.remove('hidden');
        socket.emit('createRoom');
    });

    document.getElementById('btn-ranked').addEventListener('click', () => alert("Скоро!"));

    // ========== ОНЛАЙН-СОБЫТИЯ ==========
    socket.on('roomCreated', (roomId) => {
        console.log('Комната создана:', roomId);
        currentRoomId = roomId;
        isOnlineMode = true;

        const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
        const input = document.getElementById('share-link');
        const modal = document.getElementById('link-modal');
        if (input) input.value = link;
        if (modal) modal.classList.remove('hidden');
        else console.error('link-modal не найден!');
    });

    document.getElementById('copy-link-btn').addEventListener('click', () => {
        const link = document.getElementById('share-link').value;
        navigator.clipboard.writeText(link).then(() => {
            document.getElementById('copy-link-btn').textContent = 'Скопировано!';
            setTimeout(() => {
                document.getElementById('copy-link-btn').textContent = 'Копировать';
            }, 1500);
        }).catch(() => {
            document.getElementById('share-link').select();
            document.execCommand('copy');
        });
    });

    document.getElementById('close-modal-btn').addEventListener('click', () => {
        document.getElementById('link-modal').classList.add('hidden');
    });

    socket.on('opponentJoined', () => {
        const waiting = document.getElementById('waiting-text');
        if (waiting) {
            waiting.textContent = 'Соперник подключился! Игра началась.';
            waiting.style.color = '#2c7454';
        }
        setTimeout(() => {
            document.getElementById('link-modal').classList.add('hidden');
        }, 1500);
    });

    socket.on('gameStarted', ({ color, fen }) => {
        isOnlineMode = true;
        userColor = color;
        startGame();
        if (fen && fen !== 'start') {
            game.load(fen);
            board.position(fen);
        } else {
            game.reset();
            board.start();
        }

        board.orientation(color === 'w' ? 'white' : 'black');
        moveHistory.textContent = '';
        moveCount = 1;
        document.getElementById('link-modal').classList.add('hidden');
    });

    socket.on('errorMsg', (msg) => {
        alert(msg);
        document.getElementById('game-screen').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
    });

    socket.on('opponentMove', ({ move, fen }) => {
        game.move(move);
        board.position(fen);
        recordMove(move.san, moveCount);
        moveCount++;
        checkGameOver();
        playChessSound(move.captured ? 'capture' : 'move');
    });

    socket.on('opponentLeft', () => {
        alert('Соперник покинул игру.');
        isOnlineMode = false;
        currentRoomId = null;
        document.getElementById('game-screen').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
    });

    // ========== ПРОВЕРКА URL ==========
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        currentRoomId = roomFromUrl;
        socket.emit('joinRoom', roomFromUrl);
    }

    // Кнопка «В меню»
    const btnBack = document.getElementById('btn-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            if (isOnlineMode) {
                window.location.href = window.location.pathname;
                return;
            }
            gameScreen.classList.add('hidden');
            menuScreen.classList.remove('hidden');
        });
    }
});