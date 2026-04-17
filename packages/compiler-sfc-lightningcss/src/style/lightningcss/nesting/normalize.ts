import type { RawSourceMap } from '@vue/compiler-core'
import {
  type CssBlockNode,
  parseCssBlockTree,
  parseSelectorListFromString,
} from '@vue/lightningcss-lexer'
import type { Selector, SelectorComponent } from 'lightningcss'
import MagicString from 'magic-string'
import merge from 'merge-source-map'
import { warnOnce } from '../../../warn'
import type { NestedScopeContext } from './deepContext'
import { analyzeSelectorNestingContext } from './deepContext'
import {
  createNoInjectAmpPrelude,
  wrapPreludeInNoInjectCarrier,
  wrapTopLevelTextSegments,
} from './text'
import {
  getVueScopedSelectorCarrierKind,
  vueScopedSelectorParserOptions,
} from '../vueScopedSelectors'

export interface NormalizeNestedStyleBlocksResult {
  code: string
  map: RawSourceMap | undefined
  normalized: boolean
}

interface NormalizeBlockState {
  inheritedContext: NestedScopeContext
  atRuleDeclarationWrapper: string | null
}

export function normalizeNestedStyleBlocks(
  source: string,
  filename: string,
  map?: RawSourceMap,
  sourceMap: boolean = !!map,
): NormalizeNestedStyleBlocksResult {
  // Normalize nested style blocks before selector scoping so source-level
  // scoping sees explicit `& { ... }` declaration blocks instead of mixed
  // declaration/rule bodies.
  const s = new MagicString(source)
  let normalized = false

  const noteChange = (changed: boolean) => {
    normalized ||= changed
  }

  for (const block of parseCssBlockTree(source)) {
    if (block.blockKind === 'style') {
      noteChange(
        normalizeStyleRuleBlock(block, s, source, {
          inheritedContext: 'none',
          atRuleDeclarationWrapper: null,
        }),
      )
      continue
    }

    if (block.blockKind === 'at-rule') {
      noteChange(
        normalizeAtRuleBlock(block, s, source, {
          inheritedContext: 'none',
          atRuleDeclarationWrapper: null,
        }),
      )
    }
  }

  if (!normalized) {
    return {
      code: source,
      map,
      normalized,
    }
  }

  if (!sourceMap) {
    return {
      code: s.toString(),
      map: undefined,
      normalized,
    }
  }

  const nextMap = s.generateMap({
    source: filename,
    includeContent: true,
    hires: true,
  })

  return {
    code: s.toString(),
    map: map
      ? (merge(map, nextMap) as RawSourceMap)
      : (JSON.parse(nextMap.toString()) as RawSourceMap),
    normalized,
  }
}

function normalizeStyleRuleBlock(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  state: NormalizeBlockState,
): boolean {
  const ownContextAnalysis = analyzeSelectorNestingContext(
    block.normalizedPrelude,
  )
  const ownContext = ownContextAnalysis.context
  const hasDirectNestedStyleRules = block.children.some(
    child => child.blockKind === 'style',
  )

  if (hasDirectNestedStyleRules && ownContextAnalysis.hasMixedBranches) {
    warnOnce(
      'Mixed selector branches that combine Vue deep/slotted carriers with ordinary local branches under nested rules are handled conservatively. Descendants stay locally scoped; split the selector list into separate rules for precise behavior.',
    )
  }

  const shouldDisableCurrentRuleInjection =
    state.inheritedContext !== 'none' ||
    (hasDirectNestedStyleRules && ownContext === 'none')
  let changed = false

  // Context-only parent rules should not receive the normal scope attribute
  // themselves. They only provide nesting context for the explicit `& { ... }`
  // wrapper blocks that we synthesize below.
  if (shouldDisableCurrentRuleInjection) {
    changed = wrapPreludeInNoInjectCarrier(block, s) || changed
  }

  if (hasDirectNestedStyleRules && ownContext === 'none') {
    const declarationWrapperPrelude =
      state.inheritedContext !== 'none' ||
      preludeIsPureGlobalCarrier(block.normalizedPrelude)
        ? createNoInjectAmpPrelude()
        : '&'
    changed =
      wrapTopLevelTextSegments(block, s, source, declarationWrapperPrelude) ||
      changed
  }

  const childInheritedContext =
    state.inheritedContext !== 'none' ? state.inheritedContext : ownContext
  const atRuleState: NormalizeBlockState = {
    // Conditional wrappers like `@media` should not change whether the nested
    // subtree is still in deep/slot context. They only guard when the nested
    // selector applies.
    inheritedContext: childInheritedContext,
    atRuleDeclarationWrapper:
      hasDirectNestedStyleRules && ownContext === 'none'
        ? state.inheritedContext !== 'none' ||
          preludeIsPureGlobalCarrier(block.normalizedPrelude)
          ? createNoInjectAmpPrelude()
          : '&'
        : null,
  }

  for (const child of block.children) {
    if (child.blockKind === 'style') {
      changed =
        normalizeStyleRuleBlock(child, s, source, {
          inheritedContext: childInheritedContext,
          atRuleDeclarationWrapper: null,
        }) || changed
      continue
    }

    if (child.blockKind === 'at-rule') {
      if (isDeclarationOnlyAtRuleSubtree(child, source)) {
        changed = hoistNestedAtRuleBlock(child, block.end, source, s) || changed
        continue
      }

      changed = normalizeAtRuleBlock(child, s, source, atRuleState) || changed
    }
  }

  return changed
}

