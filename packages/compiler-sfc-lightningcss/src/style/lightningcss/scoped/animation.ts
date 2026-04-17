import type { RawSourceMap } from '@vue/compiler-core'
import type {
  AnimationName,
  Declaration,
  KeyframesName,
  Rule,
} from 'lightningcss'
import { extend } from '@vue/shared'
import {
  parseCssBlockTree,
  walkCssBlockPreludes,
} from '@vue/lightningcss-lexer'
import MagicString from 'magic-string'
import merge from 'merge-source-map'
import { normalizeEscapedKeyframesName } from '../features'
import type { ScopedStyleTransformContext } from './types'

export interface RewriteAnimationDeclarationsResult {
  code: string
  map: RawSourceMap | undefined
}

const animationNamePropertyRE = /^(?:-\w+-)?animation-name$/i
const animationPropertyRE = /^(?:-\w+-)?animation$/i

export function rewriteLightningCssKeyframesRule(
  rule: Extract<Rule, { type: 'keyframes' }>,
  context: ScopedStyleTransformContext,
): typeof rule {
  rewriteLightningCssKeyframesName(rule.value.name, context)
  return rule
}

export function rewriteLightningCssAnimationDeclaration(
  declaration: Declaration,
  context: ScopedStyleTransformContext,
): Declaration | void {
  let changed = false

  switch (declaration.property) {
    case 'animation-name':
      declaration.value = declaration.value.map(value => {
        const rewritten = rewriteLightningCssAnimationName(
          value,
          context.keyframes,
        )
        changed ||= rewritten !== value
        return rewritten
      })
      break
    case 'animation':
      declaration.value = declaration.value.map(value => {
        const rewrittenName = rewriteLightningCssAnimationName(
          value.name,
          context.keyframes,
        )
        if (rewrittenName === value.name) {
          return value
        }

        changed = true
        return extend({}, value, {
          name: rewrittenName,
        })
      })
      break
  }

  return changed ? declaration : undefined
}

export function rewriteAnimationDeclarationsInStyleSource(
  source: string,
  keyframes: Record<string, string>,
): RewriteAnimationDeclarationsResult {
  const s = new MagicString(source)
  return rewriteAnimationSourceKeyframeReferences(source, s, keyframes)
    ? {
        code: s.toString(),
        map: undefined,
      }
    : {
        code: source,
        map: undefined,
      }
}

