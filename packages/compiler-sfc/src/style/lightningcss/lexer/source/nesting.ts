import type { RawSourceMap } from '@vue/compiler-core'
import MagicString from 'magic-string'
import merge from 'merge-source-map'
import type { Selector, SelectorComponent, SelectorList } from 'lightningcss'
import { walkCssBlockPreludes } from '../blockPrelude'
import {
  type SelectorParserOptions,
  parseSelectorListFromString,
  stringifySelector,
} from '../selectors'

type AttributeSelector = Extract<SelectorComponent, { type: 'attribute' }>
type CombinatorSelector = Extract<SelectorComponent, { type: 'combinator' }>
type PseudoClassSelector = Extract<SelectorComponent, { type: 'pseudo-class' }>

export interface MarkImplicitNestedSelectorsResult {
  code: string
  map: RawSourceMap | undefined
  marked: boolean
}

/**
 * Options for preserving implicit nested-selector boundaries through a later
 * nesting-lowering pass.
 */
export interface MarkImplicitNestedSelectorsOptions {
  filename: string
  map?: RawSourceMap
  /**
   * Synthetic attribute name encoded as `:where([marker])` on selectors that
   * were implicitly relative before nesting was lowered.
   */
  markerName: string
  parserOptions?: SelectorParserOptions
}

/**
 * Marks nested selectors that are implicitly relative so a later source-level
 * selector transform can still tell where scope injection should restart after
 * native nesting has been lowered.
 *
 * This is not Vue-specific. Any transform that needs to preserve implicit
 * nesting intent across a separate lowering pass can reuse the same mechanism.
 *
 * Reminder: this preservation step exists because the Lightning CSS fast path
 * lowers nesting before source-level scoping. The old PostCSS scoped plugin
 * scoped the original nested rule tree directly, so it never had to carry this
 * information across a separate nesting-lowering phase.
 */
export function markImplicitNestedSelectorsWithMarker(
  source: string,
  options: MarkImplicitNestedSelectorsOptions,
): MarkImplicitNestedSelectorsResult {
  const { filename, map, markerName, parserOptions } = options
  const s = new MagicString(source)
  let marked = false

  walkCssBlockPreludes(source, prelude => {
    if (
      prelude.parentKind !== 'style' ||
      !prelude.normalizedPrelude ||
      prelude.normalizedPrelude.startsWith('@')
    ) {
      return
    }

    const rewrittenPrelude = markImplicitNestedSelectorPrelude(
      prelude.preludeSource,
      markerName,
      parserOptions,
    )
    if (!rewrittenPrelude) {
      return
    }

    const leadingLength = prelude.preludeSource.match(/^\s*/)?.[0].length || 0
    const trailingLength = prelude.preludeSource.match(/\s*$/)?.[0].length || 0
    const start = prelude.start + leadingLength
    const end = prelude.end - trailingLength
    s.overwrite(start, end, rewrittenPrelude)
    marked = true
  })

  if (!marked) {
    return {
      code: source,
      map,
      marked,
    }
  }

  if (!map) {
    return {
      code: s.toString(),
      map: undefined,
      marked,
    }
  }

  const nextMap = s.generateMap({
    source: filename,
    includeContent: true,
    hires: true,
  })

  return {
    code: s.toString(),
    map: merge(map, nextMap) as RawSourceMap,
    marked,
  }
}

function markImplicitNestedSelectorPrelude(
  prelude: string,
  markerName: string,
  parserOptions: SelectorParserOptions | undefined,
): string | undefined {
  let selectors: SelectorList
  try {
    selectors = parseSelectorListFromString(prelude, parserOptions)
  } catch {
    return
  }

  let marked = false
  const rewrittenSelectors = selectors.map(selector => {
    if (containsNestingSelector(selector)) {
      return selector
    }

    marked = true
    return markImplicitNestedSelector(selector, markerName)
  })

  if (!marked) {
    return
  }

  return rewrittenSelectors
    .map(selector => stringifySelector(selector))
    .join(', ')
}

function markImplicitNestedSelector(
  selector: Selector,
  markerName: string,
): Selector {
  const rewritten = selector.slice()
  const firstComponentIndex = rewritten.findIndex(
    component => component.type !== 'combinator',
  )

  if (firstComponentIndex === -1) {
    return [{ type: 'nesting' }, ...rewritten]
  }

  const marker = createRelativeScopeMarker(markerName)
  const firstComponent = rewritten[firstComponentIndex]

  if (firstComponent.type === 'type' || firstComponent.type === 'universal') {
    rewritten.splice(firstComponentIndex + 1, 0, marker)
  } else {
    rewritten.splice(firstComponentIndex, 0, marker)
  }

  if (rewritten[0]?.type === 'combinator') {
    return [{ type: 'nesting' }, ...rewritten]
  }

  return [
    { type: 'nesting' },
    createCombinatorSelector('descendant'),
    ...rewritten,
  ]
}

function containsNestingSelector(selector: Selector): boolean {
  for (const component of selector) {
    if (component.type === 'nesting') {
      return true
    }

    if (
      component.type === 'pseudo-class' &&
      (component.kind === 'is' ||
        component.kind === 'where' ||
        component.kind === 'has' ||
        component.kind === 'not')
    ) {
      if (component.selectors.some(containsNestingSelector)) {
        return true
      }
    } else if (
      component.type === 'pseudo-class' &&
      component.kind === 'host' &&
      component.selectors &&
      containsNestingSelector(component.selectors)
    ) {
      return true
    } else if (
      component.type === 'pseudo-element' &&
      component.kind === 'slotted' &&
      containsNestingSelector(component.selector)
    ) {
      return true
    }
  }

  return false
}

function createRelativeScopeMarker(markerName: string): PseudoClassSelector & {
  kind: 'where'
  selectors: SelectorList
} {
  return {
    type: 'pseudo-class',
    kind: 'where',
    selectors: [[createAttributeSelector(markerName)]],
  }
}

function createAttributeSelector(name: string): AttributeSelector {
  return {
    type: 'attribute',
    name,
    namespace: null,
    operation: null,
  }
}

function createCombinatorSelector(
  value: CombinatorSelector['value'],
): CombinatorSelector {
  return {
    type: 'combinator',
    value,
  }
}
