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
import { analyzeLightningCssStyle } from './style/lightningcss/analysis'
import { normalizeNestedStyleBlocks } from './style/lightningcss/nesting/normalize'
import {
  rewriteNormalizedAnimationDeclarations,
  rewriteNormalizedAnimationDeclarationsWithMap,
} from './style/lightningcss/scoped/animation'
import {
  scopeLightningCssSource,
  scopeLightningCssSourceWithMap,
} from './style/lightningcss/scoped/source'
import { findLegacyVueScopedSyntaxError } from './style/lightningcss/scoped/legacy'
import { createLightningCssStyleVisitor } from './style/lightningcss/visitor'

export type {
  SFCAsyncStyleCompileOptions,
  SFCStyleCompileOptions,
  SFCStyleCompileResults,
} from '@vue/compiler-sfc'

type CSSModulesOptions = NonNullable<
  SFCAsyncStyleCompileOptions['modulesOptions']
>

interface StyleCompileContext {
  filename: string
  id: string
  isProd: boolean
  modules: boolean
  modulesOptions: CSSModulesOptions
  scoped: boolean
  shortId: string
  sourceMap: boolean
}

interface StyleCompileState {
  analysis: ReturnType<typeof analyzeLightningCssStyle>
  dependencies: Set<string>
  errors: Error[]
  inputMap: RawSourceMap | undefined
  source: string
}

interface SourceScopingResult {
  scopedSource: string
  selectorsScopedInSource: boolean
}

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

  const context = createStyleCompileContext(options)
  const state = createStyleCompileState(options, context)
  const legacyScopedSyntaxError =
    context.scoped && findLegacyVueScopedSyntaxError(state.source)
  if (legacyScopedSyntaxError) {
    state.errors.push(legacyScopedSyntaxError)
    return finalizeStyleCompileFailure(state)
  }

  rewriteCssVarsInState(state, context)
  normalizeNestedStylesInState(state, context)

  try {
    const lightningcss = loadLightningCss(context.filename)
    const sourceScoping = computeScopedSource(state, context)
    const transformOptions = createLightningCssTransformOptions(
      lightningcss,
      state,
      context,
      sourceScoping,
    )
    const result = lightningcss.transform(transformOptions)
    return finalizeStyleCompileSuccess(result, state, context)
  } catch (e: any) {
    state.errors.push(e)
    return finalizeStyleCompileFailure(state)
  }
}

function createStyleCompileContext(
  options: SFCStyleCompileOptions | SFCAsyncStyleCompileOptions,
): StyleCompileContext {
  const initialInputMap = options.inMap || options.map

  return {
    filename: options.filename,
    id: options.id,
    isProd: options.isProd ?? false,
    modules: !!('modules' in options && options.modules),
    modulesOptions:
      'modulesOptions' in options ? options.modulesOptions || {} : {},
    scoped: options.scoped ?? false,
    shortId: options.id.replace(/^data-v-/, ''),
    sourceMap: shouldGenerateLightningCssSourceMap(
      options.postcssOptions,
      initialInputMap as RawSourceMap | undefined,
    ),
  }
}

function createStyleCompileState(
  options: SFCStyleCompileOptions | SFCAsyncStyleCompileOptions,
  context: StyleCompileContext,
): StyleCompileState {
  const initialInputMap = options.inMap || options.map
  const preprocessor =
    options.preprocessLang && processors[options.preprocessLang]
  const preProcessedSource =
    preprocessor && preprocess(options, preprocessor, context.sourceMap)
  const source = preProcessedSource ? preProcessedSource.code : options.source

  const dependencies = new Set(
    preProcessedSource ? preProcessedSource.dependencies : [],
  )
  dependencies.delete(context.filename)

  return {
    analysis: analyzeLightningCssStyle(source, context.id),
    dependencies,
    errors: preProcessedSource ? [...preProcessedSource.errors] : [],
    inputMap: (preProcessedSource
      ? preProcessedSource.map
      : initialInputMap) as RawSourceMap | undefined,
    source,
  }
}

function refreshStyleAnalysis(
  state: StyleCompileState,
  context: StyleCompileContext,
): void {
  state.analysis = analyzeLightningCssStyle(state.source, context.id)
}

function rewriteCssVarsInState(
  state: StyleCompileState,
  context: StyleCompileContext,
): void {
  if (!hasCssVarsBinding(state.source)) {
    return
  }

  if (context.sourceMap) {
    const rewritten = rewriteCssVarsInStyleSourceWithMap(
      state.source,
      context.filename,
      context.shortId,
      context.isProd,
      state.inputMap,
    )
    state.source = rewritten.code
    state.inputMap = rewritten.map
  } else {
    state.source = rewriteCssVarsInStyleSource(
      state.source,
      context.shortId,
      context.isProd,
    )
  }

  refreshStyleAnalysis(state, context)
}