export function rewriteAnimationDeclarationsInStyleSourceWithMap(
  source: string,
  filename: string,
  keyframes: Record<string, string>,
  map?: RawSourceMap,
): RewriteAnimationDeclarationsResult {
  const s = new MagicString(source)
  if (!rewriteAnimationSourceKeyframeReferences(source, s, keyframes)) {
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

const quotedKeyframesPreludeRE =
  /^(@(?:-\w+-)?keyframes\b\s+)(['"])((?:\\.|(?!\2)[\s\S])*)\2/i

function rewriteAnimationSourceKeyframeReferences(
  source: string,
  s: MagicString,
  keyframes: Record<string, string>,
): boolean {
  const rewroteQuotedKeyframes = rewriteQuotedKeyframesPreludes(
    source,
    s,
    keyframes,
  )
  return (
    rewriteDynamicAnimationDeclarations(source, s, keyframes) ||
    rewroteQuotedKeyframes
  )
}

function rewriteQuotedKeyframesPreludes(
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
    const match = trimmedPrelude.match(quotedKeyframesPreludeRE)
    if (!match) {
      return
    }

    const rewrittenName = rewriteRawAnimationIdentifier(match[3], keyframes)
    if (!rewrittenName || rewrittenName === match[3]) {
      return
    }

    const contentStart =
      prelude.start + leadingWhitespaceLength + match[1].length + 1
    s.overwrite(contentStart, contentStart + match[3].length, rewrittenName)
    changed = true
  })

  return changed
}

function rewriteLightningCssAnimationName(
  value: AnimationName,
  keyframes: Record<string, string>,
): AnimationName {
  if (
    (value.type === 'ident' || value.type === 'string') &&
    keyframes[value.value]
  ) {
    return extend({}, value, { value: keyframes[value.value] })
  }

  return value
}

function rewriteLightningCssKeyframesName(
  name: KeyframesName,
  context: ScopedStyleTransformContext,
): void {
  const runtimeName = name as KeyframesName & {
    type: 'ident' | 'string'
    value: string
  }
  if (
    (runtimeName.type === 'ident' || runtimeName.type === 'string') &&
    !runtimeName.value.endsWith(`-${context.shortId}`)
  ) {
    context.keyframes[runtimeName.value] =
      runtimeName.value = `${runtimeName.value}-${context.shortId}`
  }
}

function rewriteDynamicAnimationDeclarations(
  source: string,
  s: MagicString,
  keyframes: Record<string, string>,
): boolean {
  if (!Object.keys(keyframes).length) {
    return false
  }

  let changed = false
  for (const block of parseCssBlockTree(source)) {
    changed =
      rewriteDynamicAnimationDeclarationsInBlock(block, source, s, keyframes) ||
      changed
  }
  return changed
}

function rewriteDynamicAnimationDeclarationsInBlock(
  block: ReturnType<typeof parseCssBlockTree>[number],
  source: string,
  s: MagicString,
  keyframes: Record<string, string>,
): boolean {
  let changed = false
  let cursor = block.bodyStart

  for (const child of block.children) {
    changed =
      rewriteDynamicAnimationDeclarationsInRange(
        source,
        s,
        cursor,
        child.start,
        keyframes,
      ) || changed
    changed =
      rewriteDynamicAnimationDeclarationsInBlock(child, source, s, keyframes) ||
      changed
    cursor = child.end
  }

  return (
    rewriteDynamicAnimationDeclarationsInRange(
      source,
      s,
      cursor,
      block.bodyEnd,
      keyframes,
    ) || changed
  )
}

function rewriteDynamicAnimationDeclarationsInRange(
  source: string,
  s: MagicString,
  start: number,
  end: number,
  keyframes: Record<string, string>,
): boolean {
  let changed = false
  let segmentStart = start
  let bracketDepth = 0
  let parenDepth = 0
  let quote: '"' | "'" | undefined

  for (let index = start; index < end; index++) {
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
      if (commentEnd === -1 || commentEnd >= end) {
        break
      }
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

    if (parenDepth || bracketDepth) {
      continue
    }

    if (current === ';') {
      changed =
        rewriteDynamicAnimationDeclarationSegment(
          source,
          s,
          segmentStart,
          index,
          keyframes,
        ) || changed
      segmentStart = index + 1
    }
  }

  changed =
    rewriteDynamicAnimationDeclarationSegment(
      source,
      s,
      segmentStart,
      end,
      keyframes,
    ) || changed

  return changed
}

function rewriteDynamicAnimationDeclarationSegment(
  source: string,
  s: MagicString,
  start: number,
  end: number,
  keyframes: Record<string, string>,
): boolean {
  const rawSegment = source.slice(start, end)
  const colonOffset = findTopLevelColon(rawSegment)
  if (colonOffset === -1) {
    return false
  }

  const property = rawSegment.slice(0, colonOffset).trim().toLowerCase()
  if (
    !animationPropertyRE.test(property) &&
    !animationNamePropertyRE.test(property)
  ) {
    return false
  }

  const valueStart = start + colonOffset + 1
  const rawValue = source.slice(valueStart, end)
  if (!containsVarFunction(rawValue)) {
    return false
  }

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
  if (!rewrittenValue || rewrittenValue === trimmedValue) {
    return false
  }

  s.overwrite(valueStart, end, `${leading}${rewrittenValue}${trailing}`)
  return true
}

function rewriteAnimationNameValue(
  value: string,
  keyframes: Record<string, string>,
): string {
  return splitTopLevelSegments(value, ',')
    .map(part =>
      rewriteAnimationNameComponent(stripCssComments(part).trim(), keyframes),
    )
    .join(', ')
}

function rewriteAnimationShorthandValue(
  value: string,
  keyframes: Record<string, string>,
): string {
  return splitTopLevelSegments(value, ',')
    .map(part => {
      const normalizedPart = stripCssComments(part).trim()
      const tokens = splitTopLevelWhitespace(normalizedPart)
      const index = findAnimationShorthandNameTokenIndex(tokens)
      if (index === -1) {
        return part.trim()
      }

      const rewritten = rewriteAnimationNameComponent(tokens[index], keyframes)
      if (rewritten === tokens[index]) {
        return part.trim()
      }

      const nextTokens = tokens.slice()
      nextTokens[index] = rewritten
      return nextTokens.join(' ')
    })
    .join(', ')
}

function rewriteAnimationNameComponent(
  value: string,
  keyframes: Record<string, string>,
): string {
  if (!value) {
    return value
  }

  if (isVarFunction(value)) {
    return rewriteVarFunctionFallback(value, fallback =>
      rewriteAnimationNameValue(fallback, keyframes),
    )
  }

  const quoted = parseQuotedAnimationName(value)
  if (quoted) {
    const rewrittenInner = rewriteRawAnimationIdentifier(
      quoted.value,
      keyframes,
    )
    return rewrittenInner
      ? `${quoted.quote}${rewrittenInner}${quoted.quote}`
      : value
  }

  return rewriteRawAnimationIdentifier(value, keyframes) || value
}

function findAnimationShorthandNameTokenIndex(tokens: string[]): number {
  const explicitCandidates: number[] = []
  const varCandidates: number[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token) {
      continue
    }

    if (isAnimationTimeToken(token)) {
      continue
    }

    if (
      isAnimationTimingFunctionToken(token) ||
      isAnimationIterationCountToken(token) ||
      isAnimationDirectionToken(token) ||
      isAnimationFillModeToken(token) ||
      isAnimationPlayStateToken(token)
    ) {
      continue
    }

    if (isVarFunction(token)) {
      varCandidates.push(index)
      continue
    }

    explicitCandidates.push(index)
  }

  if (explicitCandidates.length) {
    return explicitCandidates[explicitCandidates.length - 1]
  }

  return varCandidates.length ? varCandidates[varCandidates.length - 1] : -1
}

function rewriteVarFunctionFallback(
  source: string,
  rewriteFallback: (fallback: string) => string,
): string {
  // Preserve the original `var(...)` spelling and spacing, and only rewrite the
  // fallback branch when one is present.
  if (!isVarFunction(source)) {
    return source
  }

  const openParenIndex = source.indexOf('(')
  const content = source.slice(openParenIndex + 1, -1)
  const commaIndex = findTopLevelSeparatorIndex(content, ',')
  if (commaIndex === -1) {
    return source
  }

  const fallback = content.slice(commaIndex + 1)
  const leadingMatch = fallback.match(/^\s*/)
  const trailingMatch = fallback.match(/\s*$/)
  const leading = leadingMatch ? leadingMatch[0] : ''
  const trailing = trailingMatch ? trailingMatch[0] : ''
  const rewrittenFallback = rewriteFallback(fallback.trim())
  if (rewrittenFallback === fallback.trim()) {
    return source
  }

  return `${source.slice(0, openParenIndex + 1)}${content.slice(0, commaIndex + 1)}${leading}${rewrittenFallback}${trailing})`
}

function containsVarFunction(source: string): boolean {
  return /var\(/i.test(source)
}

function parseQuotedAnimationName(
  source: string,
): { quote: '"' | "'"; value: string } | null {
  const quote = source[0]
  if ((quote !== '"' && quote !== "'") || source[source.length - 1] !== quote) {
    return null
  }

  return {
    quote,
    value: source.slice(1, -1),
  }
}

function splitTopLevelSegments(source: string, separator: string): string[] {
  const result: string[] = []
  let start = 0
  let bracketDepth = 0
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

    if (!parenDepth && !bracketDepth && current === separator) {
      result.push(source.slice(start, index))
      start = index + 1
    }
  }

  result.push(source.slice(start))
  return result
}

function splitTopLevelWhitespace(source: string): string[] {
  const result: string[] = []
  let tokenStart = -1
  let bracketDepth = 0
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

    if (current === '"' || current === "'") {
      quote = current
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }

    if (current === '(') {
      parenDepth++
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }
    if (current === ')' && parenDepth) {
      parenDepth--
      continue
    }

    if (current === '[') {
      bracketDepth++
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }
    if (current === ']' && bracketDepth) {
      bracketDepth--
      continue
    }

    if (!parenDepth && !bracketDepth && /\s/.test(current)) {
      if (tokenStart !== -1) {
        result.push(source.slice(tokenStart, index))
        tokenStart = -1
      }
      continue
    }

    if (tokenStart === -1) {
      tokenStart = index
    }
  }

  if (tokenStart !== -1) {
    result.push(source.slice(tokenStart))
  }

  return result
}

