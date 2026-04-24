# Freshness Warnings 設計

## 背景

`jp-labor-evidence-mcp` は `npx` 等で起動した MCP server が長時間常駐するユースケースがあり、bundled / runtime それぞれの index が「古くなる」局面で利用者に気付きを与える仕組みが必要である。

直接のきっかけは以下の 2 点：

1. `tests/egov-index.test.ts` が `meta.freshness === 'fresh'` を要求していたが、`src/lib/indexes/egov-index.ts:9` の `GENERATED_AT = '2026-04-02T00:00:00.000Z'` が hardcoded literal で、`STALE_AFTER_MS = 7日` に対して `Date.now()` が進むと必ず `'stale'` になるため、7 日経過後は必ず失敗する。`tests/egov-index.test.ts` 側は 2026-04-24 の commit `2fa6e89` で `vi.useFakeTimers` による決定化済み。しかし **production 側の egov bundled meta は同じ時限爆弾を抱えたまま**で、起動から 7 日経てば `freshness: 'stale'` を毎回報告する構造になっている。
2. SPEC.md を実装と突き合わせると、`§8 l.300` の「freshness を返す内部索引モデルがない」は Phase 4 完了で解消済み、`§14.2.6 l.1199` の「source 別 TTL を固定する」は実装が uniform 7日固定で未達、といった drift があり、この機会に整える。

## 目的

- bundled index（egov）と runtime index（mhlw / jaish）の「古さ」を**異なる semantic で**扱う
- 古さを MCP client（= LLM およびその先のユーザ）へ通知する経路を整備する
- SPEC.md の freshness 関連記述を実装実態に揃える

## 方針

### 採択済み設計判断

| 項目 | 決定 |
| --- | --- |
| 通知対象 | bundled egov を主、runtime mhlw/jaish の既存 stale も整理 |
| egov の freshness モデル扱い | **除外（β）**。`freshness: 'unknown'` を固定し、別途 `bundled_age_days` を露出 |
| egov bundled age 警告閾値 | **60 日**（日本労働法の改正サイクル 4/1・10/1 を考慮して設定） |
| mhlw/jaish TTL | **uniform 7 日を維持**。source 別 TTL は SPEC 上「将来最適化項目」として明記 |
| 通知チャネル (egov) | **MCP logging (`level: warning`) + stderr を startup 時 1 回**、**かつ tool response `warnings[]` に毎回 merge**（egov を消費する全 tool） |
| 通知チャネル (mhlw/jaish) | **tool response `warnings[]` に merge**（各 source を消費する tool のみ） |
| メッセージ言語 | **日本語**。`code` は英語 identifier のまま |
| LLM consumer contract | 上位 client（Claude 等）が warnings を cite 前に surface することを、server の `instructions` フィールドに明文化 |
| 実装構造 | **Approach A: 直接的な tool-level integration**。helper は `src/lib/indexes/freshness-warnings.ts` に抽出 |
| Degraded 扱い | bundled age 超過は `degraded` にしない（`warning` 止まり）。runtime stale は既存 `STALE_INDEX` を維持 |

### 設計根拠の要点

- **β の採択理由**: bundled data の「古さ」は「再同期せよ」という action 誘導として成立せず、取れる action が package 更新のみ。`freshness: 'stale'` を runtime index（再同期可能）と bundled index（コード更新必須）で同じ semantic にするのは誤り
- **60日閾値の根拠**: 日本の労働関連法令の主要改正は 4/1（年度始）・10/1 に集中する。90日では 4/1 施行改正を 7/1 まで気付けず silent に stale 案内を続けるリスクが残る。60日なら 4/1 改正は 6/1 までに警告が発火し、受容可能な lag に収まる
  - カレンダー境界（直近の 4/1・10/1 を跨いだ段階で発火）による完全な追随は将来の最適化項目とし、別 Issue で追跡
