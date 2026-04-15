import { compileStyle, compileStyleAsync } from '../src/compileStyle'
import { runSharedStyleCompileTests } from './compileStyle.shared'

runSharedStyleCompileTests('SFC', compileStyle)

describe('SFC CSS modules', () => {
  test('should include resulting classes object in result', async () => {
    const result = await compileStyleAsync({
      source: `.red { color: red }\n.green { color: green }\n:global(.blue) { color: blue }`,
      filename: `test.css`,
      id: 'test',
      modules: true,
    })
    expect(result.modules).toBeDefined()
    expect(result.modules!.red).toMatch('_red_')
    expect(result.modules!.green).toMatch('_green_')
    expect(result.modules!.blue).toBeUndefined()
  })

  test('postcss-modules options', async () => {
    const result = await compileStyleAsync({
      source: `:local(.foo-bar) { color: red }\n.baz-qux { color: green }`,
      filename: `test.css`,
      id: 'test',
      modules: true,
      modulesOptions: {
        scopeBehaviour: 'global',
        generateScopedName: `[name]__[local]__[hash:base64:5]`,
        localsConvention: 'camelCaseOnly',
      },
    })
    expect(result.modules).toBeDefined()
    expect(result.modules!.fooBar).toMatch('__foo-bar__')
    expect(result.modules!.bazQux).toBeUndefined()
  })
})
