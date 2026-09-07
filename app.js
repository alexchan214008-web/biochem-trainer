"use strict";
/* Bio/Chem 記字練習 — Duolingo 式本地 web app（無後台、無上傳） */
const LS = "biochem_trainer_v1";
const VOICE_KEY = "biochem_voice";
const SUBJ_ZH = { Biology: "生物 Biology", Chemistry: "化學 Chemistry" };
const SUBJ_ID = { Biology: "bio", Chemistry: "chem" };
const ROUND_LEN = 10;

let WORDS = [], STATS = {}, tab = "all", mode = "mixed", round = null;
const $ = (s) => document.querySelector(s);

/* ---------- 資料 ---------- */
function key(w) { return w.subject + "|" + w.en; }
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
    const raw = JSON.parse(localStorage.getItem(LS) || "{}");
    const keys = new Set(WORDS.map((w) => key(w)));
    STATS = {};
    for (const [k, v] of Object.entries(raw)) if (keys.has(k) && v && typeof v.ok === "number") STATS[k] = v;
    for (const w of WORDS) if (!STATS[key(w)]) STATS[key(w)] = { ok: 0, wrong: 0, streak: 0 };
  } catch (e) { STATS = {}; }
}
function save() { localStorage.setItem(LS, JSON.stringify(STATS)); }

/* ---------- 熟練度 ---------- */
const seen = (s) => s.ok + s.wrong > 0;
const master = (s) => (s.ok >= 5) || (s.ok >= 3 && s.wrong === 0);
function wordStats(w) { return STATS[key(w)]; }
function poolOf(subj) {
  return WORDS.filter((w) => subj === "all" || w.subject === subj);
}
function progress(subj) {
  const p = poolOf(subj);
  const r = { total: p.length, ok: 0, wip: 0, no: 0, wrong: 0 };
  for (const w of p) {
    const s = wordStats(w);
    if (master(s)) r.ok++;
    else if (seen(s)) r.wip++;
    else r.no++;
    if (s.wrong > 0) r.wrong++;
  }
  return r;
}

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

/* ---------- 出題排隊：錯字優先 ---------- */
/* 分層：
 *  tier 0 = ⭐ 相片重點字（未熟）
 *  tier 1 = 錯過嘅字（非重點）
 *  tier 2 = 未學過
 *  tier 3 = 練習中（未熟）
 *  tier 4 = 已熟
 * 層內：重點次數多 → 錯得多 → 啱得少 → 隨機
 */
function tierOf(w) {
  const s = wordStats(w);
  const p = w.priority || 0;
  if (p > 0 && !master(s)) return 0;
  if (s.wrong > 0 && !master(s)) return 1;
  if (!seen(s)) return 2;
  if (s.ok > 0) return 3;
  return 4;
}
function buildQueue(subj, onlyWrong) {
  let p = poolOf(subj);
  if (onlyWrong) p = p.filter((w) => wordStats(w).wrong > 0);
  if (!p.length) return [];
  const q = [...p].sort((a, b) => {
    const ta = tierOf(a), tb = tierOf(b);
    if (ta !== tb) return ta - tb;
    const pa = a.priority || 0, pb = b.priority || 0;
    if (pa !== pb) return pb - pa;
    const sa = wordStats(a), sb = wordStats(b);
    if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong;
    if (sa.ok !== sb.ok) return sa.ok - sb.ok;
    return Math.random() - 0.5;
  });
  return q.slice(0, ROUND_LEN);
}

/* ---------- 渲染 ---------- */
function render() {
  if (round) { round.idx < round.queue.length ? renderQ() : renderSummary(); return; }
  renderHome();
}
function el(html) { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }

function renderHome() {
  const cur = poolOf(tab).filter((w) => wordStats(w).wrong > 0).length;
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

  $("#app").innerHTML = `
    <div class="card">
      <div class="tabs">
        <button class="tab ${tab === "all" ? "active" : ""}" data-t="all">全部</button>
        <button class="tab ${tab === "Biology" ? "active" : ""}" data-s="Biology">🧬 生物</button>
        <button class="tab ${tab === "Chemistry" ? "active" : ""}" data-s="Chemistry">🧪 化學</button>
      </div>
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
      <button class="btn g big" id="startBtn">▶️ 開始練習（每組 ${ROUND_LEN} 題）</button>
      <div class="row" style="margin-top:10px">
        <button class="btn b" id="wrongBtn" ${cur ? "" : "disabled style='opacity:.4'"}">🔁 錯字重溫（${cur}）</button>
        <button class="btn gray" id="listBtn">📋 字庫</button>
      </div>
      <button class="btn ${voiceAuto() ? "b" : "gray"} big" id="voiceBtn" style="margin-top:8px">🔊 自動讀音：${voiceAuto() ? "開（每題自動讀）" : "關"}</button>
      <p class="hint">💡 出題順序：⭐ 相片重點字 → 錯過嘅字 → 其他未學/未熟 → 已熟。揀科撳上面 tab。</p>
    </div>`;

  $("#app").querySelectorAll(".tab").forEach((b) => b.onclick = () => { tab = b.dataset.t || b.dataset.s; render(); });
  $("#app").querySelectorAll(".mode").forEach((b) => b.onclick = () => { mode = b.dataset.m; render(); });
  $("#startBtn").onclick = () => startRound(false);
  $("#wrongBtn").onclick = () => startRound(true);
  $("#listBtn").onclick = showList;
  const vb = $("#voiceBtn");
  if (vb) vb.onclick = () => { setVoiceAuto(!voiceAuto()); render(); };
}

