"""Build the static site data (docs/data/) from subtitle folders and study notes.

Reads, for every episode folder under --src (default ../SubtitleExtension/temp):
  subs.ja.srt, subs.zh-hant.srt, source.txt
and, if present, notes/<show id>/<number>.json (the JLPT study notes, kept in this repo).
Only shows listed in tools/shows.json are published; other folders are skipped.

Writes:
  docs/data/index.json      episode list (newest first)
  docs/data/ep/<id>.json    one episode (id = <show id>-<number>): lines (ja, zh, furigana, highlights) + notes
  docs/data/words.json      cross-episode word bank, grammar, idioms, onomatopoeia

Requires: pip install fugashi unidic-lite
"""
import argparse
import json
import re
import sys
from pathlib import Path

import fugashi

ROOT = Path(__file__).resolve().parent.parent
FOLDER_RE = re.compile(r"^(\d{2})(\d{2})(\d{2})(.+?)第(\d+)回")
KANJI = r"㐀-䶿一-鿿々ヶ"
KANA = r"ぁ-ゟ゠-ヿー"
HAS_KANJI = re.compile(f"[{KANJI}]")
KINDS = ("vocab", "grammar", "idioms", "onomatopoeia")
KIND_CODE = {"vocab": "v", "grammar": "g", "idioms": "i", "onomatopoeia": "o"}

tagger = fugashi.Tagger()


def kata2hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def strip_tilde(term):
    return term.replace("～", "").replace("~", "").strip()


# ---------- input parsing ----------

def parse_srt(path):
    text = path.read_text(encoding="utf-8-sig").strip()
    out = []
    for block in re.split(r"\r?\n\s*\r?\n", text):
        ls = block.splitlines()
        m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", ls[1])
        g = list(map(int, m.groups()))
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        out.append({"i": int(ls[0]), "s": round(start, 2), "e": round(end, 2), "text": " ".join(ls[2:]).strip()})
    return out


def parse_source(path, fallback_dur):
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    bv = re.search(r"BV[0-9A-Za-z]{10}", text)
    dur = re.search(r"長度：\s*([\d.]+)\s*秒", text)
    if dur:
        seconds = float(dur.group(1))
    else:
        mmss = re.search(r"長度：\s*(\d+):(\d+)", text)
        seconds = int(mmss.group(1)) * 60 + int(mmss.group(2)) if mmss else fallback_dur
    return (bv.group(0) if bv else None), round(seconds, 1)


# ---------- furigana ----------

def align(surface, reading):
    """Split a token's reading over its kanji runs: 落ち着き/おちつき -> [(0,1,お),(2,3,つ)]."""
    runs = re.findall(f"[{KANA}]+|[^{KANA}]+", surface)
    pattern = "".join(
        "(" + re.escape(kata2hira(r)) + ")" if re.fullmatch(f"[{KANA}]+", r) else "(.+?)" for r in runs
    )
    m = re.fullmatch(pattern, reading)
    if not m:
        return [(0, len(surface), reading)] if HAS_KANJI.search(surface) else []
    out, pos = [], 0
    for r, g in zip(runs, m.groups()):
        if HAS_KANJI.search(r) and not re.fullmatch(f"[{KANA}]+", r):
            out.append((pos, pos + len(r), g))
        pos += len(r)
    return out


def tokenize(text):
    """Return tokens with char offsets, reading (hiragana) and lookup keys."""
    tokens, pos = [], 0
    for w in tagger(text):
        start = text.find(w.surface, pos)
        if start < 0:
            continue
        end = start + len(w.surface)
        pos = end
        f = w.feature
        kana = getattr(f, "kana", None)
        lemma = (getattr(f, "lemma", None) or "").split("-")[0]
        # ordered (surface first) so the same token always matches the same vocab entry
        keys = [k for k in dict.fromkeys((w.surface, lemma, getattr(f, "orthBase", None) or "")) if k]
        tokens.append({"a": start, "b": end, "surface": w.surface,
                       "reading": kata2hira(kana) if kana and kana != "*" else None, "keys": keys})
    return tokens


def overlaps(a, b, ranges):
    return any(a < rb and ra < b for ra, rb, *_ in ranges)


