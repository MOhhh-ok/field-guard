import { eq, sql } from "drizzle-orm";
import { integer, pgTable, serial, text, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import { defineGuard } from "../defineGuard";
import { unstable_drizzleAdapter } from "../drizzle";

const users = pgTable("users", {
  id: serial("id").primaryKey(),
});

const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  authorId: integer("author_id").references(() => users.id),
});

const dialect = new PgDialect();

type Ctx = { userId: number; role: "admin" | "user" };

describe("unstable_drizzleAdapter", () => {
  test("adapter は combine/always/never を持つ", () => {
    const adapter = unstable_drizzleAdapter();
    expect(typeof adapter.combine).toBe("function");
    expect(typeof adapter.always).toBe("function");
    expect(typeof adapter.never).toBe("function");
  });

  test("always() は SQL 'true'", () => {
    const adapter = unstable_drizzleAdapter();
    const { sql: rendered } = dialect.sqlToQuery(adapter.always());
    expect(rendered).toBe("true");
  });

  test("never() は SQL 'false'", () => {
    const adapter = unstable_drizzleAdapter();
    const { sql: rendered } = dialect.sqlToQuery(adapter.never());
    expect(rendered).toBe("false");
  });

  test("combine([p1, p2]) は OR で連結", () => {
    const adapter = unstable_drizzleAdapter();
    const combined = adapter.combine([sql`a = 1`, sql`b = 2`]);
    const { sql: rendered } = dialect.sqlToQuery(combined);
    expect(rendered).toBe("(a = 1 or b = 2)");
  });

  test("combine([]) は always 相当 (true)", () => {
    const adapter = unstable_drizzleAdapter();
    const combined = adapter.combine([]);
    const { sql: rendered } = dialect.sqlToQuery(combined);
    expect(rendered).toBe("true");
  });

  test("defineGuard と統合: owner + other で OR の WHERE が生成される", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: unstable_drizzleAdapter(),
      fields: ["id", "content", "authorId"],
      policy: {
        owner: true,
        other: { id: true, content: true },
      },
    }).unstable_withRowPolicy(({ ctx, adapter }) => ({
      owner: eq(posts.authorId, ctx.userId),
      other: adapter.always(),
    }));

    const g = guard.for({ userId: 42, role: "user" });
    const { sql: rendered, params } = dialect.sqlToQuery(g.unstable_where);

    expect(rendered).toBe(
      `("posts"."author_id" = $1 or true)`,
    );
    expect(params).toEqual([42]);
  });

  test("全 level が許可列ゼロなら never() (deny by default)", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: unstable_drizzleAdapter(),
      fields: ["id"],
      policy: { blocked: false },
    }).unstable_withRowPolicy(({ adapter }) => ({
      blocked: adapter.never(),
    }));

    const g = guard.for({ userId: 1, role: "user" });
    const { sql: rendered } = dialect.sqlToQuery(g.unstable_where);
    expect(rendered).toBe("false");
  });

  test("level ごとに異なる predicate を OR で合成", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: unstable_drizzleAdapter(),
      fields: ["id", "content"],
      policy: {
        owner: { id: true, content: true },
        editor: { id: true, content: true },
      },
    }).unstable_withRowPolicy(({ ctx }) => ({
      owner: eq(posts.authorId, ctx.userId),
      editor: sql`${posts.id} IN (SELECT post_id FROM editors WHERE user_id = ${ctx.userId})`,
    }));

    const g = guard.for({ userId: 7, role: "user" });
    const { sql: rendered, params } = dialect.sqlToQuery(g.unstable_where);

    expect(rendered).toContain(`"posts"."author_id" = $1`);
    expect(rendered).toContain(`IN (SELECT post_id FROM editors`);
    expect(rendered).toMatch(/^\(.*or.*\)$/);
    expect(params).toEqual([7, 7]);
  });

  test("許可列ゼロの level は WHERE 合成から除外", () => {
    const guard = defineGuard<Ctx>()({
      unstable_adapter: unstable_drizzleAdapter(),
      fields: ["id"],
      policy: {
        owner: true,
        blocked: false,
      },
    }).unstable_withRowPolicy(({ ctx }) => ({
      owner: eq(posts.authorId, ctx.userId),
      blocked: sql`never-evaluated`,
    }));

    const g = guard.for({ userId: 99, role: "user" });
    const { sql: rendered, params } = dialect.sqlToQuery(g.unstable_where);

    expect(rendered).not.toContain("never-evaluated");
    expect(rendered).toBe(`"posts"."author_id" = $1`);
    expect(params).toEqual([99]);
  });
});