function normalizeNestedStylesInState(
  state: StyleCompileState,
  context: StyleCompileContext,
): void {
  if (!context.scoped || !state.analysis.hasNestedStyleRules) {
    return
  }

  const normalizedSource = normalizeNestedStyleBlocks(
    state.source,
    context.filename,
    state.inputMap,
    context.sourceMap,
  )

  if (!normalizedSource.normalized) {
    return
  }

  state.source = normalizedSource.code
  state.inputMap = normalizedSource.map
  refreshStyleAnalysis(state, context)
}

function computeScopedSource(
  state: StyleCompileState,
  context: StyleCompileContext,
): SourceScopingResult {
  // CSS modules rely on Lightning CSS understanding selectors such as
  // `:local(...)` and `:global(...)` directly, so the source-level scoped path
  // is only used when CSS modules are disabled.
  let selectorsScopedInSource = context.scoped && !context.modules
  if (!selectorsScopedInSource) {
    return {
      scopedSource: state.source,
      selectorsScopedInSource,
    }
  }

  try {
    if (context.sourceMap) {
      const scopedResult = scopeLightningCssSourceWithMap(
        state.source,
        context.filename,
        context.id,
        state.analysis.hasScopedSelectorSpecials,
        state.inputMap,
      )
      state.inputMap = scopedResult.map
      return {
        scopedSource: scopedResult.code,
        selectorsScopedInSource,
      }
    }

    return {
      scopedSource: scopeLightningCssSource(
        state.source,
        context.id,
        state.analysis.hasScopedSelectorSpecials,
      ),
      selectorsScopedInSource,
    }
  } catch {
    selectorsScopedInSource = false
    return {
      scopedSource: state.source,
      selectorsScopedInSource,
    }
  }
}

function createLightningCssTransformOptions(
  lightningcss: {
    Features: { Nesting: number }
    transform: (options: any) => any
  },
  state: StyleCompileState,
  context: StyleCompileContext,
  sourceScoping: SourceScopingResult,
) {
  const cssModules = context.modules
    ? createLightningCssModulesConfig(context.modulesOptions)
    : undefined

  return extend(
    {
      filename: context.filename,
      code: encodeCode(sourceScoping.scopedSource),
      sourceMap: context.sourceMap,
      inputSourceMap: state.inputMap
        ? JSON.stringify(state.inputMap)
        : undefined,
      cssModules,
      nonStandard: {
        deepSelectorCombinator: true,
      },
      visitor: createLightningCssStyleVisitor({
        analysis: state.analysis,
        id: context.id,
        isProd: context.isProd,
        scoped: context.scoped,
        selectorsScopedInSource: sourceScoping.selectorsScopedInSource,
      }),
    },
    state.analysis.hasNestedStyleRules
      ? { include: lightningcss.Features.Nesting }
      : null,
  )
}

function finalizeStyleCompileSuccess(
  result: any,
  state: StyleCompileState,
  context: StyleCompileContext,
): SFCStyleCompileResults {
  const postTransform = rewriteAnimationDeclarationsIfNeeded(
    decodeCode(result.code),
    result.map ? JSON.parse(decodeCode(result.map)) : undefined,
    state.analysis,
    context,
  )

  return {
    code: postTransform.code,
    map: postTransform.map,
    rawResult: undefined,
    errors: state.errors,
    modules: context.modules
      ? normalizeLightningCssModules(result.exports, context.modulesOptions)
      : undefined,
    dependencies: state.dependencies,
  }
}

function rewriteAnimationDeclarationsIfNeeded(
  code: string,
  map: RawSourceMap | undefined,
  analysis: ReturnType<typeof analyzeLightningCssStyle>,
  context: StyleCompileContext,
): { code: string; map: RawSourceMap | undefined } {
  if (
    !context.scoped ||
    !analysis.hasAnimationDeclarations ||
    !Object.keys(analysis.keyframes).length
  ) {
    return {
      code,
      map,
    }
  }

  if (context.sourceMap) {
    return rewriteNormalizedAnimationDeclarationsWithMap(
      code,
      context.filename,
      analysis.keyframes,
      map,
    )
  }

  return {
    code: rewriteNormalizedAnimationDeclarations(code, analysis.keyframes).code,
    map,
  }
}

function finalizeStyleCompileFailure(
  state: StyleCompileState,
): SFCStyleCompileResults {
  return {
    code: '',
    map: undefined,
    rawResult: undefined,
    errors: state.errors,
    dependencies: state.dependencies,
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
