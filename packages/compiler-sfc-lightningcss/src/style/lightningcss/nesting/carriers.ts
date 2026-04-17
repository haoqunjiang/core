import { parseSelectorListFromString } from '@vue/lightningcss-utils'
import type { Selector, SelectorComponent } from 'lightningcss'
import {
  getVueScopeCarrierKind,
  vueScopeParserOptions,
} from '../scoped/vueScope'

export function preludeIsPureGlobalCarrier(prelude: string): boolean {
  try {
    const selectors = parseSelectorListFromString(
      prelude,
      vueScopeParserOptions,
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
    getVueScopeCarrierKind(component.name) === 'global'
  )
}
