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

| コマンド                | 用途                                   |
|-------------------------|----------------------------------------|
| `npm run dev`           | tsx で `src/index.ts` を hot iteration |
| `npm test`              | vitest によるユニットテスト            |
| `npm run test:watch`    | watch mode                             |
| `npm run build`         | tsc で `dist/` にビルド                |
| `npm run sync:indexes`  | 内部 index の full sync                |
| `npm run release:check` | npm publish 前の必須 gate              |

## npm 公開前チェック

```bash
npm run release:check
```

このチェックは以下を順に実行します。

- `npm test`
- `npm run build`
- `npm pack --dry-run --cache ./.npm-pack-cache`

このチェックは CI（`.github/workflows/ci.yml`、Node 24/26）と `prepublishOnly` の両方で実行されます。

## リリース運用

リリースは GitHub Actions（`.github/workflows/release.yml`）が npm Trusted Publishing（OIDC）で自動 publish します。npm token や 2FA は不要で、provenance 署名が付きます。

1. version bump PR を作成: `package.json` と `src/server.ts` の `SERVER_VERSION` を更新し、`npm install` で `package-lock.json` を同期
2. 同じ PR で [CHANGELOG.md](./CHANGELOG.md) に `## [x.y.z] - YYYY-MM-DD` を**実日付**で追記（merge = release のため placeholder は使わない）
3. CI（test + build + pack）が通ったら `main` にマージ
4. `release.yml` が未公開 version を検知して `npm publish --provenance`、`vX.Y.Z` タグ、GitHub Release を自動作成（公開済み version ならスキップ）
5. `npm view jp-labor-evidence-mcp version` で公開を確認

手動 publish は fallback のみです。その場合は `npm publish` 時に 2FA 認証が必要です。

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
