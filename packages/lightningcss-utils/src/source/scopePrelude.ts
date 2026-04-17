import { isWhitespace } from '../selectors/shared'

type SelectorComponentKind =
  | 'combinator'
  | 'container'
  | 'nesting'
  | 'pseudo'
  | 'regular'
  | 'universal'

interface SelectorComponentRange {
  end: number
  innerEnd?: number
  innerStart?: number
  kind: SelectorComponentKind
  start: number
}

const scopePreludeSelectorContainers: ReadonlySet<string> = new Set([
  'is',
  'where',
])

const asciiZero = '0'.charCodeAt(0)
const asciiNine = '9'.charCodeAt(0)
const asciiUpperA = 'A'.charCodeAt(0)
const asciiUpperZ = 'Z'.charCodeAt(0)
const asciiDash = '-'.charCodeAt(0)
const asciiUnderscore = '_'.charCodeAt(0)
const asciiLowerA = 'a'.charCodeAt(0)
const asciiLowerZ = 'z'.charCodeAt(0)
const nonAsciiThreshold = '\u00A0'.charCodeAt(0)

/**
 * Attempts to inject a fixed scope attribute into a selector-list prelude
 * without building a selector AST.
 *
 * Returns `undefined` when the prelude uses syntax that the direct path does
 * not understand. Callers can then fall back to a parsed-selector rewrite.
 *
 * This API is useful beyond Vue whenever a transform needs a very fast
 * source-to-source rewrite for "boring" selectors and can accept a slower
 * fallback for the rest.
 */
export function scopeSelectorPrelude(
  prelude: string,
  id: string,
): string | undefined {
  return new DirectSelectorPreludeScoper(prelude, id).rewriteSelectorList()
}

class DirectSelectorPreludeScoper {
  private index = 0

  constructor(
    private readonly source: string,
    private readonly id: string,
  ) {}

  rewriteSelectorList(endChar?: string): string | undefined {
    const selectors: string[] = []

    this.skipWhitespaceAndComments()
    while (!this.isDone()) {
      if (endChar && this.peek() === endChar) {
        break
      }

      const selector = this.rewriteSelector(endChar)
      if (selector == null) {
        return
      }

      selectors.push(selector)
      this.skipWhitespaceAndComments()

      if (this.consume(',')) {
        this.skipWhitespaceAndComments()
        continue
      }

      break
    }

    return selectors.join(', ')
  }

