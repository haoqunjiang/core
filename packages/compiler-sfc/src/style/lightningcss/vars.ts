import type {
  Function as LightningCssFunction,
  TokenOrValue,
} from 'lightningcss'
import { genCssVarReference } from '../cssVars'
import { stringifyTokens } from './lexer/selectors'

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
