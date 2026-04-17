import type { TokenOrValue } from 'lightningcss'
import * as lexer from '../src'
import * as selectors from '../src/selectors'
import * as source from '../src/source'

function stringifySelectorList(
  selectorList: ReturnType<typeof lexer.parseSelectorListFromString>,
): string {
  return selectorList
    .map(selector => lexer.stringifySelector(selector))
    .join(', ')
}

describe('public root entrypoint', () => {
  test('re-exports the selector-facing API', () => {
    expect(lexer.parseSelectorListFromString).toBe(
      selectors.parseSelectorListFromString,
    )
    expect(lexer.parseSelectorListFromTokens).toBe(
      selectors.parseSelectorListFromTokens,
    )
    expect(lexer.stringifySelector).toBe(selectors.stringifySelector)
    expect(lexer.stringifyTokens).toBe(selectors.stringifyTokens)
  })

  test('re-exports the source-facing API', () => {
    expect(lexer.walkCssBlockPreludes).toBe(source.walkCssBlockPreludes)
    expect(lexer.rewriteCssSelectorSource).toBe(source.rewriteCssSelectorSource)
    expect(lexer.parseCssBlockTree).toBe(source.parseCssBlockTree)
    expect(lexer.scopeSelectorPrelude).toBe(source.scopeSelectorPrelude)
  })

  test('supports selector parsing and stringifying through the root entrypoint', () => {
    const selectorList = lexer.parseSelectorListFromString(
      '.foo, :is(.bar, .baz)',
    )

    expect(stringifySelectorList(selectorList)).toBe('.foo, :is(.bar, .baz)')
  })

  test('supports token parsing and stringifying through the root entrypoint', () => {
    const tokens: TokenOrValue[] = [
      { type: 'token', value: { type: 'ident', value: 'foo' } },
      { type: 'token', value: { type: 'comma' } },
      { type: 'token', value: { type: 'white-space', value: ' ' } },
      { type: 'token', value: { type: 'ident', value: 'bar' } },
    ]

    const selectorList = lexer.parseSelectorListFromTokens(tokens)

    expect(stringifySelectorList(selectorList)).toBe('foo, bar')
    expect(lexer.stringifyTokens(tokens)).toBe('foo, bar')
  })

  test('supports source rewrites through the root entrypoint', () => {
    const rewritten = lexer.rewriteCssSelectorSource('.foo { color: red; }', {
      tryRewritePreludeDirect: prelude =>
        lexer.scopeSelectorPrelude(prelude, 'data-test'),
      appendRewrittenSelectors: () => {
        throw new Error('root entrypoint should take the direct path here')
      },
    })

    expect(rewritten).toBe('.foo[data-test]{ color: red; }')
  })

  test('exposes block walking and block-tree parsing through the root entrypoint', () => {
    const sourceCode = `
.foo {
  @media (min-width: 1px) {
    .bar {
      color: red;
    }
  }
}
`

    const preludes: string[] = []
    lexer.walkCssBlockPreludes(sourceCode, prelude => {
      preludes.push(prelude.normalizedPrelude)
    })

    expect(preludes).toEqual(['.foo', '@media (min-width: 1px)', '.bar'])

    const roots = lexer.parseCssBlockTree(sourceCode)
    expect(roots).toHaveLength(1)
    expect(roots[0].normalizedPrelude).toBe('.foo')
    expect(roots[0].children[0].normalizedPrelude).toBe(
      '@media (min-width: 1px)',
    )
  })
})
