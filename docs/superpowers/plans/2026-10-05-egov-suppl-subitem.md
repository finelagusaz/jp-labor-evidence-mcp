# e-Gov 附則・号の下の細分（subitem）・号の番号 Implementation Plan

**Goal:** spec [2026-10-05-egov-suppl-subitem-design.md](../specs/2026-10-05-egov-suppl-subitem-design.md) を実装する。`get_article` に `supplementary` / `subitem` を足して `item` を文字列でも受け付け、附則の一覧 tool `list_suppl_provisions` を新設する。

**Architecture:** 法令番号の解析は新しい純粋モジュール `src/lib/law-num.ts`。条・項・号・細分の探索は `egov-parser.ts` の中で本則と附則が共有する `extractFromScope` に一本化する。service（`law-service.ts`）が入力の検査とエラーの組み立てを担い、tool は envelope を組むだけにする。

## Global Constraints

- 曖昧なとき（附則の候補が複数、`paragraph` を省いた号が複数の項に一致）は推測で選ばず `ValidationError` で候補を示す。見つからないときは `NotFoundError`
- 出典の値（`AmendLawNum`）は加工せずに `amend_law_num` で返し、正規形は `key` として別に返す
- 本則の既存の契約（`canonical_id` `egov:{law_id}:article:{n}[:paragraph:{n}][:item:{n}]`、数値の `item`）は変えない
- 漢数字の変換は例外を投げず、変換できなければ `undefined`
- 各 task は「失敗するテストを書く → 赤を確かめる → 実装 → 緑」の順で進め、task ごとに commit する

## File Structure

**Create:**
- `src/lib/law-num.ts` — `kanjiToNumber` / `parseLawNum` / `formatSupplKey` / `lawNumMatches`
- `src/tools/list-suppl-provisions.ts` — 新しい tool
- `tests/law-num.test.ts`
- `tests/egov-parser-suppl.test.ts` — parser の号・細分・附則
- `tests/get-article-suppl.test.ts` — tool の統合（callTool + fetch stub）
- `tests/fixtures/egov/suppl-subitem-law.json` — live の労基法・労基則から切り出した最小の `law_data`（制定時附則、改正附則 2 件以上、条を持たない附則、抄、枝番号の号、Subitem 深さ 3、項をまたいで同じ番号の号）

**Modify:**
- `src/lib/egov-parser.ts` — `normalizeItemNum` / `normalizeSubitemPath`、`extractFromScope`、`extractArticle` の拡張、附則の一覧と選択
- `src/lib/services/law-service.ts` — `getLawArticle` / `getArticleByLawId` の拡張、`listSupplProvisions`
- `src/lib/canonical-id.ts` — 附則と subitem
- `src/tools/get-article.ts` — 入力・出力の schema、title、canonical_id
- `src/server.ts` — tool の登録、`instructions` に附則の引き方を一文
- `README.md` / `CLAUDE.md`（tool 数）/ `CHANGELOG.md` / version 3 ファイル

## Task 1: `law-num.ts`

- テスト: `kanjiToNumber`（`四十六`・`四六`・`二十`・`百二`・`一〇`・`十`・`元`・算用数字・全角・`一及び二` → undefined）、`parseLawNum`（`AmendLawNum` 形式、`/law_revisions` 形式、算用数字、元年、年だけ、`平成一二年八月一四日　平成一三年厚生労働省令第二号` → 年は 13、`厚生省・労働省令`、解析できない入力 → undefined）、`formatSupplKey`（`元年`）、`lawNumMatches`（種別の有無、番号の有無）
- 実装: 公布日の接頭辞を取り除いてから `{元号}{年}年{種別}第{番号}号` を解析する。年だけの入力も受ける

## Task 2: parser — 号の番号と細分

- テスト: `normalizeItemNum`（`3`・`"3の2"`・`"三の二"`・`"六"`・`"十二の五の二"`・`"第3号"`）、`normalizeSubitemPath`（`"イ (1)"`・`"イ-(1)-(i)"`・`"イ（１）（ｉ）"` → `["イ","1","i"]`）
- `extractArticle(lawData, article, paragraph?, item?, subitem?)`: 号を `Num` と `ItemTitle` の両方で照合。`paragraph` を省いた号は全項から探し、1 件なら `matchedParagraph` を返し、複数なら `ValidationError`。subitem を深さ順にたどる
- 既存の本則のテストが緑のままであること

## Task 3: parser — 附則

- テスト: `listSupplProvisions`（key・抄・条の番号・項の数、制定時の key は `制定`）、`selectSupplProvision`（`制定`、2 つの表記、該当なし → null、複数 → `ValidationError`、解析できない → `ValidationError`、番号なし → `ValidationError`）、`extractSupplProvision`（条あり・条を持たない附則の項・号・細分、ブロック全体、条を持つ附則で article を省いて paragraph → `ValidationError`）
- fixture を live から切り出して追加

## Task 4: service

- `getLawArticle`: `article?` / `item: number | string` / `subitem?` / `supplementary?`。検査（article か supplementary のどちらかが必須、subitem には item が必須、`附則` で始まる article に supplementary が無ければ案内つきの `ValidationError`）。cache key に全項目を含める。結果に `paragraph`（特定した項）・`subitem`（正規形）・`supplementary` を足す
- `listSupplProvisions({ lawId, amendmentLawNum?, limit, offset })`: 新しい順、`total`・`hasMore`、`article_nums` は 20 件まで
- 既存の `get_law`（deprecated）の挙動の変化（`paragraph` を省いた `item`）をテストで固定

## Task 5: `get_article` と canonical_id

- 入力 schema（`article` optional、`supplementary`、`item` union、`subitem`）、出力 schema（`supplementary`、`subitem`、`item` union、`article` optional）
- title: `労働基準法 附則（令和8年法律第46号・抄）第1条第2項第3号イ`
- canonical_id: `egov:{law_id}:suppl:{key}[:article:{n}][:paragraph:{n}][:item:{n}][:subitem:{path}]`。本則は不変で、subitem があるときだけ末尾に足す
- 統合テスト（callTool + fetch stub）: `pending_amendments` の `amendment_law_num`（十つき）をそのまま渡して附則が取れる経路を含める

## Task 6: `list_suppl_provisions`

- tool の登録、出力 schema、鮮度の警告・`version_info`・`revision_metadata`
- 統合テスト: 既定の上限、絞り込み（年だけ・番号まで）、`offset`、`has_more`

## Task 7: 仕上げ

- `server.ts` の `instructions`、README の tool 一覧、CLAUDE.md の tool 数
- live 確認: 主要法令で一覧と附則の取得、`pending_amendments` から附則への経路、労基則の Subitem 深さ 3
- CHANGELOG（`### Added` / `### Changed`）、version 0.8.0（3 ファイル）、`release:check`
