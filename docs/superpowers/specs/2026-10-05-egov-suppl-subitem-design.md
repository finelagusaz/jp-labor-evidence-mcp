# e-Gov 附則・号の下の細分（subitem）・号の番号の拡張 — 設計仕様

- 日付: 2026-10-05
- ステータス: **実装済み（0.8.0、§10 は 0.9.0）**
- 発端: upstream `kentaroajisaka/labor-law-mcp` 37e67f8「号の下のサブアイテムと附則に対応」（2026-09-14）。そのまま移植せず、こちらの tool 構成（`resolve_law` → `get_article` の段階分け）と出力の契約に合わせて設計し直す
- 関連: [2026-07-13-egov-pending-amendments-design.md](2026-07-13-egov-pending-amendments-design.md)（`pending_amendments[].amendment_law_num` と附則をつなぐ）

## 1. 動機

社労士の実務では、経過措置と施行期日を調べるために**附則**を引く場面が多い。いまの `get_article` は本則（`MainProvision`）しか探さず、附則を引く手段が無い（`article: "附則第1条"` は `not_found`）。

あわせて、報酬告示や基準省令では要件が**号の下のイロハ**（Subitem）で分岐する。いまは号を丸ごと返すしかない。号そのものも `item: number` なので、**枝番号の号**（`3の2`）を指定できない。さらに `paragraph` を省いて `item` を渡すと、`item` が**黙って無視され**、条全体が返る。

## 2. スコープ

**含む**:
- `get_article` に `supplementary`（附則の指定）と `subitem`（号の下の細分）を追加。`item` を文字列でも受け付ける
- 新しい tool `list_suppl_provisions`（附則の一覧。絞り込みと上限つき）
- 改正法の法令番号の正規化（2 つの表記の両方を受け付ける。§4.2）
- `paragraph` を省いた `item` の扱いを直す（§5.3）

**非目標**:
- `get_evidence_bundle` への附則・subitem の統合（後続）。あわせて、`get_evidence_bundle` / `diff_revision` の `canonical_id`・`article_locator` は入力の `paragraph` から組んでおり、§5.3 で特定した項を含めない（`get_article` は含める）。この差も後続で揃える
- deprecated の `get_law` の拡張（新機能は足さない）。ただし parser を共有しているため、§5.3 の「`paragraph` を省いた `item`」の修正は `get_law` にも及ぶ（いまは条全体を黙って返す → 項を特定して返すか、曖昧ならエラー）。挙動の変更として CHANGELOG `### Changed` に書く
- 附則と `/law_revisions` の施行日の突き合わせ（一覧に施行日を出すには追加の request が要る。後続）
- 改正法そのもの（附則の全文を持つ側）の取得

## 3. 一次証拠（2026-10-05、live `/law_data`）

| 法令 | 附則ブロック | うち制定時 | 条を持たない附則 | 抄 | 附則の中の条 | Subitem（最大深さ） |
|---|---|---|---|---|---|---|
| 労契法 | 4 | 1 | — | — | 6 | 0 |
| 労基法 | 59 | 1 | 13 | 51 | 131 | 6（1） |
| 安衛法 | 39 | 1 | — | — | 118 | 17（1） |
| 雇保法 | 70 | 1 | 5 | 66 | 264 | 52（2） |
| 厚年法 | 153 | 1 | — | — | 763 | 74（1） |
| 労基則 | 188 | 1 | 135 | 62 | 120 | 116（3） |

- 附則は `LawBody` 直下の `SupplProvision`。属性は `AmendLawNum`（制定時附則には無い）と `Extract`（`"true"` で抄）だけ。並びは制定時附則が先頭で、以降は古い順
- `AmendLawNum` の書き方: `令和八年六月二四日法律第四六号`（**位取りの漢数字**、公布日を含む）。`平成元年二月一〇日労働省令第一号` のように**元年**もある
- 登録 40 法令の `AmendLawNum` **3,018 件**を調べた: 位取りの漢数字として**全件**解析でき、`十` を含むものは 0 件、同じ法令の中で正規形（§4.1）が重なるものも 0 件
- 種別は `法律`（2,011）・`厚生労働省令`（484）・`労働省令`（378）・`政令`（142）のほか、`厚生省・労働省令`・`勅令` が各 1 件
- **公布日の年と法令番号の年が食い違う例**が 1 件ある: 労基則の `平成一二年八月一四日　平成一三年厚生労働省令第二号`（中央省庁再編の前に公布され、再編後の番号が付いたもの）。年は法令番号の側から取る
- こちらの `revision_metadata.amendment_law_num` / `pending_amendments[].amendment_law_num`（`/law_revisions` 由来）の書き方: `令和八年法律第四十六号`（**十を使う漢数字**、日付なし）
- 条を持たない附則（項だけ）が多い（労基則は 188 件中 135 件）。抄もほとんど（雇保法は 70 件中 66 件）
- 号の `Num` 属性は算用数字と `_`（`3_2`）、`ItemTitle` は漢数字（`三の二`）。Subitem の見出しは `イ` → `（１）` → `（ｉ）`（全角）
- 号が項をまたいで同じ番号を持つことがある（例: 第1項第2号と第3項第2号）

