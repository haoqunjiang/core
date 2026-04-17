import type { RawSourceMap } from '@vue/compiler-core'
import hash from 'hash-sum'
import { getEscapedCssVarName } from '@vue/shared'
import MagicString from 'magic-string'
import merge from 'merge-source-map'

export function genVarName(id: string, raw: string, isProd: boolean): string {
  if (isProd) {
    return hash(id + raw).replace(/^\d/, r => `v${r}`)
  }

  return `${id}-${getEscapedCssVarName(raw, false)}`
}

export function genCssVarReference(
  id: string,
  raw: string,
  isProd: boolean,
): string {
  return `var(--${genVarName(id, normalizeCssVarExpression(raw), isProd)})`
}

const cssVarCommentRE = /\/\*[\s\S]*?\*\//g
const vBindRE = /v-bind\s*\(/g

export interface RewriteCssVarsInStyleSourceResult {
  code: string
  map: RawSourceMap | undefined
}

export function hasCssVarsBinding(source: string): boolean {
  return /v-bind\s*\(/.test(maskCssVarComments(source))
}

export function rewriteCssVarsInStyleSource(
  source: string,
  id: string,
  isProd: boolean,
): string {
  const maskedSource = maskCssVarComments(source)
  vBindRE.lastIndex = 0
  let transformed = ''
  let lastIndex = 0
  let match

  while ((match = vBindRE.exec(maskedSource))) {
    const start = match.index + match[0].length
    const end = lexBinding(source, start)
    if (end == null) {
      continue
    }

    transformed +=
      source.slice(lastIndex, match.index) +
      genCssVarReference(id, source.slice(start, end), isProd)
    lastIndex = end + 1
  }

  return lastIndex === 0 ? source : transformed + source.slice(lastIndex)
}

export function rewriteCssVarsInStyleSourceWithMap(
  source: string,
  filename: string,
  id: string,
  isProd: boolean,
  map?: RawSourceMap,
): RewriteCssVarsInStyleSourceResult {
  const maskedSource = maskCssVarComments(source)
  vBindRE.lastIndex = 0
  const s = new MagicString(source)
  let changed = false
  let match

  while ((match = vBindRE.exec(maskedSource))) {
    const start = match.index + match[0].length
    const end = lexBinding(source, start)
    if (end == null) {
      continue
    }

    s.overwrite(
      match.index,
      end + 1,
      genCssVarReference(id, source.slice(start, end), isProd),
    )
    changed = true
  }

  if (!changed) {
    return {
      code: source,
      map,
    }
  }

  const nextMap = s.generateMap({
    source: filename,
    includeContent: true,
    hires: true,
  })

  return {
    code: s.toString(),
    map: map
      ? (merge(map, nextMap) as RawSourceMap)
      : (JSON.parse(nextMap.toString()) as RawSourceMap),
  }
}

function normalizeCssVarExpression(exp: string): string {
  exp = exp.trim()
  if (
    (exp[0] === `'` && exp[exp.length - 1] === `'`) ||
    (exp[0] === `"` && exp[exp.length - 1] === `"`)
  ) {
    return exp.slice(1, -1)
  }
  return exp
}

function maskCssVarComments(source: string): string {
  return source.replace(cssVarCommentRE, comment => ' '.repeat(comment.length))
}

enum LexerState {
  inParens,
  inSingleQuoteString,
  inDoubleQuoteString,
}

function lexBinding(content: string, start: number): number | null {
  let state: LexerState = LexerState.inParens
  let parenDepth = 0

  for (let index = start; index < content.length; index++) {
    const char = content.charAt(index)
    switch (state) {
      case LexerState.inParens:
        if (char === `'`) {
          state = LexerState.inSingleQuoteString
        } else if (char === `"`) {
          state = LexerState.inDoubleQuoteString
        } else if (char === `(`) {
          parenDepth++
        } else if (char === `)`) {
          if (parenDepth > 0) {
            parenDepth--
          } else {
            return index
          }
        }
        break
      case LexerState.inSingleQuoteString:
        if (char === `'`) {
          state = LexerState.inParens
        }
        break
      case LexerState.inDoubleQuoteString:
        if (char === `"`) {
          state = LexerState.inParens
        }
        break
    }
  }

  return null
}
