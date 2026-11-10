// Shared helpers for all pages.

export const LEVELS = ["N1", "N2", "N3", "N4-5"];
export const levelLabel = (lv) => (lv === "N4-5" ? "N4・N5" : lv || "");
export const levelClass = (lv) => (lv ? "lv-" + lv.slice(0, 2).toLowerCase() : "");
export const KIND_LABEL = { v: "單字", g: "文法", i: "慣用句", o: "擬聲擬態語" };

export async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function fmtTime(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

export const biliUrl = (bv, sec) => `https://www.bilibili.com/video/${bv}${sec ? `?t=${Math.floor(sec)}` : ""}`;
// Episode ids are "<show id>-<number>", e.g. "rikosaka-128".
export const epUrl = (id, line) => `ep.html?id=${encodeURIComponent(id)}${line ? `#L${line}` : ""}`;

// Look up episodes by id; the show name is only worth printing once the site has more than one show.
export function episodes(index) {
  const byId = new Map(index.map((e) => [e.id, e]));
  const multi = new Set(index.map((e) => e.show)).size > 1;
  return {
    get: (id) => byId.get(id),
    label: (id) => {
      const e = byId.get(id);
      return e ? `${multi ? `${e.short} ` : ""}第${e.n}回` : id;
    },
    short: (id) => {
      const e = byId.get(id);
      return e ? `${multi ? e.short : ""}#${e.n}` : id;
    },
  };
}

// ---------- storage (per-browser conveniences; must never break the page) ----------
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("radiostudy." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("radiostudy." + key, JSON.stringify(value));
    } catch {
      /* private mode / blocked storage */
    }
  },
};

const knownSet = new Set(store.get("known", []));
const knownListeners = new Set();
export const known = {
  has: (id) => knownSet.has(id),
  size: () => knownSet.size,
  toggle(id) {
    knownSet.has(id) ? knownSet.delete(id) : knownSet.add(id);
    store.set("known", [...knownSet]);
    knownListeners.forEach((fn) => fn(id, knownSet.has(id)));
    return knownSet.has(id);
  },
  onChange: (fn) => knownListeners.add(fn),
};

// ---------- text to speech ----------
let jaVoice = null;
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  const ja = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ja"));
  jaVoice = ja.find((v) => /Google|Nanami|Kyoko|Otoya|Keita/.test(v.name)) || ja[0] || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}
export const canSpeak = () => "speechSynthesis" in window;
export function speak(text) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[\s　]+/g, "、"));
  u.lang = "ja-JP";
  if (jaVoice) u.voice = jaVoice;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

// ---------- icons ----------
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  speak: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  ext: svg('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  play: svg('<path d="M7 4v16l13-8z"/>'),
};

// ---------- Japanese rendering ----------

/**
 * Render a subtitle line: furigana ranges `rb` [[a, b, reading]] and highlight ranges
 * `hl` [[a, b, kind, ref]] are code-point offsets into `text`. A ruby unit is never split;
 * runs of units sharing the same highlights become one <span class="hl">.
 * `vocabLevel(ref)` returns the JLPT level for a vocab id.
 */
export function renderJa(text, rb = [], hl = [], vocabLevel = () => "") {
  const chars = Array.from(text);
  const rubyAt = new Map(rb.map(([a, b, r]) => [a, [b, r]]));
  const units = [];
  for (let i = 0; i < chars.length; ) {
    const r = rubyAt.get(i);
    if (r && r[0] > i) {
      units.push({ a: i, b: r[0], t: chars.slice(i, r[0]).join(""), rt: r[1] });
      i = r[0];
    } else {
      units.push({ a: i, b: i + 1, t: chars[i] });
      i++;
    }
  }
  for (const u of units) {
    u.marks = hl.filter(([a, b]) => a < u.b && u.a < b);
    u.key = u.marks.map((m) => m[3]).join("\u0001");
  }
  let html = "";
  for (let i = 0; i < units.length; ) {
    let j = i;
    while (j < units.length && units[j].key === units[i].key) j++;
    const inner = units
      .slice(i, j)
      .map((u) => (u.rt ? `<ruby>${esc(u.t)}<rt>${esc(u.rt)}</rt></ruby>` : esc(u.t)))
      .join("");
    const marks = units[i].marks;
    if (marks.length) {
      const cls = new Set(["hl"]);
      const v = marks.find((m) => m[2] === "v");
      for (const m of marks) cls.add(m[2]);
      if (v) {
        cls.add(levelClass(vocabLevel(v[3])));
        if (known.has(v[3])) cls.add("known");
      }
      const refs = marks.map((m) => `${m[2]}\u0002${m[3]}`).join("\u0001");
      html += `<span class="${[...cls].join(" ")}" data-refs="${esc(refs)}"${v ? ` data-v="${esc(v[3])}"` : ""} tabindex="0" role="button">${inner}</span>`;
    } else {
      html += inner;
    }
    i = j;
  }
  return html;
}

export const parseRefs = (s) => s.split("\u0001").map((x) => x.split("\u0002"));

/** Escape `text` and bold the first occurrence of `form` (spaces inside the form are optional). */
export function markForm(text, form) {
  if (!form) return esc(text);
  const chars = Array.from(form.replace(/[\s　]/g, ""));
  const re = new RegExp(chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s　]*"));
  const m = re.exec(text);
  if (!m) return esc(text);
  return esc(text.slice(0, m.index)) + `<mark class="form">${esc(m[0])}</mark>` + esc(text.slice(m.index + m[0].length));
}

/** Tiny markup used in notes text: **bold**, `code`, <br>. Everything else is escaped. */
export function noteMarkup(s) {
  return esc(s)
    .replace(/&lt;br&gt;/g, "<br>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function setPressed(container, value) {
  container.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === value)));
}

export function showError(el, err) {
  console.error(err);
  el.innerHTML = `<p class="empty">資料載入失敗。如果是直接開啟 HTML 檔，請改用本機伺服器（<code>python -m http.server -d docs</code>）。</p>`;
}
