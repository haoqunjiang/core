import type { Selector } from 'lightningcss'
import type { CssBlockPrelude } from '../src/source'
import {
  parseCssBlockTree,
  rewriteCssSelectorSource,
  scopeSelectorPrelude,
  walkCssBlockPreludes,
} from '../src/source'

describe('source-facing API', () => {
  test('walkCssBlockPreludes reports normalized preludes and parent kinds', () => {
    const source = `
/* before */ .foo /* mid */ {
  color: red;
}
@media (min-width: 1px) {
  .bar {
    color: blue;
  }
}
@keyframes fade {
  0% {
    opacity: 0;
  }
}
`

    const preludes: CssBlockPrelude[] = []
    walkCssBlockPreludes(source, prelude => {
      preludes.push(prelude)
    })

    expect(
      preludes.map(prelude => ({
        blockKind: prelude.blockKind,
        normalizedPrelude: prelude.normalizedPrelude,
        parentKind: prelude.parentKind,
      })),
    ).toEqual([
      {
        blockKind: 'style',
        normalizedPrelude: '.foo',
        parentKind: undefined,
      },
      {
        blockKind: 'at-rule',
        normalizedPrelude: '@media (min-width: 1px)',
        parentKind: undefined,
      },
      {
        blockKind: 'style',
        normalizedPrelude: '.bar',
        parentKind: 'at-rule',
      },
      {
        blockKind: 'keyframes',
        normalizedPrelude: '@keyframes fade',
        parentKind: undefined,
      },
      {
        blockKind: 'style',
        normalizedPrelude: '0%',
        parentKind: 'keyframes',
      },
    ])
  })

  test('rewriteCssSelectorSource skips at-rule preludes and keyframe selectors', () => {
    const source = `
.foo, .bar {
  color: red;
}
@media (min-width: 1px) {
  .baz {
    color: blue;
  }
}
@keyframes fade {
  0% {
    opacity: 0;
  }
}
`

    const rewritten = rewriteCssSelectorSource(source, {
      tryRewritePreludeDirect: prelude =>
        scopeSelectorPrelude(prelude, 'data-test'),
      appendRewrittenSelectors: () => {
        throw new Error('direct path should have handled this fixture')
      },
    })

    expect(rewritten).toContain('.foo[data-test], .bar[data-test]{')
    expect(rewritten).toContain('@media (min-width: 1px) {.baz[data-test]{')
    expect(rewritten).toContain('@keyframes fade {\n  0% {')
  })

  test('rewriteCssSelectorSource supports collector-style parsed fallback rewrites', () => {
    const source = '.foo { color: red; }'

    const rewritten = rewriteCssSelectorSource(source, {
      appendRewrittenSelectors: (selector, target) => {
        target.push(selector)
        target.push([...selector] as Selector)
      },
    })

    expect(rewritten).toBe('.foo, .foo{ color: red; }')
  })

  test('parseCssBlockTree preserves nested block structure', () => {
    const source = `
.foo {
  color: red;
  @media (min-width: 1px) {
    .bar {
      color: blue;
    }
  }
  .baz {
    color: green;
  }
}
`

    const roots = parseCssBlockTree(source)
    expect(roots).toHaveLength(1)
    expect(roots[0].normalizedPrelude).toBe('.foo')
    expect(roots[0].children).toHaveLength(2)
    expect(roots[0].children[0].normalizedPrelude).toBe(
      '@media (min-width: 1px)',
    )
    expect(roots[0].children[0].children[0].normalizedPrelude).toBe('.bar')
    expect(roots[0].children[1].normalizedPrelude).toBe('.baz')
  })

  test('scopeSelectorPrelude rewrites simple selectors and recurses into containers', () => {
    expect(scopeSelectorPrelude('.foo, .bar', 'data-test')).toBe(
      '.foo[data-test], .bar[data-test]',
    )
    expect(scopeSelectorPrelude(':is(.foo, .bar)', 'data-test')).toBe(
      ':is(.foo[data-test], .bar[data-test])',
    )
  })

  test('scopeSelectorPrelude returns undefined for unsupported syntax', () => {
    expect(scopeSelectorPrelude('svg|a', 'data-test')).toBeUndefined()
  })
})
