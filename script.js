// Дожидаемся полной загрузки DOM перед выполнением кода
document.addEventListener('DOMContentLoaded', () => {
    let board = null; // Инициализируем шахматную доску
    const game = new Chess(); // Создаём новый Chess.js игровой экземпляр

    const moveHistory = document.getElementById('move-history'); // История перемещений
    let moveCount = 1; // Инициализируем количество ходов
    
    // Теперь userColor всегда соответствует тому, чья очередь ходить по правилам Chess.js
    // 'w' - белые, 'b' - черные
    let userColor = 'w'; 
    
    const abilityState = {
        phantomQueen: null    // { square: 'e4', color: 'w', moveCountTrigger: 0 }
    };

    function playChessSound(actionType) {
        let audioPath = '';
        if (actionType === 'capture') { audioPath = 'sounds/capture.mp3'; } else audioPath = 'sounds/move.mp3';
        const audio = new Audio(audioPath);
        audio.play().catch(error => console.log("звук заблокирован", error));
    }

    const getPieceSquare = (type, color) => {
        for (let r = 1; r <= 8; r++) {
            for (let f of ['a','b','c','d','e','f','g','h']) {
                let p = game.get(f+r);
                if (p && p.type === type && p.color === color) return f+r;
            }
        }
        return null;
    };

    // возвратка ферзя
    const checkAndTriggerPhantomReturn = () => {
        if (!abilityState.phantomQueen) return;

        // отмена магии при смерти ферзя
        const pieces = game.board().flat();
        const currentQueen = pieces.find(p => p && p.type === 'q' && p.color === abilityState.phantomQueen.color);
        if (!currentQueen) {
            document.querySelector(`.square-${abilityState.phantomQueen.square}`)?.classList.remove('phantom-zone');
            abilityState.phantomQueen = null;
            return;
        }

        // Если наступил нужный ход для возвращения
        if (moveCount >= abilityState.phantomQueen.moveCountTrigger) {
            setTimeout(() => {
                let currentQueenSquare = getPieceSquare('q', abilityState.phantomQueen.color);
                
                if (currentQueenSquare) {
                    // Создаем временный экземпляр Chess для генерации «чистой» позиции без поломки истории ходов
                    const tempGame = new Chess(game.fen());
                    tempGame.remove(currentQueenSquare);
                    tempGame.put({ type: 'q', color: abilityState.phantomQueen.color }, abilityState.phantomQueen.square);
                    const success = game.load(tempGame.fen());
                    
                    if (success) {
                        board.position(game.fen());
                        playChessSound('move');
                    }
                }
                
                // Очищаем визуальные эффекты и стейт
                document.querySelector(`.square-${abilityState.phantomQueen.square}`)?.classList.remove('phantom-zone');
                abilityState.phantomQueen = null;
                
                // Полный сброс фокуса мыши
                $('body').mouseup();
                board.resize();
            }, 100);
        }
    };

    const checkGameOver = () => {
        if (!game.game_over()) return;

        setTimeout(() => {
            if (game.in_checkmate()) {
                if (game.turn() === 'w') {
                    alert("Шах и мат! Победили черные.");
                } else {
                    alert("Шах и мат! Победили белые.");
                }
            } else if (game.in_stalemate()) {
                alert("Пат! Ничья.");
            } else if (game.in_draw()) {
                alert("Ничья!");
            }
        }, 100);
    };

    const recordMove = (move, count) => {
        const formattedMove = count % 2 === 1 ? `${Math.ceil(count / 2)}. ${move}` : `${move} -\n`;
        moveHistory.textContent += formattedMove + ' ';
        moveHistory.scrollTop = moveHistory.scrollHeight;
    };

    const onDragStart = (source, piece) => {
        if (game.game_over()) return false;
        
        // Разрешаем перетаскивать только те фигуры, чей ход активен в данный момент
        return piece.search(userColor) === 0;
    };

    const onDrop = (source, target) => {
        const piece = game.get(source);
        if (!piece) return 'snapback';

        if (abilityState.phantomQueen && target === abilityState.phantomQueen.square) {
            alert("Эта клетка занята бессмертным фантомом Ферзя!");
            return 'snapback';
        }

        const isMagic = window.event && window.event.shiftKey; 
        
        if (isMagic && piece.type === 'q' && !abilityState.phantomQueen) {
            abilityState.phantomQueen = { 
                square: source, 
                color: userColor,
                moveCountTrigger: moveCount + 5
            };
            
            // подсветка
            setTimeout(() => {
                document.querySelector(`.square-${source}`)?.classList.add('phantom-zone');
            }, 50);
        }

        const move = game.move({
            from: source,
            to: target,
            promotion: 'q',
        });

        if (move === null) return 'snapback';

        if (move.captured) { playChessSound('capture'); } else { playChessSound('move'); }
        
        recordMove(move.san, moveCount);
        moveCount++;
        
        // Переключение игрока 
        userColor = game.turn();
        
        // Проверяем способность Фантомного Ферзя сразу после совершения хода
        checkAndTriggerPhantomReturn();
        
        checkGameOver();
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

    document.querySelector('.play-again').addEventListener('click', () => {
        game.reset();
        board.start();
        if (board.orientation() !== 'white') {
            board.orientation('white');
        }
        moveHistory.textContent = '';
        moveCount = 1;
        userColor = 'w'; // Сбрасываем ход на белых
        document.querySelectorAll('.phantom-zone').forEach(el => el.classList.remove('phantom-zone'));
        abilityState.phantomQueen = null;
    });

    document.querySelector('.flip-board').addEventListener('click', () => {
        board.flip();
    });

    window.addEventListener('resize', () => {
        board.resize();
    });

    let isTouchingPiece = false;
    $('#board').on('touchstart', '.piece-417db', function (e) {
        isTouchingPiece = true;
    });
    $('#board').on('touchmove', function (e) {
        if (isTouchingPiece) { e.preventDefault(); }
    });
    $('#board').on('touchend touchcancel', function (e) {
        isTouchingPiece = false;
    });
});