- **uniform 7日維持の根拠**: SPEC の「source 別 TTL」要件には応えたいが、mhlw/jaish それぞれの実際の更新頻度についての観測データが不足。推測で差を付けるより、現行 uniform で運用しつつ将来の observability 蓄積を待つのが誠実
- **bundled warning を tool response にも載せる根拠（ユーザ視点レビュー #3 対応）**: startup notification は 1 プロセス 1 回のみ。長時間稼働中に閾値跨ぎが起きても再通知されないため、tool response ごとに毎回評価する方が authoritative。実装コストは `bundled_age_days` の減算 1 回で無視できる

## アーキテクチャ

### 新規モジュール: `src/lib/indexes/freshness-warnings.ts`

純粋な helper。外部 state を保持せず、入力（現在時刻、index meta）に対して出力（warning 配列）を返す決定論的な関数群。

```ts
import type { IndexSource } from './types.js';

export const BUNDLED_AGE_THRESHOLD_DAYS = 60;

export type FreshnessWarning = {
  code: 'BUNDLED_INDEX_AGED' | 'RUNTIME_INDEX_STALE';
  source: IndexSource;
  message: string;
};

// 単一 source 向けヘルパ（内部利用 + 単体テスト用）
export function getBundledIndexWarnings(now?: number): FreshnessWarning[];
export function getRuntimeIndexWarnings(
  source: 'mhlw' | 'jaish',
  now?: number
): FreshnessWarning[];

// tool handler 向け集約 API
// sources に含まれる index のみを評価して warning を合成
export function getIndexWarningsForTool(
  sources: ReadonlyArray<IndexSource>,
  now?: number
): FreshnessWarning[];

// 起動時に bundled のみ評価し、MCP logging + stderr に emit
export function emitStartupWarnings(
  server: McpServer,
  now?: number
): Promise<void>;
```

`now` 引数を公開し default を `Date.now()` とすることで、単体テストで時刻注入できる。これは `src/lib/indexes/index-metadata.ts:153` の `inferFreshness(generatedAt, now = Date.now())` と同じ pattern。

### メッセージ文言

helper が返す `message` は日本語固定文言（`code` は英語 identifier で不変）。閾値値、日付、経過日数は runtime で埋め込む。

#### `BUNDLED_INDEX_AGED`（egov）

```text
内蔵法令インデックスの生成から {N} 日経過しています（生成日: {YYYY-MM-DD}）。
最新の法令改正を反映するには、Claude Desktop / Claude Code を再起動してください
（`npx -y` 起動の場合は再起動で最新パッケージが自動取得されます）。
グローバルインストール利用時は `npm update -g jp-labor-evidence-mcp` を実行してください。
```

**重要**: README に従えば推奨セットアップは `npx -y jp-labor-evidence-mcp`。このパスでは `npm update -g` は no-op 相当となるため、**再起動案内を第一、`npm update -g` を条件付き補足**の語順とする。

#### `RUNTIME_INDEX_STALE`（mhlw / jaish）

```text
{SOURCE_LABEL}のインデックスが古くなっています（最終同期: {YYYY-MM-DD}、{N}日前）。
同じキーワードで再検索すると最新の情報が反映されます。
```

`SOURCE_LABEL` は `mhlw` → 「厚生労働省通達」、`jaish` → 「中央労働災害防止協会（JAISH）判例・資料」。

日付は `YYYY-MM-DD` 形式。タイムゾーン JST 対応は別 Issue で追跡（UTC 由来の日付表示で最大 1 日の誤差は運用上許容）。

### データモデル変更

#### `IndexSnapshotMeta` (`src/lib/indexes/types.ts`)

```diff
 export type IndexSnapshotMeta = {
   source: IndexSource;
   generated_at: string;
   last_success_at?: string;
   last_failure_at?: string;
   freshness: IndexFreshness;
   entry_count: number;
   coverage_ratio?: number;
   // ...
+  bundled_age_days?: number;  // bundled source (egov) でのみ設定
 };
```

#### `DEFAULT_EGOV_INDEX_META` (`src/lib/indexes/egov-index.ts`)

```diff
 const DEFAULT_EGOV_INDEX_META: IndexSnapshotMeta = {
   source: 'egov',
   generated_at: GENERATED_AT,
   last_success_at: GENERATED_AT,
-  freshness: inferFreshness(GENERATED_AT),
+  freshness: 'unknown',  // bundled: excluded from freshness model
   entry_count: DEFAULT_LAW_INDEX_ENTRIES.length,
   coverage_ratio: 1,
   // ...
 };
```

