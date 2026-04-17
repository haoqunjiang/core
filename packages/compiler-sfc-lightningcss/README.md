# Compiler SFC Lightning CSS

`@vue/compiler-sfc-lightningcss` is a compiler-module variant of
`@vue/compiler-sfc` whose style compiler is implemented with Lightning CSS.

The package re-exports the public `@vue/compiler-sfc` surface so tooling can
swap it in as a compiler-module override, but it owns its own style engine:

- `compileStyle(...)`
- `compileStyleAsync(...)`
- `compileStyleWithLightningCss(...)`

Everything outside style compilation is still passed through from
`@vue/compiler-sfc`.

## Intended Use

The main target is tooling that already accepts a compiler-module override,
such as `@vitejs/plugin-vue`:

```ts
import vue from '@vitejs/plugin-vue'
import * as compiler from '@vue/compiler-sfc-lightningcss'

export default {
  plugins: [vue({ compiler })],
}
```

That is the reason this package re-exports the whole compiler surface instead
of shipping only a standalone `compileStyle`.

## Style Compiler Contract

This package is intentionally strict.

It does **not** emulate the full PostCSS-based style pipeline from
`@vue/compiler-sfc`. Unsupported style options fail fast instead of silently
falling back.

Supported:

- ordinary `<style>` and `<style scoped>` compilation
- Vue selector functions such as `:deep()`, `:slotted()`, and `:global()`
- nested CSS via source normalization + Lightning CSS lowering
- `postcssOptions.map`, which is the sourcemap request shape commonly used by
  `@vitejs/plugin-vue`
- `compileStyleAsync(..., { modules: true })` for Lightning CSS's built-in CSS
  Modules support
  - supported subset:
    - default local scoping
    - Lightning CSS's default naming, which currently uses `[hash]_[local]`
    - `modulesOptions.generateScopedName` as a string pattern using only
      `[name]`, `[local]`, and `[hash]`
    - `modulesOptions.localsConvention`
  - note:
    - this stays async-only to match `@vue/compiler-sfc`'s public API contract,
      even though the underlying Lightning CSS modules transform is synchronous

Unsupported:

- `postcssPlugins`
- `postcssOptions` keys other than `map`
- `compileStyle(..., { modules: true })`
- `modules` combined with `scoped`
- CSS Modules options outside the supported Lightning CSS subset, including
  `scopeBehaviour: 'global'`, function `generateScopedName`, `hashPrefix`,
  `exportGlobals`, and `globalModulePaths`
- legacy scoped selector syntax such as `>>>`, `/deep/`, `::v-deep(...)`,
  `::v-slotted(...)`, and `::v-global(...)`; use `:deep()`, `:slotted()`, and
  `:global()` instead. These are good future codemod targets.
- `trim: false`

When those option shapes are needed, use `@vue/compiler-sfc`.

## Intentional Drifts

This package currently has a small set of intentional semantic drifts from the
current PostCSS-based `@vue/compiler-sfc` implementation.

- Valid wildcard selectors such as `* + :hover` and `svg|*` are preserved as
  valid scoped selectors even though the current PostCSS path still has edge
  cases around some wildcard forms.
- Logical selector wrappers such as `:has(...)` and `:not(...)` keep an outer
  component scope anchor even when their inner branches contain Vue carriers
  like `:deep(...)` or `:slotted(...)`. This avoids turning the whole selector
  into an unanchored global match when the carrier rewrite happens inside the
  logical wrapper.
- Animation/keyframes rewriting follows CSS parsing rather than the current
  PostCSS string heuristic. In practice this means ambiguous shorthands like
  `animation: paused foo 1s` rewrite the actual animation-name (`foo`) instead
  of the first matching token, and keyword-only shorthands like
  `animation: ease 1s` remain non-keyframe shorthands rather than being treated
  as references to local `@keyframes ease`. The same source rewrite also
  follows keyframe names through `var()` fallbacks such as
  `animation-name: var(--anim, foo)` and `animation: var(--anim, foo) 1s`.
- `:slotted(...)` keeps slot context through nested conditional at-rules such
  as `@media`, `@supports`, and `@container`. For example,
  `:slotted(.x) { @media print { .b {} } }` is treated as matching slotted
  content under the media condition rather than re-entering the component's
  local scope inside the at-rule.
- Mixed selector-list branches that disagree about deep/slot nesting context
  are handled conservatively. For example, nested rules under
  `:slotted(.x), .y` keep the descendant locally scoped instead of trying to
  distribute branch-specific nesting context through the selector list. In
  development, this emits a warning so the selector can be split explicitly if
  the branch-specific behavior matters.
- Native `@scope` root and limit selectors are not source-scoped yet. This is
  currently a compatible limitation with the PostCSS compiler, which also
  leaves `@scope` selectors untouched in scoped styles.
- CSS Modules default naming follows Lightning CSS's built-in `[hash]_[local]`
  pattern rather than the current `@vue/compiler-sfc` / `postcss-modules`
  default function (`_<local>_<hash>_<line>`). Provide an explicit
  `modulesOptions.generateScopedName` pattern when stable naming matters more
  than compiler-sfc parity.
- Animation declaration detection and `var()` fallback rewriting are handled
  case-insensitively, so valid inputs such as `Animation: foo 1s` and
  `animation-name: Var(--anim, foo)` stay aligned with renamed local
  `@keyframes`. The current PostCSS compiler still uses lowercase-only
  heuristics for these cases.

## Related Packages

- `@vue/compiler-sfc`
  The default compiler-sfc package with the PostCSS-based style compiler.
- `@vue/lightningcss-utils`
  Shared selector and source utilities used by this package’s style pipeline.

## Dependency

This package requires `lightningcss` to be available in the dependency tree.
