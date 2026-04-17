import type {
  NamespaceConstraint,
  Selector,
  SelectorComponent,
  SelectorList,
  Token,
  TokenOrValue,
} from 'lightningcss'
import { StringSelectorParser } from './stringParser'
import { parseStandardPseudoClassFunction } from './pseudoFunctions'
import { stringifyTokens } from './stringify'
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
} from './shared'

export class TokenSelectorParser {
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

      selector.push(...this.parseComponents())
    }

    return selector
  }

  private parseComponents(): SelectorComponent[] {
    const token = this.peekToken()
    if (!token) {
      throw new Error('Unexpected end of selector token input.')
    }

    if (token.type === 'delim') {
      switch (token.value) {
        case '.':
          this.index++
          return [
            {
              type: 'class',
              name: this.readIdentifier(),
            },
          ]
        case '&':
          {
            const next = this.peekToken(1)
            if (next && next.type === 'delim' && next.value === '|') {
              this.index += 2
              return [
                { type: 'namespace', kind: 'named', prefix: '&' },
                this.parseNamespacedTarget(),
              ]
            }
          }
          this.index++
          return [{ type: 'nesting' }]
        case '*':
          {
            const next = this.peekToken(1)
            if (next && next.type === 'delim' && next.value === '|') {
              this.index += 2
              return [
                { type: 'namespace', kind: 'any' },
                this.parseNamespacedTarget(),
              ]
            }
          }
          this.index++
          return [{ type: 'universal' }]
        case '|':
          {
            const next = this.peekToken(1)
            if (next && next.type === 'delim' && next.value === '|') {
              this.index += 2
              return [createCombinator('column')]
            }
          }
          this.index++
          return [
            { type: 'namespace', kind: 'none' },
            this.parseNamespacedTarget(),
          ]
      }
    }

    if (token.type === 'id-hash') {
      this.index++
      return [
        {
          type: 'id',
          name: token.value.toString(),
        },
      ]
    }

    if (token.type === 'square-bracket-block') {
      return [this.parseAttribute()]
    }

    if (token.type === 'colon') {
      return [this.parsePseudo()]
    }

    if (token.type !== 'ident') {
      throw new Error(`Unsupported selector token: "${token.type}".`)
    }

    this.index++
    const identifier = token.value.toString()
    const next = this.peekToken()
    if (next && next.type === 'delim' && next.value === '|') {
      this.index++
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

  private parseCombinator():
    | Extract<SelectorComponent, { type: 'combinator' }>
    | undefined {
    const token = this.peekToken()
    if (!token || token.type !== 'delim') {
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
      case '|': {
        const next = this.peekToken(1)
        if (next && next.type === 'delim' && next.value === '|') {
          this.index += 2
          return createCombinator('column')
        }
      }
    }
  }

  private parseAttribute(): AttributeSelector {
    this.expectTokenType('square-bracket-block')
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

    this.expectTokenType('close-square-bracket')

    return {
      type: 'attribute',
      name,
      namespace: namespace as AttributeSelector['namespace'],
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
      if (isStandardPseudoClassFunction(name)) {
        const parsedStandardPseudo = parseStandardPseudoClassFunction(
          name,
          this.readFunctionContentSource(),
          selectorContent =>
            new StringSelectorParser(
              selectorContent,
              this.options,
            ).parseSelectorList(),
        )
        if (parsedStandardPseudo) {
          return parsedStandardPseudo
        }
      }

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
      if (
        this.options.selectorListFunctionNames &&
        this.options.selectorListFunctionNames.has(name)
      ) {
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
    } else if (
      this.options.selectorListFunctionNames &&
      this.options.selectorListFunctionNames.has(name)
    ) {
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
    if (!token || token.type !== 'ident') {
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

    if (!token || token.type !== 'ident') {
      throw new Error('Expected selector identifier.')
    }

    this.index++
    return token.value.toString()
  }

  private readAttributeNameWithNamespace(): {
    name: string
    namespace: LocalNamespaceConstraint | null
  } {
    const token = this.peekToken()
    const next = this.peekToken(1)

    if (token && token.type === 'delim' && token.value === '|') {
      this.index++
      return {
        name: this.readIdentifier(),
        namespace: { type: 'none' },
      }
    }

    if (token && token.type === 'delim' && token.value === '*') {
      if (next && next.type === 'delim' && next.value === '|') {
        this.index += 2
        return {
          name: this.readIdentifier(),
          namespace: { type: 'any' },
        }
      }
    }

    const identifier = this.readIdentifier()
    const afterIdentifier = this.peekToken()
    if (
      afterIdentifier &&
      afterIdentifier.type === 'delim' &&
      afterIdentifier.value === '|'
    ) {
      this.index++
      return {
        name: this.readIdentifier(),
        namespace: {
          type: 'specific',
          prefix: identifier,
          url: identifier,
        } satisfies NamespaceConstraint,
      }
    }

    return {
      name: identifier,
      namespace: null,
    }
  }

  private parseNamespacedTarget(): SelectorComponent {
    const token = this.peekToken()
    if (!token) {
      throw new Error('Expected selector after namespace prefix.')
    }
    if (token.type === 'delim' && token.value === '*') {
      this.index++
      return { type: 'universal' }
    }
    if (token.type === 'delim' && token.value === '&') {
      this.index++
      return { type: 'nesting' }
    }
    if (token.type !== 'ident') {
      throw new Error('Expected selector after namespace prefix.')
    }
    this.index++
    return {
      type: 'type',
      name: token.value.toString(),
    }
  }

  private readFunctionContentSource(): string {
    const tokens: TokenOrValue[] = []
    let depth = 1

    while (!this.isDone()) {
      const token = this.tokens[this.index]
      if (!token || token.type !== 'token') {
        throw new Error('Unexpected token in pseudo selector function.')
      }

      if (
        token.value.type === 'function' ||
        token.value.type === 'parenthesis-block' ||
        token.value.type === 'square-bracket-block' ||
        token.value.type === 'curly-bracket-block'
      ) {
        depth++
      } else if (token.value.type === 'close-parenthesis') {
        depth--
        if (depth === 0) {
          this.index++
          return stringifyTokens(tokens)
        }
      } else if (
        token.value.type === 'close-square-bracket' ||
        token.value.type === 'close-curly-bracket'
      ) {
        depth--
      }

      tokens.push(token)
      this.index++
    }

    throw new Error('Unterminated pseudo selector function.')
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

  private peekToken(offset = 0): Token | undefined {
    const token = this.tokens[this.index + offset]
    return token && token.type === 'token' ? token.value : undefined
  }

  private peekTokenType(): Token['type'] | undefined {
    const token = this.peekToken()
    return token ? token.type : undefined
  }

  private isDone(): boolean {
    return this.index >= this.tokens.length
  }
}

function isStandardPseudoClassFunction(name: string): boolean {
  return (
    name === 'lang' ||
    name === 'dir' ||
    name === 'nth-child' ||
    name === 'nth-last-child' ||
    name === 'nth-col' ||
    name === 'nth-last-col' ||
    name === 'nth-of-type' ||
    name === 'nth-last-of-type'
  )
}
