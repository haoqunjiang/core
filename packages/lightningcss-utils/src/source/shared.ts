const keyframesPreludeRE = /^@(?:-\w+-)?keyframes\b/i

export function getCssBlockKind(
  prelude: string,
): 'at-rule' | 'keyframes' | 'style' {
  if (keyframesPreludeRE.test(prelude)) {
    return 'keyframes'
  }
  return prelude.startsWith('@') ? 'at-rule' : 'style'
}

export function normalizeBlockPrelude(prelude: string): string {
  return stripCssComments(prelude).trim()
}

export function isCustomPropertyDeclarationPrelude(prelude: string): boolean {
  return normalizeBlockPrelude(prelude).startsWith('--')
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ')
}