function startRound(onlyWrong) {
  const q = buildQueue(tab, onlyWrong);
  if (!q.length) { alert(onlyWrong ? "冇錯過嘅字，繼續練新字啦！🎉" : "呢科未有字，等 Boss 入表先～"); return; }
  round = { queue: q, idx: 0, score: 0, consec: 0, best: 0, wrongList: [], correctList: [] };
  render();
}

/* ---------- 一題題目 ---------- */
function renderQ() {
  const w = round.queue[round.idx];
  round.answered = false;
  const isType = round.modeNow = (mode === "type") || (mode === "mixed" && round.idx % 2 === 1);
  const tagTxt = `${round.idx + 1}/${round.queue.length} · ${w.subject === "Biology" ? "🧬 生物" : "🧪 化學"} · ${isType ? "⌨️ 串字" : "👀 認字"}`;
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
function normTerm(s) {
  return s.trim().toLowerCase().replace(/[.,;:!?]+$/, "").replace(/\s+/g, " ");
}
/* 接受多種寫法：原樣 / 甩括號註釋 / 括號入面嘅別名（Rontgen ray (Roentgen ray) 打邊個都得） */
function acceptForms(en) {
  const out = new Set();
  for (let raw of en.split(/[|/]/)) {
    raw = raw.trim();
    if (!raw) continue;
    out.add(normTerm(raw));
    const noParen = raw.replace(/\s*\([^()]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    if (noParen && noParen !== raw) out.add(normTerm(noParen));
    for (const m of raw.matchAll(/\(([^()]*)\)/g)) {
      const inner = m[1].trim();
      if (inner) out.add(normTerm(inner));
    }
  }
  return [...out];
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

/* ---------- 字庫一覽 ---------- */
function showList() {
  const words = poolOf(tab);
  const SHOW_MAX = 2000;
  const rows = words.slice(0, SHOW_MAX).map((w) => {
    const s = wordStats(w);
    const dot = master(s) ? "ok" : seen(s) ? "wip" : "no";
    return `<div class="wli"><span><span class="dot ${dot}"></span>${w.priority ? "⭐ " : ""}<span class="zh">${w.zh}</span> ${w.sample ? '<span class="chip sm">試</span>' : ""}</span>
      <span class="en">${w.en} · 錯${s.wrong}·啱${s.ok}</span></div>`;
  }).join("");
  const moreNote = words.length > SHOW_MAX
    ? `<p class="note">顯示頭 ${SHOW_MAX} 個（共 ${words.length}）— 撳上方科目 tab 可以收窄</p>` : "";
  const d = el(`<div class="modal"><div class="box">
    <button class="close-x" id="closeX">✕</button>
    <div class="tabs" style="margin-bottom:6px">
      <button class="tab ${tab === "all" ? "active" : ""}" data-t="all">全部</button>
      <button class="tab ${tab === "Biology" ? "active" : ""}" data-s="Biology">🧬 生物</button>
      <button class="tab ${tab === "Chemistry" ? "active" : ""}" data-s="Chemistry">🧪 化學</button>
    </div>
    <h3>字庫（${words.length} 字）— 🟢已熟 🟡練習中 ⚪未學</h3>
    ${moreNote}
    ${rows || "<p>未有字</p>"}
    <div class="modal-foot"><button class="btn g big" id="closeList">🏠 返回主頁</button></div>
  </div></div>`);
  const close = () => d.remove();
  d.querySelectorAll(".tab").forEach((b) => b.onclick = () => { tab = b.dataset.t || b.dataset.s; d.remove(); showList(); });
  d.querySelector("#closeList").onclick = close;
  d.querySelector("#closeX").onclick = close;
  d.onclick = (e) => { if (e.target === d) close(); };   // 撳外面黑色位都關
  document.body.appendChild(d);
}

/* ---------- 啟動 ---------- */
load();