def parse_override(term, value):
    """value is a plain reading (とうだいもとくらし) or bracket notation (灯台[とうだい]下[もと]暗[くら]し)."""
    if "[" not in value:
        return term, align(term, value)
    plain, ruby = "", []
    for m in re.finditer(r"([^\[\]]+?)\[([^\]]+)\]|([^\[\]])", value):
        if m.group(3):
            plain += m.group(3)
        else:
            ruby.append((len(plain), len(plain) + len(m.group(1)), m.group(2)))
            plain += m.group(1)
    if plain != term:
        sys.exit(f"readings.json: '{value}' does not spell '{term}'")
    return term, ruby


def furigana(text, tokens, overrides):
    """overrides["manual"]: [(term, [(a, b, reading)])] applied wherever the term appears verbatim.
    overrides["notes"]: {term: [(a, b, reading)]} applied only where the term starts and ends on token
    boundaries (longest first), so 数/かず does not leak into 人数 and 油/あぶら not into 醤油."""
    ends = {t["b"] for t in tokens}
    ruby = []

    def add(a, b, parts):
        if overlaps(a, b, ruby):
            return False
        ruby.extend((a + x, a + y, r) for x, y, r in parts)
        return True

    for term, parts in overrides["manual"]:
        for m in re.finditer(re.escape(term), text):
            add(m.start(), m.end(), parts)
    for t in tokens:
        for n in overrides["lens"]:
            parts = overrides["notes"].get(text[t["a"]:t["a"] + n])
            if parts is not None and t["a"] + n in ends and add(t["a"], t["a"] + n, parts):
                break
    prev = None
    for t in tokens:
        if t["reading"] and HAS_KANJI.search(t["surface"]) and not overlaps(t["a"], t["b"], ruby):
            # 11日 / 20日: unidic reads 日 as か, wrong for most numbers
            if not (t["surface"] == "日" and prev and prev["surface"].isdigit()):
                ruby += [(t["a"] + a, t["a"] + b, r) for a, b, r in align(t["surface"], t["reading"])]
        prev = t
    return sorted(ruby)


# ---------- highlights ----------

def find_span(lines, first, last, form):
    """Locate `form` inside lines[first..last] (0-based, joined); return per-line (idx, a, b) ranges."""
    if not form:
        return []
    parts, offsets, acc = [], [], 0
    for k in range(first, last + 1):
        offsets.append(acc)
        parts.append(lines[k]["ja"])
        acc += len(lines[k]["ja"])
    joined = "".join(parts)
    pat = r"[\s　]*".join(re.escape(c) for c in re.sub(r"[\s　]", "", form))
    m = re.search(pat, joined)
    if not m:
        return []
    out = []
    for n, k in enumerate(range(first, last + 1)):
        lo, hi = offsets[n], offsets[n] + len(parts[n])
        a, b = max(m.start(), lo), min(m.end(), hi)
        if a < b:
            out.append((k, a - lo, b - lo))
    return out


def merge_ranges(ranges):
    """Union overlapping ranges that point at the same item: 喋 (token) + 喋って (note form) -> 喋って."""
    merged = []
    for a, b, kind, ref in sorted(set(ranges), key=lambda x: (x[3], x[0])):
        if merged and merged[-1][3] == ref and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b, kind, ref])
    return sorted(merged)


def vocab_id(item):
    return f"{item['term']}|{item.get('reading', '')}"


def match_vocab(text, tokens, vocab_index):
    """Find occurrences of known vocab in one line: token lemma match + verbatim substring."""
    hits = []
    for t in tokens:
        for key in t["keys"]:
            vid = vocab_index["by_key"].get(key)
            if vid:
                hits.append((t["a"], t["b"], vid))
                break
    for i in range(len(text)):
        for n in vocab_index["lens"]:
            if i + n > len(text):
                continue
            for vid in vocab_index["substr"].get(text[i:i + n], ()):
                if not any(a <= i and i + n <= b and v == vid for a, b, v in hits):
                    hits.append((i, i + n, vid))
    return hits


def build_vocab_index(all_notes):
    by_key, substr = {}, {}
    for notes in all_notes.values():
        for item in notes.get("vocab", []):
            vid = vocab_id(item)
            term = strip_tilde(item["term"])
            by_key.setdefault(term, vid)
            # substring match for kanji words and longer kana words; short kana would hit inside other words
            if HAS_KANJI.search(term) and len(term) >= 2 or len(term) >= 4:
                if vid not in substr.setdefault(term, []):
                    substr[term].append(vid)
    return {"by_key": by_key, "substr": substr, "lens": sorted({len(t) for t in substr}, reverse=True)}


