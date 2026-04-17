import type {
  Declaration as LightningCssDeclaration,
  Function as LightningCssFunction,
  Rule as LightningCssRule,
  Selector as LightningCssSelector,
  SelectorList as LightningCssSelectorList,
  Visitor as LightningCssVisitor,
} from 'lightningcss'
import type { SFCStyleLightningCSSFeatures } from './features'
import {
  createScopedStyleTransformContext,
  rewriteLightningCssAnimationDeclaration,
  rewriteLightningCssKeyframesRule,
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
   * visitor only needs to handle the remaining AST-oriented transforms such as
   * keyframe/animation rewriting.
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
  const hasAnimationDeclarations = !!(
    features && features.hasAnimationDeclarations
  )
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
  // finish that work for the common fast path. The visitor still owns the
  // AST-oriented keyframe and animation rewrites.
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

    attachKeyframeVisitors(visitor, context, hasAnimationDeclarations)
    return visitor
  }

  const context = createScopedStyleTransformContext({
    id,
    keyframes,
  })
  attachKeyframeVisitors(visitor, context, hasAnimationDeclarations)
  return hasVisitorHooks(visitor) ? visitor : undefined
}

function attachKeyframeVisitors(
  visitor: SFCStyleLightningCSSVisitor,
  context: ReturnType<typeof createScopedStyleTransformContext>,
  hasAnimationDeclarations: boolean,
): void {
  if (!Object.keys(context.keyframes).length) {
    return
  }

  visitor.Rule = {
    keyframes(rule) {
      return rewriteLightningCssKeyframesRule(
        rule as Extract<LightningCssRule, { type: 'keyframes' }>,
        context,
      ) as LightningCssRule
    },
  }

  if (hasAnimationDeclarations) {
    visitor.Declaration = declaration => {
      return rewriteLightningCssAnimationDeclaration(
        declaration as LightningCssDeclaration,
        context,
      ) as LightningCssDeclaration | void
    }
  }
}

function hasVisitorHooks(visitor: SFCStyleLightningCSSVisitor): boolean {
  return (
    !!visitor.Declaration ||
    !!visitor.Function ||
    !!visitor.Rule ||
    !!visitor.Selector
  )
}
