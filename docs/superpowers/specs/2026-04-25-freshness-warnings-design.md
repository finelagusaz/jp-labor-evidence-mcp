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
| egov bundled age 警告閾値 | **90 日** |
| mhlw/jaish TTL | **uniform 7 日を維持**。source 別 TTL は SPEC 上「将来最適化項目」として明記 |
| 通知チャネル (egov) | **MCP logging notification (`level: warning`) + stderr**、startup 時 1 回 |
| 通知チャネル (mhlw/jaish) | **tool response envelope の `warnings` に merge** |
| 実装構造 | **Approach A: 直接的な tool-level integration**。helper は `src/lib/indexes/freshness-warnings.ts` に抽出 |
| Degraded 扱い | bundled age 超過は `degraded` にしない（`warning` 止まり）。runtime stale は既存 `STALE_INDEX` を維持 |

### 設計根拠の要点

- **β の採択理由**: bundled data の「古さ」は「再同期せよ」という action 誘導として成立せず、取れる action が `npm update` のみ。`freshness: 'stale'` を runtime index（再同期可能）と bundled index（コード更新必須）で同じ semantic にするのは誤り
- **90日の根拠**: 法令改正の実態頻度（四半期〜半年）と npm update の心理的サイクル（月次〜四半期）の中間。攻めすぎず緩すぎず
- **uniform 7日維持の根拠**: SPEC の「source 別 TTL」要件には応えたいが、mhlw/jaish それぞれの実際の更新頻度についての観測データが不足。推測で差を付けるより、現行 uniform で運用しつつ将来の observability 蓄積を待つのが誠実

## アーキテクチャ

### 新規モジュール: `src/lib/indexes/freshness-warnings.ts`

純粋な helper。外部 state を保持せず、入力（現在時刻、index meta）に対して出力（warning 配列）を返す決定論的な関数群。

```ts
export const BUNDLED_AGE_THRESHOLD_DAYS = 90;

export type FreshnessWarning = {
  code: 'BUNDLED_INDEX_AGED' | 'RUNTIME_INDEX_STALE';
  source: 'egov' | 'mhlw' | 'jaish';
  message: string;
};

export function getBundledIndexWarnings(now?: number): FreshnessWarning[];
export function getRuntimeIndexWarnings(
  source: 'mhlw' | 'jaish',
  now?: number
): FreshnessWarning[];
export function emitStartupWarnings(
  server: McpServer,
  now?: number
): Promise<void>;
```

`now` 引数を公開し default を `Date.now()` とすることで、単体テストで時刻注入できる。これは `src/lib/indexes/index-metadata.ts:153` の `inferFreshness(generatedAt, now = Date.now())` と同じ pattern。

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

### Tool 統合

`src/tools/search-mhlw-tsutatsu.ts` と `src/tools/search-jaish-tsutatsu.ts` の handler で、envelope 組み立て時に helper を呼び `warnings` に merge。

`ToolEnvelope.warnings` は `WarningMessage[]` (= `{ code: string; message: string }[]`、`src/lib/tool-contract.ts:15-18` で定義済み)。`FreshnessWarning` から `source` を除いた `{ code, message }` ペアに写像する。

```ts
// 概念コード
const warnings = [
  ...existingWarnings,
  ...getRuntimeIndexWarnings('mhlw').map(({ code, message }) => ({ code, message })),
];
```

tool envelope schema 自体は変更不要（`warnings` フィールドは既存、`FreshnessWarning.code` は自由文字列で `warningSchema` に適合）。

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

「1 回だけ」保証は `main()` 起動時 1 回の呼出に依存。global dedup state は不要。

### Observability 統合

`src/tools/get-observability-snapshot.ts` の `indexes` schema に `bundled_age_days: z.number().optional()` を追加。Markdown 整形 (`indexLines`) にも `bundled_age_days=...` トークンを追加。

