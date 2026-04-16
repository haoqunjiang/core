import type { Selector } from 'lightningcss'
import { extend } from '@vue/shared'
import { cloneAttribute, isDeepMarker, isNoInjectMarker } from './context'
import {
  findInjectionAnchor,
  isScopeContainer,
  stripLeadingUniversal,
} from './selectorDirect'
import type {
  ExpandedScopedSelector,
  ScopeContainerSelector,
  ScopeInjectMode,
  ScopedSelectorHelpers,
} from './types'

export function applyScopeInjection(
  result: ExpandedScopedSelector,
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): ExpandedScopedSelector {
  const effectiveMode = hasNoInjectMarker(result.selector) ? 'none' : injectMode
  const selector = stripLeadingUniversal(removeNoInjectMarkers(result.selector))
  const anchorIndex = findInjectionAnchor(selector)

  if (anchorIndex !== -1 && isScopeContainer(selector[anchorIndex])) {
    return injectScopeIntoContainer(
      result.deep,
      selector,
      anchorIndex,
      effectiveMode,
      helpers,
    )
  }

  if (effectiveMode !== 'none') {
    const scopedAttribute =
      effectiveMode === 'slot'
        ? cloneAttribute(helpers.slotScopeAttribute)
        : cloneAttribute(helpers.scopeAttribute)
    if (anchorIndex === -1) {
      selector.unshift(scopedAttribute)
    } else {
      selector.splice(anchorIndex + 1, 0, scopedAttribute)
    }
  }

  return {
    deep: result.deep,
    selector: cleanupInternalSelector(selector),
  }
}

function injectScopeIntoContainer(
  deep: boolean,
  selector: Selector,
  anchorIndex: number,
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): ExpandedScopedSelector {
  let nestedDeep = deep
  const container = selector[anchorIndex] as ScopeContainerSelector
  const nestedSelectors = container.selectors.map(nestedSelector => {
    const nestedResult = applyScopeInjection(
      {
        deep: false,
        selector: nestedSelector,
      },
      injectMode,
      helpers,
    )
    nestedDeep ||= nestedResult.deep
    return nestedResult.selector
  })

  const rewrittenSelector = selector.slice()
  rewrittenSelector[anchorIndex] = extend({}, container, {
    selectors: nestedSelectors,
  }) as ScopeContainerSelector

  return {
    deep: nestedDeep,
    selector: cleanupInternalSelector(rewrittenSelector),
  }
}

function removeNoInjectMarkers(selector: Selector): Selector {
  let cleanedSelector: Selector | undefined

  for (let index = 0; index < selector.length; index++) {
    const component = selector[index]
    if (!isNoInjectMarker(component)) {
      if (cleanedSelector) {
        cleanedSelector.push(component)
      }
      continue
    }

    if (!cleanedSelector) {
      cleanedSelector = selector.slice(0, index)
    }
  }

  return cleanedSelector || selector
}

function cleanupInternalSelector(selector: Selector): Selector {
  const cleanedSelector = stripLeadingUniversal(
    selector.filter(
      component => !isDeepMarker(component) && !isNoInjectMarker(component),
    ),
  )

  while (
    cleanedSelector.length &&
    cleanedSelector[0].type === 'combinator' &&
    cleanedSelector[0].value === 'descendant'
  ) {
    cleanedSelector.shift()
  }

  return cleanedSelector
}

function hasNoInjectMarker(selector: Selector): boolean {
  return selector.some(isNoInjectMarker)
}
