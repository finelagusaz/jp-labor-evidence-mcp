# get_evidence_bundle での未施行の改正の確認 — 設計メモ

- 日付: 2026-10-08
- ステータス: **実装済み（0.12.0）**
- 発端: [2026-07-13-egov-pending-amendments-design.md](2026-07-13-egov-pending-amendments-design.md) §2 の非目標「`get_evidence_bundle` への統合」と §10 の残「一貫性」

## 1. 現状

未施行の改正は `get_article` の `include_pending_amendments` でしか確かめられなかった。bundle を主に使う利用者は、条文を引いたあとに `get_article` をもう一度呼ぶ必要があった。

## 2. 決定

| 論点 | 決定 | 理由 |
|---|---|---|
| 入力 | `include_pending_amendments`（既定 **false**）。名前・既定とも `get_article` と同じ | §10 の「一貫性」への答え。既定を true にすると、労働法令の多くで毎回 `UNENFORCED_AMENDMENT_PENDING` が付くようになり、既存の利用者の出力が黙って変わる |
| 出力の位置 | `primary_evidence.pending_amendments`（`revision_metadata` の隣） | 法令単位の版メタを EvidenceRecord に載せる既存の配置に合わせる。中身は `get_article` と同じ（`pendingAmendmentSchema`） |
| 対象 | 主法令だけ。委任先の法令（施行規則など）は確かめない | 委任先の数だけ `/law_revisions` の取得が増える。必要なら委任先の law_id で `get_article` を呼べばよい |
| 警告 | `get_article` と同じ `UNENFORCED_AMENDMENT_PENDING` / `PENDING_AMENDMENT_INCOMPLETE_DATA` を top-level の `warnings` に載せる | text の `警告:` 節にも出るので、text に新しい節は足さない（pending spec §5.4、SPEC.md §9.5） |
| 失敗 | 主条文は返し、`status: 'partial'`、`partial_failures` に `{source:'egov', target:'law_revisions:{lawId}', reason}`、`PENDING_AMENDMENT_CHECK_FAILED` | `get_article` と同じ。reason は `failureReasonOf`（0.10.2） |
| 附則の改正法の題名との重複 | 附則の改正法の題名を引く処理（`findAmendmentLawTitle`）も同じ `law_revisions:{lawId}` を target にする。両方が同じ理由で失敗したときは、既存の `dedupePartialFailures` で 1 件にまとまる。理由が違えば 2 件残す | 同じ取得の失敗を二重に数えない。理由が違うなら別の事実として残す |
| 取得の回数 | `/law_revisions` は raw cache（1 時間）が効くので、`verifyLatestEnforced`・`findAmendmentLawTitle` と同じ bundle の中で重ねて引いても上流への要求は 1 回 | 追加の負荷は小さい |

## 3. 検証

- 単体: 既定では `getPendingAmendments` を呼ばない、指定すれば載せて警告する、未施行が無ければ空配列で警告なし、取得に失敗すれば partial に落として主条文は返す、tool の入力と outputSchema を通る
- live（2026-10-08）: 労基法（2 件）・安衛法（4 件）・労災法（2 件）・派遣法（2 件）で `pending_amendments` と警告、均等法・育介法は空配列で警告なし。既定では載らない。附則（`令和八年法律第六十号`）と同時に指定しても動く
