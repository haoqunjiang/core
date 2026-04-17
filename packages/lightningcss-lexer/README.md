# Lightning CSS Lexer

This directory contains the source-level and selector-level utilities that sit
between raw CSS text and Lightning CSS.

The design goal is narrow:

- parse and rewrite selectors without committing to a full stylesheet AST pass,
- preserve enough structure to compose multiple transforms safely,
- stay compatible with Lightning CSS data shapes instead of inventing a new
  selector model.

This is a standalone package in the monorepo. It is used by `compiler-sfc`
today, but its boundary is intentionally generic enough for other
Lightning CSS-compatible source and selector transforms.

## Dependency Contract

`lightningcss` stays an optional peer on purpose.

That lets downstream packages make Lightning CSS support opt-in instead of
forcing every consumer to install it up front. The tradeoff is that the
selector-facing public types in this package reference Lightning CSS selector
types directly, so TypeScript consumers should install `lightningcss` when they
type-check against this package surface.

In practice:

- runtime use of the source-facing helpers does not load `lightningcss`
- selector-facing APIs and published `.d.ts` files assume `lightningcss` is
  available for type resolution
- packages that expose this lexer as an opt-in capability should surface a
  clear install error at the point where Lightning CSS-backed behavior is
  actually enabled

## Package Shape

The package has one runtime entrypoint, but that entrypoint is organized around
two conceptual modules:

- selector parsing and stringifying
- source-level CSS rewriting

Everything else in the package exists in support of those two surfaces.

That distinction matters. The package boundary is not “every file under
`src/`”. The useful interface is:

- parse selector lists from strings or Lightning CSS token arrays,
- stringify those selectors back,
- rewrite selector preludes inside raw CSS source,
- walk raw CSS block preludes safely,
- build a structural block tree when a source transform needs more context than
  a flat prelude walk.

## Core Design Choice

This lexer does **not** define its own selector AST.

Instead, the selector-facing API uses Lightning CSS selector shapes directly.
That keeps the bridge simple:

- higher layers do not need to translate between two selector ASTs,
- token-based fallbacks from Lightning CSS can feed directly back into the same
  representation,
- selector transforms can compose with Lightning CSS visitors and serializers
  without another model-conversion step.

The package is therefore best read as:

- a parser/stringifier pair for a Lightning CSS-compatible selector subset, and
- a source-rewrite layer built around that parser.

## Test Coverage

The package keeps its tests split by API surface:

- selector-facing behavior, including migrated compatibility cases from
  `postcss-selector-parser`
- source-facing behavior for block walking, selector-prelude rewriting, block
  tree parsing, and direct prelude scoping
- root-entrypoint coverage to ensure the documented package surface re-exports
  the intended selector and source APIs

That split is intentional. It keeps selector correctness, source-rewrite
behavior, and package-surface wiring reviewable as separate concerns.

## Selector Surface

The selector-facing exports are:

- `parseSelectorListFromString(source, options?)`
- `parseSelectorListFromTokens(tokens, options?)`
- `stringifySelector(selector)`
- `stringifyTokens(tokens)`
- `SelectorParserOptions`

### Contract

`parseSelectorListFromString(...)` parses selector lists from source text into
Lightning CSS selector data.

`parseSelectorListFromTokens(...)` exists for the Lightning CSS integration
case where custom selector-function arguments are exposed as `TokenOrValue[]`
instead of structured selectors.

`stringifySelector(...)` and `stringifyTokens(...)` are the paired serializers
for the subset produced by this lexer. They should be treated as part of the
same module contract, not as general-purpose printers for arbitrary CSS data.

### Parser Options

`SelectorParserOptions` currently exposes one important extension point:

- `selectorListFunctionNames`

That option lets a caller declare custom function-like selectors whose
arguments should be parsed structurally as selector lists. This is the hook
used by higher-level transforms that need custom selector functions to behave
like `:is(...)` or `:where(...)` from the parser’s point of view.

The option is intentionally narrow. It describes syntax, not transform policy.

### What The Selector Surface Is Good At

- Standard rule selectors that need to round-trip through Lightning CSS-shaped
  selector data.
- Parsing from either raw strings or Lightning CSS token arrays.
- Structural handling of selector-list pseudo arguments.
- Source-preserving round-trips for untouched parsed selectors when comments are
  present.

### What The Selector Surface Does Not Try To Be

- A PostCSS-compatible mutable AST.
- A permissive parser for every CSS-adjacent fragment another library may
  accept.
- A parser for preprocessor interpolation or framework-specific selector
  syntaxes.
- A general parser for arbitrary pseudo-function argument grammars. It parses
  selector-list arguments structurally; other argument forms are handled only
  where this package explicitly supports them.

## Source Surface

The source-facing exports are:

