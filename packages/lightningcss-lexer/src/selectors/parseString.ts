import type { Selector, SelectorComponent, SelectorList } from 'lightningcss'
import {
  decodeCssEscape,
  isIdentifierContinue,
  isIdentifierStart,
} from './identifiers'
import { parseStandardPseudoClassFunction } from './pseudoFunctions'
import {
  type AttrOperation,
  type AttributeSelector,
  type CustomFunctionSelector,
  type LocalNamespaceConstraint,
  type ParsedCaseSensitivity,
  type PseudoClassSelector,
  type PseudoElementSelector,
  type SelectorParserOptions,
  createCombinator,
  createSimplePseudoClass,
  createSimplePseudoElement,
  isCombinator,
  isWhitespace,
  setParsedSelectorSource,
} from './shared'

export class StringSelectorArgumentParser {
  private index = 0
  private readonly endIndex: number
  private readonly sourceContainsComments: boolean

  constructor(
    private readonly source: string,
    private readonly options: SelectorParserOptions,
    start: number = 0,
    end: number = source.length,
    sourceContainsComments?: boolean,
  ) {
    this.index = start
    this.endIndex = end
    this.sourceContainsComments =
      sourceContainsComments ??
      (() => {
        const commentIndex = source.indexOf('/*', start)
        return commentIndex !== -1 && commentIndex < end
      })()
  }

  parseSelectorList(endChar?: string): SelectorList {
    const selectors: SelectorList = []

    while (!this.isDone()) {
      const selectorLeadingTriviaStart = this.index
      this.skipWhitespace()
      if (this.isDone()) {
        break
      }
      if (endChar && this.peek() === endChar) {
        break
      }

      const selector = this.parseSelector(endChar)
      if (this.sourceContainsComments) {
        const rawSelectorSource = this.source
          .slice(selectorLeadingTriviaStart, this.index)
          .trim()
        if (rawSelectorSource.includes('/*')) {
          setParsedSelectorSource(selector, rawSelectorSource)
        }
      }
      selectors.push(selector)
      this.skipWhitespace()

      if (this.peek() === ',') {
        this.index++
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
      if (this.sourceContainsComments && this.consumeComment()) {
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

      this.appendComponents(selector)
    }

    return selector
  }

  private appendComponents(selector: Selector): void {
    const current = this.peek()
    if (current == null) {
      throw new Error('Unexpected end of selector input.')
    }

    if (current === '.') {
      this.index++
      selector.push({
        type: 'class',
        name: this.readIdentifier(),
      })
      return
    }

    if (current === '#') {
      this.index++
      selector.push({
        type: 'id',
        name: this.readIdentifier(),
      })
      return
    }

    if (current === '&' && this.peek(1) !== '|') {
      this.index++
      selector.push({ type: 'nesting' })
      return
    }

    if (current === '[') {
      selector.push(this.parseAttribute())
      return
    }

    if (current === ':') {
      selector.push(this.parsePseudo())
      return
    }

    if (current === '*') {
      if (this.peek(1) === '|') {
        this.index += 2
        selector.push(
          { type: 'namespace', kind: 'any' },
          this.parseNamespacedTarget(),
        )
        return
      }
      this.index++
      selector.push({ type: 'universal' })
      return
    }

    if (current === '|') {
      this.index++
      selector.push(
        { type: 'namespace', kind: 'none' },
        this.parseNamespacedTarget(),
      )
      return
    }

    if (current === '&' && this.peek(1) === '|') {
      this.index += 2
      selector.push(
        { type: 'namespace', kind: 'named', prefix: '&' },
        this.parseNamespacedTarget(),
      )
      return
    }

    if (!isIdentifierStart(current) && current !== '\\') {
      throw new Error(`Unsupported selector token: "${current}".`)
    }

    const identifier = this.readIdentifier()
    if (this.consume('|')) {
      selector.push(
        { type: 'namespace', kind: 'named', prefix: identifier },
        this.parseNamespacedTarget(),
      )
      return
    }

    selector.push({
      type: 'type',
      name: identifier,
    })
  }

  private parseCombinator():
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

  private parseAttribute(): AttributeSelector {
    this.expect('[')
    this.skipWhitespace()

    const { name, namespace } = this.readAttributeNameWithNamespace()
    this.skipWhitespace()

    const operator = this.readAttributeOperator()

    let normalizedOperation: AttributeSelector['operation'] = null
    if (operator) {
      this.skipWhitespace()
      normalizedOperation = {
        operator,
        value: this.readAttributeValue(),
        caseSensitivity: (() => {
          this.skipWhitespace()
          return this.readAttributeCaseSensitivity()
        })(),
      }
      this.skipWhitespace()
    }

    this.expect(']')

    return {
      type: 'attribute',
      name,
      namespace: namespace as AttributeSelector['namespace'],
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

    const { start, end } = this.readBalancedRange(')')

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
          selectors: this.parseSelectorListRange(start, end),
        }
      }

      if (name === 'host') {
        const selectors = this.parseSelectorListRange(start, end)
        if (selectors.length > 1) {
          throw new Error(`Unsupported selector list in :${name}().`)
        }
        return {
          type: 'pseudo-class',
          kind: 'host',
          selectors: selectors[0] || null,
        }
      }

      if (
        this.options.selectorListFunctionNames &&
        this.options.selectorListFunctionNames.has(name)
      ) {
        return {
          type: 'pseudo-class',
          kind: 'custom-function',
          name,
          arguments: [],
          selectors: this.parseSelectorListRange(start, end),
        } as CustomFunctionSelector
      }

      const content = this.sliceRange(start, end)
      const parsedStandardPseudo = parseStandardPseudoClassFunction(
        name,
        content,
        selectorContent =>
          new StringSelectorArgumentParser(
            selectorContent,
            this.options,
          ).parseSelectorList(),
      )
      if (parsedStandardPseudo) {
        return parsedStandardPseudo
      }
    } else if (name === 'slotted') {
      const selectors = this.parseSelectorListRange(start, end)
      if (selectors.length > 1) {
        throw new Error(`Unsupported selector list in ::${name}().`)
      }
      return {
        type: 'pseudo-element',
        kind: 'slotted',
        selector: selectors[0] || [],
      }
    } else if (
      this.options.selectorListFunctionNames &&
      this.options.selectorListFunctionNames.has(name)
    ) {
      return {
        type: 'pseudo-element',
        kind: 'custom-function',
        name,
        arguments: [],
        selectors: this.parseSelectorListRange(start, end),
      } as CustomFunctionSelector
    }

    throw new Error(
      `Unsupported pseudo selector function: ${isElement ? '::' : ':'}${name}().`,
    )
  }

  private readAttributeOperator(): AttrOperation['operator'] | null {
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

  private readAttributeValue(): string {
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

  private readIdentifier(): string {
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

  private readAttributeNameWithNamespace(): {
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
    while (this.consumeWhitespace()) {
      continue
    }
    if (!this.sourceContainsComments) {
      return
    }
    while (this.consumeComment() || this.consumeWhitespace()) {
      continue
    }
  }

  private consumeComment(): boolean {
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

  private isDone(): boolean {
    return this.index >= this.endIndex
  }

  private parseSelectorListRange(start: number, end: number): SelectorList {
    return new StringSelectorArgumentParser(
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
