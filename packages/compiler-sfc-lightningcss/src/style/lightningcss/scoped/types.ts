import type { Selector, SelectorComponent, SelectorList } from 'lightningcss'

export type AttributeSelector = Extract<
  SelectorComponent,
  { type: 'attribute' }
>
export type CombinatorSelector = Extract<
  SelectorComponent,
  { type: 'combinator' }
>
export type PseudoClassSelector = Extract<
  SelectorComponent,
  { type: 'pseudo-class' }
>
export type PseudoElementSelector = Extract<
  SelectorComponent,
  { type: 'pseudo-element' }
>
export type ScopeInjectMode = 'none' | 'normal' | 'slot'

export type SelectorContainerSelector = PseudoClassSelector & {
  kind: 'has' | 'is' | 'not' | 'where'
  selectors: SelectorList
}

export type ScopeContainerSelector = SelectorContainerSelector & {
  kind: 'is' | 'where'
  selectors: SelectorList
}

export interface ScopedSelectorHelpers {
  deepMarker: AttributeSelector
  descendantCombinator: CombinatorSelector
  noInjectMarker: AttributeSelector
  scopeAttribute: AttributeSelector
  slotScopeAttribute: AttributeSelector
}

export interface ScopedStyleTransformContext {
  helpers: ScopedSelectorHelpers
  id: string
  keyframes: Record<string, string>
  shortId: string
}

export interface ExpandedScopedSelector {
  deep: boolean
  selector: Selector
}
