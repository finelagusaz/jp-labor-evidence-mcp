# 日付の和暦併記 — 設計メモ

- 日付: 2026-10-08
- ステータス: **実装済み（0.11.0）**
- 発端: [2026-07-13-egov-revision-version-info-design.md](2026-07-13-egov-revision-version-info-design.md) §2 と [2026-07-13-egov-pending-amendments-design.md](2026-07-13-egov-pending-amendments-design.md) §2 の非目標「和暦併記」

## 1. 現状

e-Gov は日付を ISO（`YYYY-MM-DD`）で返し、`version_info`・`revision_metadata`・`pending_amendments`・警告文はそれをそのまま載せていた。社労士・人事の実務では「令和8年6月24日施行」の和暦で読み書きするので、利用者や LLM が手で変換していた。手での変換は、改元の年（2019 年は 4 月 30 日まで平成、5 月 1 日から令和）で誤りやすい。

## 2. 決定

| 論点 | 決定 | 理由 |
|---|---|---|
| ISO の扱い | 変えずに残し、和暦を**添える** | 並べ替えと機械処理は ISO のまま。既存の利用者を壊さない |
| 人間向けの文字列 | `version_info` の公布日・現行版の施行日、警告文の施行予定日・廃止日・失効日を `2026-06-24（令和8年6月24日）` の形にする | `version_info`（人間向け）と `revision_metadata`（機械向け）の二層構造に合わせる |
| 機械向けのフィールド | `revision_metadata.current_enforcement_date_wareki`、`pending_amendments[].enforcement_date_wareki` を optional で足す | 日付を和暦で引用するときに、LLM が文字列から切り出さずに済む |
| 元号の選び方 | 改元日の ISO 文字列との辞書順比較（令和 2019-05-01、平成 1989-01-08、昭和 1926-12-25、大正 1912-07-30） | 元号は年でなく日で切り替わる。年だけの表（`ERA_BASE_YEAR`）では改元の年を誤る。年の計算には `ERA_BASE_YEAR` を共用する |
| 元年 | 年が 1 なら「元年」 | 法令の表記。附則の key（`formatSupplKey`）と同じ扱い |
| 範囲外 | 1873-01-01（太陽暦の採用）より前、実在しない日付、ISO でない文字列は和暦を付けない（文字列は ISO のまま、フィールドは省く） | 太陽暦の採用前の日付は旧暦の日付とずれ、単純な換算は誤る。例外は投げない |
| 警告文の書き方 | 日付を括弧の中に置かず、文を分ける（`最も近い施行予定日は 2027-04-01（令和9年4月1日）です。`、`廃止日は …です。`） | 従来の `（最も近い施行予定日 …）` に和暦の括弧を足すと `））` と入れ子になり読みにくい |
| LLM への指示 | `instructions` に、和暦は `*_wareki` の値を使い自分で換算しないよう 1 行足す | schema の説明はツール定義を読む側にしか届かない。改元の年での換算誤りを防ぐのがこの変更の動機 |
| 対象外 | deprecated の `get_law`、`diff_revision`、通達の `version_info` | version_info の強化の対象外としてきた tool（revision-version-info spec §6.5）。通達の日付はもともと和暦 |

## 3. 実装

- `src/lib/wareki.ts`（新規）: `toWarekiDate(iso)`、`withWareki(iso)`
- `src/lib/evidence-metadata.ts`: `buildVersionInfoString`・`buildRevisionMetadata`・`buildPendingAmendments`・`getRevisionWarnings`・`getPendingAmendmentWarnings` で和暦を添える。この 5 関数を通る `get_article`・`get_evidence_bundle`・`list_suppl_provisions` はそのまま追従する
- `src/lib/law-num.ts`: `ERA_BASE_YEAR` を export
- `src/lib/types.ts`・`src/lib/tool-contract.ts`: 型と schema にフィールドを足す

## 4. 検証

- 単体: 改元日の前後（2019-04-30 / 05-01、1989-01-07 / 08、1926-12-24 / 25、1912-07-29 / 30）、元年、太陽暦の採用前、実在しない日付
- live（2026-10-08）: 登録済みの 40 法令の `/law_revisions` にある公布日・施行日・廃止日 1,079 件がすべて和暦にできた（最も古いものは 1922-04-22）。`get_article`（労基法・安衛法、未施行改正つき）と `get_evidence_bundle` の出力で和暦の併記を確認
