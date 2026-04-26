# Contributing

`jp-labor-evidence-mcp` への貢献に関心をお寄せいただきありがとうございます。本ドキュメントはメンテナ向けに、リリース運用と公開前チェックの手順をまとめています。

## bug report / feature request

GitHub の [issue template](https://github.com/finelagusaz/jp-labor-evidence-mcp/issues) からお願いいたします。upstream の `kentaroajisaka/labor-law-mcp` には issue を立てないでください。

## 開発フロー

```bash
git clone https://github.com/finelagusaz/jp-labor-evidence-mcp.git
cd jp-labor-evidence-mcp
npm install
```

主要コマンド:

| コマンド | 用途 |
|---|---|
| `npm run dev` | tsx で `src/index.ts` を hot iteration |
| `npm test` | vitest によるユニットテスト |
| `npm run test:watch` | watch mode |
| `npm run build` | tsc で `dist/` にビルド |
| `npm run sync:indexes` | 内部 index の full sync |
| `npm run release:check` | npm publish 前の必須 gate |

## npm 公開前チェック

```bash
npm run release:check
```

このチェックは以下を順に実行します。

- `npm test`
- `npm run build`
- `npm pack --dry-run --cache ./.npm-pack-cache`

公開時は npm 側で package 名の空き確認、`npm login`、必要なら 2FA / access token の準備が別途必要です。

## リリース運用

1. PR review pass → `main` にマージ
2. [CHANGELOG.md](./CHANGELOG.md) の `## [x.y.z] - YYYY-MM-DD` の placeholder を実日付に置換
3. version bump は **2 箇所** 同時に: `package.json` と `src/server.ts` の `version: '...'`
4. `npm run release:check` で最終検証
5. `npm publish`（`prepublishOnly` で `release:check` が再実行されます）
6. GitHub tag / Release も合わせて作成

変更履歴は [Keep a Changelog](https://keepachangelog.com/) 形式で [CHANGELOG.md](./CHANGELOG.md) に記録します。

## トラブルシューティング

### `ENTRY_COUNT_DROP_TOO_LARGE` でテストが失敗する

永続 disk state（`.jp-labor-evidence-indexes/`）の不整合が原因のことがあります。

```bash
rm -rf .jp-labor-evidence-indexes
npm test
```

### 索引 sync が並行実行で拒否される

`sync:indexes` は lock file による排他制御を行います。実行中の sync が完了するか、stale lock を確認した上で再実行してください。
