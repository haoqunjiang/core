import type { Selector } from 'lightningcss'
import { rewriteDirectScopedSelector } from './selectorDirect'
import {
  canUseDirectScopeRewrite,
  expandScopedSelectorSpecials,
} from './selectorExpand'
import { applyScopeInjection } from './selectorInject'
import type {
  ScopeInjectMode,
  ScopedSelectorHelpers,
  ScopedSelectorRewriteResult,
  ScopedStyleTransformContext,
} from './types'

export function scopeLightningCssSelectorWithLexer(
  selector: Selector,
  context: ScopedStyleTransformContext,
): Selector | Selector[] {
  if (canUseDirectScopeRewrite(selector)) {
    return rewriteDirectScopedSelector(selector, context.helpers)
  }

  return rewriteScopedSelector(selector, 'normal', context.helpers).selectors
}

/**
 * Appends the scoped selector rewrite into `target`.
 *
 * This gives source-level callers a single-shape contract even though a scoped
 * rewrite may expand one selector into many. The visitor path keeps the
 * smaller `Selector | Selector[]` contract to avoid wrapping the direct path in
 * an extra array on the hot AST visitor path.
 */
export function appendScopedLightningCssSelectors(
  selector: Selector,
  context: ScopedStyleTransformContext,
  target: Selector[],
): void {
  if (canUseDirectScopeRewrite(selector)) {
    target.push(rewriteDirectScopedSelector(selector, context.helpers))
    return
  }

  target.push(
    ...rewriteScopedSelector(selector, 'normal', context.helpers).selectors,
  )
}

export function scopeLightningCssSelectorDirect(
  selector: Selector,
  context: ScopedStyleTransformContext,
): Selector {
  return rewriteDirectScopedSelector(selector, context.helpers)
}

export function rewriteLightningCssScopedSelector(
  selector: Selector,
  injectMode: ScopeInjectMode,
  context: ScopedStyleTransformContext,
): ScopedSelectorRewriteResult {
  return rewriteScopedSelector(selector, injectMode, context.helpers)
}

function rewriteScopedSelector(
  selector: Selector,
  injectMode: ScopeInjectMode,
  helpers: ScopedSelectorHelpers,
): ScopedSelectorRewriteResult {
  // Phase 1: expand Vue-specific selector semantics into plain selector states.
  // `:slotted(...)` is the one special case that eagerly materializes slot
  // scope on its inner selectors before they are merged back into the outer
  // selector.
  const expanded = expandScopedSelectorSpecials(selector, helpers)
  // Phase 2: inject scope attributes and remove internal bookkeeping markers.
  const rewritten = expanded.map(result =>
    applyScopeInjection(result, injectMode, helpers),
  )

  return {
    selectors: rewritten.map(result => result.selector),
    deep: rewritten.some(result => result.deep),
  }
}
