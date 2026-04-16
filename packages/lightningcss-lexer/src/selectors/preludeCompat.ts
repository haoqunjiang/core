import type { Selector, SelectorList } from 'lightningcss'
import { setParsedSelectorSource } from './shared'

const keyframeSelectorPattern =
  /^(?:from|to|(?:\d+(?:\.\d+)?%))(?:\s*,\s*(?:from|to|(?:\d+(?:\.\d+)?%)))*$/i

export function parseCompatiblePreludeFragment(
  source: string,
): SelectorList | undefined {
  const trimmed = source.trim()
  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith('@')) {
    return [createOpaqueSelector(normalizeAtRulePreludeSource(trimmed))]
  }

  if (keyframeSelectorPattern.test(trimmed)) {
    return [createOpaqueSelector(trimmed)]
  }
}

function createOpaqueSelector(source: string): Selector {
  const selector: Selector = []
  setParsedSelectorSource(selector, source)
  return selector
}

function normalizeAtRulePreludeSource(source: string): string {
  return source
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim()
}
