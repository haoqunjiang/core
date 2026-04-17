import type { Selector, SelectorComponent } from 'lightningcss'
import { parseSelectorListFromString } from '@vue/lightningcss-lexer'
import { vueScopedSelectorParserOptions } from '../vueScopedSelectors'

export type NestedScopeContext = 'deep' | 'none' | 'slotted'

export interface NestedScopeAnalysis {
  context: NestedScopeContext
  hasMixedBranches: boolean
}

/**
 * Returns whether this selector places descendant nested rules into Vue's deep
 * context, meaning later source normalization should stop treating the current
 * rule as a normal scoping boundary.
 */
export function analyzeSelectorNestingContext(
  prelude: string,
): NestedScopeAnalysis {
  try {
    return collapseNestedScopeContexts(
      parseSelectorListFromString(prelude, vueScopedSelectorParserOptions).map(
        selectorContainsDeepContext,
      ),
    )
  } catch {
    if (
      prelude.includes(':deep(') ||
      prelude.includes('::v-deep') ||
      prelude.includes('>>>') ||
      prelude.includes('/deep/')
    ) {
      return {
        context: 'deep',
        hasMixedBranches: false,
      }
    }

    return {
      context:
        prelude.includes(':slotted(') || prelude.includes('::v-slotted')
          ? 'slotted'
          : 'none',
      hasMixedBranches: false,
    }
  }
}

export function selectorEstablishesNestingContext(
  prelude: string,
): NestedScopeContext {
  return analyzeSelectorNestingContext(prelude).context
}

function selectorContainsDeepContext(selector: Selector): NestedScopeAnalysis {
  return selector.reduce<NestedScopeAnalysis>(
    (analysis, component) => {
      const componentAnalysis = componentContainsDeepContext(component)
      return {
        context: combineNestedScopeContexts(
          analysis.context,
          componentAnalysis.context,
        ),
        hasMixedBranches:
          analysis.hasMixedBranches || componentAnalysis.hasMixedBranches,
      }
    },
    {
      context: 'none',
      hasMixedBranches: false,
    },
  )
}

function componentContainsDeepContext(
  component: SelectorComponent,
): NestedScopeAnalysis {
  if (component.type === 'combinator') {
    return {
      context:
        component.value === 'deep' || component.value === 'deep-descendant'
          ? 'deep'
          : 'none',
      hasMixedBranches: false,
    }
  }

  if (
    component.type === 'pseudo-class' &&
    component.kind === 'custom-function' &&
    (component.name === 'deep' || component.name === 'v-deep')
  ) {
    return {
      context: 'deep',
      hasMixedBranches: false,
    }
  }

  if (
    component.type === 'pseudo-class' &&
    component.kind === 'custom-function' &&
    (component.name === 'slotted' || component.name === 'v-slotted')
  ) {
    return {
      context: 'slotted',
      hasMixedBranches: false,
    }
  }

  if (
    component.type === 'pseudo-element' &&
    ((component.kind === 'custom-function' &&
      (component.name === 'deep' || component.name === 'v-deep')) ||
      (component.kind === 'custom' && component.name === 'v-deep'))
  ) {
    return {
      context: 'deep',
      hasMixedBranches: false,
    }
  }

  if (
    component.type === 'pseudo-element' &&
    ((component.kind === 'custom-function' &&
      (component.name === 'slotted' || component.name === 'v-slotted')) ||
      (component.kind === 'custom' && component.name === 'v-slotted'))
  ) {
    return {
      context: 'slotted',
      hasMixedBranches: false,
    }
  }

  if (
    component.type === 'pseudo-class' &&
    (component.kind === 'is' || component.kind === 'where')
  ) {
    // `:is()` and `:where()` are selector containers used by nesting lowering,
    // so deep/slot carriers inside their branches still establish the context
    // seen by later nested descendants.
    return collapseNestedScopeContexts(
      component.selectors.map(selectorContainsDeepContext),
    )
  }

  if (
    component.type === 'pseudo-class' &&
    (component.kind === 'has' || component.kind === 'not')
  ) {
    // These pseudos are selector containers, but a nested `:deep(...)` or
    // `:slotted(...)` inside one of their argument branches does not make the
    // outer rule itself a deep/slot scoping boundary for child nested rules.
    return {
      context: 'none',
      hasMixedBranches: false,
    }
  }

  if (
    component.type === 'pseudo-class' &&
    component.kind === 'host' &&
    component.selectors
  ) {
    return {
      context: 'none',
      hasMixedBranches: false,
    }
  }

  if (component.type === 'pseudo-element' && component.kind === 'slotted') {
    // Standard shadow-DOM `::slotted()` is not Vue's slot carrier syntax.
    // It stays an ordinary selector component and does not put nested rules
    // into Vue's slot context.
    return {
      context: 'none',
      hasMixedBranches: false,
    }
  }

  return {
    context: 'none',
    hasMixedBranches: false,
  }
}

function combineNestedScopeContexts(
  left: NestedScopeContext,
  right: NestedScopeContext,
): NestedScopeContext {
  if (left === 'deep' || right === 'deep') {
    return 'deep'
  }

  if (left === 'slotted' || right === 'slotted') {
    return 'slotted'
  }

  return 'none'
}

function collapseNestedScopeContexts(
  analyses: readonly NestedScopeAnalysis[],
): NestedScopeAnalysis {
  const [first = { context: 'none', hasMixedBranches: false }, ...rest] =
    analyses

  if (rest.every(analysis => analysis.context === first.context)) {
    return {
      context: first.context,
      hasMixedBranches:
        first.hasMixedBranches ||
        rest.some(analysis => analysis.hasMixedBranches),
    }
  }

  return {
    context: 'none',
    hasMixedBranches: true,
  }
}
