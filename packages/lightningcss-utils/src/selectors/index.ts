import type { SelectorList, TokenOrValue } from 'lightningcss'
import { StringSelectorParser } from './stringParser'
import { parseCompatibleSelectorFragment } from './compat'
import { decodeCssEscape } from './identifiers'
import { stringifySelector, stringifyTokens } from './stringify'
import type { SelectorParserOptions } from './shared'
import { TokenSelectorParser } from './tokenParser'

/**
 * Parses a selector list from Lightning CSS `TokenOrValue[]`.
 *
 * This is mainly useful when Lightning CSS exposes custom selector function
 * arguments as raw tokens instead of structured selectors.
 */
export function parseSelectorListFromTokens(
  tokens: TokenOrValue[],
  options: SelectorParserOptions = {},
): SelectorList {
  try {
    return new TokenSelectorParser(tokens, options).parseSelectorList()
  } catch {
    const source = stringifyTokens(tokens)
    return new StringSelectorParser(source, options).parseSelectorList()
  }
}

export function parseSelectorListFromString(
  source: string,
  options: SelectorParserOptions = {},
): SelectorList {
  const compatibleSelector = parseCompatibleSelectorFragment(source)
  if (compatibleSelector) {
    return compatibleSelector
  }
  return new StringSelectorParser(source, options).parseSelectorList()
}

export { stringifySelector, stringifyTokens }
export { decodeCssEscape }
export type { SelectorParserOptions } from './shared'
