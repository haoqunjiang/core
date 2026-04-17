import { splitTopLevelSegments, splitTopLevelWhitespace } from './scan'
import { isVarFunctionCall, rewriteAnimationNameValue } from './names'

export function rewriteAnimationShorthandValue(
  value: string,
  keyframes: Record<string, string>,
): string {
  return splitTopLevelSegments(value, ',')
    .map(part => rewriteAnimationShorthandComponent(part.trim(), keyframes))
    .join(', ')
}

function rewriteAnimationShorthandComponent(
  value: string,
  keyframes: Record<string, string>,
): string {
  const tokens = splitTopLevelWhitespace(value)
  if (!tokens.length) {
    return value
  }

  let changed = false
  const nextTokens = tokens.slice()
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!isVarFunctionCall(token)) {
      continue
    }

    const rewrittenToken = rewriteAnimationNameValue(token, keyframes)
    if (rewrittenToken !== token) {
      nextTokens[index] = rewrittenToken
      changed = true
    }
  }

  // On normalized Lightning CSS output, explicit animation names are serialized
  // in the final token position, while dynamic names can still appear inside
  // var(...) calls anywhere in the shorthand.
  const lastTokenIndex = tokens.length - 1
  const rewrittenLastToken = rewriteAnimationNameValue(
    nextTokens[lastTokenIndex],
    keyframes,
  )
  if (rewrittenLastToken !== nextTokens[lastTokenIndex]) {
    nextTokens[lastTokenIndex] = rewrittenLastToken
    changed = true
  }

  return changed ? nextTokens.join(' ') : value
}
