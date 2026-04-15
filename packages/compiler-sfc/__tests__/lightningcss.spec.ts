import { compileStyle, compileStyleWithLightningCss } from '../src/compileStyle'
import { runSharedStyleCompileTests } from './compileStyle.shared'

runSharedStyleCompileTests('Lightning CSS', compileStyleWithLightningCss)

describe('compileStyleWithLightningCss', () => {
  function normalizeCssOutput(code: string) {
    return code
      .replace(/\[([^\]=]+)="\1"\]/g, '[$1]')
      .replace(/\s+/g, ' ')
      .trim()
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

  test('does not support postcss plugins', () => {
    const res = compileStyleWithLightningCss({
      source: `.foo { color: red; }`,
      filename: 'test.css',
      id: 'data-v-test',
      postcssPlugins: [{}],
    })

    expect(res.code).toBe('')
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0].message).toContain('does not support')
    expect(res.errors[0].message).toContain('postcssPlugins')
  })

  test('does not support postcss options', () => {
    const res = compileStyleWithLightningCss({
      source: `.foo { color: red; }`,
      filename: 'test.css',
      id: 'data-v-test',
      postcssOptions: { parser: {} },
    })

    expect(res.code).toBe('')
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0].message).toContain('does not support')
    expect(res.errors[0].message).toContain('postcssOptions')
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

  function expectLightningCssToMatchCompileStyle(source: string) {
    const baseOptions = {
      source,
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    }

    const postcssResult = compileStyle(baseOptions)
    const lightningResult = compileStyleWithLightningCss(baseOptions)

    expect(postcssResult.errors).toHaveLength(0)
    expect(lightningResult.errors).toHaveLength(0)
    expect(extractSelectors(lightningResult.code)).toEqual(
      extractSelectors(postcssResult.code),
    )
  }
})
