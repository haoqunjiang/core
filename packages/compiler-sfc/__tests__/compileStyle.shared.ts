import path from 'node:path'
import type { RawSourceMap } from '@vue/compiler-core'
import { Features, transform } from 'lightningcss'
import type {
  SFCAsyncStyleCompileOptions,
  SFCStyleCompileOptions,
  SFCStyleCompileResults,
} from '../src/compileStyle'

// Shared style-compiler behavior suite used by both the default PostCSS engine
// and the extracted Lightning CSS package. This stays under `compiler-sfc`
// because it describes the compiler-sfc style contract, but it is not part of
// the published runtime API.
type CompileStyleImpl = (
  options: SFCStyleCompileOptions,
) => SFCStyleCompileResults

type CompileStyleAsyncImpl = (
  options: SFCAsyncStyleCompileOptions,
) => Promise<SFCStyleCompileResults>

function normalizeCssOutput(code: string) {
  return code
    .replace(/\[([^\]=]+)="\1"\]/g, '[$1]')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFlattenedCssOutput(code: string) {
  const result = transform({
    filename: 'test.css',
    code: new TextEncoder().encode(code),
    include: Features.Nesting,
    nonStandard: {
      deepSelectorCombinator: true,
    },
  })

  return normalizeCssOutput(new TextDecoder().decode(result.code))
}

function expectCodeToContain(code: string, expected: string) {
  expect(normalizeCssOutput(code)).toContain(normalizeCssOutput(expected))
}

