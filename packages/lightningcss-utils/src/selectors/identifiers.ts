const asciiZero = '0'.charCodeAt(0)
const asciiNine = '9'.charCodeAt(0)
const asciiUpperA = 'A'.charCodeAt(0)
const asciiUpperF = 'F'.charCodeAt(0)
const asciiUpperZ = 'Z'.charCodeAt(0)
const asciiDash = '-'.charCodeAt(0)
const asciiUnderscore = '_'.charCodeAt(0)
const asciiLowerA = 'a'.charCodeAt(0)
const asciiLowerF = 'f'.charCodeAt(0)
const asciiLowerZ = 'z'.charCodeAt(0)
const nonAsciiThreshold = '\u0080'.charCodeAt(0)

function isAsciiDigitCode(code: number): boolean {
  return code >= asciiZero && code <= asciiNine
}

export function isHexDigit(char: string | undefined): char is string {
  const code = char == null ? -1 : char.charCodeAt(0)
  return (
    isAsciiDigitCode(code) ||
    (code >= asciiUpperA && code <= asciiUpperF) ||
    (code >= asciiLowerA && code <= asciiLowerF)
  )
}

export function isIdentifierStart(char: string | undefined): char is string {
  const code = char == null ? -1 : char.charCodeAt(0)
  return (
    (code >= asciiUpperA && code <= asciiUpperZ) ||
    (code >= asciiLowerA && code <= asciiLowerZ) ||
    code === asciiUnderscore ||
    code === asciiDash ||
    code >= nonAsciiThreshold
  )
}

export function isIdentifierContinue(char: string | undefined): char is string {
  const code = char == null ? -1 : char.charCodeAt(0)
  return (
    isAsciiDigitCode(code) ||
    (code >= asciiUpperA && code <= asciiUpperZ) ||
    (code >= asciiLowerA && code <= asciiLowerZ) ||
    code === asciiUnderscore ||
    code === asciiDash ||
    code >= nonAsciiThreshold
  )
}

export function decodeCssEscape(
  source: string,
  start: number,
): { end: number; value: string } {
  if (source[start] !== '\\') {
    throw new Error('Expected CSS escape.')
  }

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

export function stringifyIdentifier(identifier: string): string {
  let result = ''
  let index = 0

  for (const char of identifier) {
    const code = char.charCodeAt(0)
    const needsLeadingDigitEscape =
      isAsciiDigitCode(code) &&
      (index === 0 || (index === 1 && identifier[0] === '-'))

    if (needsLeadingDigitEscape) {
      result += `\\${char.codePointAt(0)!.toString(16).toUpperCase()} `
      index++
      continue
    }

    if (
      (index === 0 ? isIdentifierStart(char) : isIdentifierContinue(char)) ||
      (char === '-' && index > 0)
    ) {
      result += char
      index++
      continue
    }

    const codePoint = char.codePointAt(0)!
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      result += `\\${codePoint.toString(16).toUpperCase()} `
    } else {
      result += `\\${char}`
    }
    index++
  }

  return result
}
