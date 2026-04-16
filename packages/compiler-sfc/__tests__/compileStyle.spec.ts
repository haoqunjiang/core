import { compileStyle, compileStyleAsync } from '../src/compileStyle'
import {
  runSharedCssModulesCompileTests,
  runSharedStyleCompileTests,
} from './compileStyle.shared'

runSharedStyleCompileTests('SFC', compileStyle)
runSharedCssModulesCompileTests('SFC', compileStyleAsync)

describe('SFC CSS modules', () => {
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
