import {
  LEVELS, levelLabel, levelClass, loadJSON, esc, fmtTime, epUrl, episodes, store, known, canSpeak, speak, ICON,
  markForm, noteMarkup, showError,
} from "./common.js";

const $ = (s) => document.querySelector(s);
const TABS = ["vocab", "grammar", "idioms", "onomatopoeia", "cards"];
const saved = store.get("wordsPrefs", {});
const state = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "vocab",
  q: new URLSearchParams(location.search).get("q") || "",
  levels: new Set(saved.levels || LEVELS),
  hideKnown: !!saved.hideKnown,
  sort: saved.sort || "level",
};
let data;
let eps;
// declared before the top-level await below, which renders the first list
const PAGE = 200;
let listState = null;
const moreObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && showMore(), { rootMargin: "800px" })
  : null;
let deck = [];
let deckPos = 0;
let flipped = false;

const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const norm = (s) => toHira(String(s || "").toLowerCase().replace(/[\s　～~]/g, ""));
const total = (v) => Object.values(v.occ).reduce((a, l) => a + l.length, 0);
const lvIndex = (lv) => (LEVELS.indexOf(lv) + 1 || 99);

try {
  const [words, index] = await Promise.all([loadJSON("data/words.json"), loadJSON("data/index.json")]);
  data = words;
  eps = episodes(index);
  $("#summary").textContent = `${data.vocab.length} 個單字 · ${data.grammar.length} 個文法 · ${data.idioms.length} 個慣用句 · ${data.onomatopoeia.length} 個擬聲擬態語`;
  $("#q").value = state.q;
  $("#hide-known").checked = state.hideKnown;
  $("#sort").value = state.sort;
  bind();
  render();
} catch (err) {
  showError($("#list"), err);
}

function matches(it) {
  if (!state.q) return true;
  const q = norm(state.q);
  return [it.term, it.reading, it.meaning, it.note].some((f) => norm(f).includes(q));
}
function levelOk(it) {
  return !it.level || state.levels.has(it.level);
}

function filteredVocab() {
  const list = data.vocab.filter((v) => levelOk(v) && matches(v));
  const byKana = (a, b) => (a.reading || a.term).localeCompare(b.reading || b.term, "ja");
  if (state.sort === "freq") list.sort((a, b) => total(b) - total(a) || byKana(a, b));
  else if (state.sort === "kana") list.sort(byKana);
  else list.sort((a, b) => lvIndex(a.level) - lvIndex(b.level) || byKana(a, b));
  return list;
}

function example(ex) {
  if (!ex) return "";
  return `<div class="ex">
    <p class="ja" lang="ja">${markForm(ex.ja, ex.form)}<a class="ex-link" href="${epUrl(ex.ep, ex.line)}">${esc(eps.label(ex.ep))} ${fmtTime(ex.s || 0)}</a></p>
    <p class="zh" lang="zh-Hant">${esc(ex.zh)}</p>
  </div>`;
}

function vocabItem(v) {
  const isKnown = known.has(v.id);
  const occ = Object.entries(v.occ)
    .map(([id, lines]) => `<a href="${epUrl(id, lines[0])}" title="${esc(eps.label(id))}">${esc(eps.short(id))}${lines.length > 1 ? ` ×${lines.length}` : ""}</a>`)
    .join("");
  return `<li class="word${isKnown ? " is-known" : ""}" data-id="${esc(v.id)}">
    <div class="head">
      <span class="badge ${levelClass(v.level)}">${levelLabel(v.level)}</span>
      <span class="term" lang="ja">${esc(v.term)}</span>
      ${v.reading && v.reading !== v.term ? `<span class="rd" lang="ja">${esc(v.reading)}</span>` : ""}
      ${v.pos ? `<span class="pos">${esc(v.pos)}</span>` : ""}
    </div>
    <div class="mean">${esc(v.meaning)}</div>
    ${v.note ? `<div class="nt">※ ${noteMarkup(v.note)}</div>` : ""}
    <div class="acts">
      ${canSpeak() ? `<button class="icon-btn" data-say-text="${esc(v.term)}" aria-label="朗讀">${ICON.speak}</button>` : ""}
      <button class="icon-btn${isKnown ? " on" : ""}" data-known="${esc(v.id)}" aria-pressed="${isKnown}" aria-label="標成已會">${ICON.check}</button>
    </div>
    ${example(v.ex)}
    <div class="occ"><span>出現 ${total(v)} 次</span>${occ}</div>
  </li>`;
}

