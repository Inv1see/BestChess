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

    // ========== СИСТЕМА МАНЫ И СПОСОБНОСТЕЙ (ШКАЛА 0–1000) ==========
    const MAX_MANA = 1000;
    const START_MANA = 100;
    const PASSIVE_MANA = 40;
    const CHECK_BONUS = 35;
    const CHECK_COOLDOWN_TURNS = 3;
    const CASTLE_BONUS = 60;
    const TIME_JUMP_PENALTY = 150;
    const ABILITY_COOLDOWN = 3;

    const CAPTURE_MANA = {
        p: { gain: 30, loss: 15 },
        n: { gain: 110, loss: 65 },
        b: { gain: 110, loss: 65 },
        r: { gain: 180, loss: 110 },
        q: { gain: 300, loss: 200 }
    };

    const ABILITIES = [
        { id: 'onlyUp',       piece: 'Пешка',  name: 'Only Up',        cost: 140, desc: 'Прыжок пешки через вражескую фигуру перед ней' },
        { id: 'cowboy',       piece: 'Конь',   name: 'Cowboy',         cost: 320, desc: 'После хода лассо захватывает соседних врагов на 1 ход' },
        { id: 'samurai',      piece: 'Слон',   name: 'Samurai',        cost: 460, desc: 'Симметричная тень слона убивает врага и исчезает' },
        { id: 'timeJump',     piece: 'Ферзь',  name: 'Time jump',      cost: 580, desc: 'Бессмертная копия, возврат через 2 хода (срыв: -150 маны)' },
        { id: 'closeTheDoor', piece: 'Ладья',  name: 'Close the door', cost: 780, desc: '1/партию, не под шахом: щит короля на 3 хода врага' },
        { id: 'rebalance',    piece: 'Король', name: 'Rebalance',      cost: 920, desc: 'После вашего хода — ход переманенной фигурой врага' }
    ];

    const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    let mana = { w: START_MANA, b: START_MANA };
    let turnCounter = { w: 0, b: 0 };
    let lastCheckBonusTurn = { w: -99, b: -99 };
    let castledBonusUsed = { w: false, b: false };
    let usedCloseTheDoor = { w: false, b: false };
    let cooldowns = {
        w: { onlyUp: 0, cowboy: 0, samurai: 0, timeJump: 0, closeTheDoor: 0, rebalance: 0 },
        b: { onlyUp: 0, cowboy: 0, samurai: 0, timeJump: 0, closeTheDoor: 0, rebalance: 0 }
    };

    let armedAbility = null;
    let hoveredAbilityId = null;
    let lassoState = null;
    let phantoms = { w: null, b: null };
    let doors = { w: null, b: null };
    let rebalanceState = null;
    let samuraiFlashSquares = [];
    let statusToastTimeout = null;

    const sqToCoords = (sq) => ({ f: FILES.indexOf(sq[0]), r: parseInt(sq[1], 10) - 1 });
    const coordsToSq = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8) ? `${FILES[f]}${r + 1}` : null;
    const isPhantomSquare = (sq) => (phantoms.w && phantoms.w.square === sq) || (phantoms.b && phantoms.b.square === sq);
    const getOpponentColor = (c) => (c === 'w' ? 'b' : 'w');

    const clampMana = (val) => Math.max(0, Math.min(MAX_MANA, val));
    const addMana = (color, amount) => { mana[color] = clampMana(mana[color] + amount); };

    const getManaTier = (val) => {
        if (val <= 250) return 1;
        if (val <= 500) return 2;
        if (val <= 750) return 3;
        return 4;
    };

    function setWideGameLayout(enabled) {
        const gs = document.getElementById('game-screen');
        if (!gs) return;
        gs.classList.toggle('game-wide-mode', enabled);
        if (gs.parentElement && gs.parentElement !== document.body) {
            gs.parentElement.classList.toggle('game-wide-mode', enabled);
        }
    }

    function injectManaAndAbilitiesUI() {
        if (document.getElementById('mana-ability-styles')) return;

        const style = document.createElement('style');
        style.id = 'mana-ability-styles';
        style.textContent = `
            .game-wide-mode {
                width: min(880px, 95vw) !important;
                max-width: 880px !important;
                box-sizing: border-box;
            }
            .chess-arena {
                display: flex;
                flex-direction: row;
                align-items: flex-start;
                justify-content: center;
                gap: 20px;
                flex-wrap: nowrap;
                width: 100%;
                margin: 12px auto;
            }
            .board-column {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 8px;
                width: 460px;
                flex: 0 0 460px;
                max-width: 100%;
            }
            .board-column #board {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
            }
            .opponent-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: #ffffff;
                color: #111827;
                padding: 7px 12px;
                border-radius: 8px;
                font-size: 13px;
                border: 1px solid #d1d5db;
            }
            .opponent-identity {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .opponent-avatar {
                width: 34px;
                height: 34px;
                border-radius: 50%;
                background: #f3f4f6;
                color: #111827;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 17px;
                border: 3px solid #9ca3af;
                transition: border-color 0.25s, box-shadow 0.25s;
            }
            .opponent-avatar.tier-1 { border-color: #9ca3af; box-shadow: none; }
            .opponent-avatar.tier-2 { border-color: #a78bfa; box-shadow: 0 0 6px rgba(167,139,250,0.45); }
            .opponent-avatar.tier-3 { border-color: #7c3aed; box-shadow: 0 0 8px rgba(124,58,237,0.55); }
            .opponent-avatar.tier-4 { border-color: #4c1d95; box-shadow: 0 0 11px rgba(109,40,217,0.75); }
            .opponent-tier-label {
                font-size: 11px;
                color: #6b7280;
            }
            .mana-bar-wrapper {
                position: relative;
                width: 100%;
                height: 28px;
                background: #f3f4f6;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                overflow: hidden;
            }
            .mana-bar-fill {
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 10%;
                background: #7c3aed;
                transition: width 0.25s ease;
            }
            .mana-bar-spend {
                position: absolute;
                top: 0;
                bottom: 0;
                left: 0;
                width: 0%;
                background: #facc15;
                transition: left 0.2s ease, width 0.2s ease;
            }
            .mana-bar-text {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
                z-index: 2;
            }
            .mana-bar-text span {
                background: rgba(255, 255, 255, 0.92);
                color: #111827;
                font-weight: 700;
                font-size: 13px;
                padding: 1px 10px;
                border-radius: 6px;
                border: 1px solid rgba(0, 0, 0, 0.08);
            }
            .ability-banner {
                min-height: 24px;
                padding: 6px 10px;
                border-radius: 8px;
                background: #f5f3ff;
                border: 1px solid #ddd6fe;
                color: #1f2937;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .ability-banner.hidden { display: none; }
            .ability-banner button {
                background: #111827;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                padding: 4px 10px;
                cursor: pointer;
                font-size: 11px;
                flex-shrink: 0;
            }
            .abilities-sidebar {
                width: 285px;
                flex: 0 0 285px;
                max-width: 100%;
                background: #ffffff;
                color: #111827;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                padding: 10px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                box-sizing: border-box;
            }
            .abilities-sidebar-title {
                font-weight: 700;
                font-size: 14px;
                text-align: center;
                padding-bottom: 6px;
                border-bottom: 1px solid #e5e7eb;
                color: #111827;
            }
            .ability-btn {
                display: flex;
                flex-direction: column;
                gap: 2px;
                padding: 7px 9px;
                border-radius: 6px;
                border: 1px solid #e5e7eb;
                background: #ffffff;
                color: #111827;
                cursor: pointer;
                text-align: left;
                transition: border-color 0.15s, background 0.15s;
            }
            .ability-btn:hover:not(:disabled) {
                border-color: #7c3aed;
                background: #faf5ff;
            }
            .ability-btn.active {
                border-color: #7c3aed;
                background: #f3e8ff;
                box-shadow: 0 0 0 1px #7c3aed;
            }
            .ability-btn:disabled {
                opacity: 0.45;
                cursor: not-allowed;
                background: #f9fafb;
            }
            .ability-btn-top {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: 700;
                font-size: 12.5px;
                gap: 6px;
            }
            .ability-cost-badge {
                background: #ede9fe;
                color: #5b21b6;
                padding: 1px 7px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 700;
                white-space: nowrap;
            }
            .ability-btn-desc {
                font-size: 11px;
                color: #4b5563;
                line-height: 1.25;
            }
            .ability-cd-badge {
                font-size: 11px;
                color: #b45309;
                font-weight: 600;
            }
            @media (max-width: 840px) {
                .chess-arena {
                    flex-wrap: wrap;
                }
                .board-column {
                    width: min(440px, 88vw);
                    flex: 0 0 auto;
                }
                .abilities-sidebar {
                    width: min(440px, 88vw);
                    flex: 0 0 auto;
                }
            }
            .ability-overlay {
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 5;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 15px;
                font-weight: 700;
            }
            .overlay-onlyup { background: rgba(34, 197, 94, 0.35); box-shadow: inset 0 0 0 3px #16a34a; }
            .overlay-lasso-knight { box-shadow: inset 0 0 0 3px #d97706; }
            .overlay-lasso-trapped { background: rgba(217, 119, 6, 0.25); box-shadow: inset 0 0 0 2px #d97706; }
            .overlay-phantom { background: rgba(124, 58, 237, 0.3); box-shadow: inset 0 0 0 3px #7c3aed; color: #ffffff; }
            .overlay-door-king { box-shadow: inset 0 0 0 4px #7c3aed; background: rgba(124, 58, 237, 0.2); }
            .overlay-door-ring { box-shadow: inset 0 0 0 2px rgba(124, 58, 237, 0.55); }
            .overlay-rebalance-target { background: rgba(147, 51, 234, 0.3); box-shadow: inset 0 0 0 3px #9333ea; }
            .overlay-rebalance-move { background: rgba(147, 51, 234, 0.45); border-radius: 50%; transform: scale(0.45); }
            .overlay-samurai-flash { background: rgba(220, 38, 38, 0.5); box-shadow: inset 0 0 0 3px #dc2626; }
        `;
        document.head.appendChild(style);

        const boardEl = document.getElementById('board');
        if (!boardEl) return;
        const boardParent = boardEl.parentNode;

        const arena = document.createElement('div');
        arena.className = 'chess-arena';

        const boardCol = document.createElement('div');
        boardCol.className = 'board-column';

        const oppBar = document.createElement('div');
        oppBar.className = 'opponent-bar';
        oppBar.id = 'opponent-mana-bar';
        oppBar.innerHTML = `
            <div class="opponent-identity">
                <div class="opponent-avatar tier-1" id="opponent-avatar-glow">♟</div>
                <div>
                    <div id="opponent-label" style="font-weight:700;">Соперник</div>
                    <div class="opponent-tier-label" id="opponent-tier-text">Мана: 0–250</div>
                </div>
            </div>
            <div id="active-effects-text" style="font-size:11px; color:#6d28d9; font-weight:600; text-align:right;"></div>
        `;

        const manaWrap = document.createElement('div');
        manaWrap.className = 'mana-bar-wrapper';
        manaWrap.innerHTML = `
            <div class="mana-bar-fill" id="player-mana-fill"></div>
            <div class="mana-bar-spend" id="player-mana-spend"></div>
            <div class="mana-bar-text"><span id="player-mana-text">100 / 1000</span></div>
        `;

        const banner = document.createElement('div');
        banner.className = 'ability-banner hidden';
        banner.id = 'ability-banner';
        banner.innerHTML = `
            <span id="ability-banner-text"></span>
            <button type="button" id="ability-banner-cancel">Отмена</button>
        `;

        const sidebar = document.createElement('div');
        sidebar.className = 'abilities-sidebar';
        sidebar.id = 'abilities-sidebar';
        sidebar.innerHTML = `<div class="abilities-sidebar-title">Способности</div>`;

        ABILITIES.forEach(ab => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ability-btn';
            btn.id = `ab-btn-${ab.id}`;
            btn.innerHTML = `
                <div class="ability-btn-top">
                    <span>${ab.piece} — ${ab.name}</span>
                    <span class="ability-cost-badge">${ab.cost} маны</span>
                </div>
                <div class="ability-btn-desc">${ab.desc}</div>
                <div class="ability-cd-badge" id="ab-cd-${ab.id}"></div>
            `;
            btn.addEventListener('click', () => handleAbilityButtonClick(ab.id));
            btn.addEventListener('mouseenter', () => {
                if (!btn.disabled) {
                    hoveredAbilityId = ab.id;
                    updateManaBarPreview();
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (hoveredAbilityId === ab.id) {
                    hoveredAbilityId = null;
                    updateManaBarPreview();
                }
            });
            sidebar.appendChild(btn);
        });

        boardParent.insertBefore(arena, boardEl);
        boardCol.appendChild(oppBar);
        boardCol.appendChild(boardEl);
        boardCol.appendChild(manaWrap);
        boardCol.appendChild(banner);
        arena.appendChild(boardCol);
        arena.appendChild(sidebar);

        document.getElementById('ability-banner-cancel').addEventListener('click', () => {
            if (rebalanceState && rebalanceState.phase === 'needCharmedMove') {
                skipCharmedMove();
                return;
            }
            armedAbility = null;
            hoveredAbilityId = null;
            updateAbilityUI();
            renderBoardOverlays();
        });
    }

    function showToast(msg) {
        const banner = document.getElementById('ability-banner');
        const text = document.getElementById('ability-banner-text');
        const cancelBtn = document.getElementById('ability-banner-cancel');
        if (!banner || !text) return;
        text.textContent = msg;
        cancelBtn.style.display = 'none';
        banner.classList.remove('hidden');
        clearTimeout(statusToastTimeout);
        statusToastTimeout = setTimeout(() => {
            if (!armedAbility && !rebalanceState) banner.classList.add('hidden');
        }, 2800);
    }

    function getPreviewCost() {
        let activeId = null;
        if (armedAbility === 'timeJumpSelect') activeId = 'timeJump';
        else if (armedAbility === 'rebalanceSelect') activeId = 'rebalance';
        else if (armedAbility) activeId = armedAbility;
        else if (hoveredAbilityId) activeId = hoveredAbilityId;

        if (!activeId) return 0;
        const ab = ABILITIES.find(a => a.id === activeId);
        return ab ? ab.cost : 0;
    }

    function updateManaBarPreview() {
        const fill = document.getElementById('player-mana-fill');
        const spend = document.getElementById('player-mana-spend');
        const text = document.getElementById('player-mana-text');
        if (!fill || !spend || !text) return;

        const myMana = mana[userColor];
        const previewCost = getPreviewCost();

        if (previewCost > 0 && myMana >= previewCost) {
            const afterMana = Math.max(0, myMana - previewCost);
            const remainPct = (afterMana / MAX_MANA) * 100;
            const spendPct = ((myMana - afterMana) / MAX_MANA) * 100;
            fill.style.width = `${remainPct}%`;
            spend.style.left = `${remainPct}%`;
            spend.style.width = `${spendPct}%`;
            text.textContent = `${myMana} → ${afterMana} / ${MAX_MANA}`;
        } else {
            fill.style.width = `${(myMana / MAX_MANA) * 100}%`;
            spend.style.left = '0%';
            spend.style.width = '0%';
            text.textContent = `${myMana} / ${MAX_MANA}`;
        }
    }

    function updateAbilityUI() {
        const oppColor = getOpponentColor(userColor);
        const oppMana = mana[oppColor];
        const tier = getManaTier(oppMana);
        const tierRanges = { 1: '0–250', 2: '251–500', 3: '501–750', 4: '751–1000' };
        const oppGlow = document.getElementById('opponent-avatar-glow');
        const oppTierText = document.getElementById('opponent-tier-text');
        const oppLabel = document.getElementById('opponent-label');
        if (oppGlow && oppTierText && oppLabel) {
            oppGlow.className = `opponent-avatar tier-${tier}`;
            oppTierText.textContent = `Уровень маны: ${tierRanges[tier]}`;
            oppLabel.textContent = isOnlineMode ? 'Соперник (Онлайн)' : 'Бот (Stockfish)';
        }

        const fxEl = document.getElementById('active-effects-text');
        if (fxEl) {
            const parts = [];
            if (phantoms[userColor]) parts.push(`Фантом: ${phantoms[userColor].turnsLeft} х.`);
            if (phantoms[oppColor]) parts.push(`Фантом врага: ${phantoms[oppColor].turnsLeft} х.`);
            if (doors[userColor]) parts.push(`Ваш щит: ${doors[userColor].turnsLeft} х.`);
            if (doors[oppColor]) parts.push(`Щит врага: ${doors[oppColor].turnsLeft} х.`);
            if (lassoState) parts.push(`Лассо на ${lassoState.knightSquare}`);
            fxEl.textContent = parts.join(' | ');
        }

        const isMyTurn = !game.game_over() && game.turn() === userColor;
        const myCooldowns = cooldowns[userColor];
        ABILITIES.forEach(ab => {
            const btn = document.getElementById(`ab-btn-${ab.id}`);
            const cdEl = document.getElementById(`ab-cd-${ab.id}`);
            if (!btn || !cdEl) return;

            const cd = myCooldowns[ab.id];
            let disabled = !isMyTurn || mana[userColor] < ab.cost || cd > 0;
            let extraText = cd > 0 ? `Перезарядка: ${cd} ход(а)` : '';

            if (rebalanceState && rebalanceState.phase === 'needCharmedMove') {
                disabled = true;
            }
            if (ab.id === 'timeJump' && phantoms[userColor]) {
                disabled = true;
                extraText = `Копия активна (${phantoms[userColor].turnsLeft} х.)`;
            }
            if (ab.id === 'closeTheDoor') {
                if (usedCloseTheDoor[userColor]) {
                    disabled = true;
                    extraText = 'Использовано (1/партию)';
                } else if (game.in_check()) {
                    disabled = true;
                    extraText = 'Нельзя под шахом';
                }
            }
            if (ab.id === 'rebalance' && rebalanceState) {
                disabled = true;
            }

            btn.disabled = disabled;
            if (disabled && hoveredAbilityId === ab.id) hoveredAbilityId = null;

            btn.classList.toggle('active',
                armedAbility === ab.id ||
                (ab.id === 'timeJump' && armedAbility === 'timeJumpSelect') ||
                (ab.id === 'rebalance' && armedAbility === 'rebalanceSelect')
            );
            cdEl.textContent = extraText;
        });

        updateManaBarPreview();

        const banner = document.getElementById('ability-banner');
        const bannerText = document.getElementById('ability-banner-text');
        const cancelBtn = document.getElementById('ability-banner-cancel');
        if (banner && bannerText && cancelBtn) {
            if (rebalanceState && rebalanceState.controller === userColor) {
                banner.classList.remove('hidden');
                if (rebalanceState.phase === 'needOwnMove') {
                    bannerText.textContent = `Rebalance (${rebalanceState.targetSquare}): сделайте ход своей фигурой.`;
                    cancelBtn.style.display = 'none';
                } else {
                    bannerText.textContent = `Rebalance: походите переманенной фигурой (${rebalanceState.targetSquare})!`;
                    cancelBtn.textContent = 'Пропустить';
                    cancelBtn.style.display = 'inline-block';
                }
            } else if (armedAbility) {
                banner.classList.remove('hidden');
                cancelBtn.textContent = 'Отмена';
                cancelBtn.style.display = 'inline-block';
                const hints = {
                    onlyUp: 'Only Up: переместите пешку через вражескую фигуру перед ней.',
                    cowboy: 'Cowboy: походите конём — он захватит лассо соседние фигуры врага.',
                    samurai: 'Samurai: походите слоном — его тень атакует симметрично.',
                    timeJumpSelect: 'Time jump: выберите ферзя для создания фантомной копии.',
                    rebalanceSelect: 'Rebalance: кликните по вражеской фигуре (кроме короля).'
                };
                bannerText.textContent = hints[armedAbility] || '';
            } else {
                banner.classList.add('hidden');
            }
        }
    }

    function getSquaresOfPiece(type, color) {
        const res = [];
        for (const f of FILES) {
            for (let r = 1; r <= 8; r++) {
                const sq = `${f}${r}`;
                const p = game.get(sq);
                if (p && p.type === type && p.color === color) res.push(sq);
            }
        }
        return res;
    }

    function isCustomMoveSafeForOwnKing(fromSq, toSq, color, newType) {
        const temp = new Chess(game.fen());
        const moving = temp.get(fromSq);
        if (!moving) return false;
        temp.remove(fromSq);
        temp.put({ type: newType || moving.type, color: moving.color }, toSq);
        const parts = temp.fen().split(' ');
        parts[1] = color;
        parts[3] = '-';
        const checkBoard = new Chess();
        if (!checkBoard.load(parts.join(' '))) return false;
        return !checkBoard.in_check();
    }

    function getOnlyUpTarget(fromSq, color) {
        const p = game.get(fromSq);
        if (!p || p.type !== 'p' || p.color !== color) return null;
        const { f, r } = sqToCoords(fromSq);
        const dir = color === 'w' ? 1 : -1;
        const frontSq = coordsToSq(f, r + dir);
        const jumpSq = coordsToSq(f, r + 2 * dir);
        if (!frontSq || !jumpSq) return null;

        const frontPiece = game.get(frontSq);
        if (!frontPiece || frontPiece.color === color) return null;
        if (game.get(jumpSq) || isPhantomSquare(jumpSq)) return null;

        const promoted = (jumpSq[1] === '8' || jumpSq[1] === '1') ? 'q' : 'p';
        if (!isCustomMoveSafeForOwnKing(fromSq, jumpSq, color, promoted)) return null;
        return jumpSq;
    }

    function getCharmedMoves(fromSq) {
        const p = game.get(fromSq);
        if (!p || !rebalanceState) return [];
        const controller = rebalanceState.controller;
        const origOwner = rebalanceState.originalOwner;
        const { f, r } = sqToCoords(fromSq);
        const candidates = [];

        const tryPush = (nf, nr) => {
            const tSq = coordsToSq(nf, nr);
            if (!tSq || isPhantomSquare(tSq)) return false;
            const occupant = game.get(tSq);
            if (occupant) {
                if (occupant.color === controller) return false;
                if (occupant.type === 'k') return false;
                candidates.push(tSq);
                return false;
            } else {
                candidates.push(tSq);
                return true;
            }
        };

        if (p.type === 'n') {
            [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]].forEach(([df, dr]) => tryPush(f + df, r + dr));
        } else if (p.type === 'b' || p.type === 'q') {
            [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([df, dr]) => {
                for (let s = 1; s < 8; s++) if (!tryPush(f + df * s, r + dr * s)) break;
            });
        }
        if (p.type === 'r' || p.type === 'q') {
            [[1,0],[-1,0],[0,1],[0,-1]].forEach(([df, dr]) => {
                for (let s = 1; s < 8; s++) if (!tryPush(f + df * s, r + dr * s)) break;
            });
        }
        if (p.type === 'p') {
            const dir = origOwner === 'w' ? 1 : -1;
            const startRank = origOwner === 'w' ? 1 : 6;
            const oneAhead = coordsToSq(f, r + dir);
            if (oneAhead && oneAhead[1] !== '1' && oneAhead[1] !== '8' && !game.get(oneAhead) && !isPhantomSquare(oneAhead)) {
                candidates.push(oneAhead);
                if (r === startRank) {
                    const twoAhead = coordsToSq(f, r + 2 * dir);
                    if (twoAhead && !game.get(twoAhead) && !isPhantomSquare(twoAhead)) candidates.push(twoAhead);
                }
            }
            [-1, 1].forEach(df => {
                const diag = coordsToSq(f + df, r + dir);
                if (diag && diag[1] !== '1' && diag[1] !== '8') {
                    const occ = game.get(diag);
                    if (occ && occ.color === origOwner && occ.type !== 'k' && !isPhantomSquare(diag)) {
                        candidates.push(diag);
                    }
                }
            });
        }

        return candidates.filter(tSq => {
            const sim1 = new Chess(game.fen());
            sim1.remove(fromSq);
            sim1.put({ type: p.type, color: controller }, tSq);
            const p1 = sim1.fen().split(' ');
            p1[1] = origOwner;
            p1[3] = '-';
            const chkOrig = new Chess();
            if (chkOrig.load(p1.join(' ')) && chkOrig.in_check()) return false;

            const sim2 = new Chess(game.fen());
            sim2.remove(fromSq);
            sim2.put({ type: p.type, color: origOwner }, tSq);
            const p2 = sim2.fen().split(' ');
            p2[1] = controller;
            p2[3] = '-';
            const chkCtrl = new Chess();
            if (!chkCtrl.load(p2.join(' ')) || chkCtrl.in_check()) return false;

            return true;
        });
    }

    function handleAbilityButtonClick(abId) {
        if (game.game_over() || game.turn() !== userColor) return;
        const ab = ABILITIES.find(a => a.id === abId);
        if (!ab || mana[userColor] < ab.cost || cooldowns[userColor][abId] > 0) return;

        if (armedAbility === abId ||
            (abId === 'timeJump' && armedAbility === 'timeJumpSelect') ||
            (abId === 'rebalance' && armedAbility === 'rebalanceSelect')) {
            armedAbility = null;
            updateAbilityUI();
            renderBoardOverlays();
            return;
        }

        if (abId === 'onlyUp') {
            const pawns = getSquaresOfPiece('p', userColor);
            const hasValidJump = pawns.some(sq => getOnlyUpTarget(sq, userColor) !== null);
            if (!hasValidJump) {
                showToast('Нет пешки с вражеской фигурой перед ней и свободной клеткой за ней.');
                return;
            }
            armedAbility = 'onlyUp';
        } else if (abId === 'cowboy') {
            if (getSquaresOfPiece('n', userColor).length === 0) {
                showToast('У вас нет коней на доске.');
                return;
            }
            armedAbility = 'cowboy';
        } else if (abId === 'samurai') {
            if (getSquaresOfPiece('b', userColor).length === 0) {
                showToast('У вас нет слонов на доске.');
                return;
            }
            armedAbility = 'samurai';
        } else if (abId === 'timeJump') {
            if (phantoms[userColor]) return;
            const queens = getSquaresOfPiece('q', userColor);
            if (queens.length === 0) {
                showToast('У вас нет ферзя на доске.');
                return;
            }
            if (queens.length === 1) {
                activateTimeJumpOnSquare(queens[0]);
                return;
            }
            armedAbility = 'timeJumpSelect';
        } else if (abId === 'closeTheDoor') {
            if (usedCloseTheDoor[userColor]) return;
            if (game.in_check()) {
                showToast('Нельзя активировать «Close the door», пока король под шахом!');
                return;
            }
            if (getSquaresOfPiece('r', userColor).length === 0) {
                showToast('Для активации нужна хотя бы одна ладья на доске.');
                return;
            }
            mana[userColor] = clampMana(mana[userColor] - ab.cost);
            usedCloseTheDoor[userColor] = true;
            doors[userColor] = { turnsLeft: 3 };
            hoveredAbilityId = null;
            showToast('«Close the door» активирован! Король защищён на 3 хода врага.');
            syncAbilityStateOnline({ kind: 'buffOnly' });
        } else if (abId === 'rebalance') {
            const opp = getOpponentColor(userColor);
            const hasTargets = ['p', 'n', 'b', 'r', 'q'].some(t => getSquaresOfPiece(t, opp).length > 0);
            if (!hasTargets) {
                showToast('У противника нет фигур для переманивания.');
                return;
            }
            armedAbility = 'rebalanceSelect';
        }

        updateAbilityUI();
        renderBoardOverlays();
    }

    function activateTimeJumpOnSquare(qSq) {
        const ab = ABILITIES.find(a => a.id === 'timeJump');
        mana[userColor] = clampMana(mana[userColor] - ab.cost);
        cooldowns[userColor].timeJump = ABILITY_COOLDOWN;
        phantoms[userColor] = {
            square: qSq,
            currentQueenSquare: qSq,
            turnsLeft: 2
        };
        armedAbility = null;
        hoveredAbilityId = null;
        showToast(`Фантомная копия создана на ${qSq}! Возврат через 2 хода.`);
        updateAbilityUI();
        renderBoardOverlays();
        syncAbilityStateOnline({ kind: 'buffOnly' });
    }

    function renderBoardOverlays() {
        $('#board .ability-overlay').remove();

        const addOverlay = (sq, cls, text = '') => {
            const el = $(`#board .square-${sq}`);
            if (!el.length) return;
            el.css('position', 'relative');
            const div = $(`<div class="ability-overlay ${cls}">${text}</div>`);
            el.append(div);
        };

        ['w', 'b'].forEach(c => {
            if (phantoms[c]) addOverlay(phantoms[c].square, 'overlay-phantom', 'Ф');
        });

        ['w', 'b'].forEach(c => {
            if (doors[c]) {
                const kSq = getSquaresOfPiece('k', c)[0];
                if (kSq) {
                    addOverlay(kSq, 'overlay-door-king');
                    const { f, r } = sqToCoords(kSq);
                    for (let df = -1; df <= 1; df++) {
                        for (let dr = -1; dr <= 1; dr++) {
                            if (df === 0 && dr === 0) continue;
                            const adj = coordsToSq(f + df, r + dr);
                            if (adj) addOverlay(adj, 'overlay-door-ring');
                        }
                    }
                }
            }
        });

        if (lassoState) {
            addOverlay(lassoState.knightSquare, 'overlay-lasso-knight');
            lassoState.trappedSquares.forEach(sq => addOverlay(sq, 'overlay-lasso-trapped'));
        }

        if (armedAbility === 'onlyUp') {
            getSquaresOfPiece('p', userColor).forEach(pSq => {
                const jSq = getOnlyUpTarget(pSq, userColor);
                if (jSq) addOverlay(jSq, 'overlay-onlyup', '▲');
            });
        }

        if (armedAbility === 'rebalanceSelect') {
            const opp = getOpponentColor(userColor);
            ['p', 'n', 'b', 'r', 'q'].forEach(t => {
                getSquaresOfPiece(t, opp).forEach(sq => addOverlay(sq, 'overlay-rebalance-target'));
            });
        }
        if (rebalanceState) {
            addOverlay(rebalanceState.targetSquare, 'overlay-rebalance-target');
            if (rebalanceState.phase === 'needCharmedMove' && rebalanceState.controller === userColor) {
                getCharmedMoves(rebalanceState.targetSquare).forEach(mSq => {
                    addOverlay(mSq, 'overlay-rebalance-move');
                });
            }
        }

        samuraiFlashSquares.forEach(sq => addOverlay(sq, 'overlay-samurai-flash', '✕'));
    }

    function moveChecksColor(moveObj, targetKingColor) {
        const temp = new Chess(game.fen());
        const m = temp.move({ from: moveObj.from, to: moveObj.to, promotion: moveObj.promotion || 'q' });
        if (!m) return false;
        const parts = temp.fen().split(' ');
        parts[1] = targetKingColor;
        const checkBoard = new Chess();
        if (!checkBoard.load(parts.join(' '))) return true;
        return checkBoard.in_check();
    }

    function isMoveAllowedByAbilities(moveObj, movingColor) {
        if (isPhantomSquare(moveObj.to)) {
            return { ok: false, reason: 'Нельзя занять клетку бессмертной фантомной копии!' };
        }
        if (doors[movingColor]) {
            const piece = game.get(moveObj.from);
            if (piece && piece.type === 'k') {
                return { ok: false, reason: '«Close the door»: ваш король не может двигаться!' };
            }
        }
        const opp = getOpponentColor(movingColor);
        if (doors[opp] && moveChecksColor(moveObj, opp)) {
            return { ok: false, reason: '«Close the door»: щит ладьи блокирует атаку на короля!' };
        }
        if (lassoState && lassoState.trappedColor === movingColor && lassoState.trappedSquares.includes(moveObj.from)) {
            const kC = sqToCoords(lassoState.knightSquare);
            const tC = sqToCoords(moveObj.to);
            if (Math.max(Math.abs(kC.f - tC.f), Math.abs(kC.r - tC.r)) > 1) {
                return { ok: false, reason: 'Фигура в лассо Ковбоя: ход только вокруг коня!' };
            }
        }
        return { ok: true };
    }

    function checkTimeJumpQueenCaptured(victimColor) {
        const ph = phantoms[victimColor];
        if (!ph) return;
        const q = game.get(ph.currentQueenSquare);
        if (!q || q.type !== 'q' || q.color !== victimColor) {
            phantoms[victimColor] = null;
            mana[victimColor] = clampMana(mana[victimColor] - TIME_JUMP_PENALTY);
            showToast(`Ферзь уничтожен до возврата! Фантом исчез (-${TIME_JUMP_PENALTY} маны).`);
        }
    }

    function applyTurnManaBonuses(moverColor, capturedPieceType, didCastle, gaveCheck) {
        turnCounter[moverColor]++;
        addMana(moverColor, PASSIVE_MANA);

        if (capturedPieceType && CAPTURE_MANA[capturedPieceType]) {
            const opp = getOpponentColor(moverColor);
            addMana(moverColor, CAPTURE_MANA[capturedPieceType].gain);
            addMana(opp, CAPTURE_MANA[capturedPieceType].loss);
        }

        if (didCastle && !castledBonusUsed[moverColor]) {
            castledBonusUsed[moverColor] = true;
            addMana(moverColor, CASTLE_BONUS);
        }

        if (gaveCheck && (turnCounter[moverColor] - lastCheckBonusTurn[moverColor] >= CHECK_COOLDOWN_TURNS)) {
            lastCheckBonusTurn[moverColor] = turnCounter[moverColor];
            addMana(moverColor, CHECK_BONUS);
        }
    }

    function advanceTimersAfterTurn(moverColor) {
        const opp = getOpponentColor(moverColor);

        Object.keys(cooldowns[moverColor]).forEach(k => {
            if (cooldowns[moverColor][k] > 0) cooldowns[moverColor][k]--;
        });

        if (lassoState && lassoState.trappedColor === moverColor) {
            lassoState = null;
        }

        if (doors[opp]) {
            doors[opp].turnsLeft--;
            if (doors[opp].turnsLeft <= 0) {
                doors[opp] = null;
                showToast('Действие «Close the door» закончилось.');
            }
        }

        if (phantoms[moverColor]) {
            phantoms[moverColor].turnsLeft--;
            if (phantoms[moverColor].turnsLeft <= 0) {
                const ph = phantoms[moverColor];
                const qNow = game.get(ph.currentQueenSquare);
                if (qNow && qNow.type === 'q' && qNow.color === moverColor) {
                    if (ph.currentQueenSquare === ph.square) {
                        phantoms[moverColor] = null;
                    } else if (!game.get(ph.square)) {
                        const temp = new Chess(game.fen());
                        temp.remove(ph.currentQueenSquare);
                        temp.put({ type: 'q', color: moverColor }, ph.square);
                        const parts = temp.fen().split(' ');
                        parts[1] = moverColor;
                        const chk = new Chess();
                        if (chk.load(parts.join(' ')) && !chk.in_check()) {
                            parts[1] = opp;
                            game.load(parts.join(' '));
                            board.position(game.fen());
                            phantoms[moverColor] = null;
                            recordMove(`♛↩${ph.square}`, moveCount);
                            showToast(`Time jump: ферзь вернулся на ${ph.square}!`);
                        } else {
                            phantoms[moverColor].turnsLeft = 1;
                        }
                    } else {
                        phantoms[moverColor] = null;
                    }
                } else {
                    phantoms[moverColor] = null;
                }
            }
        }
    }

    function resetManaAndAbilities() {
        mana = { w: START_MANA, b: START_MANA };
        turnCounter = { w: 0, b: 0 };
        lastCheckBonusTurn = { w: -99, b: -99 };
        castledBonusUsed = { w: false, b: false };
        usedCloseTheDoor = { w: false, b: false };
        cooldowns = {
            w: { onlyUp: 0, cowboy: 0, samurai: 0, timeJump: 0, closeTheDoor: 0, rebalance: 0 },
            b: { onlyUp: 0, cowboy: 0, samurai: 0, timeJump: 0, closeTheDoor: 0, rebalance: 0 }
        };
        armedAbility = null;
        hoveredAbilityId = null;
        lassoState = null;
        phantoms = { w: null, b: null };
        doors = { w: null, b: null };
        rebalanceState = null;
        samuraiFlashSquares = [];
        updateAbilityUI();
        renderBoardOverlays();
    }

    function serializeAbilityState() {
        return {
            mana,
            turnCounter,
            lastCheckBonusTurn,
            castledBonusUsed,
            usedCloseTheDoor,
            cooldowns,
            lassoState,
            phantoms,
            doors,
            rebalanceState
        };
    }

    function applySerializedAbilityState(state) {
        if (!state) return;
        mana = state.mana || mana;
        turnCounter = state.turnCounter || turnCounter;
        lastCheckBonusTurn = state.lastCheckBonusTurn || lastCheckBonusTurn;
        castledBonusUsed = state.castledBonusUsed || castledBonusUsed;
        usedCloseTheDoor = state.usedCloseTheDoor || usedCloseTheDoor;
        cooldowns = state.cooldowns || cooldowns;
        lassoState = state.lassoState || null;
        phantoms = state.phantoms || { w: null, b: null };
        doors = state.doors || { w: null, b: null };
        rebalanceState = state.rebalanceState || null;
    }

    function syncAbilityStateOnline(extra = {}) {
        if (!isOnlineMode || !currentRoomId) return;
        socket.emit('abilitySync', {
            roomId: currentRoomId,
            fen: game.fen(),
            state: serializeAbilityState(),
            ...extra
        });
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
                const botColor = game.turn();
                let from = bestMove.substring(0, 2);
                let to = bestMove.substring(2, 4);
                let promotion = bestMove.length > 4 ? bestMove[4] : 'q';

                const checkAllowed = isMoveAllowedByAbilities({ from, to, promotion }, botColor);
                if (!checkAllowed.ok) {
                    const legal = game.moves({ verbose: true }).filter(m => isMoveAllowedByAbilities(m, botColor).ok);
                    if (legal.length === 0) return;
                    const chosen = legal[Math.floor(Math.random() * legal.length)];
                    from = chosen.from;
                    to = chosen.to;
                    promotion = chosen.promotion || 'q';
                }

                const move = game.move({ from, to, promotion });
                if (move) {
                    if (phantoms[botColor] && phantoms[botColor].currentQueenSquare === move.from) {
                        phantoms[botColor].currentQueenSquare = move.to;
                    }
                    checkTimeJumpQueenCaptured(getOpponentColor(botColor));

                    const didCastle = move.flags.includes('k') || move.flags.includes('q');
                    applyTurnManaBonuses(botColor, move.captured || null, didCastle, game.in_check());
                    advanceTimersAfterTurn(botColor);

                    playChessSound(move.captured ? 'capture' : 'move');
                    board.position(game.fen());
                    recordMove(move.san, moveCount);
                    moveCount++;
                    updateAbilityUI();
                    renderBoardOverlays();
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
        armedAbility = null;
        hoveredAbilityId = null;
        rebalanceState = null;
        updateAbilityUI();
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

    function finishPlayerTurn(moverColor, extraSync = {}) {
        hoveredAbilityId = null;
        advanceTimersAfterTurn(moverColor);
        updateAbilityUI();
        renderBoardOverlays();
        checkGameOver();

        if (isOnlineMode && currentRoomId) {
            syncAbilityStateOnline(extraSync);
        } else if (!game.game_over() && game.turn() !== userColor) {
            window.setTimeout(makeSmartMove, 250);
        }
    }

    function skipCharmedMove() {
        if (!rebalanceState || rebalanceState.phase !== 'needCharmedMove') return;
        const parts = game.fen().split(' ');
        parts[1] = rebalanceState.originalOwner;
        parts[3] = '-';
        if (rebalanceState.controller === 'b') parts[5] = String(parseInt(parts[5], 10) + 1);
        game.load(parts.join(' '));
        rebalanceState = null;
        board.position(game.fen());
        finishPlayerTurn(userColor, { kind: 'customMove', san: '🔄(пропуск)', sound: 'move' });
    }

    function executeCharmedMove(source, target) {
        if (!rebalanceState || rebalanceState.phase !== 'needCharmedMove' || source !== rebalanceState.targetSquare) {
            return false;
        }
        const allowedTargets = getCharmedMoves(source);
        if (!allowedTargets.includes(target)) return false;

        const movingPiece = game.get(source);
        const capturedPiece = game.get(target);
        const controller = rebalanceState.controller;
        const origOwner = rebalanceState.originalOwner;

        const temp = new Chess(game.fen());
        temp.remove(source);
        temp.put({ type: movingPiece.type, color: origOwner }, target);

        const parts = temp.fen().split(' ');
        parts[1] = origOwner;
        parts[3] = '-';
        if (controller === 'b') parts[5] = String(parseInt(parts[5], 10) + 1);

        const newFen = parts.join(' ');
        if (!game.load(newFen)) return false;

        if (capturedPiece) {
            checkTimeJumpQueenCaptured(origOwner);
            if (CAPTURE_MANA[capturedPiece.type]) {
                addMana(controller, CAPTURE_MANA[capturedPiece.type].gain);
                addMana(origOwner, CAPTURE_MANA[capturedPiece.type].loss);
            }
        }

        rebalanceState = null;
        const sanLabel = `🔄${source}→${target}`;
        playChessSound(capturedPiece ? 'capture' : 'move');
        recordMove(sanLabel, moveCount);
        moveCount++;
        window.setTimeout(() => board.position(game.fen()), 0);
        finishPlayerTurn(controller, {
            kind: 'customMove',
            san: sanLabel,
            sound: capturedPiece ? 'capture' : 'move'
        });
        return true;
    }

    function executeOnlyUpJump(source, target) {
        const jumpTarget = getOnlyUpTarget(source, userColor);
        if (jumpTarget !== target) return false;

        const ab = ABILITIES.find(a => a.id === 'onlyUp');
        if (mana[userColor] < ab.cost) return false;

        const temp = new Chess(game.fen());
        temp.remove(source);
        const promoted = (target[1] === '8' || target[1] === '1') ? 'q' : 'p';
        temp.put({ type: promoted, color: userColor }, target);

        const opp = getOpponentColor(userColor);
        const parts = temp.fen().split(' ');
        parts[1] = opp;
        parts[3] = '-';
        if (userColor === 'b') parts[5] = String(parseInt(parts[5], 10) + 1);

        if (!game.load(parts.join(' '))) return false;

        mana[userColor] = clampMana(mana[userColor] - ab.cost);
        cooldowns[userColor].onlyUp = ABILITY_COOLDOWN;
        armedAbility = null;

        applyTurnManaBonuses(userColor, null, false, game.in_check());
        const sanLabel = `${source}→${target}⚡`;
        playChessSound('move');
        recordMove(sanLabel, moveCount);
        moveCount++;
        window.setTimeout(() => board.position(game.fen()), 0);
        finishPlayerTurn(userColor, { kind: 'customMove', san: sanLabel, sound: 'move' });
        return true;
    }

    // ========== ОБРАБОТЧИКИ ДОСКИ ==========
    const onDragStart = (source, piece) => {
        if (game.game_over()) return false;
        if (armedAbility === 'timeJumpSelect' || armedAbility === 'rebalanceSelect') return false;

        if (rebalanceState && rebalanceState.controller === userColor && rebalanceState.phase === 'needCharmedMove') {
            return source === rebalanceState.targetSquare;
        }

        if (game.turn() !== userColor || piece.search(userColor) !== 0) return false;

        if (doors[userColor] && piece[1] === 'K') {
            showToast('«Close the door»: ваш король заблокирован щитом!');
            return false;
        }
        return true;
    };

    const onDrop = (source, target) => {
        if (source === target) return 'snapback';

        if (rebalanceState && rebalanceState.controller === userColor && rebalanceState.phase === 'needCharmedMove') {
            return executeCharmedMove(source, target) ? undefined : 'snapback';
        }

        if (armedAbility === 'onlyUp') {
            return executeOnlyUpJump(source, target) ? undefined : 'snapback';
        }

        const movingPiece = game.get(source);
        if (!movingPiece) return 'snapback';

        if (armedAbility === 'cowboy' && movingPiece.type !== 'n') {
            showToast('Активирован «Cowboy» — нужно походить конём (или нажмите Отмена).');
            return 'snapback';
        }
        if (armedAbility === 'samurai' && movingPiece.type !== 'b') {
            showToast('Активирован «Samurai» — нужно походить слоном (или нажмите Отмена).');
            return 'snapback';
        }

        const allowed = isMoveAllowedByAbilities({ from: source, to: target, promotion: 'q' }, userColor);
        if (!allowed.ok) {
            showToast(allowed.reason);
            return 'snapback';
        }

        const move = game.move({ from: source, to: target, promotion: 'q' });
        if (move === null) return 'snapback';

        const opp = getOpponentColor(userColor);
        let extraCapturedType = null;
        let samuraiKilledSq = null;

        if (phantoms[userColor] && phantoms[userColor].currentQueenSquare === source) {
            phantoms[userColor].currentQueenSquare = target;
        }
        checkTimeJumpQueenCaptured(opp);

        if (armedAbility === 'cowboy' && movingPiece.type === 'n') {
            const ab = ABILITIES.find(a => a.id === 'cowboy');
            mana[userColor] = clampMana(mana[userColor] - ab.cost);
            cooldowns[userColor].cowboy = ABILITY_COOLDOWN;
            const { f, r } = sqToCoords(target);
            const trapped = [];
            for (let df = -1; df <= 1; df++) {
                for (let dr = -1; dr <= 1; dr++) {
                    if (df === 0 && dr === 0) continue;
                    const adj = coordsToSq(f + df, r + dr);
                    if (!adj) continue;
                    const p = game.get(adj);
                    if (p && p.color === opp) trapped.push(adj);
                }
            }
            lassoState = {
                knightSquare: target,
                ownerColor: userColor,
                trappedColor: opp,
                trappedSquares: trapped,
                turnsLeft: 1
            };
            armedAbility = null;
            showToast(trapped.length ? `Cowboy: захвачено фигур лассо — ${trapped.length}!` : 'Cowboy: рядом нет вражеских фигур.');
        }

        if (armedAbility === 'samurai' && movingPiece.type === 'b') {
            const ab = ABILITIES.find(a => a.id === 'samurai');
            mana[userColor] = clampMana(mana[userColor] - ab.cost);
            cooldowns[userColor].samurai = ABILITY_COOLDOWN;
            armedAbility = null;

            const cFrom = sqToCoords(source);
            const cTo = sqToCoords(target);
            const df = cTo.f - cFrom.f;
            const dr = cTo.r - cFrom.r;
            const shadowTarget = coordsToSq(cFrom.f - df, cFrom.r + dr);

            if (shadowTarget) {
                const steps = Math.abs(df);
                const stepF = -Math.sign(df);
                const stepR = Math.sign(dr);
                let pathClear = true;
                for (let s = 1; s < steps; s++) {
                    const midSq = coordsToSq(cFrom.f + stepF * s, cFrom.r + stepR * s);
                    if (game.get(midSq)) {
                        pathClear = false;
                        break;
                    }
                }
                samuraiFlashSquares = [shadowTarget];
                setTimeout(() => { samuraiFlashSquares = []; renderBoardOverlays(); }, 900);

                if (pathClear) {
                    const victim = game.get(shadowTarget);
                    if (victim && victim.color === opp && victim.type !== 'k') {
                        const temp = new Chess(game.fen());
                        temp.remove(shadowTarget);
                        if (game.load(temp.fen())) {
                            extraCapturedType = victim.type;
                            samuraiKilledSq = shadowTarget;
                            checkTimeJumpQueenCaptured(opp);
                            showToast(`Samurai: тень уничтожила фигуру на ${shadowTarget}!`);
                        }
                    }
                }
            }
        }

        const didCastle = move.flags.includes('k') || move.flags.includes('q');
        applyTurnManaBonuses(userColor, move.captured || null, didCastle, game.in_check());
        if (extraCapturedType && CAPTURE_MANA[extraCapturedType]) {
            addMana(userColor, CAPTURE_MANA[extraCapturedType].gain);
            addMana(opp, CAPTURE_MANA[extraCapturedType].loss);
        }

        const sanText = samuraiKilledSq ? `${move.san}⚔️${samuraiKilledSq}` : move.san;
        playChessSound(move.captured || extraCapturedType ? 'capture' : 'move');
        recordMove(sanText, moveCount);
        moveCount++;

        if (rebalanceState && rebalanceState.controller === userColor && rebalanceState.phase === 'needOwnMove') {
            if (target === rebalanceState.targetSquare || !game.get(rebalanceState.targetSquare) || game.game_over()) {
                rebalanceState = null;
            } else {
                const parts = game.fen().split(' ');
                parts[1] = userColor;
                parts[3] = '-';
                if (userColor === 'b') parts[5] = String(Math.max(1, parseInt(parts[5], 10) - 1));
                game.load(parts.join(' '));
                rebalanceState.phase = 'needCharmedMove';
                updateAbilityUI();
                renderBoardOverlays();
                if (isOnlineMode && currentRoomId) {
                    syncAbilityStateOnline({ kind: 'midRebalance', san: sanText, sound: move.captured ? 'capture' : 'move' });
                }
                return;
            }
        }

        if (isOnlineMode && currentRoomId && !samuraiKilledSq) {
            socket.emit('move', {
                roomId: currentRoomId,
                move: move,
                fen: game.fen()
            });
            finishPlayerTurn(userColor, { kind: 'stateSync' });
        } else if (isOnlineMode && currentRoomId && samuraiKilledSq) {
            finishPlayerTurn(userColor, { kind: 'customMove', san: sanText, sound: 'capture' });
        } else {
            finishPlayerTurn(userColor);
        }
    };

    const onSnapEnd = () => {
        board.position(game.fen());
        renderBoardOverlays();
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

    injectManaAndAbilitiesUI();
    board = Chessboard('board', boardConfig);
    updateAbilityUI();
    renderBoardOverlays();

    $('#board').on('click', '.square-55d63', function () {
        if (game.game_over() || game.turn() !== userColor) return;
        const sqMatch = this.className.match(/square-([a-h][1-8])/);
        if (!sqMatch) return;
        const sq = sqMatch[1];

        if (armedAbility === 'timeJumpSelect') {
            const p = game.get(sq);
            if (p && p.type === 'q' && p.color === userColor) {
                activateTimeJumpOnSquare(sq);
            }
            return;
        }

        if (armedAbility === 'rebalanceSelect') {
            const p = game.get(sq);
            const opp = getOpponentColor(userColor);
            if (p && p.color === opp && p.type !== 'k') {
                const ab = ABILITIES.find(a => a.id === 'rebalance');
                mana[userColor] = clampMana(mana[userColor] - ab.cost);
                cooldowns[userColor].rebalance = ABILITY_COOLDOWN;
                rebalanceState = {
                    controller: userColor,
                    originalOwner: opp,
                    targetSquare: sq,
                    phase: 'needOwnMove'
                };
                armedAbility = null;
                hoveredAbilityId = null;
                showToast(`Фигура на ${sq} переманена! Сначала походите своей фигурой.`);
                updateAbilityUI();
                renderBoardOverlays();
                syncAbilityStateOnline({ kind: 'buffOnly' });
            }
            return;
        }

        if (armedAbility === 'onlyUp') {
            const pawns = getSquaresOfPiece('p', userColor);
            const src = pawns.find(pSq => getOnlyUpTarget(pSq, userColor) === sq);
            if (src) executeOnlyUpJump(src, sq);
            return;
        }

        if (rebalanceState && rebalanceState.controller === userColor && rebalanceState.phase === 'needCharmedMove') {
            if (getCharmedMoves(rebalanceState.targetSquare).includes(sq)) {
                executeCharmedMove(rebalanceState.targetSquare, sq);
            }
        }
    });

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
        resetManaAndAbilities();
    });

    document.querySelector('.flip-board').addEventListener('click', () => {
        board.flip();
        if (!isOnlineMode) {
            userColor = userColor === 'w' ? 'b' : 'w';
            updateAbilityUI();
            if (game.turn() !== userColor) makeSmartMove();
        }
        renderBoardOverlays();
    });

    window.addEventListener('resize', () => {
        board.resize();
        renderBoardOverlays();
    });

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

        btnLogin.disabled = true;
        btnRegister.disabled = true;
        authError.textContent = 'Отправляю...';

        try {
            await authRequest(endpoint, login, password);
            authError.textContent = 'Готово! Добро пожаловать.';
            authError.style.color = '#2c7454';
            setTimeout(showMenu, 600);
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
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext('2d');

                const side = Math.min(img.width, img.height);
                ctx.drawImage(img,
                    (img.width - side) / 2, (img.height - side) / 2, side, side,
                    0, 0, 256, 256);

                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

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
        setWideGameLayout(true);
        setTimeout(() => {
            board.resize();
            renderBoardOverlays();
        }, 60);
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
        resetManaAndAbilities();
    });

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
        resetManaAndAbilities();
        document.getElementById('link-modal').classList.add('hidden');
    });

    socket.on('errorMsg', (msg) => {
        alert(msg);
        setWideGameLayout(false);
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

    socket.on('abilitySync', (data) => {
        if (!data) return;
        applySerializedAbilityState(data.state);

        if (data.kind === 'customMove' || data.kind === 'midRebalance') {
            if (data.fen) {
                game.load(data.fen);
                board.position(data.fen);
            }
            if (data.san) {
                recordMove(data.san, moveCount);
                moveCount++;
            }
            playChessSound(data.sound || 'move');
            checkGameOver();
        } else if (data.kind === 'stateSync' && data.fen && data.fen !== game.fen()) {
            game.load(data.fen);
            board.position(data.fen);
            checkGameOver();
        }

        updateAbilityUI();
        renderBoardOverlays();
    });

    socket.on('opponentLeft', () => {
        alert('Соперник покинул игру.');
        isOnlineMode = false;
        currentRoomId = null;
        setWideGameLayout(false);
        document.getElementById('game-screen').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
    });

    // ========== ПРОВЕРКА URL ==========
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');

    if (roomFromUrl) {
        currentRoomId = roomFromUrl;

        authScreen.classList.add('hidden');
        menuScreen.classList.add('hidden');

        const tryJoin = () => {
            if (!socket.connected) return;
            socket.emit('joinRoom', roomFromUrl);
        };

        if (socket.connected) tryJoin();
        socket.on('connect', tryJoin);
    } else {
        authToken ? showMenu() : showAuth();
    }

    const btnBack = document.getElementById('btn-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            if (isOnlineMode) {
                window.location.href = window.location.pathname;
                return;
            }
            setWideGameLayout(false);
            gameScreen.classList.add('hidden');
            menuScreen.classList.remove('hidden');
        });
    }
});