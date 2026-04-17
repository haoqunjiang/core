import type { SelectorParserOptions } from '@vue/lightningcss-lexer'

// This file describes the Vue-specific selector syntax that the generic lexer
// and scoped selector rewriter need to recognize.
//
// In practice that means:
// - which function-like selectors act as Vue scope carriers
// - how carrier aliases like `v-deep` map back to their semantic kind
export type VueScopeCarrierKind = 'deep' | 'global' | 'slotted'

const vueScopeCarrierAliases = {
  deep: ['deep', 'v-deep'],
  global: ['global', 'v-global'],
  slotted: ['slotted', 'v-slotted'],
} as const

export const vueScopeCarrierFunctionNames: ReadonlySet<string> =
  new Set(Object.values(vueScopeCarrierAliases).flat())

const vueScopeCarrierKindByName: ReadonlyMap<string, VueScopeCarrierKind> =
  new Map(
    Object.entries(vueScopeCarrierAliases).flatMap(([kind, names]) =>
      names.map(name => [name, kind as VueScopeCarrierKind] as const),
    ),
  )

export const vueScopeParserOptions: SelectorParserOptions = {
  // Vue scope carriers use function syntax and carry selector-list arguments,
  // so the lightweight parser should expose them structurally.
  selectorListFunctionNames: vueScopeCarrierFunctionNames,
}

export function getVueScopeCarrierKind(
  name: string,
): VueScopeCarrierKind | null {
  return vueScopeCarrierKindByName.get(name) ?? null
}
