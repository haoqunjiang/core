import type {
  Selector,
  SelectorComponent,
  SelectorList,
  TokenOrValue,
} from 'lightningcss'
import { warn } from '../../../warn'
import { parseSelectorListFromTokens } from '../lexer/selectors'
import {
  cloneAttribute,
  cloneCombinator,
  isCombinator,
  isDescendantCombinator,
  isRelativeScopeMarker,
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
  getVueScopeCarrierKind,
  vueSelectorParserOptions,
} from '../vueScopedPolicy'

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
    if (isRelativeScopeMarker(component)) {
      results = appendPlainComponent(results, component)
      continue
    }

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
  return carrier.selectors.flatMap(innerSelector =>
    expandScopedSelectorSpecials(innerSelector, helpers).map(result => ({
      deep: result.deep,
      selector: prependNoInjectMarker(result.selector, helpers),
    })),
  )
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
  const slotScopedInnerSelectors = carrier.selectors.flatMap(innerSelector =>
    expandScopedSelectorSpecials(innerSelector, helpers).map(result =>
      applyScopeInjection(result, 'slot', helpers),
    ),
  )

  return results.flatMap(state =>
    slotScopedInnerSelectors.map(innerSelector => ({
      deep: state.deep || innerSelector.deep,
      selector: prependNoInjectMarker(
        [...state.selector, ...innerSelector.selector],
        helpers,
      ),
    })),
  )
}

function expandDeepCarrier(
  results: ExpandedSelectorStates,
  carrier: ScopeCarrier,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  return results.flatMap(state =>
    carrier.selectors.flatMap(innerSelector =>
      expandScopedSelectorSpecials(innerSelector, helpers).map(result => ({
        deep: true,
        selector: appendDeepSelector(state.selector, result.selector, helpers),
      })),
    ),
  )
}

function appendDeprecatedDeepCombinator(
  results: ExpandedSelectorStates,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  return results.map(state => ({
    deep: true,
    selector: [
      ...state.selector,
      cloneAttribute(helpers.deepMarker),
      cloneCombinator(helpers.descendantCombinator),
    ],
  }))
}

function appendDeprecatedVueDeepPseudo(
  results: ExpandedSelectorStates,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  return results.map(state => {
    const nextSelector = state.selector.slice()
    if (isDescendantCombinator(nextSelector[nextSelector.length - 1])) {
      nextSelector.pop()
    }
    nextSelector.push(cloneAttribute(helpers.deepMarker))
    return {
      deep: true,
      selector: nextSelector,
    }
  })
}

function appendScopeContainer(
  results: ExpandedSelectorStates,
  component: ScopeContainerSelector,
  helpers: ScopedSelectorHelpers,
): ExpandedSelectorStates {
  let nestedDeep = false
  const nestedSelectors = component.selectors.flatMap(nestedSelector =>
    expandScopedSelectorSpecials(nestedSelector, helpers).map(result => {
      nestedDeep ||= result.deep
      return result.selector
    }),
  )

  const nextComponent = {
    ...component,
    selectors: nestedSelectors,
  } as ScopeContainerSelector

  return results.map(state => ({
    deep: state.deep || nestedDeep,
    selector: [...state.selector, nextComponent],
  }))
}

function appendPlainComponent(
  results: ExpandedSelectorStates,
  component: SelectorComponent,
): ExpandedSelectorStates {
  return results.map(state => ({
    deep: state.deep,
    selector: [...state.selector, component],
  }))
}

function hasScopeCarrier(component: SelectorComponent): boolean {
  return (
    isCustomFunctionSelector(component) &&
    getVueScopeCarrierKind(component.name) != null
  )
}

function getScopeCarrier(component: SelectorComponent): ScopeCarrier | null {
  if (!isCustomFunctionSelector(component)) {
    return null
  }

  const kind = getVueScopeCarrierKind(component.name)
  if (!kind) {
    return null
  }

  return {
    kind,
    selectors: hasParsedSelectors(component)
      ? component.selectors
      : parseSelectorListFromTokens(
          component.arguments,
          vueSelectorParserOptions,
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
