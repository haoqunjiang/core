import type {
  Selector,
  SelectorComponent,
  SelectorList,
} from 'lightningcss'
import { extend } from '@vue/shared'
import { parseSelectorListFromTokens } from '@vue/lightningcss-utils'
import type { ScopeCarrierKind } from '../scopeCarriers'
import {
  isScopeCarrierSelector,
  scopeCarrierParserOptions,
} from '../scopeCarriers'
import {
  cloneAttribute,
  cloneCombinator,
  isCombinator,
} from './context'
import { isScopeContainer, isSelectorContainer } from './selectorDirect'
import { placeScopeAttributes } from './selectorInject'
import type {
  ExpandedScopedSelector,
  ScopedSelectorHelpers,
  SelectorContainerSelector,
} from './types'

interface ScopeCarrier {
  kind: ScopeCarrierKind
  selectors: SelectorList
}

type ExpandedSelectorStates = ExpandedScopedSelector[]

export function canUseDirectScopeRewrite(selector: Selector): boolean {
  for (const component of selector) {
    if (isScopeCarrierSelector(component)) {
      return false
    }

    if (isSelectorContainer(component)) {
      for (const nestedSelector of component.selectors) {
        if (!canUseDirectScopeRewrite(nestedSelector)) {
          return false
        }
      }
    }
  }

  return true
}

export function lowerScopeCarriers(
  selector: Selector,
  helpers: ScopedSelectorHelpers,
): ExpandedScopedSelector[] {
  // This phase normalizes Vue-specific selector syntax into ordinary selector
  // states plus a few internal markers that the injection phase understands.
  //
  // A single input selector may fan out into many output states because carrier
  // pseudos such as `:deep(...)`, `:global(...)`, and `:slotted(...)` can each
  // contain selector lists.
  let results: ExpandedSelectorStates = [{ deep: false, selector: [] }]

  for (const component of selector) {
    const carrier = getScopeCarrier(component)
    if (carrier) {
      if (carrier.kind === 'global') {
        // `:global(...)` replaces the current selector branch rather than
        // extending it, so the outer prefix is intentionally discarded here.
        results = expandGlobalCarrier(carrier, helpers)
        continue
      }

      if (carrier.kind === 'slotted') {
        results = expandSlottedCarrier(results, carrier, helpers)
        continue
      }

      results = expandDeepCarrier(results, carrier, helpers)
      continue
    }

    if (isSelectorContainer(component)) {
      results = appendSelectorContainer(results, component, helpers)
      continue
    }

    results = appendPlainComponent(results, component)
  }

  return results
}

function expandGlobalCarrier(
  carrier: ScopeCarrier,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  const expanded: ExpandedSelectorStates = []
  for (const innerSelector of carrier.selectors) {
    const innerResults = lowerScopeCarriers(innerSelector, helpers)
    for (const result of innerResults) {
      expanded.push({
        deep: result.deep,
        selector: prependNoInjectMarker(result.selector, helpers),
      })
    }
  }
  return expanded
}

function expandSlottedCarrier(
  results: ExpandedSelectorStates,
  carrier: ScopeCarrier,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  // Slotted selectors are the one place where expansion must eagerly apply slot
  // scope to the carrier payload before it is merged back into the outer
  // selector. The later injection phase should not scope the merged selector
  // again, so we prepend the no-inject marker afterward.
  const slotScopedInnerSelectors: ExpandedSelectorStates = []
  for (const innerSelector of carrier.selectors) {
    const innerResults = lowerScopeCarriers(innerSelector, helpers)
    for (const result of innerResults) {
      slotScopedInnerSelectors.push(
        placeScopeAttributes(result, 'slot', helpers),
      )
    }
  }

  const expanded: ExpandedSelectorStates = []
  for (const state of results) {
    for (const innerSelector of slotScopedInnerSelectors) {
      expanded.push({
        deep: state.deep || innerSelector.deep,
        selector: prependNoInjectMarker(
          [...state.selector, ...innerSelector.selector],
          helpers,
        ),
      })
    }
  }

  return expanded
}

function expandDeepCarrier(
  results: ExpandedSelectorStates,
  carrier: ScopeCarrier,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  const expanded: ExpandedSelectorStates = []
  for (const state of results) {
    for (const innerSelector of carrier.selectors) {
      const innerResults = lowerScopeCarriers(innerSelector, helpers)
      for (const result of innerResults) {
        expanded.push({
          deep: true,
          selector: appendDeepSelector(
            state.selector,
            result.selector,
            helpers,
          ),
        })
      }
    }
  }
  return expanded
}

function appendSelectorContainer(
  results: ExpandedSelectorStates,
  component: SelectorContainerSelector,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  let nestedDeep = false
  const nestedSelectors: SelectorList = []
  for (const nestedSelector of component.selectors) {
    const nestedResults = lowerScopeCarriers(nestedSelector, helpers)
    for (const result of nestedResults) {
      nestedDeep ||= result.deep
      nestedSelectors.push(result.selector)
    }
  }

  const nextComponent = extend({}, component, {
    selectors: nestedSelectors,
  }) as SelectorContainerSelector

  for (const state of results) {
    if (isScopeContainer(component)) {
      state.deep ||= nestedDeep
    }
    state.selector.push(nextComponent)
  }
  return results
}

function appendPlainComponent(
  results: ExpandedSelectorStates,
  component: SelectorComponent,
): ExpandedSelectorStates {
  for (const state of results) {
    state.selector.push(component)
  }
  return results
}

function getScopeCarrier(component: SelectorComponent): ScopeCarrier | null {
  if (!isScopeCarrierSelector(component)) {
    return null
  }

  return {
    kind: component.name,
    selectors: Array.isArray(component.selectors)
      ? component.selectors
      : parseSelectorListFromTokens(
          component.arguments,
          scopeCarrierParserOptions,
        ),
  }
}

function appendDeepSelector(
  prefix: Selector,
  inner: Selector,
  helpers: ScopedSelectorHelpers,
): Selector {
  const selector = prefix.slice()
  selector.push(cloneAttribute(helpers.deepMarker))
  if (!prefix.length || !isCombinator(prefix[prefix.length - 1])) {
    selector.push(cloneCombinator(helpers.descendantCombinator))
  }
  selector.push(...inner)
  return selector
}

function prependNoInjectMarker(
  selector: Selector,
  helpers: ScopedSelectorHelpers,
): Selector {
  return [cloneAttribute(helpers.noInjectMarker), ...selector]
}
