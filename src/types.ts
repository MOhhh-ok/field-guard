export type FieldRule<F extends string> = Record<F, boolean>;
const fieldRule = { f1: true, f2: false } satisfies FieldRule<any>;

export type FieldPolicy<
  L extends string,
  F extends string,
> = Record<L, boolean | Partial<FieldRule<F>>>;
const fieldPolicy = {
  public: { f1: true },
  private: { f1: true, f2: false },
} satisfies FieldPolicy<any, any>;

export type FieldVerdict<F extends string> = {
  allowedFields: F[];
  coversAll: (fields: F[]) => boolean;
  coversSome: (fields: F[]) => boolean;
  pick: <T extends Partial<Record<F, unknown>>>(obj: T) => Partial<T>;
};

export function createVerdict<F extends string>(allowedFields: F[]): FieldVerdict<F> {
  const set = new Set<F>(allowedFields);
  return {
    allowedFields,
    coversAll: (fields) => fields.every((f) => set.has(f)),
    coversSome: (fields) => fields.some((f) => set.has(f)),
    pick: (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => set.has(k as F))) as any,
  };
}

export type FieldVerdictMap<L extends string, F extends string> = Record<L, FieldVerdict<F>>;

/**
 * 行レベル述語の adapter (試験的)。
 *
 * core は ORM 非依存。adapter が ORM 固有の predicate 型 `P` の
 * 合成 / 恒真 / 恒偽を提供する。
 *
 * @typeParam P - ORM 固有の述語型 (Drizzle なら `SQL`)
 */
export type RowPolicyAdapter<P> = {
  /** 複数の述語を論理和 (OR) で合成する */
  combine: (predicates: P[]) => P;
  /** 「全行に該当」を表す述語 */
  always: () => P;
  /** 「該当する行なし」を表す述語 (deny-by-default) */
  never: () => P;
};
