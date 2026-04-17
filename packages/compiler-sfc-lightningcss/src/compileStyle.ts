import type {
  SFCAsyncStyleCompileOptions,
  SFCStyleCompileOptions,
  SFCStyleCompileResults,
} from '@vue/compiler-sfc'
import type { RawSourceMap } from '@vue/compiler-core'
import type { CSSModuleExports, CSSModulesConfig } from 'lightningcss'
import { camelize, extend } from '@vue/shared'
import { createCompilerRequire } from './nodeRequire'
import {
  type StylePreprocessor,
  type StylePreprocessorResults,
  processors,
} from './style/preprocessors'
import {
  hasCssVarsBinding,
  rewriteCssVarsInStyleSource,
  rewriteCssVarsInStyleSourceWithMap,
} from './style/cssVars'
import { createStyleLightningCSSVisitor } from './style/lightningcss'
import { analyzeStyleLightningCSSFeatures } from './style/lightningcss/features'
import { normalizeNestedStyleBlocks } from './style/lightningcss/nesting'
import {
  rewriteAnimationDeclarationsInStyleSource,
  rewriteAnimationDeclarationsInStyleSourceWithMap,
} from './style/lightningcss/scoped/animation'
import {
  scopeLightningCssSource,
  scopeLightningCssSourceWithMap,
} from './style/lightningcss/sourceScope'

export type {
  SFCAsyncStyleCompileOptions,
  SFCStyleCompileOptions,
  SFCStyleCompileResults,
} from '@vue/compiler-sfc'

type CSSModulesOptions = NonNullable<
  SFCAsyncStyleCompileOptions['modulesOptions']
>

/**
 * Compiler-SFC-compatible style compiler backed by the Lightning CSS style
 * pipeline.
 *
 * Unsupported option shapes fail fast instead of silently falling back to the
 * PostCSS implementation.
 */
export function compileStyle(
  options: SFCStyleCompileOptions,
): SFCStyleCompileResults {
  assertSupportedLightningCssStyleOptions(options, false)
  return compileStyleWithLightningCssImpl(options)
}

/**
 * Async facade for tooling such as `@vitejs/plugin-vue`, which expects a
 * compiler module exposing `compileStyleAsync`.
 *
 * The Lightning CSS style pipeline is synchronous today, so the async entry
 * simply resolves the sync result. CSS modules stay async-only to match the
 * public `@vue/compiler-sfc` contract even though the underlying Lightning CSS
 * transform is synchronous. Unsupported option shapes reject immediately.
 */
export async function compileStyleAsync(
  options: SFCAsyncStyleCompileOptions,
): Promise<SFCStyleCompileResults> {
  assertSupportedLightningCssStyleOptions(options, true)
  return compileStyleWithLightningCssImpl(options)
}

export function compileStyleWithLightningCss(
  options: SFCStyleCompileOptions,
): SFCStyleCompileResults {
  assertSupportedLightningCssStyleOptions(options, false)
  return compileStyleWithLightningCssImpl(options)
}

