import type { CssBlockNode } from '@vue/lightningcss-utils'
import type MagicString from 'magic-string'
import { hasMeaningfulTopLevelText } from './text'

const declarationWrapperAtRuleRE =
  /^@(?:media|supports|container|layer|scope|document|starting-style)\b/i

export function getPropagatedDeclarationWrapper(
  prelude: string,
  declarationWrapper: string | null,
): string | null {
  return declarationWrapper && atRuleCanPropagateDeclarationWrapper(prelude)
    ? declarationWrapper
    : null
}

export function isDeclarationOnlyAtRuleSubtree(
  block: CssBlockNode,
  source: string,
): boolean {
  if (block.blockKind !== 'at-rule') {
    return false
  }

  if (block.children.some(child => child.blockKind === 'style')) {
    return false
  }

  if (!atRuleCanPropagateDeclarationWrapper(block.normalizedPrelude)) {
    return block.children.every(child =>
      isDeclarationOnlyAtRuleSubtree(child, source),
    )
  }

  return (
    !hasMeaningfulTopLevelText(block, source) &&
    block.children.length > 0 &&
    block.children.every(child => isDeclarationOnlyAtRuleSubtree(child, source))
  )
}

export function hoistNestedAtRuleBlock(
  block: CssBlockNode,
  parentEnd: number,
  source: string,
  s: MagicString,
): boolean {
  const hoistedSource = source.slice(block.start, block.end)
  s.remove(block.start, block.end)
  s.appendRight(parentEnd, hoistedSource)
  return true
}

function atRuleCanPropagateDeclarationWrapper(prelude: string): boolean {
  return declarationWrapperAtRuleRE.test(prelude)
}
