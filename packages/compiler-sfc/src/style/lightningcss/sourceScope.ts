import {
  rewriteCssSelectorSource,
  tryScopeSelectorPreludeDirect,
} from './lexer/source'
import {
  appendScopedLightningCssSelectors,
  createScopedStyleTransformContext,
} from './scoped'
import {
  vueDirectScopePreludePolicy,
  vueSelectorParserOptions,
} from './vueScopedPolicy'

export function scopeLightningCssSource(
  source: string,
  id: string,
  hasScopedSelectorSpecials = true,
): string {
  const context = createScopedStyleTransformContext({ id })
  return rewriteCssSelectorSource(source, {
    tryRewritePreludeDirect: hasScopedSelectorSpecials
      ? undefined
      : prelude =>
          tryScopeSelectorPreludeDirect(
            prelude,
            context.id,
            vueDirectScopePreludePolicy,
          ),
    parserOptions: vueSelectorParserOptions,
    appendRewrittenSelectors: (selector, target) =>
      appendScopedLightningCssSelectors(selector, context, target),
  })
}
