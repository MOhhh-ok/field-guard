import { describe, expect, test } from "vitest";
import { defineGuard } from "../../defineGuard";
import type { RowPolicyAdapter } from "../../types";

type Pred =
  | { kind: "raw"; value: string }
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "or"; preds: Pred[] };

const mockAdapter: RowPolicyAdapter<Pred> = {
  combine: (preds: Pred[]): Pred => ({ kind: "or", preds }),
  always: (): Pred => ({ kind: "always" }),
  never: (): Pred => ({ kind: "never" }),
};

const raw = (value: string): Pred => ({ kind: "raw", value });

type Ctx = { userId: string; role: "admin" | "user" };

describe("defineGuard - unstable_withRowPolicy", () => {
  test("adapter 無しなら unstable_withRowPolicy は型に出ず unstable_where も runtime に無い", () => {
    const guard = defineGuard<Ctx>()({
      fields: ["id", "name"],
      policy: { public: true },
    });

    // @ts-expect-error - adapter 未設定なので unstable_withRowPolicy は無い
    guard.unstable_withRowPolicy;

    const result = guard.for({ userId: "1", role: "user" });
    expect("unstable_where" in result).toBe(false);
  });

  test("adapter 有り + withRowPolicy 未呼び出しでは unstable_where が runtime に無い", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id", "name"],
      policy: { public: true },
    });

    const result = guard.for({ userId: "1", role: "user" });
    expect("unstable_where" in result).toBe(false);
  });

  test("使える level の predicate を combine (OR) する", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id", "content", "authorId"],
      policy: {
        owner: true,
        other: { id: true, content: true },
      },
    }).unstable_withRowPolicy(({ ctx }) => ({
      owner: raw(`authorId = ${ctx.userId}`),
      other: raw("status = 'published'"),
    }));

    const result = guard.for({ userId: "42", role: "user" });
    expect(result.unstable_where).toEqual({
      kind: "or",
      preds: [
        { kind: "raw", value: "authorId = 42" },
        { kind: "raw", value: "status = 'published'" },
      ],
    });
  });

  test("level を省略するとコンパイルエラー (型レベル必須)", () => {
    defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id", "content"],
      policy: { owner: true, other: { id: true } },
      // @ts-expect-error - "other" を省略しているのでコンパイルエラー
    }).unstable_withRowPolicy(({ ctx }) => ({
      owner: raw(`authorId = ${ctx.userId}`),
    }));
  });

  test("全行該当は adapter.always() を明示宣言する", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id", "content"],
      policy: { owner: true, other: { id: true } },
    }).unstable_withRowPolicy(({ ctx, adapter }) => ({
      owner: raw(`authorId = ${ctx.userId}`),
      other: adapter.always(),
    }));

    const result = guard.for({ userId: "7", role: "user" });
    expect(result.unstable_where).toEqual({
      kind: "or",
      preds: [
        { kind: "raw", value: "authorId = 7" },
        { kind: "always" },
      ],
    });
  });

  test("許可列 0 個の level (false) は WHERE 合成から除外される", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id", "content"],
      policy: {
        owner: true,
        blocked: false, // 許可列 0
      },
    }).unstable_withRowPolicy(({ ctx }) => ({
      owner: raw(`authorId = ${ctx.userId}`),
      blocked: raw("never-mind"),
    }));

    const result = guard.for({ userId: "1", role: "user" });
    expect(result.unstable_where).toEqual({
      kind: "or",
      preds: [{ kind: "raw", value: "authorId = 1" }],
    });
  });

  test("使える level が 0 個なら never() (deny by default)", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id"],
      policy: {
        blocked: false,
      },
    }).unstable_withRowPolicy(() => ({
      blocked: raw("anything"),
    }));

    const result = guard.for({ userId: "1", role: "user" });
    expect(result.unstable_where).toEqual({ kind: "never" });
  });

  test("policy が空のときも never() (deny by default)", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
    }).unstable_withRowPolicy(() => ({}));

    const result = guard.for({ userId: "1", role: "user" });
    expect(result.unstable_where).toEqual({ kind: "never" });
  });

  test("withRowPolicy 呼び出し後は 2 回目を型レベルで disallow", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id"],
      policy: { a: true },
    }).unstable_withRowPolicy(() => ({ a: raw("p") }));

    // @ts-expect-error - withRowPolicy は 1 度のみ
    guard.unstable_withRowPolicy;
  });

  test("rowPolicy fn に adapter が渡る (never() を明示宣言できる)", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id"],
      policy: { a: true, b: true },
    }).unstable_withRowPolicy(({ adapter }) => ({
      a: raw("self"),
      b: adapter.never(), // 「この level は誰も該当しない」を明示
    }));

    const result = guard.for({ userId: "1", role: "user" });
    expect(result.unstable_where).toEqual({
      kind: "or",
      preds: [{ kind: "raw", value: "self" }, { kind: "never" }],
    });
  });

  test("withDerive / withCheck と共存できる", () => {
    type Post = { id: string; authorId: string };
    const guard = defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id", "authorId"],
      policy: {
        owner: true,
        other: { id: true },
      },
    })
      .withDerive(({ ctx }) => ({ isAdmin: ctx.role === "admin" }))
      .withCheck<Post>()(({ ctx, target, verdictMap }) =>
        verdictMap[ctx.userId === target.authorId ? "owner" : "other"]
      )
      .unstable_withRowPolicy(({ ctx, adapter }) => ({
        owner: raw(`authorId = ${ctx.userId}`),
        other: adapter.always(),
      }));

    const result = guard.for({ userId: "10", role: "admin" });
    expect(result.isAdmin).toBe(true);
    expect(result.unstable_where).toEqual({
      kind: "or",
      preds: [{ kind: "raw", value: "authorId = 10" }, { kind: "always" }],
    });
    expect(result.check({ id: "p1", authorId: "10" }).allowedFields).toEqual(["id", "authorId"]);
    expect(result.check({ id: "p2", authorId: "99" }).allowedFields).toEqual(["id"]);
  });

  test("rowPolicy の keys は policy の level に型で縛られる (typo はコンパイルエラー)", () => {
    defineGuard<Ctx>()({
      unstable_adapter: mockAdapter,
      fields: ["id"],
      policy: { owner: true, other: { id: true } },
      // @ts-expect-error - "ownr" は policy に無く "other" も欠落しているのでコンパイルエラー
    }).unstable_withRowPolicy(() => ({
      owner: raw("owner-pred"),
      ownr: raw("typo"),
    }));
  });
});
