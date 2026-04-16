import hash from 'hash-sum'
import { getEscapedCssVarName } from '@vue/shared'

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
