import type MagicString from 'magic-string'
import { walkCssBlockPreludes } from '@vue/lightningcss-lexer'
import { rewriteRawAnimationIdentifier } from './names'

const quotedKeyframesPreludeRE =
  /^(@(?:-\w+-)?keyframes\b\s+)(['"])((?:\\.|(?!\2)[\s\S])*)\2/i
const unquotedKeyframesPreludeRE = /^(@(?:-\w+-)?keyframes\b\s+)([^{;\s]+)\b/i

export function rewriteKeyframesPreludes(
  source: string,
  s: MagicString,
  keyframes: Record<string, string>,
): boolean {
  let changed = false

  walkCssBlockPreludes(source, prelude => {
    if (prelude.blockKind !== 'keyframes') {
      return
    }

    const leadingWhitespaceMatch = prelude.preludeSource.match(/^\s*/)
    const leadingWhitespaceLength = leadingWhitespaceMatch
      ? leadingWhitespaceMatch[0].length
      : 0
    const trimmedPrelude = prelude.preludeSource.slice(leadingWhitespaceLength)
    const quotedMatch = trimmedPrelude.match(quotedKeyframesPreludeRE)
    if (quotedMatch) {
      const rewrittenName = rewriteRawAnimationIdentifier(
        quotedMatch[3],
        keyframes,
      )
      if (!rewrittenName || rewrittenName === quotedMatch[3]) {
        return
      }

      const contentStart =
        prelude.start + leadingWhitespaceLength + quotedMatch[1].length + 1
      s.overwrite(
        contentStart,
        contentStart + quotedMatch[3].length,
        rewrittenName,
      )
      changed = true
      return
    }

    const unquotedMatch = trimmedPrelude.match(unquotedKeyframesPreludeRE)
    if (!unquotedMatch) {
      return
    }

    const rewrittenName = rewriteRawAnimationIdentifier(
      unquotedMatch[2],
      keyframes,
    )
    if (!rewrittenName || rewrittenName === unquotedMatch[2]) {
      return
    }

    const contentStart =
      prelude.start + leadingWhitespaceLength + unquotedMatch[1].length
    s.overwrite(
      contentStart,
      contentStart + unquotedMatch[2].length,
      rewrittenName,
    )
    changed = true
  })

  return changed
}
