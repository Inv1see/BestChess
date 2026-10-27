// Дожидаемся полной загрузки DOM перед выполнением кода
document.addEventListener('DOMContentLoaded', () => {
    let board = null; // Инициализируем шахматную доску
    const game = new Chess(); // Создаём новый Chess.js игровой экземпляр

    const moveHistory = document.getElementById('move-history'); // История перемещений
    let moveCount = 1; // Инициализируем количество ходов
    let userColor = 'w'; // Инициализируем цвет пользователя как белый

    // Функция для выполнения произвольного перемещения компьютера
    let stockfish = null;

    // Инициализируем движок
    try {
        // Пытаемся запустить в фоновом режиме (лучший вариант)
        stockfish = new Worker('stockfish-19-lite-single.js');

        // Настраиваем сложность (0 - слабый, 20 - очень сильный)
        stockfish.postMessage('setoption name Skill Level value 5');

        // Слушаем ответы от движка
        stockfish.onmessage = function (event) {
            const message = event.data;

            if (typeof message === 'string' && message.startsWith('bestmove')) {
                const bestMove = message.split(' ')[1]; // Например, "e2e4"

                if (bestMove === '(none)') return;

                const from = bestMove.substring(0, 2);
                const to = bestMove.substring(2, 4);
                const promotion = bestMove.length > 4 ? bestMove[4] : 'q';

                const move = game.move({ from, to, promotion });

                if (move) {
                    board.position(game.fen());
                    recordMove(move.san, moveCount);
                    moveCount++;
                }
            }
        };
    } catch (e) {
        console.error("Не удалось загрузить Stockfish как Worker. Возможно, вы открыли файл без сервера.", e);
        alert("Ошибка: для работы бота нужно запускать игру через локальный сервер (например, Live Server), а не двойным кликом!");
    }

    // Функция, которая заставляет бота задуматься
    const makeSmartMove = () => {
        if (game.game_over()) {
            alert("Шах и мат!");
            return;
        }
        if (stockfish) {
            // Передаем позицию и говорим думать 1 секунду
            stockfish.postMessage(`position fen ${game.fen()}`);
            stockfish.postMessage('go movetime 1000');
        }
    };

    // Функция для записи и отображения перемещения в истории перемещений
    const recordMove = (move, count) => {
        const formattedMove = count % 2 === 1 ? `${Math.ceil(count / 2)}. ${move}` : `${move} -`;
        moveHistory.textContent += formattedMove + ' ';
        moveHistory.scrollTop = moveHistory.scrollHeight; // Автоматическая прокрутка до последнего хода
    };

    // Функция для обработки начальной позиции перетаскивания
    const onDragStart = (source, piece) => {
        // Разрешить пользователю перетаскивать только свои собственные фрагменты в зависимости от цвета
        return !game.game_over() && piece.search(userColor) === 0;
    };

    // Функция для обработки падения фигуры на доску
    const onDrop = (source, target) => {
        const move = game.move({
            from: source,
            to: target,
            promotion: 'q',
        });

        if (move === null) return 'snapback';

        window.setTimeout(makeSmartMove, 250);
        recordMove(move.san, moveCount); // Записываем и отобразите ход с указанием количества ходов
        moveCount++;
    };

    // Функция для обработки анимации привязки конца фрагмента
    const onSnapEnd = () => {
        board.position(game.fen());
    };

    // Параметры конфигурации шахматной доски
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

    // Инициализируем шахматную доску
    board = Chessboard('board', boardConfig);

    // Event listener для кнопки "Играть снова"
    document.querySelector('.play-again').addEventListener('click', () => {
        game.reset();
        board.start();
        if (board.orientation() !== 'white') {
            board.orientation('white');
        }
        moveHistory.textContent = '';
        moveCount = 1;
        userColor = 'w';
    });

    // Event listener для кнопки "Установить положение"
    // document.querySelector('.set-pos').addEventListener('click', () => {
    //     const fen = prompt("Введите обозначение FEN для желаемой позиции!");
    //     if (fen !== null) {
    //         if (game.load(fen)) {
    //             board.position(fen);
    //             moveHistory.textContent = '';
    //             moveCount = 1;
    //             userColor = 'w';
    //         } else {
    //             alert("Недопустимое обозначение FEN. Пожалуйста, попробуйте снова.");
    //         }
    //     }
    // });

    // Event listener для кнопки "Перевернуть доску"
    document.querySelector('.flip-board').addEventListener('click', () => {
        board.flip();
        makeSmartMove();
        // Переключаем цвет пользователя после переворачивания доски
        userColor = userColor === 'w' ? 'b' : 'w';
    });
    window.addEventListener('resize', () => {
        board.resize();
    });

    let isTouchingPiece = false;

    $('#board').on('touchstart', '.piece-417db', function (e) {
        // Если коснулись фигуры — разрешаем перетаскивание
        isTouchingPiece = true;
    });

    $('#board').on('touchmove', function (e) {
        // Если мы тащим фигуру, блокируем скролл страницы
        if (isTouchingPiece) {
            e.preventDefault();
        }
    });

    $('#board').on('touchend touchcancel', function (e) {
        // Отпустили палец — всё снова можно
        isTouchingPiece = false;
    });

});