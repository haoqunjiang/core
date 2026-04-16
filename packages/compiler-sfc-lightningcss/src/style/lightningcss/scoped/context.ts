import type { SelectorComponent } from 'lightningcss'
import { extend } from '@vue/shared'
import type {
  AttributeSelector,
  CombinatorSelector,
  ScopedSelectorHelpers,
  ScopedStyleTransformContext,
} from './types'

interface ScopedSelectorOptions {
  id: string
  keyframes?: Record<string, string>
}

const deepMarkerName = '__VUE_SCOPE_DEEP__'
const noInjectMarkerName = '__VUE_SCOPE_NO_INJECT__'

export function createScopedStyleTransformContext(
  options: ScopedSelectorOptions,
): ScopedStyleTransformContext {
  return {
    helpers: createScopedSelectorHelpers(options.id),
    id: options.id,
    keyframes: Object.assign(Object.create(null), options.keyframes),
    shortId: options.id.replace(/^data-v-/, ''),
  }
}

export function isCombinator(
  component: SelectorComponent | undefined,
): component is CombinatorSelector {
  return !!component && component.type === 'combinator'
}

export function isDescendantCombinator(
  component: SelectorComponent | undefined,
): boolean {
  return (
    !!component &&
    component.type === 'combinator' &&
    component.value === 'descendant'
  )
}

export function isDeepMarker(component: SelectorComponent): boolean {
  return component.type === 'attribute' && component.name === deepMarkerName
}

export function isNoInjectMarker(component: SelectorComponent): boolean {
  return component.type === 'attribute' && component.name === noInjectMarkerName
}

export function createAttributeSelector(name: string): AttributeSelector {
  return {
    type: 'attribute',
    name,
    namespace: null,
    operation: null,
  }
}

export function createCombinatorSelector(
  value: CombinatorSelector['value'],
): CombinatorSelector {
  return {
    type: 'combinator',
    value,
  }
}

export function cloneAttribute(
  attribute: AttributeSelector,
): AttributeSelector {
  return extend({}, attribute)
}

export function cloneCombinator(
  combinator: CombinatorSelector,
): CombinatorSelector {
  return extend({}, combinator)
}

function createScopedSelectorHelpers(id: string): ScopedSelectorHelpers {
  return {
    deepMarker: cloneAttribute(createAttributeSelector(deepMarkerName)),
    descendantCombinator: cloneCombinator(
      createCombinatorSelector('descendant'),
    ),
    noInjectMarker: cloneAttribute(createAttributeSelector(noInjectMarkerName)),
    scopeAttribute: cloneAttribute(createAttributeSelector(id)),
    slotScopeAttribute: cloneAttribute(createAttributeSelector(`${id}-s`)),
  }
}
