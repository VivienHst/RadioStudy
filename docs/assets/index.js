import { LEVELS, levelLabel, levelClass, loadJSON, esc, fmtTime, epUrl, known, showError } from "./common.js";

const $ = (s) => document.querySelector(s);

try {
  const [index, words] = await Promise.all([loadJSON("data/index.json"), loadJSON("data/words.json")]);

  // index.json is newest first, so shows come out ordered by their latest episode.
  const shows = new Map();
  for (const e of index) {
    if (!shows.has(e.show)) shows.set(e.show, []);
    shows.get(e.show).push(e);
  }

  const lines = index.reduce((a, e) => a + e.lines, 0);
  $("#stats").innerHTML = [
    [shows.size, "個節目"],
    [index.length, "集"],
    [lines.toLocaleString(), "行字幕"],
    [words.vocab.length, "個單字"],
    [words.grammar.length, "個文法"],
    [known.size(), "個已會"],
  ].map(([v, label]) => `<li><b>${v}</b><span>${label}</span></li>`).join("");

  $("#shows").innerHTML = [...shows].map(([show, eps]) => {
    const withNotes = eps.filter((e) => e.notes).length;
    return `<section class="show">
      <h2 class="section-title"><b lang="ja">${esc(show)}</b><span>${eps.length} 集，${withNotes} 集有筆記</span></h2>
      <ul class="ep-list">${eps.map(card).join("")}</ul>
    </section>`;
  }).join("");
} catch (err) {
  showError($("#shows"), err);
}

function card(e) {
  const lv = e.notes?.levels || {};
  const chips = e.notes
    ? `<div class="chips">${LEVELS.filter((l) => lv[l]).map((l) => `<span class="badge ${levelClass(l)}">${levelLabel(l)} ${lv[l]}</span>`).join("")}
       ${e.notes.grammar ? `<span class="badge">文法 ${e.notes.grammar}</span>` : ""}</div>`
    : `<p class="no-notes">還沒有學習筆記</p>`;
  return `<li><a class="ep-card" href="${epUrl(e.id)}">
    <span class="num">第${e.n}回<small>${esc(e.date)}</small></span>
    <span class="meta">${fmtTime(e.dur)} · ${e.lines} 行字幕</span>
    ${chips}
  </a></li>`;
}
