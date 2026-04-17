import { parseSelectorListFromString } from '@vue/lightningcss-utils'
import type { SelectorParserOptions } from '@vue/lightningcss-utils'
import type {
  Selector,
  SelectorComponent,
  SelectorList,
  TokenOrValue,
} from 'lightningcss'

export type ScopeCarrierKind = 'deep' | 'global' | 'slotted'

export type ScopeCarrierSelector = Extract<
  SelectorComponent,
  { type: 'pseudo-class' }
> & {
  arguments: TokenOrValue[]
  kind: 'custom-function'
  name: ScopeCarrierKind
  selectors?: SelectorList
}

const scopeCarrierNames = new Set<ScopeCarrierKind>([
  'deep',
  'global',
  'slotted',
])

export const scopeCarrierParserOptions: SelectorParserOptions = {
  // Scope carriers use function syntax and carry selector-list arguments, so
  // the lightweight parser should expose them structurally.
  selectorListFunctionNames: scopeCarrierNames,
}

export function isScopeCarrierKind(name: string): name is ScopeCarrierKind {
  return scopeCarrierNames.has(name as ScopeCarrierKind)
}

export function isScopeCarrierSelector(
  component: SelectorComponent,
): component is ScopeCarrierSelector {
  return (
    component.type === 'pseudo-class' &&
    component.kind === 'custom-function' &&
    isScopeCarrierKind(component.name)
  )
}

export function isGlobalScopeCarrierSelector(
  component: SelectorComponent,
): component is ScopeCarrierSelector & { name: 'global' } {
  return isScopeCarrierSelector(component) && component.name === 'global'
}

export function preludeIsPureGlobalCarrier(prelude: string): boolean {
  try {
    const selectors = parseSelectorListFromString(
      prelude,
      scopeCarrierParserOptions,
    )
    return selectors.length > 0 && selectors.every(selectorIsPureGlobalCarrier)
  } catch {
    return false
  }
}

function selectorIsPureGlobalCarrier(selector: Selector): boolean {
  return selector.length === 1 && isGlobalScopeCarrierSelector(selector[0])
}
