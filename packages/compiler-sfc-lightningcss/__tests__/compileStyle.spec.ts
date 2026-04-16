import { compileStyle as compileStyleWithPostcss } from '@vue/compiler-sfc'
import { compileStyleWithLightningCss } from '../src/compileStyle'
import { runSharedStyleCompileTests } from '../../compiler-sfc/__tests__/compileStyle.shared'
import { Features, transform } from 'lightningcss'

runSharedStyleCompileTests('Lightning CSS', compileStyleWithLightningCss)

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
  ])('matches compileStyle for %s', (_label, source) => {
    expectLightningCssToMatchCompileStyle(source)
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
