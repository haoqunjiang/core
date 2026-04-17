import { walkCssBlockPreludes } from '@vue/lightningcss-lexer'
import { hasCssVarsBinding } from '../cssVars'

export interface SFCStyleLightningCSSFeatures {
  hasAnimationDeclarations: boolean
  hasNestedStyleRules: boolean
  hasScopedSelectorSpecials: boolean
  hasVBind: boolean
  keyframes: Record<string, string>
}

const keyframesPreludePrefixRE = /^@(?:-\w+-)?keyframes\b\s+/i

export function analyzeStyleLightningCSSFeatures(
  source: string,
  id: string,
): SFCStyleLightningCSSFeatures {
  const shortId = id.replace(/^data-v-/, '')
  const features: SFCStyleLightningCSSFeatures = {
    hasAnimationDeclarations: /animation/i.test(source),
    hasNestedStyleRules: false,
    hasScopedSelectorSpecials:
      source.includes(':deep(') ||
      source.includes('::v-deep') ||
      source.includes('>>>') ||
      source.includes('/deep/') ||
      source.includes(':slotted(') ||
      source.includes('::v-slotted') ||
      source.includes(':global(') ||
      source.includes('::v-global'),
    hasVBind: hasCssVarsBinding(source),
    keyframes: Object.create(null),
  }

  walkCssBlockPreludes(source, prelude => {
    if (prelude.parentKind === 'style') {
      features.hasNestedStyleRules = true
    }
    registerKeyframesPrelude(
      prelude.normalizedPrelude,
      shortId,
      features.keyframes,
    )
  })

  return features
}

function registerKeyframesPrelude(
  prelude: string,
  shortId: string,
  keyframes: Record<string, string>,
): void {
  const name = extractKeyframesPreludeName(prelude)
  if (!name) {
    return
  }

  if (!name.endsWith(`-${shortId}`)) {
    keyframes[name] = `${name}-${shortId}`
  }
}

function extractKeyframesPreludeName(prelude: string): string | null {
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

function decodeCssEscape(
  source: string,
  start: number,
): { end: number; value: string } {
  let index = start + 1
  if (index >= source.length) {
    return { end: index, value: '\\' }
  }

  const first = source[index]
  if (first === '\r') {
    index++
    if (source[index] === '\n') {
      index++
    }
    return { end: index, value: '' }
  }

  if (first === '\n' || first === '\f') {
    return { end: index + 1, value: '' }
  }

  if (isHexDigit(first)) {
    let hex = first
    index++
    while (
      index < source.length &&
      hex.length < 6 &&
      isHexDigit(source[index])
    ) {
      hex += source[index]
      index++
    }
    if (
      source[index] === ' ' ||
      source[index] === '\t' ||
      source[index] === '\n' ||
      source[index] === '\r' ||
      source[index] === '\f'
    ) {
      index++
    }

    const codePoint = Number.parseInt(hex, 16)
    return {
      end: index,
      value:
        codePoint === 0 || codePoint > 0x10ffff
          ? '\uFFFD'
          : String.fromCodePoint(codePoint),
    }
  }

  return {
    end: index + 1,
    value: first,
  }
}

function isHexDigit(char: string | undefined): char is string {
  if (!char) {
    return false
  }

  const code = char.charCodeAt(0)
  return (
    (code >= '0'.charCodeAt(0) && code <= '9'.charCodeAt(0)) ||
    (code >= 'A'.charCodeAt(0) && code <= 'F'.charCodeAt(0)) ||
    (code >= 'a'.charCodeAt(0) && code <= 'f'.charCodeAt(0))
  )
}
