import type {
  AttrOperation,
  ParsedCaseSensitivity,
  SelectorComponent,
  SelectorList,
  TokenOrValue,
} from 'lightningcss'

export const simplePseudoClasses: ReadonlySet<string> = new Set([
  'active',
  'blank',
  'buffering',
  'checked',
  'closed',
  'current',
  'defined',
  'disabled',
  'empty',
  'enabled',
  'first-child',
  'first-of-type',
  'focus',
  'focus-visible',
  'focus-within',
  'fullscreen',
  'future',
  'hover',
  'in-range',
  'indeterminate',
  'invalid',
  'last-child',
  'last-of-type',
  'link',
  'local-link',
  'modal',
  'muted',
  'only-child',
  'only-of-type',
  'open',
  'optional',
  'out-of-range',
  'past',
  'paused',
  'placeholder-shown',
  'playing',
  'required',
  'root',
  'scope',
  'seeking',
  'stalled',
  'target',
  'target-within',
  'user-invalid',
  'user-valid',
  'valid',
  'visited',
  'volume-locked',
])

export const simplePseudoElements: ReadonlySet<string> = new Set([
  'after',
  'backdrop',
  'before',
  'details-content',
  'first-letter',
  'first-line',
  'marker',
  'placeholder',
  'selection',
  'target-text',
])

export type AttributeSelector = Extract<
  SelectorComponent,
  { type: 'attribute' }
>
export type PseudoClassSelector = Extract<
  SelectorComponent,
  { type: 'pseudo-class' }
>
export type PseudoElementSelector = Extract<
  SelectorComponent,
  { type: 'pseudo-element' }
>
export type CustomFunctionSelector = (
  | PseudoClassSelector
  | PseudoElementSelector
) & {
  arguments: TokenOrValue[]
  kind: 'custom-function'
  name: string
  selectors?: SelectorList
}

/**
 * Parser knobs for the lightweight selector parser used by the source-level
 * Lightning CSS bridge.
 *
 * This parser intentionally supports only the subset we need to round-trip in
 * compiler-sfc. It is not a general-purpose CSS selector parser.
 */
export interface SelectorParserOptions {
  /**
   * Custom function-like selectors whose arguments should be parsed as a
   * selector list and exposed as `custom-function` nodes with `selectors`.
   */
  selectorListFunctionNames?: ReadonlySet<string>
}

export function createCombinator(
  value: Extract<SelectorComponent, { type: 'combinator' }>['value'],
): Extract<SelectorComponent, { type: 'combinator' }> {
  return {
    type: 'combinator',
    value,
  }
}

export function createSimplePseudoClass(name: string): PseudoClassSelector {
  if (simplePseudoClasses.has(name)) {
    return {
      type: 'pseudo-class',
      kind: name,
    } as PseudoClassSelector
  }

  return {
    type: 'pseudo-class',
    kind: 'custom',
    name,
  }
}

export function createSimplePseudoElement(name: string): PseudoElementSelector {
  if (simplePseudoElements.has(name)) {
    return {
      type: 'pseudo-element',
      kind: name,
    } as PseudoElementSelector
  }

  return {
    type: 'pseudo-element',
    kind: 'custom',
    name,
  }
}

export function isCombinator(component: SelectorComponent): boolean {
  return component.type === 'combinator'
}

export function isWhitespace(char: string | undefined): boolean {
  return (
    char === ' ' ||
    char === '\n' ||
    char === '\r' ||
    char === '\t' ||
    char === '\f'
  )
}

export function isIdentifierStart(char: string | undefined): char is string {
  return !!char && /[A-Za-z_-]/.test(char)
}

export function isIdentifierContinue(char: string | undefined): char is string {
  return !!char && /[A-Za-z0-9_-]/.test(char)
}

export type { AttrOperation, ParsedCaseSensitivity }
