import postcss, {
  type LazyResult,
  type Message,
  type ProcessOptions,
  type Result,
  type SourceMap,
} from 'postcss'
import trimPlugin from './style/pluginTrim'
import scopedPlugin from './style/pluginScoped'
import {
  type PreprocessLang,
  type StylePreprocessor,
  type StylePreprocessorResults,
  processors,
} from './style/preprocessors'
import type { RawSourceMap } from '@vue/compiler-core'
import { warn } from './warn'
import { cssVarsPlugin } from './style/cssVars'
import { createStyleLightningCSSVisitor } from './style/lightningcss'
import { analyzeStyleLightningCSSFeatures } from './style/lightningcss/features'
import { markImplicitNestedSelectors } from './style/lightningcss/nesting'
import { scopeLightningCssSource } from './style/lightningcss/sourceScope'
import postcssModules from 'postcss-modules'

export interface SFCStyleCompileOptions {
  source: string
  filename: string
  id: string
  scoped?: boolean
  trim?: boolean
  isProd?: boolean
  inMap?: RawSourceMap
  preprocessLang?: PreprocessLang
  preprocessOptions?: any
  preprocessCustomRequire?: (id: string) => any
  postcssOptions?: any
  postcssPlugins?: any[]
  /**
   * @deprecated use `inMap` instead.
   */
  map?: RawSourceMap
}

/**
 * Aligns with postcss-modules
 * https://github.com/css-modules/postcss-modules
 */
export interface CSSModulesOptions {
  scopeBehaviour?: 'global' | 'local'
  generateScopedName?:
    | string
    | ((name: string, filename: string, css: string) => string)
  hashPrefix?: string
  localsConvention?: 'camelCase' | 'camelCaseOnly' | 'dashes' | 'dashesOnly'
  exportGlobals?: boolean
  globalModulePaths?: RegExp[]
}

export interface SFCAsyncStyleCompileOptions extends SFCStyleCompileOptions {
  isAsync?: boolean
  // css modules support, note this requires async so that we can get the
  // resulting json
  modules?: boolean
  modulesOptions?: CSSModulesOptions
}

export interface SFCStyleCompileResults {
  code: string
  map: RawSourceMap | undefined
  rawResult: Result | LazyResult | undefined
  errors: Error[]
  modules?: Record<string, string>
  dependencies: Set<string>
}

export function compileStyle(
  options: SFCStyleCompileOptions,
): SFCStyleCompileResults {
  return doCompileStyle({
    ...options,
    isAsync: false,
  }) as SFCStyleCompileResults
}

export function compileStyleWithLightningCss(
  options: SFCStyleCompileOptions,
): SFCStyleCompileResults {
  return compileStyleWithLightningCssImpl(options)
}

