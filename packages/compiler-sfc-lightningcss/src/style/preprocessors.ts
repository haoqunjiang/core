import merge from 'merge-source-map'
import type { RawSourceMap } from '@vue/compiler-core'
import type { SFCStyleCompileOptions } from '../compileStyle'
import { extend, isFunction } from '@vue/shared'
import { createCompilerRequire } from '../nodeRequire'

export type StylePreprocessor = (
  source: string,
  map: RawSourceMap | undefined,
  options: {
    [key: string]: any
    additionalData?: string | ((source: string, filename: string) => string)
    enableSourcemap?: boolean
    filename: string
  },
  customRequire: SFCStyleCompileOptions['preprocessCustomRequire'],
) => StylePreprocessorResults

export interface StylePreprocessorResults {
  code: string
  map?: object
  errors: Error[]
  dependencies: string[]
}

// .scss/.sass processor
const scss: StylePreprocessor = (source, map, options, load) => {
  const additionalData = options.additionalData
  const enableSourcemap = options.enableSourcemap
  const filename = options.filename
  const preprocessOptions = stripInternalPreprocessorOptions(options)
  const requireFromStyle = load || createCompilerRequire(options.filename)
  const nodeSass = requireFromStyle('sass') as {
    compileString?: (
      source: string,
      options: any,
    ) => {
      css: string
      loadedUrls: Array<string | URL>
      sourceMap?: any
    }
    renderSync: (options: any) => {
      css: Buffer
      map?: Buffer
      stats: {
        includedFiles: string[]
      }
    }
  }
  const { compileString, renderSync } = nodeSass

  const requestSourceMap = !!map || !!enableSourcemap
  const data = getSource(source, filename, additionalData)
  let css: string
  let dependencies: string[]
  let sourceMap: any

  try {
    if (compileString) {
      const { pathToFileURL, fileURLToPath } = requireFromStyle('node:url') as {
        fileURLToPath: (url: string | URL) => string
        pathToFileURL: (path: string) => URL
      }

      const result = compileString(
        data,
        extend({}, preprocessOptions, {
          url: pathToFileURL(filename),
          sourceMap: requestSourceMap,
        }),
      )
      css = result.css
      dependencies = result.loadedUrls.map(url => fileURLToPath(url))
      sourceMap = requestSourceMap ? result.sourceMap! : undefined
    } else {
      const result = renderSync(
        extend({}, preprocessOptions, {
          data,
          file: filename,
          outFile: filename,
          sourceMap: requestSourceMap,
        }),
      )
      css = result.css.toString()
      dependencies = result.stats.includedFiles
      sourceMap = requestSourceMap
        ? JSON.parse(result.map!.toString())
        : undefined
    }

    if (requestSourceMap) {
      return {
        code: css,
        errors: [],
        dependencies,
        map: map ? merge(map, sourceMap!) : sourceMap,
      }
    }
    return { code: css, errors: [], dependencies }
  } catch (e: any) {
    return { code: '', errors: [e], dependencies: [] }
  }
}

const sass: StylePreprocessor = (source, map, options, load) =>
  scss(
    source,
    map,
    extend({}, options, {
      indentedSyntax: true,
    }),
    load,
  )

// .less
const less: StylePreprocessor = (source, map, options, load) => {
  const additionalData = options.additionalData
  const enableSourcemap = options.enableSourcemap
  const filename = options.filename
  const preprocessOptions = stripInternalPreprocessorOptions(options)
  const requireFromStyle = load || createCompilerRequire(options.filename)
  const nodeLess = requireFromStyle('less')
  const requestSourceMap = !!map || !!enableSourcemap

  let result: any
  let error: Error | null = null
  nodeLess.render(
    getSource(source, filename, additionalData),
    extend({}, preprocessOptions, {
      syncImport: true,
      sourceMap: requestSourceMap ? {} : undefined,
    }),
    (err: Error | null, output: any) => {
      error = err
      result = output
    },
  )

  if (error) return { code: '', errors: [error], dependencies: [] }
  const dependencies = result.imports
  if (requestSourceMap) {
    const sourceMap =
      typeof result.map === 'string' ? JSON.parse(result.map) : result.map
    return {
      code: result.css.toString(),
      map: map ? merge(map, sourceMap) : sourceMap,
      errors: [],
      dependencies: dependencies,
    }
  }

  return {
    code: result.css.toString(),
    errors: [],
    dependencies: dependencies,
  }
}

// .styl
const styl: StylePreprocessor = (source, map, options, load) => {
  const enableSourcemap = options.enableSourcemap
  const preprocessOptions = stripInternalPreprocessorOptions(options)
  const requireFromStyle = load || createCompilerRequire(options.filename)
  const nodeStylus = requireFromStyle('stylus')
  const requestSourceMap = !!map || !!enableSourcemap
  try {
    const ref = nodeStylus(source, preprocessOptions)
    if (requestSourceMap)
      ref.set('sourcemap', { inline: false, comment: false })

    const result = ref.render()
    const dependencies = ref.deps()
    if (requestSourceMap) {
      return {
        code: result,
        map: map ? merge(map, ref.sourcemap) : ref.sourcemap,
        errors: [],
        dependencies,
      }
    }

    return { code: result, errors: [], dependencies }
  } catch (e: any) {
    return { code: '', errors: [e], dependencies: [] }
  }
}

function getSource(
  source: string,
  filename: string,
  additionalData?: string | ((source: string, filename: string) => string),
) {
  if (!additionalData) return source
  if (isFunction(additionalData)) {
    return additionalData(source, filename)
  }
  return additionalData + source
}

function stripInternalPreprocessorOptions(options: {
  [key: string]: any
  additionalData?: string | ((source: string, filename: string) => string)
  enableSourcemap?: boolean
  filename: string
}) {
  const normalized = extend({}, options) as Record<string, any>
  delete normalized.additionalData
  delete normalized.enableSourcemap
  return normalized
}

export type PreprocessLang = 'less' | 'sass' | 'scss' | 'styl' | 'stylus'

export const processors: Record<PreprocessLang, StylePreprocessor> = {
  less,
  sass,
  scss,
  styl,
  stylus: styl,
}
