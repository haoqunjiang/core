import { walkCssBlockPreludes } from './lexer/blockPrelude'

export interface SFCStyleLightningCSSFeatures {
  hasAnimationDeclarations: boolean
  hasNestedStyleRules: boolean
  hasScopedSelectorSpecials: boolean
  hasVBind: boolean
  keyframes: Record<string, string>
}

const keyframesPreludeRE = /^@(?:-\w+-)?keyframes\b\s+([^{;\s]+)/i

export function analyzeStyleLightningCSSFeatures(
  source: string,
  id: string,
): SFCStyleLightningCSSFeatures {
  const shortId = id.replace(/^data-v-/, '')
  const features: SFCStyleLightningCSSFeatures = {
    hasAnimationDeclarations: source.includes('animation'),
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
    hasVBind: source.includes('v-bind('),
    keyframes: Object.create(null),
  }

  walkCssBlockPreludes(source, prelude => {
    if (prelude.parentKind === 'style') {
      features.hasNestedStyleRules = true
    }
    registerKeyframesPrelude(
      prelude.normalizedPrelude,
      shortId,
      features.keyframes,
    )
  })

  return features
}

function registerKeyframesPrelude(
  prelude: string,
  shortId: string,
  keyframes: Record<string, string>,
): void {
  const match = prelude.match(keyframesPreludeRE)
  if (!match) {
    return
  }

  const name = match[1]
  if (!name.endsWith(`-${shortId}`)) {
    keyframes[name] = `${name}-${shortId}`
  }
}
