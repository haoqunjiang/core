import type { RawSourceMap } from '@vue/compiler-core'
import {
  type MarkImplicitNestedSelectorsResult,
  markImplicitNestedSelectorsWithMarker,
} from './lexer/source'
import {
  vueRelativeScopeMarkerName,
  vueSelectorParserOptions,
} from './vueScopedPolicy'

export type { MarkImplicitNestedSelectorsResult }

export const relativeScopeMarkerName: string = vueRelativeScopeMarkerName

export function markImplicitNestedSelectors(
  source: string,
  filename: string,
  map?: RawSourceMap,
): MarkImplicitNestedSelectorsResult {
  return markImplicitNestedSelectorsWithMarker(source, {
    filename,
    map,
    markerName: relativeScopeMarkerName,
    parserOptions: vueSelectorParserOptions,
  })
}
