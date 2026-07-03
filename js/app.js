/* ねこおき - 猫のロジックパズル
 * ルール: 各行・各列・各エリアに猫1匹。猫どうしは(ななめ含め)隣接禁止。
 */
(() => {
  "use strict";

  const SIZES = [
    { n: 5, name: "こねこ", desc: "5×5" },
    { n: 6, name: "みけ", desc: "6×6" },
    { n: 7, name: "とら", desc: "7×7" },
    { n: 8, name: "ボスねこ", desc: "8×8" },
    { n: 9, name: "ぬしさま", desc: "9×9" },
  ];
  const UNLOCK_NEED = 2; // 前のサイズを何問クリアで次を解放するか

  // エリアの数(=盤面サイズ)ぶんの色相を均等割りし、さらに偶奇でリッチ度(彩度・明度)を
  // 変えることで、隣接エリアが似た色相同士になっても見分けやすくする。
  function regionColor(id, total) {
    const hue = Math.round((id * 360) / total + 8) % 360;
    const light = id % 2 === 0 ? 80 : 68;
    const sat = id % 2 === 0 ? 58 : 66;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  const STORE_KEY = "nekooki.v1";

  // ---------- 保存データ ----------
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch { /* プライベートモード等では保存できないが続行 */ }
  }
  const store = loadStore();
  store.solved = store.solved || {};
  store.best = store.best || {};
  if (typeof store.auto !== "boolean") store.auto = true;

  // ---------- 乱数ユーティリティ ----------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- パズル生成 ----------
  // 猫の配置(各行の列番号)を1つ作る。列重複なし・連続行は2列以上離す。
  function genPlacement(n) {
    const cols = new Array(n).fill(-1);
    const used = new Array(n).fill(false);
    function dfs(row) {
      if (row === n) return true;
      for (const c of shuffle([...Array(n).keys()])) {
        if (used[c]) continue;
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) continue;
        cols[row] = c; used[c] = true;
        if (dfs(row + 1)) return true;
        used[c] = false;
      }
      return false;
    }
    return dfs(0) ? cols : null;
  }

  // 猫の位置を種にしてランダム成長でエリア分割(エリアiは行iの猫を含む)。
  // エリアごとにランダムな成長重みを与えてサイズにばらつきを作ると、
  // 唯一解の盤面になる確率が大幅に上がる(一様成長比で約200倍)。
  function genRegions(n, cats) {
    const region = new Array(n * n).fill(-1);
    for (let r = 0; r < n; r++) region[r * n + cats[r]] = r;
    const weight = Array.from({ length: n }, () => Math.pow(Math.random(), 3) + 0.01);
    let remaining = n * n - n;
    while (remaining > 0) {
      // 未割当かつ割当済みに隣接するマスから (マス, 隣接エリア) を重み付きで選ぶ
      const options = [];
      let total = 0;
      for (let i = 0; i < n * n; i++) {
        if (region[i] !== -1) continue;
        const r = Math.floor(i / n), c = i % n;
        const neigh = new Set();
        if (r > 0 && region[i - n] !== -1) neigh.add(region[i - n]);
        if (r < n - 1 && region[i + n] !== -1) neigh.add(region[i + n]);
        if (c > 0 && region[i - 1] !== -1) neigh.add(region[i - 1]);
        if (c < n - 1 && region[i + 1] !== -1) neigh.add(region[i + 1]);
        for (const g of neigh) { options.push([i, g, weight[g]]); total += weight[g]; }
      }
      let pick = Math.random() * total;
      let chosen = options[options.length - 1];
      for (const o of options) { pick -= o[2]; if (pick <= 0) { chosen = o; break; } }
      region[chosen[0]] = chosen[1];
      remaining--;
    }
    return region;
  }

  // 解の個数を数える(limitで打ち切り)
  function countSolutions(n, region, limit = 2) {
    const usedCol = new Array(n).fill(false);
    const usedReg = new Array(n).fill(false);
    let count = 0;
    function dfs(row, prevCol) {
      if (row === n) { count++; return; }
      for (let c = 0; c < n; c++) {
        if (usedCol[c]) continue;
        if (prevCol >= 0 && Math.abs(c - prevCol) < 2) continue;
        const reg = region[row * n + c];
        if (usedReg[reg]) continue;
        usedCol[c] = true; usedReg[reg] = true;
        dfs(row + 1, c);
        usedCol[c] = false; usedReg[reg] = false;
        if (count >= limit) return;
      }
    }
    dfs(0, -1);
    return count;
  }

  // 唯一解になるまで生成を繰り返す
  function generatePuzzle(n) {
    for (let attempt = 0; attempt < 3000; attempt++) {
      const cats = genPlacement(n);
      if (!cats) continue;
      const region = genRegions(n, cats);
      if (countSolutions(n, region) === 1) return region;
    }
    return null; // 実際にはここまで来ない
  }

  // ---------- ゲーム状態 ----------
  const EMPTY = 0, MARK = 1, CAT = 2;
  let game = null; // { n, region, states, moves, elapsed, done }
  let autoCounts = [];
  let timerId = null;

  function newGame(n, saved) {
    game = saved || {
      n,
      region: generatePuzzle(n),
      states: new Array(n * n).fill(EMPTY),
      moves: [],
      elapsed: 0,
      done: false,
    };
    recomputeAuto();
    renderBoard();
    updateTimerText();
    startTimer();
    persistGame();
  }

  function persistGame() {
    store.cur = game && !game.done
      ? { n: game.n, region: game.region, states: game.states, elapsed: game.elapsed }
      : null;
    saveStore();
  }

  // ---------- 自動マーク(猫の効き筋に薄い×を表示) ----------
  function recomputeAuto() {
    const n = game.n;
    autoCounts = new Array(n * n).fill(0);
    if (!store.auto) return;
    for (let i = 0; i < n * n; i++) {
      if (game.states[i] !== CAT) continue;
      const r = Math.floor(i / n), c = i % n;
      for (let j = 0; j < n * n; j++) {
        if (j === i) continue;
        const jr = Math.floor(j / n), jc = j % n;
        if (jr === r || jc === c || game.region[j] === game.region[i] ||
            (Math.abs(jr - r) <= 1 && Math.abs(jc - c) <= 1)) {
          autoCounts[j]++;
        }
      }
    }
  }

  // ---------- 判定 ----------
  function findConflicts() {
    const n = game.n;
    const cats = [];
    for (let i = 0; i < n * n; i++) if (game.states[i] === CAT) cats.push(i);
    const bad = new Set();
    for (let a = 0; a < cats.length; a++) {
      for (let b = a + 1; b < cats.length; b++) {
        const i = cats[a], j = cats[b];
        const ir = Math.floor(i / n), ic = i % n;
        const jr = Math.floor(j / n), jc = j % n;
        if (ir === jr || ic === jc || game.region[i] === game.region[j] ||
            (Math.abs(ir - jr) <= 1 && Math.abs(ic - jc) <= 1)) {
          bad.add(i); bad.add(j);
        }
      }
    }
    return { cats, bad };
  }

  function checkWin() {
    const { cats, bad } = findConflicts();
    return cats.length === game.n && bad.size === 0;
  }

  // ---------- 描画 ----------
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  let cellEls = [];

  function catSVG() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path class="cat-body" fill="#4a3728" d="M12 6.9 a7.2 7.2 0 1 1 -0.02 0 Z
        M5.6 11 L6.4 3.2 L11.6 7 Z M18.4 11 L17.6 3.2 L12.4 7 Z"/>
      <path d="M8 14 q1.6 1.9 3.2 0 M12.8 14 q1.6 1.9 3.2 0"
        stroke="#faf3e8" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    </svg>`;
  }

  function renderBoard() {
    const n = game.n;
    boardEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    boardEl.style.gridTemplateRows = `repeat(${n}, 1fr)`;
    boardEl.innerHTML = "";
    cellEls = [];
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n;
      const el = document.createElement("div");
      el.className = "cell";
      el.style.background = regionColor(game.region[i], n);
      if (r > 0 && game.region[i] !== game.region[i - n]) el.classList.add("bt");
      else if (r > 0) el.classList.add("thin-t");
      if (c > 0 && game.region[i] !== game.region[i - 1]) el.classList.add("bl");
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); tapCell(i); });
      boardEl.appendChild(el);
      cellEls.push(el);
    }
    refreshCells();
  }

  function refreshCells() {
    const { bad } = findConflicts();
    for (let i = 0; i < cellEls.length; i++) {
      const el = cellEls[i];
      const s = game.states[i];
      let html = "";
      if (s === CAT) html = catSVG();
      else if (s === MARK) html = `<span class="mark-dot">×</span>`;
      else if (autoCounts[i] > 0) html = `<span class="mark-dot auto">×</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.classList.toggle("error", bad.has(i));
    }
  }

  // ---------- 操作 ----------
  function tapCell(i) {
    if (game.done) return;
    const prev = game.states[i];
    const next = (prev + 1) % 3;
    game.states[i] = next;
    game.moves.push({ i, prev });
    recomputeAuto();
    refreshCells();
    if (next === CAT) {
      cellEls[i].classList.remove("pop");
      void cellEls[i].offsetWidth;
      cellEls[i].classList.add("pop");
    }
    if (checkWin()) onWin();
    else persistGame();
  }

  function undo() {
    if (game.done || game.moves.length === 0) return;
    const { i, prev } = game.moves.pop();
    game.states[i] = prev;
    recomputeAuto();
    refreshCells();
    persistGame();
  }

  function clearBoard() {
    if (game.done) return;
    game.states.fill(EMPTY);
    game.moves = [];
    recomputeAuto();
    refreshCells();
    persistGame();
  }

  // ---------- タイマー ----------
  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      if (document.hidden || !game || game.done) return;
      game.elapsed++;
      updateTimerText();
      if (game.elapsed % 5 === 0) persistGame();
    }, 1000);
  }
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }
  function fmtTime(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }
  function updateTimerText() {
    $("timer").textContent = fmtTime(game ? game.elapsed : 0);
  }

  // ---------- クリア処理 ----------
  function onWin() {
    game.done = true;
    stopTimer();
    const n = game.n;
    const key = String(n);
    store.solved[key] = (store.solved[key] || 0) + 1;
    let bestNote = "";
    if (!store.best[key] || game.elapsed < store.best[key]) {
      store.best[key] = game.elapsed;
      bestNote = " 🏆 じこベスト!";
    }
    store.cur = null;
    saveStore();

    $("win-info").textContent =
      `${n}×${n} を ${fmtTime(game.elapsed)} でクリア${bestNote}`;

    // 解放判定
    const unlockEl = $("win-unlock");
    unlockEl.classList.add("hidden");
    const idx = SIZES.findIndex((s) => s.n === n);
    if (idx >= 0 && idx + 1 < SIZES.length) {
      const nextSize = SIZES[idx + 1];
      const count = store.solved[key];
      if (count === UNLOCK_NEED) {
        unlockEl.textContent = `🎉 ${nextSize.desc}「${nextSize.name}」が解放されました!`;
        unlockEl.classList.remove("hidden");
      }
    }
    setTimeout(() => showModal("modal-win"), 450);
  }

  // ---------- 画面遷移 ----------
  function isUnlocked(idx) {
    if (idx === 0) return true;
    const prevKey = String(SIZES[idx - 1].n);
    return (store.solved[prevKey] || 0) >= UNLOCK_NEED;
  }

  function renderHome() {
    const list = $("size-list");
    list.innerHTML = "";
    SIZES.forEach((s, idx) => {
      const unlocked = isUnlocked(idx);
      const solved = store.solved[String(s.n)] || 0;
      const best = store.best[String(s.n)];
      const btn = document.createElement("button");
      btn.className = "size-btn";
      btn.disabled = !unlocked;
      let meta;
      if (unlocked) {
        meta = `${solved}問クリア${best ? `<br>ベスト ${fmtTime(best)}` : ""}`;
      } else {
        const prev = SIZES[idx - 1];
        const need = UNLOCK_NEED - (store.solved[String(prev.n)] || 0);
        meta = `🔒 ${prev.desc}をあと${need}問`;
      }
      btn.innerHTML =
        `<span class="size-num">${unlocked ? "😺" : "🔒"} ${s.desc}</span>` +
        `<span class="size-name">${s.name}</span>` +
        `<span class="size-meta">${meta}</span>`;
      if (unlocked) btn.addEventListener("click", () => startGame(s.n));
      list.appendChild(btn);
    });

    const total = Object.values(store.solved).reduce((a, b) => a + b, 0);
    $("home-stats").innerHTML = total > 0
      ? `これまでに <b>${total}</b> 問の猫たちを眠らせました 💤`
      : "むずかしいことは考えず、猫をならべて休みましょう。";
  }

  function showScreen(name) {
    $("screen-home").classList.toggle("hidden", name !== "home");
    $("screen-game").classList.toggle("hidden", name !== "game");
    $("btn-home").classList.toggle("hidden", name === "home");
    $("timer").classList.toggle("hidden", name !== "game");
    if (name === "home") { stopTimer(); renderHome(); }
  }

  function startGame(n, saved) {
    showScreen("game");
    newGame(n, saved);
  }

  function showModal(id) { $(id).classList.remove("hidden"); }
  function hideModal(id) { $(id).classList.add("hidden"); }

  // ---------- イベント ----------
  $("btn-home").addEventListener("click", () => showScreen("home"));
  $("btn-help").addEventListener("click", () => showModal("modal-rules"));
  $("btn-rules-close").addEventListener("click", () => {
    hideModal("modal-rules");
    store.seenRules = true;
    saveStore();
  });
  $("btn-undo").addEventListener("click", undo);
  $("btn-clear").addEventListener("click", clearBoard);
  $("btn-new").addEventListener("click", () => newGame(game.n));
  $("btn-next").addEventListener("click", () => {
    hideModal("modal-win");
    newGame(game.n);
  });
  $("btn-win-home").addEventListener("click", () => {
    hideModal("modal-win");
    showScreen("home");
  });

  const autoBtn = $("btn-automark");
  function renderAutoBtn() {
    autoBtn.classList.toggle("on", store.auto);
    autoBtn.setAttribute("aria-pressed", String(store.auto));
  }
  autoBtn.addEventListener("click", () => {
    store.auto = !store.auto;
    saveStore();
    renderAutoBtn();
    if (game) { recomputeAuto(); refreshCells(); }
  });
  renderAutoBtn();

  // ---------- 起動 ----------
  if (store.cur && store.cur.region) {
    // 中断していたパズルを再開
    startGame(store.cur.n, {
      n: store.cur.n,
      region: store.cur.region,
      states: store.cur.states,
      moves: [],
      elapsed: store.cur.elapsed || 0,
      done: false,
    });
  } else {
    showScreen("home");
  }
  if (!store.seenRules) showModal("modal-rules");

  // ---------- Service Worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
