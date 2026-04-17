import type { RawSourceMap } from '@vue/compiler-core'
import { type CssBlockNode, parseCssBlockTree } from '@vue/lightningcss-lexer'
import MagicString from 'magic-string'
import merge from 'merge-source-map'
import { warnOnce } from '../../../warn'
import {
  getPropagatedDeclarationWrapper,
  hoistNestedAtRuleBlock,
  isDeclarationOnlyAtRuleSubtree,
} from './atRules'
import { preludeIsPureGlobalCarrier } from './carriers'
import type { NestedScopeContext } from './deepContext'
import { analyzeSelectorNestingContext } from './deepContext'
import {
  createNoInjectAmpPrelude,
  wrapPreludeInNoInjectCarrier,
  wrapTopLevelTextSegments,
} from './text'

export interface NormalizeNestedStyleBlocksResult {
  code: string
  map: RawSourceMap | undefined
  normalized: boolean
}

interface NormalizeBlockState {
  inheritedContext: NestedScopeContext
  atRuleDeclarationWrapper: string | null
}

interface StyleRuleBehavior {
  declarationWrapperPrelude: string | null
  hasMixedBranches: boolean
  inheritedContextForChildren: NestedScopeContext
  shouldDisableCurrentRuleInjection: boolean
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
    noteChange(normalizeNestedBlock(block, s, source, initialNormalizeState()))
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

function initialNormalizeState(): NormalizeBlockState {
  return {
    inheritedContext: 'none',
    atRuleDeclarationWrapper: null,
  }
}

function normalizeNestedBlock(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  state: NormalizeBlockState,
): boolean {
  switch (block.blockKind) {
    case 'style':
      return normalizeStyleRuleBlock(block, s, source, state)
    case 'at-rule':
      return normalizeAtRuleBlock(block, s, source, state)
    default:
      return false
  }
}

function normalizeStyleRuleBlock(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  state: NormalizeBlockState,
): boolean {
  const behavior = analyzeStyleRuleBehavior(block, state)

  if (behavior.hasMixedBranches) {
    warnOnce(
      'Mixed selector branches that combine Vue deep/slotted carriers with ordinary local branches under nested rules are handled conservatively. Descendants stay locally scoped; split the selector list into separate rules for precise behavior.',
    )
  }

  let changed = false

  // Context-only parent rules should not receive the normal scope attribute
  // themselves. They only provide nesting context for the explicit `& { ... }`
  // wrapper blocks that we synthesize below.
  if (behavior.shouldDisableCurrentRuleInjection) {
    changed = wrapPreludeInNoInjectCarrier(block, s) || changed
  }

  if (behavior.declarationWrapperPrelude) {
    changed =
      wrapTopLevelTextSegments(
        block,
        s,
        source,
        behavior.declarationWrapperPrelude,
      ) ||
      changed
  }

  const atRuleState: NormalizeBlockState = {
    // Conditional wrappers like `@media` should not change whether the nested
    // subtree is still in deep/slot context. They only guard when the nested
    // selector applies.
    inheritedContext: behavior.inheritedContextForChildren,
    atRuleDeclarationWrapper: behavior.declarationWrapperPrelude,
  }

  changed =
    normalizeChildBlocks(
      block,
      s,
      source,
      {
        inheritedContext: behavior.inheritedContextForChildren,
        atRuleDeclarationWrapper: null,
      },
      atRuleState,
      block.end,
    ) || changed

  return changed
}

function analyzeStyleRuleBehavior(
  block: CssBlockNode,
  state: NormalizeBlockState,
): StyleRuleBehavior {
  const ownContextAnalysis = analyzeSelectorNestingContext(
    block.normalizedPrelude,
  )
  const ownContext = ownContextAnalysis.context
  const inheritsContext = state.inheritedContext !== 'none'
  const hasDirectNestedStyleRules = block.children.some(
    child => child.blockKind === 'style',
  )
  const shouldWrapDeclarations = hasDirectNestedStyleRules && ownContext === 'none'
  const declarationWrapperPrelude = shouldWrapDeclarations
    ? shouldUseNoInjectDeclarationWrapper(block.normalizedPrelude, inheritsContext)
      ? createNoInjectAmpPrelude()
      : '&'
    : null

  return {
    declarationWrapperPrelude,
    hasMixedBranches: hasDirectNestedStyleRules && ownContextAnalysis.hasMixedBranches,
    inheritedContextForChildren: inheritsContext
      ? state.inheritedContext
      : ownContext,
    shouldDisableCurrentRuleInjection:
      inheritsContext || shouldWrapDeclarations,
  }
}

function shouldUseNoInjectDeclarationWrapper(
  prelude: string,
  inheritsContext: boolean,
): boolean {
  return inheritsContext || preludeIsPureGlobalCarrier(prelude)
}

function normalizeAtRuleBlock(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  state: NormalizeBlockState,
): boolean {
  let changed = false
  const propagatedDeclarationWrapper = getPropagatedDeclarationWrapper(
    block.normalizedPrelude,
    state.atRuleDeclarationWrapper,
  )

  if (propagatedDeclarationWrapper) {
    changed =
      wrapTopLevelTextSegments(block, s, source, propagatedDeclarationWrapper) ||
      changed
  }

  const childState: NormalizeBlockState = {
    inheritedContext: state.inheritedContext,
    atRuleDeclarationWrapper: propagatedDeclarationWrapper,
  }

  changed =
    normalizeChildBlocks(
      block,
      s,
      source,
      {
        inheritedContext: childState.inheritedContext,
        atRuleDeclarationWrapper: null,
      },
      childState,
    ) || changed

  return changed
}

function normalizeChildBlocks(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  styleState: NormalizeBlockState,
  atRuleState: NormalizeBlockState,
  hoistAtRulesToParentEnd?: number,
): boolean {
  let changed = false

  for (const child of block.children) {
    if (
      hoistAtRulesToParentEnd != null &&
      child.blockKind === 'at-rule' &&
      isDeclarationOnlyAtRuleSubtree(child, source)
    ) {
      changed =
        hoistNestedAtRuleBlock(child, hoistAtRulesToParentEnd, source, s) ||
        changed
      continue
    }

    changed =
      normalizeNestedBlock(
        child,
        s,
        source,
        child.blockKind === 'style' ? styleState : atRuleState,
      ) || changed
  }

  return changed
}
