"""Check one or more notes files (notes/<show id>/<number>.json) against the episode's subtitles.

  python tools/check_notes.py notes/rikosaka/124.json [more files...] [--format]

Reports errors (exit code 1) for: unknown fields or levels, missing required fields, line numbers
outside the episode, and `form` strings that are not on the given line(s). Warns about vocab that
already exists in another episode's notes (the site highlights those automatically).
--format rewrites each file in the canonical layout (one item per line) after a clean check.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import FOLDER_RE, KANA, ROOT, find_span, parse_srt, vocab_id  # noqa: E402

LEVELS = {"N1", "N2", "N3", "N4-5"}
FIELDS = {
    "vocab": ({"term", "reading", "level", "meaning", "line", "form"}, {"pos", "note", "to"}),
    "grammar": ({"term", "level", "meaning", "line", "form"}, {"note", "to"}),
    "idioms": ({"term", "reading", "meaning", "line", "form"}, {"note", "to", "level"}),
    "onomatopoeia": ({"term", "meaning", "line", "form"}, {"reading", "note", "to"}),
}
KANA_ONLY = re.compile(f"[{KANA}・（）()～]+")


def episode_lines(src, shows, sid, n):
    names = {meta["id"]: name for name, meta in shows.items()}
    for folder in src.iterdir():
        m = FOLDER_RE.match(folder.name)
        if m and m.group(4).strip() == names.get(sid) and int(m.group(5)) == n:
            ja = parse_srt(folder / "subs.ja.srt")
            return [{"ja": x["text"]} for x in ja]
    return None


def other_vocab(notes_root, skip):
    seen = {}
    for p in sorted(notes_root.glob("*/*.json")):
        if p.resolve() == skip.resolve():
            continue
        try:
            items = json.loads(p.read_text(encoding="utf-8")).get("vocab", [])
        except (json.JSONDecodeError, OSError):  # another file being written right now
            continue
        for it in items:
            seen.setdefault(vocab_id(it), f"{p.parent.name}-{p.stem}")
    return seen


def check(path, src, shows):
    errors, warnings = [], []
    sid, n = path.parent.name, int(path.stem)
    lines = episode_lines(src, shows, sid, n)
    if lines is None:
        return [f"no subtitle folder for {sid}-{n} under {src}"], [], None
    try:
        notes = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"invalid JSON: {e}"], [], None

    extra = set(notes) - {"version", "tips", *FIELDS}
    if extra:
        errors.append(f"unknown top-level keys: {sorted(extra)}")
    others = other_vocab(path.parent.parent, path)
    ids = set()
    for kind, (required, optional) in FIELDS.items():
        for k, it in enumerate(notes.get(kind, [])):
            where = f"{kind}[{k}] {it.get('term', '?')}"
            missing = required - set(it)
            unknown = set(it) - required - optional
            if missing:
                errors.append(f"{where}: missing {sorted(missing)}")
            if unknown:
                errors.append(f"{where}: unknown fields {sorted(unknown)}")
            if "level" in it and it["level"] not in LEVELS:
                errors.append(f"{where}: level must be one of {sorted(LEVELS)}, got {it['level']!r}")
            if kind in ("vocab", "idioms") and it.get("reading") and not KANA_ONLY.fullmatch(it["reading"]):
                errors.append(f"{where}: reading should be kana only, got {it['reading']!r}")
            first, last = it.get("line"), it.get("to", it.get("line"))
            if not isinstance(first, int) or not 1 <= first <= len(lines):
                errors.append(f"{where}: line {first!r} is outside 1..{len(lines)}")
                continue
            if not isinstance(last, int) or not first <= last <= min(first + 2, len(lines)):
                errors.append(f"{where}: to {last!r} must be line..line+2")
                continue
            if it.get("form") and not find_span(lines, first - 1, last - 1, it["form"]):
                shown = " / ".join(lines[i]["ja"] for i in range(first - 1, last))
                errors.append(f"{where}: form {it['form']!r} not found on line {first}{f'-{last}' if last != first else ''}: {shown}")
            if kind == "vocab":
                vid = vocab_id(it)
                if vid in ids:
                    errors.append(f"{where}: duplicate vocab {vid}")
                ids.add(vid)
                if vid in others:
                    warnings.append(f"{where}: already in {others[vid]} notes")
    for k, tip in enumerate(notes.get("tips", [])):
        if set(tip) != {"title", "items"} or not isinstance(tip.get("items"), list):
            errors.append(f"tips[{k}]: needs exactly title + items[]")
    return errors, warnings, notes


def dump(notes):
    """Canonical layout: one item per line, so diffs stay readable."""
    out = ['{', ' "version": 1,']
    sections = [k for k in (*FIELDS, "tips") if k in notes]
    for i, kind in enumerate(sections):
        items = notes[kind]
        body = ",\n".join("  " + json.dumps(it, ensure_ascii=False) for it in items)
        out.append(f' "{kind}": [\n{body}\n ]' + ("," if i < len(sections) - 1 else "") if items else f' "{kind}": []' + ("," if i < len(sections) - 1 else ""))
    out.append("}")
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--src", type=Path, default=ROOT.parent / "SubtitleExtension" / "temp")
    ap.add_argument("--format", action="store_true", help="rewrite files in the canonical layout when they pass")
    args = ap.parse_args()
    shows = json.loads((ROOT / "tools" / "shows.json").read_text(encoding="utf-8"))
    failed = False
    for path in args.files:
        errors, warnings, notes = check(path, args.src, shows)
        counts = ", ".join(f"{k} {len(notes.get(k, []))}" for k in (*FIELDS, "tips")) if notes else ""
        print(f"{path}: {len(errors)} errors, {len(warnings)} warnings  ({counts})")
        for e in errors:
            print("  error:", e)
        for w in warnings:
            print("  warning:", w)
        if errors:
            failed = True
        elif args.format:
            path.write_text(dump(notes), encoding="utf-8")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
