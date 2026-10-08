# 上流 HTTP の失敗の型付け — 設計メモ

- 日付: 2026-10-08
- ステータス: **実装済み（0.10.2）**
- 発端: [2026-07-13-egov-pending-amendments-design.md](2026-07-13-egov-pending-amendments-design.md) §10 の残課題「egov 層の型付きエラー化（degrade reason 精度＋v1 retryable 判定の改善）」

## 1. 現状

`HttpSourceAdapter`（e-Gov・厚労省・JAISH が共有）は、HTTP の失敗・タイムアウト・サーキットブレーカーの開放をすべて素の `Error` で投げる。`mapErrorToEnvelope` は既知のクラスでしか判定しないので、e-Gov の失敗は種類にかかわらず `internal_error`・`retryable: false` で利用者に届いていた。

| 実際の失敗 | 本来の応答 | 現状 |
|---|---|---|
| 存在しない law_id（HTTP 404） | `not_found` | `internal_error` |
| 一時的な障害（5xx）・タイムアウト・サーキット開放 | `upstream_unavailable`、再試行可 | `internal_error`、再試行不可 |
| 応答の JSON が壊れている | `parse_error` | `internal_error` |

さらに、404 などの 4xx もサーキットブレーカーの失敗回数に数えていた。存在しない law_id を 3 回引くと、e-Gov への要求が 30 秒すべて止まる。`verify:egov` は 404 をエラー文の正規表現（`/HTTP 404\b/`）で判別していた。

## 2. 決定

| 論点 | 決定 | 理由 |
|---|---|---|
| クラスの形 | 既存の `NotFoundError` / `ExternalApiError` / `ParseError` の子クラスを足す（`UpstreamNotFoundError`、`UpstreamHttpError`、`UpstreamTimeoutError`、`CircuitOpenError`）。`ExternalApiError` に `retryable` を持たせる | `mapErrorToEnvelope` と既存の `instanceof` の判定をそのまま活かせる |
| 再試行の可否 | 5xx・429・408・タイムアウト・接続の失敗・サーキット開放は再試行可、そのほかの 4xx は不可 | 4xx（404 を除く）は要求そのものの問題で、待っても直らない |
| サーキットブレーカー | 再試行しても無駄な 4xx は失敗回数に数えない（上流は応答できている） | 存在しない law_id の連続で上流全体を止めない |
| エラー文 | `HTTP 503 Service Unavailable — {url}` の形を保つ | 既存の表示・ログとの互換 |
| 部分失敗の reason | `failureReasonOf(error)` で `not_found` / `upstream_unavailable` / `timeout` / `circuit_open` / `parse_error` を返し、bundle の関連取得と `get_article` の未施行改正の確認で使う | degrade reason の精度 |
| `verify:egov` | 404 の判定を型（`NotFoundError`）で行う | 文字列の判別をやめる |
| 404 など再試行しても無駄な 4xx の後の連続失敗の数え方 | 0 に戻す（`recordSuccess`）。503 → 503 → 404 なら、次の 503 は 1 回目として数える | 上流は応答できている。連続失敗は「上流が応答できない状態の連続」を表す |
| サーキット開放のエラー | 失敗回数に数えない | `try` の中の再確認で投げたものまで数えると、開いている時間を延ばしてしまう |

## 3. 検証

- tool の応答のテスト（`tests/upstream-errors.test.ts`）4 件は、main では赤、変更後は緑
- 「サーキット開放のエラーを数えない」は、`try` の中の再確認（並行要求の競合時）でだけ効く。テスト（`開いている時間を延ばさない`）は見張りで、変更前のコードでも通る。根拠はコードの読み
- live: 存在しない law_id を 4 回続けて引くと、どれも `not_found`。直後の労基法 第32条は `ok`（変更前は 3 回目でサーキットが開いていた）
- `verify:egov`: 40 件すべて OK（404 の判定を型へ移した後も変わらない）

