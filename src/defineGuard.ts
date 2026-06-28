import { mergeFieldVerdicts, type MergeFieldVerdictsMode } from "./mergeFieldVerdicts.js";
import {
  createVerdict,
  type FieldPolicy,
  type FieldRule,
  type FieldVerdict,
  type FieldVerdictMap,
  type RowPolicyAdapter,
} from "./types.js";

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

export type RowPolicyParams<C, P> = {
  ctx: C;
  adapter: RowPolicyAdapter<P>;
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
  P = never,
  HasDerive extends boolean = false,
  HasResolve extends boolean = false,
  HasRowPolicy extends boolean = false,
> =
  & GuardBase<L, F>
  & {
    for(ctx: C): R;
  }
  & (HasDerive extends false ? {
      withDerive<D2 extends Record<string, unknown>>(
        fn: (p: DeriveParams<C, L, F>) => D2,
      ): GuardChain<C, L, F, R & D2, D & D2, P, true, HasResolve, HasRowPolicy>;
    }
    : {})
  & (HasResolve extends false ? {
      withCheck<T>(): <M>(
        fn: (p: ResolveParams<C, T, L, F, D>) => M,
      ) => GuardChain<C, L, F, R & { check: (target: T) => M }, D, P, HasDerive, true, HasRowPolicy>;
    }
    : {})
  & ([P] extends [never] ? {}
    : HasRowPolicy extends false ? {
      /**
       * 行レベル述語を level ごとに宣言する (試験的)。
       *
       * `defineGuard` の `unstable_adapter` が設定されているときだけ
       * 型に現れる。`.for(ctx)` の結果に `unstable_where` が追加される。
       *
       * **全 level の述語を明示宣言する必要がある** (`Record<L, P>` 必須)。
       * 「全行該当」は `adapter.always()`、「該当行なし」は `adapter.never()`
       * を明示で書く。書き忘れはコンパイルエラーになる。
       *
       * 許可列が 1 つも無い level (例: `false`) は宣言した述語に関わらず
       * WHERE 合成から除外される。許可列がある level が 1 つも無い場合は
       * `adapter.never()` (deny by default)。
       */
      unstable_withRowPolicy(
        fn: (p: RowPolicyParams<C, P>) => Record<L, P>,
      ): GuardChain<C, L, F, R & { unstable_where: P }, D, P, HasDerive, HasResolve, true>;
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

function computeUnstableWhere<C, L extends string, F extends string, P>(
  ctx: C,
  verdictMap: FieldVerdictMap<L, F>,
  rowPolicyFn: (p: RowPolicyParams<C, P>) => Record<L, P>,
  adapter: RowPolicyAdapter<P>,
): P {
  const usableLevels = (Object.keys(verdictMap) as L[]).filter(
    (l) => verdictMap[l].allowedFields.length > 0,
  );

  if (usableLevels.length === 0) {
    return adapter.never();
  }

  const rowMap = rowPolicyFn({ ctx, adapter });
  const predicates = usableLevels.map((l) => rowMap[l]);

  return adapter.combine(predicates);
}

function createChain<
  C,
  L extends string,
  F extends string,
  R extends Record<string, unknown>,
  D extends Record<string, unknown> = Record<string, never>,
  P = never,
  HasDerive extends boolean = false,
  HasResolve extends boolean = false,
  HasRowPolicy extends boolean = false,
>(
  fields: F[],
  verdictMap: FieldVerdictMap<L, F>,
  mergeVerdicts: (mode: MergeFieldVerdictsMode, flags: Partial<Record<L, boolean>>) => FieldVerdict<F>,
  deriveFn: ((p: DeriveParams<C, L, F>) => Record<string, unknown>) | undefined,
  resolveFn: ((p: ResolveParams<C, any, L, F, any>) => any) | undefined,
  adapter: RowPolicyAdapter<P> | undefined,
  rowPolicyFn: ((p: RowPolicyParams<C, P>) => Record<L, P>) | undefined,
): GuardChain<C, L, F, R, D, P, HasDerive, HasResolve, HasRowPolicy> {
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
      return createChain<C, L, F, R & D2, D & D2, P, true, HasResolve, HasRowPolicy>(
        fields,
        verdictMap,
        mergeVerdicts,
        nextDeriveFn,
        resolveFn,
        adapter,
        rowPolicyFn,
      );
    },
    withCheck<T>() {
      return <M>(fn: (p: ResolveParams<C, T, L, F, D>) => M) => {
        return createChain<C, L, F, R & { check: (target: T) => M }, D, P, HasDerive, true, HasRowPolicy>(
          fields,
          verdictMap,
          mergeVerdicts,
          deriveFn,
          fn,
          adapter,
          rowPolicyFn,
        );
      };
    },
    unstable_withRowPolicy(
      fn: (p: RowPolicyParams<C, P>) => Record<L, P>,
    ) {
      return createChain<C, L, F, R & { unstable_where: P }, D, P, HasDerive, HasResolve, true>(
        fields,
        verdictMap,
        mergeVerdicts,
        deriveFn,
        resolveFn,
        adapter,
        fn,
      );
    },
    for(ctx: C): R {
      const baseParams: BaseParams<C, L, F> = { ctx, fields, verdictMap, mergeVerdicts };
      const derived = deriveFn ? deriveFn(baseParams) : {};
      const rowWhere = adapter && rowPolicyFn
        ? { unstable_where: computeUnstableWhere(ctx, verdictMap, rowPolicyFn, adapter) }
        : {};
      const result = resolveFn
        ? { ...derived, ...rowWhere, check: (target: any) => resolveFn({ ...baseParams, target, derived }) }
        : { ...derived, ...rowWhere };
      return result as R;
    },
  } as GuardChain<C, L, F, R, D, P, HasDerive, HasResolve, HasRowPolicy>;
}

export function defineGuard<C>() {
  return <L extends string = never, F extends string = never, P = never>(
    params?: {
      fields?: F[];
      policy?: FieldPolicy<L, F>;
      unstable_adapter?: RowPolicyAdapter<P>;
    },
  ) => {
    const fields = (params?.fields ?? []) as F[];
    const policy = (params?.policy ?? {}) as FieldPolicy<L, F>;
    const adapter = params?.unstable_adapter;
    const verdictMap = buildVerdictMap(policy, fields);
    const _mergeVerdicts = (
      mode: MergeFieldVerdictsMode,
      flags: Partial<Record<L, boolean>>,
    ): FieldVerdict<F> => {
      const levels = (Object.keys(flags) as L[]).filter((l) => flags[l]);
      const verdicts = levels.map((l) => verdictMap[l]);
      return mergeFieldVerdicts(mode, verdicts, fields);
    };
    return createChain<C, L, F, Record<string, never>, Record<string, never>, P>(
      fields,
      verdictMap,
      _mergeVerdicts,
      undefined,
      undefined,
      adapter,
      undefined,
    );
  };
}
