import type {
  AnimationName,
  Declaration,
  KeyframesName,
  Rule,
  TokenOrValue,
} from 'lightningcss'
import type { ScopedStyleTransformContext } from './types'

export function rewriteLightningCssKeyframesRule(
  rule: Extract<Rule, { type: 'keyframes' }>,
  context: ScopedStyleTransformContext,
): typeof rule {
  rewriteLightningCssKeyframesName(rule.value.name, context)
  return rule
}

export function rewriteLightningCssAnimationDeclaration(
  declaration: Declaration,
  context: ScopedStyleTransformContext,
): Declaration {
  switch (declaration.property) {
    case 'animation-name':
      declaration.value = declaration.value.map(value =>
        rewriteLightningCssAnimationName(value, context.keyframes),
      )
      break
    case 'animation':
      declaration.value = declaration.value.map(value =>
        value.name
          ? {
              ...value,
              name: rewriteLightningCssAnimationName(
                value.name,
                context.keyframes,
              ),
            }
          : value,
      )
      break
    case 'unparsed': {
      const property = declaration.value.propertyId.property
      if (property === 'animation' || property === 'animation-name') {
        rewriteAnimationTokens(declaration.value.value, context.keyframes)
      }
      break
    }
  }

  return declaration
}

function rewriteLightningCssAnimationName(
  value: AnimationName,
  keyframes: Record<string, string>,
): AnimationName {
  return value.type === 'ident' && keyframes[value.value]
    ? { ...value, value: keyframes[value.value] }
    : value
}

function rewriteLightningCssKeyframesName(
  name: KeyframesName,
  context: ScopedStyleTransformContext,
): void {
  if (name.type === 'ident' && !name.value.endsWith(`-${context.shortId}`)) {
    context.keyframes[name.value] =
      name.value = `${name.value}-${context.shortId}`
  }
}

function rewriteAnimationTokens(
  tokens: TokenOrValue[],
  keyframes: Record<string, string>,
): void {
  for (const token of tokens) {
    if (token.type === 'token') {
      if (token.value.type === 'ident' && keyframes[token.value.value]) {
        token.value.value = keyframes[token.value.value]
      }
    } else if (token.type === 'function') {
      rewriteAnimationTokens(token.value.arguments, keyframes)
    } else if (token.type === 'var' && token.value.fallback) {
      rewriteAnimationTokens(token.value.fallback, keyframes)
    }
  }
}
