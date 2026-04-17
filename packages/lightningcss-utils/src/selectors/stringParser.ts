import type { Selector, SelectorComponent, SelectorList } from 'lightningcss'
import {
  decodeCssEscape,
  isIdentifierContinue,
  isIdentifierStart,
} from './identifiers'
import { SelectorParserBase } from './parserBase'
import {
  type AttrOperation,
  type LocalNamespaceConstraint,
  type ParsedCaseSensitivity,
  type SelectorParserOptions,
  createCombinator,
  isWhitespace,
  setParsedSelectorSource,
} from './shared'

export class StringSelectorParser extends SelectorParserBase<string, number> {
  private index = 0
  private readonly endIndex: number
  private readonly sourceContainsComments: boolean

  constructor(
    private readonly source: string,
    options: SelectorParserOptions,
    start: number = 0,
    end: number = source.length,
    sourceContainsComments?: boolean,
  ) {
    super(options)
    this.index = start
    this.endIndex = end
    this.sourceContainsComments =
      sourceContainsComments ??
      (() => {
        const commentIndex = source.indexOf('/*', start)
        return commentIndex !== -1 && commentIndex < end
      })()
  }

  protected parseComponents(): SelectorComponent[] {
    const current = this.peek()
    if (current == null) {
      throw new Error('Unexpected end of selector input.')
    }

    if (current === '.') {
      this.index++
      return [
        {
          type: 'class',
          name: this.readIdentifier(),
        },
      ]
    }

    if (current === '#') {
      this.index++
      return [
        {
          type: 'id',
          name: this.readIdentifier(),
        },
      ]
    }

    if (current === '&' && this.peek(1) !== '|') {
      this.index++
      return [{ type: 'nesting' }]
    }

    if (current === '[') {
      return [this.parseAttribute()]
    }

    if (current === ':') {
      return [this.parsePseudo()]
    }

    if (current === '*') {
      if (this.peek(1) === '|') {
        this.index += 2
        return [
          { type: 'namespace', kind: 'any' },
          this.parseNamespacedTarget(),
        ]
      }
      this.index++
      return [{ type: 'universal' }]
    }

    if (current === '|') {
      this.index++
      return [
        { type: 'namespace', kind: 'none' },
        this.parseNamespacedTarget(),
      ]
    }

    if (current === '&' && this.peek(1) === '|') {
      this.index += 2
      return [
        { type: 'namespace', kind: 'named', prefix: '&' },
        this.parseNamespacedTarget(),
      ]
    }

    if (!isIdentifierStart(current) && current !== '\\') {
      throw new Error(`Unsupported selector token: "${current}".`)
    }

    const identifier = this.readIdentifier()
    if (this.consume('|')) {
      return [
        { type: 'namespace', kind: 'named', prefix: identifier },
        this.parseNamespacedTarget(),
      ]
    }

    return [
      {
        type: 'type',
        name: identifier,
      },
    ]
  }

  protected parseCombinator():
    | Extract<SelectorComponent, { type: 'combinator' }>
    | undefined {
    if (this.peek() === '>' && this.peek(1) === '>' && this.peek(2) === '>') {
      this.index += 3
      return createCombinator('deep-descendant')
    }

    const current = this.peek()
    if (current === '>') {
      this.index++
      return createCombinator('child')
    }
    if (current === '+') {
      this.index++
      return createCombinator('next-sibling')
    }
    if (current === '~') {
      this.index++
      return createCombinator('later-sibling')
    }
    if (current === '|' && this.peek(1) === '|') {
      this.index += 2
      return createCombinator('column')
    }
    if (current === '/') {
      const namedCombinator = this.readNamedCombinator()
      if (namedCombinator) {
        return namedCombinator
      }
    }
  }

  protected readAttributeOperator(): AttrOperation['operator'] | null {
    const current = this.peek()
    const next = this.peek(1)
    if (next === '=') {
      switch (current) {
        case '~':
          this.index += 2
          return 'includes'
        case '|':
          this.index += 2
          return 'dash-match'
        case '^':
          this.index += 2
          return 'prefix'
        case '$':
          this.index += 2
          return 'suffix'
        case '*':
          this.index += 2
          return 'substring'
      }
    }

    if (this.consume('=')) {
      return 'equal'
    }

    return null
  }

  protected readAttributeValue(): string {
    const quote = this.peek()
    if (quote === '"' || quote === "'") {
      this.index++
      let value = ''
      while (!this.isDone() && this.peek() !== quote) {
        if (this.peek() === '\\') {
          const escaped = decodeCssEscape(this.source, this.index)
          value += escaped.value
          this.index = escaped.end
          continue
        }
        value += this.peek()
        this.index++
      }
      if (this.isDone()) {
        throw new Error('Unterminated attribute string.')
      }
      this.index++
      return value
    }

    return this.readIdentifier()
  }

  protected readAttributeCaseSensitivity():
    | ParsedCaseSensitivity
    | undefined {
    const marker = this.peek()
    if (marker === 'i' || marker === 'I') {
      this.index++
      return 'ascii-case-insensitive'
    }
    if (marker === 's' || marker === 'S') {
      this.index++
      return 'explicit-case-sensitive'
    }
  }

  private readBalancedRange(endChar: ')' | ']' | '}'): {
    end: number
    start: number
  } {
    const start = this.index
    let depth = 1

    while (!this.isDone()) {
      if (this.sourceContainsComments && this.consumeComment()) {
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
          return { end, start }
        }
        this.index++
        continue
      }

      this.index++
    }