function preludeIsPureGlobalCarrier(prelude: string): boolean {
  try {
    const selectors = parseSelectorListFromString(
      prelude,
      vueScopedSelectorParserOptions,
    )
    return selectors.length > 0 && selectors.every(selectorIsPureGlobalCarrier)
  } catch {
    return false
  }
}

function selectorIsPureGlobalCarrier(selector: Selector): boolean {
  return selector.length === 1 && isVueGlobalCarrier(selector[0])
}

function isVueGlobalCarrier(component: SelectorComponent): boolean {
  if (
    (component.type === 'pseudo-class' ||
      component.type === 'pseudo-element') &&
    component.kind === 'custom-function'
  ) {
    return getVueScopedSelectorCarrierKind(component.name) === 'global'
  }

  return false
}

function normalizeAtRuleBlock(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  state: NormalizeBlockState,
): boolean {
  let changed = false
  const shouldPropagateDeclarationWrapper =
    state.atRuleDeclarationWrapper &&
    atRuleCanPropagateDeclarationWrapper(block.normalizedPrelude)

  if (shouldPropagateDeclarationWrapper) {
    changed =
      wrapTopLevelTextSegments(
        block,
        s,
        source,
        state.atRuleDeclarationWrapper!,
      ) || changed
  }

  const childState: NormalizeBlockState = shouldPropagateDeclarationWrapper
    ? state
    : {
        inheritedContext: state.inheritedContext,
        atRuleDeclarationWrapper: null,
      }

  for (const child of block.children) {
    if (child.blockKind === 'style') {
      changed =
        normalizeStyleRuleBlock(child, s, source, {
          inheritedContext: childState.inheritedContext,
          atRuleDeclarationWrapper: null,
        }) || changed
      continue
    }

    if (child.blockKind === 'at-rule') {
      changed = normalizeAtRuleBlock(child, s, source, childState) || changed
    }
  }

  return changed
}

const declarationWrapperAtRuleRE =
  /^@(?:media|supports|container|layer|scope|document|starting-style)\b/i

function atRuleCanPropagateDeclarationWrapper(prelude: string): boolean {
  return declarationWrapperAtRuleRE.test(prelude)
}

function isDeclarationOnlyAtRuleSubtree(
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
    !hasTopLevelTextSegments(block, source) &&
    block.children.length > 0 &&
    block.children.every(child => isDeclarationOnlyAtRuleSubtree(child, source))
  )
}

function hasTopLevelTextSegments(block: CssBlockNode, source: string): boolean {
  let cursor = block.bodyStart

  for (const child of block.children) {
    if (stripCssComments(source.slice(cursor, child.start)).trim()) {
      return true
    }
    cursor = child.end
  }

  return !!stripCssComments(source.slice(cursor, block.bodyEnd)).trim()
}

function hoistNestedAtRuleBlock(
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

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ')
}