function compileStyleWithLightningCssImpl(
  options: SFCStyleCompileOptions | SFCAsyncStyleCompileOptions,
): SFCStyleCompileResults {
  if (__GLOBAL__ || __ESM_BROWSER__) {
    throw new Error(
      '[@vue/compiler-sfc-lightningcss] `compileStyle` is not supported in the browser build.',
    )
  }

  const {
    filename,
    id,
    scoped = false,
    isProd = false,
    preprocessLang,
    postcssOptions,
  } = options
  const modules = !!('modules' in options && options.modules)
  const modulesOptions =
    'modulesOptions' in options ? options.modulesOptions || {} : {}
  const shortId = id.replace(/^data-v-/, '')
  const initialInputMap = options.inMap || options.map
  const sourceMap = shouldGenerateLightningCssSourceMap(
    postcssOptions,
    initialInputMap as RawSourceMap | undefined,
  )
  const preprocessor = preprocessLang && processors[preprocessLang]
  const preProcessedSource =
    preprocessor && preprocess(options, preprocessor, sourceMap)
  let inputMap = preProcessedSource ? preProcessedSource.map : initialInputMap
  let source = preProcessedSource ? preProcessedSource.code : options.source

  if (hasCssVarsBinding(source)) {
    if (sourceMap) {
      const rewritten = rewriteCssVarsInStyleSourceWithMap(
        source,
        filename,
        shortId,
        isProd,
        inputMap as RawSourceMap | undefined,
      )
      source = rewritten.code
      inputMap = rewritten.map
    } else {
      source = rewriteCssVarsInStyleSource(source, shortId, isProd)
    }
  }

  let features = analyzeStyleLightningCSSFeatures(source, id)

  if (
    scoped &&
    features.hasAnimationDeclarations &&
    Object.keys(features.keyframes).length
  ) {
    if (sourceMap) {
      const rewritten = rewriteAnimationDeclarationsInStyleSourceWithMap(
        source,
        filename,
        features.keyframes,
        inputMap as RawSourceMap | undefined,
      )
      source = rewritten.code
      inputMap = rewritten.map
    } else {
      const rewritten = rewriteAnimationDeclarationsInStyleSource(
        source,
        features.keyframes,
      )
      source = rewritten.code
    }
  }

  const errors: Error[] = []
  if (preProcessedSource && preProcessedSource.errors.length) {
    errors.push(...preProcessedSource.errors)
  }

  const dependencies = new Set(
    preProcessedSource ? preProcessedSource.dependencies : [],
  )
  dependencies.delete(filename)

  try {
    const { Features, transform } = loadLightningCss(filename)
    const cssModules = modules
      ? createLightningCssModulesConfig(modulesOptions)
      : undefined

    if (scoped && features.hasNestedStyleRules) {
      const normalizedSource = normalizeNestedStyleBlocks(
        source,
        filename,
        inputMap as RawSourceMap | undefined,
        sourceMap,
      )
      source = normalizedSource.code
      inputMap = normalizedSource.map
      features = analyzeStyleLightningCSSFeatures(source, id)
    }

    let scopedSource = source
    // CSS modules rely on Lightning CSS understanding selectors such as
    // `:local(...)` and `:global(...)` directly, so the source-level scoped
    // path is only used when CSS modules are disabled.
    let selectorsScopedInSource = scoped && !modules
    if (selectorsScopedInSource) {
      try {
        if (sourceMap) {
          const scopedResult = scopeLightningCssSourceWithMap(
            source,
            filename,
            id,
            features.hasScopedSelectorSpecials,
            inputMap as RawSourceMap | undefined,
          )
          scopedSource = scopedResult.code
          inputMap = scopedResult.map
        } else {
          scopedSource = scopeLightningCssSource(
            source,
            id,
            features.hasScopedSelectorSpecials,
          )
        }
      } catch {
        selectorsScopedInSource = false
        scopedSource = source
      }
    }

    const transformOptions = extend(
      {
        filename,
        code: encodeCode(scopedSource),
        sourceMap,
        inputSourceMap: inputMap ? JSON.stringify(inputMap) : undefined,
        cssModules,
        nonStandard: {
          deepSelectorCombinator: true,
        },
        visitor: createStyleLightningCSSVisitor({
          features,
          id,
          isProd,
          scoped,
          selectorsScopedInSource,
        }),
      },
      features.hasNestedStyleRules ? { include: Features.Nesting } : null,
    )

    const result = transform(transformOptions)

    return {
      code: decodeCode(result.code),
      map: result.map ? JSON.parse(decodeCode(result.map)) : undefined,
      rawResult: undefined,
      errors,
      modules: modules
        ? normalizeLightningCssModules(result.exports, modulesOptions)
        : undefined,
      dependencies,
    }
  } catch (e: any) {
    errors.push(e)
    return {
      code: '',
      map: undefined,
      rawResult: undefined,
      errors,
      dependencies,
    }
  }
}

