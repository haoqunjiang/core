# Lightning CSS Lexer Helpers

This directory contains small, focused utilities for source-level CSS rewriting.

They exist for one specific reason: some style transforms are easier and cheaper
to express by looking at selector source text and lightweight selector data than
by walking a full stylesheet AST.

These helpers are intentionally lower level than the Vue-specific style
transforms built on top of them.

## Overview

A CSS transform does not always need a full CSS parser.

For many tasks, the interesting part is only the selector prelude:

```css
.card > .title, :where(.a, .b) { color: red; }
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

If a transform only needs to rewrite selectors and can leave declaration blocks
alone, a source-level pass can be simpler and faster than a whole-stylesheet
rewrite.

That is the design center of this directory:

- read raw CSS source,
- identify selector preludes safely,
- parse only the selector subset we need,
- rewrite selectors,
- serialize them back to source.

## What This Layer Is

This is:

- a lightweight selector parser for a constrained subset,
- a source walker that only rewrites selector preludes,
- a few utilities for preserving selector intent across separate transforms.

This is not:

- a general-purpose CSS parser,
- a public package API,
- a promise to support every CSS construct Lightning CSS may represent.

The code here is internal infrastructure for compiler-sfc. It is written so
that it could be extracted later, but it should still be treated as internal.

Examples of intentionally unsupported or only partially supported cases in the
current lightweight parser include:

- namespace selectors such as `svg|a`, `*|a`, or `|a`,
- CSS escape syntax in selector source,
- functional pseudo-classes or pseudo-elements whose arguments are not selector
  lists, such as `:lang(...)`, `:dir(...)`, `:nth-child(...)`, `:part(...)`, or
  `::cue(...)`,
- framework-specific selector semantics that belong in a higher policy layer
  rather than in the generic lexer.

That does not mean a higher-level pipeline can never support those cases. It
only means this directory does not try to parse all of them structurally.

## Relation to `postcss-selector-parser`

`postcss-selector-parser` is the closest reference point for this directory, but
the two serve different roles.

`postcss-selector-parser` is a general-purpose selector parser and transformer.
It is a good fit when a transform wants a rich selector AST and is comfortable
living fully in a PostCSS-oriented pipeline.

The helpers here are narrower:

- they are designed around source-level CSS rewriting, not just selector AST
  manipulation,
- they include a direct source fast path that can skip selector AST creation for
  simple cases,
- they only support the selector subset needed by this pipeline,
- they are meant to compose with Lightning CSS rather than replace it.

So this directory should be read as a specialized internal bridge, not as an
alternative selector library. If a use case needs broad selector coverage and a
general transformation API, `postcss-selector-parser` is the more appropriate
mental model.

## Design Goals

- Keep the common path cheap.
- Make fallbacks explicit.
- Keep the generic layer free of framework semantics.
- Avoid coupling the API shape to a specific implementation detail.
- Preserve enough structure to compose multiple passes safely.

## File Map

### `blockPrelude.ts`

Exports `walkCssBlockPreludes(...)`.

This is the shared raw-CSS block scanner used by the source-level passes in
this directory. It walks CSS safely through comments, strings, brackets, and
block nesting, and reports each block prelude in a normalized form.

Higher-level transforms should use this instead of re-implementing their own
CSS block scanner.

### `source/rewrite.ts`

Exports `rewriteCssSelectorSource(...)`.

This is the main source walker. It scans CSS source, finds selector preludes,
and rewrites only those preludes. It does not parse or modify declaration
blocks.

Callers provide:

- an optional direct prelude rewrite fast path,
- selector parser options,
- a selector rewrite callback that appends rewritten selectors to a target
  array.

That callback shape is intentional. It keeps the hot path free of unnecessary
wrapper allocations and allows the underlying implementation to evolve without
changing the contract.

### `source/directScope.ts`

Exports `tryScopeSelectorPreludeDirect(...)` and
`DirectSelectorScopePolicy`.

This is a fast source-to-source selector rewriter for simple cases. It works
without building a selector AST and returns `undefined` when it sees syntax it
does not want to handle.

That `try...` shape is important. The direct path is an optimization, not the
only path. Callers are expected to fall back to a richer rewrite when needed.

### `selectors/index.ts`

Exports:

- `parseSelectorListFromString(...)`
- `parseSelectorListFromTokens(...)`
- `SelectorParserOptions`

This is the public entrypoint for the small selector parser used by the
source-level rewriting pipeline. It supports the subset needed by compiler-sfc
and by the other helpers in this directory.

It also supports a configurable set of function-like selectors whose arguments
should be parsed as selector lists. That makes it useful for transforms that
need to treat custom selector functions structurally instead of as raw text.

The implementation is split internally into:

- `selectors/parseString.ts` for string-source parsing,
- `selectors/parseTokens.ts` for Lightning CSS token-array parsing,
- `selectors/shared.ts` for shared node builders and parser primitives.

### `selectors/stringify.ts`

Exports:

- `stringifySelector(...)`
- `stringifyTokens(...)`

These functions serialize the subset produced by the local lexer helpers. They
pair with `selectors/`; they are not meant to be a universal serializer for
arbitrary Lightning CSS data.

### `source/nesting.ts`

Exports `markImplicitNestedSelectorsWithMarker(...)`.

Some transforms need to preserve the difference between an explicitly relative
selector and one that is only implicitly relative before another pass lowers CSS
nesting.

This helper marks that boundary using a synthetic selector marker so a later
pass can still make the right decision after nesting has been lowered.

This mechanism is generic. Any pipeline that needs to preserve implicit nesting
intent across a separate lowering step can use the same idea.

## How The Pieces Fit Together

A typical pipeline looks like this:

1. Analyze or preprocess raw CSS source.
2. Optionally preserve structural information that might be lost by a later
   transform, such as implicit nesting boundaries.
3. Run another transform, such as native nesting lowering.
4. Rewrite selector preludes with `rewriteCssSelectorSource(...)`.
5. Fall back from direct source rewrites to parsed selector rewrites when a
   selector is too complex for the fast path.

The important boundary is this:

- this directory provides generic selector/source mechanics,
- higher layers decide what the transform means.

## Why Not Just Use One Full AST Pass?

Because the job here is narrower than “rewrite CSS”.

If a transform only changes selectors, a smaller tool can be a better fit:

- less data to materialize,
- fewer nodes to visit,
- clearer boundaries between generic mechanics and transform policy,
- easier composition with another engine that already handles full CSS parsing
  and lowering.

That tradeoff only works if the boundaries are explicit. The APIs here are
designed around that assumption.

## Possible Uses Beyond Vue

Although these helpers currently live inside compiler-sfc, the underlying ideas
are broader:

- rewriting rule selectors in raw CSS source,
- parsing selector lists from strings or token arrays,
- preserving structural selector intent across multi-pass transforms,
- mixing a cheap source-level fast path with a richer fallback path.

If this code is ever extracted, that is the level of reuse it should aim for:
generic selector/source infrastructure, not framework-specific semantics.
