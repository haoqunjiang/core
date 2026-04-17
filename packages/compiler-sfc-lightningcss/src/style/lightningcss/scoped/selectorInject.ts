import type { Selector } from 'lightningcss'
import { extend } from '@vue/shared'
import { cloneAttribute, isDeepMarker, isNoInjectMarker } from './context'
import {
  findInjectionAnchor,
  isSelectorContainer,
  stripLeadingUniversal,
} from './selectorDirect'
import type {
  ExpandedScopedSelector,
  ScopeInjectMode,
  ScopedSelectorHelpers,
  SelectorContainerSelector,
} from './types'

export function placeScopeAttributes(
  result: ExpandedScopedSelector,
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): ExpandedScopedSelector {
  const effectiveMode = hasNoInjectMarker(result.selector) ? 'none' : injectMode
  const selector = removeNoInjectMarkers(result.selector)
  if (effectiveMode !== 'none') {
    stripLeadingUniversal(selector)
  }
  const anchorIndex = findInjectionAnchor(selector)

  if (anchorIndex !== -1 && isSelectorContainer(selector[anchorIndex])) {
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
    selector,
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
  const container = selector[anchorIndex] as SelectorContainerSelector
  const nestedSelectors = container.selectors.map(nestedSelector => {
    const nestedResult = placeScopeAttributes(
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
  }) as SelectorContainerSelector

  if (
    injectMode !== 'none' &&
    shouldInjectContainerScope(container, nestedSelectors, injectMode, helpers)
  ) {
    const scopedAttribute =
      injectMode === 'slot'
        ? cloneAttribute(helpers.slotScopeAttribute)
        : cloneAttribute(helpers.scopeAttribute)
    rewrittenSelector.splice(anchorIndex + 1, 0, scopedAttribute)
  }

  return {
    deep: nestedDeep,
    selector: rewrittenSelector,
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

export function cleanupScopedSelectorMarkers(selector: Selector): Selector {
  const cleanedComponents: Selector = []
  for (const component of selector) {
    if (isDeepMarker(component) || isNoInjectMarker(component)) {
      continue
    }

    if (isSelectorContainer(component)) {
      cleanedComponents.push(
        extend({}, component, {
          selectors: component.selectors.map(nestedSelector =>
            cleanupScopedSelectorMarkers(nestedSelector),
          ),
        }) as SelectorContainerSelector,
      )
      continue
    }

    cleanedComponents.push(component)
  }

  while (
    cleanedComponents.length &&
    cleanedComponents[0].type === 'combinator' &&
    cleanedComponents[0].value === 'descendant'
  ) {
    cleanedComponents.shift()
  }

  return cleanedComponents
}

function hasNoInjectMarker(selector: Selector): boolean {
  return selector.some(isNoInjectMarker)
}

function selectorContainsScopeAttribute(
  selector: Selector,
  scopeAttributeName: string,
): boolean {
  return selector.some(component => {
    if (component.type === 'attribute') {
      return component.name === scopeAttributeName
    }

    return (
      isSelectorContainer(component) &&
      component.selectors.some(nestedSelector =>
        selectorContainsScopeAttribute(nestedSelector, scopeAttributeName),
      )
    )
  })
}

function selectorSatisfiesContainerScope(
  selector: Selector,
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): boolean {
  if (injectMode === 'slot') {
    return selectorContainsScopeAttribute(
      selector,
      helpers.slotScopeAttribute.name,
    )
  }

  return (
    selectorContainsScopeAttribute(selector, helpers.scopeAttribute.name) ||
    selectorContainsScopeAttribute(selector, helpers.slotScopeAttribute.name)
  )
}

function shouldInjectContainerScope(
  container: SelectorContainerSelector,
  nestedSelectors: Selector[],
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): boolean {
  if (container.kind === 'has' || container.kind === 'not') {
    return true
  }

  return nestedSelectors.some(
    nestedSelector =>
      !selectorSatisfiesContainerScope(nestedSelector, injectMode, helpers),
  )
}
