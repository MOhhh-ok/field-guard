# field-guard — Claude Code 用プロジェクトメモ

TypeScript 製の field-level access control ライブラリ。zero runtime deps が core の制約。

## パッケージマネージャ

**bun**。`npm` / `pnpm` は使わない。

- テスト: `bun run test`
- ビルド: `bun run build` (= `tsc`)
- 依存追加: `bun add <pkg>` / `bun add -d <pkg>` (dev)

## 設計原則

- **core (`src/index.ts` 経由の export) は ORM / 外部ライブラリへ依存しない**
- ORM 固有の機能を入れたい場合は **sub-export** に分離する (例: `src/<orm>.ts` → `field-guard/<orm>`)
- 該当 ORM は **`peerDependencies` + `peerDependenciesMeta.optional: true`** で peer optional
- API は最小に保つ。「ちょっと便利」のために core を肥大化させない

## スコープ: field-level に限定する

このライブラリは **「行内のどの列が読めるか」 (field-level visibility)** だけを扱う。
**「どの行が読めるか」 (row-level access)** は意図的に扱わない。

### 行レベルを扱わない理由 (検討済み、再提案しない)

過去に `unstable_withRowPolicy` + `field-guard/drizzle` adapter で「policy →
Drizzle の WHERE 自動生成」を試作したが revert した。理由:

- **JOIN / `db.query` (relational API) / サブクエリ / CTE / raw SQL** のどこかで必ず穴が空き、外部ライブラリから漏れなく行を絞ることは不可能
- 「効いてる気がするけど効いていない」は**無い方がマシ**な footgun
- 本物の行レベル防御は **Postgres RLS** か **Drizzle 本体への政策レイヤー追加**の領分

将来「行レベルを入れたい」と思ったら、まずこのセクションを読み直すこと。
過去の経緯: revert commit と feat commit を `git log --grep="行レベル"` で確認できる。

### 行レベルが本当に必要な利用者へ案内するもの

- **Postgres RLS** + Drizzle の `pgPolicy` primitive (schema 定義に書く)
- session 変数 (`SET LOCAL app.user_id = ...`) で current actor を渡す
- field-guard はその上に**列の可視性レイヤー**として乗る (defense-in-depth)

## セキュリティ方針

- **deny-by-default**。permissive な暗黙挙動を導入しない
- 「省略 = 全許可」は地雷。宣言は `Record<L, ...>` で必須化してコンパイルエラーで防ぐ
- ORM の WHERE 自動注入のような「magic」は core に入れない (上記スコープ参照)

## テスト規約

- 場所: `src/__tests__/`
- ランナー: vitest (bun 経由)
- **`__tests__` は `tsconfig.json` の `exclude` に入っている**。つまり `tsc` (= `bun run build`) では型検査されない
- `@ts-expect-error` ディレクティブは **IDE 用ドキュメンタリ**。`tsc` 単体実行では false-positive (TS2578 "Unused") が出ることがあるが、フルプロジェクト文脈の IDE では正しく動く
- 型安全テストでは `@ts-expect-error` + 該当行アクセス、または runtime の `"key" in result` で挙動を検証する

## 既存型の挙動

`GuardChain` の `R` ジェネリックは `Record<string, never>` をベースにしている。

- `R & { foo: T }` 形式の intersection は chain 経由 (`.for(ctx)` 経由) では正しく解決される
- ただし `Record<string, never> & { foo: T }` を**変数として直接書く**と `foo` が `never` に潰れる事象がある (TS の意図的な挙動)
- 既存 API を壊すリスクを取らず、現在は維持。型が `never` に潰れていないかは `const t: ExpectedType = result.foo` で確認する

## ドキュメント

- README / SKILL は **配布物**。試験 API は載せない (安定化後に追加)
- `skills/SKILL.md` は `npx skills add mohhh-ok/field-guard` で他人の agent に取り込まれる公開コンテンツ。`package.json` の `files` に入っている
- `CLAUDE.md` (このファイル) は **このリポ内 Claude Code 専用**。`files` に含めず npm 配布しない

## リリース

- `release-it` + `@release-it/conventional-changelog` で運用
- conventional commits 必須 (`feat:` / `fix:` / `chore:` / `test:` / `docs:` / `refactor:` 等)
- `prepublishOnly` で `bun run test && bun run build` が自動実行される

## CI

- GitHub Actions
- Dependabot の minor / patch は auto-merge 設定済み