`persistEgovIndex()` 側（`egov-index.ts:117`）も同様に `freshness: 'unknown'` を強制し、`bundled_age_days: computeBundledAgeDays()` を設定する。

### Tool 統合（source 依存マッピング）

各 tool handler が envelope 組み立て時に `getIndexWarningsForTool(sources)` を呼び、結果を `warnings[]` に merge する。source list は tool ごとに静的に宣言。

| Tool | 依存 index | `sources` 引数 |
| --- | --- | --- |
| `resolve_law` | egov | `['egov']` |
| `search_law` | egov | `['egov']` |
| `get_law` | egov | `['egov']` |
| `get_article` | egov | `['egov']` |
| `diff_revision` | egov | `['egov']` |
| `search_mhlw_tsutatsu` | mhlw | `['mhlw']` |
| `get_mhlw_tsutatsu` | mhlw | `['mhlw']` |
| `search_jaish_tsutatsu` | jaish | `['jaish']` |
| `get_jaish_tsutatsu` | jaish | `['jaish']` |
| `find_related_sources` | egov + mhlw + jaish | `['egov', 'mhlw', 'jaish']` |
| `get_evidence_bundle` | egov + mhlw + jaish | `['egov', 'mhlw', 'jaish']` |
| `get_observability_snapshot` | — | なし（meta を直接露出するため warning は不要） |

`ToolEnvelope.warnings` は `WarningMessage[]` (= `{ code: string; message: string }[]`、`src/lib/tool-contract.ts:15-18` で定義済み)。`FreshnessWarning` から `source` を除いた `{ code, message }` ペアに写像する。

```ts
// 概念コード（各 tool handler 内）
const freshnessWarnings = getIndexWarningsForTool(['egov'])
  .map(({ code, message }) => ({ code, message }));
const warnings = [...existingWarnings, ...freshnessWarnings];
```

tool envelope schema 自体は変更不要。

### Startup 統合

`src/index.ts` の `main()` に 1 行追加：

```diff
 async function main() {
   initializeIndexes();
   const transport = new StdioServerTransport();
   await server.connect(transport);
   startObservabilityReporter(server);
+  await emitStartupWarnings(server);
   console.error('jp-labor-evidence-mcp running on stdio');
 }
```

`emitStartupWarnings` の内部動作：

1. `getBundledIndexWarnings()` を呼び、閾値超過なら 1 件以上の warning を得る
2. warnings が空でなければ：
   - **stderr**: `console.error('[jp-labor-evidence-mcp] WARNING: ' + message)` を各 warning につき 1 行
   - **MCP logging**: `server.sendLoggingMessage({ level: 'warning', data: message, logger: 'jp-labor-evidence-mcp' })` を try/catch で包み送信失敗時は黙殺

「1 回だけ」保証は `main()` 起動時 1 回の呼出に依存。**ただし tool response 側でも毎回 merge されるため、startup notification はあくまで運用者（stderr を観察する人）向けの一次通知であり、ユーザ向け authoritative channel は tool response `warnings[]` である**。

### LLM Consumer Contract

MCP server の `instructions` フィールド（`src/server.ts:23-39` 既存）に以下のガイダンスを追記し、LLM が warnings を silent drop しないよう促す：

```markdown
## freshness warnings の扱い

tool response の `warnings[]` に以下の `code` が含まれる場合、回答本文に
根拠を引用する前に、日本語で短く disclaim してください：

- `BUNDLED_INDEX_AGED`: 内蔵法令インデックスが古くなっています。
  最新改正が反映されていない可能性を利用者に伝えてください。
- `RUNTIME_INDEX_STALE`: 通達／判例インデックスが古くなっています。
  同じキーワードで再検索を試すよう利用者に案内してください。

warnings の `message` は既に利用者向け日本語になっています。
paraphrase せず、そのまま引用することを推奨します。
```

