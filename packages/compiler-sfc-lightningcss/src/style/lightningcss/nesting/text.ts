import type MagicString from 'magic-string'
import {
  type CssBlockNode,
  findLastNonWhitespaceIndex,
  findTrimmedSourceRange,
  forEachTopLevelTextRange,
  hasMeaningfulCssText,
  someTopLevelTextRange,
} from '@vue/lightningcss-utils'

// Reuse Vue's existing `:global(...)` escape hatch as the source-level carrier
// for “do not inject the normal scope attribute on this selector”.
const noInjectCarrierPseudoName = 'global'

export function wrapPreludeInNoInjectCarrier(
  block: CssBlockNode,
  s: MagicString,
): boolean {
  const trimmedRange = findTrimmedSourceRange(block.preludeSource, block.start)
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
  forEachTopLevelTextRange(block, (start, end) => {
    changed = wrapTextSegment(source, s, start, end, wrapperPrelude) || changed
  })
  return changed
}

export function createNoInjectAmpPrelude(): string {
  return `:${noInjectCarrierPseudoName}(&)`
}

export function hasMeaningfulTopLevelText(
  block: CssBlockNode,
  source: string,
): boolean {
  return someTopLevelTextRange(block, (start, end) =>
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