  private rewriteSelector(endChar?: string): string | undefined {
    const selectorStart = this.index
    const components: SelectorComponentRange[] = []
    let justConsumedExplicitCombinator = false
    let anchorIndex = -1

    while (!this.isDone()) {
      const skipped = this.skipWhitespaceAndComments()

      const current = this.peek()
      if (
        current == null ||
        current === ',' ||
        (endChar && current === endChar)
      ) {
        break
      }

      if (
        skipped &&
        !justConsumedExplicitCombinator &&
        components.length > 0 &&
        !isExplicitCombinator(current)
      ) {
        components.push({
          kind: 'combinator',
          start: this.index,
          end: this.index,
        })
      }

      const combinator = this.consumeCombinator()
      if (combinator) {
        components.push({
          kind: 'combinator',
          start: combinator.start,
          end: combinator.end,
        })
        justConsumedExplicitCombinator = true
        continue
      }

      const component = this.readComponent()
      if (!component) {
        return
      }
      justConsumedExplicitCombinator = false

      if (component.kind === 'regular') {
        anchorIndex = components.length
      } else if (component.kind === 'universal') {
        if (anchorIndex === -1 && components.length > 0) {
          anchorIndex = components.length
        }
      } else if (component.kind === 'container' && anchorIndex === -1) {
        anchorIndex = components.length
      }

      components.push(component)
    }

    const selectorEnd = this.index
    let selector = this.source.slice(selectorStart, selectorEnd).trim()
    if (!selector) {
      return selector
    }

    let stripStart = -1
    let stripEnd = -1
    if (
      components[0] &&
      components[0].kind === 'universal' &&
      (!components[1] ||
        components[1].kind !== 'combinator' ||
        this.source.slice(components[1].start, components[1].end).trim() === '')
    ) {
      stripStart = components[0].start - selectorStart
      stripEnd = components[0].end - selectorStart
      let sawWhitespace = false
      let cursor = components[0].end
      while (cursor < selectorEnd) {
        const current = this.source[cursor]
        if (isWhitespace(current)) {
          sawWhitespace = true
          cursor++
          continue
        }
        if (current === '/' && this.source[cursor + 1] === '*') {
          const commentEnd = this.source.indexOf('*/', cursor + 2)
          if (commentEnd === -1) {
            return
          }
          cursor = commentEnd + 2
          continue
        }
        break
      }
      if (sawWhitespace) {
        stripEnd = cursor - selectorStart
      }
      selector = selector.slice(0, stripStart) + selector.slice(stripEnd)
    }

    if (
      anchorIndex === -1 &&
      stripStart === -1 &&
      components[0] &&
      components[0].kind === 'universal'
    ) {
      return
    }

    const adjustOffset = (offset: number): number => {
      if (stripStart === -1 || offset <= stripStart) {
        return offset
      }
      return offset - (stripEnd - stripStart)
    }

    if (anchorIndex !== -1) {
      const anchor = components[anchorIndex]
      if (anchor.kind === 'container') {
        const innerStart = adjustOffset(anchor.innerStart! - selectorStart)
        const innerEnd = adjustOffset(anchor.innerEnd! - selectorStart)
        const rewrittenInner = new DirectSelectorPreludeScoper(
          selector.slice(innerStart, innerEnd),
          this.id,
        ).rewriteSelectorList(')')
        if (rewrittenInner == null) {
          return
        }
        return (
          selector.slice(0, innerStart) +
          rewrittenInner +
          selector.slice(innerEnd)
        )
      }

      const insertAt = adjustOffset(anchor.end - selectorStart)
      return (
        selector.slice(0, insertAt) + `[${this.id}]` + selector.slice(insertAt)
      )
    }

    if (components[0] && components[0].kind === 'nesting') {
      const insertAt = adjustOffset(components[0].end - selectorStart)
      return (
        selector.slice(0, insertAt) + `[${this.id}]` + selector.slice(insertAt)
      )
    }

    return `[${this.id}]${selector}`
  }

  private readComponent(): SelectorComponentRange | undefined {
    const start = this.index
    const current = this.peek()
    if (!current) {
      return
    }

    if (current === '.') {
      this.index++
      if (!this.readIdentifier()) {
        return
      }
      return { kind: 'regular', start, end: this.index }
    }

    if (current === '#') {
      this.index++
      if (!this.readIdentifier()) {
        return
      }
      return { kind: 'regular', start, end: this.index }
    }

    if (current === '&') {
      this.index++
      return { kind: 'nesting', start, end: this.index }
    }

    if (current === '*') {
      this.index++
      return { kind: 'universal', start, end: this.index }
    }

    if (current === '[') {
      const end = this.readBalancedBlock('[', ']')
      if (end == null) {
        return
      }
      return { kind: 'regular', start, end }
    }

    if (current === ':') {
      return this.readPseudo()
    }

    if (current === '|' || current === '\\' || current === '/') {
      return
    }

    if (!isIdentifierStart(current)) {
      return
    }

    this.index++
    while (!this.isDone() && isIdentifierContinue(this.peek())) {
      this.index++
    }
    return { kind: 'regular', start, end: this.index }
  }

  private readPseudo(): SelectorComponentRange | undefined {
    const start = this.index
    this.index++
    const isElement = this.consume(':')
    const name = this.readIdentifier()
    if (!name) {
      return
    }

    if (!this.consume('(')) {
      return {
        kind: 'pseudo',
        start,
        end: this.index,
      }
    }

    const innerStart = this.index
    const innerEnd = this.readBalancedContent(')')
    if (innerEnd == null) {
      return
    }

    return {
      kind:
        !isElement && scopePreludeSelectorContainers.has(name)
          ? 'container'
          : 'pseudo',
      start,
      end: this.index,
      innerStart,
      innerEnd,
    }
  }

