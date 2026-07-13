# e-Gov 改正メタ → Evidence.version_info / 未施行改正 warning — backlog 設計メモ

- 日付: 2026-07-13
- ステータス: **Backlog**（着手前に superpowers:brainstorming が必要。これは finalized spec ではなく、調査で得た知見の durable な捕捉）
- 発端: [2026-07-13-egov-freshness-refresh-design.md](2026-07-13-egov-freshness-refresh-design.md) 実行中、e-Gov API v2 の改正追従可否をユーザーが提起 → 調査の結果「freshness ではなく Evidence.version_info が本筋」と判明
- 関連: 4視点レビューの H1（`GENERATED_AT` は改正の最新性を保証しない）、SPEC `Evidence.version_info`（§9.4/§10.2、未導入）、[SPEC.md:300](../../../SPEC.md#L300)（`Evidence.citations` 未導入）

## 動機（category error の是正）

freshness refresh の chore は bundled egov index の齢をリセットするが、bundled index は**名前→id の解決マップ**であり、条文本文は `get_article` が**都度 live 取得**する（[law-service.ts:112](../../../src/lib/services/law-service.ts#L112)）。ゆえに法改正は本文取得で**常にリアルタイム反映**され、bundled の齢とは直交する。改正日を index freshness に結びつけるのは category error。

一方、利用者（社労士・legal）にとって「今引いた条文が*いつ施行の版*か」「*未施行の改正*が控えているか」は極めて重要な監査情報。これは freshness ではなく**根拠（Evidence）の提示点**に属する。SPEC の `Evidence.version_info` / `citations` は定義済みだが未導入——ここを埋めるのが H1 への本筋の回答。

## 一次証拠（調査で確認済み）

### live `GET /api/2/law_data/{lawId}` は revision_info を同梱

`322AC0000000049`（労働基準法）への live probe（2026-07-13）で確認したトップレベルキー: `attached_files_info` / `law_info` / **`revision_info`** / `law_full_text`。`revision_info` の中身:

```
law_revision_id: "322AC0000000049_20260624_508AC0000000046"
law_title: "労働基準法"
abbrev: "労基法"
category: "労働"
updated: "2026-06-24T10:42:02+09:00"
amendment_promulgate_date: "2026-06-24"
amendment_enforcement_date: "2026-06-24"
amendment_scheduled_enforcement_date: null   ← 未施行改正の予告
amendment_law_id: "508AC0000000046"
amendment_law_title: "民法等の一部を改正する法律の施行に伴う関係法律の整備等に関する法律"
amendment_law_num: "令和八年法律第四十六号"
current_revision_status: "CurrentEnforced"
repeal_status: "None"
remain_in_force: false
```

- 実例の含意: 労基法は **2026-06-24 施行の改正**を抱える（bundled 生成日 2026-06-10 より後）。現存性＋名称照合では素通りするが、version_info があれば利用者に現行版を明示できる。

### いま既に取得しているのに捨てている

`get_article` は `fetchLawData` で law_data を丸ごと取得済み。`revision_info` を活用しないのは、内部型 `EgovLawData`（[types.ts:22-34](../../../src/lib/types.ts#L22-L34)）が `law_info` と `law_full_text` しかモデル化していないため。**別エンドポイント・追加リクエスト不要**。

## 提案スコープ（brainstorming で確定させる）

1. `EgovLawData` 型に `revision_info` を追加（必要フィールドのみ）
2. `get_article`（および必要なら `get_law_toc`）の Evidence に `version_info` を付与:
   例「現行版: 2026-06-24 施行（令和八年法律第四十六号「民法等の一部を改正する法律の施行に伴う関係法律の整備等に関する法律」による改正）」
3. **未施行改正 warning**: `amendment_scheduled_enforcement_date != null` の場合「未施行の改正があります（施行予定日: YYYY-MM-DD）」を warnings[] に付与
4. `citation_basis` / `indexed_at|retrieved_at` の SPEC §14.2.6 K と整合させる

## 非目標 / 明示的に別扱い

- bundled index freshness への改正検知の組み込み（**category error**。freshness-refresh spec 参照）
- 条文本文の bundled 化（本文は live のまま）
- 時点法令（過去版・未施行版の本文取得）——別途

## Open questions（brainstorming 論点）

- version_info を出す tool の範囲（get_article のみ / search 系にも）
- メッセージ書式・JST 表記・identifier の扱い
- `repeal_status`（廃止法令）の提示方法
- freshness 警告文の綻び是正との連動: 現行文「最新の法令改正を反映するには再起動」（[freshness-warnings.ts:68](../../../src/lib/indexes/freshness-warnings.ts#L68)）は本文 live ゆえ過大約束。「解決マップ（新規法令・改称）の更新」に限定する小さな companion fix を含めるか
- `law_revision_id` を bundled index に補助的に持たせ、構造変化（改称・廃止）検知を強化するかは別議論（本 spec の主目的ではない）

## 参考

- live probe: `GET https://laws.e-gov.go.jp/api/2/law_data/322AC0000000049`（revision_info 実物）
- API 仕様: https://laws.e-gov.go.jp/api/2/redoc/ ・ https://laws.e-gov.go.jp/api/2/swagger-ui
- 更新法令一覧（改正済み法令の横断リスト）: https://laws.e-gov.go.jp/update/