## 4. 改正法の法令番号

### 4.1 正規形（suppl key）

附則を識別する正規形を **suppl key** と呼ぶ。

- 制定時附則: `制定`
- 改正附則: `{元号}{年}年{種別}第{番号}号`（算用数字、公布日なし）。例: `令和8年法律第46号`、`平成元年労働省令第1号`
  - 年が 1 のときは `元年` と書く（法令の読み手が実際に使う表記）。入力では `1年` も `元年` も受け付ける
  - 年は**法令番号の側**から取る。`AmendLawNum` の先頭の公布日（`{元号}{年}年{月}月{日}日`）は取り除き、残りを解析する（§3 の食い違う例のため）

suppl key は出力（一覧・`get_article`・`canonical_id`）で使い、入力にもそのまま渡せる。

### 4.2 入力の照合（`parseLawNum`）

次のどれも同じ suppl key に正規化する:
- `令和八年六月二四日法律第四六号`（e-Gov の `AmendLawNum`。位取り、日付つき）
- `令和八年法律第四十六号`（`/law_revisions` の `amendment_law_num`。十を使う）
- `令和8年法律第46号`、`令和８年法律第４６号`、`令和元年…`

漢数字の変換（`kanjiToNumber`）は、十・百・千を**含めば十を使う形**、含まなければ**位取り**として読む（`四十六` → 46、`四六` → 46、`二十` → 20、`百二` → 102、`一〇` → 10、`元` → 1）。§3 の調査で、位取りの表記に `十` が混じる例は無い。変換できない文字列（号の見出しの `一及び二`・`一から三まで` など、削除された号の置き場）は例外を投げず `undefined` を返す。

`parseLawNum(input)` は `{ era, year, kind?, number?, promulgated? }` を返す（解析できなければ `undefined`）。照合の規則:
- `get_article.supplementary`: 元号・年・番号が必須
- `list_suppl_provisions.amendment_law_num`: 元号・年だけでもよい（その年の附則をすべて返す）。番号があれば番号も照合する
- 種別（`法律`・`政令`・`厚生労働省令` など）は、入力に書かれていれば一致を要求し、無ければ問わない
- 入力が `制定` / `制定時` なら制定時附則
- 一致が 0 件 → `NotFoundError`（一覧 tool を案内）。2 件以上 → `ValidationError` で候補の suppl key を列挙する。推測で 1 件に絞らない
- 入力を解析できない → `ValidationError`（受け付ける書式の例を示す）

## 5. `get_article` の拡張

### 5.1 入力

| 項目 | 変更 | 説明 |
|---|---|---|
| `article` | required → **optional** | `supplementary` が無いときは必須（実行時に検査）。附則で省いた場合は、附則ブロックの直下を対象にする（§5.3） |
| `supplementary` | 追加 `string` | `制定` または改正法の法令番号（§4.2）。`pending_amendments[].amendment_law_num` や `revision_metadata.amendment_law_num` をそのまま渡せる |
| `item` | `number` → `number \| string` | `3`, `"3の2"`, `"三の二"`, `"六"`。数値の指定はこれまでどおり |
| `subitem` | 追加 `string` | `"イ"`, `"イ (1)"`, `"イ-(1)-(i)"`。`item` が必須 |

`article` に `附則第1条` のような形が来て `supplementary` が無い場合は、`ValidationError` で `supplementary` の使い方を示す（いまの `not_found` より親切にする）。

### 5.2 出力

