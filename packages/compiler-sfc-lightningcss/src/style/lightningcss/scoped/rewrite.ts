import type { Selector } from 'lightningcss'
import { rewriteDirectScopedSelector } from './selectorDirect'
import {
  canUseDirectScopeRewrite,
  lowerScopeCarriers,
} from './selectorExpand'
import {
  cleanupScopedSelectorMarkers,
  placeScopeAttributes,
} from './selectorInject'
import type {
  ExpandedScopedSelector,
  ScopeInjectMode,
  ScopedSelectorHelpers,
  ScopedStyleTransformContext,
} from './types'

interface ScopedSelectorRewriteResult {
  deep: boolean
  selectors: Selector[]
}

export function rewriteScopedSelector(
  selector: Selector,
  context: ScopedStyleTransformContext,
): Selector | Selector[] {
  if (canUseDirectScopeRewrite(selector)) {
    return rewriteDirectScopedSelector(selector, context.helpers)
  }

  return rewriteExpandedScopedSelector(
    selector,
    'normal',
    context.helpers,
  ).selectors
}

/**
 * Appends the scoped selector rewrite into `target`.
 *
 * This gives source-level callers a single-shape contract even though a scoped
 * rewrite may expand one selector into many. The visitor path keeps the
 * smaller `Selector | Selector[]` contract to avoid wrapping the direct path in
 * an extra array on the hot AST visitor path.
 */
export function appendRewrittenScopedSelectors(
  selector: Selector,
  context: ScopedStyleTransformContext,
  target: Selector[],
): void {
  if (canUseDirectScopeRewrite(selector)) {
    target.push(rewriteDirectScopedSelector(selector, context.helpers))
    return
  }

  target.push(
    ...rewriteExpandedScopedSelector(
      selector,
      'normal',
      context.helpers,
    ).selectors,
  )
}

export function rewriteSimpleScopedSelector(
  selector: Selector,
  context: ScopedStyleTransformContext,
): Selector {
  return rewriteDirectScopedSelector(selector, context.helpers)
}

function rewriteExpandedScopedSelector(
  selector: Selector,
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): ScopedSelectorRewriteResult {
  const lowered = lowerScopedSelectorCarriers(selector, helpers)
  const scoped = placeScopeAttributesOnLoweredSelectors(
    lowered,
    injectMode,
    helpers,
  )
  const rewritten = cleanupScopedSelectorResults(scoped)

  return {
    selectors: rewritten.map(result => result.selector),
    deep: rewritten.some(result => result.deep),
  }
}

function lowerScopedSelectorCarriers(
  selector: Selector,
  helpers: ScopedSelectorHelpers,
): ExpandedScopedSelector[] {
  // Phase 1: lower Vue-specific carrier syntax into ordinary selector states
  // plus internal markers. `:slotted(...)` is the one special case that
  // eagerly materializes slot scope on its inner selectors before they are
  // merged back into the outer selector.
  return lowerScopeCarriers(selector, helpers)
}

function placeScopeAttributesOnLoweredSelectors(
  lowered: ExpandedScopedSelector[],
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): ExpandedScopedSelector[] {
  // Phase 2: interpret no-inject markers and place component or slot scope
  // attributes on the lowered selector states.
  return lowered.map(result => placeScopeAttributes(result, injectMode, helpers))
}

function cleanupScopedSelectorResults(
  rewritten: ExpandedScopedSelector[],
): ExpandedScopedSelector[] {
  // Phase 3: remove internal deep/no-inject markers once scope placement is
  // complete, recursively cleaning any selector containers.
  return rewritten.map(result => ({
    deep: result.deep,
    selector: cleanupScopedSelectorMarkers(result.selector),
  }))
}
