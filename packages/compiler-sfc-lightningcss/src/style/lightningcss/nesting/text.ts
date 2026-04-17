import type MagicString from 'magic-string'
import type { CssBlockNode } from '@vue/lightningcss-utils'

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
  forEachTopLevelTextSegmentRange(block, (start, end) => {
    changed = wrapTextSegment(source, s, start, end, wrapperPrelude) || changed
  })
  return changed
}

export function createNoInjectAmpPrelude(): string {
  return `:${noInjectCarrierPseudoName}(&)`
}

export function hasTopLevelTextSegments(
  block: CssBlockNode,
  source: string,
): boolean {
  return someTopLevelTextSegmentRange(block, (start, end) =>
    hasMeaningfulCssText(source.slice(start, end)),
  )
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
  if (!hasMeaningfulCssText(segment)) {
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

function forEachTopLevelTextSegmentRange(
  block: CssBlockNode,
  visit: (start: number, end: number) => void,
): void {
  let segmentStart = block.bodyStart

  for (const child of block.children) {
    visit(segmentStart, child.start)
    segmentStart = child.end
  }

  visit(segmentStart, block.bodyEnd)
}

function someTopLevelTextSegmentRange(
  block: CssBlockNode,
  test: (start: number, end: number) => boolean,
): boolean {
  let segmentStart = block.bodyStart

  for (const child of block.children) {
    if (test(segmentStart, child.start)) {
      return true
    }
    segmentStart = child.end
  }

  return test(segmentStart, block.bodyEnd)
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

function hasMeaningfulCssText(source: string): boolean {
  return !!stripCssComments(source).trim()
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ')
}