function compileStyleWithLightningCssImpl(
  options: SFCStyleCompileOptions,
): SFCStyleCompileResults {
  if (__GLOBAL__ || __ESM_BROWSER__) {
    throw new Error(
      '[@vue/compiler-sfc] `compileStyleWithLightningCss` is not supported in the browser build.',
    )
  }

  const {
    filename,
    id,
    scoped = false,
    isProd = false,
    preprocessLang,
    postcssOptions,
    postcssPlugins,
  } = options
  const preprocessor = preprocessLang && processors[preprocessLang]
  const preProcessedSource = preprocessor && preprocess(options, preprocessor)
  let map = preProcessedSource
    ? preProcessedSource.map
    : options.inMap || options.map
  let source = normalizeLightningCssSource(
    preProcessedSource ? preProcessedSource.code : options.source,
  )
  let features = analyzeStyleLightningCSSFeatures(source, id)

  const errors: Error[] = []
  if (preProcessedSource && preProcessedSource.errors.length) {
    errors.push(...preProcessedSource.errors)
  }

  const dependencies = new Set(
    preProcessedSource ? preProcessedSource.dependencies : [],
  )
  dependencies.delete(filename)

  if (
    (postcssPlugins && postcssPlugins.length) ||
    (postcssOptions && Object.keys(postcssOptions).length)
  ) {
    return {
      code: '',
      map: undefined,
      rawResult: undefined,
      errors: [
        ...errors,
        new Error(
          '[@vue/compiler-sfc] `compileStyleWithLightningCss` does not support `postcssOptions` or `postcssPlugins`. Use `compileStyle()` when PostCSS transforms are required.',
        ),
      ],
      dependencies,
    }
  }

  try {
    const { Features, transform } = loadLightningCss()

    // Phase 1: preserve selector intent that would otherwise be lost by native
    // nesting lowering, then let Lightning CSS flatten nesting.
    //
    // This is the main place where the Lightning CSS path differs from the
    // PostCSS scoped plugin. PostCSS runs the scoped transform directly on the
    // original nested rule tree, so nested selectors are still structurally
    // visible when scoping runs. Our Lightning CSS fast path lowers nesting
    // before source-level selector scoping, so we must preserve the implicit
    // relative nesting boundary first or later scope injection would lose where
    // it is supposed to restart.
    if (scoped && features.hasNestedStyleRules) {
      const markedSource = markImplicitNestedSelectors(
        source,
        filename,
        map as RawSourceMap | undefined,
      )
      source = markedSource.code
      map = markedSource.map

      const nestingResult = transform({
        filename,
        code: encodeCode(source),
        sourceMap: !!map,
        inputSourceMap: map ? JSON.stringify(map) : undefined,
        include: Features.Nesting,
        nonStandard: {
          deepSelectorCombinator: true,
        },
      })

      source = decodeCode(nestingResult.code)
      map = nestingResult.map
        ? JSON.parse(decodeCode(nestingResult.map))
        : undefined
      features = analyzeStyleLightningCSSFeatures(source, id)
    }

    // Phase 2: scope selectors directly in source when sourcemaps are not in
    // play. If this fast path cannot explain a selector, we fall back to the
    // Selector visitor in the final transform.
    let scopedSource = source
    let selectorsScopedInSource = scoped && !map
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

    // Phase 3: run Lightning CSS once for the final serialization and any
    // remaining AST-based rewrites.
    const result = transform({
      filename,
      code: encodeCode(scopedSource),
      sourceMap: !!map,
      inputSourceMap: map ? JSON.stringify(map) : undefined,
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
    })

    return {
      code: decodeCode(result.code),
      map: result.map ? JSON.parse(decodeCode(result.map)) : undefined,
      rawResult: undefined,
      errors,
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

export function compileStyleAsync(
  options: SFCAsyncStyleCompileOptions,
): Promise<SFCStyleCompileResults> {
  return doCompileStyle({
    ...options,
    isAsync: true,
  }) as Promise<SFCStyleCompileResults>
}

export function doCompileStyle(
  options: SFCAsyncStyleCompileOptions,
): SFCStyleCompileResults | Promise<SFCStyleCompileResults> {
  const {
    filename,
    id,
    scoped = false,
    trim = true,
    isProd = false,
    modules = false,
    modulesOptions = {},
    preprocessLang,
    postcssOptions,
    postcssPlugins,
  } = options
  const preprocessor = preprocessLang && processors[preprocessLang]
  const preProcessedSource = preprocessor && preprocess(options, preprocessor)
  const map = preProcessedSource
    ? preProcessedSource.map
    : options.inMap || options.map
  const source = preProcessedSource ? preProcessedSource.code : options.source

  const shortId = id.replace(/^data-v-/, '')
  const longId = `data-v-${shortId}`

  const plugins = (postcssPlugins || []).slice()
  plugins.unshift(cssVarsPlugin({ id: shortId, isProd }))
  if (trim) {
    plugins.push(trimPlugin())
  }
  if (scoped) {
    plugins.push(scopedPlugin(longId))
  }
  let cssModules: Record<string, string> | undefined
  if (modules) {
    if (__GLOBAL__ || __ESM_BROWSER__) {
      throw new Error(
        '[@vue/compiler-sfc] `modules` option is not supported in the browser build.',
      )
    }
    if (!options.isAsync) {
      throw new Error(
        '[@vue/compiler-sfc] `modules` option can only be used with compileStyleAsync().',
      )
    }
    plugins.push(
      postcssModules({
        ...modulesOptions,
        getJSON: (_cssFileName: string, json: Record<string, string>) => {
          cssModules = json
        },
      }),
    )
  }

  const postCSSOptions: ProcessOptions = {
    ...postcssOptions,
    to: filename,
    from: filename,
  }
  if (map) {
    postCSSOptions.map = {
      inline: false,
      annotation: false,
      prev: map,
    }
  }

  let result: LazyResult | undefined
  let code: string | undefined
  let outMap: SourceMap | undefined
  // stylus output include plain css. so need remove the repeat item
  const dependencies = new Set(
    preProcessedSource ? preProcessedSource.dependencies : [],
  )
  // sass has filename self when provided filename option
  dependencies.delete(filename)

  const errors: Error[] = []
  if (preProcessedSource && preProcessedSource.errors.length) {
    errors.push(...preProcessedSource.errors)
  }

  const recordPlainCssDependencies = (messages: Message[]) => {
    messages.forEach(msg => {
      if (msg.type === 'dependency') {
        // postcss output path is absolute position path
        dependencies.add(msg.file)
      }
    })
    return dependencies
  }

  try {
    result = postcss(plugins).process(source, postCSSOptions)

    // In async mode, return a promise.
    if (options.isAsync) {
      return result
        .then(result => ({
          code: result.css || '',
          map: result.map && result.map.toJSON(),
          errors,
          modules: cssModules,
          rawResult: result,
          dependencies: recordPlainCssDependencies(result.messages),
        }))
        .catch(error => ({
          code: '',
          map: undefined,
          errors: [...errors, error],
          rawResult: undefined,
          dependencies,
        }))
    }

    recordPlainCssDependencies(result.messages)
    // force synchronous transform (we know we only have sync plugins)
    code = result.css
    outMap = result.map
  } catch (e: any) {
    errors.push(e)
  }

  return {
    code: code || ``,
    map: outMap && outMap.toJSON(),
    errors,
    rawResult: result,
    dependencies,
  }
}

function preprocess(
  options: SFCStyleCompileOptions,
  preprocessor: StylePreprocessor,
): StylePreprocessorResults {
  if ((__ESM_BROWSER__ || __GLOBAL__) && !options.preprocessCustomRequire) {
    throw new Error(
      `[@vue/compiler-sfc] Style preprocessing in the browser build must ` +
        `provide the \`preprocessCustomRequire\` option to return the in-browser ` +
        `version of the preprocessor.`,
    )
  }

  return preprocessor(
    options.source,
    options.inMap || options.map,
    {
      filename: options.filename,
      ...options.preprocessOptions,
    },
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
    return (_lightningcss = require('lightningcss'))
  } catch (err: any) {
    if (
      typeof err?.message === 'string' &&
      err.message.includes('Cannot find module')
    ) {
      throw new Error(
        '[@vue/compiler-sfc] `compileStyleWithLightningCss` requires the optional peer dependency `lightningcss` to be installed.',
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

function normalizeLightningCssSource(source: string) {
  return source.replace(
    /(^|,)(\s*)(>>>|\/deep\/)(\s*)([^,{][^,{]*)/gm,
    (
      _,
      prefix: string,
      leading: string,
      combinator: string,
      _space,
      inner: string,
    ) => {
      if (combinator === '>>>' || combinator === '/deep/') {
        warn(
          `the >>> and /deep/ combinators have been deprecated. ` +
            `Use :deep() instead.`,
        )
      }
      return `${prefix}${leading}:deep(${inner.trim()})`
    },
  )
}
