export type CssBlockKind = 'at-rule' | 'keyframes' | 'style'

export interface CssBlockPrelude {
  blockKind: CssBlockKind
  end: number
  normalizedPrelude: string
  parentKind: CssBlockKind | undefined
  preludeSource: string
  start: number
}

const keyframesPreludeRE = /^@(?:-\w+-)?keyframes\b/i

/**
 * Walks CSS source and reports each block prelude at the point its `{` is
 * encountered.
 *
 * The callback receives both the original prelude slice and a normalized form
 * with comments stripped and surrounding whitespace trimmed. This keeps higher
 * level transforms focused on their own rewrite logic rather than on source
 * scanning details.
 */
export function walkCssBlockPreludes(
  source: string,
  visitPrelude: (prelude: CssBlockPrelude) => void,
): void {
  const stack: CssBlockKind[] = []
  let segmentStart = 0
  let segmentHasComment = false
  let bracketDepth = 0
  let customPropertyBraceDepth = 0
  let customPropertyValue = false
  let parenDepth = 0
  let quote: '"' | "'" | undefined

  for (let index = 0; index < source.length; index++) {
    const current = source[index]

    if (quote) {
      if (current === '\\') {
        index++
      } else if (current === quote) {
        quote = undefined
      }
      continue
    }

    if (current === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      if (commentEnd === -1) {
        break
      }
      segmentHasComment = true
      index = commentEnd + 1
      continue
    }

    if (current === '"' || current === "'") {
      quote = current
      continue
    }

    if (current === '(') {
      parenDepth++
      continue
    }
    if (current === ')' && parenDepth) {
      parenDepth--
      continue
    }

    if (current === '[') {
      bracketDepth++
      continue
    }
    if (current === ']' && bracketDepth) {
      bracketDepth--
      continue
    }

    if (
      current === ':' &&
      !customPropertyValue &&
      isCustomPropertyDeclarationPrelude(source.slice(segmentStart, index))
    ) {
      customPropertyValue = true
      continue
    }

    if (parenDepth || bracketDepth) {
      continue
    }

    if (customPropertyValue) {
      if (current === '{') {
        customPropertyBraceDepth++
        continue
      }

      if (current === '}') {
        if (customPropertyBraceDepth) {
          customPropertyBraceDepth--
          continue
        }
        customPropertyValue = false
      }
    }

    if (current === ';') {
      if (customPropertyValue && customPropertyBraceDepth) {
        continue
      }
      segmentStart = index + 1
      segmentHasComment = false
      customPropertyBraceDepth = 0
      customPropertyValue = false
      continue
    }

    if (current === '{') {
      const preludeSource = source.slice(segmentStart, index)
      const normalizedPrelude = segmentHasComment
        ? normalizePrelude(preludeSource)
        : preludeSource.trim()
      const blockKind = getBlockKind(normalizedPrelude)

      visitPrelude({
        blockKind,
        end: index,
        normalizedPrelude,
        parentKind: stack[stack.length - 1],
        preludeSource,
        start: segmentStart,
      })

      stack.push(blockKind)
      segmentStart = index + 1
      segmentHasComment = false
      customPropertyBraceDepth = 0
      customPropertyValue = false
      continue
    }

    if (current === '}') {
      stack.pop()
      segmentStart = index + 1
      segmentHasComment = false
      customPropertyBraceDepth = 0
      customPropertyValue = false
    }
  }
}

function getBlockKind(prelude: string): CssBlockKind {
  if (keyframesPreludeRE.test(prelude)) {
    return 'keyframes'
  }
  return prelude.startsWith('@') ? 'at-rule' : 'style'
}

function normalizePrelude(prelude: string): string {
  return prelude.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
}

function isCustomPropertyDeclarationPrelude(prelude: string): boolean {
  return normalizePrelude(prelude).startsWith('--')
}
