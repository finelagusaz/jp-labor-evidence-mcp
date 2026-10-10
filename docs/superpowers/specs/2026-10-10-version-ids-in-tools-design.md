# get_article などでの版の指定 — 設計メモ

- 日付: 2026-10-10
- ステータス: **実装済み（0.14.0）**
- 発端: [2026-10-08-diff-revision-versions-design.md](2026-10-08-diff-revision-versions-design.md) §3 の対象外「`get_article`・`get_evidence_bundle` など他の tool での版の指定」。廃止法令の時点の本文取得（[2026-07-13-egov-revision-version-info-design.md](2026-07-13-egov-revision-version-info-design.md) §2）の前提にもなる

## 1. 現状

0.13.0 で `fetchLawData` は版の ID（`{law_id}_{YYYYMMDD}_{改正法 ID}`）を受け、その版の本文と `lawRevisionId` を返すようになった。しかし `diff_revision` 以外の tool の `law_id` は 20 文字までで、過去の版・未施行の版の条文そのものを読む手段が無かった。

## 2. 一次証拠（2026-10-10 に live で確認）

- 労基法の未施行の版（`322AC0000000049_20281223_508AC0000000046`）で `get_article` 第58条を取ると「未成年後見人」の文が返る。2019-04-01 の版（`…_20190401_430AC0000000071`）の第36条第1項も取れた
- 同じ版の `list_suppl_provisions` で「令和8年法律第46号」の附則が見え、`get_article` の `supplementary` で附則第1条（施行期日）が取れた。この附則は現行版にも収録済みだったので、「未施行の改正の附則は現行版に無いことがある」という既存の案内は可能性の話として残し、版の ID を渡す道を書き足した
- 同じ版での `get_evidence_bundle`（`include_pending_amendments: true`）は主根拠がその版の条文になり、関連通達 9 件、`LAW_NOT_CURRENTLY_ENFORCED` と `UNENFORCED_AMENDMENT_PENDING` を返した

## 3. 決定

| 論点 | 決定 | 理由 |
|---|---|---|
| 対象の tool | `get_article`・`get_evidence_bundle`・`list_suppl_provisions` の `law_id` を 60 文字まで広げ、版の ID を受ける | どれも本文が版で変わる。未施行の改正の附則を版の側から読める |
| 出力 | 版の ID で指定したときだけ `law_revision_id` を返す（bundle は `primary_evidence.article_locator.law_revision_id`）。`canonical_id`・`source_url`・`version_info`（「この版の施行日／施行予定日」）・`upstream_hash` もその版のもの | diff_revision（0.13.0）と同じ形にそろえる。同じ条の別の版が同じ canonical_id にならないように |
| 警告 | `LAW_NOT_CURRENTLY_ENFORCED` は従来の文のまま出す（「この版はまだ施行されていません」「この版は過去の施行版であり…」） | 文がすでに版について述べている。版を指定したことは利用者が知っている |
| 未施行の改正（`include_pending_amendments`） | 基の law_id の `/law_revisions` で調べる。文は「現行施行版に対し…」のまま | 未施行の改正は法令に対して決まるもので、指定した版に依らない |
| bundle の委任先・関連通達 | 版を問わず現在のもの。`law_id` の説明に書く | 委任先の法令の版は主法令の版と対応しない（施行日がそろわない） |
| `find_related_sources` | 対象外（20 文字のまま） | 関連は法令単位で、版で変わらない |
| law_id で指定したとき | 出力は従来と同じ（`law_revision_id` を返さない） | 互換 |

## 4. 検証

- 結合（fixture は 0.13.0 の労基法 3 版と労基則の附則）: `get_article` に未施行の版・過去の版・law_id、`list_suppl_provisions` に版の ID と law_id、版の附則の key を `get_article` に渡す往復、`get_evidence_bundle` に未施行の版
- live（2026-10-10）: §2
