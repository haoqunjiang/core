import type {
  SFCAsyncStyleCompileOptions,
  SFCStyleCompileOptions,
  SFCStyleCompileResults,
} from '@vue/compiler-sfc'
import type { RawSourceMap } from '@vue/compiler-core'
import type { CSSModuleExports, CSSModulesConfig } from 'lightningcss'
import { camelize, extend } from '@vue/shared'
import {
  type StylePreprocessor,
  type StylePreprocessorResults,
  processors,
} from './style/preprocessors'
import { createStyleLightningCSSVisitor } from './style/lightningcss'
import { analyzeStyleLightningCSSFeatures } from './style/lightningcss/features'
import { normalizeNestedStyleBlocks } from './style/lightningcss/nesting'
import { scopeLightningCssSource } from './style/lightningcss/sourceScope'

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
  const preprocessor = preprocessLang && processors[preprocessLang]
  const preProcessedSource = preprocessor && preprocess(options, preprocessor)
  let inputMap = preProcessedSource
    ? preProcessedSource.map
    : options.inMap || options.map
  let source = preProcessedSource ? preProcessedSource.code : options.source
  let features = analyzeStyleLightningCSSFeatures(source, id)
  const sourceMap = shouldGenerateLightningCssSourceMap(
    postcssOptions,
    inputMap as RawSourceMap | undefined,
  )

  const errors: Error[] = []
  if (preProcessedSource && preProcessedSource.errors.length) {
    errors.push(...preProcessedSource.errors)
  }

  const dependencies = new Set(
    preProcessedSource ? preProcessedSource.dependencies : [],
  )
  dependencies.delete(filename)

  try {
    const { Features, transform } = loadLightningCss()
    const cssModules = modules
      ? createLightningCssModulesConfig(filename, modulesOptions)
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
    // fast path is only used when CSS modules are disabled.
    let selectorsScopedInSource = scoped && !sourceMap && !modules
    if (selectorsScopedInSource) {
      try {
        scopedSource = scopeLightningCssSource(
          source,
          id,
          features.hasScopedSelectorSpecials,
        )
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
  filename: string,
  options: CSSModulesOptions,
): CSSModulesConfig {
  return {
    pattern:
      typeof options.generateScopedName === 'string'
        ? options.generateScopedName
        : getDefaultLightningCssModulesPattern(filename),
  }
}

function getDefaultLightningCssModulesPattern(filename: string): string {
  const extensionIndex = filename.lastIndexOf('.')
  const basename =
    extensionIndex >= 0 ? filename.slice(0, extensionIndex) : filename
  return basename.endsWith('.module') ? '[hash]_[local]' : '[hash]_[local]'
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

  for (const [originalName, value] of Object.entries(exports)) {
    appendCssModuleExport(modules, originalName, value.name, localsConvention)
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

function preprocess(
  options: SFCStyleCompileOptions,
  preprocessor: StylePreprocessor,
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

function loadLightningCss() {
  if (_lightningcss) {
    return _lightningcss
  }

  try {
    // eslint-disable-next-line no-restricted-globals
    return (_lightningcss = require('lightningcss'))
  } catch (err: any) {
    const message = err && typeof err.message === 'string' ? err.message : ''
    if (message && message.includes('Cannot find module')) {
      throw new Error(
        '[@vue/compiler-sfc-lightningcss] `compileStyle` requires the peer dependency `lightningcss` to be installed.',
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
