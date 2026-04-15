import path from 'node:path'
import { Features, transform } from 'lightningcss'
import type {
  SFCStyleCompileOptions,
  SFCStyleCompileResults,
} from '../src/compileStyle'

type CompileStyleImpl = (
  options: SFCStyleCompileOptions,
) => SFCStyleCompileResults

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
): void {
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

    test('::v-deep', () => {
      expectCodeToContain(
        compileScoped(`:deep(.foo) { color: red; }`),
        `[data-v-test] .foo { color: red;`,
      )
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

    test('::v-slotted', () => {
      expectCodeToContain(
        compileScoped(`:slotted(.foo) { color: red; }`),
        `.foo[data-v-test-s] { color: red;`,
      )
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

    test('::v-global', () => {
      expectCodeToContain(
        compileScoped(`:global(.foo) { color: red; }`),
        `.foo { color: red;`,
      )
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
@-webkit-keyframes color {
  from { color: red; }
  to { color: green; }
}
@keyframes opacity {
  from { opacity: 0; }
  to { opacity: 1; }
}
@-webkit-keyframes opacity {
  from { opacity: 0; }
  to { opacity: 1; }
}
          `,
          { id: 'data-v-test' },
        ),
      )

      expect(style).toContain(`.anim[data-v-test] {`)
      expect(style).toMatch(
        /animation: (?:color-test 5s infinite, other 5s|5s infinite color-test, 5s other);/,
      )
      expect(style).toContain(`.anim-2[data-v-test] {`)
      expect(style).toContain(`animation-name: color-test`)
      expect(style).toContain(`.anim-3[data-v-test] {`)
      expect(style).toMatch(
        /animation: (?:5s color-test infinite|5s infinite color-test), 5s other;/,
      )
      expect(style).toContain(`.anim-multiple[data-v-test] {`)
      expect(style).toMatch(
        /animation: (?:color-test 5s infinite|5s infinite color-test), ?(?:opacity-test 2s|2s opacity-test);/,
      )
      expect(style).toContain(`.anim-multiple-2[data-v-test] {`)
      expect(style).toMatch(/animation-name: color-test, ?opacity-test;/)
      expect(style).toContain(`@keyframes color-test {`)
      expect(style).toContain(`@-webkit-keyframes color-test {`)
      expect(style).toContain(`@keyframes opacity-test {`)
      expect(style).toContain(`@-webkit-keyframes opacity-test {`)
    })

    test('spaces after selector', () => {
      expectCodeToContain(
        compileScoped(`.foo , .bar { color: red; }`),
        `.foo[data-v-test], .bar[data-v-test] { color: red;`,
      )
    })

    describe('deprecated syntax', () => {
      test('::v-deep as combinator', () => {
        expectCodeToContain(
          compileScoped(`::v-deep .foo { color: red; }`),
          `[data-v-test] .foo { color: red;`,
        )
        expectCodeToContain(
          compileScoped(`.bar ::v-deep .foo { color: red; }`),
          `.bar[data-v-test] .foo { color: red;`,
        )
        expect(
          `::v-deep usage as a combinator has been deprecated.`,
        ).toHaveBeenWarned()
      })

      test('>>> (deprecated syntax)', () => {
        expectCodeToContain(
          compileScoped(`>>> .foo { color: red; }`),
          `[data-v-test] .foo { color: red;`,
        )
        expect(
          `the >>> and /deep/ combinators have been deprecated.`,
        ).toHaveBeenWarned()
      })

      test('/deep/ (deprecated syntax)', () => {
        expectCodeToContain(
          compileScoped(`/deep/ .foo { color: red; }`),
          `[data-v-test] .foo { color: red;`,
        )
        expect(
          `the >>> and /deep/ combinators have been deprecated.`,
        ).toHaveBeenWarned()
      })
    })

    test('should mount scope on correct selector when have universal selector', () => {
      expectCodeToContain(compileScoped(`* { color: red; }`), `[data-v-test]`)
      expectCodeToContain(
        compileScoped(`* .foo { color: red; }`),
        `.foo[data-v-test]`,
      )
      expectCodeToContain(
        compileScoped(`*.foo { color: red; }`),
        `.foo[data-v-test]`,
      )
      expectCodeToContain(
        compileScoped(`.foo * { color: red; }`),
        `.foo[data-v-test] *`,
      )
    })
  })

  describe(`${label} style preprocessors`, () => {
    test('scss @import', () => {
      const res = compileStyleImpl({
        source: `
            @import "./import.scss";
          `,
        filename: path.resolve(__dirname, './fixture/test.scss'),
        id: '',
        preprocessLang: 'scss',
      })

      expect([...res.dependencies]).toStrictEqual([
        path.join(__dirname, './fixture/import.scss'),
      ])
    }, 15000)

    test('scss respect user-defined string options.additionalData', () => {
      const res = compileStyleImpl({
        preprocessOptions: {
          additionalData: `
            @mixin square($size) {
              width: $size;
              height: $size;
            }`,
        },
        source: `
          .square {
            @include square(100px);
          }
        `,
        filename: path.resolve(__dirname, './fixture/test.scss'),
        id: '',
        preprocessLang: 'scss',
      })

      expect(res.errors.length).toBe(0)
    })

    test('scss respect user-defined function options.additionalData', () => {
      const source = `
          .square {
            @include square(100px);
          }
        `
      const filename = path.resolve(__dirname, './fixture/test.scss')
      const res = compileStyleImpl({
        preprocessOptions: {
          additionalData: (s: string, f: string) => {
            expect(s).toBe(source)
            expect(f).toBe(filename)
            return `
            @mixin square($size) {
              width: $size;
              height: $size;
            }`
          },
        },
        source,
        filename,
        id: '',
        preprocessLang: 'scss',
      })

      expect(res.errors.length).toBe(0)
    })
  })
}
