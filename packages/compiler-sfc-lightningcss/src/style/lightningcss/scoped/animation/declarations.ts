import type MagicString from 'magic-string'
import type { CssBlockNode } from '@vue/lightningcss-lexer'
import { findTopLevelColon } from './scan'
import { rewriteAnimationNameValue } from './names'
import { rewriteAnimationShorthandValue } from './shorthand'

const animationNamePropertyRE = /^(?:-\w+-)?animation-name$/i
const animationPropertyRE = /^(?:-\w+-)?animation$/i

export function rewriteAnimationDeclarationsInBlock(
  block: CssBlockNode,
  source: string,
  s: MagicString,
  keyframes: Record<string, string>,
): boolean {
  let changed = false
  let cursor = block.bodyStart

  for (const child of block.children) {
    changed =
      rewriteAnimationDeclarationsInRange(
        source,
        s,
        cursor,
        child.start,
        keyframes,
      ) || changed
    changed =
      rewriteAnimationDeclarationsInBlock(child, source, s, keyframes) ||
      changed
    cursor = child.end
  }

  return (
    rewriteAnimationDeclarationsInRange(
      source,
      s,
      cursor,
      block.bodyEnd,
      keyframes,
    ) || changed
  )
}

function rewriteAnimationDeclarationsInRange(
  source: string,
  s: MagicString,
  start: number,
  end: number,
  keyframes: Record<string, string>,
): boolean {
  let changed = false
  let declarationStart = start

  for (let index = start; index < end; index++) {
    if (source[index] !== ';') {
      continue
    }

    changed =
      rewriteAnimationDeclaration(source, s, declarationStart, index, keyframes) ||
      changed
    declarationStart = index + 1
  }

  changed =
    rewriteAnimationDeclaration(source, s, declarationStart, end, keyframes) ||
    changed

  return changed
}

function rewriteAnimationDeclaration(
  source: string,
  s: MagicString,
  start: number,
  end: number,
  keyframes: Record<string, string>,
): boolean {
  const rawDeclaration = source.slice(start, end)
  const colonOffset = findTopLevelColon(rawDeclaration)
  if (colonOffset === -1) {
    return false
  }

  const property = rawDeclaration.slice(0, colonOffset).trim().toLowerCase()
  if (
    !animationPropertyRE.test(property) &&
    !animationNamePropertyRE.test(property)
  ) {
    return false
  }

  const valueStart = start + colonOffset + 1
  const rawValue = source.slice(valueStart, end)
  const leadingMatch = rawValue.match(/^\s*/)
  const trailingMatch = rawValue.match(/\s*$/)
  const leading = leadingMatch ? leadingMatch[0] : ''
  const trailing = trailingMatch ? trailingMatch[0] : ''
  const trimmedValue = rawValue.trim()
  if (!trimmedValue) {
    return false
  }

  const rewrittenValue = animationNamePropertyRE.test(property)
    ? rewriteAnimationNameValue(trimmedValue, keyframes)
    : rewriteAnimationShorthandValue(trimmedValue, keyframes)
  if (rewrittenValue === trimmedValue) {
    return false
  }

  s.overwrite(valueStart, end, `${leading}${rewrittenValue}${trailing}`)
  return true
}