function assertSupportedLightningCssStyleOptions(
  options: SFCStyleCompileOptions | SFCAsyncStyleCompileOptions,
  isAsync: boolean,
): void {
  if (options.trim === false) {
    throw createUnsupportedStyleOptionError('`trim: false`')
  }

  if (options.postcssPlugins && options.postcssPlugins.length) {
    throw createUnsupportedStyleOptionError('`postcssPlugins`')
  }

  if (hasUnsupportedLightningCssPostcssOptions(options.postcssOptions)) {
    throw createUnsupportedStyleOptionError(
      '`postcssOptions` keys other than `map`',
    )
  }

  if ('modules' in options && options.modules) {
    if (!isAsync) {
      // This is a public API compatibility choice rather than an engine
      // limitation. Lightning CSS CSS-modules compilation is synchronous, but
      // `@vue/compiler-sfc` only exposes `modules` on `compileStyleAsync()`.
      throw createUnsupportedStyleOptionError(
        '`modules` without `compileStyleAsync()`',
      )
    }

    if (options.scoped) {
      throw createUnsupportedStyleOptionError(
        '`modules` combined with `scoped`',
      )
    }

    assertSupportedLightningCssModulesOptions(options.modulesOptions || {})
  }
}

function createUnsupportedStyleOptionError(option: string): Error {
  return new Error(
    `[@vue/compiler-sfc-lightningcss] ${option} is not supported by this package. ` +
      `Use @vue/compiler-sfc when you need the PostCSS-based style pipeline.`,
  )
}

function hasUnsupportedLightningCssPostcssOptions(
  postcssOptions: any,
): boolean {
  return !!(
    postcssOptions && Object.keys(postcssOptions).some(key => key !== 'map')
  )
}

function shouldGenerateLightningCssSourceMap(
  postcssOptions: any,
  inputMap?: RawSourceMap,
): boolean {
  return !!(inputMap || (postcssOptions && postcssOptions.map))
}

function assertSupportedLightningCssModulesOptions(
  options: CSSModulesOptions,
): void {
  if (
    options.scopeBehaviour !== undefined &&
    options.scopeBehaviour !== 'local'
  ) {
    throw createUnsupportedStyleOptionError(
      '`modulesOptions.scopeBehaviour` other than `"local"`',
    )
  }

  if (
    options.generateScopedName !== undefined &&
    typeof options.generateScopedName !== 'string'
  ) {
    throw createUnsupportedStyleOptionError(
      '`modulesOptions.generateScopedName` as a function',
    )
  }

  if (
    typeof options.generateScopedName === 'string' &&
    hasUnsupportedLightningCssModulePattern(options.generateScopedName)
  ) {
    throw createUnsupportedStyleOptionError(
      '`modulesOptions.generateScopedName` placeholders other than `[name]`, `[local]`, and `[hash]`',
    )
  }

  if (options.hashPrefix !== undefined) {
    throw createUnsupportedStyleOptionError('`modulesOptions.hashPrefix`')
  }

  if (options.exportGlobals) {
    throw createUnsupportedStyleOptionError('`modulesOptions.exportGlobals`')
  }

  if (options.globalModulePaths && options.globalModulePaths.length) {
    throw createUnsupportedStyleOptionError(
      '`modulesOptions.globalModulePaths`',
    )
  }
}

function hasUnsupportedLightningCssModulePattern(pattern: string): boolean {
  const placeholders = pattern.match(/\[[^\]]+\]/g)
  return !!(
    placeholders &&
    placeholders.some(
      placeholder =>
        placeholder !== '[name]' &&
        placeholder !== '[local]' &&
        placeholder !== '[hash]',
    )
  )
}

function createLightningCssModulesConfig(
  options: CSSModulesOptions,
): CSSModulesConfig {
  const { generateScopedName } = options
  return typeof generateScopedName === 'string'
    ? { pattern: generateScopedName }
    : {}
}