export function runSharedStyleCompileTests(
  label: string,
  compileStyleImpl: CompileStyleImpl,
  options: {
    legacyVueScopedSyntax?: boolean
  } = {},
): void {
  const legacyVueScopedSyntax = options.legacyVueScopedSyntax ?? true

  function compileScoped(
    source: string,
    options?: Partial<SFCStyleCompileOptions>,
  ): string {
    const res = compileStyleImpl({
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
      ...options,
    })
    if (res.errors.length) {
      res.errors.forEach(err => {
        console.error(err)
      })
      expect(res.errors.length).toBe(0)
    }
    return res.code
  }

  describe(`${label} scoped CSS`, () => {
    test('simple selectors', () => {
      expectCodeToContain(
        compileScoped(`h1 { color: red; }`),
        `h1[data-v-test]`,
      )
      expectCodeToContain(
        compileScoped(`.foo { color: red; }`),
        `.foo[data-v-test]`,
      )
    })

    test('short scope ids are normalized to runtime scope attributes', () => {
      const res = compileStyleImpl({
        source: `.foo { color: red; }`,
        filename: 'test.css',
        id: 'test',
        scoped: true,
      })

      expect(res.errors).toHaveLength(0)
      expectCodeToContain(res.code, `.foo[data-v-test]`)
    })

    test('descendent selector', () => {
      expectCodeToContain(
        compileScoped(`h1 .foo { color: red; }`),
        `h1 .foo[data-v-test]`,
      )

      const code = normalizeFlattenedCssOutput(
        compileScoped(`main {
  width: 100%;
  > * {
    max-width: 200px;
  }
}`),
      )
      expect(code).toContain(`main[data-v-test] { width: 100%;`)
      expect(code).toMatch(
        /main\s*>\s*(?:\*\[data-v-test\]|\[data-v-test\])\s*\{/,
      )
    })

    test('nesting selector', () => {
      const code = normalizeFlattenedCssOutput(
        compileScoped(`h1 { color: red; .foo { color: red; } }`),
      )
      expect(code).toContain(`h1[data-v-test]`)
      expect(code).toContain(`h1 .foo[data-v-test]`)
    })

    test('nesting selector with atrule and comment', () => {
      const code = normalizeFlattenedCssOutput(
        compileScoped(`h1 {
color: red;
/*background-color: pink;*/
@media only screen and (max-width: 800px) {
  background-color: green;
  .bar { color: white }
}
.foo { color: red; }
}`),
      )

      expect(code).toContain(`h1[data-v-test] { color: red`)
      expect(code).toMatch(
        /@media only screen and \((?:max-width: 800px|width <= 800px)\) \{/,
      )
      expect(code).toContain(`h1[data-v-test] { background-color: green`)
      expect(code).toContain(`.bar[data-v-test]`)
      expect(code).toContain(`.foo[data-v-test]`)
    })

    test('multiple selectors', () => {
      expectCodeToContain(
        compileScoped(`h1 .foo, .bar, .baz { color: red; }`),
        `h1 .foo[data-v-test], .bar[data-v-test], .baz[data-v-test]`,
      )
    })

    test('pseudo class', () => {
      expect(
        normalizeCssOutput(compileScoped(`.foo:after { color: red; }`)),
      ).toMatch(/\.foo\[data-v-test\]::?after\s*\{/)
    })

    test('pseudo element', () => {
      expectCodeToContain(
        compileScoped(`::selection { display: none; }`),
        `[data-v-test]::selection {`,
      )
    })

    test('namespace selector', () => {
      expectCodeToContain(
        compileScoped(`svg|a { color: red; }`),
        `svg|a[data-v-test] { color: red;`,
      )
      expectCodeToContain(
        compileScoped(`svg|a .icon { color: red; }`),
        `svg|a .icon[data-v-test] { color: red;`,
      )
    })

    test('spaces before pseudo element', () => {
      const code = compileScoped(`.abc, ::selection { color: red; }`)
      expectCodeToContain(code, `.abc[data-v-test],`)
      expectCodeToContain(code, `[data-v-test]::selection {`)
    })

    test(':deep()', () => {
      expectCodeToContain(
        compileScoped(`:deep(.foo) { color: red; }`),
        `[data-v-test] .foo { color: red;`,
      )
      expectCodeToContain(
        compileScoped(`:is(.foo :deep(.bar)) { color: red; }`),
        `:is(.foo[data-v-test] .bar)`,
      )
      expectCodeToContain(
        compileScoped(`:where(.foo :deep(.bar)) { color: red; }`),
        `:where(.foo[data-v-test] .bar)`,
      )

      const code = normalizeFlattenedCssOutput(
        compileScoped(`:deep(.foo) { color: red; .bar { color: red; } }`),
      )
      expect(code).toContain(`[data-v-test] .foo`)
      expect(code).toContain(`[data-v-test] .foo .bar`)
    })

    if (legacyVueScopedSyntax) {
      test('legacy ::v-deep()', () => {
        expectCodeToContain(
          compileScoped(`::v-deep(.foo) { color: red; }`),
          `[data-v-test] .foo { color: red;`,
        )
        expectCodeToContain(
          compileScoped(`::v-deep(.foo .bar) { color: red; }`),
          `[data-v-test] .foo .bar { color: red;`,
        )
        expectCodeToContain(
          compileScoped(`.baz .qux ::v-deep(.foo .bar) { color: red; }`),
          `.baz .qux[data-v-test] .foo .bar { color: red;`,
        )
      })
    }

    test(':slotted()', () => {
      expectCodeToContain(
        compileScoped(`:slotted(.foo) { color: red; }`),
        `.foo[data-v-test-s] { color: red;`,
      )
    })

    if (legacyVueScopedSyntax) {
      test('legacy ::v-slotted()', () => {
        expectCodeToContain(
          compileScoped(`::v-slotted(.foo) { color: red; }`),
          `.foo[data-v-test-s] { color: red;`,
        )
        expectCodeToContain(
          compileScoped(`::v-slotted(.foo .bar) { color: red; }`),
          `.foo .bar[data-v-test-s] { color: red;`,
        )
        expectCodeToContain(
          compileScoped(`.baz .qux ::v-slotted(.foo .bar) { color: red; }`),
          `.baz .qux .foo .bar[data-v-test-s] { color: red;`,
        )
      })
    }

    test(':global()', () => {
      expectCodeToContain(
        compileScoped(`:global(.foo) { color: red; }`),
        `.foo { color: red;`,
      )
    })

    if (legacyVueScopedSyntax) {
      test('legacy ::v-global()', () => {
        expectCodeToContain(
          compileScoped(`::v-global(.foo) { color: red; }`),
          `.foo { color: red;`,
        )
        expectCodeToContain(
          compileScoped(`::v-global(.foo .bar) { color: red; }`),
          `.foo .bar { color: red;`,
        )

        const code = compileScoped(
          `.baz .qux ::v-global(.foo .bar) { color: red; }`,
        )
        expectCodeToContain(code, `.foo .bar { color: red;`)
        expect(normalizeCssOutput(code)).not.toContain(`.baz .qux`)
      })
    }

    test(':is() and :where() with multiple selectors', () => {
      expect(
        normalizeCssOutput(compileScoped(`:is(.foo) { color: red; }`)),
      ).toMatch(/(?:\:is\(\.foo\[data-v-test\]\)|\.foo\[data-v-test\])\s*\{/)
      expectCodeToContain(
        compileScoped(`:where(.foo, .bar) { color: red; }`),
        `:where(.foo[data-v-test], .bar[data-v-test])`,
      )
      expectCodeToContain(
        compileScoped(`:is(.foo, .bar) div { color: red; }`),
        `:is(.foo, .bar) div[data-v-test]`,
      )
    })

    test(':is() and :where() in compound selectors', () => {
      const whereHover = compileScoped(
        `.div { color: red; } .div:where(:hover) { color: blue; }`,
      )
      expectCodeToContain(whereHover, `.div[data-v-test] { color: red;`)
      expect(normalizeCssOutput(whereHover)).toContain(
        `.div[data-v-test]:where(:hover) {`,
      )

      const isHover = normalizeCssOutput(
        compileScoped(`.div { color: red; } .div:is(:hover) { color: blue; }`),
      )
      expect(isHover).toContain(`.div[data-v-test] { color: red;`)
      expect(isHover).toMatch(
        /\.div\[data-v-test\](?::is\(:hover\)|:hover)\s*\{/,
      )

      const whereCompound = compileScoped(
        `.div { color: red; } .div:where(.foo:hover) { color: blue; }`,
      )
      expectCodeToContain(whereCompound, `.div[data-v-test] { color: red;`)
      expect(normalizeCssOutput(whereCompound)).toContain(
        `.div[data-v-test]:where(.foo:hover) {`,
      )

      const isCompound = normalizeCssOutput(
        compileScoped(
          `.div { color: red; } .div:is(.foo:hover) { color: blue; }`,
        ),
      )
      expect(isCompound).toContain(`.div[data-v-test] { color: red;`)
      expect(isCompound).toMatch(
        /\.div\[data-v-test\](?::is\(\.foo:hover\)|\.foo:hover)\s*\{/,
      )
    })

    test('media query', () => {
      const code = compileScoped(`@media print { .foo { color: red }}`)
      expectCodeToContain(code, `@media print {`)
      expectCodeToContain(code, `.foo[data-v-test] { color: red`)
    })

    test('supports query', () => {
      const code = normalizeCssOutput(
        compileScoped(`@supports(display: grid) { .foo { display: grid }}`),
      )
      expect(code).toMatch(/@supports ?\(display: grid\) \{/)
      expect(code).toContain(`.foo[data-v-test] { display: grid`)
    })

    test('scoped keyframes', () => {
      const style = normalizeCssOutput(
        compileScoped(
          `
.anim {
  animation: color 5s infinite, other 5s;
}
.anim-2 {
  animation-name: color;
  animation-duration: 5s;
}
.anim-3 {
  animation: 5s color infinite, 5s other;
}
.anim-multiple {
  animation: color 5s infinite, opacity 2s;
}
.anim-multiple-2 {
  animation-name: color, opacity;
  animation-duration: 5s, 2s;
}

@keyframes color {
  from { color: red; }
  to { color: green; }
}
@keyframes opacity {
  from { opacity: 0; }
  to { opacity: 1; }
}

.anim-multi-line {
  animation:
    color 5s infinite,
    opacity 2s;
}
.anim-multi-line-2 {
  animation-name:
    color,
    opacity;
  animation-duration:
    5s,
    2s;
}
`,
        ),
      )

      expect(style).toMatch(/\.anim\[data-v-test\] \{[^}]*color-test[^}]*other/)
      expect(style).toMatch(
        /\.anim-2\[data-v-test\] \{[^}]*animation-name: color-test/,
      )
      expect(style).toMatch(
        /\.anim-3\[data-v-test\] \{[^}]*color-test[^}]*other/,
      )
      expect(style).toMatch(
        /\.anim-multiple\[data-v-test\] \{[^}]*color-test[^}]*opacity-test/,
      )
      expect(style).toMatch(
        /\.anim-multiple-2\[data-v-test\] \{[^}]*color-test[^}]*opacity-test/,
      )
      expect(style).toContain(`@keyframes color-test {`)
      expect(style).toContain(`@keyframes opacity-test {`)
      expect(style).toMatch(
        /\.anim-multi-line\[data-v-test\] \{[^}]*color-test[^}]*opacity-test/,
      )
      expect(style).toMatch(
        /\.anim-multi-line-2\[data-v-test\] \{[^}]*color-test[^}]*opacity-test/,
      )
    })

    test('pre-processors', () => {
      expectCodeToContain(
        compileScoped(`.foo { color: red; }`, {
          preprocessLang: 'scss',
        }),
        `.foo[data-v-test]`,
      )
    }, 20_000)

    test('source map', () => {
      const filename = path.resolve(__dirname, '../__tests__/fixture/test.css')
      const style = compileScoped(`.foo { color: red; }`, {
        filename,
        inMap: {
          version: '3',
          file: filename,
          sources: [filename],
          sourcesContent: [`.foo { color: red; }`],
          names: [],
          mappings: 'AAAA,CAAC,IAAI,EAAE,KAAK,EAAE,GAAG,EAAE',
        } as RawSourceMap,
      })
      expectCodeToContain(style, `.foo[data-v-test] { color: red;`)
    })
  })
}

export function runSharedCssModulesCompileTests(
  label: string,
  compileStyleAsyncImpl: CompileStyleAsyncImpl,
): void {
  const sharedGenerateScopedName = '[name]__[local]__[hash]'

  describe(`${label} CSS modules`, () => {
    test('includes resulting classes object in result', async () => {
      const result = await compileStyleAsyncImpl({
        source:
          '.red { color: red }\n.green { color: green }\n:global(.blue) { color: blue }',
        filename: 'test.css',
        id: 'test',
        modules: true,
        modulesOptions: {
          generateScopedName: sharedGenerateScopedName,
        },
      })

      expect(result.modules).toBeDefined()
      expect(result.modules!.red).toBeDefined()
      expect(result.modules!.green).toBeDefined()
      expect(result.modules!.blue).toBeUndefined()
    })

    test('supports shared css modules options subset', async () => {
      const result = await compileStyleAsyncImpl({
        source: ':local(.foo-bar) { color: red }\n.baz-qux { color: green }',
        filename: 'test.css',
        id: 'test',
        modules: true,
        modulesOptions: {
          generateScopedName: '[name]__[local]__[hash]',
          localsConvention: 'camelCaseOnly',
        },
      })

      expect(result.modules).toEqual({
        fooBar: expect.stringMatching(/^test__foo-bar__/),
        bazQux: expect.stringMatching(/^test__baz-qux__/),
      })
    })

    test('includes locally composed class names in module exports', async () => {
      const result = await compileStyleAsyncImpl({
        source: '.base { color: red }\n.red { composes: base; color: blue }',
        filename: 'test.css',
        id: 'test',
        modules: true,
        modulesOptions: {
          generateScopedName: sharedGenerateScopedName,
        },
      })

      expect(result.modules).toBeDefined()
      expect(result.modules!.base).toBeDefined()
      expect(result.modules!.red).toContain(result.modules!.base)
    })
  })
}
