import { normalizeEscapedKeyframesName } from '../../keyframeNames'
import { findTopLevelSeparatorIndex, splitTopLevelSegments } from './scan'

export function rewriteAnimationNameValue(
  value: string,
  keyframes: Record<string, string>,
): string {
  return splitTopLevelSegments(value, ',')
    .map(part => rewriteAnimationNameComponent(part.trim(), keyframes))
    .join(', ')
}

export function rewriteRawAnimationIdentifier(
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

export function isVarFunctionCall(value: string): boolean {
  return /^var\(/i.test(value)
}

function rewriteAnimationNameComponent(
  value: string,
  keyframes: Record<string, string>,
): string {
  if (!value) {
    return value
  }

  if (isVarFunctionCall(value)) {
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

function rewriteVarFunctionFallback(
  source: string,
  rewriteFallback: (fallback: string) => string,
): string {
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
  const trimmedFallback = fallback.trim()
  const rewrittenFallback = rewriteFallback(trimmedFallback)
  if (rewrittenFallback === trimmedFallback) {
    return source
  }

  return `${source.slice(0, openParenIndex + 1)}${content.slice(0, commaIndex + 1)}${leading}${rewrittenFallback}${trailing})`
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
