import type {
  Selector,
  SelectorComponent,
  SelectorList,
  Token,
  TokenOrValue,
} from 'lightningcss'
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
} from './shared'

export class TokenSelectorArgumentParser {
  private index = 0

  constructor(
    private readonly tokens: TokenOrValue[],
    private readonly options: SelectorParserOptions,
  ) {}

  parseSelectorList(endType?: Token['type']): SelectorList {
    const selectors: SelectorList = []

    this.skipWhitespace()
    while (!this.isDone()) {
      if (endType && this.peekTokenType() === endType) {
        break
      }

      selectors.push(this.parseSelector(endType))
      this.skipWhitespace()

      if (this.consumeTokenType('comma')) {
        this.skipWhitespace()
        continue
      }

      break
    }

    return selectors
  }

  private parseSelector(endType?: Token['type']): Selector {
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

      const tokenType = this.peekTokenType()
      if (
        tokenType == null ||
        tokenType === 'comma' ||
        (endType && tokenType === endType)
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
    const token = this.peekToken()
    if (!token) {
      throw new Error('Unexpected end of selector token input.')
    }

    if (token.type === 'delim') {
      switch (token.value) {
        case '.':
          this.index++
          return {
            type: 'class',
            name: this.readIdentifier(),
          }
        case '&':
          this.index++
          return { type: 'nesting' }
        case '*':
          this.index++
          return { type: 'universal' }
        case '|':
        case '\\':
          throw new Error(`Unsupported selector token: "${token.value}".`)
      }
    }

    if (token.type === 'id-hash') {
      this.index++
      return {
        type: 'id',
        name: token.value.toString(),
      }
    }

    if (token.type === 'square-bracket-block') {
      return this.parseAttribute()
    }

    if (token.type === 'colon') {
      return this.parsePseudo()
    }

    if (token.type !== 'ident') {
      throw new Error(`Unsupported selector token: "${token.type}".`)
    }

    this.index++
    return {
      type: 'type',
      name: token.value.toString(),
    }
  }

  private parseCombinator():
    | Extract<SelectorComponent, { type: 'combinator' }>
    | undefined {
    const token = this.peekToken()
    if (token?.type !== 'delim') {
      return
    }

    switch (token.value) {
      case '>':
        this.index++
        return createCombinator('child')
      case '+':
        this.index++
        return createCombinator('next-sibling')
      case '~':
        this.index++
        return createCombinator('later-sibling')
    }
  }

  private parseAttribute(): AttributeSelector {
    this.expectTokenType('square-bracket-block')
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

    this.expectTokenType('close-square-bracket')

    return {
      type: 'attribute',
      name,
      namespace: null,
      operation: normalizedOperation,
    }
  }

  private parsePseudo(): PseudoClassSelector | PseudoElementSelector {
    this.expectTokenType('colon')
    const isElement = this.consumeTokenType('colon')
    const name = this.readIdentifier()
    const functionToken = this.peekToken()

    if (!functionToken || functionToken.type !== 'function') {
      return isElement
        ? createSimplePseudoElement(name)
        : createSimplePseudoClass(name)
    }

    this.index++

    if (!isElement) {
      if (
        name === 'has' ||
        name === 'is' ||
        name === 'not' ||
        name === 'where'
      ) {
        const selectors = this.parseSelectorList('close-parenthesis')
        this.expectTokenType('close-parenthesis')
        return {
          type: 'pseudo-class',
          kind: name,
          selectors,
        }
      }

      if (name === 'host') {
        const selectors = this.parseSelectorList('close-parenthesis')
        this.expectTokenType('close-parenthesis')
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
        const selectors = this.parseSelectorList('close-parenthesis')
        this.expectTokenType('close-parenthesis')
        return {
          type: 'pseudo-class',
          kind: 'custom-function',
          name,
          arguments: [],
          selectors,
        } as CustomFunctionSelector
      }
    } else if (name === 'slotted') {
      const selectors = this.parseSelectorList('close-parenthesis')
      this.expectTokenType('close-parenthesis')
      if (selectors.length > 1) {
        throw new Error(`Unsupported selector list in ::${name}().`)
      }
      return {
        type: 'pseudo-element',
        kind: 'slotted',
        selector: selectors[0] || [],
      }
    } else if (this.options.selectorListFunctionNames?.has(name)) {
      const selectors = this.parseSelectorList('close-parenthesis')
      this.expectTokenType('close-parenthesis')
      return {
        type: 'pseudo-element',
        kind: 'custom-function',
        name,
        arguments: [],
        selectors,
      } as CustomFunctionSelector
    }

    throw new Error(
      `Unsupported pseudo selector function: ${isElement ? '::' : ':'}${name}().`,
    )
  }

  private readAttributeOperator(): AttrOperation['operator'] | null {
    const token = this.peekToken()
    if (!token) {
      return null
    }

    switch (token.type) {
      case 'include-match':
        this.index++
        return 'includes'
      case 'dash-match':
        this.index++
        return 'dash-match'
      case 'prefix-match':
        this.index++
        return 'prefix'
      case 'suffix-match':
        this.index++
        return 'suffix'
      case 'substring-match':
        this.index++
        return 'substring'
      case 'delim':
        if (token.value === '=') {
          this.index++
          return 'equal'
        }
    }

    return null
  }

  private readAttributeValue(): string {
    const token = this.peekToken()
    if (!token) {
      throw new Error('Expected attribute value.')
    }

    if (token.type === 'string' || token.type === 'ident') {
      this.index++
      return token.value.toString()
    }

    throw new Error(`Unsupported attribute token: "${token.type}".`)
  }

  private readAttributeCaseSensitivity(): ParsedCaseSensitivity | undefined {
    const token = this.peekToken()
    if (token?.type !== 'ident') {
      return
    }

    const value = token.value.toString()
    if (value === 'i' || value === 'I') {
      this.index++
      return 'ascii-case-insensitive'
    }
    if (value === 's' || value === 'S') {
      this.index++
      return 'explicit-case-sensitive'
    }
  }

  private readIdentifier(): string {
    const token = this.peekToken()

    if (token?.type !== 'ident') {
      throw new Error('Expected selector identifier.')
    }

    this.index++
    return token.value.toString()
  }

  private consumeWhitespace(): boolean {
    const start = this.index
    while (this.peekTokenType() === 'white-space') {
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
    if (this.peekTokenType() === 'comment') {
      this.index++
      return true
    }
    return false
  }

  private consumeTokenType(type: Token['type']): boolean {
    if (this.peekTokenType() === type) {
      this.index++
      return true
    }
    return false
  }

  private expectTokenType(type: Token['type']): void {
    if (!this.consumeTokenType(type)) {
      throw new Error(`Expected "${type}" in selector token input.`)
    }
  }

  private peekToken(): Token | undefined {
    const token = this.tokens[this.index]
    return token?.type === 'token' ? token.value : undefined
  }

  private peekTokenType(): Token['type'] | undefined {
    return this.peekToken()?.type
  }

  private isDone(): boolean {
    return this.index >= this.tokens.length
  }
}
