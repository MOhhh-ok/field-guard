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
