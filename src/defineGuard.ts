import { mergeFieldVerdicts, type MergeFieldVerdictsMode } from "./mergeFieldVerdicts.js";
import { createVerdict, type FieldPolicy, type FieldRule, type FieldVerdict, type FieldVerdictMap } from "./types.js";

type BaseParams<C, L extends string, F extends string> = {
  ctx: C;
  fields: F[];
  verdictMap: FieldVerdictMap<L, F>;
  mergeVerdicts: (mode: MergeFieldVerdictsMode, flags: Partial<Record<L, boolean>>) => FieldVerdict<F>;
};

export type DeriveParams<C, L extends string, F extends string> = BaseParams<C, L, F>;

export type ResolveParams<C, T, L extends string, F extends string, D = Record<string, never>> = BaseParams<C, L, F> & {
  target: T;
  derived: D;
};

export type GuardBase<L extends string, F extends string> = {
  fields: F[];
  verdictMap: FieldVerdictMap<L, F>;
  mergeVerdicts: (mode: MergeFieldVerdictsMode, flags: Partial<Record<L, boolean>>) => FieldVerdict<F>;
};

export type GuardChain<
  C,
  L extends string,
  F extends string,
  R extends Record<string, unknown>,
  D extends Record<string, unknown> = Record<string, never>,
  HasDerive extends boolean = false,
  HasResolve extends boolean = false,
> =
  & GuardBase<L, F>
  & {
    for(ctx: C): R;
  }
  & (HasDerive extends false ? {
      withDerive<D2 extends Record<string, unknown>>(
        fn: (p: DeriveParams<C, L, F>) => D2,
      ): GuardChain<C, L, F, R & D2, D & D2, true, HasResolve>;
    }
    : {})
  & (HasResolve extends false ? {
      withCheck<T>(): <M>(
        fn: (p: ResolveParams<C, T, L, F, D>) => M,
      ) => GuardChain<C, L, F, R & { check: (target: T) => M }, D, HasDerive, true>;
    }
    : {});

function buildVerdictMap<L extends string, F extends string>(
  policy: FieldPolicy<L, F>,
  fields: F[],
): FieldVerdictMap<L, F> {
  return Object.fromEntries(
    Object.entries(policy).map(([_level, _mask]) => {
      const level = _level as L;
      const mask = _mask as boolean | Partial<FieldRule<F>>;
      if (typeof mask === "boolean") {
        return [level, createVerdict(mask ? fields : [])];
      }
      const isWhiteListMode = Object.values(mask).length === 0 || Object.values(mask).some((v) => v === true);
      const allowedFields = isWhiteListMode
        ? fields.filter((f) => mask[f] === true)
        : fields.filter((f) => mask[f] !== false);
      return [level, createVerdict(allowedFields)];
    }) satisfies [L, FieldVerdict<F>][],
  ) as FieldVerdictMap<L, F>;
}

function createChain<
  C,
  L extends string,
  F extends string,
  R extends Record<string, unknown>,
  D extends Record<string, unknown> = Record<string, never>,
  HasDerive extends boolean = false,
  HasResolve extends boolean = false,
>(
  fields: F[],
  verdictMap: FieldVerdictMap<L, F>,
  mergeVerdicts: (mode: MergeFieldVerdictsMode, flags: Partial<Record<L, boolean>>) => FieldVerdict<F>,
  deriveFn: ((p: DeriveParams<C, L, F>) => Record<string, unknown>) | undefined,
  resolveFn: ((p: ResolveParams<C, any, L, F, any>) => any) | undefined,
): GuardChain<C, L, F, R, D, HasDerive, HasResolve> {
  return {
    fields,
    verdictMap,
    mergeVerdicts,
    withDerive<D2 extends Record<string, unknown>>(fn: (p: DeriveParams<C, L, F>) => D2) {
      const prevDeriveFn = deriveFn;
      const nextDeriveFn = (p: DeriveParams<C, L, F>) => ({
        ...(prevDeriveFn ? prevDeriveFn(p) : {}),
        ...fn(p),
      });
      return createChain<C, L, F, R & D2, D & D2, true, HasResolve>(
        fields,
        verdictMap,
        mergeVerdicts,
        nextDeriveFn,
        resolveFn,
      );
    },
    withCheck<T>() {
      return <M>(fn: (p: ResolveParams<C, T, L, F, D>) => M) => {
        return createChain<C, L, F, R & { check: (target: T) => M }, D, HasDerive, true>(
          fields,
          verdictMap,
          mergeVerdicts,
          deriveFn,
          fn,
        );
      };
    },
    for(ctx: C): R {
      const baseParams: BaseParams<C, L, F> = { ctx, fields, verdictMap, mergeVerdicts };
      const derived = deriveFn ? deriveFn(baseParams) : {};
      const result = resolveFn
        ? { ...derived, check: (target: any) => resolveFn({ ...baseParams, target, derived }) }
        : { ...derived };
      return result as R;
    },
  };
}

export function defineGuard<C>() {
  return <L extends string = never, F extends string = never>(
    params?: { fields?: F[]; policy?: FieldPolicy<L, F> },
  ) => {
    const fields = (params?.fields ?? []) as F[];
    const policy = (params?.policy ?? {}) as FieldPolicy<L, F>;
    const verdictMap = buildVerdictMap(policy, fields);
    const _mergeVerdicts = (
      mode: MergeFieldVerdictsMode,
      flags: Partial<Record<L, boolean>>,
    ): FieldVerdict<F> => {
      const levels = (Object.keys(flags) as L[]).filter((l) => flags[l]);
      const verdicts = levels.map((l) => verdictMap[l]);
      return mergeFieldVerdicts(mode, verdicts, fields);
    };
    return createChain<C, L, F, Record<string, never>>(
      fields,
      verdictMap,
      _mergeVerdicts,
      undefined,
      undefined,
    );
  };
}
