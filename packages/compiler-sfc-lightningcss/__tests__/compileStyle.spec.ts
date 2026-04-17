import { compileStyle as compileStyleWithPostcss } from '@vue/compiler-sfc'
import { compileStyleWithLightningCss } from '../src/compileStyle'
import { runSharedStyleCompileTests } from '../../compiler-sfc/__tests__/compileStyle.shared'
import { Features, transform } from 'lightningcss'

runSharedStyleCompileTests('Lightning CSS', compileStyleWithLightningCss, {
  legacyVueScopedSyntax: false,
})

describe('compileStyleWithLightningCss', () => {
  function normalizeCssOutput(code: string) {
    return code
      .replace(/\[([^\]=]+)="\1"\]/g, '[$1]')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function flattenCss(code: string) {
    return new TextDecoder().decode(
      transform({
        filename: 'test.css',
        code: new TextEncoder().encode(code),
        include: Features.Nesting,
        nonStandard: {
          deepSelectorCombinator: true,
        },
      }).code,
    )
  }

  function extractSelectors(code: string) {
    return Array.from(normalizeCssOutput(code).matchAll(/([^{}]+)\{/g), match =>
      normalizeSelector(match[1].trim()),
    )
  }

  function normalizeSelector(selector: string) {
    return selector
      .replace(/:nth-child\(2n\+1\)/g, ':nth-child(odd)')
      .replace(/:nth-child\(2n\)/g, ':nth-child(even)')
      .replace(/(^|[^:]):(before|after|first-letter|first-line)\b/g, '$1::$2')
  }

  test('throws for postcss plugins', () => {
    expect(() =>
      compileStyleWithLightningCss({
        source: `.foo { color: red; }`,
        filename: 'test.css',
        id: 'data-v-test',
        postcssPlugins: [{}],
      }),
    ).toThrow(/postcssPlugins/)
  })

  test('throws for unsupported postcss options', () => {
    expect(() =>
      compileStyleWithLightningCss({
        source: `.foo { color: red; }`,
        filename: 'test.css',
        id: 'data-v-test',
        postcssOptions: { parser: {} },
      }),
    ).toThrow(/postcssOptions/)
  })

  test.each([
    ['::v-deep alias', `::v-deep(.foo) { color: red; }`, /:deep/],
    [':v-deep alias', `:v-deep(.foo) { color: red; }`, /:deep/],
    ['::v-slotted alias', `::v-slotted(.foo) { color: red; }`, /:slotted/],
    [':v-slotted alias', `:v-slotted(.foo) { color: red; }`, /:slotted/],
    ['::v-global alias', `::v-global(.foo) { color: red; }`, /:global/],
    [':v-global alias', `:v-global(.foo) { color: red; }`, /:global/],
    ['>>> combinator', `.foo >>> .bar { color: red; }`, /:deep/],
    ['/deep/ combinator', `.foo /deep/ .bar { color: red; }`, /:deep/],
    [
      '::v-deep combinator',
      `.foo ::v-deep .bar { color: red; }`,
      /:deep/,
    ],
  ])('rejects legacy scoped syntax: %s', (_label, source, expected) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.code).toBe('')
    expect(result.errors).toHaveLength(1)
    expect(String(result.errors[0])).toMatch(expected)
  })

  test('supports postcss map output options', () => {
    const res = compileStyleWithLightningCss({
      source: `.foo { color: red; }`,
      filename: 'test.css',
      id: 'data-v-test',
      postcssOptions: {
        map: {
          from: 'test.css',
          inline: false,
          annotation: false,
        },
      },
    })

    expect(res.errors).toHaveLength(0)
    expect(normalizeCssOutput(res.code)).toBe('.foo { color: red; }')
    expect(res.map).toBeDefined()
  })

  test('matches compileStyle for namespace selectors', () => {
    const source = `svg|a { color: red; } svg|a .icon { color: blue; }`
    expectLightningCssToMatchCompileStyle(source)
  })

  test.each([
    ['escaped class selector', `.foo\\:bar { color: red; }`],
    ['escaped type selector', `.a \\31 23item { color: red; }`],
    [':lang() selector', `:lang(en) { color: red; }`],
    [':nth-child() selector', `:nth-child(2n+1) { color: red; }`],
    ['::part() selector', `::part(tab) { color: red; }`],
    ['wildcard pseudo selector', `*:hover { color: red; }`],
    ['wildcard pseudo-element selector', `*::before { color: red; }`],
    ['slotted wildcard pseudo selector', `:slotted(*:hover) { color: red; }`],
    ['global wildcard selector', `:global(*) { color: red; }`],
  ])('matches compileStyle for %s', (_label, source) => {
    expectLightningCssToMatchCompileStyle(source)
  })

  test.each([
    [
      'global hover suffix',
      `:global(.btn):hover { color: red; }`,
      /\.btn:hover\s*\{\s*color: red;\s*\}/,
    ],
    [
      'global pseudo-element suffix',
      `:global(.btn)::before { content: "x"; }`,
      /\.btn::?before\s*\{\s*content: "x";\s*\}/,
    ],
  ])('preserves selector suffixes after %s', (_label, source, expected) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(result.code)).toMatch(expected)
  })

  test.todo(
    'Vue carriers inside :nth-child(... of ...)/:nth-last-child(... of ...) are not rewritten yet: :nth-child(2 of :global(.foo)), :nth-child(2 of :deep(.bar)), :nth-last-child(odd of :slotted(.x)) { color: red; }',
  )

  test.todo(
    '@scope root/limit selectors are not scoped yet; this currently matches the PostCSS compiler limitation: @scope (.foo) { .bar { color: red; } }',
  )

  test('v-bind preserves single-quoted raw expression spelling', () => {
    const source = `.foo { top: calc(v-bind(foo + 'px') - 3px); }`
    const postcssResult = compileStyleWithPostcss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(normalizeCssOutput(lightningResult.code)).toBe(
      normalizeCssOutput(postcssResult.code),
    )
  })

  test('v-bind allows whitespace before the opening paren', () => {
    const source = `.foo { color: v-bind    ((a + b) / 2 + 'px' ); }`
    const postcssResult = compileStyleWithPostcss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(normalizeCssOutput(lightningResult.code)).toBe(
      normalizeCssOutput(postcssResult.code),
    )
    expect(lightningResult.code).not.toContain('v-bind')
  })

  test('comment-bearing fallback selectors stay scoped after parsed rewrite', () => {
    const source = `
:global(.x) { color: red; }
.foo/* comment */.bar { color: blue; }
`

    const postcssResult = compileStyleWithPostcss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(normalizeCssOutput(lightningResult.code)).toContain(
      '.foo.bar[data-v-test] {',
    )
  })

  test('brace-valued custom properties do not trigger false nesting normalization', () => {
    const source = `.foo { --theme: { color: red; }; color: blue; }`
    const postcssResult = compileStyleWithPostcss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(normalizeCssOutput(lightningResult.code)).toContain(
      '.foo[data-v-test] {',
    )
    expect(normalizeCssOutput(lightningResult.code)).toContain(
      '--theme: { color: red; };',
    )
    expect(lightningResult.code).not.toContain('& {')
  })

  test('brace-valued custom properties do not break later nested rule normalization', () => {
    const source = `
.foo {
  --theme: { color: red; };
  .bar { color: blue; }
}
`
    const postcssResult = compileStyleWithPostcss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(flattenCss(lightningResult.code))
    expect(normalized).toContain(
      '.foo[data-v-test] { --theme: { color: red; };',
    )
    expect(normalized).toContain('.foo .bar[data-v-test] {')
    expect(lightningResult.code).not.toContain('&')
  })

  test('quoted @keyframes names are scoped with matching animation-name rewrites', () => {
    const result = compileStyleWithLightningCss({
      source: `
.anim {
  animation-name: "fade";
}
@keyframes "fade" {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(result.code)
    expect(normalized).toContain(
      '.anim[data-v-test] { animation-name: fade-test;',
    )
    expect(normalized).toContain('@keyframes fade-test {')
  })

  test('escaped keyframe names stay aligned with rewritten animation declarations', () => {
    const result = compileStyleWithLightningCss({
      source: `
.anim {
  animation: foo\\:bar 1s;
}
@keyframes foo\\:bar {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(result.code)
    expect(normalized).toContain('.anim[data-v-test] { animation:')
    expect(normalized).toContain('foo\\:bar-test')
    expect(normalized).toContain('@keyframes foo\\:bar-test {')
  })

  test.each([
    [
      'quoted animation-name values',
      `
.anim {
  animation-name: "foo";
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'animation shorthands whose keywords collide with local keyframe names',
      `
.anim {
  animation: paused foo 1s;
}
@keyframes paused {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes foo {
  from { color: red; }
  to { color: blue; }
}
`,
    ],
  ])('uses CSS-aware keyframe-name rewriting for %s', (_label, source) => {
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(lightningResult.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(lightningResult.code)
    if (source.includes('animation-name')) {
      expect(normalized).toContain('animation-name: foo-test')
      expect(normalized).not.toContain('animation-name: "foo"')
    } else {
      const animationValue = normalized
        .match(/\.anim\[data-v-test\] \{[^}]*animation:([^;}]+);/)?.[1]
        ?.trim()
      expect(animationValue).toContain('foo-test')
      expect(animationValue).toContain('paused')
      expect(animationValue).not.toContain('paused-test')
    }
  })

  test.each([
    [
      'var()-driven animation-name',
      `
.anim {
  animation-name: var(--anim-name);
}
@keyframes color {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'v-bind()-driven animation shorthand',
      `
.anim {
  animation: v-bind(animName) 1s linear;
}
@keyframes color {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
  ])('compiles scoped keyframes with %s', (_label, source) => {
    const postcssResult = compileStyleWithPostcss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(lightningResult.code).not.toBe('')
    expect(normalizeCssOutput(lightningResult.code)).toContain(
      '@keyframes color-test {',
    )
  })

  test('does not rewrite keyframe references in unscoped styles', () => {
    const result = compileStyleWithLightningCss({
      source: `
.anim {
  animation-name: var(--anim, fade);
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: false,
    })

    expect(result.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(result.code)
    expect(normalized).toContain('.anim { animation-name: var(--anim, fade); }')
    expect(normalized).toContain('@keyframes fade {')
    expect(normalized).not.toContain('fade-test')
  })

  test.each([
    [
      'animation-name var() fallback',
      `
.anim {
  animation-name: var(--anim, foo);
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'animation shorthand var() fallback',
      `
.anim {
  animation: var(--anim, foo) 1s linear;
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'animation-name comment + mixed-case var() fallback',
      `
.anim {
  animation-name: /*comment*/ Var(--anim, foo);
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'animation shorthand mixed-case play-state keyword',
      `
.anim {
  animation: var(--anim, foo) PAUSED 1s;
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'animation shorthand mixed-case timing keyword',
      `
.anim {
  animation: var(--anim, foo) EASE 1s;
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'animation shorthand inter-token comment',
      `
.anim {
  animation: /*comment*/ var(--anim, foo) 1s linear;
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
  ])('rewrites local keyframes inside %s', (_label, source) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(result.code)
    expect(normalized).toContain('foo-test')
    expect(normalized).toContain('@keyframes foo-test {')
  })

  test.each([
    [
      'mixed-case animation property',
      `
.anim {
  Animation: foo 1s linear;
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'mixed-case animation-name var() fallback',
      `
.anim {
  animation-name: Var(--anim, foo);
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
    [
      'mixed-case animation shorthand var() fallback',
      `
.anim {
  animation: VAR(--anim, foo) 1s linear;
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
    ],
  ])('%s rewrites keyframe references', (_label, source) => {
    const postcssResult = compileStyleWithPostcss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })
    const lightningResult = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(normalizeCssOutput(postcssResult.code)).toContain(
      '@keyframes foo-test {',
    )
    expect(normalizeCssOutput(lightningResult.code)).toContain(
      '@keyframes foo-test {',
    )
    expect(normalizeCssOutput(lightningResult.code)).toContain('foo-test')
  })

  test.each([
    [
      'vendor-prefixed animation-name var() fallback',
      `
.anim {
  -webkit-animation-name: var(--anim, foo);
}
@-webkit-keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
      '@-webkit-keyframes foo-test {',
    ],
    [
      'vendor-prefixed animation shorthand var() fallback',
      `
.anim {
  -webkit-animation: var(--anim, foo) 1s linear;
}
@-webkit-keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
      '@-webkit-keyframes foo-test {',
    ],
  ])(
    'rewrites local keyframes inside %s',
    (_label, source, keyframesFragment) => {
      const result = compileStyleWithLightningCss({
        source,
        filename: 'test.css',
        id: 'data-v-test',
        scoped: true,
      })

      expect(result.errors).toHaveLength(0)
      const normalized = normalizeCssOutput(result.code)
      expect(normalized).toContain('foo-test')
      expect(normalized).toContain(keyframesFragment)
    },
  )

  test.each([
    [
      'keyword timing-function names stay as timing functions',
      `
.anim {
  animation: ease 1s, linear 2s;
}
@keyframes ease {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes linear {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
      ['animation: none, none'],
    ],
    [
      'dynamic shorthands with a trailing local keyframe name',
      `
.anim {
  animation: var(--anim) 1s foo;
}
@keyframes foo {
  from { opacity: 0; }
  to { opacity: 1; }
}
`,
      ['foo-test'],
    ],
  ])(
    'rewrites %s in animation shorthands',
    (_label, source, expectedFragments) => {
      const result = compileStyleWithLightningCss({
        source,
        filename: 'test.css',
        id: 'data-v-test',
        scoped: true,
      })

      expect(result.errors).toHaveLength(0)
      const normalized = normalizeCssOutput(result.code)
      for (const fragment of expectedFragments) {
        expect(normalized).toContain(fragment)
      }
    },
  )

  test.each([
    [
      'wildcard sibling pseudo selector',
      `* + :hover { color: red; }`,
      `* + [data-v-test]:hover { color: red; }`,
    ],
    [
      'wildcard namespace selector',
      `svg|* { color: red; }`,
      `svg|*[data-v-test] { color: red; }`,
    ],
  ])('%s compiles to a valid scoped selector', (_label, source, expected) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(result.code)).toBe(expected)
  })

  test.each([
    ['deep inside :is()', `.a:is(:deep(.foo)) { color: red; }`],
    ['deep inside :where()', `.a:where(:deep(.foo)) { color: red; }`],
  ])('does not leak internal deep markers for %s', (_label, source) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(result.code).not.toContain('__VUE_SCOPE_DEEP__')
    const normalized = normalizeCssOutput(result.code)
    if (source.includes('.bar')) {
      expect(normalized).toContain('.bar')
      expect(normalized).toContain('.foo[data-v-test]')
    } else {
      expect(normalized).toContain('.foo')
      expect(normalized).toContain('.a[data-v-test]')
    }
  })

  test.each([
    [
      'deep inside :not()',
      `:not(.foo :deep(.bar)) { color: red; }`,
      ':not(.foo[data-v-test] .bar)[data-v-test] { color: red; }',
    ],
    [
      'deep inside :has()',
      `:has(.foo :deep(.bar)) { color: red; }`,
      ':has(.foo[data-v-test] .bar)[data-v-test] { color: red; }',
    ],
  ])(
    'rewrites %s without losing scope on the local branch',
    (_label, source, expected) => {
      const result = compileStyleWithLightningCss({
        source,
        filename: 'test.css',
        id: 'data-v-test',
        scoped: true,
      })

      expect(result.errors).toHaveLength(0)
      expect(normalizeCssOutput(result.code)).toBe(expected)
    },
  )

  test.each([
    [
      'deep inside :has() keeps an outer scope anchor',
      `:has(:deep(.child)) { color: red; }`,
      ':has([data-v-test] .child)[data-v-test] { color: red; }',
    ],
    [
      'slotted inside :not() keeps an outer scope anchor',
      `:not(:slotted(.x)) { color: red; }`,
      ':not(.x[data-v-test-s])[data-v-test] { color: red; }',
    ],
  ])('%s', (_label, source, expected) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(result.code)).toBe(expected)
  })

  test.each([
    [
      'global inside :not()',
      `:not(:global(.x)) { color: red; }`,
      ':not(.x)[data-v-test] { color: red; }',
    ],
    [
      'global inside :is()',
      `:is(:global(.x)) { color: red; }`,
      '.x[data-v-test] { color: red; }',
    ],
    [
      'global inside :has()',
      `:has(:global(.x)) { color: red; }`,
      ':has(.x)[data-v-test] { color: red; }',
    ],
  ])('%s keeps the outer selector scoped', (_label, source, expected) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(result.code)).toBe(expected)
  })

  test.each([
    ['slotted inside :is()', `:is(:slotted(.x)) { color: red; }`],
    ['slotted inside :where()', `:where(:slotted(.x)) { color: red; }`],
  ])('%s does not add an extra local scope attribute', (_label, source) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(result.code)
    expect(normalized).toContain('.x[data-v-test-s]')
    expect(normalized).not.toMatch(/\.x\[data-v-test-s\]\[data-v-test\]/)
  })

  test.each([
    [
      'nested style rules with mixed declarations and at-rules',
      `h1 {
  color: red;
  @media only screen and (max-width: 800px) {
    background-color: green;
    .bar { color: white; }
  }
  .foo { color: red; }
}`,
    ],
    [
      'deep nested rules inside media queries',
      `:deep(.foo) {
  color: red;
  @media only screen and (max-width: 800px) {
    color: blue;
    .bar { color: white; }
  }
}`,
    ],
    [
      'explicit nesting selectors',
      `.card {
  color: red;
  &.active { color: blue; }
  > .title { color: green; }
}`,
    ],
  ])(
    'matches compileStyle for %s after nesting is lowered',
    (_label, source) => {
      expectFlattenedLightningCssToMatchCompileStyle(source)
    },
  )

  test('logical pseudos with deep keep nested descendants scoped', () => {
    const result = compileStyleWithLightningCss({
      source: `:not(:deep(.foo)) {
  .bar { color: red; }
}`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(flattenCss(result.code))).toBe(
      ':not(.foo) .bar[data-v-test] { color: red; }',
    )
  })

  test('slotted selectors keep nested descendants in slot context', () => {
    const result = compileStyleWithLightningCss({
      source: `:slotted(.x) {
  .y { color: red; }
}`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(flattenCss(result.code))).toBe(
      '.x[data-v-test-s] .y { color: red; }',
    )
  })

  test('standard ::slotted() stays an ordinary pseudo-element for nested rules', () => {
    const result = compileStyleWithLightningCss({
      source: `::slotted(.x) {
  .y { color: red; }
}`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(result.code)).toBe(
      '::slotted(.x) .y[data-v-test] { color: red; }',
    )
  })

  test.each([
    [
      'mixed slotted and local branches',
      `:slotted(.x), .y {
  .b { color: red; }
}`,
    ],
    [
      'mixed deep and local branches',
      `:deep(.x), .y {
  .b { color: red; }
}`,
    ],
  ])('%s conservatively keeps nested descendants scoped', (_label, source) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(flattenCss(result.code))).toContain(
      '.b[data-v-test] { color: red; }',
    )
  })

  test.each([
    [
      'deep context through :is()',
      `:is(:deep(.foo)) {
  .bar { color: red; }
}`,
      '.bar[data-v-test]',
    ],
    [
      'slot context through :where()',
      `:where(:slotted(.x)) {
  .y { color: red; }
}`,
      '.y[data-v-test]',
    ],
  ])('%s is preserved for nested descendants', (_label, source, forbidden) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(flattenCss(result.code))
    expect(normalized).not.toContain(forbidden)
    if (source.includes(':deep(')) {
      expect(normalized).toContain('.bar { color: red; }')
    } else {
      expect(normalized).toContain('.x[data-v-test-s]')
      expect(normalized).toContain('.y { color: red; }')
    }
  })

  test('slotted selectors carry slot context through nested at-rules', () => {
    const result = compileStyleWithLightningCss({
      source: `:slotted(.x) {
  @media print {
    .b { color: red; }
  }
}`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(flattenCss(result.code))).toBe(
      '@media print { .x[data-v-test-s] .b { color: red; } }',
    )
  })

  test('mixed declarations and nested rules keep top-level :global() declarations global', () => {
    const result = compileStyleWithLightningCss({
      source: `:global(.foo) {
  color: red;
  .bar { color: blue; }
}`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    const normalized = normalizeCssOutput(flattenCss(result.code))
    expect(normalized).toContain('.foo { color: red; }')
    expect(normalized).toContain('.foo .bar[data-v-test] { color:')
    expect(normalized).not.toContain('.foo[data-v-test] { color:')
  })

  test('declaration-only at-rules under nested conditional rules are not wrapped with & blocks', () => {
    const result = compileStyleWithLightningCss({
      source: `.foo {
  .bar { color: red; }
  @media print {
    @font-face {
      font-family: x;
      src: url(x);
    }
  }
}`,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(result.code).not.toContain('& {')
    const normalized = normalizeCssOutput(flattenCss(result.code))
    expect(normalized).toContain('@media print { @font-face { font-family: x;')
    expect(normalized).toMatch(/src: url\("?x"?\);/)
  })

  test('leading universal selector is preserved before child and sibling combinators', () => {
    expect(
      normalizeCssOutput(
        compileStyleWithLightningCss({
          source: `* + .foo { color: red; }`,
          filename: 'test.css',
          id: 'data-v-test',
          scoped: true,
        }).code,
      ),
    ).toBe(`* + .foo[data-v-test] { color: red; }`)
    expect(
      normalizeCssOutput(
        compileStyleWithLightningCss({
          source: `* > .foo { color: red; }`,
          filename: 'test.css',
          id: 'data-v-test',
          scoped: true,
        }).code,
      ),
    ).toBe(`* > .foo[data-v-test] { color: red; }`)
    expect(
      normalizeCssOutput(
        compileStyleWithLightningCss({
          source: `* ~ .foo { color: red; }`,
          filename: 'test.css',
          id: 'data-v-test',
          scoped: true,
        }).code,
      ),
    ).toBe(`* ~ .foo[data-v-test] { color: red; }`)
  })

  test.each([
    [
      'nested :not() deep argument',
      `:not(.foo :deep(.bar)) {
  .baz { color: red; }
}`,
      ':not(.foo .bar) .baz[data-v-test] { color: red; }',
    ],
    [
      'nested :has() deep argument',
      `:has(.foo :deep(.bar)) {
  .baz { color: red; }
}`,
      ':has(.foo .bar) .baz[data-v-test] { color: red; }',
    ],
  ])('%s keeps nested descendants scoped', (_label, source, expected) => {
    const result = compileStyleWithLightningCss({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    })

    expect(result.errors).toHaveLength(0)
    expect(normalizeCssOutput(flattenCss(result.code))).toBe(expected)
  })

  test.each([
    [
      'nested deep carriers',
      `:deep(.a) {
  .b { color: red; }
}`,
    ],
    [
      'nested global carriers',
      `.a {
  :global(.b) { color: red; }
}`,
    ],
  ])(
    'matches compileStyle for %s when sourcemaps are enabled',
    (_label, source) => {
      const baseOptions = {
        source,
        filename: 'test.css',
        id: 'data-v-test',
        scoped: true,
        postcssOptions: {
          map: {
            from: 'test.css',
            inline: false,
            annotation: false,
          },
        },
      }

      const postcssResult = compileStyleWithPostcss(baseOptions)
      const lightningResult = compileStyleWithLightningCss(baseOptions)

      expect(postcssResult.errors).toHaveLength(0)
      expect(lightningResult.errors).toHaveLength(0)
      expect(lightningResult.map).toBeDefined()
      expect(normalizeCssOutput(flattenCss(lightningResult.code))).toBe(
        normalizeCssOutput(flattenCss(postcssResult.code)),
      )
    },
  )

  test('matches compileStyle sourcemap shape for preprocessed styles requested via postcssOptions.map', () => {
    const baseOptions = {
      source: `$color: red;\n.foo { color: $color; }\n`,
      filename: 'test.scss',
      id: 'data-v-test',
      scoped: true,
      preprocessLang: 'scss' as const,
      postcssOptions: {
        map: {
          from: 'test.scss',
          inline: false,
          annotation: false,
        },
      },
    }

    const postcssResult = compileStyleWithPostcss(baseOptions)
    const lightningResult = compileStyleWithLightningCss(baseOptions)

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(lightningResult.map).toBeDefined()
    expect(normalizeCssOutput(lightningResult.code)).toBe(
      normalizeCssOutput(postcssResult.code),
    )
    expect(lightningResult.map?.sources).toContain('test.scss')
    expect(
      lightningResult.map?.sources.some(source =>
        /[/\\]test\.scss$/.test(source),
      ),
    ).toBe(true)
  })

  test('less preprocessing keeps filename for relative import resolution', () => {
    let receivedFilename: string | undefined
    const filename = '/virtual/components/example.less'
    const result = compileStyleWithLightningCss({
      source: `.foo { color: red; }`,
      filename,
      id: 'data-v-test',
      preprocessLang: 'less',
      preprocessCustomRequire(id) {
        expect(id).toBe('less')
        return {
          render(
            _source: string,
            options: Record<string, unknown>,
            callback: (err: Error | null, output: any) => void,
          ) {
            receivedFilename = options.filename as string | undefined
            callback(null, {
              css: `.foo { color: red; }`,
              imports: [],
              map: undefined,
            })
          },
        }
      },
    })

    expect(result.errors).toHaveLength(0)
    expect(receivedFilename).toBe(filename)
  })

  test('stylus preprocessing keeps filename for relative import resolution', () => {
    let receivedFilename: string | undefined
    const filename = '/virtual/components/example.styl'
    const result = compileStyleWithLightningCss({
      source: `.foo\n  color red\n`,
      filename,
      id: 'data-v-test',
      preprocessLang: 'stylus',
      preprocessCustomRequire(id) {
        expect(id).toBe('stylus')
        return (input: string, options: Record<string, unknown>) => {
          receivedFilename = options.filename as string | undefined
          return {
            deps() {
              return []
            },
            render() {
              return `.foo { color: red; }`
            },
            set() {},
          }
        }
      },
    })

    expect(result.errors).toHaveLength(0)
    expect(receivedFilename).toBe(filename)
  })

  function expectLightningCssToMatchCompileStyle(source: string) {
    const baseOptions = {
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    }

    const postcssResult = compileStyleWithPostcss(baseOptions)
    const lightningResult = compileStyleWithLightningCss(baseOptions)

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(extractSelectors(lightningResult.code)).toEqual(
      extractSelectors(postcssResult.code),
    )
  }

  function expectFlattenedLightningCssToMatchCompileStyle(source: string) {
    const baseOptions = {
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    }

    const postcssResult = compileStyleWithPostcss(baseOptions)
    const lightningResult = compileStyleWithLightningCss(baseOptions)

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(normalizeCssOutput(flattenCss(lightningResult.code))).toBe(
      normalizeCssOutput(flattenCss(postcssResult.code)),
    )
  }
})