function noteCard(it) {
  return `<li class="word">
    <div class="head">
      ${it.level ? `<span class="badge ${levelClass(it.level)}">${levelLabel(it.level)}</span>` : ""}
      <span class="term" lang="ja">${esc(it.term)}</span>
      ${it.reading && it.reading !== it.term ? `<span class="rd" lang="ja">${esc(it.reading)}</span>` : ""}
    </div>
    <div class="mean">${esc(it.meaning)}</div>
    ${it.note ? `<div class="nt">※ ${noteMarkup(it.note)}</div>` : ""}
    ${example(it.ex)}
    ${it.more ? `<div class="occ"><span>其他集也有</span>${it.more.map((m) => `<a href="${epUrl(m.ep, m.line)}" title="${esc(eps.label(m.ep))}">${esc(eps.short(m.ep))}</a>`).join("")}</div>` : ""}
  </li>`;
}

function render() {
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  document.querySelectorAll("#lv-chips .chip").forEach((c) => c.setAttribute("aria-pressed", String(state.levels.has(c.dataset.lv))));
  document.body.classList.toggle("hide-known", state.hideKnown && state.tab === "vocab");
  const hasLevels = ["vocab", "grammar", "cards"].includes(state.tab);
  $("#lv-chips").hidden = !hasLevels;
  $("#hk-wrap").hidden = state.tab !== "vocab";
  $("#sort").hidden = state.tab !== "vocab";
  store.set("wordsPrefs", { levels: [...state.levels], hideKnown: state.hideKnown, sort: state.sort });

  if (state.tab === "cards") return renderCards();
  if (state.tab === "vocab") {
    const all = filteredVocab();
    // known words stay in the DOM (CSS hides them) so toggling "已會" never reflows the list
    const shown = state.hideKnown ? all.filter((v) => !known.has(v.id)) : all;
    $("#count").textContent = `${shown.length} 個單字${state.hideKnown ? `（另有 ${all.length - shown.length} 個已會）` : ""} · 已會 ${known.size()}`;
    showList(all, vocabItem);
  } else {
    const items = data[state.tab].filter((it) => levelOk(it) && matches(it));
    if (state.tab === "grammar") items.sort((a, b) => lvIndex(a.level) - lvIndex(b.level));
    $("#count").textContent = `${items.length} 筆`;
    showList(items, noteCard);
  }
}

// Long lists render PAGE items at a time; the next batch loads when the "more" button scrolls into view.
function showList(items, toHtml) {
  moreObserver?.disconnect();
  if (!items.length) {
    listState = null;
    $("#list").innerHTML = `<p class="empty">沒有符合的項目。</p>`;
    return;
  }
  $("#list").innerHTML = `<ul class="word-list"></ul><div class="more-wrap"></div>`;
  listState = { items, toHtml, shown: 0 };
  showMore();
}

function showMore() {
  if (!listState || listState.shown >= listState.items.length) return;
  const { items, toHtml } = listState;
  const next = items.slice(listState.shown, listState.shown + PAGE);
  $("#list .word-list").insertAdjacentHTML("beforeend", next.map(toHtml).join(""));
  listState.shown += next.length;
  const left = items.length - listState.shown;
  const wrap = $("#list .more-wrap");
  wrap.innerHTML = left > 0 ? `<button class="btn" data-more>再顯示 ${Math.min(PAGE, left)} 個（還有 ${left} 個）</button>` : "";
  moreObserver?.disconnect();
  if (left > 0) moreObserver?.observe(wrap.firstElementChild);
}

// ---------- flashcards ----------

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newDeck() {
  deck = shuffle(filteredVocab().filter((v) => !known.has(v.id)));
  deckPos = 0;
  flipped = false;
}

