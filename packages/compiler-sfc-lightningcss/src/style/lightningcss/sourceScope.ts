import {
  rewriteCssSelectorSource,
  scopeSelectorPrelude,
} from '@vue/lightningcss-lexer'
import {
  appendScopedLightningCssSelectors,
  createScopedStyleTransformContext,
} from './scoped'
import { vueScopedSelectorParserOptions } from './vueScopedSelectors'

export function scopeLightningCssSource(
  source: string,
  id: string,
  hasScopedSelectorSpecials = true,
): string {
  const context = createScopedStyleTransformContext({ id })

  return rewriteCssSelectorSource(source, {
    tryRewritePreludeDirect: hasScopedSelectorSpecials
      ? undefined
      : prelude => scopeSelectorPrelude(prelude, context.id),
    parserOptions: vueScopedSelectorParserOptions,
    appendRewrittenSelectors: (selector, target) =>
      appendScopedLightningCssSelectors(selector, context, target),
  })
}
