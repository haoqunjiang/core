import {
  rewriteCssSelectorSource,
  rewriteCssSelectorSourceWithMap,
  scopeSelectorPrelude,
} from '@vue/lightningcss-utils'
import type { RawSourceMap } from '@vue/compiler-core'
import merge from 'merge-source-map'
import { createScopedStyleTransformContext } from './context'
import { appendRewrittenScopedSelectors } from './rewrite'
import { vueScopeParserOptions } from './vueScope'

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
    parserOptions: vueScopeParserOptions,
    appendRewrittenSelectors: (selector, target) =>
      appendRewrittenScopedSelectors(selector, context, target),
  })
}

export interface ScopeLightningCssSourceWithMapResult {
  code: string
  map: RawSourceMap | undefined
}

export function scopeLightningCssSourceWithMap(
  source: string,
  filename: string,
  id: string,
  hasScopedSelectorSpecials = true,
  map?: RawSourceMap,
): ScopeLightningCssSourceWithMapResult {
  const context = createScopedStyleTransformContext({ id })
  return rewriteCssSelectorSourceWithMap<RawSourceMap>(
    source,
    filename,
    {
      tryRewritePreludeDirect: hasScopedSelectorSpecials
        ? undefined
        : prelude => scopeSelectorPrelude(prelude, context.id),
      parserOptions: vueScopeParserOptions,
      appendRewrittenSelectors: (selector, target) =>
        appendRewrittenScopedSelectors(selector, context, target),
    },
    map,
    (currentMap, nextMap) => merge(currentMap, nextMap) as RawSourceMap,
  )
}
