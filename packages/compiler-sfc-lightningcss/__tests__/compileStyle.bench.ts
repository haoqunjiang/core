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
