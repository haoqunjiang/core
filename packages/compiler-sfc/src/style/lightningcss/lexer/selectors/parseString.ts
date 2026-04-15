import type { Selector, SelectorComponent, SelectorList } from 'lightningcss'
import {
  type AttrOperation,
  type AttributeSelector,
  type CustomFunctionSelector,
  type ParsedCaseSensitivity,
  type PseudoClassSelector,
  type PseudoElementSelector,
  type SelectorParserOptions,
  createCombinator,
  createSimplePseudoClass,
  createSimplePseudoElement,
  isCombinator,
  isIdentifierContinue,
  isIdentifierStart,
  isWhitespace,
} from './shared'

export class StringSelectorArgumentParser {
  private index = 0

  constructor(
    private readonly source: string,
    private readonly options: SelectorParserOptions,
  ) {}

  parseSelectorList(endChar?: string): SelectorList {
    const selectors: SelectorList = []

    this.skipWhitespace()
    while (!this.isDone()) {
      if (endChar && this.peek() === endChar) {
        break
      }

      selectors.push(this.parseSelector(endChar))
      this.skipWhitespace()

      if (this.peek() === ',') {
        this.index++
        this.skipWhitespace()
        continue
      }

      break
    }

    return selectors
  }

  private parseSelector(endChar?: string): Selector {
    const selector: Selector = []
    let needsDescendantCombinator = false

    while (!this.isDone()) {
      if (this.consumeComment()) {
        continue
      }

      if (this.consumeWhitespace()) {
        if (selector.length && !isCombinator(selector[selector.length - 1])) {
          needsDescendantCombinator = true
        }
        continue
      }

      const current = this.peek()
      if (
        current == null ||
        current === ',' ||
        (endChar && current === endChar)
      ) {
        break
      }

      const combinator = this.parseCombinator()
      if (combinator) {
        selector.push(combinator)
        needsDescendantCombinator = false
        continue
      }

      if (needsDescendantCombinator) {
        selector.push(createCombinator('descendant'))
        needsDescendantCombinator = false
      }

      selector.push(this.parseComponent())
    }

    return selector
  }

  private parseComponent(): SelectorComponent {
    const current = this.peek()
    if (current == null) {
      throw new Error('Unexpected end of selector input.')
    }

    if (current === '.') {
      this.index++
      return {
        type: 'class',
        name: this.readIdentifier(),
      }
    }

    if (current === '#') {
      this.index++
      return {
        type: 'id',
        name: this.readIdentifier(),
      }
    }

    if (current === '&') {
      this.index++
      return { type: 'nesting' }
    }

    if (current === '[') {
      return this.parseAttribute()
    }

    if (current === ':') {
      return this.parsePseudo()
    }

    if (current === '*') {
      this.index++
      return { type: 'universal' }
    }

    if (current === '|' || current === '\\') {
      throw new Error(`Unsupported selector token: "${current}".`)
    }

    if (!isIdentifierStart(current)) {
      throw new Error(`Unsupported selector token: "${current}".`)
    }

    return {
      type: 'type',
      name: this.readIdentifier(),
    }
  }

  private parseCombinator():
    | Extract<SelectorComponent, { type: 'combinator' }>
    | undefined {
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
  }

  private parseAttribute(): AttributeSelector {
    this.expect('[')
    this.skipWhitespace()

    const name = this.readIdentifier()
    this.skipWhitespace()

    const operator = this.readAttributeOperator()

    let normalizedOperation: AttributeSelector['operation'] = null
    if (operator) {
      this.skipWhitespace()
      normalizedOperation = {
        operator,
        value: this.readAttributeValue(),
        caseSensitivity: this.readAttributeCaseSensitivity(),
      }
      this.skipWhitespace()
    }

    this.expect(']')

    return {
      type: 'attribute',
      name,
      namespace: null,
      operation: normalizedOperation,
    }
  }

