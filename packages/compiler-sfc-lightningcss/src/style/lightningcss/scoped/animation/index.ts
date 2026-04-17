import type { RawSourceMap } from '@vue/compiler-core'
import MagicString from 'magic-string'
import merge from 'merge-source-map'
import { parseCssBlockTree } from '@vue/lightningcss-lexer'
import { rewriteAnimationDeclarationsInBlock } from './declarations'
import { rewriteKeyframesPreludes } from './keyframes'

export interface RewriteAnimationDeclarationsResult {
  code: string
  map: RawSourceMap | undefined
}

export function rewriteNormalizedAnimationDeclarations(
  source: string,
  keyframes: Record<string, string>,
): RewriteAnimationDeclarationsResult {
  const s = new MagicString(source)
  return rewriteKeyframesAndAnimationDeclarations(source, s, keyframes)
    ? {
        code: s.toString(),
        map: undefined,
      }
    : {
        code: source,
        map: undefined,
      }
}

export function rewriteNormalizedAnimationDeclarationsWithMap(
  source: string,
  filename: string,
  keyframes: Record<string, string>,
  map?: RawSourceMap,
): RewriteAnimationDeclarationsResult {
  const s = new MagicString(source)
  if (!rewriteKeyframesAndAnimationDeclarations(source, s, keyframes)) {
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

function rewriteKeyframesAndAnimationDeclarations(
  source: string,
  s: MagicString,
  keyframes: Record<string, string>,
): boolean {
  if (!Object.keys(keyframes).length) {
    return false
  }

  let changed = rewriteKeyframesPreludes(source, s, keyframes)
  for (const block of parseCssBlockTree(source)) {
    changed =
      rewriteAnimationDeclarationsInBlock(block, source, s, keyframes) ||
      changed
  }
  return changed
}
