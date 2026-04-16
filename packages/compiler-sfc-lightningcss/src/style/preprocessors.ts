import merge from 'merge-source-map'
import type { RawSourceMap } from '@vue/compiler-core'
import type { SFCStyleCompileOptions } from '../compileStyle'
import { extend, isFunction } from '@vue/shared'

export type StylePreprocessor = (
  source: string,
  map: RawSourceMap | undefined,
  options: {
    [key: string]: any
    additionalData?: string | ((source: string, filename: string) => string)
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

const defaultPreprocessRequire: NonNullable<
  SFCStyleCompileOptions['preprocessCustomRequire']
> = id => {
  // eslint-disable-next-line no-restricted-globals
  return require(id)
}

// .scss/.sass processor
const scss: StylePreprocessor = (
  source,
  map,
  options,
  load = defaultPreprocessRequire,
) => {
  const nodeSass = load('sass') as {
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

  const data = getSource(source, options.filename, options.additionalData)
  let css: string
  let dependencies: string[]
  let sourceMap: any

  try {
    if (compileString) {
      const { pathToFileURL, fileURLToPath } = load('url') as {
        fileURLToPath: (url: string | URL) => string
        pathToFileURL: (path: string) => URL
      }

      const result = compileString(
        data,
        extend({}, options, {
          url: pathToFileURL(options.filename),
          sourceMap: !!map,
        }),
      )
      css = result.css
      dependencies = result.loadedUrls.map(url => fileURLToPath(url))
      sourceMap = map ? result.sourceMap! : undefined
    } else {
      const result = renderSync(
        extend({}, options, {
          data,
          file: options.filename,
          outFile: options.filename,
          sourceMap: !!map,
        }),
      )
      css = result.css.toString()
      dependencies = result.stats.includedFiles
      sourceMap = map ? JSON.parse(result.map!.toString()) : undefined
    }

    if (map) {
      return {
        code: css,
        errors: [],
        dependencies,
        map: merge(map, sourceMap!),
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
const less: StylePreprocessor = (
  source,
  map,
  options,
  load = defaultPreprocessRequire,
) => {
  const nodeLess = load('less')

  let result: any
  let error: Error | null = null
  nodeLess.render(
    getSource(source, options.filename, options.additionalData),
    extend({}, options, { syncImport: true }),
    (err: Error | null, output: any) => {
      error = err
      result = output
    },
  )

  if (error) return { code: '', errors: [error], dependencies: [] }
  const dependencies = result.imports
  if (map) {
    return {
      code: result.css.toString(),
      map: merge(map, result.map),
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
const styl: StylePreprocessor = (
  source,
  map,
  options,
  load = defaultPreprocessRequire,
) => {
  const nodeStylus = load('stylus')
  try {
    const ref = nodeStylus(source, options)
    if (map) ref.set('sourcemap', { inline: false, comment: false })

    const result = ref.render()
    const dependencies = ref.deps()
    if (map) {
      return {
        code: result,
        map: merge(map, ref.sourcemap),
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

export type PreprocessLang = 'less' | 'sass' | 'scss' | 'styl' | 'stylus'

export const processors: Record<PreprocessLang, StylePreprocessor> = {
  less,
  sass,
  scss,
  styl,
  stylus: styl,
}
