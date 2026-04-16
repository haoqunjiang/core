import type { Selector, SelectorComponent } from 'lightningcss'
import { cloneAttribute, isDeepMarker, isDescendantCombinator } from './context'
import type { ScopeContainerSelector, ScopedSelectorHelpers } from './types'

export function rewriteDirectScopedSelector(
  selector: Selector,
  helpers: ScopedSelectorHelpers,
): Selector {
  stripLeadingUniversalInPlace(selector)

  const anchorIndex = findInjectionAnchor(selector)
  if (anchorIndex !== -1) {
    const anchor = selector[anchorIndex]
    if (isScopeContainer(anchor)) {
      anchor.selectors = anchor.selectors.map(nestedSelector =>
        rewriteDirectScopedSelector(nestedSelector, helpers),
      )
      return selector
    }

    selector.splice(anchorIndex + 1, 0, cloneAttribute(helpers.scopeAttribute))
    return selector
  }

  selector.unshift(cloneAttribute(helpers.scopeAttribute))
  return selector
}

export function isScopeContainer(
  component: SelectorComponent,
): component is ScopeContainerSelector {
  return (
    component.type === 'pseudo-class' &&
    (component.kind === 'is' || component.kind === 'where')
  )
}

/**
 * Chooses the component after which the scope attribute should be inserted.
 *
 * Once a deep marker is encountered, the anchor is frozen because anything to
 * the right is outside normal scoping.
 */
export function findInjectionAnchor(selector: Selector): number {
  let anchorIndex = -1
  let passedDeepBoundary = false

  for (let index = 0; index < selector.length; index++) {
    const component = selector[index]
    if (isDeepMarker(component)) {
      if (anchorIndex === -1) {
        anchorIndex = index
      }
      passedDeepBoundary = true
      continue
    }

    if (passedDeepBoundary) {
      continue
    }

    if (component.type === 'universal') {
      // `*` only serves as an anchor when it is the first concrete selector
      // component and nothing better has been found yet.
      if (anchorIndex !== -1) {
        continue
      }
      if (index === 0) {
        continue
      }
    }

    if (
      (component.type !== 'pseudo-class' &&
        component.type !== 'pseudo-element' &&
        component.type !== 'combinator' &&
        component.type !== 'nesting') ||
      // A container such as :is(...) or :where(...) may hold the real anchor in
      // one of its nested selector branches, so it is a fallback anchor only
      // until a concrete component is found.
      (anchorIndex === -1 && isScopeContainer(component))
    ) {
      anchorIndex = index
    }
  }

  // A selector that still starts with `&` after rewriting needs a stable
  // injection point even when no later component qualified as an anchor.
  if (anchorIndex === -1 && selector[0] && selector[0].type === 'nesting') {
    return 0
  }

  return anchorIndex
}

export function stripLeadingUniversal(selector: Selector): Selector {
  stripLeadingUniversalInPlace(selector)
  return selector
}

function stripLeadingUniversalInPlace(selector: Selector): void {
  if (!selector[0] || selector[0].type !== 'universal') {
    return
  }

  selector.shift()
  if (isDescendantCombinator(selector[0])) {
    selector.shift()
  }
}