  private parsePseudo(): PseudoClassSelector | PseudoElementSelector {
    this.expect(':')
    const isElement = this.consume(':')
    const name = this.readIdentifier()

    if (!this.consume('(')) {
      return isElement
        ? createSimplePseudoElement(name)
        : createSimplePseudoClass(name)
    }

    const content = this.readBalancedContent(')')

    if (!isElement) {
      if (
        name === 'has' ||
        name === 'is' ||
        name === 'not' ||
        name === 'where'
      ) {
        return {
          type: 'pseudo-class',
          kind: name,
          selectors: new StringSelectorArgumentParser(
            content,
            this.options,
          ).parseSelectorList(),
        }
      }

      if (name === 'host') {
        const selectors = new StringSelectorArgumentParser(
          content,
          this.options,
        ).parseSelectorList()
        if (selectors.length > 1) {
          throw new Error(`Unsupported selector list in :${name}().`)
        }
        return {
          type: 'pseudo-class',
          kind: 'host',
          selectors: selectors[0] || null,
        }
      }

      if (this.options.selectorListFunctionNames?.has(name)) {
        return {
          type: 'pseudo-class',
          kind: 'custom-function',
          name,
          arguments: [],
          selectors: new StringSelectorArgumentParser(
            content,
            this.options,
          ).parseSelectorList(),
        } as CustomFunctionSelector
      }
    } else if (name === 'slotted') {
      const selectors = new StringSelectorArgumentParser(
        content,
        this.options,
      ).parseSelectorList()
      if (selectors.length > 1) {
        throw new Error(`Unsupported selector list in ::${name}().`)
      }
      return {
        type: 'pseudo-element',
        kind: 'slotted',
        selector: selectors[0] || [],
      }
    } else if (this.options.selectorListFunctionNames?.has(name)) {
      return {
        type: 'pseudo-element',
        kind: 'custom-function',
        name,
        arguments: [],
        selectors: new StringSelectorArgumentParser(
          content,
          this.options,
        ).parseSelectorList(),
      } as CustomFunctionSelector
    }

    throw new Error(
      `Unsupported pseudo selector function: ${isElement ? '::' : ':'}${name}().`,
    )
  }

  private readAttributeOperator(): AttrOperation['operator'] | null {
    const operator = this.source.slice(this.index, this.index + 2)
    switch (operator) {
      case '~=':
        this.index += 2
        return 'includes'
      case '|=':
        this.index += 2
        return 'dash-match'
      case '^=':
        this.index += 2
        return 'prefix'
      case '$=':
        this.index += 2
        return 'suffix'
      case '*=':
        this.index += 2
        return 'substring'
    }

    if (this.consume('=')) {
      return 'equal'
    }

    return null
  }

  private readAttributeValue(): string {
    const quote = this.peek()
    if (quote === '"' || quote === "'") {
      this.index++
      const start = this.index
      while (!this.isDone() && this.peek() !== quote) {
        if (this.peek() === '\\') {
          this.index++
        }
        this.index++
      }
      if (this.isDone()) {
        throw new Error('Unterminated attribute string.')
      }
      const value = this.source.slice(start, this.index)
      this.index++
      return value
    }

    return this.readIdentifier()
  }

  private readAttributeCaseSensitivity(): ParsedCaseSensitivity | undefined {
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

  private readBalancedContent(endChar: ')' | ']' | '}'): string {
    const start = this.index
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
          const content = this.source.slice(start, this.index)
          this.index++
          return content
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

  private readIdentifier(): string {
    const start = this.index

    if (!isIdentifierStart(this.peek())) {
      throw new Error('Expected selector identifier.')
    }

    this.index++
    while (!this.isDone() && isIdentifierContinue(this.peek())) {
      this.index++
    }

    return this.source.slice(start, this.index)
  }

  private consumeWhitespace(): boolean {
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

  private skipWhitespace(): void {
    while (this.consumeWhitespace() || this.consumeComment()) {
      continue
    }
  }

  private consumeComment(): boolean {
    if (this.source.startsWith('/*', this.index)) {
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

  private peek(): string | undefined {
    return this.source[this.index]
  }

  private isDone(): boolean {
    return this.index >= this.source.length
  }
}