    throw new Error(`Unterminated block, expected "${endChar}".`)
  }

  private readString(quote: '"' | "'"): void {
    this.expect(quote)
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

    throw new Error('Unterminated string in selector.')
  }

  protected readIdentifier(): string {
    if (!isIdentifierStart(this.peek()) && this.peek() !== '\\') {
      throw new Error('Expected selector identifier.')
    }

    if (!this.sourceContainsComments && this.peek() !== '\\') {
      const start = this.index
      this.index++
      while (!this.isDone()) {
        const current = this.peek()
        if (current === '\\') {
          this.index = start
          break
        }
        if (!isIdentifierContinue(current)) {
          return this.source.slice(start, this.index)
        }
        this.index++
      }
      if (this.index !== start) {
        return this.source.slice(start, this.index)
      }
    }

    let value = ''
    while (!this.isDone()) {
      const current = this.peek()
      if (this.sourceContainsComments && this.consumeComment()) {
        continue
      }
      if (current === '\\') {
        const escaped = decodeCssEscape(this.source, this.index)
        value += escaped.value
        this.index = escaped.end
        continue
      }
      if (
        current != null &&
        (value === ''
          ? isIdentifierStart(current)
          : isIdentifierContinue(current))
      ) {
        value += current
        this.index++
        continue
      }
      break
    }

    return value
  }

  private readNamedCombinator():
    | Extract<SelectorComponent, { type: 'combinator' }>
    | undefined {
    const start = this.index
    if (!this.consume('/')) {
      return
    }

    let name = ''
    while (!this.isDone() && this.peek() !== '/') {
      if (this.peek() === '\\') {
        const escaped = decodeCssEscape(this.source, this.index)
        name += escaped.value
        this.index = escaped.end
        continue
      }
      name += this.peek()
      this.index++
    }

    if (!this.consume('/')) {
      this.index = start
      return
    }

    if (name.toLowerCase() === 'deep') {
      return createCombinator('deep')
    }

    this.index = start
  }

  protected readAttributeNameWithNamespace(): {
    name: string
    namespace: LocalNamespaceConstraint | null
  } {
    if (this.peek() === '|') {
      this.index++
      return {
        name: this.readIdentifier(),
        namespace: { type: 'none' },
      }
    }

    if (this.peek() === '*' && this.peek(1) === '|') {
      this.index += 2
      return {
        name: this.readIdentifier(),
        namespace: { type: 'any' },
      }
    }

    const identifier = this.readIdentifier()
    if (this.peek() === '|' && this.peek(1) !== '=') {
      this.index++
      return {
        name: this.readIdentifier(),
        namespace: {
          type: 'specific',
          prefix: identifier,
          url: identifier,
        },
      }
    }

    return {
      name: identifier,
      namespace: null,
    }
  }

  private parseNamespacedTarget(): SelectorComponent {
    if (this.consume('*')) {
      return { type: 'universal' }
    }
    if (this.peek() === '&') {
      this.index++
      return { type: 'nesting' }
    }
    return {
      type: 'type',
      name: this.readIdentifier(),
    }
  }

  protected consumeWhitespace(): boolean {
    const start = this.index
    while (!this.isDone()) {
      const current = this.peek()
      if (current == null || !isWhitespace(current)) {
        break
      }
      this.index++
    }
    return this.index > start
  }

  protected consumeComment(): boolean {
    if (
      this.sourceContainsComments &&
      this.peek() === '/' &&
      this.peek(1) === '*'
    ) {
      const end = this.source.indexOf('*/', this.index + 2)
      if (end === -1) {
        throw new Error('Unterminated selector comment.')
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

  private expect(char: string): void {
    if (!this.consume(char)) {
      throw new Error(`Expected "${char}" in selector input.`)
    }
  }

  private peek(offset = 0): string | undefined {
    const nextIndex = this.index + offset
    return nextIndex < this.endIndex ? this.source[nextIndex] : undefined
  }

  protected isDone(): boolean {
    return this.index >= this.endIndex
  }

  protected parseNestedSelectorList(): SelectorList {
    const { start, end } = this.readBalancedRange(')')
    return this.parseSelectorListRange(start, end)
  }

  protected parseSelectorListFromSource(source: string): SelectorList {
    return new StringSelectorParser(source, this.options).parseSelectorList()
  }

  protected readPseudoFunctionContentSource(): string {
    const { start, end } = this.readBalancedRange(')')
    return this.sliceRange(start, end)
  }

  protected expectAttributeStart(): void {
    this.expect('[')
  }

  protected expectAttributeEnd(): void {
    this.expect(']')
  }

  protected expectPseudoStart(): void {
    this.expect(':')
  }

  protected consumePseudoElementMarker(): boolean {
    return this.consume(':')
  }

  protected beginPseudoFunctionArguments(): boolean {
    return this.consume('(')
  }

  protected isAtSelectorListBoundary(endChar?: string): boolean {
    const current = this.peek()
    return current == null || current === ',' || (!!endChar && current === endChar)
  }

  protected consumeSelectorListSeparator(): boolean {
    return this.consume(',')
  }

  protected markSelectorStart(): number {
    return this.index
  }

  protected recordParsedSelectorSource(
    selector: Selector,
    selectorLeadingTriviaStart: number,
  ): void {
    if (!this.sourceContainsComments) {
      return
    }

    const rawSelectorSource = this.source
      .slice(selectorLeadingTriviaStart, this.index)
      .trim()
    if (rawSelectorSource.includes('/*')) {
      setParsedSelectorSource(selector, rawSelectorSource)
    }
  }

  private parseSelectorListRange(start: number, end: number): SelectorList {
    return new StringSelectorParser(
      this.source,
      this.options,
      start,
      end,
      this.sourceContainsComments,
    ).parseSelectorList()
  }

  private sliceRange(start: number, end: number): string {
    return this.source.slice(start, end)
  }
}
