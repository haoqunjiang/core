import type {
  Function as LightningCssFunction,
  Selector as LightningCssSelector,
  SelectorList as LightningCssSelectorList,
  Visitor as LightningCssVisitor,
} from 'lightningcss'
import type { LightningCssStyleAnalysis } from './analysis'
import { createScopedStyleTransformContext } from './scoped/context'
import {
  rewriteScopedSelector,
  rewriteSimpleScopedSelector,
} from './scoped/rewrite'

export type LightningCssStyleSelector = LightningCssSelector
export type LightningCssStyleSelectorList = LightningCssSelectorList
export type LightningCssStyleFunctionNode = LightningCssFunction
export type LightningCssStyleVisitor = Pick<
  LightningCssVisitor<never>,
  'Declaration' | 'Function' | 'Rule' | 'Selector'
>

export interface LightningCssStyleVisitorOptions {
  analysis?: LightningCssStyleAnalysis
  id: string
  isProd?: boolean
  scoped?: boolean
  /**
   * `true` when selector scoping already ran as a source rewrite, so the final
   * visitor only needs to handle any remaining selector-level transforms.
  */
  selectorsScopedInSource?: boolean
}

export function createLightningCssStyleVisitor(
  options: LightningCssStyleVisitorOptions,
): LightningCssStyleVisitor | undefined {
  const {
    analysis,
    id,
    scoped = false,
    selectorsScopedInSource = false,
  } = options
  const hasScopedSelectorSpecials =
    analysis && analysis.hasScopedSelectorSpecials !== undefined
      ? analysis.hasScopedSelectorSpecials
      : true
  const keyframes = analysis ? analysis.keyframes : undefined
  const visitor: LightningCssStyleVisitor = {}

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
        ? rewriteScopedSelector(
            selector as LightningCssSelector,
            context,
          )
        : rewriteSimpleScopedSelector(
            selector as LightningCssSelector,
            context,
          )) as LightningCssSelector | LightningCssSelector[]
    return visitor
  }
  return hasVisitorHooks(visitor) ? visitor : undefined
}

function hasVisitorHooks(visitor: LightningCssStyleVisitor): boolean {
  return !!visitor.Function || !!visitor.Rule || !!visitor.Selector
}
