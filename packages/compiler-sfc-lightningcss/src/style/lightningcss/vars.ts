import type {
  Function as LightningCssFunction,
  TokenOrValue,
} from 'lightningcss'
import { stringifyTokens } from '@vue/lightningcss-lexer'
import { genCssVarReference } from '../cssVars'

export function rewriteLightningCssVarFunction(
  fn: LightningCssFunction,
  id: string,
  isProd: boolean,
): { raw: string } | void {
  if (fn.name !== 'v-bind') {
    return
  }

  return {
    raw: genCssVarReference(
      id,
      stringifyTokens(fn.arguments as TokenOrValue[]),
      isProd,
    ),
  }
}