- `walkCssBlockPreludes(source, visitPrelude)`
- `rewriteCssSelectorSource(source, options)`
- `parseCssBlockTree(source)`
- `scopeSelectorPrelude(prelude, id)`
- `CssBlockPrelude`
- `CssBlockKind`
- `CssSelectorSourceRewriteOptions`
- `CssBlockNode`

### `walkCssBlockPreludes(...)`

This is the smallest source-level primitive in the package.

It scans raw CSS, identifies each block prelude at the point its `{` is
encountered, and reports both:

- the original prelude slice
- a normalized form with comments removed and surrounding whitespace trimmed

Use it when a transform needs to inspect or classify blocks but does not need a
full block tree.

### `rewriteCssSelectorSource(...)`

This is the central source-rewrite primitive.

It walks raw CSS, finds rule selector preludes, and rewrites only those
preludes. Declaration blocks and non-selector at-rules are left untouched.

The callback contract is intentionally collector-based:

- an optional `tryRewritePreludeDirect(prelude)` fast path may rewrite the
  whole selector list directly from source text,
- otherwise the prelude is parsed structurally,
- `appendRewrittenSelectors(selector, target)` appends zero or more rewritten
  selectors into a caller-owned array.

That shape is important for both performance and future flexibility:

- the common path avoids wrapper allocations,
- one input selector may legitimately expand into multiple outputs,
- callers are not coupled to a specific internal parser implementation.

### `parseCssBlockTree(...)`

This is the structural source parser.

It does not try to understand declarations semantically. It only records block
boundaries, preludes, and child relationships so a source-level transform can
answer questions like:

- which nested blocks belong to this rule body?
- where is the raw source range for this body?
- is this block a style rule, an at-rule, or a keyframes block?

This is the API to use when a transform needs more than a flat “visit each
prelude” walk.

### `scopeSelectorPrelude(...)`

This helper is different from the other `source` APIs: it is intentionally
specialized.

It performs one very specific fast-path rewrite:

- inject a fixed attribute selector into a selector-list prelude,
- without building a selector AST,
- and return `undefined` when the prelude is outside the direct path’s supported
  subset.

So `scopeSelectorPrelude(...)` should be read as a convenience helper
built on the same lexer ideas, not as the core abstraction of the package.
It is best treated as an opt-in fast path rather than the centerpiece of the
API.

## Relation Between The Two Surfaces

The source-facing API depends on the selector-facing API. The selector-facing
API does not depend on the source-facing one.

That is the intended layering:

1. `source` discovers the selector preludes that matter.
2. A direct text rewrite may handle the easy case.
3. If not, `selectors` parses the prelude into Lightning CSS selector data.
4. The caller rewrites those selectors.
5. `selectors` stringifies the results back to source.

This separation is the main package boundary to preserve.

## Compatibility Boundary

The target is **Lightning CSS-compatible selector rewriting**, not compatibility
with every tolerant parser behavior in the ecosystem.

In practice, that means:

- standard CSS selectors used in rule preludes are in scope,
- Lightning CSS token-array bridging is in scope,
- selector-adjacent compatibility shims may exist where they help integration,
- preprocessor interpolation and framework-specific selector dialects are out of
  scope,
- permissive fragments that Lightning CSS itself rejects are generally out of
  scope.

That is also why this package is not a replacement for
`postcss-selector-parser`.

## Relation to `postcss-selector-parser`

`postcss-selector-parser` is broader and more tolerant.

It is a good fit when a pipeline wants:

- a general selector parser,
- a mutable selector AST,
- compatibility with PostCSS-style source preservation and ecosystem behavior.

This lexer is narrower and more opinionated:

- it uses Lightning CSS selector shapes directly,
- it is designed to compose with source-level rewriting,
- it prefers explicit fast paths plus structural fallback,
- it does not aim to model every permissive syntax another selector parser may
  accept.

So the comparison is useful, but the roles are different:

- `postcss-selector-parser` is a selector library,
- this lexer is a Lightning CSS-oriented selector/source bridge.

## Internal Files

The main internal implementation files are:

- `selectors/parseString.ts`
- `selectors/parseTokens.ts`
- `selectors/stringify.ts`
- `selectors/shared.ts`
- `source/rewrite.ts`
- `source/blockTree.ts`
- `source/directScope.ts`
- `blockPrelude.ts`

They are useful to read when working on the implementation, but they should not
be treated as separate public interfaces. The boundary to preserve is still:

- selector parsing/stringifying
- source-level CSS rewriting

## When To Use This Layer

Use this lexer when a transform needs all or most of the following:

- selector rewriting from raw CSS source,
- compatibility with Lightning CSS selector shapes,
- a cheap direct path for ordinary selectors,
- a richer structural fallback for the rest,
- structural source parsing without committing to a full stylesheet AST pass.

Do not use it when a transform primarily wants:

- a full CSS AST API,
- broad preprocessor or framework-syntax coverage,
- or a general-purpose selector library independent of Lightning CSS.