function normalizeLightningCssModules(
  exports: CSSModuleExports | undefined,
  options: CSSModulesOptions,
): Record<string, string> | undefined {
  if (!exports) {
    return undefined
  }

  const localsConvention = options.localsConvention
  const modules: Record<string, string> = {}
  const exportsByCompiledName = new Map(
    Object.values(exports).map(value => [value.name, value] as const),
  )

  for (const [originalName, value] of Object.entries(exports)) {
    appendCssModuleExport(
      modules,
      originalName,
      collectCssModuleExportNames(value, exportsByCompiledName).join(' '),
      localsConvention,
    )
  }

  return modules
}

function appendCssModuleExport(
  modules: Record<string, string>,
  originalName: string,
  localName: string,
  localsConvention: CSSModulesOptions['localsConvention'],
): void {
  switch (localsConvention) {
    case 'camelCase':
      modules[originalName] = localName
      modules[camelize(originalName)] = localName
      return
    case 'camelCaseOnly':
      modules[camelize(originalName)] = localName
      return
    case 'dashes':
      modules[originalName] = localName
      if (originalName.includes('-')) {
        modules[camelize(originalName)] = localName
      }
      return
    case 'dashesOnly':
      if (originalName.includes('-')) {
        modules[camelize(originalName)] = localName
      } else {
        modules[originalName] = localName
      }
      return
    default:
      modules[originalName] = localName
  }
}

function collectCssModuleExportNames(
  value: CSSModuleExports[string],
  exportsByCompiledName: ReadonlyMap<string, CSSModuleExports[string]>,
  visited = new Set<string>(),
): string[] {
  if (visited.has(value.name)) {
    return []
  }

  visited.add(value.name)

  const names = [value.name]

  for (const reference of value.composes) {
    if (reference.type === 'global') {
      if (!names.includes(reference.name)) {
        names.push(reference.name)
      }
      continue
    }

    if (reference.type === 'dependency') {
      throw createUnsupportedStyleOptionError(
        '`modules` with `composes: ... from ...` dependency references',
      )
    }

    if (reference.type === 'local') {
      const composedExport = exportsByCompiledName.get(reference.name)
      const composedNames = composedExport
        ? collectCssModuleExportNames(
            composedExport,
            exportsByCompiledName,
            visited,
          )
        : [reference.name]

      for (const composedName of composedNames) {
        if (!names.includes(composedName)) {
          names.push(composedName)
        }
      }
    }
  }

  return names
}

function preprocess(
  options: SFCStyleCompileOptions,
  preprocessor: StylePreprocessor,
  sourceMap: boolean,
): StylePreprocessorResults {
  if ((__ESM_BROWSER__ || __GLOBAL__) && !options.preprocessCustomRequire) {
    throw new Error(
      `[@vue/compiler-sfc-lightningcss] Style preprocessing in the browser build must ` +
        `provide the \`preprocessCustomRequire\` option to return the in-browser ` +
        `version of the preprocessor.`,
    )
  }

  return preprocessor(
    options.source,
    options.inMap || options.map,
    extend(
      {
        enableSourcemap: sourceMap,
        filename: options.filename,
      },
      options.preprocessOptions || null,
    ),
    options.preprocessCustomRequire,
  )
}

let _lightningcss:
  | {
      Features: { Nesting: number }
      transform: (options: any) => any
    }
  | undefined

function loadLightningCss(filename: string) {
  if (_lightningcss) {
    return _lightningcss
  }

  try {
    return (_lightningcss = createCompilerRequire(filename)('lightningcss'))
  } catch (err: any) {
    const message = err && typeof err.message === 'string' ? err.message : ''
    if (message && message.includes('Cannot find module')) {
      throw new Error(
        '[@vue/compiler-sfc-lightningcss] `compileStyle` requires the optional peer dependency `lightningcss` to be installed. Install it in the consuming project, for example with `pnpm add -D lightningcss`.',
      )
    }
    throw err
  }
}

function encodeCode(code: string) {
  return new TextEncoder().encode(code)
}

function decodeCode(code: Uint8Array) {
  return new TextDecoder().decode(code)
}
