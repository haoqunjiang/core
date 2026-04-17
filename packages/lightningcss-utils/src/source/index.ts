export {
  walkCssBlockPreludes,
  type CssBlockKind,
  type CssBlockPrelude,
} from './preludes'
export { scopeSelectorPrelude } from './scopePrelude'
export type { CssBlockNode } from './blockTree'
export { parseCssBlockTree } from './blockTree'
export {
  findLastNonWhitespaceIndex,
  findTrimmedSourceRange,
  forEachTopLevelTextRange,
  hasMeaningfulCssText,
  someTopLevelTextRange,
} from './segments'
export type {
  CssSourceMapMerge,
  CssSelectorSourceRewriteOptions,
  CssSelectorSourceRewriteWithMapResult,
} from './rewrite'
export {
  rewriteCssSelectorSource,
  rewriteCssSelectorSourceWithMap,
} from './rewrite'
