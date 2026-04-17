import { createRequire } from 'node:module'
import { resolve } from 'node:path'

export type CompilerRequire = (id: string) => any

/**
 * Create a Node-style require function rooted at the current project and style
 * filename so the package works from both CJS and ESM entry points.
 */
export function createCompilerRequire(filename: string): CompilerRequire {
  return createRequire(resolve(process.cwd(), filename || 'index.js'))
}
