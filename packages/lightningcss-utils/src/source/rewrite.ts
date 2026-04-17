import type { Selector } from 'lightningcss'
import MagicString from 'magic-string'
import { walkCssBlockPreludes } from './preludes'
import {
  type SelectorParserOptions,
  parseSelectorListFromString,
  stringifySelector,
} from '../selectors'

/**
 * Options for a source-to-source selector prelude rewrite.
 *
 * The callback API is collector-based on purpose: this keeps the hot path free
 * of per-selector wrapper allocations and leaves room to swap out the
 * underlying implementation without changing call sites.
 */
export interface CssSelectorSourceRewriteOptions {
  /**
   * Optional fast path that rewrites a full selector-list prelude directly from
   * source text. Return `undefined` to fall back to the parsed-selector path.
   */
  tryRewritePreludeDirect?: (prelude: string) => string | undefined
  parserOptions?: SelectorParserOptions
  /**
   * Rewrites one parsed selector and appends zero or more output selectors to
   * `target`.
   */
  appendRewrittenSelectors: (selector: Selector, target: Selector[]) => void
}

export interface CssSelectorSourceRewriteWithMapResult<TMap extends object> {
  code: string
  map: TMap | undefined
}

export type CssSourceMapMerge<TMap extends object> = (
  currentMap: TMap,
  nextMap: object,
) => TMap

/**
 * Walks CSS source and rewrites only selector preludes, leaving declaration
 * blocks and non-selector at-rules untouched.
 *
 * This is generic enough for other source-level selector transforms, but it is
 * intentionally optimized for a narrow source-rewrite hot path rather than for
 * full-featured CSS rewriting.
 */
export function rewriteCssSelectorSource(
  source: string,
  options: CssSelectorSourceRewriteOptions,
): string {
  const { tryRewritePreludeDirect, parserOptions, appendRewrittenSelectors } =
    options
  const output: string[] = []
  let chunkStart = 0

  walkCssBlockPreludes(source, prelude => {
    if (
      !prelude.normalizedPrelude ||
      prelude.normalizedPrelude.startsWith('@') ||
      prelude.parentKind === 'keyframes'
    ) {
      return
    }

    output.push(source.slice(chunkStart, prelude.start))
    output.push(
      rewriteSelectorPrelude(
        prelude.preludeSource,
        tryRewritePreludeDirect,
        parserOptions,
        appendRewrittenSelectors,
      ),
    )
    chunkStart = prelude.end
  })

  if (!output.length) {
    return source
  }

  output.push(source.slice(chunkStart))
  return output.join('')
}

export function rewriteCssSelectorSourceWithMap<TMap extends object = object>(
  source: string,
  filename: string,
  options: CssSelectorSourceRewriteOptions,
  map?: TMap,
  mergeMap?: CssSourceMapMerge<TMap>,
): CssSelectorSourceRewriteWithMapResult<TMap> {
  const { tryRewritePreludeDirect, parserOptions, appendRewrittenSelectors } =
    options
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

    const rewrittenPrelude = rewriteSelectorPrelude(
      prelude.preludeSource,
      tryRewritePreludeDirect,
      parserOptions,
      appendRewrittenSelectors,
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
      ? mergeMap
        ? mergeMap(map, JSON.parse(nextMap.toString()) as object)
        : (JSON.parse(nextMap.toString()) as TMap)
      : (JSON.parse(nextMap.toString()) as TMap),
  }
}

function rewriteSelectorPrelude(
  prelude: string,
  tryRewritePreludeDirect:
    | ((prelude: string) => string | undefined)
    | undefined,
  parserOptions: SelectorParserOptions | undefined,
  appendRewrittenSelectors: (selector: Selector, target: Selector[]) => void,
): string {
  if (tryRewritePreludeDirect) {
    const scopedPrelude = tryRewritePreludeDirect(prelude)
    if (scopedPrelude != null) {
      return scopedPrelude
    }
  }

  const selectors = parseSelectorListFromString(prelude, parserOptions)
  const rewrittenSelectors: Selector[] = []
  for (const selector of selectors) {
    appendRewrittenSelectors(selector, rewrittenSelectors)
  }
  return rewrittenSelectors
    .map(selector => stringifySelector(selector))
    .join(', ')
}
