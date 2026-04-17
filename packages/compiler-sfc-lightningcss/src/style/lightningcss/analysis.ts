import { walkCssBlockPreludes } from '@vue/lightningcss-utils'
import { hasCssVarsBinding } from '../cssVars'
import { registerScopedKeyframeRename } from './keyframeNames'

export interface LightningCssStyleAnalysis {
  hasAnimationDeclarations: boolean
  hasNestedStyleRules: boolean
  hasScopedSelectorSpecials: boolean
  hasVBind: boolean
  keyframes: Record<string, string>
}

export function analyzeLightningCssStyle(
  source: string,
  id: string,
): LightningCssStyleAnalysis {
  const shortId = id.replace(/^data-v-/, '')
  const analysis: LightningCssStyleAnalysis = {
    hasAnimationDeclarations: /animation/i.test(source),
    hasNestedStyleRules: false,
    hasScopedSelectorSpecials:
      source.includes(':deep(') ||
      source.includes('::v-deep') ||
      source.includes('>>>') ||
      source.includes('/deep/') ||
      source.includes(':slotted(') ||
      source.includes('::v-slotted') ||
      source.includes(':global(') ||
      source.includes('::v-global'),
    hasVBind: hasCssVarsBinding(source),
    keyframes: Object.create(null),
  }

  walkCssBlockPreludes(source, prelude => {
    if (prelude.parentKind === 'style') {
      analysis.hasNestedStyleRules = true
    }
    registerScopedKeyframeRename(
      prelude.normalizedPrelude,
      shortId,
      analysis.keyframes,
    )
  })

  return analysis
}
