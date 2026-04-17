import type {
  NamespaceConstraint,
  Selector,
  SelectorComponent,
  SelectorList,
  Token,
  TokenOrValue,
} from 'lightningcss'
import { SelectorParserBase } from './parserBase'
import { StringSelectorParser } from './stringParser'
import { stringifyTokens } from './stringify'
import {
  type AttrOperation,
  type LocalNamespaceConstraint,
  type ParsedCaseSensitivity,
  type SelectorParserOptions,
  createCombinator,
} from './shared'

export class TokenSelectorParser extends SelectorParserBase<Token['type']> {
  private index = 0

  constructor(
    private readonly tokens: TokenOrValue[],
    options: SelectorParserOptions,
  ) {
    super(options)
  }

  protected parseComponents(): SelectorComponent[] {
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

  protected parseCombinator():
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

  protected readAttributeOperator(): AttrOperation['operator'] | null {
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

  protected readAttributeValue(): string {
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

  protected readAttributeCaseSensitivity():
    | ParsedCaseSensitivity
    | undefined {
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

  protected readIdentifier(): string {
    const token = this.peekToken()

    if (!token || token.type !== 'ident') {
      throw new Error('Expected selector identifier.')
    }

    this.index++
    return token.value.toString()
  }

  protected readAttributeNameWithNamespace(): {
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

  protected readPseudoFunctionContentSource(): string {
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

  protected consumeWhitespace(): boolean {
    const start = this.index
    while (this.peekTokenType() === 'white-space') {
      this.index++
    }
    return this.index > start
  }

  protected consumeComment(): boolean {
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

  protected isDone(): boolean {
    return this.index >= this.tokens.length
  }

  protected parseNestedSelectorList(): SelectorList {
    const selectors = this.parseSelectorList('close-parenthesis')
    this.expectTokenType('close-parenthesis')
    return selectors
  }

  protected parseSelectorListFromSource(source: string): SelectorList {
    return new StringSelectorParser(source, this.options).parseSelectorList()
  }

  protected expectAttributeStart(): void {
    this.expectTokenType('square-bracket-block')
  }

  protected expectAttributeEnd(): void {
    this.expectTokenType('close-square-bracket')
  }

  protected expectPseudoStart(): void {
    this.expectTokenType('colon')
  }

  protected consumePseudoElementMarker(): boolean {
    return this.consumeTokenType('colon')
  }

  protected beginPseudoFunctionArguments(): boolean {
    const functionToken = this.peekToken()
    if (!functionToken || functionToken.type !== 'function') {
      return false
    }
    this.index++
    return true
  }

  protected isAtSelectorListBoundary(endType?: Token['type']): boolean {
    const tokenType = this.peekTokenType()
    return (
      tokenType == null ||
      tokenType === 'comma' ||
      (!!endType && tokenType === endType)
    )
  }

  protected consumeSelectorListSeparator(): boolean {
    return this.consumeTokenType('comma')
  }

  protected markSelectorStart(): void {}

  protected recordParsedSelectorSource(
    _selector: Selector,
    _marker: void,
  ): void {}
}
