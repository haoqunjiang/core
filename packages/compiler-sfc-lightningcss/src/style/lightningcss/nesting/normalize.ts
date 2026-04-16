import type { RawSourceMap } from '@vue/compiler-core'
import { type CssBlockNode, parseCssBlockTree } from '@vue/lightningcss-lexer'
import MagicString from 'magic-string'
import merge from 'merge-source-map'
import { selectorEstablishesDeepContext } from './deepContext'
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
  inheritedDeepContext: boolean
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
          inheritedDeepContext: false,
          atRuleDeclarationWrapper: null,
        }),
      )
      continue
    }

    if (block.blockKind === 'at-rule') {
      noteChange(
        normalizeAtRuleBlock(block, s, source, {
          inheritedDeepContext: false,
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
  const ownDeepContext = selectorEstablishesDeepContext(block.normalizedPrelude)
  const hasDirectNestedStyleRules = block.children.some(
    child => child.blockKind === 'style',
  )
  const shouldDisableCurrentRuleInjection =
    state.inheritedDeepContext || (hasDirectNestedStyleRules && !ownDeepContext)
  let changed = false

  // Context-only parent rules should not receive the normal scope attribute
  // themselves. They only provide nesting context for the explicit `& { ... }`
  // wrapper blocks that we synthesize below.
  if (shouldDisableCurrentRuleInjection) {
    changed = wrapPreludeInNoInjectCarrier(block, s) || changed
  }

  if (hasDirectNestedStyleRules && !ownDeepContext) {
    changed =
      wrapTopLevelTextSegments(
        block,
        s,
        source,
        state.inheritedDeepContext ? createNoInjectAmpPrelude() : '&',
      ) || changed
  }

  const childInheritedDeepContext = state.inheritedDeepContext || ownDeepContext
  const atRuleState: NormalizeBlockState = {
    inheritedDeepContext: childInheritedDeepContext,
    atRuleDeclarationWrapper:
      hasDirectNestedStyleRules && !ownDeepContext
        ? state.inheritedDeepContext
          ? createNoInjectAmpPrelude()
          : '&'
        : null,
  }

  for (const child of block.children) {
    if (child.blockKind === 'style') {
      changed =
        normalizeStyleRuleBlock(child, s, source, {
          inheritedDeepContext: childInheritedDeepContext,
          atRuleDeclarationWrapper: null,
        }) || changed
      continue
    }

    if (child.blockKind === 'at-rule') {
      changed = normalizeAtRuleBlock(child, s, source, atRuleState) || changed
    }
  }

  return changed
}

function normalizeAtRuleBlock(
  block: CssBlockNode,
  s: MagicString,
  source: string,
  state: NormalizeBlockState,
): boolean {
  let changed = false

  if (state.atRuleDeclarationWrapper) {
    changed =
      wrapTopLevelTextSegments(
        block,
        s,
        source,
        state.atRuleDeclarationWrapper,
      ) || changed
  }

  for (const child of block.children) {
    if (child.blockKind === 'style') {
      changed =
        normalizeStyleRuleBlock(child, s, source, {
          inheritedDeepContext: state.inheritedDeepContext,
          atRuleDeclarationWrapper: null,
        }) || changed
      continue
    }

    if (child.blockKind === 'at-rule') {
      changed = normalizeAtRuleBlock(child, s, source, state) || changed
    }
  }

  return changed
}
