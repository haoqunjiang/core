import { bench, describe } from 'vitest'
import { Features, transform } from 'lightningcss'
import {
  compileStyle as _compileStyle,
  compileStyleWithLightningCss as _compileStyleWithLightningCss,
} from '../src/compileStyle'
import { createStyleLightningCSSVisitor } from '../src/style/lightningcss'
import { analyzeStyleLightningCSSFeatures } from '../src/style/lightningcss/features'
import { markImplicitNestedSelectors } from '../src/style/lightningcss/nesting'
import { scopeLightningCssSource } from '../src/style/lightningcss/sourceScope'

const compileStyle = _compileStyle
const compileStyleWithLightningCss = _compileStyleWithLightningCss

const simpleScopedSource = Array.from(
  { length: 80 },
  (_, index) =>
    `.card-${index} .title-${index}:where(:hover) > * { color: red; }`,
).join('\n')

const vueScopedFunctionSource = Array.from({ length: 40 }, (_, index) =>
  [
    `.root-${index} :deep(.inner-${index} .copy-${index}) { color: red; }`,
    `.root-${index} ::v-slotted(.slot-${index} .leaf-${index}) { color: blue; }`,
    `:is(.root-${index} :deep(.branch-${index})) { color: green; }`,
    `.root-${index} ::v-global(.external-${index} .leaf-${index}) { color: black; }`,
  ].join('\n'),
).join('\n')

const nestedScopedSource = Array.from(
  { length: 40 },
  (_, index) =>
    `.card-${index} {
  color: red;
  @media (max-width: 800px) {
    color: blue;
    .title-${index} {
      color: green;
    }
  }
  .body-${index} {
    color: black;
  }
}`,
).join('\n')

function compileWith(compile: typeof compileStyle, source: string) {
  const result = compile({
    source,
    filename: 'bench.css',
    id: 'data-v-bench',
    scoped: true,
  })

  if (result.errors.length) {
    throw result.errors[0]
  }

  return result.code
}

function transformWithLightningCss(
  source: string,
  options: Omit<Parameters<typeof transform>[0], 'filename' | 'code'> = {},
) {
  return transform({
    filename: 'bench.css',
    code: new TextEncoder().encode(source),
    nonStandard: {
      deepSelectorCombinator: true,
    },
    ...options,
  }).code
}

const loweredNestedSource = new TextDecoder().decode(
  transformWithLightningCss(nestedScopedSource, {
    include: Features.Nesting,
  }),
)
const markedNestedSource = markImplicitNestedSelectors(
  nestedScopedSource,
  'bench.css',
).code
const loweredMarkedNestedSource = new TextDecoder().decode(
  transformWithLightningCss(markedNestedSource, {
    include: Features.Nesting,
  }),
)

compileWith(compileStyleWithLightningCss, '.warmup { color: red; }')
transformWithLightningCss('.warmup { color: red; }')
transformWithLightningCss('.warmup { color: red; }', { visitor: {} })
transformWithLightningCss('.warmup { color: red; }', {
  visitor: createStyleLightningCSSVisitor({
    features: analyzeStyleLightningCSSFeatures(
      '.warmup { color: red; }',
      'data-v-bench',
    ),
    id: 'data-v-bench',
    scoped: false,
  }),
})
transformWithLightningCss('.warmup { color: red; }', {
  visitor: createStyleLightningCSSVisitor({
    features: analyzeStyleLightningCSSFeatures(
      '.warmup { color: red; }',
      'data-v-bench',
    ),
    id: 'data-v-bench',
    scoped: true,
  }),
})

describe('compileStyle scoped CSS', () => {
  bench('postcss simple selectors', () => {
    compileWith(compileStyle, simpleScopedSource)
  })

  bench('lightningcss simple selectors', () => {
    compileWith(compileStyleWithLightningCss, simpleScopedSource)
  })
})

describe('compileStyle scoped CSS with Vue selector functions', () => {
  bench('postcss vue selector functions', () => {
    compileWith(compileStyle, vueScopedFunctionSource)
  })

  bench('lightningcss vue selector functions', () => {
    compileWith(compileStyleWithLightningCss, vueScopedFunctionSource)
  })
})

