import type {
  Selector,
  SelectorComponent,
  SelectorList,
  TokenOrValue,
} from 'lightningcss'
import { extend } from '@vue/shared'
import { parseSelectorListFromTokens } from '@vue/lightningcss-lexer'
import { warn } from '../../../warn'
import {
  cloneAttribute,
  cloneCombinator,
  isCombinator,
  isDescendantCombinator,
} from './context'
import { isScopeContainer } from './selectorDirect'
import { applyScopeInjection } from './selectorInject'
import type {
  ExpandedScopedSelector,
  PseudoClassSelector,
  PseudoElementSelector,
  ScopeContainerSelector,
  ScopedSelectorHelpers,
} from './types'
import {
  type VueScopeCarrierKind,
  getVueScopedSelectorCarrierKind,
  vueScopedSelectorParserOptions,
} from '../vueScopedSelectors'

interface ScopeCarrier {
  kind: VueScopeCarrierKind
  selectors: SelectorList
}

type CustomFunctionSelector = (PseudoClassSelector | PseudoElementSelector) & {
  arguments: TokenOrValue[]
  kind: 'custom-function'
  name: string
}

type ExpandedSelectorStates = ExpandedScopedSelector[]

export function canUseDirectScopeRewrite(selector: Selector): boolean {
  for (const component of selector) {
    if (
      isDeepCombinator(component) ||
      isDeprecatedVueDeepCombinator(component) ||
      hasScopeCarrier(component)
    ) {
      return false
    }

    if (isScopeContainer(component)) {
      for (const nestedSelector of component.selectors) {
        if (!canUseDirectScopeRewrite(nestedSelector)) {
          return false
        }
      }
    }
  }

  return true
}

export function expandScopedSelectorSpecials(
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
        return expandGlobalCarrier(carrier, helpers)
      }

      if (carrier.kind === 'slotted') {
        results = expandSlottedCarrier(results, carrier, helpers)
        continue
      }

      results = expandDeepCarrier(results, carrier, helpers)
      continue
    }

    if (isDeepCombinator(component)) {
      warn(
        `the >>> and /deep/ combinators have been deprecated. ` +
          `Use :deep() instead.`,
      )
      results = appendDeprecatedDeepCombinator(results, helpers)
      continue
    }

    if (isDeprecatedVueDeepCombinator(component)) {
      warn(
        `::v-deep usage as a combinator has been deprecated. ` +
          `Use :deep(<inner-selector>) instead of ::v-deep <inner-selector>.`,
      )
      results = appendDeprecatedVueDeepPseudo(results, helpers)
      continue
    }

    if (isScopeContainer(component)) {
      results = appendScopeContainer(results, component, helpers)
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
    const innerResults = expandScopedSelectorSpecials(innerSelector, helpers)
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
    const innerResults = expandScopedSelectorSpecials(innerSelector, helpers)
    for (const result of innerResults) {
      slotScopedInnerSelectors.push(
        applyScopeInjection(result, 'slot', helpers),
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
      const innerResults = expandScopedSelectorSpecials(innerSelector, helpers)
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

function appendDeprecatedDeepCombinator(
  results: ExpandedSelectorStates,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  for (const state of results) {
    state.deep = true
    state.selector.push(
      cloneAttribute(helpers.deepMarker),
      cloneCombinator(helpers.descendantCombinator),
    )
  }
  return results
}

function appendDeprecatedVueDeepPseudo(
  results: ExpandedSelectorStates,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  for (const state of results) {
    if (isDescendantCombinator(state.selector[state.selector.length - 1])) {
      state.selector.pop()
    }
    state.selector.push(cloneAttribute(helpers.deepMarker))
    state.deep = true
  }
  return results
}

function appendScopeContainer(
  results: ExpandedSelectorStates,
  component: ScopeContainerSelector,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  let nestedDeep = false
  const nestedSelectors: SelectorList = []
  for (const nestedSelector of component.selectors) {
    const nestedResults = expandScopedSelectorSpecials(nestedSelector, helpers)
    for (const result of nestedResults) {
      nestedDeep ||= result.deep
      nestedSelectors.push(result.selector)
    }
  }

  const nextComponent = extend({}, component, {
    selectors: nestedSelectors,
  }) as ScopeContainerSelector

  for (const state of results) {
    state.deep ||= nestedDeep
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

function hasScopeCarrier(component: SelectorComponent): boolean {
  return (
    isCustomFunctionSelector(component) &&
    getVueScopedSelectorCarrierKind(component.name) != null
  )
}

function getScopeCarrier(component: SelectorComponent): ScopeCarrier | null {
  if (!isCustomFunctionSelector(component)) {
    return null
  }

  const kind = getVueScopedSelectorCarrierKind(component.name)
  if (!kind) {
    return null
  }

  return {
    kind,
    selectors: hasParsedSelectors(component)
      ? component.selectors
      : parseSelectorListFromTokens(
          component.arguments,
          vueScopedSelectorParserOptions,
        ),
  }
}

function isCustomFunctionSelector(
  component: SelectorComponent,
): component is CustomFunctionSelector {
  return (
    (component.type === 'pseudo-class' ||
      component.type === 'pseudo-element') &&
    component.kind === 'custom-function'
  )
}

function hasParsedSelectors(
  component: CustomFunctionSelector,
): component is CustomFunctionSelector & { selectors: SelectorList } {
  return Array.isArray((component as { selectors?: unknown }).selectors)
}

function isDeprecatedVueDeepCombinator(component: SelectorComponent): boolean {
  return (
    component.type === 'pseudo-element' &&
    component.kind === 'custom' &&
    component.name === 'v-deep'
  )
}

function isDeepCombinator(component: SelectorComponent): boolean {
  return (
    component.type === 'combinator' &&
    (component.value === 'deep' || component.value === 'deep-descendant')
  )
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