この追記により、Claude 等の LLM client は freshness warnings を系統的に surface できる。server.ts の `instructions` 文字列を実装時に拡張する。

### Observability 統合

`src/tools/get-observability-snapshot.ts` の `indexes` schema に `bundled_age_days: z.number().optional()` を追加。Markdown 整形 (`indexLines`) にも `bundled_age_days=...` トークンを追加。

`src/lib/observability.ts:336-342` の `STALE_INDEX` 判定は**コード変更不要**。egov が `freshness: 'unknown'` に固定されることで条件を満たさなくなり、mhlw/jaish のみが `STALE_INDEX` を誘発する設計となる。

### SPEC.md 更新

| 箇所 | 現状 | 更新内容 |
| --- | --- | --- |
| §8 l.300 | "freshness を返す内部索引モデルがない" | 削除（Phase 4 で実装済み） |
| §13.3 | 「各索引データには更新時刻を持たせる」 | 追記: bundled source は freshness モデルから除外、`bundled_age_days` を別途露出、runtime source のみ `fresh/stale/unknown` で判定 |
| §14.2.6 l.1199 | "source 別 TTL を固定する" | 現実化: runtime index は uniform 7日を暫定 TTL、source 別 TTL は将来最適化項目として明記 |
| 新規 §14.x | （なし） | bundled index age 警告の仕様: 60日閾値、通知チャネル（startup MCP logging + stderr、および tool response warnings）、対象は egov のみ、LLM consumer contract |

## エラーハンドリング

- `freshness-warnings.ts` の helper は**throw しない**。不正入力、時刻計算の NaN 等は `return []` で黙認
- `emitStartupWarnings` は `sendLoggingMessage` の reject を try/catch で包み swallow。stderr は無条件実行
- tool handler での warnings merge は同期処理、失敗経路なし

## テスト戦略

### 新規: `tests/freshness-warnings.test.ts`

helper の純粋関数をユニットテスト。時刻注入で決定論的に。

- `getBundledIndexWarnings`: 59日以下は `[]`、60日超で `BUNDLED_INDEX_AGED` 付き warning
- `getRuntimeIndexWarnings`: 7日境界の前後
- `getIndexWarningsForTool`: `['egov']`、`['mhlw']`、`['egov', 'mhlw', 'jaish']` の各組み合わせで期待通り合成されること
- メッセージが日本語で、再起動または `npm update -g` の案内を含むこと（`BUNDLED_INDEX_AGED`）
- メッセージが `SOURCE_LABEL` を含むこと（`RUNTIME_INDEX_STALE`）

### 既存修正: `tests/egov-index.test.ts`

```diff
-expect(result.meta.freshness).toBe('fresh');
+expect(result.meta.freshness).toBe('unknown');
+expect(result.meta.bundled_age_days).toBe(0);
```

### 新規 / 既存修正: tool response 統合テスト

- **egov を aged 状態にした fixture** で `resolve_law` / `search_law` 等の egov 消費 tool を呼び、envelope `warnings` に `BUNDLED_INDEX_AGED` メッセージが含まれることを assert
- mhlw/jaish index を stale 状態にした fixture で search tool を呼び、envelope `warnings` にメッセージが含まれることを assert
- fresh / 新しい状態ではそれぞれの warning が含まれないことも verify（false-positive 防止）
- `find_related_sources` / `get_evidence_bundle` で両方の warning が合成されることを verify

### 新規 / 既存修正: observability snapshot テスト

- `bundled_age_days` が egov のみに present、mhlw/jaish には absent
- Markdown 出力の egov 行に `bundled_age_days=` トークンが現れる

### 新規: `emitStartupWarnings` smoke test

- mock server で `sendLoggingMessage` の呼出回数と引数を verify（`level: 'warning'`、`data` が日本語メッセージ）
- `console.error` spy で stderr 出力 verify
- bundled がまだ新しいケースで no-op 確認

### 新規: `server.ts` instructions 回帰テスト

- `createServer()` が返す server の `instructions` に freshness warnings ガイダンスが含まれることを assert（LLM contract の配線確認）

### 回帰防止