# ---------- main ----------

def load_episode(folder, notes_dir, shows):
    m = FOLDER_RE.match(folder.name)
    if not m:
        return None
    yy, mm, dd, show, num = m.groups()
    show = show.strip()
    if show not in shows:
        print(f"skip {folder.name}: show '{show}' is not in tools/shows.json", file=sys.stderr)
        return None
    sid, n = shows[show]["id"], int(num)
    ja_p, zh_p = folder / "subs.ja.srt", folder / "subs.zh-hant.srt"
    if not (ja_p.exists() and zh_p.exists()):
        print(f"skip {folder.name}: missing subs.ja.srt / subs.zh-hant.srt", file=sys.stderr)
        return None
    ja, zh = parse_srt(ja_p), parse_srt(zh_p)
    if len(ja) != len(zh) or any(a["i"] != n + 1 for n, a in enumerate(ja)):
        print(f"skip {folder.name}: ja/zh line count or numbering mismatch", file=sys.stderr)
        return None
    bv, dur = parse_source(folder / "source.txt", ja[-1]["e"])
    notes_path = notes_dir / sid / f"{n}.json"
    notes = json.loads(notes_path.read_text(encoding="utf-8")) if notes_path.exists() else None
    return {
        "id": f"{sid}-{n}", "n": n, "show": show, "short": shows[show].get("short", show),
        "date": f"20{yy}-{mm}-{dd}", "bv": bv, "dur": dur,
        "lines": [{"s": a["s"], "e": a["e"], "ja": a["text"], "zh": b["text"]} for a, b in zip(ja, zh)],
        "notes": notes,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=ROOT.parent / "SubtitleExtension" / "temp")
    ap.add_argument("--notes", type=Path, default=ROOT / "notes")
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "data")
    args = ap.parse_args()

    shows = json.loads((ROOT / "tools" / "shows.json").read_text(encoding="utf-8"))
    for name, meta in shows.items():
        if not re.fullmatch(r"[a-z0-9]+", meta.get("id", "")):
            sys.exit(f"shows.json: '{name}' needs an id of lowercase letters/digits")
    episodes = [e for e in (load_episode(f, args.notes, shows) for f in sorted(args.src.iterdir()) if f.is_dir()) if e]
    if not episodes:
        sys.exit(f"no episodes found under {args.src}")
    episodes.sort(key=lambda e: (e["date"], e["n"]))
    seen = {}
    for e in episodes:
        if e["id"] in seen:
            sys.exit(f"two folders for episode {e['id']}: {seen[e['id']]} and {e['date']}")
        seen[e["id"]] = e["date"]
    order = {e["id"]: k for k, e in enumerate(episodes)}
    all_notes = {e["id"]: e["notes"] for e in episodes if e["notes"]}
    vocab_index = build_vocab_index(all_notes)
    manual = json.loads((ROOT / "tools" / "readings.json").read_text(encoding="utf-8"))
    note_readings = [
        (strip_tilde(it["term"]), it["reading"])
        for notes in all_notes.values() for kind in ("vocab", "idioms") for it in notes.get(kind, [])
        if it.get("reading") and HAS_KANJI.search(it["term"]) and re.fullmatch(f"[{KANA}]+", it["reading"])
    ]
    # manual entries win over note readings and apply anywhere (longest first); note readings only on whole
    # tokens, and the earliest episode wins when two notes read the same spelling differently
    note_ruby = {}
    for t, v in note_readings:
        if t not in manual and t not in note_ruby:
            note_ruby[t] = parse_override(t, v)[1]
    overrides = {
        "manual": [parse_override(t, v) for t, v in sorted(manual.items(), key=lambda x: -len(x[0]))],
        "notes": note_ruby,
        "lens": sorted({len(t) for t in note_ruby}, reverse=True),
    }

    words = {k: {} for k in KINDS}
    warnings = []
    ep_dir = args.out / "ep"
    ep_dir.mkdir(parents=True, exist_ok=True)
    for stale in ep_dir.glob("*.json"):
        if stale.stem not in order:
            stale.unlink()

    for ep in episodes:
        lines = ep["lines"]
        hl = [[] for _ in lines]
        for k, line in enumerate(lines):
            tokens = tokenize(line["ja"])
            line["rb"] = [list(r) for r in furigana(line["ja"], tokens, overrides)]
            for a, b, vid in match_vocab(line["ja"], tokens, vocab_index):
                hl[k].append((a, b, "v", vid))
                occ = words["vocab"].setdefault(vid, {"occ": {}})["occ"].setdefault(ep["id"], [])
                if k + 1 not in occ:
                    occ.append(k + 1)

        notes = ep["notes"] or {}
        out_notes = {}
        for kind in KINDS:
            items = []
            for idx, it in enumerate(notes.get(kind, [])):
                it = dict(it)
                if kind in ("vocab", "grammar") and it.get("level") not in ("N1", "N2", "N3", "N4-5"):
                    warnings.append(f"{ep['id']} {kind} {it['term']}: level {it.get('level')!r} is not N1/N2/N3/N4-5, the site will hide it")
                first = it.get("line")
                if not first or first > len(lines):
                    warnings.append(f"{ep['id']} {kind} {it['term']}: bad line {first}")
                    items.append(it)
                    continue
                last = it.get("to", first)
                ref = vocab_id(it) if kind == "vocab" else f"{ep['id']}:{KIND_CODE[kind]}{idx}"
                it["id"] = ref
                spans = find_span(lines, first - 1, last - 1, it.get("form", ""))
                if it.get("form") and not spans:
                    warnings.append(f"{ep['id']} {kind} {it['term']}: form '{it['form']}' not on line {first}")
                for k, a, b in spans:
                    if not any(x[0] <= a and b <= x[1] and x[3] == ref for x in hl[k]):
                        hl[k].append((a, b, KIND_CODE[kind], ref))
                example = {
                    "ep": ep["id"], "line": first, "to": last, "s": lines[first - 1]["s"], "form": it.get("form", ""),
                    "ja": " ".join(l["ja"] for l in lines[first - 1:last]),
                    "zh": " ".join(l["zh"] for l in lines[first - 1:last]),
                }
                if kind == "vocab":
                    entry = words["vocab"].setdefault(ref, {"occ": {}})
                    occ = entry["occ"].setdefault(ep["id"], [])
                    if first not in occ:  # example line may hold a misheard form (責めた for 攻めた)
                        occ.append(first)
                        occ.sort()
                    if "term" not in entry:
                        entry.update({key: it[key] for key in ("term", "reading", "pos", "level", "meaning", "note") if key in it})
                        entry.update({"id": ref, "ex": example, "src": []})
                    entry["src"].append(ep["id"])
                else:
                    # the same pattern noted in several episodes becomes one card; later ones are extra examples
                    key = re.sub(r"[～~（）()\s]", "", it["term"])
                    if key in words[kind]:
                        words[kind][key].setdefault("more", []).append({"ep": ep["id"], "line": first})
                    else:
                        words[kind][key] = {**{k: it[k] for k in ("term", "reading", "level", "meaning", "note") if k in it},
                                            "id": ref, "ex": example}
                items.append(it)
            out_notes[kind] = items
        out_notes["tips"] = notes.get("tips", [])

        for k, line in enumerate(lines):
            line["hl"] = merge_ranges(hl[k])
        ep_out = {key: ep[key] for key in ("id", "n", "show", "short", "date", "bv", "dur", "lines")}
        ep_out["notes"] = out_notes if ep["notes"] else None
        (ep_dir / f"{ep['id']}.json").write_text(json.dumps(ep_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    index = []
    for ep in reversed(episodes):  # newest first
        notes = ep["notes"]
        counts = None
        if notes:
            counts = {kind: len(notes.get(kind, [])) for kind in KINDS}
            levels = {}
            for it in notes.get("vocab", []):
                levels[it.get("level", "?")] = levels.get(it.get("level", "?"), 0) + 1
            counts["levels"] = levels
        index.append({**{key: ep[key] for key in ("id", "n", "show", "short", "date", "bv", "dur")},
                      "lines": len(ep["lines"]), "notes": counts})
    (args.out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    vocab = [v for v in words["vocab"].values() if "term" in v]
    for v in vocab:
        v["occ"] = {eid: lines for eid, lines in sorted(v["occ"].items(), key=lambda x: order[x[0]])}
    words_out = {"vocab": vocab, **{kind: list(words[kind].values()) for kind in KINDS[1:]}}
    (args.out / "words.json").write_text(json.dumps(words_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"{len(episodes)} episodes, {len(all_notes)} with notes, {len(vocab)} words")
    for w in warnings:
        print("warning:", w, file=sys.stderr)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
