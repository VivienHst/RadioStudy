import {
  LEVELS, levelLabel, levelClass, KIND_LABEL, loadJSON, esc, fmtTime, biliUrl, epUrl, episodes, store, known,
  canSpeak, speak, ICON, renderJa, parseRefs, noteMarkup, setPressed, showError,
} from "./common.js";

const $ = (s, el = document) => el.querySelector(s);
const id = new URLSearchParams(location.search).get("id");
const prefs = { zh: "show", rt: "show", off: [], hideKnown: false, ...store.get("prefs", {}) };
const NOTE_TABS = [["vocab", "單字"], ["grammar", "文法"], ["idioms", "慣用句"], ["onomatopoeia", "擬聲語"], ["tips", "提醒"]];
const KIND_OF_TAB = { vocab: "v", grammar: "g", idioms: "i", onomatopoeia: "o" };

let ep, eps, vocabById, noteById, lineEls;
const pop = $("#pop");
let popAnchor = null;

init();

async function init() {
  try {
    if (!id || !/^[a-z0-9]+-\d+$/.test(id)) throw new Error("missing or bad ?id=");
    const [index, epData, words] = await Promise.all([
      loadJSON("data/index.json"), loadJSON(`data/ep/${id}.json`), loadJSON("data/words.json"),
    ]);
    ep = epData;
    eps = episodes(index);
    vocabById = new Map(words.vocab.map((v) => [v.id, v]));
    noteById = new Map();
    for (const kind of ["grammar", "idioms", "onomatopoeia"]) {
      for (const it of ep.notes?.[kind] || []) noteById.set(it.id, it);
    }
    renderHead(index);
    renderTranscript();
    renderNotes();
    bindUi();
    applyPrefs();
    if (/^#L\d+$/.test(location.hash)) gotoLine(Number(location.hash.slice(2)), false);
  } catch (err) {
    $("#ep-head").innerHTML = `<p class="eyebrow"><a href="./">← 回到集數列表</a></p>`;
    showError($("#transcript"), err);
  }
}

const vocabLevel = (id) => vocabById.get(id)?.level || "";

function renderHead(index) {
  const sameShow = index.filter((e) => e.show === ep.show);
  const i = sameShow.findIndex((e) => e.id === ep.id);
  const older = sameShow[i + 1];
  const newer = sameShow[i - 1];
  document.title = `${ep.short} 第${ep.n}回 · RiRadio`;
  $("#ep-head").innerHTML = `
    <p class="eyebrow">${esc(ep.date)} 播出 · ${fmtTime(ep.dur)} · ${ep.lines.length} 行字幕</p>
    <h1><span class="ja" lang="ja">${esc(ep.show)}</span> 第${ep.n}回</h1>
    <div class="ep-actions">
      ${ep.bv ? `<a class="btn primary" href="${biliUrl(ep.bv)}" target="_blank" rel="noopener">${ICON.play} 在 Bilibili 收聽</a>` : ""}
      ${older ? `<a class="btn" href="${epUrl(older.id)}">← 第${older.n}回</a>` : ""}
      ${newer ? `<a class="btn" href="${epUrl(newer.id)}">第${newer.n}回 →</a>` : ""}
    </div>`;
}

function renderTranscript() {
  const say = canSpeak();
  $("#transcript").innerHTML = ep.lines.map((l, k) => `
    <div class="line" id="L${k + 1}" data-k="${k}">
      ${ep.bv
        ? `<a class="ts" href="${biliUrl(ep.bv, l.s)}" target="_blank" rel="noopener" title="在 Bilibili 從這裡播放">${fmtTime(l.s)}</a>`
        : `<span class="ts">${fmtTime(l.s)}</span>`}
      <div class="txt">
        <p class="ja" lang="ja">${renderJa(l.ja, l.rb, l.hl, vocabLevel)}</p>
        <p class="zh" lang="zh-Hant">${esc(l.zh)}</p>
      </div>
      ${say ? `<button class="icon-btn say" data-say-line="${k}" aria-label="朗讀這句">${ICON.speak}</button>` : ""}
    </div>`).join("");
  lineEls = [...document.querySelectorAll(".line")];
}

function noteItem(it, tab) {
  const kind = KIND_OF_TAB[tab];
  const isKnown = kind === "v" && known.has(it.id);
  const showReading = it.reading && it.reading !== it.term;
  const speakable = canSpeak() && kind !== "g";
  return `
    <li class="note${isKnown ? " is-known" : ""}" data-line="${it.line || ""}" ${kind === "v" ? `data-id="${esc(it.id)}"` : ""}>
      <div>
        ${kind !== "v" && it.level ? `<span class="badge ${levelClass(it.level)}">${levelLabel(it.level)}</span> ` : ""}
        <span class="term" lang="ja">${esc(it.term)}</span>${showReading ? `<span class="rd" lang="ja">${esc(it.reading)}</span>` : ""}${it.pos ? `<span class="pos">${esc(it.pos)}</span>` : ""}
      </div>
      <div class="mean">${esc(it.meaning)}</div>
      ${it.note ? `<div class="nt">※ ${noteMarkup(it.note)}</div>` : ""}
      <div class="acts">
        ${speakable ? `<button class="icon-btn" data-say-text="${esc(it.term)}" aria-label="朗讀">${ICON.speak}</button>` : ""}
        ${kind === "v" ? `<button class="icon-btn${isKnown ? " on" : ""}" data-known="${esc(it.id)}" aria-pressed="${isKnown}" aria-label="標成已會">${ICON.check}</button>` : ""}
      </div>
    </li>`;
}

function renderNotes() {
  const el = $("#notes");
  const notes = ep.notes;
  if (!notes) {
    el.innerHTML = `<div class="tab-body"><p class="empty">這集還沒有學習筆記。<br>逐字稿裡標示的單字，來自其他集的筆記。</p></div>`;
    return;
  }
  const tabs = NOTE_TABS.filter(([k]) => notes[k]?.length);
  const bodies = tabs.map(([tab]) => {
    if (tab === "tips") {
      return notes.tips.map((t) => `<div class="tips"><h4>${esc(t.title)}</h4><ul>${t.items.map((x) => `<li>${noteMarkup(x)}</li>`).join("")}</ul></div>`).join("");
    }
    const items = [...notes[tab]].sort((a, b) => (a.line || 0) - (b.line || 0));
    if (tab === "vocab" || tab === "grammar") {
      const groups = LEVELS.map((lv) => [lv, items.filter((it) => it.level === lv)]).filter(([, g]) => g.length);
      const head = tab === "vocab"
        ? `<div class="tab-tools"><label class="check"><input type="checkbox" id="hide-known"> 隱藏已會的單字</label></div>`
        : "";
      return head + groups.map(([lv, g]) => `
        <h3 class="lv-head">${levelLabel(lv)} · ${g.length}</h3>
        <ul class="note-list">${g.map((it) => noteItem(it, tab)).join("")}</ul>`).join("");
    }
    return `<ul class="note-list">${items.map((it) => noteItem(it, tab)).join("")}</ul>`;
  });
  el.innerHTML = `
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label], i) => `<button role="tab" data-tab="${k}" aria-selected="${i === 0}">${label}${k !== "tips" ? `<span class="count">${notes[k].length}</span>` : ""}</button>`).join("")}
    </div>
    ${tabs.map(([k], i) => `<div class="tab-body" data-body="${k}"${i ? " hidden" : ""}>${bodies[i]}</div>`).join("")}`;
  const total = (notes.vocab?.length || 0) + (notes.grammar?.length || 0);
  $('#pane-switch [data-pane="notes"]').textContent = `學習筆記 (${total})`;
}

// ---------- popover ----------

function popItem(kind, ref) {
  if (kind === "v") {
    const v = vocabById.get(ref);
    if (!v) return "";
    const total = Object.values(v.occ).reduce((a, l) => a + l.length, 0);
    const epCount = Object.keys(v.occ).length;
    const isKnown = known.has(ref);
    return `<div class="pop-item">
      <div class="head"><span class="badge ${levelClass(v.level)}">${levelLabel(v.level)}</span>
        <span class="term" lang="ja">${esc(v.term)}</span>
        ${v.reading && v.reading !== v.term ? `<span class="rd" lang="ja">${esc(v.reading)}</span>` : ""}
        ${v.pos ? `<span class="kind">${esc(v.pos)}</span>` : ""}</div>
      <div class="mean">${esc(v.meaning)}</div>
      ${v.note ? `<div class="nt">※ ${noteMarkup(v.note)}</div>` : ""}
      <div class="src">筆記出自${v.src.map(eps.label).join("、")} · ${epCount} 集共出現 ${total} 次</div>
      <div class="acts">
        ${canSpeak() ? `<button class="btn" data-say-text="${esc(v.term)}">${ICON.speak} 朗讀</button>` : ""}
        <button class="btn" data-known="${esc(ref)}" aria-pressed="${isKnown}">${ICON.check} ${isKnown ? "已會" : "標成已會"}</button>
        <a class="btn" href="words.html?q=${encodeURIComponent(v.term)}">單字庫</a>
      </div>
    </div>`;
  }
  const it = noteById.get(ref);
  if (!it) return "";
  return `<div class="pop-item">
    <div class="head"><span class="kind">${KIND_LABEL[kind]}</span>${it.level ? `<span class="badge ${levelClass(it.level)}">${levelLabel(it.level)}</span>` : ""}</div>
    <div class="head"><span class="term" lang="ja">${esc(it.term)}</span>${it.reading ? `<span class="rd" lang="ja">${esc(it.reading)}</span>` : ""}</div>
    <div class="mean">${esc(it.meaning)}</div>
    ${it.note ? `<div class="nt">※ ${noteMarkup(it.note)}</div>` : ""}
  </div>`;
}

function openPop(span) {
  const html = parseRefs(span.dataset.refs).map(([kind, ref]) => popItem(kind, ref)).join("");
  if (!html) return;
  pop.innerHTML = html;
  pop.hidden = false;
  popAnchor = span;
  const r = span.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = Math.min(Math.max(12, r.left), vw - pw - 12);
  let top = r.bottom + 8;
  if (top + ph > innerHeight - 12 && r.top - ph - 8 > 12) top = r.top - ph - 8;
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${top + scrollY}px`;
}

function closePop() {
  pop.hidden = true;
  popAnchor = null;
}

// ---------- navigation ----------

function gotoLine(line, smooth = true) {
  const el = document.getElementById(`L${line}`);
  if (!el) return;
  if (el.hidden) {
    $("#q").value = "";
    filterLines("");
  }
  showPane("transcript");
  el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function showPane(pane) {
  $("#ep-grid").dataset.pane = pane;
  document.querySelectorAll("#pane-switch button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === pane)));
}

const squash = (s) => s.replace(/[\s　]/g, "").toLowerCase();
function filterLines(q) {
  const sq = squash(q);
  let count = 0;
  lineEls.forEach((el, k) => {
    const l = ep.lines[k];
    const hit = !sq || squash(l.ja).includes(sq) || squash(l.zh).includes(sq);
    el.hidden = !hit;
    if (hit) count++;
  });
  const info = $("#search-info");
  info.hidden = !sq;
  info.textContent = `找到 ${count} 行`;
}

// ---------- prefs / events ----------

function applyPrefs() {
  const b = document.body.classList;
  b.toggle("zh-tap", prefs.zh === "tap");
  b.toggle("zh-hide", prefs.zh === "hide");
  b.toggle("rt-hover", prefs.rt === "hover");
  b.toggle("rt-hide", prefs.rt === "hide");
  b.toggle("hide-known", !!prefs.hideKnown);
  for (const k of [...LEVELS, "g", "i", "o"]) b.toggle(`off-${k}`, prefs.off.includes(k));
  document.querySelectorAll(".seg[data-pref]").forEach((s) => setPressed(s, prefs[s.dataset.pref]));
  document.querySelectorAll("#hl-chips .chip").forEach((c) => c.setAttribute("aria-pressed", String(!prefs.off.includes(c.dataset.k))));
  const hk = $("#hide-known");
  if (hk) hk.checked = !!prefs.hideKnown;
  store.set("prefs", prefs);
}

function bindUi() {
  document.querySelectorAll(".seg[data-pref]").forEach((seg) =>
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      prefs[seg.dataset.pref] = btn.dataset.v;
      applyPrefs();
    }));

  $("#hl-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const k = chip.dataset.k;
    prefs.off = prefs.off.includes(k) ? prefs.off.filter((x) => x !== k) : [...prefs.off, k];
    applyPrefs();
  });

  $("#q").addEventListener("input", (e) => filterLines(e.target.value.trim()));

  $("#pane-switch").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) showPane(btn.dataset.pane);
  });

  $("#transcript").addEventListener("click", (e) => {
    const hl = e.target.closest(".hl");
    if (hl) {
      e.stopPropagation();
      popAnchor === hl ? closePop() : openPop(hl);
      return;
    }
    const sayBtn = e.target.closest("[data-say-line]");
    if (sayBtn) return speak(ep.lines[Number(sayBtn.dataset.sayLine)].ja);
    const zh = e.target.closest(".zh");
    if (zh && prefs.zh === "tap") return zh.classList.toggle("shown");
    const ja = e.target.closest(".ja");
    if (ja && prefs.rt === "hover") ja.closest(".line").classList.toggle("show-rt");
  });
  $("#transcript").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("hl")) {
      e.preventDefault();
      openPop(e.target);
    }
  });

  $("#notes").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      document.querySelectorAll("#notes [data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      document.querySelectorAll("#notes [data-body]").forEach((b) => (b.hidden = b.dataset.body !== tab.dataset.tab));
      return;
    }
    if (e.target.closest("button, input, label, a")) return;
    const note = e.target.closest(".note");
    if (note?.dataset.line) gotoLine(Number(note.dataset.line));
  });
  $("#notes").addEventListener("change", (e) => {
    if (e.target.id === "hide-known") {
      prefs.hideKnown = e.target.checked;
      applyPrefs();
    }
  });

  // shared buttons inside notes + popover
  document.addEventListener("click", (e) => {
    const say = e.target.closest("[data-say-text]");
    if (say) return speak(say.dataset.sayText);
    const kn = e.target.closest("[data-known]");
    if (kn) return known.toggle(kn.dataset.known);
    if (!pop.hidden && !e.target.closest("#pop")) closePop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePop();
  });
  addEventListener("resize", closePop);
  addEventListener("hashchange", () => {
    if (/^#L\d+$/.test(location.hash)) gotoLine(Number(location.hash.slice(2)));
  });

  known.onChange((id, isKnown) => {
    document.querySelectorAll(".hl[data-v]").forEach((s) => {
      if (s.dataset.v === id) s.classList.toggle("known", isKnown);
    });
    document.querySelectorAll(".note[data-id]").forEach((li) => {
      if (li.dataset.id !== id) return;
      li.classList.toggle("is-known", isKnown);
      const btn = li.querySelector("[data-known]");
      btn.classList.toggle("on", isKnown);
      btn.setAttribute("aria-pressed", String(isKnown));
    });
    if (popAnchor) openPop(popAnchor);
  });
}
