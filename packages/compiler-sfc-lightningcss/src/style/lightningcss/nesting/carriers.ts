import { parseSelectorListFromString } from '@vue/lightningcss-lexer'
import type { Selector, SelectorComponent } from 'lightningcss'
import {
  getVueScopedSelectorCarrierKind,
  vueScopedSelectorParserOptions,
} from '../vueScopedSelectors'

export function preludeIsPureGlobalCarrier(prelude: string): boolean {
  try {
    const selectors = parseSelectorListFromString(
      prelude,
      vueScopedSelectorParserOptions,
    )
    return selectors.length > 0 && selectors.every(selectorIsPureGlobalCarrier)
  } catch {
    return false
  }
}

function selectorIsPureGlobalCarrier(selector: Selector): boolean {
  return selector.length === 1 && isVueGlobalCarrier(selector[0])
}

function isVueGlobalCarrier(component: SelectorComponent): boolean {
  return (
    (component.type === 'pseudo-class' ||
      component.type === 'pseudo-element') &&
    component.kind === 'custom-function' &&
    getVueScopedSelectorCarrierKind(component.name) === 'global'
  )
}