- **β 回帰テスト**: egov の `freshness` が `'unknown'` 固定であることの assertion
- **time bomb 再発防止**: 既存 `vi.useFakeTimers` pattern を design doc で明文化、将来 index 追加時の参照とする

### カバレッジ目標

- `freshness-warnings.ts`: 100%（純粋 helper）
- `emitStartupWarnings` の MCP 配線: mock based smoke test で十分
- 既存 `index-metadata.test.ts` / `egov-index.test.ts`: β 対応後も green 維持

## リスクと軽減

| リスク | 軽減策 |
| --- | --- |
| β により egov meta の `freshness` 意味論が変わり、consumer が 'stale' を前提にしていたら挙動変化 | CHANGELOG に semantic change を明示、minor bump (0.3.0)、SPEC 更新で意図を明文化 |
| startup warning が cold start を遅延させる | helper は pure function、`sendLoggingMessage` のみ async。99th latency へのインパクトは無視できる |
| mhlw/jaish warning が毎 response 同梱されうるさい | 各 response は独立。Claude Code 等の client では 1 tool call 1 warning。ノイズ耐性は受容範囲 |
| `now` 注入忘れで新たな time bomb | 型で強制できないが、design doc と既存 test pattern で防御。code review での check |
| 60日閾値が実態の法改正サイクルに合わない場合の乖離 | 利用者 Feedback / observability metric（bundled_age_days 分布）で検証可能。カレンダー境界検知は将来 Issue で追跡 |
| LLM が instructions を無視し warnings を silent drop | instructions で surface を指示、message 本文も利用者向け完成文にすることで、仮に LLM が雑にそのまま流しても意味が通る冗長設計 |

## 後続 Issue（このスコープ外）

サブエージェントレビューで提案された以下の項目は、このスコープでは取り込まず別 Issue として追跡する：

1. **Opt-out env var** (`LABOR_LAW_MCP_SUPPRESS_FRESHNESS_WARNINGS=1`) — 意図的に古い bundle を使う利用者向け
2. **JST 日付表示** — 現状の YYYY-MM-DD は UTC 由来で最大 1 日のずれ。JST 変換で正確化
3. **MCP status resource** (`mcp://jp-labor-evidence-mcp/status`) — on-demand 状態照会の公式経路。reactive のみの現設計を proactive にする
4. **カレンダー境界による bundled age 判定** — 直近 4/1・10/1 を跨いだら即警告する閾値代替

## リリース

- バージョン: **0.3.0**（minor bump）
- CHANGELOG.md に以下を追加:

```markdown
## [0.3.0] - YYYY-MM-DD

### Changed

- egov bundled index は freshness モデルから除外し、`freshness: 'unknown'` を返すよう変更
- `STALE_INDEX` degraded reason は runtime index (mhlw/jaish) のみで発火するよう整理
- server の `instructions` に freshness warnings の扱い方ガイダンスを追記
- SPEC.md の freshness 関連記述を実装実態に揃えて更新

### Added

- bundled law registry が 60 日を超えた場合の warning を emit
  - startup 時に MCP logging (`level: warning`) + stderr で一次通知
  - egov を消費する全 tool の response `warnings[]` に毎回 merge
- `search_mhlw_tsutatsu` / `search_jaish_tsutatsu` 等 mhlw/jaish 消費 tool の response に、runtime index が stale の際の warnings を同梱
- `IndexSnapshotMeta.bundled_age_days` を egov 向けに露出、`get_observability_snapshot` に反映

### Internal

- 新規 helper `src/lib/indexes/freshness-warnings.ts`
```

## 出典

- 関連 commit: `ce0c799`（依存更新）、`2fa6e89`（test time-bomb 決定化）、`7f56a76`（spec 初版）
- SPEC drift 対象箇所: `SPEC.md:300`, `SPEC.md:624`, `SPEC.md:1199`
- 時限爆弾の本体: `src/lib/indexes/egov-index.ts:9` の `GENERATED_AT` literal
- サブエージェントレビュー: MCP 有識者視点（GREEN-LIGHT）、ユーザ視点（approve-with-edits, 4 blocker 採択）
