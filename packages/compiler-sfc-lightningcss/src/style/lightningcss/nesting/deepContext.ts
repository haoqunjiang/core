import type { Selector, SelectorComponent } from 'lightningcss'
import { parseSelectorListFromString } from '@vue/lightningcss-lexer'
import { vueScopedSelectorParserOptions } from '../vueScopedSelectors'

/**
 * Returns whether this selector places descendant nested rules into Vue's deep
 * context, meaning later source normalization should stop treating the current
 * rule as a normal scoping boundary.
 */
export function selectorEstablishesDeepContext(prelude: string): boolean {
  try {
    return parseSelectorListFromString(
      prelude,
      vueScopedSelectorParserOptions,
    ).some(selectorContainsDeepContext)
  } catch {
    return (
      prelude.includes(':deep(') ||
      prelude.includes('::v-deep') ||
      prelude.includes('>>>') ||
      prelude.includes('/deep/')
    )
  }
}

function selectorContainsDeepContext(selector: Selector): boolean {
  return selector.some(componentContainsDeepContext)
}

function componentContainsDeepContext(component: SelectorComponent): boolean {
  if (component.type === 'combinator') {
    return component.value === 'deep' || component.value === 'deep-descendant'
  }

  if (
    component.type === 'pseudo-class' &&
    component.kind === 'custom-function' &&
    (component.name === 'deep' || component.name === 'v-deep')
  ) {
    return true
  }

  if (
    component.type === 'pseudo-element' &&
    ((component.kind === 'custom-function' &&
      (component.name === 'deep' || component.name === 'v-deep')) ||
      (component.kind === 'custom' && component.name === 'v-deep'))
  ) {
    return true
  }

  if (
    component.type === 'pseudo-class' &&
    (component.kind === 'has' ||
      component.kind === 'is' ||
      component.kind === 'not' ||
      component.kind === 'where')
  ) {
    return component.selectors.some(selectorContainsDeepContext)
  }

  if (
    component.type === 'pseudo-class' &&
    component.kind === 'host' &&
    component.selectors
  ) {
    return selectorContainsDeepContext(component.selectors)
  }

  if (component.type === 'pseudo-element' && component.kind === 'slotted') {
    return selectorContainsDeepContext(component.selector)
  }

  return false
}
