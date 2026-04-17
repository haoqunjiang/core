import { decodeCssEscape } from '@vue/lightningcss-utils'

const keyframesPreludePrefixRE = /^@(?:-\w+-)?keyframes\b\s+/i

export function registerScopedKeyframeRename(
  prelude: string,
  shortId: string,
  keyframes: Record<string, string>,
): void {
  const name = extractKeyframesPreludeName(prelude)
  if (!name || name.endsWith(`-${shortId}`)) {
    return
  }
  keyframes[name] = `${name}-${shortId}`
}

export function extractKeyframesPreludeName(prelude: string): string | null {
  const prefixMatch = prelude.match(keyframesPreludePrefixRE)
  if (!prefixMatch) {
    return null
  }

  const nameSource = prelude.slice(prefixMatch[0].length).trimStart()
  if (!nameSource) {
    return null
  }

  const quotedName = parseQuotedKeyframesName(nameSource)
  if (quotedName !== null) {
    return normalizeEscapedKeyframesName(quotedName)
  }

  const unquotedMatch = nameSource.match(/^[^{;\s]+/)
  return unquotedMatch ? normalizeEscapedKeyframesName(unquotedMatch[0]) : null
}

export function normalizeEscapedKeyframesName(name: string): string {
  let normalized = ''

  for (let index = 0; index < name.length; index++) {
    const char = name[index]
    if (char !== '\\') {
      normalized += char
      continue
    }

    const escape = decodeCssEscape(name, index)
    normalized += escape.value
    index = escape.end - 1
  }

  return normalized
}

function parseQuotedKeyframesName(source: string): string | null {
  const quote = source[0]
  if (quote !== '"' && quote !== "'") {
    return null
  }

  let value = ''
  for (let index = 1; index < source.length; index++) {
    const current = source[index]
    if (current === '\\') {
      if (index + 1 >= source.length) {
        return null
      }
      value += current + source[index + 1]
      index++
      continue
    }

    if (current === quote) {
      return value
    }

    value += current
  }

  return null
}
