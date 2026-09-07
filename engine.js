"use strict";
/* ============================================================
 * engine.js — BioChemTrainer 練習引擎（純邏輯，無 DOM、無 global state）
 *
 * 設計（architecture review candidate 1）：
 *  - 所有函數都收 explicit 參數（words / stats），唔讀任何 global
 *  - stats 係 { "subject|en": {ok, wrong, streak} }，傳入嚟就係 store seam —
 *    web 版傳 localStorage 載入嘅 object，測試直接傳 in-memory object
 *  - UI（app.js）係 adapter：負責 DOM、localStorage、語音
 *
 * 喺 browser：<script src="engine.js"> 前於 app.js 載入，global 係 window.Engine
 * 喺 node：   const E = require("./engine.js")
 * ============================================================ */
(function (global) {
  const LS = "biochem_trainer_v1";
  const ROUND_LEN = 10;
  const CARD_LEN = 12;
  /* 章節顯示順序（跟 DSE Bio 課程次序）— 對應 wordlist 嘅 chapter 欄 */
  const CHAPTER_ORDER = [
    "生命特徵與科學方法", "細胞結構", "物質進出細胞", "酶", "營養與消化",
    "植物營養與運輸", "呼吸作用", "人體循環系統", "肌肉與骨骼", "排泄與滲透調節",
    "恆定性", "神經協調與感官", "激素協調", "生殖與生長", "遺傳",
    "微生物學", "生物科技", "疾病與免疫", "進化與分類", "生態學",
  ];

  /* ---------- 資料 key ---------- */
  function key(w) { return w.subject + "|" + w.en; }
  function emptyStats() { return { ok: 0, wrong: 0, streak: 0 }; }

  /* ---------- localStorage adapter（web 用）；測試可直接傳 in-memory ---------- */
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; }
  }
  function saveStats(stats) {
    try { localStorage.setItem(LS, JSON.stringify(stats)); } catch (e) { /* 私人模式照玩，唔儲 */ }
  }
  /* 淨係留低 wordlist 有嘅 key + 補返未存在嘅（初始化） */
  function normalizeStats(stats, words) {
    const out = {};
    const known = new Set(words.map(key));
    for (const [k, v] of Object.entries(stats || {})) {
      if (known.has(k) && v && typeof v.ok === "number") out[k] = v;
    }
    for (const w of words) if (!out[key(w)]) out[key(w)] = emptyStats();
    return out;
  }

  /* ---------- 熟練度 ---------- */
  const seen = (s) => s.ok + s.wrong > 0;
  const master = (s) => (s.ok >= 5) || (s.ok >= 3 && s.wrong === 0);

  /* ---------- 篩選 helpers ---------- */
  function poolOf(words, subj) {
    return words.filter((w) => subj === "all" || w.subject === subj);
  }
  /* 當前出題池：跟 subj + chapter（章節淨係 Biology 概念） */
  function activePool(words, subj, chapter) {
    let p = poolOf(words, subj);
    if (chapter) p = p.filter((w) => w.chapter === chapter);
    return p;
  }
  /* 一科嘅進度統計 */
  function progress(words, stats, subj) {
    const p = poolOf(words, subj);
    const r = { total: p.length, ok: 0, wip: 0, no: 0, wrong: 0 };
    for (const w of p) {
      const s = stats[key(w)] || emptyStats();
      if (master(s)) r.ok++;
      else if (seen(s)) r.wip++;
      else r.no++;
      if (s.wrong > 0) r.wrong++;
    }
    return r;
  }
  /* 單一章節嘅字同進度（Biology 範圍） */
  function chapterMeta(words, stats, name) {
    const list = poolOf(words, "Biology").filter((w) => w.chapter === name);
    let ok = 0;
    for (const w of list) if (master(stats[key(w)] || emptyStats())) ok++;
    return { total: list.length, ok };
  }

  /* ---------- 出題分層：錯字優先 ----------
   *  tier 0 = ⭐ 相片重點字（未熟）
   *  tier 1 = 錯過嘅字（非重點）
   *  tier 2 = 未學過
   *  tier 3 = 練習中（未熟）
   *  tier 4 = 已熟
   * 層內：重點次數多 → 錯得多 → 啱得少 → 隨機
   */
  function tierOf(w, stats) {
    const s = stats[key(w)] || emptyStats();
    const p = w.priority || 0;
    if (p > 0 && !master(s)) return 0;
    if (s.wrong > 0 && !master(s)) return 1;
    if (!seen(s)) return 2;
    if (s.ok > 0) return 3;
    return 4;
  }
  function buildQueue(words, stats, subj, chapter, onlyWrong, roundLen) {
    let p = activePool(words, subj, chapter);
    if (onlyWrong) p = p.filter((w) => (stats[key(w)] || emptyStats()).wrong > 0);
    if (!p.length) return [];
    const q = [...p].sort((a, b) => {
      const ta = tierOf(a, stats), tb = tierOf(b, stats);
      if (ta !== tb) return ta - tb;
      const pa = a.priority || 0, pb = b.priority || 0;
      if (pa !== pb) return pb - pa;
      const sa = stats[key(a)] || emptyStats(), sb = stats[key(b)] || emptyStats();
      if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong;
      if (sa.ok !== sb.ok) return sa.ok - sb.ok;
      return Math.random() - 0.5;
    });
    return q.slice(0, roundLen || ROUND_LEN);
  }

  /* ---------- 打字接受多種寫法 ---------- */
  function normTerm(s) {
    return s.trim().toLowerCase().replace(/[.,;:!?]+$/, "").replace(/\s+/g, " ");
  }
  /* 接受：原樣 / 甩括號註釋 / 括號入面嘅別名（Rontgen ray (Roentgen ray) 打邊個都得） */
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

  /* ---------- 溫習卡隊（先學後練；已熟抽走） ---------- */
  function buildCardQueue(words, stats, subj, chapter, cardLen) {
    const p = activePool(words, subj, chapter).slice().sort((a, b) => {
      const ta = tierOf(a, stats), tb = tierOf(b, stats);
      if (ta !== tb) return ta - tb;
      const pa = a.priority || 0, pb = b.priority || 0;
      if (pa !== pb) return pb - pa;
      return Math.random() - 0.5;
    });
    const fresh = p.filter((w) => !master(stats[key(w)] || emptyStats()));
    const pool = fresh.length ? fresh : p;
    return pool.slice(0, cardLen || CARD_LEN);
  }

  const API = {
    LS, ROUND_LEN, CARD_LEN, CHAPTER_ORDER,
    key, emptyStats, loadStats, saveStats, normalizeStats,
    seen, master, poolOf, activePool, progress, chapterMeta,
    tierOf, buildQueue, normTerm, acceptForms, buildCardQueue,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.Engine = API;
})(typeof window !== "undefined" ? window : globalThis);
