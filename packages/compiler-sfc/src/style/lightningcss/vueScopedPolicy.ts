import type { DirectSelectorScopePolicy } from './lexer/source'
import type { SelectorParserOptions } from './lexer/selectors'

// Keep Vue-specific selector names and markers here so lexer/ stays generic.
export type VueScopeCarrierKind = 'deep' | 'global' | 'slotted'

export const vueRelativeScopeMarkerName: string = '__VUE_SCOPE_RELATIVE__'

export const vueScopeContainerPseudoClasses: ReadonlySet<string> = new Set([
  'is',
  'where',
])

export const vueScopeFunctionNames: ReadonlySet<string> = new Set([
  'deep',
  'global',
  'slotted',
  'v-deep',
  'v-global',
  'v-slotted',
])

export const vueSelectorParserOptions: SelectorParserOptions = {
  selectorListFunctionNames: vueScopeFunctionNames,
}

export const vueDirectScopePreludePolicy: DirectSelectorScopePolicy = {
  containerPseudoClasses: vueScopeContainerPseudoClasses,
  relativeMarkerName: vueRelativeScopeMarkerName,
  unsupportedSelectorFunctionNames: vueScopeFunctionNames,
}

export function getVueScopeCarrierKind(
  name: string,
): VueScopeCarrierKind | null {
  switch (name) {
    case 'deep':
    case 'v-deep':
      return 'deep'
    case 'global':
    case 'v-global':
      return 'global'
    case 'slotted':
    case 'v-slotted':
      return 'slotted'
    default:
      return null
  }
}
