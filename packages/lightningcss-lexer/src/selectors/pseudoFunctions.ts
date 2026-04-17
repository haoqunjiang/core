import type { PseudoClassSelector, Selector } from './shared'
import { isWhitespace } from './shared'

type ParseSelectorList = (source: string) => Selector[]

const nthKinds = new Set([
  'nth-child',
  'nth-last-child',
  'nth-col',
  'nth-last-col',
  'nth-of-type',
  'nth-last-of-type',
])

export function parseStandardPseudoClassFunction(
  name: string,
  content: string,
  parseSelectorList: ParseSelectorList,
): PseudoClassSelector | undefined {
  if (name === 'lang') {
    return {
      type: 'pseudo-class',
      kind: 'lang',
      languages: parseLanguageList(content),
    } as PseudoClassSelector
  }

  if (name === 'dir') {
    const direction = content.trim()
    if (direction !== 'ltr' && direction !== 'rtl') {
      throw new Error(`Unsupported :dir() argument: ${content}.`)
    }
    return {
      type: 'pseudo-class',
      kind: 'dir',
      direction,
    } as PseudoClassSelector
  }

  if (nthKinds.has(name)) {
    return parseNthPseudoClass(name, content, parseSelectorList)
  }
}

function parseLanguageList(content: string): string[] {
  return splitTopLevel(content, ',').map(part => {
    const trimmed = part.trim()
    if (!trimmed) {
      throw new Error('Expected language code in :lang().')
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  })
}

function parseNthPseudoClass(
  name: string,
  content: string,
  parseSelectorList: ParseSelectorList,
): PseudoClassSelector {
  const { formula, of } = splitNthOf(content)
  const { a, b } = parseNthFormula(formula)

  const selector: PseudoClassSelector = {
    type: 'pseudo-class',
    kind: name as PseudoClassSelector['kind'],
    a,
    b,
  } as PseudoClassSelector

  if ((name === 'nth-child' || name === 'nth-last-child') && of) {
    ;(selector as PseudoClassSelector & { of?: Selector[] | null }).of =
      parseSelectorList(of)
  }

  return selector
}

function splitNthOf(content: string): { formula: string; of: string | null } {
  let depth = 0
  let quote: string | null = null

  for (let index = 0; index < content.length; index++) {
    const char = content[index]

    if (quote) {
      if (char === '\\') {
        index++
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '(' || char === '[') {
      depth++
      continue
    }
    if (char === ')' || char === ']') {
      depth--
      continue
    }

    if (
      depth === 0 &&
      (char === 'o' || char === 'O') &&
      (content[index + 1] === 'f' || content[index + 1] === 'F')
    ) {
      const before = content[index - 1]
      const after = content[index + 2]
      if (isWhitespace(before) && isWhitespace(after)) {
        return {
          formula: content.slice(0, index).trim(),
          of: content.slice(index + 2).trim(),
        }
      }
    }
  }

  return {
    formula: content.trim(),
    of: null,
  }
}

function parseNthFormula(formula: string): { a: number; b: number } {
  const normalized = formula.replace(/\s+/g, '').toLowerCase()

  if (normalized === 'odd') {
    return { a: 2, b: 1 }
  }
  if (normalized === 'even') {
    return { a: 2, b: 0 }
  }
  if (/^[+-]?\d+$/.test(normalized)) {
    return { a: 0, b: Number.parseInt(normalized, 10) }
  }

  const match = /^([+-]?\d*)n([+-]\d+)?$/.exec(normalized)
  if (!match) {
    throw new Error(`Unsupported nth pseudo argument: ${formula}.`)
  }

  const rawA = match[1]
  const a =
    rawA === '' || rawA === '+'
      ? 1
      : rawA === '-'
        ? -1
        : Number.parseInt(rawA, 10)
  const b = match[2] ? Number.parseInt(match[2], 10) : 0
  return { a, b }
}

function splitTopLevel(source: string, separator: string): string[] {
  const result: string[] = []
  let start = 0
  let depth = 0
  let quote: string | null = null

  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === '\\') {
        index++
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(' || char === '[') {
      depth++
      continue
    }
    if (char === ')' || char === ']') {
      depth--
      continue
    }
    if (depth === 0 && char === separator) {
      result.push(source.slice(start, index))
      start = index + 1
    }
  }

  result.push(source.slice(start))
  return result
}
