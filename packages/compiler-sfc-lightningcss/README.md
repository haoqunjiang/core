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
- `trim: false`

When those option shapes are needed, use `@vue/compiler-sfc`.

## Related Packages

- `@vue/compiler-sfc`
  The default compiler-sfc package with the PostCSS-based style compiler.
- `@vue/lightningcss-lexer`
  Shared lexer utilities used by this package’s source-level style pipeline.

## Dependency

This package requires `lightningcss` to be available in the dependency tree.
