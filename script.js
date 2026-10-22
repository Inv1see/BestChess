// Дожидаемся полной загрузки DOM перед выполнением кода
document.addEventListener('DOMContentLoaded', () => {
    let board = null; // Инициализируем шахматную доску
    const game = new Chess(); // Создаём новый Chess.js игровой экземпляр
    const moveHistory = document.getElementById('move-history'); // История перемещений
    let moveCount = 1; // Инициализируем количество ходов
    let userColor = 'w'; // Инициализируем цвет пользователя как белый

    // Функция для выполнения произвольного перемещения компьютера
    const makeRandomMove = () => {
        const possibleMoves = game.moves();

        if (game.game_over()) {
            alert("Шах и мат!");
        } else {
            const randomIdx = Math.floor(Math.random() * possibleMoves.length);
            const move = possibleMoves[randomIdx];
            game.move(move);
            board.position(game.fen());
            recordMove(move, moveCount); // Записываем и отображаем ход с указанием количества ходов
            moveCount++; // Увеличиваем количество перемещений
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

        window.setTimeout(makeRandomMove, 250);
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
        moveHistory.textContent = '';
        moveCount = 1;
        userColor = 'w';
    });

    // Event listener для кнопки "Установить положение"
    document.querySelector('.set-pos').addEventListener('click', () => {
        const fen = prompt("Введите обозначение FEN для желаемой позиции!");
        if (fen !== null) {
            if (game.load(fen)) {
                board.position(fen);
                moveHistory.textContent = '';
                moveCount = 1;
                userColor = 'w';
            } else {
                alert("Недопустимое обозначение FEN. Пожалуйста, попробуйте снова.");
            }
        }
    });

    // Event listener для кнопки "Перевернуть доску"
    document.querySelector('.flip-board').addEventListener('click', () => {
        board.flip();
        makeRandomMove();
        // Переключаем цвет пользователя после переворачивания доски
        userColor = userColor === 'w' ? 'b' : 'w';
    });

});