import type {
  AttrOperation,
  EnvironmentVariableName,
  NamespaceConstraint,
  ParsedCaseSensitivity,
  Selector,
  SelectorComponent,
  Token,
  TokenOrValue,
  VendorPrefix,
} from 'lightningcss'

type LooseSelectorComponent = SelectorComponent & Record<string, unknown>
type AttributeSelector = Extract<SelectorComponent, { type: 'attribute' }>
type NamespaceSelector =
  | Extract<SelectorComponent, { type: 'namespace' }>
  | NamespaceConstraint
  | null
  | undefined

/**
 * Serializes the selector subset produced by the local lexer helpers.
 *
 * This is intentionally paired with the lightweight parser in `selectors/`,
 * not a promise to stringify every Lightning CSS selector shape losslessly.
 */
export function stringifySelector(selector: Selector): string {
  return selector.map(stringifySelectorComponent).join('')
}

/**
 * Serializes Lightning CSS token arrays back to source text.
 */
export function stringifyTokens(tokens: TokenOrValue[]): string {
  return tokens.map(stringifyTokenOrValue).join('')
}

function stringifySelectorComponent(component: SelectorComponent): string {
  switch (component.type) {
    case 'class':
      return `.${component.name}`
    case 'id':
      return `#${component.name}`
    case 'type':
      return component.name
    case 'universal':
      return '*'
    case 'attribute':
      return stringifyAttribute(component)
    case 'combinator':
      return stringifyCombinator(component.value)
    case 'pseudo-class':
    case 'pseudo-element':
      return stringifyPseudo(component as LooseSelectorComponent)
    case 'nesting':
      return '&'
    case 'namespace':
      return stringifyNamespace(component)
    default:
      return ''
  }
}

function stringifyNamespace(namespace: NamespaceSelector): string {
  if (!namespace) {
    return ''
  }
  if (namespace.type === 'any') {
    return '*|'
  }
  if ('kind' in namespace && namespace.kind === 'any') {
    return '*|'
  }
  if ('kind' in namespace && namespace.kind === 'none') {
    return '|'
  }
  if ('prefix' in namespace) {
    return `${namespace.prefix}|`
  }
  return ''
}

function stringifyAttribute(component: AttributeSelector): string {
  const namespace = stringifyNamespace(component.namespace)
  const operation = component.operation

  if (!operation) {
    return `[${namespace}${component.name}]`
  }

  return `[${namespace}${component.name}${stringifyAttrOperator(
    operation.operator,
  )}${JSON.stringify(operation.value)}${stringifyAttrCaseSensitivity(
    operation.caseSensitivity,
  )}]`
}

function stringifyAttrOperator(operator: AttrOperation['operator']): string {
  switch (operator) {
    case 'equal':
      return '='
    case 'includes':
      return '~='
    case 'dash-match':
      return '|='
    case 'prefix':
      return '^='
    case 'suffix':
      return '$='
    case 'substring':
      return '*='
    default:
      return ''
  }
}

function stringifyAttrCaseSensitivity(
  caseSensitivity?: ParsedCaseSensitivity & string,
): string {
  switch (caseSensitivity) {
    case 'explicit-case-sensitive':
      return ' s'
    case 'ascii-case-insensitive':
    case 'ascii-case-insensitive-if-in-html-element-in-html-document':
      return ' i'
    default:
      return ''
  }
}

function stringifyCombinator(combinator: string): string {
  switch (combinator) {
    case 'descendant':
      return ' '
    case 'child':
      return ' > '
    case 'next-sibling':
      return ' + '
    case 'later-sibling':
      return ' ~ '
    case 'deep-descendant':
      return ' >>> '
    case 'deep':
      return ' /deep/ '
    default:
      return ''
  }
}

function stringifyPseudo(component: LooseSelectorComponent): string {
  const prefix = component.type === 'pseudo-element' ? '::' : ':'
  const kind =
    typeof component.kind === 'string'
      ? component.kind
      : typeof component.name === 'string'
        ? component.name
        : ''
  const name = `${stringifyVendorPrefix(getVendorPrefix(component))}${kind}`

  if (kind === 'custom' && typeof component.name === 'string') {
    return `${prefix}${component.name}`
  }
  if (
    kind === 'custom-function' &&
    typeof component.name === 'string' &&
    Array.isArray(component.arguments)
  ) {
    return `${prefix}${component.name}(${stringifyTokens(
      component.arguments as TokenOrValue[],
    )})`
  }

  if (isSelectorList(component.selectors)) {
    return `${prefix}${name}(${component.selectors
      .map(selector => stringifySelector(selector))
      .join(', ')})`
  }
  if (isSelector(component.selector)) {
    return `${prefix}${name}(${stringifySelector(component.selector)})`
  }
  if (isStringArray(component.languages)) {
    return `${prefix}${name}(${component.languages.join(', ')})`
  }
  if (typeof component.direction === 'string') {
    return `${prefix}${name}(${component.direction})`
  }
  if (typeof component.state === 'string') {
    return `${prefix}${name}(${component.state})`
  }
  if (isStringArray(component.names)) {
    return `${prefix}${name}(${component.names.join(', ')})`
  }
  if (typeof component.value === 'string') {
    return kind === 'webkit-scrollbar'
      ? `${prefix}-webkit-scrollbar${component.value === 'scrollbar' ? '' : `-${component.value}`}`
      : `${prefix}${name}(${component.value})`
  }
  if (typeof component.identifier === 'string') {
    return `${prefix}${name}(${component.identifier})`
  }

  const typeValue = component.type
  if (Array.isArray(typeValue) && typeValue.every(v => typeof v === 'string')) {
    return `${prefix}${name}(${typeValue.join(', ')})`
  }

  if (typeof component.a === 'number' && typeof component.b === 'number') {
    const suffix = isSelectorList(component.of)
      ? ` of ${component.of.map(selector => stringifySelector(selector)).join(', ')}`
      : ''
    return `${prefix}${name}(${stringifyNth(component.a, component.b)}${suffix})`
  }

  return `${prefix}${name}`
}