- `data.supplementary?: { key: string; amend_law_num?: string; extract: boolean }`（附則のときだけ）。`amend_law_num` は e-Gov の `AmendLawNum` をそのまま返す
- `data.article` は optional に、`data.item` は `number | string` に、`data.subitem?: string` を追加
- `data.paragraph` は、`paragraph` を省いて `item` から項を特定したとき、その項番号を返す（§5.3）
- `title`: `労働基準法 附則（令和8年法律第46号・抄）第1条第2項第3号イ`
- `canonical_id`: `egov:{law_id}:suppl:{key}[:article:{n}][:paragraph:{n}][:item:{n}][:subitem:{path}]`。本則はこれまでどおり（`subitem` が付くときだけ末尾に足す）
- `version_info` / `revision_metadata` / 警告は本則と同じ（法令全体の版に関する情報）
- 抄は `supplementary.extract` と `title` の「抄」で示し、警告にはしない（附則のほとんどが抄で、警告にすると常に出てしまう。抄で省かれているのは主に他の法令への改正部分）

### 5.3 号・subitem の探し方（parser）

- 本則と附則で同じ探し方を使う（`extractArticleFromScope(scope, …)`）。附則では `supplementary` で選んだ `SupplProvision` が scope
- **条を持たない附則**（労基則では 188 件中 135 件）: `supplementary` があり `article` を省いたときは、`paragraph` / `item` / `subitem` を附則ブロック直下の `Paragraph` に対して解決する。どれも省けば附則ブロック全体を返す。条を持つ附則で `article` を省いた場合も附則ブロック全体を返す（`paragraph` 以下を指定したら、条を指定するよう `ValidationError`）。upstream は `article` が無いと `paragraph` を無視するが、こちらはしない
- 号の照合: `Num` 属性を正規化した値と、`ItemTitle` の漢数字を算用数字にした値の両方で比べる
- `paragraph` を省いて `item` を渡したとき: 全項から、号（`subitem` があれば細分まで）の経路が一致するものを探す。1 件ならその項を使い `data.paragraph` に返す。**2 件以上なら `ValidationError`** で一致した項番号を示す。0 件なら `not_found`。号の番号だけでは複数の項に一致しても、`subitem` まで含めた経路が 1 件に決まれば一意とみなす（例: 労基則 第7条の2 の第2号は第1項と第2項にあるが、「ロ（１）」を持つのは第1項だけ）
- subitem: `Subitem1` → `Subitem2` → `Subitem3` と深さ順にたどる。各階層で `Num` と見出し（全角・括弧を正規化）の両方で比べる
- subitem の正規形: 入力（`"イ (1)"`、`"イ-(1)-(i)"`、`"イ（１）（ｉ）"` など）を階層に分け、各階層を NFKC → 括弧と空白を除く → 小文字にして `/` で結ぶ（例: `イ/1/i`）。`canonical_id` と `data.subitem` はこの正規形を使う

## 6. 新しい tool `list_suppl_provisions`

### 6.1 入力

| 項目 | 説明 |
|---|---|
| `law_id` | 必須 |
| `amendment_law_num` | 任意。§4.2 と同じ照合。年だけ（`令和8年`）なら、その年の附則をすべて返す |
| `limit` | 任意。既定 30、最大 200 |
| `offset` | 任意。既定 0 |

### 6.2 出力

- `items[]`: 新しい順。`AmendLawNum` の公布日（元号・年・月・日）と番号で並べる。公布日を解析できないときだけ e-Gov の並び（古い順）の位置で補う。各要素は `{ key, amend_law_num?, extract, article_nums: string[], paragraph_count }`。`article_nums` は先頭 20 件までにし、`article_count` を併記する
- `total`（絞り込み後の件数）、`has_more`
- 制定時附則は最も古いので、既定の上限では一覧から外れることがある。`supplementary: "制定"` で直接引けることを description に書く
- `version_info` / `revision_metadata` / 鮮度の警告は `get_article` と同じく付ける

## 7. テスト

- `parseLawNum`: 位取り・十つき・算用数字・全角・元年・種別の有無・解析できない入力
- 号の照合: `3`, `"3の2"`, `"三の二"`, `"六"`, `"十二の五の二"`。`paragraph` を省いたとき 1 件・2 件以上・0 件
- subitem: 深さ 1〜3、全角の見出し、`item` 無しの拒否
- 附則: 制定時・改正（2 つの表記）・条を持たない附則・候補が複数・該当なし
- `canonical_id` と `title` の形
- fixture: 労基法・労基則の live `/law_data` から必要な部分だけを切り出したもの（全体は 283KB / 551KB と大きいため）
- live: 主要法令で `list_suppl_provisions` と、`pending_amendments` の `amendment_law_num` をそのまま渡す経路を確かめる

