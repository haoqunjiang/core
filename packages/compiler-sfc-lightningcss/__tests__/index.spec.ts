import * as compilerSfc from '@vue/compiler-sfc'
import * as compiler from '../src'
import { runSharedCssModulesCompileTests } from '../../compiler-sfc/__tests__/compileStyle.shared'

runSharedCssModulesCompileTests(
  '@vue/compiler-sfc-lightningcss',
  compiler.compileStyleAsync,
)

describe('@vue/compiler-sfc-lightningcss', () => {
  test('re-exports the compiler-sfc surface', () => {
    expect(compiler.parse).toBe(compilerSfc.parse)
    expect(compiler.compileTemplate).toBe(compilerSfc.compileTemplate)
    expect(compiler.compileScript).toBe(compilerSfc.compileScript)
  })

  test('compileStyle and compileStyleWithLightningCss are the same engine', () => {
    const options = {
      source: '.foo { color: red; }',
      filename: 'test.css',
      id: 'data-v-test',
      scoped: true,
    }

    expect(compiler.compileStyle(options)).toEqual(
      compiler.compileStyleWithLightningCss(options),
    )
  })

  test('compileStyleAsync supports the plugin-vue sourcemap option shape', async () => {
    const result = await compiler.compileStyleAsync({
      source: '.foo { color: red; }',
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
    })

    expect(result.errors).toHaveLength(0)
    expect(result.map).toBeDefined()
  })

  test('compileStyle throws when trim is disabled', () => {
    expect(() =>
      compiler.compileStyle({
        source: '.foo { color: red; }',
        filename: 'test.css',
        id: 'data-v-test',
        trim: false,
      }),
    ).toThrow(/trim: false/)
  })

  test('compileStyle throws when postcss plugins are used', () => {
    expect(() =>
      compiler.compileStyle({
        source: '.foo { color: red; }',
        filename: 'test.css',
        id: 'data-v-test',
        postcssPlugins: [{}],
      }),
    ).toThrow(/postcssPlugins/)
  })

  test('compileStyle throws when css modules are used without compileStyleAsync', () => {
    expect(() =>
      compiler.compileStyle({
        source: '.red { color: red; }',
        filename: 'test.css',
        id: 'test',
        modules: true,
      } as any),
    ).toThrow(/compileStyleAsync/)
  })

  test('compileStyleAsync rejects unsupported css modules options', async () => {
    await expect(
      compiler.compileStyleAsync({
        source: '.red { color: red; }',
        filename: 'test.css',
        id: 'test',
        modules: true,
        modulesOptions: {
          scopeBehaviour: 'global',
        },
      }),
    ).rejects.toThrow(/scopeBehaviour/)
  })

  test('compileStyleAsync rejects scoped css modules', async () => {
    await expect(
      compiler.compileStyleAsync({
        source: '.red { color: red; }',
        filename: 'test.css',
        id: 'test',
        scoped: true,
        modules: true,
      }),
    ).rejects.toThrow(/combined with `scoped`/)
  })
})