`src/lib/observability.ts:336-342` の `STALE_INDEX` 判定は**コード変更不要**。egov が `freshness: 'unknown'` に固定されることで条件を満たさなくなり、mhlw/jaish のみが `STALE_INDEX` を誘発する設計となる。

### SPEC.md 更新

| 箇所 | 現状 | 更新内容 |
| --- | --- | --- |
| §8 l.300 | "freshness を返す内部索引モデルがない" | 削除（Phase 4 で実装済み） |
| §13.3 | 「各索引データには更新時刻を持たせる」 | 追記: bundled source は freshness モデルから除外、`bundled_age_days` を別途露出、runtime source のみ `fresh/stale/unknown` で判定 |
| §14.2.6 l.1199 | "source 別 TTL を固定する" | 現実化: runtime index は uniform 7日を暫定 TTL、source 別 TTL は将来最適化項目として明記 |
| 新規 §14.x | （なし） | bundled index age 警告の仕様: 90日閾値、通知チャネル（startup MCP logging + stderr）、対象は egov のみ |

## エラーハンドリング

- `freshness-warnings.ts` の helper は**throw しない**。不正入力、時刻計算の NaN 等は `return []` で黙認
- `emitStartupWarnings` は `sendLoggingMessage` の reject を try/catch で包み swallow。stderr は無条件実行
- tool handler での warnings merge は同期処理、失敗経路なし

## テスト戦略

### 新規: `tests/freshness-warnings.test.ts`

helper の純粋関数をユニットテスト。時刻注入で決定論的に。

- `getBundledIndexWarnings`: 89日以下は `[]`、90日超で `BUNDLED_INDEX_AGED` 付き warning
- `getRuntimeIndexWarnings`: 7日境界の前後
- メッセージに「npm update」等の具体的 action 誘導が含まれる

### 既存修正: `tests/egov-index.test.ts`

```diff
-expect(result.meta.freshness).toBe('fresh');
+expect(result.meta.freshness).toBe('unknown');
+expect(result.meta.bundled_age_days).toBe(0);
```

### 新規 / 既存修正: tool response 統合テスト

- mhlw/jaish index を stale 状態にした fixture で search tool を呼び、envelope `warnings` にメッセージが含まれることを assert
- fresh 状態では runtime index 由来の warning が含まれないことも verify

### 新規 / 既存修正: observability snapshot テスト

- `bundled_age_days` が egov のみに present、mhlw/jaish には absent
- Markdown 出力の egov 行に `bundled_age_days=` トークンが現れる

### 新規: `emitStartupWarnings` smoke test

- mock server で `sendLoggingMessage` の呼出回数と引数を verify
- `console.error` spy で stderr 出力 verify
- bundled がまだ新しいケースで no-op 確認

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

## リリース

- バージョン: **0.3.0**（minor bump）
- CHANGELOG.md に以下を追加:

```markdown
## [0.3.0] - YYYY-MM-DD

### Changed

- egov bundled index は freshness モデルから除外し、`freshness: 'unknown'` を返すよう変更
- `STALE_INDEX` degraded reason は runtime index (mhlw/jaish) のみで発火するよう整理
- SPEC.md の freshness 関連記述を実装実態に揃えて更新

### Added

- bundled law registry が 90 日を超えた場合の startup warning（MCP logging + stderr）
- `search_mhlw_tsutatsu` / `search_jaish_tsutatsu` の tool response に、runtime index が stale の際の warnings を同梱
- `IndexSnapshotMeta.bundled_age_days` を egov 向けに露出、`get_observability_snapshot` に反映

### Internal

- 新規 helper `src/lib/indexes/freshness-warnings.ts`
```

## 出典

- 関連 commit: `ce0c799`（依存更新）、`2fa6e89`（test time-bomb 決定化）
- SPEC drift 対象箇所: `SPEC.md:300`, `SPEC.md:624`, `SPEC.md:1199`
- 時限爆弾の本体: `src/lib/indexes/egov-index.ts:9` の `GENERATED_AT` literal