## 8. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| tool の形 | `get_article` 拡張 + 一覧の新 tool（user 決定 2026-10-05） | 「law_id を確定してから条文を取る」流れと、`version_info` などの既存の仕組みをそのまま使える |
| 一覧の量 | 絞り込み + 上限、新しい順（user 決定） | 厚年法は 153 件。経過措置を調べる場面では直近の改正附則が求められることが多い |
| 号の番号 | 文字列・枝番号・漢数字を受け付ける（user 決定） | subitem は item を前提にするため、ここを直さないと指定できない号が残る |
| 法令番号の表記 | 位取り・十つきの両方を同じ suppl key に正規化 | upstream は位取りだけで、こちらの `amendment_law_num`（十つき）から附則へつながらない |
| 照合が曖昧なとき | 候補を示してエラー | 推測で 1 件に絞らない（PreviousEnforced 対応と同じ方針） |
| 抄 | フィールドと見出しで示し、警告にしない | ほとんどの附則が抄で、警告が常に出るため |
| 元年 | suppl key では `元年` と書き、入力は `1年` も受け付ける | 法令の読み手が実際に使う表記 |
| 法令番号の年 | 公布日ではなく法令番号の側から取る | 公布日の年と食い違う実例がある（§3） |
| 条を持たない附則 | 附則ブロック直下の項・号・細分を指定できる | 附則の多数派（労基則 135/188）で、施行期日と経過措置が項に分かれている |

## 9. リリース

新しい tool と入力の追加なので **minor（0.8.0）**。spec の承認後、`docs/superpowers/plans/` に TDD の task 単位の実装計画を書いてから実装する（parser の共有部分を作り替えるため、順序が効く）。

## 10. 追補: `get_evidence_bundle` への統合と canonical_id の揃え（0.9.0 で実装、2026-10-06）

### 一次証拠（live の厚労省通達検索）

| 検索キーワード | 結果 |
|---|---|
| `平成30年法律第71号` / `平成三十年法律第七十一号`（改正法の法令番号） | `unavailable`（0 件） |
| `働き方改革を推進するための関係法律の整備に関する法律`（改正法の題名） | 14 件。上位はいずれも施行通達 |
| `施行期日` / `経過措置`（附則の典型的な条見出し） | 2,777 件 / 2,490 件。上位は無関係 |

### 決定

| 論点 | 決定 | 理由 |
|---|---|---|
| bundle の入力 | `get_article` と同じ `supplementary` / `subitem` / 文字列の `item` を受ける。`article` は `supplementary` があれば省ける | 主条文の取得経路は `getArticleByLawId` を共有している |
| 附則のときの検索キーワード | 条番号由来のキーワード（`労働基準法 第1条`）・条番号ごとの実務キーワード・条見出しを使わない。改正附則なら `/law_revisions` の `amendment_law_title`（改正法の題名）を先頭に置く。制定時附則は法令名のみ | 条番号由来のキーワードは本則の同じ番号の条を指してしまう。附則の条見出しはほとんどが決まり文句で雑音になる。改正法の題名は施行通達に直結する |
| 改正法の題名の取得 | 附則の key と `amendment_law_num` を `law-num` の正規形で照合する。取得に失敗したら `partial_failures` に記録して続ける。一覧に無ければキーワードを足さないだけ | bundle の他の関連取得と同じ扱い |
| 本文由来のキーワード | `施行期日`・`経過措置` を除外語に加える | 附則の本文は `#### （施行期日）` で始まり、そのまま拾われるため |
| `title` / `canonical_id` | `get_article` と同じ組み立て（`src/lib/article-locator.ts` に共有）。特定した項・号の正規形・細分を含める | 同じ条文に同じ識別子を付ける |
| `article_locator` | `article` を optional に、`item` を `number \| string` に、`subitem`・`supplementary`（key）を追加。`paragraph` は特定した項 | 機械可読の位置情報も `canonical_id` と一致させる |
| `diff_revision` | `canonical_id`・`paragraph` に特定した項を含める。改正前後で特定した項が食い違ったら警告 `DIFF_PARAGRAPH_MISMATCH` | `paragraph` を省いた号は、改正で別の項へ移ると前後で別の項に解決され、異なる項を黙って比べてしまう |

