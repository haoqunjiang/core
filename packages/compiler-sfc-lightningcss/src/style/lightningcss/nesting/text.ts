import type MagicString from 'magic-string'
import type { CssBlockNode } from '@vue/lightningcss-lexer'

// Reuse Vue's existing `:global(...)` escape hatch as the source-level carrier
// for “do not inject the normal scope attribute on this selector”.
const noInjectCarrierPseudoName = 'global'

export function wrapPreludeInNoInjectCarrier(
  block: CssBlockNode,
  s: MagicString,
): boolean {
  const trimmedRange = findTrimmedRange(block.preludeSource, block.start)
  if (!trimmedRange) {
    return false
  }

  s.overwrite(
    trimmedRange.start,
    trimmedRange.end,
    `:${noInjectCarrierPseudoName}(${trimmedRange.text})`,
  )
  return true
}

export function wrapTopLevelTextSegments(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  wrapperPrelude: string,
): boolean {
  let changed = false
  let segmentStart = block.bodyStart

  for (const child of block.children) {
    changed =
      wrapTextSegment(source, s, segmentStart, child.start, wrapperPrelude) ||
      changed
    segmentStart = child.end
  }

  return (
    wrapTextSegment(source, s, segmentStart, block.bodyEnd, wrapperPrelude) ||
    changed
  )
}

export function createNoInjectAmpPrelude(): string {
  return `:${noInjectCarrierPseudoName}(&)`
}

function wrapTextSegment(
  source: string,
  s: MagicString,
  start: number,
  end: number,
  wrapperPrelude: string,
): boolean {
  if (start >= end) {
    return false
  }

  const segment = source.slice(start, end)
  if (!stripCssComments(segment).trim()) {
    return false
  }

  const firstContentOffset = segment.search(/\S/)
  const lastContentOffset = findLastNonWhitespaceIndex(segment)
  if (firstContentOffset === -1 || lastContentOffset === -1) {
    return false
  }

  const contentStart = start + firstContentOffset
  const contentEnd = start + lastContentOffset + 1
  s.appendLeft(contentStart, `${wrapperPrelude} {`)
  s.appendRight(contentEnd, `}`)
  return true
}

function findTrimmedRange(
  source: string,
  absoluteStart: number,
): { end: number; start: number; text: string } | null {
  const leadingMatch = source.match(/^\s*/)
  const trailingMatch = source.match(/\s*$/)
  const leadingLength = leadingMatch ? leadingMatch[0].length : 0
  const trailingLength = trailingMatch ? trailingMatch[0].length : 0
  const trimmedText = source.slice(
    leadingLength,
    source.length - trailingLength,
  )
  if (!trimmedText) {
    return null
  }

  return {
    end: absoluteStart + source.length - trailingLength,
    start: absoluteStart + leadingLength,
    text: trimmedText,
  }
}

function findLastNonWhitespaceIndex(source: string): number {
  for (let index = source.length - 1; index >= 0; index--) {
    if (!/\s/.test(source[index])) {
      return index
    }
  }

  return -1
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ')
}
