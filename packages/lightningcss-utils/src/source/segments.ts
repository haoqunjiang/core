import type { CssBlockNode } from './blockTree'

export function forEachTopLevelTextRange(
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

export function someTopLevelTextRange(
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

export function findTrimmedSourceRange(
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

export function findLastNonWhitespaceIndex(source: string): number {
  for (let index = source.length - 1; index >= 0; index--) {
    if (!/\s/.test(source[index])) {
      return index
    }
  }

  return -1
}

export function hasMeaningfulCssText(source: string): boolean {
  return !!stripCssComments(source).trim()
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ')
}
