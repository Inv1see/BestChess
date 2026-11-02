// Дожидаемся полной загрузки DOM перед выполнением кода
document.addEventListener('DOMContentLoaded', () => {
    let board = null; // Инициализируем шахматную доску
    const game = new Chess(); // Создаём новый Chess.js игровой экземпляр

    const moveHistory = document.getElementById('move-history'); // История перемещений
    let moveCount = 1; // Инициализируем количество ходов
    
    // 'w' - белые, 'b' - черные
    let userColor = 'w'; 
    
    // Стейт способностей
    const abilityState = {
        phantomQueen: null,    // { square: 'e4', color: 'w', moveCountTrigger: 0 }
        lasso: null            // { knightSquare: 'c3', affectedPieces: ['b2', 'd4'], expiresAtMove: 0 }
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

    // Функция проверки соседних клеток для Лассо
    const getNeighbors = (square) => {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const fileIdx = files.indexOf(square[0]);
        const rank = parseInt(square[1]);
        const neighbors = [];

        for (let df = -1; df <= 1; df++) {
            for (let dr = -1; dr <= 1; dr++) {
                if (df === 0 && dr === 0) continue;
                const nf = files[fileIdx + df];
                const nr = rank + dr;
                if (nf && nr >= 1 && nr <= 8) {
                    neighbors.push(nf + nr);
                }
            }
        }
        return neighbors;
    };

    // Проверка лимитов перемещения Лассо
    const isValidLassoMove = (source, target) => {
        if (!abilityState.lasso) return true;
        // Если фигура под лассо
        if (abilityState.lasso.affectedPieces.includes(source)) {
            const allowedSquares = getNeighbors(abilityState.lasso.knightSquare);
            // Фигура может ходить только вокруг коня (на соседние с конем клетки)
            if (!allowedSquares.includes(target)) {
                return false;
            }
        }
        return true;
    };

    const checkAndTriggerPhantomReturn = () => {
        if (!abilityState.phantomQueen) return;

        const pieces = game.board().flat();
        const currentQueen = pieces.find(p => p && p.type === 'q' && p.color === abilityState.phantomQueen.color);
        if (!currentQueen) {
            document.querySelector(`.square-${abilityState.phantomQueen.square}`)?.classList.remove('phantom-zone');
            abilityState.phantomQueen = null;
            return;
        }

        if (moveCount >= abilityState.phantomQueen.moveCountTrigger) {
            setTimeout(() => {
                let currentQueenSquare = getPieceSquare('q', abilityState.phantomQueen.color);
                if (currentQueenSquare) {
                    const tempGame = new Chess(game.fen());
                    tempGame.remove(currentQueenSquare);
                    tempGame.put({ type: 'q', color: abilityState.phantomQueen.color }, abilityState.phantomQueen.square);
                    const success = game.load(tempGame.fen());
                    if (success) {
                        board.position(game.fen());
                        playChessSound('move');
                    }
                }
                document.querySelector(`.square-${abilityState.phantomQueen.square}`)?.classList.remove('phantom-zone');
                abilityState.phantomQueen = null;
                $('body').mouseup();
                board.resize();
            }, 100);
        }
    };

    // Очистка лассо по истечении ходов
    const checkLassoExpiry = () => {
        if (abilityState.lasso && moveCount >= abilityState.lasso.expiresAtMove) {
            document.querySelectorAll('.lasso-zone').forEach(el => el.classList.remove('lasso-zone'));
            abilityState.lasso = null;
        }
    };

    const checkGameOver = () => {
        if (!game.game_over()) return;
        setTimeout(() => {
            if (game.in_checkmate()) {
                alert(game.turn() === 'w' ? "Шах и мат! Победили черные." : "Шах и мат! Победили белые.");
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
        return piece.search(userColor) === 0;
    };

    const onDrop = (source, target) => {
        const piece = game.get(source);
        if (!piece) return 'snapback';

        if (abilityState.phantomQueen && target === abilityState.phantomQueen.square) {
            alert("Эта клетка занята бессмертным фантомом Ферзя!");
            return 'snapback';
        }

        // Проверка ограничения лассо "Cowboy"
        if (!isValidLassoMove(source, target)) {
            alert("Фигура поймана в лассо! Вы не можете отойти от Ковбоя дальше, чем на 1 клетку.");
            return 'snapback';
        }

        const isMagic = window.event && window.event.shiftKey; 
        let activeLassoThisTurn = false;
        let lassoTargets = [];

        // АКТИВАЦИЯ СПОСОБНОСТИ КОНЯ
        if (isMagic && piece.type === 'n') {
            // Находим ВСЕ 8 соседних клеток вокруг ЦЕЛЕВОЙ клетки
            const neighbors = getNeighbors(target);
            
            // Фильтруем только те соседние клетки, на которых реально стоят фигуры
            neighbors.forEach(sq => {
                if (game.get(sq)) lassoTargets.push(sq);
            });

            if (lassoTargets.length === 0) {
                alert("Рядом с местом приземления нет фигур для захвата в лассо!");
                return 'snapback';
            }

            activeLassoThisTurn = true;
        }

        // АКТИВАЦИЯ ФЕРЗЯ
        if (isMagic && piece.type === 'q' && !abilityState.phantomQueen) {
            abilityState.phantomQueen = { square: source, color: userColor, moveCountTrigger: moveCount + 5 };
            setTimeout(() => { document.querySelector(`.square-${source}`)?.classList.add('phantom-zone'); }, 50);
        }

        const move = game.move({
            from: source,
            to: target,
            promotion: 'q',
        });

        if (move === null) {
            // Сброс стейта при неудачном ходе
            if (isMagic && piece.type === 'q' && abilityState.phantomQueen && abilityState.phantomQueen.moveCountTrigger === moveCount + 5) {
                abilityState.phantomQueen = null;
                document.querySelectorAll('.phantom-zone').forEach(el => el.classList.remove('phantom-zone'));
            }
            return 'snapback';
        }

        // Если ход коня успешен, применяем стейт Лассо
        if (activeLassoThisTurn) {
            abilityState.lasso = {
                knightSquare: target,
                affectedPieces: lassoTargets, // Ограничение накладывается только на пойманные фигуры
                expiresAtMove: moveCount + 3 // Действует 1 полный круг
            };
            
            // Подсвечиваем ВСЕ 8 соседних клеток бирюзовым цветом
            setTimeout(() => {
                const neighborsToHighlight = getNeighbors(target);
                neighborsToHighlight.forEach(sq => {
                    document.querySelector(`.square-${sq}`)?.classList.add('lasso-zone');
                });
            }, 50);
        }

        if (move.captured) { playChessSound('capture'); } else { playChessSound('move'); }
        
        recordMove(move.san, moveCount);
        
        moveCount++;
        userColor = game.turn();
        
        // Проверяем тайминги магии
        checkAndTriggerPhantomReturn();
        checkLassoExpiry();
        checkGameOver();
    };

    const onSnapEnd = () => { board.position(game.fen()); };

    board = Chessboard('board', {
        showNotation: true, draggable: true, position: 'start',
        onDragStart, onDrop, onSnapEnd,
        moveSpeed: 'fast', snapBackSpeed: 500, snapSpeed: 100,
    });

    document.querySelector('.play-again').addEventListener('click', () => {
        game.reset();
        board.start();
        moveHistory.textContent = '';
        moveCount = 1;
        userColor = 'w';
        document.querySelectorAll('.phantom-zone, .lasso-zone').forEach(el => {
            el.classList.remove('phantom-zone', 'lasso-zone');
        });
        abilityState.phantomQueen = null;
        abilityState.lasso = null;
    });

    document.querySelector('.flip-board').addEventListener('click', () => { board.flip(); });
    window.addEventListener('resize', () => { board.resize(); });
});
