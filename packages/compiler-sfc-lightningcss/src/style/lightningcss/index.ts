import type {
  Function as LightningCssFunction,
  Selector as LightningCssSelector,
  SelectorList as LightningCssSelectorList,
  Visitor as LightningCssVisitor,
} from 'lightningcss'
import type { SFCStyleLightningCSSFeatures } from './features'
import {
  createScopedStyleTransformContext,
  scopeLightningCssSelectorDirect,
  scopeLightningCssSelectorWithLexer,
} from './scoped'

export type SFCStyleLightningCSSSelector = LightningCssSelector
export type SFCStyleLightningCSSSelectorList = LightningCssSelectorList
export type SFCStyleLightningCSSFunctionNode = LightningCssFunction
export type SFCStyleLightningCSSVisitor = Pick<
  LightningCssVisitor<never>,
  'Declaration' | 'Function' | 'Rule' | 'Selector'
>

export interface SFCStyleLightningCSSOptions {
  features?: SFCStyleLightningCSSFeatures
  id: string
  isProd?: boolean
  scoped?: boolean
  /**
   * `true` when selector scoping already ran as a source rewrite, so the final
   * visitor only needs to handle any remaining selector-level transforms.
   */
  selectorsScopedInSource?: boolean
}

export function createStyleLightningCSSVisitor(
  options: SFCStyleLightningCSSOptions,
): SFCStyleLightningCSSVisitor | undefined {
  const {
    features,
    id,
    scoped = false,
    selectorsScopedInSource = false,
  } = options
  const hasScopedSelectorSpecials =
    features && features.hasScopedSelectorSpecials !== undefined
      ? features.hasScopedSelectorSpecials
      : true
  const keyframes = features ? features.keyframes : undefined
  const visitor: SFCStyleLightningCSSVisitor = {}

  if (!scoped) {
    return hasVisitorHooks(visitor) ? visitor : undefined
  }

  // Selector scoping is optional here because the source phase can already
  // finish that work for the common fast path.
  if (!selectorsScopedInSource) {
    const context = createScopedStyleTransformContext({
      id,
      keyframes,
    })

    visitor.Selector = selector =>
      (hasScopedSelectorSpecials
        ? scopeLightningCssSelectorWithLexer(
            selector as LightningCssSelector,
            context,
          )
        : scopeLightningCssSelectorDirect(
            selector as LightningCssSelector,
            context,
          )) as LightningCssSelector | LightningCssSelector[]
    return visitor
  }
  return hasVisitorHooks(visitor) ? visitor : undefined
}

function hasVisitorHooks(visitor: SFCStyleLightningCSSVisitor): boolean {
  return !!visitor.Function || !!visitor.Rule || !!visitor.Selector
}
