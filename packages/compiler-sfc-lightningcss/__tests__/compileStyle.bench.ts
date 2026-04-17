import { bench, describe } from 'vitest'
import { Features, transform } from 'lightningcss'
import { compileStyle as _compileStyle } from '@vue/compiler-sfc'
import {
  compileStyle as _compileStyleWithLightningCss,
  createLightningCssStyleVisitor,
} from '../src'
import { analyzeLightningCssStyle } from '../src/style/lightningcss/analysis'
import { normalizeNestedStyleBlocks } from '../src/style/lightningcss/nesting/normalize'
import { scopeLightningCssSource } from '../src/style/lightningcss/scoped/source'

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
    `.root-${index} :slotted(.slot-${index} .leaf-${index}) { color: blue; }`,
    `:is(.root-${index} :deep(.branch-${index})) { color: green; }`,
    `.root-${index} :global(.external-${index} .leaf-${index}) { color: black; }`,
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

const nestedCarrierScopedSource = Array.from({ length: 20 }, (_, index) =>
  [
    `:slotted(.slot-${index}) {
  .inner-${index} { color: red; }
  @media (max-width: 800px) {
    .leaf-${index} { color: blue; }
  }
}`,
    `:not(:deep(.branch-${index})) {
  .copy-${index} { color: green; }
}`,
    `.root-${index} {
  :global(.external-${index}) { color: black; }
}`,
  ].join('\n'),
).join('\n')

