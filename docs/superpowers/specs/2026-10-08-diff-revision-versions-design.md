# diff_revision の版指定と version_info — 設計メモ

- 日付: 2026-10-08
- ステータス: **実装済み（0.13.0）**
- 発端: [2026-07-13-egov-revision-version-info-design.md](2026-07-13-egov-revision-version-info-design.md) §2・§6.5 の非目標「`diff_revision` への version_info の波及」

## 1. 現状

`diff_revision` は 2 つの law_id（20 文字まで）の現行版どうしを比べ、題名が違えば拒否していた。law_id は版を指定できないので、実際には同じ法令の現行版を 2 回引いて比べることしかできず、改正前後の比較という目的を果たせていなかった。`version_info` は法令番号と公布日だけで、どの版かを示していなかった（revision-version-info spec §6.5 の「版比較で version の意味が異なる」）。

## 2. 一次証拠（2026-10-08 に live で確認）

- `GET /api/2/law_data/{law_revision_id}` は過去の版・未施行の版の本文を返し、`revision_info` もその版のもの。`law_info.law_id` は基の law_id
- 版の ID の形式は `{law_id}_{YYYYMMDD}_{改正法 ID 15 文字}`。登録 40 法令の `/law_revisions` の 1,039 件がすべてこの形式
- 未施行の版 82 件はすべて `/law_data` で取れた。うち 53 件は `amendment_enforcement_date` に日付があり、29 件は null で `amendment_scheduled_enforcement_date` にだけ日付がある
- e-Gov の Web の版のページは `https://laws.e-gov.go.jp/law/{law_id}/{YYYYMMDD}_{改正法 ID}`。ブラウザで労基法の未施行の版（`20281223_508AC0000000046`）を開き、第58条が現行版（「親権者又は後見人は、未成年者に代つて」）ではなくその版の文（「親権者又は未成年後見人は、未成年者に代わつて」）で出ることを確認した。SPA なので存在しない版にも HTTP 200 を返すが、URL は取得できた版の ID からしか作らない
- 労基法の現行版（2026-07-17）と未施行の版（2028-12-23）では第57条〜第59条などが変わる（民法改正に伴う「未成年後見人」への整備）

## 3. 決定

| 論点 | 決定 | 理由 |
|---|---|---|
| 入力 | `base_law_id` / `head_law_id` に law_id か版の ID（60 文字まで）を受け付ける | `revision_metadata.law_revision_id`・`pending_amendments[].law_revision_id` をそのまま渡せる。未施行の版を渡せば施行後の変化を比べられる |
| 同じ法令の判定 | law_id が同じなら同じ法令。題名の一致も従来どおり認める | 題名は改正で変わりうる（育介法など） |
| version_info | 版の ID で指定した側は「この版の施行日」。未施行の版は「この版の施行予定日」（施行日の項目に日付があってもなくても）。law_id で指定した側は従来どおり「現行版の施行日」 | 過去の版・未施行の版に「現行版」と書くのは誤り。未施行の版の日付は e-Gov の版により入る項目が違う |
| 施行予定日の扱い | `amendment_scheduled_enforcement_date` は未施行の版でだけ使う。`revision_metadata.scheduled_enforcement_date`（＋和暦）を新設し、`current_enforcement_date` には流し込まない | 施行済みの版の scheduled は前方参照ではない（revision-version-info spec §3）。API 名と出力名の写像は固定する方針（mis-map 防止） |
| revision_metadata | 両側に載せる。`verifyLatestEnforced` も両側で行う | タグ付け遅れ（0.7.2）は現行版の側にも出る |
| 警告 | `LAW_NOT_CURRENTLY_ENFORCED` の文の前に「比較元: 」「比較先: 」を付ける | 両側とも同じ法令名で始まり、どちらの側か分からない |
| canonical_id | 版の ID で指定した側は版の ID で識別する（`egov:{law_revision_id}:article:58`）。`law_revision_id` フィールドも足す | 同じ law_id・同じ条で本文の違う 2 件が同じ id にならないように |
| source_url | 版の ID で指定した側は e-Gov の版のページ | 引用元をその版にする |
| 対象外 | `get_article`・`get_evidence_bundle` など他の tool での版の指定 | 0.14.0 で対応（[2026-10-10-version-ids-in-tools-design.md](2026-10-10-version-ids-in-tools-design.md)） |

## 4. 検証

- 単体: 版の ID の解釈、題名が変わっても law_id で同じ法令と判定、「この版の施行日／施行予定日」、未施行の版で施行日の項目に日付がある場合、scheduled を未施行の版でだけ載せる
- 結合（fixture は live の労基法 3 版から第32条・第58条を切り出し）: 現行版と未施行の版、過去の版と現行版、版の ID どうし
- live（2026-10-08）: 労基法第58条（現行版 → 2028-12-23 の版）で「未成年後見人」への変更を検出。過去の版（2025-06-01）・安衛法の未施行の版・労組法（タグ付け遅れ）・別法令（invalid）・存在しない版（not_found）を確認
