import { or, sql, type SQL } from "drizzle-orm";
import type { RowPolicyAdapter } from "./types.js";

/**
 * Drizzle ORM 用の {@link RowPolicyAdapter} factory (試験的)。
 *
 * `combine` は `or(...predicates)` で論理和、`always` は `sql\`true\``、
 * `never` は `sql\`false\``。
 *
 * @example
 * ```ts
 * import { defineGuard } from "field-guard";
 * import { unstable_drizzleAdapter } from "field-guard/drizzle";
 * import { eq } from "drizzle-orm";
 * import { posts } from "./schema";
 *
 * const postGuard = defineGuard<Ctx>()({
 *   unstable_adapter: unstable_drizzleAdapter(),
 *   fields: ["id", "content", "authorId"],
 *   policy: { owner: true, other: { id: true, content: true } },
 * })
 * .unstable_withRowPolicy(({ ctx, adapter }) => ({
 *   owner: eq(posts.authorId, ctx.userId),
 *   other: adapter.always(),  // 全 level の述語を明示宣言する必要がある
 * }));
 * ```
 */
export function unstable_drizzleAdapter(): RowPolicyAdapter<SQL> {
  return {
    combine: (predicates) => or(...predicates) ?? sql`true`,
    always: () => sql`true`,
    never: () => sql`false`,
  };
}
