document.addEventListener('DOMContentLoaded', () => {
    let board = null;
    const menuScreen = document.getElementById('main-menu');
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

    let authToken = localStorage.getItem('chess_token') || null;
    let myLogin = localStorage.getItem('chess_login') || null;

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


    // ========== ВХОД ==========
    const authScreen = document.getElementById('auth-screen');
    const authError = document.getElementById('auth-error');

    const authRequest = async (endpoint, login, password) => {
        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        authToken = data.token;
        myLogin = data.login;
        localStorage.setItem('chess_token', authToken);
        localStorage.setItem('chess_login', myLogin);
    };


    const showAuth = () => {
        authScreen.classList.remove('hidden');
        menuScreen.classList.add('hidden');
        authError.textContent = '';
        authError.style.color = 'red';
    };
    const showMenu = () => { authScreen.classList.add('hidden'); menuScreen.classList.remove('hidden'); };

    authToken ? showMenu() : showAuth();

    const authTitle = document.querySelector('#auth-screen h2');
    const btnLogin = document.getElementById('btn-login');
    const btnRegister = document.getElementById('btn-register');

    const setAuthMode = (mode) => {
        authTitle.textContent = mode === 'register' ? 'Регистрация' : 'Вход в Best Chess';
        authError.textContent = '';
    };

    btnLogin.addEventListener('click', () => {
        setAuthMode('login');
        handleAuth('/api/login');
    });

    btnRegister.addEventListener('click', () => {
        setAuthMode('register');
        handleAuth('/api/register');
    });

    const handleAuth = async (endpoint) => {
        const login = document.getElementById('auth-login').value.trim();
        const password = document.getElementById('auth-password').value;

        // Кнопки блокируем на время запроса
        btnLogin.disabled = true;
        btnRegister.disabled = true;
        authError.textContent = 'Отправляю...';

        try {
            await authRequest(endpoint, login, password);
            authError.textContent = 'Готово! Добро пожаловать.';
            authError.style.color = '#2c7454';   // зелёный вместо красного
            setTimeout(showMenu, 600);           // короткая пауза, чтобы сообщение успели увидеть
        } catch (e) {
            authError.textContent = e.message;
            authError.style.color = 'red';
        } finally {
            btnLogin.disabled = false;
            btnRegister.disabled = false;
        }
    };

    document.getElementById('btn-guest').addEventListener('click', () => {
        myLogin = null;
        authToken = null;
        showMenu();
    });
    // ========== МЕНЮ ==========
    const gameScreen = document.getElementById('game-screen');

    const cabinetScreen = document.getElementById('cabinet-screen');
    const btnCabinet = document.getElementById('btn-cabinet');
    const btnCabinetBack = document.getElementById('btn-cabinet-back');


    if (btnCabinet) {
        btnCabinet.addEventListener('click', async () => {
            // Гость не проходит: показываем экран входа с пояснением
            if (!authToken) {
                showAuth();
                authError.textContent = 'Личный кабинет доступен только зарегистрированным игрокам';
                authError.style.color = '#b3261e';
                return;
            }

            cabinetScreen.classList.remove('hidden');
            menuScreen.classList.add('hidden');

            const response = await fetch(`${BACKEND_URL}/api/profile`, {
                headers: { 'Authorization': authToken }
            });

            // Токен протух (например, сервер перезапустился) — отправляем на вход
            if (!response.ok) {
                authToken = null;
                localStorage.removeItem('chess_token');
                localStorage.removeItem('chess_login');
                showAuth();
                return;
            }
            const data = await response.json();

            cabinetScreen.querySelector('.player-name').textContent = data.login;

            document.getElementById('stat-rating').textContent = data.rating;
            document.getElementById('stat-wins').textContent = data.wins;
            document.getElementById('stat-losses').textContent = data.losses;
            if (data.avatar) {
                avatarBox.style.background = `url(${data.avatar}) center/cover`;
            }
        });
    }
    if (btnCabinetBack) {
        btnCabinetBack.addEventListener('click', () => {
            cabinetScreen.classList.add('hidden');
            menuScreen.classList.remove('hidden');
        });
    }
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            authToken = null;
            myLogin = null;
            localStorage.removeItem('chess_token');
            localStorage.removeItem('chess_login');

            // Сбрасываем кабинет, чтобы следующему вошедшему не показались чужие данные
            cabinetScreen.querySelector('.player-name').textContent = 'Игрок';
            document.getElementById('stat-rating').textContent = '0';
            document.getElementById('stat-wins').textContent = '0';
            document.getElementById('stat-losses').textContent = '0';
            avatarBox.style.background = '';

            cabinetScreen.classList.add('hidden');
            showAuth();
        });
    }

    const avatarBox = document.getElementById('avatar-box');
    const avatarInput = document.getElementById('avatar-input');

    avatarBox.addEventListener('click', () => {
        if (authToken) avatarInput.click();
    });

    avatarInput.addEventListener('change', () => {
        const file = avatarInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Сжимаем в квадрат 256x256
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext('2d');

                // Обрезаем по центру (crop)
                const side = Math.min(img.width, img.height);
                ctx.drawImage(img,
                    (img.width - side) / 2, (img.height - side) / 2, side, side,
                    0, 0, 256, 256);

                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

                // Отправляем на сервер
                fetch(`${BACKEND_URL}/api/avatar`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authToken
                    },
                    body: JSON.stringify({ image: dataUrl })
                }).then(() => {
                    avatarBox.style.background = `url(${dataUrl}) center/cover`;
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('btn-guest').addEventListener('click', () => {
        myLogin = null;
        authToken = null;
        localStorage.removeItem('chess_token');
        localStorage.removeItem('chess_login');
        showMenu();
    });

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

        // Пришёл по ссылке — никаких экранов входа, сразу в игру
        authScreen.classList.add('hidden');
        menuScreen.classList.add('hidden');

        const tryJoin = () => {
            if (!socket.connected) return; // ждём подключения, событие 'connect' вызовет снова
            socket.emit('joinRoom', roomFromUrl);
        };

        if (socket.connected) tryJoin();
        socket.on('connect', tryJoin);
    } else {
        authToken ? showMenu() : showAuth();
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