function findTopLevelSeparatorIndex(source: string, separator: string): number {
  let bracketDepth = 0
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
        return -1
      }
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

    if (!parenDepth && !bracketDepth && current === separator) {
      return index
    }
  }

  return -1
}

function isVarFunction(value: string): boolean {
  return /^var\(/i.test(value)
}

function isAnimationDirectionToken(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    normalized === 'normal' ||
    normalized === 'reverse' ||
    normalized === 'alternate' ||
    normalized === 'alternate-reverse'
  )
}

function isAnimationFillModeToken(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    normalized === 'none' ||
    normalized === 'forwards' ||
    normalized === 'backwards' ||
    normalized === 'both'
  )
}

function isAnimationIterationCountToken(value: string): boolean {
  return (
    value.toLowerCase() === 'infinite' || /^[+-]?(?:\d+|\d*\.\d+)$/.test(value)
  )
}

function isAnimationPlayStateToken(value: string): boolean {
  const normalized = value.toLowerCase()
  return normalized === 'running' || normalized === 'paused'
}

function isAnimationTimeToken(value: string): boolean {
  return /^[+-]?(?:\d+|\d*\.\d+)(?:ms|s)$/i.test(value)
}

function isAnimationTimingFunctionToken(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    normalized === 'linear' ||
    normalized === 'ease' ||
    normalized === 'ease-in' ||
    normalized === 'ease-out' ||
    normalized === 'ease-in-out' ||
    normalized === 'step-start' ||
    normalized === 'step-end' ||
    /^steps\(/i.test(value) ||
    /^cubic-bezier\(/i.test(value) ||
    /^linear\(/i.test(value)
  )
}

function stripCssComments(source: string): string {
  let result = ''
  let quote: '"' | "'" | undefined

  for (let index = 0; index < source.length; index++) {
    const current = source[index]

    if (quote) {
      result += current
      if (current === '\\' && index + 1 < source.length) {
        result += source[index + 1]
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
      result += ' '
      index = commentEnd + 1
      continue
    }

    if (current === '"' || current === "'") {
      quote = current
    }

    result += current
  }

  return result
}

function rewriteRawAnimationIdentifier(
  raw: string,
  keyframes: Record<string, string>,
): string | undefined {
  const normalized = normalizeEscapedKeyframesName(raw)
  const rewritten = keyframes[normalized]
  if (!rewritten) {
    return undefined
  }

  return raw === normalized || !rewritten.startsWith(normalized)
    ? rewritten
    : raw + rewritten.slice(normalized.length)
}

function findTopLevelColon(segment: string): number {
  let bracketDepth = 0
  let parenDepth = 0
  let quote: '"' | "'" | undefined

  for (let index = 0; index < segment.length; index++) {
    const current = segment[index]

    if (quote) {
      if (current === '\\') {
        index++
      } else if (current === quote) {
        quote = undefined
      }
      continue
    }

    if (current === '/' && segment[index + 1] === '*') {
      const commentEnd = segment.indexOf('*/', index + 2)
      if (commentEnd === -1) {
        return -1
      }
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

    if (!parenDepth && !bracketDepth && current === ':') {
      return index
    }
  }

  return -1
}
