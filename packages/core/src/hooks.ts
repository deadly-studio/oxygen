import type { AfterChangeHook, BeforeHook, DocHook, HookContext } from '@deadly-studio/oxygen-fields'

/** See docs/SPEC.md#hook-lifecycle: beforeValidate/beforeChange run in registration order, each may transform `data`. */
export async function runBeforeHooks<TDoc>(
  hooks: BeforeHook<TDoc>[] | undefined,
  data: Partial<TDoc>,
  ctx: HookContext<TDoc>,
): Promise<Partial<TDoc>> {
  let result = data
  for (const hook of hooks ?? []) {
    result = await hook(result, ctx)
  }
  return result
}

/** beforeDelete is awaited (it runs before the row is actually removed) but, like the others, can't block the delete — see docs/SPEC.md#hook-lifecycle. */
export async function runBeforeDeleteHooks<TDoc>(hooks: DocHook<TDoc>[] | undefined, doc: TDoc): Promise<void> {
  for (const hook of hooks ?? []) {
    await hook(doc)
  }
}

function fireAndForget(run: () => unknown): void {
  try {
    const result = run()
    if (result instanceof Promise) {
      result.catch((error: unknown) => console.error('oxygen: hook threw', error))
    }
  } catch (error) {
    console.error('oxygen: hook threw', error)
  }
}

/** afterChange/afterDelete/afterRead are fire-and-forget — their return values are ignored and a throw never fails the request, see docs/SPEC.md#hook-lifecycle. */
export function runAfterChangeHooks<TDoc>(
  hooks: AfterChangeHook<TDoc>[] | undefined,
  doc: TDoc,
  ctx: HookContext<TDoc>,
): void {
  for (const hook of hooks ?? []) fireAndForget(() => hook(doc, ctx))
}

export function runDocHooks<TDoc>(hooks: DocHook<TDoc>[] | undefined, doc: TDoc): void {
  for (const hook of hooks ?? []) fireAndForget(() => hook(doc))
}