function getVendorPrefix(
  component: LooseSelectorComponent,
): VendorPrefix | undefined {
  return Array.isArray(component.vendorPrefix)
    ? (component.vendorPrefix as VendorPrefix)
    : undefined
}

function stringifyVendorPrefix(prefixes?: VendorPrefix): string {
  return prefixes && prefixes.length
    ? prefixes.map(prefix => `-${prefix}-`).join('')
    : ''
}

function stringifyNth(a: number, b: number): string {
  if (a === 0) {
    return String(b)
  }
  if (a === 2 && b === 1) {
    return 'odd'
  }
  if (a === 2 && b === 0) {
    return 'even'
  }

  const an = a === 1 ? 'n' : a === -1 ? '-n' : `${a}n`
  if (b === 0) {
    return an
  }
  return `${an}${b > 0 ? `+${b}` : b}`
}

function stringifyTokenOrValue(token: TokenOrValue): string {
  switch (token.type) {
    case 'token':
      return stringifyToken(token.value)
    case 'function':
      return `${token.value.name}(${stringifyTokens(token.value.arguments)})`
    case 'var':
      return `var(${token.value.name.ident}${
        token.value.fallback ? `,${stringifyTokens(token.value.fallback)}` : ''
      })`
    case 'env':
      return `env(${stringifyEnvironmentVariableName(token.value.name)})`
    case 'url':
      return `url(${token.value.url})`
    case 'dashed-ident':
      return token.value
    case 'animation-name':
      return token.value.type === 'string'
        ? JSON.stringify(token.value.value)
        : token.value.type === 'ident'
          ? token.value.value
          : 'none'
    case 'length':
      return `${token.value.value}${token.value.unit}`
    case 'angle':
      return `${token.value.value}${token.value.type}`
    case 'time':
      return `${token.value.value}${token.value.type === 'seconds' ? 's' : 'ms'}`
    case 'resolution':
      return `${token.value.value}${token.value.type}`
    default:
      return ''
  }
}

function stringifyEnvironmentVariableName(
  name: EnvironmentVariableName,
): string {
  switch (name.type) {
    case 'ua':
    case 'unknown':
      return name.value
    case 'custom':
      return name.ident
    default:
      return ''
  }
}

function stringifyToken(token: Token): string {
  switch (token.type) {
    case 'ident':
    case 'at-keyword':
    case 'hash':
    case 'id-hash':
    case 'unquoted-url':
    case 'white-space':
    case 'comment':
    case 'bad-url':
    case 'bad-string':
      return token.value
    case 'string':
      return JSON.stringify(token.value)
    case 'delim':
      return token.value
    case 'number':
      return String(token.value)
    case 'percentage':
      return `${token.value * 100}%`
    case 'dimension':
      return `${token.value}${token.unit}`
    case 'colon':
      return ':'
    case 'semicolon':
      return ';'
    case 'comma':
      return ','
    case 'include-match':
      return '~='
    case 'dash-match':
      return '|='
    case 'prefix-match':
      return '^='
    case 'suffix-match':
      return '$='
    case 'substring-match':
      return '*='
    case 'cdo':
      return '<!--'
    case 'cdc':
      return '-->'
    case 'function':
      return `${token.value}(`
    case 'parenthesis-block':
      return '('
    case 'square-bracket-block':
      return '['
    case 'curly-bracket-block':
      return '{'
    case 'close-parenthesis':
      return ')'
    case 'close-square-bracket':
      return ']'
    case 'close-curly-bracket':
      return '}'
    default:
      return ''
  }
}

function isSelector(value: unknown): value is Selector {
  return (
    Array.isArray(value) && (value.length === 0 || !Array.isArray(value[0]))
  )
}

function isSelectorList(value: unknown): value is Selector[] {
  return Array.isArray(value) && (value.length === 0 || Array.isArray(value[0]))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
