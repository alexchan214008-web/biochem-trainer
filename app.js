"use strict";
/* Bio/Chem 記字練習 — Duolingo 式本地 web app（無後台、無上傳）
 * UI adapter：DOM / localStorage / 語音。純邏輯（排隊/熟練度/章節）喺 engine.js */
const E = (typeof Engine !== "undefined") ? Engine : null;   // engine.js 要先 load
if (!E) throw new Error("engine.js 未載入 — index.html 要 <script src='engine.js'> 先過 app.js");
const VOICE_KEY = "biochem_voice";
const SUBJ_ZH = { Biology: "生物 Biology", Chemistry: "化學 Chemistry" };
const SUBJ_ID = { Biology: "bio", Chemistry: "chem" };
/* engine 常數/熟練度 alias（單一來源喺 engine.js） */
const ROUND_LEN = E.ROUND_LEN;
const CARD_LEN = E.CARD_LEN;
const CHAPTER_ORDER = E.CHAPTER_ORDER;
const master = (s) => E.master(s);
const seen = (s) => E.seen(s);

let WORDS = [], STATS = {}, tab = "all", chapter = null, mode = "mixed", round = null, card = null;
const $ = (s) => document.querySelector(s);

/* ---------- 資料 ---------- */
function load() {
  return fetch("wordlist.json", { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((w) => { WORDS = w; syncStats(); render(); })
    .catch(() => {
      $("#app").innerHTML = `<div class="card">⚠️ 讀唔到 wordlist.json。<br>要由 server 開（` +
        `<code>python serve.py</code>），唔好直接 double-click index.html。</div>`;
    });
}
function syncStats() {
  try {
    STATS = E.normalizeStats(JSON.parse(localStorage.getItem(E.LS) || "{}"), WORDS);
  } catch (e) { STATS = {}; }
}
function save() { E.saveStats(STATS); }

/* ---------- 熟練度（delegate engine；STATS 傳入做 store seam） ---------- */
function wordStats(w) { return STATS[E.key(w)]; }
function poolOf(subj) { return E.poolOf(WORDS, subj); }
function activePool() { return E.activePool(WORDS, tab, chapter); }
function chapterMeta(name) { return E.chapterMeta(WORDS, STATS, name); }
function progress(subj) { return E.progress(WORDS, STATS, subj); }
function tierOf(w) { return E.tierOf(w, STATS); }
function buildQueue(subj, onlyWrong) { return E.buildQueue(WORDS, STATS, subj, chapter, onlyWrong); }
function normTerm(s) { return E.normTerm(s); }
function acceptForms(en) { return E.acceptForms(en); }

/* ---------- 讀音（Web Speech API，iOS 內置語音，零外部依賴） ---------- */
function voiceAuto() {
  try { const v = JSON.parse(localStorage.getItem(VOICE_KEY) || "{}"); return v.auto !== false; } catch (e) { return true; }
}
function setVoiceAuto(on) {
  try { localStorage.setItem(VOICE_KEY, JSON.stringify({ auto: on })); } catch (e) {}
}
function pickEnVoice() {
  if (typeof speechSynthesis === "undefined") return null;
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => /^en[-_](US|GB)/i.test(v.lang) && /samantha|google us|aria|female|daniel|karen/i.test(v.name))
      || vs.find((v) => /^en/i.test(v.lang)) || null;
}
function speak(text) {
  if (typeof speechSynthesis === "undefined") return;
  const clean = text.replace(/\s*\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickEnVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "en-US"; }
  u.rate = 0.85;
  speechSynthesis.speak(u);
}
function speakWord(w) { speak(w.en); }

/* ---------- 渲染 ---------- */
function render() {
  if (card) { card.idx < card.queue.length ? renderCard() : renderCardSummary(); return; }
  if (round) { round.idx < round.queue.length ? renderQ() : renderSummary(); return; }
  renderHome();
}
function el(html) { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }
/* 科目 tab（全部/生物/化學）—— renderHome / showList / showChapterPicker 共用 */
function tabsHTML(extraStyle) {
  return `<div class="tabs"${extraStyle ? ` style="${extraStyle}"` : ""}>
      <button class="tab ${tab === "all" ? "active" : ""}" data-t="all">全部</button>
      <button class="tab ${tab === "Biology" ? "active" : ""}" data-s="Biology">🧬 生物</button>
      <button class="tab ${tab === "Chemistry" ? "active" : ""}" data-s="Chemistry">🧪 化學</button>
    </div>`;
}
/* 揀科：轉 tab 一律清除章節 filter（章節淨係 Biology 概念） */
function pickTab(b) { tab = b.dataset.t || b.dataset.s; chapter = null; }

function renderHome() {
  const cur = activePool().filter((w) => wordStats(w).wrong > 0).length;
  const bars = Object.keys(SUBJ_ZH).map((sj) => {
    const p = progress(sj);
    const pct = p.total ? Math.round((p.ok / p.total) * 100) : 0;
    const label = sj === "Biology" ? "🧬" : "🧪";
    return `<div class="prog">
      <div class="lbl"><span>${label} ${SUBJ_ZH[sj]}</span><span>已熟 ${p.ok}/${p.total}（${pct}%）</span></div>
      <div class="bar ${SUBJ_ID[sj]}"><i style="width:${pct}%"></i></div></div>`;
  }).join("");
  const a = progress("all");
  const wrongWords = WORDS.filter((w) => wordStats(w).wrong > 0);
  const sm = WORDS.filter((w) => w.sample).length;
  const pri = poolOf(tab).filter((w) => w.priority).length;
  const isBio = tab === "Biology";
  const chapMeta = (isBio && chapter) ? chapterMeta(chapter) : null;
  const chapRow = isBio ? `
      <div class="chapbar">
        ${chapMeta
          ? `<span class="chapcur">📚 章節：<b>${chapter}</b>（${chapMeta.total} 字 · 已熟 ${chapMeta.ok}）</span>
           <button class="btn gray sm-btn" id="chapClearBtn">✕ 全部課題</button>`
          : `<span class="chapcur">📚 全部課題（20 課）</span>`}
        <button class="btn ${chapter ? "b" : "gray"} sm-btn" id="chapBtn">${chapter ? "換章節" : "揀章節"}</button>
      </div>` : "";

  $("#app").innerHTML = `
    <div class="card">
      ${tabsHTML()}
      ${bars}
      <div class="chips">
        <span class="chip ok">✅ 已熟 ${a.ok}</span>
        <span class="chip wip">✍️ 練習中 ${a.wip}</span>
        <span class="chip no">📄 未學 ${a.no}</span>
        <span class="chip">❌ 錯過 ${a.wrong}</span>
        ${pri ? `<span class="chip" style="background:#fff8e1;color:#b45309">⭐ 相片重點 ${pri}</span>` : ""}
        ${sm ? `<span class="chip sm">試 ${sm}（sample）</span>` : ""}
      </div>
    </div>
    <div class="card">
      <div class="modes">
        <button class="mode ${mode === "mc" ? "active" : ""}" data-m="mc"><span class="t">👀 認字</span><span class="s">睇英文撳中文</span></button>
        <button class="mode ${mode === "type" ? "active" : ""}" data-m="type"><span class="t">⌨️ 串字</span><span class="s">睇中文打英文</span></button>
        <button class="mode ${mode === "mixed" ? "active" : ""}" data-m="mixed"><span class="t">🔀 混合</span><span class="s">兩種輪流</span></button>
      </div>
      ${chapRow}
      <button class="btn g big" id="startBtn">▶️ 開始練習（每組 ${ROUND_LEN} 題）</button>
      <div class="row" style="margin-top:10px">
        <button class="btn b" id="cardBtn">📇 溫習卡</button>
        <button class="btn b" id="wrongBtn" ${cur ? "" : "disabled style='opacity:.4'"}>🔁 錯字重溫（${cur}）</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn gray" id="listBtn">📋 字庫</button>
      </div>
      <button class="btn ${voiceAuto() ? "b" : "gray"} big" id="voiceBtn" style="margin-top:8px">🔊 自動讀音：${voiceAuto() ? "開（每題自動讀）" : "關"}</button>
      <p class="hint">💡 順序：📇 溫習卡學字 → ▶️ 練習鞏固 → 錯字自動重溫。生物科可以揀章節集中練。</p>
    </div>`;

  $("#app").querySelectorAll(".tab").forEach((b) => b.onclick = () => { pickTab(b); render(); });
  $("#app").querySelectorAll(".mode").forEach((b) => b.onclick = () => { mode = b.dataset.m; render(); });
  $("#startBtn").onclick = () => startRound(false);
  const cdBtn = $("#cardBtn");
  if (cdBtn) cdBtn.onclick = startCards;
  $("#wrongBtn").onclick = () => startRound(true);
  $("#listBtn").onclick = showList;
  const cb = $("#chapBtn");
  if (cb) cb.onclick = showChapterPicker;
  const cc = $("#chapClearBtn");
  if (cc) cc.onclick = () => { chapter = null; render(); };
  const vb = $("#voiceBtn");
  if (vb) vb.onclick = () => { setVoiceAuto(!voiceAuto()); render(); };
}

function startRound(onlyWrong) {
  const q = buildQueue(tab, onlyWrong);
  if (!q.length) { alert(onlyWrong ? "冇錯過嘅字，繼續練新字啦！🎉" : "呢科未有字，等 Boss 入表先～"); return; }
  round = { queue: q, idx: 0, score: 0, consec: 0, best: 0, wrongList: [], correctList: [] };
  render();
}

/* ---------- 📇 溫習卡（Flashcards）：先學後練 ---------- */
function startCards() {
  const p = activePool().slice().sort((a, b) => {
    const ta = tierOf(a), tb = tierOf(b);
    if (ta !== tb) return ta - tb;
    const pa = a.priority || 0, pb = b.priority || 0;
    if (pa !== pb) return pb - pa;
    return Math.random() - 0.5;
  });
  const fresh = p.filter((w) => !master(wordStats(w)));
  const pool = fresh.length ? fresh : p;
  if (!pool.length) { alert("呢度未有字可以溫～"); return; }
  card = { queue: pool.slice(0, CARD_LEN), idx: 0, knew: 0, unsure: [] };
  render();
}
function renderCard() {
  const w = card.queue[card.idx];
  card.flipped = false;
  const chapTag = w.chapter ? ` · 📚 ${w.chapter}` : "";
  const tagTxt = `${card.idx + 1}/${card.queue.length} · ${w.subject === "Biology" ? "🧬 生物" : "🧪 化學"}${chapTag} · 📇 溫習`;
  const star = w.priority ? "⭐ " : "";
  const status = master(wordStats(w)) ? "（已熟·複習）" : seen(wordStats(w)) ? "（練習中）" : "（未學）";
  $("#app").innerHTML = `
    <div class="card">
      <div class="qtag"><span>${tagTxt}</span><span>💪 記住 ${card.knew} · 🤔 ${card.unsure.length}</span></div>
      <div class="flashcard" id="cardFace">
        <div class="fc-en">${star}${w.en}</div>
        <div class="fc-zh" id="fcZh">${w.zh} <span class="fc-status">${status}</span></div>
        <div class="fc-sub">撳張卡睇答案 · 🔊 讀音</div>
      </div>
      <div style="text-align:center;margin:2px 0 10px"><button class="spk" id="spkBtn">🔊 讀音</button></div>
      <div class="feedback" id="fb"></div>
      <div id="cardAct"></div>
    </div>`;
  const face = $("#cardFace");
  face.onclick = () => {
    card.flipped = true;
    face.classList.add("flipped");
    speakWord(w);
    renderCardActs(w);
  };
  const spk = $("#spkBtn");
  if (spk) spk.onclick = (e) => { e.stopPropagation(); speakWord(w); };
  if (voiceAuto()) setTimeout(() => { if ($("#cardFace")) speakWord(w); }, 400);
  renderCardActs(w);
}
function renderCardActs(w) {
  const act = $("#cardAct");
  if (!act) return;
  act.innerHTML = card.flipped
    ? `<div class="row"><button class="btn g" id="knowBtn">✅ 識</button>
       <button class="btn b" id="unsureBtn">🔁 唔識（入錯字隊）</button></div>`
    : `<button class="btn gray big" id="flipHint">👀 睇答案</button>`;
  const kh = $("#flipHint");
  if (kh) kh.onclick = () => { card.flipped = true; $("#cardFace").classList.add("flipped"); renderCardActs(w); speakWord(w); };
  const kb = $("#knowBtn");
  if (kb) kb.onclick = () => cardAnswer(w, true);
  const ub = $("#unsureBtn");
  if (ub) ub.onclick = () => cardAnswer(w, false);
}
function cardAnswer(w, knew) {
  if (card.answered) return;
  card.answered = true;
  const s = wordStats(w);
  if (knew) { card.knew++; s.ok++; s.streak++; }
  else { card.unsure.push(w); s.wrong++; s.streak = 0; }
  save();
  const fb = $("#fb");
  fb.className = "feedback " + (knew ? "ok" : "bad");
  fb.innerHTML = knew ? "✅ 記住喇！" : `🔁 記低咗，練習會優先出：<b>${w.en}</b>`;
  const act = $("#cardAct");
  if (act) act.innerHTML = `<button class="btn g big" id="nextCardBtn" style="margin-top:10px">${card.idx + 1 < card.queue.length ? "下一張 ➡️" : "睇結果 🏁"}</button>`;
  const nb = $("#nextCardBtn");
  if (nb) nb.onclick = () => { card.idx++; card.answered = false; render(); };
}
function renderCardSummary() {
  const tot = card.queue.length;
  const okN = card.knew;
  const pct = Math.round((okN / tot) * 100);
  const wr = card.unsure.map((x) => `<div class="wr"><span>${x.zh}</span><b>${x.en}</b></div>`).join("");  const scope = chapter ? `（📚 ${chapter}）` : "";
  $("#app").innerHTML = `
    <div class="card">
      <div class="bigscore">${pct}%</div>
      <div class="sumlbl">📇 溫習完：記住 ${okN}/${tot}${scope}</div>
      ${wr ? `<h3 style="margin-bottom:8px">🔁 唔識嘅字（已入錯字隊，練習會優先出）：</h3>` + wr : `<div style="text-align:center;font-size:20px">🏅 全部記住！</div>`}
      <div class="row" style="margin-top:14px">
        <button class="btn g" id="againBtn">🔁 再溫一轉</button>
        <button class="btn gray" id="homeBtn">🏠 主頁</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn b" id="drillBtn">✍️ 練返今次唔識嘅</button>
      </div>
    </div>`;
  $("#againBtn").onclick = () => { card = null; startCards(); };
  $("#homeBtn").onclick = () => { card = null; render(); };
  $("#drillBtn").onclick = () => {
    const unsureWords = card.unsure;
    card = null;
    const q = unsureWords.length ? unsureWords : buildQueue(tab, true);
    round = { queue: q, idx: 0, score: 0, consec: 0, best: 0, wrongList: [], correctList: [] };
    render();
  };
  $("#headStreak").textContent = "🔥 0";
  $("#headScore").textContent = "🏆 " + 0;
}

/* ---------- 一題題目 ---------- */
function renderQ() {
  const w = round.queue[round.idx];
  round.answered = false;
  const isType = round.modeNow = (mode === "type") || (mode === "mixed" && round.idx % 2 === 1);
  const chapTag = w.chapter ? ` · 📚 ${w.chapter}` : "";
  const tagTxt = `${round.idx + 1}/${round.queue.length} · ${w.subject === "Biology" ? "🧬 生物" : "🧪 化學"}${chapTag} · ${isType ? "⌨️ 串字" : "👀 認字"}`;
  $("#app").innerHTML = `
    <div class="card">
      <div class="qtag"><span>${tagTxt}</span><span>🔥 ${round.consec} · 🏆 ${round.score}</span></div>
      ${isType ? `<div class="qtext" style="font-size:30px">${w.zh}</div>
        <div class="typebox"><input id="typeIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="打英文…"></div>`
      : `<div class="qtext">${w.en}</div>
        <div id="opts"></div>`}
      <div style="text-align:center;margin:2px 0 10px"><button class="spk" id="spkBtn">🔊 讀音</button></div>
      <div class="feedback" id="fb"></div>
      <div id="nextArea"></div>
    </div>`;
  $("#headStreak").textContent = "🔥 " + round.consec;
  $("#headScore").textContent = "🏆 " + round.score;
  const spk = $("#spkBtn");
  if (spk) {
    spk.onclick = () => speakWord(w);
    if (voiceAuto()) setTimeout(() => { if (document.querySelector("#spkBtn")) speakWord(w); }, 500);
  }
  if (isType) {
    const inp = $("#typeIn");
    const submit = () => answerType(inp.value, w);
    inp.focus();
    inp.onkeydown = (e) => { if (e.key === "Enter") submit(); };
    $("#fb").innerHTML = "";
    // 直接喺 input 撳 Enter 交卷；俾埋個掣方便手機
    $("#nextArea").innerHTML = `<button class="btn g big" id="typeBtn" style="margin-top:10px">✔️ 確認</button>`;
    $("#typeBtn").onclick = submit;
  } else {
    renderOptions(w);
  }
}

function renderOptions(w) {
  const pool = poolOf(tab).filter((x) => x.en !== w.en || x.subject !== w.subject);
  const opts = [w];
  const rand = [...pool].sort(() => Math.random() - 0.5);
  for (const x of rand) { if (opts.length >= 4) break; if (!opts.some((o) => o.zh === x.zh)) opts.push(x); }
  opts.sort(() => Math.random() - 0.5);
  const box = $("#opts");
  box.innerHTML = opts.map((o, i) =>
    `<button class="opt" data-i="${i}" data-zh="${encodeURIComponent(o.zh)}">${o.zh}</button>`).join("");
  box.querySelectorAll(".opt").forEach((b) => {
    b.onclick = () => answerMC(w, opts[+b.dataset.i], b);
  });
}

/* ---------- 交答案 ---------- */
function record(w, ok) {
  const s = wordStats(w);
  if (ok) { s.ok++; s.streak++; } else { s.wrong++; s.streak = 0; }
  save();
}
function afterAnswer(w, ok, correctTxt) {
  if (ok) {
    round.consec++; round.best = Math.max(round.best, round.consec);
    round.score += 10 + (round.consec >= 3 ? 5 : 0);
    round.correctList.push(w);
  } else {
    round.consec = 0;
    round.wrongList.push({ en: w.en, zh: w.zh });
  }
  record(w, ok);
  $("#headStreak").textContent = "🔥 " + round.consec;
  $("#headScore").textContent = "🏆 " + round.score;
  const fb = $("#fb");
  fb.className = "feedback " + (ok ? "ok" : "bad");
  fb.innerHTML = ok ? (round.consec >= 3 ? `🎉 啱晒！連啱 ${round.consec} 題，+${10 + 5} 分` : `✅ 啱！+10 分`)
    : `❌ 唔啱… 正確答案：<b>${correctTxt}</b>`;
  const na = $("#nextArea");
  if (na) {
    na.innerHTML = `<button class="btn g big" id="nextBtn" style="margin-top:10px">下一題 ➡️</button>`;
    na.querySelector("#nextBtn").onclick = () => { round.idx++; render(); };
  }
  if (round.consec >= 3 && ok) { /* confetti-lite */ document.body.style.background = "#fffbe6"; setTimeout(() => document.body.style.background = "", 350); }
}
function answerMC(w, chosen, btn) {
  if (round.answered) return;
  round.answered = true;
  const ok = chosen.zh === w.zh;
  const opts = btn.parentElement.querySelectorAll(".opt");
  opts.forEach((b) => b.disabled = true);
  opts.forEach((b) => {
    if (decodeURIComponent(b.dataset.zh) === w.zh) b.classList.add("correct");
    else if (!ok && b === btn) b.classList.add("wrong");
    else b.classList.add("dim");
  });
  afterAnswer(w, ok, w.zh);
}
function answerType(val, w) {
  if (round.answered) return;
  round.answered = true;
  const accept = acceptForms(w.en);
  const ans = normTerm(val);
  const ok = accept.includes(ans);
  const inp = $("#typeIn");
  if (inp) {
    inp.disabled = true;
    if (!ok) inp.classList.add("wrong");
  }
  const tb = $("#typeBtn");
  if (tb) tb.disabled = true;
  afterAnswer(w, ok, w.en);
}

/* ---------- 一組總結 ---------- */
function renderSummary() {
  const tot = round.queue.length;
  const okN = tot - round.wrongList.length;
  const pct = Math.round((okN / tot) * 100);
  const wr = round.wrongList.map((x) =>
    `<div class="wr"><span>${x.zh}</span><b>${x.en}</b></div>`).join("");
  $("#app").innerHTML = `
    <div class="card">
      <div class="bigscore">${pct}%</div>
      <div class="sumlbl">答啱 ${okN}/${tot} · 得分 ${round.score} · 最長連啱 ${round.best}</div>
      ${wr ? `<h3 style="margin-bottom:8px">❌ 今次要記住嘅字（會優先重出）：</h3>` + wr : `<div style="text-align:center;font-size:20px">🏅 全對！勁呀！</div>`}
      <div class="row" style="margin-top:14px">
        <button class="btn g" id="againBtn">🔁 再練一組</button>
        <button class="btn gray" id="homeBtn">🏠 主頁</button>
      </div>
      ${wr ? `<div class="row" style="margin-top:8px"><button class="btn b" id="wonlyBtn">❌ 淨係練錯字</button></div>` : ""}
    </div>`;
  $("#againBtn").onclick = () => { round = null; startRound(false); };
  $("#homeBtn").onclick = () => { round = null; render(); };
  const wonly = $("#wonlyBtn");
  if (wonly) wonly.onclick = () => startRound(true);
  $("#headStreak").textContent = "🔥 0";
  $("#headScore").textContent = "🏆 " + round.score;
}

/* ---------- 字庫一覽（📖 兼做課題字表：每行可聽讀音） ---------- */
function showList() {
  const words = activePool();
  const SHOW_MAX = 2000;
  const rows = words.slice(0, SHOW_MAX).map((w) => {
    const s = wordStats(w);
    const dot = master(s) ? "ok" : seen(s) ? "wip" : "no";
    const chap = w.chapter ? ` <span class="mini">${w.chapter}</span>` : "";
    return `<div class="wli"><span><span class="dot ${dot}"></span>${w.priority ? "⭐ " : ""}<span class="zh">${w.zh}</span>${chap} ${w.sample ? '<span class="chip sm">試</span>' : ""}</span>
      <span class="en"><button class="spk mini" data-en="${encodeURIComponent(w.en)}" title="讀音">🔊</button> ${w.en} · 錯${s.wrong}·啱${s.ok}</span></div>`;
  }).join("");
  const moreNote = words.length > SHOW_MAX
    ? `<p class="note">顯示頭 ${SHOW_MAX} 個（共 ${words.length}）— 撳上方科目 tab 或揀章節可以收窄</p>` : "";
  const scope = chapter ? `（📚 ${chapter}）` : "";
  const d = el(`<div class="modal"><div class="box">
    <button class="close-x" id="closeX">✕</button>
    ${tabsHTML("margin-bottom:6px")}
    <h3>📖 字庫${scope}（${words.length} 字）— 🟢已熟 🟡練習中 ⚪未學 · 🔊撳掣聽讀音</h3>
    ${moreNote}
    ${rows || "<p>未有字</p>"}
    <div class="modal-foot"><button class="btn g big" id="closeList">🏠 返回主頁</button></div>
  </div></div>`);
  const close = () => d.remove();
  d.querySelectorAll(".tab").forEach((b) => b.onclick = () => { pickTab(b); d.remove(); showList(); });
  d.querySelectorAll(".spk.mini").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    speak(decodeURIComponent(b.dataset.en));
  });
  d.querySelector("#closeList").onclick = close;
  d.querySelector("#closeX").onclick = close;
  d.onclick = (e) => { if (e.target === d) close(); };   // 撳外面黑色位都關
  document.body.appendChild(d);
}

/* ---------- 揀章節（Biology 限定） ---------- */
function showChapterPicker() {
  const rows = CHAPTER_ORDER.map((name) => {
    const m = chapterMeta(name);
    const pct = m.total ? Math.round((m.ok / m.total) * 100) : 0;
    const active = chapter === name ? "active" : "";
    return `<button class="chap ${active}" data-c="${encodeURIComponent(name)}">
      <span class="cn">📚 ${name}</span>
      <span class="cb"><i style="width:${pct}%"></i></span>
      <span class="cs">已熟 ${m.ok}/${m.total}</span>
    </button>`;
  }).join("");
  const d = el(`<div class="modal"><div class="box">
    <button class="close-x" id="closeX">✕</button>
    <h3>📚 揀章節 — 生物 Biology</h3>
    <p class="hint" style="margin:-4px 0 10px">揀咗之後只會出嗰課嘅字（⭐ 重點字照樣優先）；再撳一次同一個章節 = 取消。</p>
    <div class="chapgrid">
      <button class="chap all ${!chapter ? "active" : ""}" data-c="">
        <span class="cn">🌐 全部課題</span><span class="cs">已熟 ${progress("Biology").ok}/${poolOf("Biology").length}</span>
      </button>
      ${rows}
    </div>
    <div class="modal-foot"><button class="btn g big" id="closeList">✅ 搞掂</button></div>
  </div></div>`);
  const close = () => d.remove();
  d.querySelectorAll(".chap").forEach((b) => b.onclick = () => {
    const c = decodeURIComponent(b.dataset.c);
    chapter = c || null;
    d.remove();
    render();
  });
  d.querySelector("#closeList").onclick = close;
  d.querySelector("#closeX").onclick = close;
  d.onclick = (e) => { if (e.target === d) close(); };
  document.body.appendChild(d);
}

/* ---------- 啟動 ---------- */
load();