  private consumeCombinator():
    | {
        end: number
        start: number
      }
    | undefined {
    const current = this.peek()
    if (current === '>' || current === '+' || current === '~') {
      if (current === '>' && this.source.startsWith('>>>', this.index)) {
        return
      }
      const start = this.index
      this.index++
      return {
        start,
        end: this.index,
      }
    }

    if (current === '/' && this.source.startsWith('/deep/', this.index)) {
      return
    }
  }

  private readBalancedBlock(openChar: '[', closeChar: ']'): number | undefined {
    if (!this.consume(openChar)) {
      return
    }

    while (!this.isDone()) {
      if (this.consumeComment()) {
        continue
      }

      const current = this.peek()
      if (current === '"' || current === "'") {
        this.readString(current)
        continue
      }

      if (current === closeChar) {
        this.index++
        return this.index
      }

      this.index++
    }
  }

  private readBalancedContent(endChar: ')' | ']' | '}'): number | undefined {
    let depth = 1

    while (!this.isDone()) {
      if (this.consumeComment()) {
        continue
      }

      const current = this.peek()
      if (current === '"' || current === "'") {
        this.readString(current)
        continue
      }

      if (current === '(' || current === '[' || current === '{') {
        depth++
        this.index++
        continue
      }

      if (current === ')' || current === ']' || current === '}') {
        depth--
        if (depth === 0) {
          const end = this.index
          this.index++
          return end
        }
        this.index++
        continue
      }

      this.index++
    }
  }

  private readString(quote: '"' | "'"): void {
    this.index++
    while (!this.isDone()) {
      const current = this.peek()
      if (current === '\\') {
        this.index += 2
        continue
      }
      this.index++
      if (current === quote) {
        return
      }
    }
  }

  private readIdentifier(): string | undefined {
    const start = this.index
    if (!isIdentifierStart(this.peek())) {
      return
    }

    this.index++
    while (!this.isDone() && isIdentifierContinue(this.peek())) {
      this.index++
    }

    return this.source.slice(start, this.index)
  }

  private skipWhitespaceAndComments(): boolean {
    const start = this.index
    while (this.consumeWhitespace() || this.consumeComment()) {
      continue
    }
    return this.index > start
  }

  private consumeWhitespace(): boolean {
    const start = this.index
    while (!this.isDone() && isWhitespace(this.peek())) {
      this.index++
    }
    return this.index > start
  }

  private consumeComment(): boolean {
    if (this.source.startsWith('/*', this.index)) {
      const end = this.source.indexOf('*/', this.index + 2)
      if (end === -1) {
        return false
      }
      this.index = end + 2
      return true
    }
    return false
  }

  private consume(char: string): boolean {
    if (this.source.startsWith(char, this.index)) {
      this.index += char.length
      return true
    }
    return false
  }

  private peek(): string | undefined {
    return this.source[this.index]
  }

  private isDone(): boolean {
    return this.index >= this.source.length
  }
}

// The direct source path intentionally accepts a narrower identifier subset
// than the full selector parser, so these stay local instead of reusing the
// broader parser helpers.
function isIdentifierStart(char: string | undefined): char is string {
  const code = char == null ? -1 : char.charCodeAt(0)
  return (
    (code >= asciiUpperA && code <= asciiUpperZ) ||
    (code >= asciiLowerA && code <= asciiLowerZ) ||
    code === asciiUnderscore ||
    code === asciiDash ||
    code >= nonAsciiThreshold
  )
}
function isIdentifierContinue(char: string | undefined): char is string {
  const code = char == null ? -1 : char.charCodeAt(0)
  return (
    (code >= asciiZero && code <= asciiNine) ||
    (code >= asciiUpperA && code <= asciiUpperZ) ||
    (code >= asciiLowerA && code <= asciiLowerZ) ||
    code === asciiUnderscore ||
    code === asciiDash ||
    code >= nonAsciiThreshold
  )
}

function isExplicitCombinator(char: string): boolean {
  return char === '>' || char === '+' || char === '~'
}