describe('compileStyle scoped CSS with nested rules', () => {
  bench('postcss nested selectors', () => {
    compileWith(compileStyle, nestedScopedSource)
  })

  bench('lightningcss nested selectors', () => {
    compileWith(compileStyleWithLightningCss, nestedScopedSource)
  })
})

describe('lightningcss transform breakdown', () => {
  bench('transform only simple selectors', () => {
    transformWithLightningCss(simpleScopedSource)
  })

  bench('transform + no-op visitor simple selectors', () => {
    transformWithLightningCss(simpleScopedSource, { visitor: {} })
  })

  bench('transform + scoped visitor simple selectors', () => {
    transformWithLightningCss(simpleScopedSource, {
      visitor: createStyleLightningCSSVisitor({
        features: analyzeStyleLightningCSSFeatures(
          simpleScopedSource,
          'data-v-bench',
        ),
        id: 'data-v-bench',
        scoped: true,
      }),
    })
  })
})

describe('lightningcss source preparation breakdown', () => {
  bench('analyze features simple selectors', () => {
    analyzeStyleLightningCSSFeatures(simpleScopedSource, 'data-v-bench')
  })

  bench('scope source simple selectors', () => {
    scopeLightningCssSource(simpleScopedSource, 'data-v-bench', false)
  })

  bench('analyze features vue selector functions', () => {
    analyzeStyleLightningCSSFeatures(vueScopedFunctionSource, 'data-v-bench')
  })

  bench('scope source vue selector functions', () => {
    scopeLightningCssSource(vueScopedFunctionSource, 'data-v-bench', true)
  })
})

describe('lightningcss transform breakdown with Vue selector functions', () => {
  bench('transform only vue selector functions', () => {
    transformWithLightningCss(vueScopedFunctionSource)
  })

  bench('transform + no-op visitor vue selector functions', () => {
    transformWithLightningCss(vueScopedFunctionSource, { visitor: {} })
  })

  bench('transform + scoped visitor vue selector functions', () => {
    transformWithLightningCss(vueScopedFunctionSource, {
      visitor: createStyleLightningCSSVisitor({
        features: analyzeStyleLightningCSSFeatures(
          vueScopedFunctionSource,
          'data-v-bench',
        ),
        id: 'data-v-bench',
        scoped: true,
      }),
    })
  })
})

describe('lightningcss native nesting breakdown', () => {
  bench('transform only nested selectors', () => {
    transformWithLightningCss(nestedScopedSource)
  })

  bench('transform + no-op visitor nested selectors', () => {
    transformWithLightningCss(nestedScopedSource, { visitor: {} })
  })

  bench('transform + stylesheet-exit no-op nested selectors', () => {
    transformWithLightningCss(nestedScopedSource, {
      visitor: {
        StyleSheetExit(sheet) {
          return sheet
        },
      },
    })
  })

  bench('transform + include nesting nested selectors', () => {
    transformWithLightningCss(nestedScopedSource, {
      include: Features.Nesting,
    })
  })

  bench('mark implicit nested selectors', () => {
    markImplicitNestedSelectors(nestedScopedSource, 'bench.css')
  })

  bench('scope source lowered nested selectors', () => {
    scopeLightningCssSource(loweredNestedSource, 'data-v-bench', false)
  })

  bench('scope source lowered marked nested selectors', () => {
    scopeLightningCssSource(loweredMarkedNestedSource, 'data-v-bench', false)
  })

  bench('transform + scoped visitor lowered nested selectors', () => {
    transformWithLightningCss(loweredNestedSource, {
      visitor: createStyleLightningCSSVisitor({
        features: analyzeStyleLightningCSSFeatures(
          loweredNestedSource,
          'data-v-bench',
        ),
        id: 'data-v-bench',
        scoped: true,
      }),
    })
  })

  bench('transform + scoped visitor lowered marked nested selectors', () => {
    transformWithLightningCss(loweredMarkedNestedSource, {
      visitor: createStyleLightningCSSVisitor({
        features: analyzeStyleLightningCSSFeatures(
          loweredMarkedNestedSource,
          'data-v-bench',
        ),
        id: 'data-v-bench',
        scoped: true,
      }),
    })
  })
})