function renderCards() {
  if (!deck.length && deckPos === 0) newDeck();
  $("#count").textContent = "";
  if (!deck.length) {
    $("#list").innerHTML = `<div class="fc"><p class="empty">沒有要複習的單字。可以多選幾個級數，或在單字列表取消一些「已會」。</p></div>`;
    return;
  }
  if (deckPos >= deck.length) {
    $("#list").innerHTML = `<div class="fc"><div class="fc-card"><div class="term">お疲れ様！</div>
      <p class="hint">這輪 ${deck.length} 張複習完了，已會的單字共 ${known.size()} 個。</p>
      <button class="btn primary" data-fc="restart">再來一輪</button></div></div>`;
    return;
  }
  const v = deck[deckPos];
  const back = flipped
    ? `${v.reading && v.reading !== v.term ? `<div class="rd" lang="ja">${esc(v.reading)}</div>` : ""}
       <div class="mean">${esc(v.meaning)}</div>
       ${v.note ? `<div class="hint">※ ${noteMarkup(v.note)}</div>` : ""}
       ${v.ex ? `<div class="ex"><p lang="ja">${markForm(v.ex.ja, v.ex.form)}</p><p class="zh" lang="zh-Hant">${esc(v.ex.zh)}</p></div>` : ""}`
    : `<p class="hint">點卡片或按空白鍵看答案</p>`;
  $("#list").innerHTML = `<div class="fc">
    <div class="fc-progress"><span>第 ${deckPos + 1} / ${deck.length} 張</span><span>已會 ${known.size()} 個</span></div>
    <div class="fc-bar"><i style="width:${(deckPos / deck.length) * 100}%"></i></div>
    <div class="fc-card" data-fc="flip" role="button" tabindex="0" aria-label="翻面">
      <span class="badge ${levelClass(v.level)}">${levelLabel(v.level)}</span>
      <div class="term" lang="ja">${esc(v.term)}</div>
      ${back}
    </div>
    <div class="fc-btns">
      <button class="btn" data-fc="again">還不熟 <kbd>1</kbd></button>
      <button class="btn primary" data-fc="got">記住了 <kbd>2</kbd></button>
    </div>
    ${canSpeak() ? `<p style="text-align:center"><button class="btn" data-say-text="${esc(v.term)}">${ICON.speak} 朗讀</button></p>` : ""}
  </div>`;
}

function fcAction(action) {
  if (action !== "restart" && deckPos >= deck.length) return;
  if (action === "flip") flipped = !flipped;
  else if (action === "again") { deckPos++; flipped = false; }
  else if (action === "got") {
    const v = deck[deckPos];
    if (!known.has(v.id)) known.toggle(v.id);
    deckPos++;
    flipped = false;
  } else if (action === "restart") newDeck();
  renderCards();
}

// ---------- events ----------

function bind() {
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.tab = b.dataset.tab;
    history.replaceState(null, "", `${location.pathname}${location.search}#${state.tab}`);
    if (state.tab === "cards") newDeck();
    render();
  });
  addEventListener("hashchange", () => {
    const tab = location.hash.slice(1);
    if (!TABS.includes(tab) || tab === state.tab) return;
    state.tab = tab;
    if (tab === "cards") newDeck();
    render();
  });
  let typing;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.q = e.target.value.trim();
      const url = new URL(location.href);
      state.q ? url.searchParams.set("q", state.q) : url.searchParams.delete("q");
      history.replaceState(null, "", url);
      if (state.tab === "cards") newDeck();
      render();
    }, 200);
  });
  $("#lv-chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    state.levels.has(c.dataset.lv) ? state.levels.delete(c.dataset.lv) : state.levels.add(c.dataset.lv);
    if (state.tab === "cards") newDeck();
    render();
  });
  $("#hide-known").addEventListener("change", (e) => {
    state.hideKnown = e.target.checked;
    render();
  });
  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });
  document.addEventListener("click", (e) => {
    const say = e.target.closest("[data-say-text]");
    if (say) return speak(say.dataset.sayText);
    const kn = e.target.closest("[data-known]");
    if (kn) return known.toggle(kn.dataset.known);
    const fc = e.target.closest("[data-fc]");
    if (fc) return fcAction(fc.dataset.fc);
    if (e.target.closest("[data-more]")) showMore();
  });
  document.addEventListener("keydown", (e) => {
    if (state.tab !== "cards" || e.target.matches("input, select, textarea")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); fcAction("flip"); }
    else if (e.key === "1" || e.key === "ArrowRight") fcAction("again");
    else if (e.key === "2") fcAction("got");
  });
  known.onChange((id, isKnown) => {
    if (state.tab !== "vocab") return;
    const li = [...document.querySelectorAll(".word[data-id]")].find((x) => x.dataset.id === id);
    if (li) {
      li.classList.toggle("is-known", isKnown);
      const btn = li.querySelector("[data-known]");
      btn.classList.toggle("on", isKnown);
      btn.setAttribute("aria-pressed", String(isKnown));
    }
    const items = filteredVocab();
    const shown = state.hideKnown ? items.filter((v) => !known.has(v.id)).length : items.length;
    $("#count").textContent = `${shown} 個單字${state.hideKnown ? `（另有 ${items.length - shown} 個已會）` : ""} · 已會 ${known.size()}`;
  });
}