const mixedRealisticScopedSource = Array.from({ length: 20 }, (_, index) =>
  [
    `.card-${index} .title-${index}:where(:hover) > * { color: red; }`,
    `.panel-${index} {
  color: red;
  .body-${index} { color: blue; }
  @media (max-width: 800px) {
    .meta-${index} { color: green; }
  }
}`,
    `:slotted(.slot-${index}) {
  .item-${index} { color: orange; }
}`,
    `:not(:deep(.remote-${index})) {
  .copy-${index} { color: purple; }
}`,
    `.wrapper-${index} {
  :global(.external-${index}) { color: black; }
}`,
  ].join('\n'),
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

function compileWithLightningCssUsingNormalizedNestedScoping(source: string) {
  const normalizedSource = normalizeNestedStyleBlocks(source, 'bench.css').code
  const analysis = analyzeLightningCssStyle(normalizedSource, 'data-v-bench')
  const scopedSource = scopeLightningCssSource(
    normalizedSource,
    'data-v-bench',
    analysis.hasScopedSelectorSpecials,
  )

  return transformWithLightningCss(scopedSource, {
    include: analysis.hasNestedStyleRules ? Features.Nesting : undefined,
    visitor: createLightningCssStyleVisitor({
      analysis,
      id: 'data-v-bench',
      scoped: true,
      selectorsScopedInSource: true,
    }),
  })
}

const normalizedNestedSource = normalizeNestedStyleBlocks(
  nestedScopedSource,
  'bench.css',
).code
const loweredNormalizedNestedSource = new TextDecoder().decode(
  transformWithLightningCss(normalizedNestedSource, {
    include: Features.Nesting,
  }),
)

compileWith(compileStyleWithLightningCss, '.warmup { color: red; }')
transformWithLightningCss('.warmup { color: red; }')
transformWithLightningCss('.warmup { color: red; }', { visitor: {} })
transformWithLightningCss('.warmup { color: red; }', {
  visitor: createLightningCssStyleVisitor({
    analysis: analyzeLightningCssStyle(
      '.warmup { color: red; }',
      'data-v-bench',
    ),
    id: 'data-v-bench',
    scoped: false,
  }),
})
transformWithLightningCss('.warmup { color: red; }', {
  visitor: createLightningCssStyleVisitor({
    analysis: analyzeLightningCssStyle(
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

describe('compileStyle scoped CSS with nested Vue carriers', () => {
  bench('postcss nested carrier selectors', () => {
    compileWith(compileStyle, nestedCarrierScopedSource)
  })

  bench('lightningcss nested carrier selectors', () => {
    compileWith(compileStyleWithLightningCss, nestedCarrierScopedSource)
  })

  bench('lightningcss nested carrier selectors (normalized source path)', () => {
    compileWithLightningCssUsingNormalizedNestedScoping(
      nestedCarrierScopedSource,
    )
  })
})

describe('compileStyle scoped CSS with mixed realistic styles', () => {
  bench('postcss mixed realistic styles', () => {
    compileWith(compileStyle, mixedRealisticScopedSource)
  })

  bench('lightningcss mixed realistic styles', () => {
    compileWith(compileStyleWithLightningCss, mixedRealisticScopedSource)
  })

  bench('lightningcss mixed realistic styles (normalized source path)', () => {
    compileWithLightningCssUsingNormalizedNestedScoping(
      mixedRealisticScopedSource,
    )
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
      visitor: createLightningCssStyleVisitor({
        analysis: analyzeLightningCssStyle(
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
  bench('analyze style simple selectors', () => {
    analyzeLightningCssStyle(simpleScopedSource, 'data-v-bench')
  })

  bench('scope source simple selectors', () => {
    scopeLightningCssSource(simpleScopedSource, 'data-v-bench', false)
  })

  bench('analyze style vue selector functions', () => {
    analyzeLightningCssStyle(vueScopedFunctionSource, 'data-v-bench')
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
      visitor: createLightningCssStyleVisitor({
        analysis: analyzeLightningCssStyle(
          vueScopedFunctionSource,
          'data-v-bench',
        ),
        id: 'data-v-bench',
        scoped: true,
      }),
    })
  })
})

describe('lightningcss transform breakdown with nested Vue carriers', () => {
  bench('transform only nested carrier selectors', () => {
    transformWithLightningCss(nestedCarrierScopedSource)
  })

  bench('transform + include nesting nested carrier selectors', () => {
    transformWithLightningCss(nestedCarrierScopedSource, {
      include: Features.Nesting,
    })
  })

  bench('transform + scoped visitor nested carrier selectors', () => {
    transformWithLightningCss(nestedCarrierScopedSource, {
      visitor: createLightningCssStyleVisitor({
        analysis: analyzeLightningCssStyle(
          nestedCarrierScopedSource,
          'data-v-bench',
        ),
        id: 'data-v-bench',
        scoped: true,
      }),
      include: Features.Nesting,
    })
  })
})

describe('lightningcss mixed realistic source-path breakdown', () => {
  bench('analyze style mixed realistic styles', () => {
    analyzeLightningCssStyle(mixedRealisticScopedSource, 'data-v-bench')
  })

  bench('normalize nested style blocks mixed realistic styles', () => {
    normalizeNestedStyleBlocks(mixedRealisticScopedSource, 'bench.css')
  })

  bench('scope source mixed realistic styles', () => {
    scopeLightningCssSource(mixedRealisticScopedSource, 'data-v-bench', true)
  })

  bench('normalized source path mixed realistic styles', () => {
    compileWithLightningCssUsingNormalizedNestedScoping(
      mixedRealisticScopedSource,
    )
  })
})

describe('lightningcss nesting normalization breakdown', () => {
  bench('transform only nested selectors', () => {
    transformWithLightningCss(nestedScopedSource)
  })

  bench('transform + no-op visitor nested selectors', () => {
    transformWithLightningCss(nestedScopedSource, { visitor: {} })
  })

  bench('transform + include nesting nested selectors', () => {
    transformWithLightningCss(nestedScopedSource, {
      include: Features.Nesting,
    })
  })

  bench('normalize nested style blocks', () => {
    normalizeNestedStyleBlocks(nestedScopedSource, 'bench.css')
  })

  bench('scope source normalized nested selectors', () => {
    scopeLightningCssSource(normalizedNestedSource, 'data-v-bench', true)
  })

  bench('transform + include nesting normalized nested selectors', () => {
    transformWithLightningCss(normalizedNestedSource, {
      include: Features.Nesting,
    })
  })

  bench('transform + scoped visitor normalized nested selectors', () => {
    transformWithLightningCss(normalizedNestedSource, {
      visitor: createLightningCssStyleVisitor({
        analysis: analyzeLightningCssStyle(
          normalizedNestedSource,
          'data-v-bench',
        ),
        id: 'data-v-bench',
        scoped: true,
      }),
      include: Features.Nesting,
    })
  })

  bench('scope source lowered normalized nested selectors', () => {
    scopeLightningCssSource(loweredNormalizedNestedSource, 'data-v-bench', true)
  })

  bench(
    'transform + scoped visitor lowered normalized nested selectors',
    () => {
      transformWithLightningCss(loweredNormalizedNestedSource, {
        visitor: createLightningCssStyleVisitor({
          analysis: analyzeLightningCssStyle(
            loweredNormalizedNestedSource,
            'data-v-bench',
          ),
          id: 'data-v-bench',
          scoped: true,
        }),
      })
    },
  )
})
