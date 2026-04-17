import type { CssBlockKind } from '../blockPrelude'
import {
  getCssBlockKind,
  isCustomPropertyDeclarationPrelude,
  normalizeBlockPrelude,
} from '../blockShared'

export interface CssBlockNode {
  blockKind: CssBlockKind
  bodyEnd: number
  bodyStart: number
  children: CssBlockNode[]
  end: number
  normalizedPrelude: string
  preludeEnd: number
  preludeSource: string
  start: number
}

/**
 * Builds a lightweight block tree from raw CSS source.
 *
 * This is intentionally structural, not semantic: it only records block
 * ranges, normalized preludes, and child relationships so higher-level source
 * transforms can reason about mixed declarations and nested blocks.
 */
export function parseCssBlockTree(source: string): CssBlockNode[] {
  const roots: CssBlockNode[] = []
  const stack: CssBlockNode[] = []
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
        ? normalizeBlockPrelude(preludeSource)
        : preludeSource.trim()
      const node: CssBlockNode = {
        blockKind: getCssBlockKind(normalizedPrelude),
        bodyEnd: -1,
        bodyStart: index + 1,
        children: [],
        end: -1,
        normalizedPrelude,
        preludeEnd: index,
        preludeSource,
        start: segmentStart,
      }

      const parent = stack[stack.length - 1]
      if (parent) {
        parent.children.push(node)
      } else {
        roots.push(node)
      }

      stack.push(node)
      segmentStart = index + 1
      segmentHasComment = false
      customPropertyBraceDepth = 0
      customPropertyValue = false
      continue
    }

    if (current === '}') {
      const node = stack.pop()
      if (node) {
        node.bodyEnd = index
        node.end = index + 1
      }
      segmentStart = index + 1
      segmentHasComment = false
      customPropertyBraceDepth = 0
      customPropertyValue = false
    }
  }

  return roots
}
