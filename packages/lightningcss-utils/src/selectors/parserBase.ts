import type { Selector, SelectorComponent, SelectorList } from 'lightningcss'
import { parseStandardPseudoClassFunction } from './pseudoFunctions'
import {
  type AttrOperation,
  type AttributeSelector,
  type CustomFunctionSelector,
  type LocalNamespaceConstraint,
  type ParsedCaseSensitivity,
  type PseudoClassSelector,
  type PseudoElementSelector,
  type SelectorParserOptions,
  createCombinator,
  createSimplePseudoClass,
  createSimplePseudoElement,
  isCombinator,
} from './shared'

export abstract class SelectorParserBase<Boundary, Marker = unknown> {
  protected constructor(protected readonly options: SelectorParserOptions) {}

  parseSelectorList(endBoundary?: Boundary): SelectorList {
    const selectors: SelectorList = []

    while (!this.isDone()) {
      const selectorStart = this.markSelectorStart()
      this.skipTrivia()
      if (this.isDone() || this.isAtSelectorListBoundary(endBoundary)) {
        break
      }

      const selector = this.parseSelector(endBoundary)
      this.recordParsedSelectorSource(selector, selectorStart)
      selectors.push(selector)
      this.skipTrivia()

      if (this.consumeSelectorListSeparator()) {
        continue
      }

      break
    }

    return selectors
  }

  protected parseAttribute(): AttributeSelector {
    this.expectAttributeStart()
    this.skipTrivia()

    const { name, namespace } = this.readAttributeNameWithNamespace()
    this.skipTrivia()

    const operator = this.readAttributeOperator()

    let normalizedOperation: AttributeSelector['operation'] = null
    if (operator) {
      this.skipTrivia()
      normalizedOperation = {
        operator,
        value: this.readAttributeValue(),
        caseSensitivity: (() => {
          this.skipTrivia()
          return this.readAttributeCaseSensitivity()
        })(),
      }
      this.skipTrivia()
    }

    this.expectAttributeEnd()

    return {
      type: 'attribute',
      name,
      namespace: namespace as AttributeSelector['namespace'],
      operation: normalizedOperation,
    }
  }

  protected parsePseudo(): PseudoClassSelector | PseudoElementSelector {
    this.expectPseudoStart()
    const isElement = this.consumePseudoElementMarker()
    const name = this.readIdentifier()

    if (!this.beginPseudoFunctionArguments()) {
      return isElement
        ? createSimplePseudoElement(name)
        : createSimplePseudoClass(name)
    }

    if (!isElement) {
      if (isSelectorContainerPseudo(name)) {
        return {
          type: 'pseudo-class',
          kind: name,
          selectors: this.parseNestedSelectorList(),
        }
      }

      if (name === 'host') {
        const selectors = this.parseNestedSelectorList()
        if (selectors.length > 1) {
          throw new Error(`Unsupported selector list in :${name}().`)
        }
        return {
          type: 'pseudo-class',
          kind: 'host',
          selectors: selectors[0] || null,
        }
      }

      if (
        this.options.selectorListFunctionNames &&
        this.options.selectorListFunctionNames.has(name)
      ) {
        return {
          type: 'pseudo-class',
          kind: 'custom-function',
          name,
          arguments: [],
          selectors: this.parseNestedSelectorList(),
        } as CustomFunctionSelector
      }

      if (isStandardPseudoClassFunction(name)) {
        const parsedStandardPseudo = parseStandardPseudoClassFunction(
          name,
          this.readPseudoFunctionContentSource(),
          selectorContent => this.parseSelectorListFromSource(selectorContent),
        )
        if (parsedStandardPseudo) {
          return parsedStandardPseudo
        }
      }
    } else if (name === 'slotted') {
      const selectors = this.parseNestedSelectorList()
      if (selectors.length > 1) {
        throw new Error(`Unsupported selector list in ::${name}().`)
      }
      return {
        type: 'pseudo-element',
        kind: 'slotted',
        selector: selectors[0] || [],
      }
    } else if (
      this.options.selectorListFunctionNames &&
      this.options.selectorListFunctionNames.has(name)
    ) {
      return {
        type: 'pseudo-element',
        kind: 'custom-function',
        name,
        arguments: [],
        selectors: this.parseNestedSelectorList(),
      } as CustomFunctionSelector
    }

    throw new Error(
      `Unsupported pseudo selector function: ${isElement ? '::' : ':'}${name}().`,
    )
  }

  protected skipTrivia(): void {
    while (this.consumeWhitespace() || this.consumeComment()) {
      continue
    }
  }

  private parseSelector(endBoundary?: Boundary): Selector {
    const selector: Selector = []
    let needsDescendantCombinator = false

    while (!this.isDone()) {
      if (this.consumeComment()) {
        continue
      }

      if (this.consumeWhitespace()) {
        if (selector.length && !isCombinator(selector[selector.length - 1])) {
          needsDescendantCombinator = true
        }
        continue
      }

      if (this.isAtSelectorListBoundary(endBoundary)) {
        break
      }

      const combinator = this.parseCombinator()
      if (combinator) {
        selector.push(combinator)
        needsDescendantCombinator = false
        continue
      }

      if (needsDescendantCombinator) {
        selector.push(createCombinator('descendant'))
        needsDescendantCombinator = false
      }

      selector.push(...this.parseComponents())
    }

    return selector
  }

  protected abstract beginPseudoFunctionArguments(): boolean
  protected abstract consumeComment(): boolean
  protected abstract consumePseudoElementMarker(): boolean
  protected abstract consumeSelectorListSeparator(): boolean
  protected abstract consumeWhitespace(): boolean
  protected abstract expectAttributeEnd(): void
  protected abstract expectAttributeStart(): void
  protected abstract expectPseudoStart(): void
  protected abstract isAtSelectorListBoundary(
    endBoundary?: Boundary,
  ): boolean
  protected abstract isDone(): boolean
  protected abstract markSelectorStart(): Marker
  protected abstract parseCombinator():
    | Extract<SelectorComponent, { type: 'combinator' }>
    | undefined
  protected abstract parseComponents(): SelectorComponent[]
  protected abstract parseNestedSelectorList(): SelectorList
  protected abstract parseSelectorListFromSource(source: string): SelectorList
  protected abstract readAttributeCaseSensitivity():
    | ParsedCaseSensitivity
    | undefined
  protected abstract readAttributeNameWithNamespace(): {
    name: string
    namespace: LocalNamespaceConstraint | null
  }
  protected abstract readAttributeOperator(): AttrOperation['operator'] | null
  protected abstract readAttributeValue(): string
  protected abstract readIdentifier(): string
  protected abstract readPseudoFunctionContentSource(): string
  protected abstract recordParsedSelectorSource(
    selector: Selector,
    marker: Marker,
  ): void
}

function isSelectorContainerPseudo(
  name: string,
): name is 'has' | 'is' | 'not' | 'where' {
  return (
    name === 'has' || name === 'is' || name === 'not' || name === 'where'
  )
}

function isStandardPseudoClassFunction(name: string): boolean {
  return (
    name === 'lang' ||
    name === 'dir' ||
    name === 'nth-child' ||
    name === 'nth-last-child' ||
    name === 'nth-col' ||
    name === 'nth-last-col' ||
    name === 'nth-of-type' ||
    name === 'nth-last-of-type'
  )
}
