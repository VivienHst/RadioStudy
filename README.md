# RiRadio

日文廣播節目的逐字稿、繁體中文翻譯與日檢單字文法筆記，做成可以放上 GitHub Pages 的靜態網站。非官方，個人學習用途。目前收錄「佐々木李子のリコサカ！」。

## 結構

```
docs/            網站本體（GitHub Pages 從這裡發布）
  index.html     依節目分組的集數列表
  ep.html?id=rikosaka-128  單集逐字稿＋學習筆記
  words.html     跨節目的單字庫、文法、慣用句、擬聲擬態語、單字卡
  data/          tools/build.py 產生的 JSON，要一起 commit
notes/<節目代號>/<集數>.json  每集的學習筆記（手寫或 Claude 產生，網站資料的來源之一）
tools/build.py       產生 docs/data/
tools/shows.json     要放上網站的節目，以及每個節目的代號
tools/readings.json  振假名手動覆寫（人名、斷詞器讀錯的詞）
```

逐字稿來自 SubtitleExtension 的 `temp/<集數資料夾>/`（`subs.ja.srt`、`subs.zh-hant.srt`、`source.txt`），用 subtitle-video skill 產生。資料夾名稱要是 `YYMMDD<節目名稱>第<集數>回` 的格式。

每集的代號是「節目代號-集數」，例如 `rikosaka-128`，網址、筆記檔和資料檔都用這個代號，不同節目的集數就不會互相衝突。

## 新增節目

在 `tools/shows.json` 加一行。名稱要和資料夾名稱裡的節目名稱完全一樣；`id` 只能用小寫英文和數字，會出現在網址裡，發布後就不要再改；`short` 是節目有好幾個時，單字庫用來標示出處的簡稱。

```json
{
 "佐々木李子のリコサカ！": {"id": "rikosaka", "short": "リコサカ"},
 "新節目的名稱": {"id": "newshow", "short": "簡稱"}
}
```

`temp/` 裡不在這份清單的節目會被略過，所以也可以用它決定哪些節目要公開。

## 更新網站

```
python -m pip install fugashi unidic-lite
python tools/build.py
```

預設讀 `../SubtitleExtension/temp`，其他位置用 `--src` 指定。新增一集字幕或修改 `notes/` 裡的筆記後都要重跑，再 commit `docs/data/`。

本機預覽（直接雙擊 HTML 會因為瀏覽器限制讀不到 JSON）：

```
python -m http.server 8000 -d docs
```

## notes/<節目代號>/<集數>.json 格式

```json
{
  "version": 1,
  "vocab": [{"term": "浮つく", "reading": "うわつく", "pos": "動五", "level": "N1",
             "meaning": "心浮氣躁、飄飄然", "note": "選填", "line": 12, "form": "浮ついてん"}],
  "grammar": [{"term": "～つつ", "level": "N2", "meaning": "一邊～一邊～", "line": 20, "form": "降りつつ"}],
  "idioms": [{"term": "灯台下暗し", "reading": "とうだいもとくらし", "meaning": "…", "line": 150, "form": "灯台下暗し"}],
  "onomatopoeia": [{"term": "ギスギス", "meaning": "…", "line": 1, "form": "ギスギス"}],
  "tips": [{"title": "ら抜き言葉", "items": ["可用 **粗體** 與 `時間`"]}]
}
```

- `line` 是 `subs.ja.srt` 的字幕編號；例句跨行時加 `"to": <最後一行>`。
- `form` 是例句裡實際出現的字串（活用後的形式），網站用它在逐字稿裡標示。
- `level` 用 `N1`、`N2`、`N3`、`N4-5`。
- 單字會用斷詞結果在**所有節目的所有集數**裡找出現位置，所以一集的筆記也會標示在其他集、其他節目的逐字稿。
- 挑詞原則和各欄位寫法見 [notes/GUIDE.md](notes/GUIDE.md)。寫完先跑 `python tools/check_notes.py notes/<節目代號>/<集數>.json --format` 檢查格式、行號和 `form` 是否對得上字幕，再跑 build。

## 發布到 GitHub Pages

1. 在 GitHub 建立這個 repo 並 push。免費方案的 Pages 只能從公開 repo 發布，網站一定是公開的。
2. Settings → Pages → Build and deployment：Source 選「Deploy from a branch」，Branch 選 `main`、資料夾選 `/docs`。
3. 網址會是 `https://<帳號>.github.io/<repo 名稱>/`。
