# field-guard — Claude Code 用プロジェクトメモ

TypeScript 製の field-level access control ライブラリ。zero runtime deps が core の制約。

## パッケージマネージャ

**bun**。`npm` / `pnpm` は使わない。

- テスト: `bun run test`
- ビルド: `bun run build` (= `tsc`)
- 依存追加: `bun add <pkg>` / `bun add -d <pkg>` (dev)

## 設計原則

- **core (`src/index.ts` 経由の export) は ORM / 外部ライブラリへ依存しない**
- ORM 固有の機能は **sub-export** に分離 (例: `src/drizzle.ts` → `field-guard/drizzle`)
- 該当 ORM は **`peerDependencies` + `peerDependenciesMeta.optional: true`** で peer optional
- API は最小に保つ。「ちょっと便利」のために core を肥大化させない

## 試験 API の命名規約

安定化前の API は **`unstable_` プレフィックス** を全識別子に付ける (React の慣習)。

- params キー: `unstable_adapter`
- chain メソッド: `unstable_withRowPolicy`
- 関数 / factory: `unstable_drizzleAdapter`
- 結果のプロパティ: `unstable_where`

安定化時は **1 PR で全プレフィックスを一斉に外す**。旧名は 1 minor だけ deprecated alias で残す。

`unstable_` が付いた識別子は patch / minor で破壊的変更を入れて良い (semver 上の例外的扱い、CHANGELOG に明記)。

## セキュリティ方針

- **deny-by-default**。permissive な暗黙挙動を導入しない
- 「省略 = 全許可」は地雷。policy / row-rule の宣言は **`Record<L, P>` で必須化**して書き忘れをコンパイルエラーにする
- ORM の WHERE 自動注入のような「magic」は core に入れない (型 / join / subquery / raw のどこかで穴が空く)。代わりに adapter 抽象で利用側に責任を残す

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
