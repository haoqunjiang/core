import {
  parseSelectorListFromString,
  rewriteCssSelectorSource,
  scopeSelectorPrelude,
  stringifySelector,
  walkCssBlockPreludes,
} from '@vue/lightningcss-lexer'
import type { RawSourceMap } from '@vue/compiler-core'
import MagicString from 'magic-string'
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
  const s = new MagicString(source)
  let changed = false

  walkCssBlockPreludes(source, prelude => {
    if (
      !prelude.normalizedPrelude ||
      prelude.normalizedPrelude.startsWith('@') ||
      prelude.parentKind === 'keyframes'
    ) {
      return
    }

    const rewrittenPrelude = rewriteScopedPrelude(
      prelude.preludeSource,
      hasScopedSelectorSpecials
        ? undefined
        : value => scopeSelectorPrelude(value, context.id),
      (selector, target) =>
        appendRewrittenScopedSelectors(selector, context, target),
    )

    if (rewrittenPrelude === prelude.preludeSource) {
      return
    }

    s.overwrite(prelude.start, prelude.end, rewrittenPrelude)
    changed = true
  })

  if (!changed) {
    return {
      code: source,
      map,
    }
  }

  const nextMap = s.generateMap({
    source: filename,
    includeContent: true,
    hires: true,
  })

  return {
    code: s.toString(),
    map: map
      ? (merge(map, nextMap) as RawSourceMap)
      : (JSON.parse(nextMap.toString()) as RawSourceMap),
  }
}

function rewriteScopedPrelude(
  prelude: string,
  tryRewritePreludeDirect:
    | ((prelude: string) => string | undefined)
    | undefined,
  appendRewrittenSelectors: (
    selector: ReturnType<typeof parseSelectorListFromString>[number],
    target: ReturnType<typeof parseSelectorListFromString>,
  ) => void,
): string {
  if (tryRewritePreludeDirect) {
    const rewrittenPrelude = tryRewritePreludeDirect(prelude)
    if (rewrittenPrelude != null) {
      return rewrittenPrelude
    }
  }

  const selectors = parseSelectorListFromString(
    prelude,
    vueScopeParserOptions,
  )
  const rewrittenSelectors: typeof selectors = []
  for (const selector of selectors) {
    appendRewrittenSelectors(selector, rewrittenSelectors)
  }
  return rewrittenSelectors
    .map(selector => stringifySelector(selector))
    .join(', ')
}
