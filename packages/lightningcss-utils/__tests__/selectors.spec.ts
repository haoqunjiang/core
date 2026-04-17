import type { SelectorList } from 'lightningcss'
import {
  parseSelectorListFromString,
  stringifySelector,
} from '../src/selectors'
import type { SelectorParserOptions } from '../src/selectors'

/**
 * Migrated from the parser-focused suites in
 * `postcss-selector-parser/src/__tests__`.
 *
 * This suite covers the selector-facing API of `@vue/lightningcss-utils`.
 *
 * Not migrated:
 * - `attributes-deprecations.mjs`, `constructors.mjs`, `container.mjs`,
 *   `guards.mjs`, `node.mjs`, `postcss.mjs`, `sourceIndex.mjs`,
 *   `stripComments.mjs`
 *   These exercise postcss-selector-parser's own node/container APIs rather
 *   than this package's selector parser.
 * - `parser.mjs`
 *   This focuses on the upstream processor/transform API and node constructors,
 *   not just selector parsing.
 * - `lossy.mjs`
 *   The upstream file tests a separate `lossless: false` serializer mode. This
 *   lexer exposes one canonical serializer instead, so the cases that still map
 *   cleanly are adapted below rather than copied verbatim.
 */

interface SupportedCase {
  name: string
  input: string
  expected?: string | false
  options?: SelectorParserOptions
  assert?: (selectors: SelectorList) => void
}

interface ErrorCase {
  name: string
  input: string
}

const customSelectorListFunctionOptions: SelectorParserOptions = {
  selectorListFunctionNames: new Set(['current']),
}

function stringifySelectorList(selectors: SelectorList): string {
  return selectors.map(selector => stringifySelector(selector)).join(', ')
}

function parseAndStringify(
  input: string,
  options?: SelectorParserOptions,
): string {
  return stringifySelectorList(parseSelectorListFromString(input, options))
}

function runSupportedCases(cases: SupportedCase[]) {
  for (const { name, input, expected, options, assert } of cases) {
    test(name, () => {
      const selectors = parseSelectorListFromString(input, options)
      if (expected !== false) {
        expect(stringifySelectorList(selectors)).toBe(expected ?? input)
      }
      assert?.(selectors)
    })
  }
}

function runErrorCases(cases: ErrorCase[]) {
  for (const { name, input } of cases) {
    test(name, () => {
      expect(() => parseSelectorListFromString(input)).toThrow()
    })
  }
}

test('stringifySelector ignores cached raw source after selector mutation', () => {
  const selectors = parseSelectorListFromString('.foo/* comment */.bar')
  selectors[0].push({
    type: 'attribute',
    name: 'data-test',
    namespace: null,
    operation: null,
  })

  expect(stringifySelector(selectors[0])).toBe('.foo.bar[data-test]')
})

describe('migrated from tags.mjs', () => {
  runSupportedCases([
    {
      name: 'tag selector',
      input: 'h1',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'type', name: 'h1' })
      },
    },
    {
      name: 'multiple tag selectors',
      input: 'h1, h2',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'type', name: 'h1' })
        expect(selectors[1][0]).toMatchObject({ type: 'type', name: 'h2' })
      },
    },
    {
      name: 'extraneous non-combinating whitespace',
      input: '  h1   ,  h2   ',
      expected: 'h1, h2',
    },
    {
      name: 'tag with trailing comma',
      input: 'h1,',
      expected: 'h1',
    },
    {
      name: 'tag with attribute',
      input: 'label[for="email"]',
      expected: 'label[for=email]',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'type', name: 'label' })
        expect(selectors[0][1]).toMatchObject({
          type: 'attribute',
          name: 'for',
          operation: {
            operator: 'equal',
            value: 'email',
          },
        })
      },
    },
  ])

  runSupportedCases([
    {
      name: 'tag with trailing slash',
      input: 'h1\\',
      expected: false,
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'type', name: 'h1\\' })
      },
    },
  ])

  runSupportedCases([
    {
      name: 'keyframes animation tag selector',
      input: '0.00%',
      expected: '0.00%',
    },
  ])
})

describe('migrated from universal.mjs', () => {
  runSupportedCases([
    {
      name: 'universal selector',
      input: '*',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'universal' })
      },
    },
    { name: 'lobotomized owl', input: '* + *' },
    { name: 'universal selector with descendant combinator', input: '* *' },
    {
      name: 'universal selector with descendant combinator and extraneous non-combinating whitespace',
      input: '*         *',
      expected: '* *',
    },
    {
      name: 'extraneous non-combinating whitespace',
      input: '  *   ,  *   ',
      expected: '*, *',
    },
    {
      name: 'qualified universal selector',
      input: '*[href] *:not(*.green)',
    },
    {
      name: 'universal selector with pseudo',
      input: '*::--webkit-media-controls-play-button',
    },
  ])
})

describe('migrated from combinators.mjs', () => {
  runSupportedCases([
    {
      name: 'multiple combinating spaces',
      input: 'h1         h2',
      expected: 'h1 h2',
    },
    {
      name: 'descendant combinator',
      input: 'h1 h2',
    },
    {
      name: 'multiple descendant combinators',
      input: 'h1 h2 h3 h4',
    },
    {
      name: 'adjacent sibling combinator',
      input: 'h1~h2',
      expected: 'h1 ~ h2',
    },
    {
      name: 'adjacent sibling combinator (2)',
      input: 'h1 ~h2',
      expected: 'h1 ~ h2',
    },
    {
      name: 'adjacent sibling combinator (3)',
      input: 'h1~ h2',
      expected: 'h1 ~ h2',
    },
    {
      name: 'adjacent sibling combinator (4)',
      input: 'h1 ~ h2',
    },
    {
      name: 'adjacent sibling combinator (5)',
      input: 'h1~h2~h3',
      expected: 'h1 ~ h2 ~ h3',
    },
    {
      name: 'multiple combinators',
      input: 'h1~h2>h3',
      expected: 'h1 ~ h2 > h3',
    },
    {
      name: 'multiple combinators with whitespaces',
      input: 'h1 + h2 > h3',
    },
    {
      name: 'multiple combinators with whitespaces (2)',
      input: 'h1+ h2 >h3',
      expected: 'h1 + h2 > h3',
    },
    {
      name: 'trailing combinator & spaces',
      input: 'p +        ',
      expected: 'p +',
    },
    {
      name: 'trailing sibling combinator',
      input: 'p ~',
      expected: 'p ~',
    },
    {
      name: 'ending in comment has no trailing combinator',
      input: '.bar /* comment 3 */',
      expected: '.bar /* comment 3 */',
    },
    {
      name: 'The combinating space is not a space character',
      input: '.bar\n.baz',
      expected: '.bar .baz',
    },
    {
      name: 'with spaces and a comment has only one combinator',
      input: '.bar /* comment 3 */ > .foo',
      expected: '.bar /* comment 3 */ > .foo',
    },
    {
      name: 'with a meaningful comment in the middle of a compound selector',
      input: 'div/* wtf */.foo',
      expected: 'div/* wtf */.foo',
    },
    {
      name: 'with a comment in the middle of a descendant selector',
      input: 'div/* wtf */ .foo',
      expected: 'div/* wtf */ .foo',
    },
  ])

  runSupportedCases([
    {
      name: 'column combinator',
      input: '.selected||td',
      expected: '.selected || td',
    },
    {
      name: 'column combinator (2)',
      input: '.selected || td',
      expected: '.selected || td',
    },
  ])

  runErrorCases([
    {
      name: 'legacy piercing combinator',
      input: '.a >>> .b',
    },
    {
      name: 'legacy named combinator',
      input: 'a /deep/ b',
    },
    {
      name: 'legacy named combinator with escapes',
      input: 'a /dee\\p/ b',
    },
    {
      name: 'legacy named combinator with escapes and uppercase',
      input: 'a /DeE\\p/ b',
    },
  ])
})

describe('migrated from nesting.mjs', () => {
  runSupportedCases([
    {
      name: 'nesting selector',
      input: '&',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'nesting' })
      },
    },
    {
      name: 'nesting selector followed by a class',
      input: '& .class',
    },
    {
      name: '&foo',
      input: '&foo',
    },
    {
      name: '&-foo',
      input: '&-foo',
    },
    {
      name: '&_foo',
      input: '&_foo',
    },
  ])

  runSupportedCases([
    {
      name: '&|foo',
      input: '&|foo',
      expected: '&|foo',
    },
  ])
})

describe('migrated from classes.mjs', () => {
  runSupportedCases([
    {
      name: 'class name',
      input: '.one',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'class', name: 'one' })
      },
    },
    {
      name: 'multiple class names',
      input: '.one.two.three',
    },
    {
      name: 'qualified class',
      input: 'button.btn-primary',
    },
    {
      name: 'extraneous non-combinating whitespace',
      input: '  .h1   ,  .h2   ',
      expected: '.h1, .h2',
    },
  ])

  runSupportedCases([
    {
      name: 'escaped numbers in class name',
      input: '.\\31\\ 0',
      expected: false,
    },
    ...[
      ['class selector with escaping', '.♥'],
      ['class selector with escaping (1)', '.©'],
      ['class selector with escaping (2)', '.“‘’”'],
      ['class selector with escaping (3)', '.☺☃'],
      ['class selector with escaping (4)', '.⌘⌥'],
      ['class selector with escaping (5)', '.𝄞♪♩♫♬'],
      ['class selector with escaping (6)', '.💩'],
    ].map(([name, input]) => ({
      name,
      input,
      expected: false as const,
    })),
    ...[
      ['escaped dot in class name', '.foo\\.bar'],
      ['class selector with escaping (7)', '.\\?'],
      ['class selector with escaping (8)', '.\\@'],
      ['class selector with escaping (9)', '.\\.'],
      ['class selector with escaping (10)', '.\\3A \\)'],
      ['class selector with escaping (11)', '.\\3A \\`\\('],
      ['class selector with escaping (12)', '.\\31 23'],
      ['class selector with escaping (13)', '.\\31 a2b3c'],
      ['class selector with escaping (14)', '.\\<p\\>'],
      ['class selector with escaping (15)', '.\\<\\>\\<\\<\\<\\>\\>\\<\\>'],
      [
        'class selector with escaping (16)',
        '.\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\[\\>\\+\\+\\+\\+\\+\\+\\+\\>\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\>\\+\\+\\+\\>\\+\\<\\<\\<\\<\\-\\]\\>\\+\\+\\.\\>\\+\\.\\+\\+\\+\\+\\+\\+\\+\\.\\.\\+\\+\\+\\.\\>\\+\\+\\.\\<\\<\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\.\\>\\.\\+\\+\\+\\.\\-\\-\\-\\-\\-\\-\\.\\-\\-\\-\\-\\-\\-\\-\\-\\.\\>\\+\\.\\>\\.',
      ],
      ['class selector with escaping (17)', '.\\#'],
      ['class selector with escaping (18)', '.\\#\\#'],
      ['class selector with escaping (19)', '.\\#\\.\\#\\.\\#'],
      ['class selector with escaping (20)', '.\\_'],
      ['class selector with escaping (21)', '.\\{\\}'],
      ['class selector with escaping (22)', '.\\#fake\\-id'],
      ['class selector with escaping (23)', '.foo\\.bar'],
      ['class selector with escaping (24)', '.\\3A hover'],
      ['class selector with escaping (25)', '.\\3A hover\\3A focus\\3A active'],
      ['class selector with escaping (26)', '.\\[attr\\=value\\]'],
      ['class selector with escaping (27)', '.f\\/o\\/o'],
      ['class selector with escaping (28)', '.f\\\\o\\\\o'],
      ['class selector with escaping (29)', '.f\\*o\\*o'],
      ['class selector with escaping (30)', '.f\\!o\\!o'],
      ['class selector with escaping (31)', ".f\\'o\\'o"],
      ['class selector with escaping (32)', '.f\\~o\\~o'],
      ['class selector with escaping (33)', '.f\\+o\\+o'],
      ['class selector with escaping (34)', '.\\1D306'],
      ['class selector with escaping (35)', '.not-pseudo\\:focus'],
      ['class selector with escaping (36)', '.not-pseudo\\:\\:focus'],
    ].map(([name, input]) => ({
      name,
      input,
      expected: false as const,
    })),
  ])
})

describe('migrated from id.mjs', () => {
  runSupportedCases([
    {
      name: 'id selector',
      input: '#one',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({ type: 'id', name: 'one' })
      },
    },
    { name: 'id selector with universal', input: '*#z98y' },
    { name: 'id hack', input: '#one#two' },
    { name: 'id and class names mixed', input: '#one.two.three' },
    { name: 'qualified id', input: 'button#one' },
    { name: 'qualified id & class name', input: 'h1#one.two' },
    { name: 'id selector with escaping (2)', input: '#-a-b-c-' },
    {
      name: 'extraneous non-combinating whitespace',
      input: '  #h1   ,  #h2   ',
      expected: '#h1, #h2',
    },
  ])

  runSupportedCases([
    ...[
      ['id selector with escaping', '#\\#test'],
      ['id selector with escaping (3)', '#u-m\\00002b'],
      ['id selector with escaping (11)', '#\\?'],
      ['id selector with escaping (12)', '#\\@'],
      ['id selector with escaping (13)', '#\\.'],
      ['id selector with escaping (14)', '#\\3A \\)'],
      ['id selector with escaping (15)', '#\\3A \\`\\('],
      ['id selector with escaping (16)', '#\\31 23'],
      ['id selector with escaping (17)', '#\\31 a2b3c'],
      ['id selector with escaping (18)', '#\\<p\\>'],
      ['id selector with escaping (19)', '#\\<\\>\\<\\<\\<\\>\\>\\<\\>'],
      [
        'id selector with escaping (20)',
        '#\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\[\\>\\+\\+\\+\\+\\+\\+\\+\\>\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\>\\+\\+\\+\\>\\+\\<\\<\\<\\<\\-\\]\\>\\+\\+\\.\\>\\+\\.\\+\\+\\+\\+\\+\\+\\+\\.\\.\\+\\+\\+\\.\\>\\+\\+\\.\\<\\<\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\+\\.\\>\\.\\+\\+\\+\\.\\-\\-\\-\\-\\-\\-\\.\\-\\-\\-\\-\\-\\-\\-\\-\\.\\>\\+\\.\\>\\.',
      ],
      ['id selector with escaping (21)', '#\\#'],
      ['id selector with escaping (22)', '#\\#\\#'],
      ['id selector with escaping (23)', '#\\#\\.\\#\\.\\#'],
      ['id selector with escaping (24)', '#\\_'],
      ['id selector with escaping (25)', '#\\{\\}'],
      ['id selector with escaping (26)', '#\\.fake\\-class'],
      ['id selector with escaping (27)', '#foo\\.bar'],
      ['id selector with escaping (28)', '#\\3A hover'],
      ['id selector with escaping (29)', '#\\3A hover\\3A focus\\3A active'],
      ['id selector with escaping (30)', '#\\[attr\\=value\\]'],
      ['id selector with escaping (31)', '#f\\/o\\/o'],
      ['id selector with escaping (32)', '#f\\\\o\\\\o'],
      ['id selector with escaping (33)', '#f\\*o\\*o'],
      ['id selector with escaping (34)', '#f\\!o\\!o'],
      ['id selector with escaping (35)', "#f\\'o\\'o"],
      ['id selector with escaping (36)', '#f\\~o\\~o'],
      ['id selector with escaping (37)', '#f\\+o\\+o'],
    ].map(([name, input]) => ({
      name,
      input,
      expected: false as const,
    })),
    ...[
      ['id selector with escaping (4)', '#♥'],
      ['id selector with escaping (5)', '#©'],
      ['id selector with escaping (6)', '#“‘’”'],
      ['id selector with escaping (7)', '#☺☃'],
      ['id selector with escaping (8)', '#⌘⌥'],
      ['id selector with escaping (9)', '#𝄞♪♩♫♬'],
      ['id selector with escaping (10)', '#💩'],
    ].map(([name, input]) => ({
      name,
      input,
      expected: false as const,
    })),
  ])
})

describe('migrated from comments.mjs', () => {
  runSupportedCases([
    {
      name: 'comments',
      input: '/*test comment*/h2',
      expected: '/*test comment*/h2',
    },
    {
      name: 'comments (2)',
      input: '.a  /*test comment*/label',
      expected: '.a  /*test comment*/label',
    },
    {
      name: 'comments (3)',
      input: '.a  /*test comment*/  label',
      expected: '.a  /*test comment*/  label',
    },
    {
      name: 'multiple comments and other things',
      input: 'h1/*test*/h2/*test*/.test/*test*/',
      expected: 'h1/*test*/h2/*test*/.test/*test*/',
    },
    {
      name: 'ending in comment',
      input: '.bar /* comment 3 */',
      expected: '.bar /* comment 3 */',
    },
    {
      name: 'ending in comment and whitespace',
      input: '.bar /* comment 3 */ ',
      expected: '.bar /* comment 3 */',
    },
    {
      name: 'ending in comment in a pseudo',
      input: ':is(.bar /* comment 3 */)',
      expected: ':is(.bar /* comment 3 */)',
    },
    {
      name: 'ending in comment and whitespace in a pseudo',
      input: ':is(.bar /* comment 3 */ )',
      expected: ':is(.bar /* comment 3 */ )',
    },
    {
      name: 'comments in selector list',
      input: 'h2, /*test*/ h4',
      expected: 'h2, /*test*/ h4',
    },
    {
      name: 'comments in selector list (2)',
      input: 'h2,/*test*/h4',
      expected: 'h2, /*test*/h4',
    },
    {
      name: 'comments in selector list (3)',
      input: 'h2/*test*/, h4',
      expected: 'h2/*test*/, h4',
    },
    {
      name: 'comments in selector list (4)',
      input: 'h2, /*test*/ /*test*/ h4',
      expected: 'h2, /*test*/ /*test*/ h4',
    },
  ])
})

describe('migrated from attributes.mjs', () => {
  runSupportedCases([
    {
      name: 'attribute selector',
      input: '[href]',
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({
          type: 'attribute',
          name: 'href',
          namespace: null,
          operation: null,
        })
      },
    },
    {
      name: 'attribute selector spaces (before)',
      input: '[  href]',
      expected: '[href]',
    },
    {
      name: 'attribute selector spaces (after)',
      input: '[href  ]',
      expected: '[href]',
    },
    {
      name: 'attribute selector spaces (both)',
      input: '[  href   ]',
      expected: '[href]',
    },
    {
      name: 'multiple attribute selectors',
      input: '[href][class][name]',
    },
    {
      name: 'attribute selector with a empty value',
      input: '[href=""]',
    },
    {
      name: 'attribute selector with a value',
      input: '[name=james]',
    },
    {
      name: 'attribute selector with quoted value',
      input: '[name="james"]',
      expected: '[name=james]',
    },
    {
      name: 'multiple attribute selectors + combinator',
      input: '[href][class][name] h1 > h2',
    },
    {
      name: 'attribute, class, combinator',
      input: '[href] > h2.test',
    },
    {
      name: 'attribute selector with quoted value & combinator',
      input: '[name="james"] > h1',
      expected: '[name=james] > h1',
    },
    {
      name: 'multiple quoted attribute selectors',
      input: `[href*="test.com"][rel='external'][id][class~="test"] > [name]`,
      expected: '[href*="test.com"][rel=external][id][class~=test] > [name]',
    },
    {
      name: 'more attribute operators',
      input: '[href*=test],[href^=test],[href$=test],[href|=test]',
      expected: '[href*=test], [href^=test], [href$=test], [href|=test]',
    },
    {
      name: 'attribute selector with quoted value containing "="',
      input: '[data-weird-attr="Something=weird"]',
    },
    {
      name: 'more attribute selector with quoted value containing "="',
      input:
        '[data-weird-attr*="Something=weird"],' +
        '[data-weird-attr^="Something=weird"],' +
        '[data-weird-attr$="Something=weird"],' +
        '[data-weird-attr|="Something=weird"]',
      expected:
        '[data-weird-attr*="Something=weird"], ' +
        '[data-weird-attr^="Something=weird"], ' +
        '[data-weird-attr$="Something=weird"], ' +
        '[data-weird-attr|="Something=weird"]',
    },
    {
      name: 'attribute selector with quoted value containing multiple "="',
      input: '[data-weird-attr="Something=weird SomethingElse=weirder"]',
    },
    {
      name: 'more attribute selector with quoted value containing multiple "="',
      input:
        '[data-weird-attr*="Something=weird SomethingElse=weirder"],' +
        '[data-weird-attr^="Something=weird SomethingElse=weirder"],' +
        '[data-weird-attr$="Something=weird SomethingElse=weirder"],' +
        '[data-weird-attr|="Something=weird SomethingElse=weirder"]',
      expected:
        '[data-weird-attr*="Something=weird SomethingElse=weirder"], ' +
        '[data-weird-attr^="Something=weird SomethingElse=weirder"], ' +
        '[data-weird-attr$="Something=weird SomethingElse=weirder"], ' +
        '[data-weird-attr|="Something=weird SomethingElse=weirder"]',
    },
    {
      name: 'multiple attribute selectors with quoted value containing "="',
      input: '[data-weird-foo="foo=weird"][data-weird-bar="bar=weird"]',
    },
    {
      name: 'more multiple attribute selectors with quoted value containing "="',
      input:
        '[data-weird-foo*="foo2=weirder"][data-weird-bar*="bar2=weirder"],' +
        '[data-weird-foo^="foo2=weirder"][data-weird-bar^="bar2=weirder"],' +
        '[data-weird-foo$="foo2=weirder"][data-weird-bar$="bar2=weirder"],' +
        '[data-weird-foo|="foo2=weirder"][data-weird-bar|="bar2=weirder"]',
      expected:
        '[data-weird-foo*="foo2=weirder"][data-weird-bar*="bar2=weirder"], ' +
        '[data-weird-foo^="foo2=weirder"][data-weird-bar^="bar2=weirder"], ' +
        '[data-weird-foo$="foo2=weirder"][data-weird-bar$="bar2=weirder"], ' +
        '[data-weird-foo|="foo2=weirder"][data-weird-bar|="bar2=weirder"]',
    },
    {
      name: 'multiple attribute selectors with quoted value containing multiple "="',
      input:
        '[data-weird-foo="foo1=weirder foo2=weirder"][data-weird-bar="bar1=weirder bar2=weirder"]',
    },
    {
      name: 'more multiple attribute selectors with quoted value containing multiple "="',
      input:
        '[data-weird-foo*="foo1=weirder foo2=weirder"][data-weird-bar*="bar1=weirder bar2=weirder"],' +
        '[data-weird-foo^="foo1=weirder foo2=weirder"][data-weird-bar^="bar1=weirder bar2=weirder"],' +
        '[data-weird-foo$="foo1=weirder foo2=weirder"][data-weird-bar$="bar1=weirder bar2=weirder"],' +
        '[data-weird-foo|="foo1=weirder foo2=weirder"][data-weird-bar|="bar1=weirder bar2=weirder"]',
      expected:
        '[data-weird-foo*="foo1=weirder foo2=weirder"][data-weird-bar*="bar1=weirder bar2=weirder"], ' +
        '[data-weird-foo^="foo1=weirder foo2=weirder"][data-weird-bar^="bar1=weirder bar2=weirder"], ' +
        '[data-weird-foo$="foo1=weirder foo2=weirder"][data-weird-bar$="bar1=weirder bar2=weirder"], ' +
        '[data-weird-foo|="foo1=weirder foo2=weirder"][data-weird-bar|="bar1=weirder bar2=weirder"]',
    },
    {
      name: 'spaces in attribute selectors',
      input: 'h1[  href  *=  "test"  ]',
      expected: 'h1[href*=test]',
    },
    {
      name: 'extraneous non-combinating whitespace',
      input: '  [href]   ,  [class]   ',
      expected: '[href], [class]',
    },
  ])

  runSupportedCases([
    {
      name: 'attribute selector with escaped quote',
      input: '[title="Something \\"weird\\""]',
      expected: false,
    },
    {
      name: 'attribute selector with escaped colon',
      input: '[ng\\:cloak]',
      expected: false,
    },
    {
      name: 'attribute selector with short hex escape',
      input: '[ng\\3a cloak]',
      expected: false,
    },
    {
      name: 'attribute selector with hex escape',
      input: '[ng\\00003acloak]',
      expected: false,
    },
    {
      name: 'assign attribute name requiring escape',
      input: '[ng\\:cloak]',
      expected: false,
    },
    {
      name: 'multiple attribute selectors with value containing escaped "="',
      input: '[data-weird-foo=foo\\=weird][data-weird-bar=bar\\3d weird]',
      expected: false,
    },
    {
      name: 'insensitive attribute selector 1',
      input: '[href="test" i]',
      expected: '[href=test i]',
    },
    {
      name: 'insensitive attribute selector with a empty value',
      input: '[href="" i]',
      expected: '[href="" i]',
    },
    {
      name: 'insensitive attribute selector 2',
      input: '[href=TEsT i  ]',
      expected: '[href=TEsT i]',
    },
    {
      name: 'insensitive attribute selector 3',
      input: '[href=test i]',
      expected: '[href=test i]',
    },
    {
      name: 'capitalized insensitive attribute selector 3',
      input: '[href=test I]',
      expected: '[href=test i]',
    },
    {
      name: 'insensitive attribute selector 4',
      input: '[href="test"i]',
      expected: '[href=test i]',
    },
    {
      name: 'capitalized insensitive attribute selector 4',
      input: '[href="test"I]',
      expected: '[href=test i]',
    },
    {
      name: 'insensitive attribute selector 5',
      input: '[href="test" i ]',
      expected: '[href=test i]',
    },
    {
      name: 'insensitive attribute selector 6',
      input: '[href=test i ]',
      expected: '[href=test i]',
    },
    {
      name: 'newline in attribute selector',
      input: '[class="woop \\\nwoop woop"]',
      expected: false,
    },
  ])

  runSupportedCases([
    {
      name: 'attribute selector spaces with namespace (both)',
      input: '[  foo|bar   ]',
      expected: '[foo|bar]',
    },
    {
      name: 'select elements with or without a namespace',
      input: '[*|href]',
      expected: '[*|href]',
    },
    {
      name: 'namespace with escapes',
      input: '[\\31 \\#\\32 |href]',
      expected: false,
    },
  ])

  runSupportedCases([
    {
      name: 'comments within attribute selectors',
      input: '[href/* wow */=/* wow */test]',
      expected: '[href/* wow */=/* wow */test]',
    },
    {
      name: 'comments within attribute selectors (2)',
      input: '[/* wow */href=test/* wow */]',
      expected: '[/* wow */href=test/* wow */]',
    },
    {
      name: 'comments within attribute selectors (3)',
      input: '[href=test/* wow */i]',
      expected: '[href=test/* wow */i]',
    },
    {
      name: 'comments within attribute selectors (4)',
      input:
        '[ /*before*/ href /* after-attr */ = /* after-operator */ te/*inside-value*/st/* wow */ /*omg*/i/*bbq*/ /*whodoesthis*/]',
      expected:
        '[ /*before*/ href /* after-attr */ = /* after-operator */ te/*inside-value*/st/* wow */ /*omg*/i/*bbq*/ /*whodoesthis*/]',
    },
    {
      name: 'comment after insensitive(non space)',
      input: '[href="foo" i/**/]',
      expected: '[href="foo" i/**/]',
    },
    {
      name: 'comment after insensitive(space after)',
      input: '[href="foo" i/**/ ]',
      expected: '[href="foo" i/**/ ]',
    },
    {
      name: 'comment after insensitive(space before)',
      input: '[href="foo" i /**/]',
      expected: '[href="foo" i /**/]',
    },
  ])
})

describe('migrated from pseudos.mjs', () => {
  runSupportedCases([
    {
      name: 'pseudo element (single colon)',
      input: 'h1:after',
      assert(selectors) {
        expect(selectors[0][1]).toMatchObject({
          type: 'pseudo-class',
          kind: 'custom',
          name: 'after',
        })
      },
    },
    {
      name: 'pseudo element (double colon)',
      input: 'h1::after',
      assert(selectors) {
        expect(selectors[0][1]).toMatchObject({
          type: 'pseudo-element',
          kind: 'after',
        })
      },
    },
    {
      name: 'multiple pseudo elements',
      input: '*:target::before, a:after',
    },
    {
      name: 'negation pseudo element',
      input: 'h1:not(.heading)',
      assert(selectors) {
        expect(selectors[0][1]).toMatchObject({
          type: 'pseudo-class',
          kind: 'not',
        })
      },
    },
    {
      name: 'negation pseudo element (2)',
      input: 'h1:not(.heading, .title, .content)',
    },
    {
      name: 'negation pseudo element (3)',
      input: 'h1:not(.heading > .title) > h1',
    },
    {
      name: 'negation pseudo element (4)',
      input: 'h1:not(h2:not(h3))',
    },
    {
      name: 'pseudo class in the middle of a selector',
      input: 'a:link.external',
    },
    {
      name: 'extra whitespace inside parentheses',
      input: 'a:not(   h2   )',
      expected: 'a:not(h2)',
    },
    {
      name: 'nested pseudo',
      input: '.btn-group>.btn:last-child:not(:first-child)',
      expected: '.btn-group > .btn:last-child:not(:first-child)',
    },
    {
      name: 'extraneous non-combinating whitespace',
      input: '  h1:after   ,  h2:after   ',
      expected: 'h1:after, h2:after',
    },
    {
      name: 'Issue #116',
      input: 'svg:not(:root)',
    },
    {
      name: 'alone pseudo class',
      input: ':root',
    },
    {
      name: 'non standard pseudo (@custom-selector)',
      input: ':--foobar, a',
    },
    {
      name: 'non standard pseudo (@custom-selector) (1)',
      input: 'a, :--foobar',
    },
    {
      name: 'current pseudo class',
      input: ':current(p, li, dt, dd)',
      options: customSelectorListFunctionOptions,
      assert(selectors) {
        expect(selectors[0][0]).toMatchObject({
          type: 'pseudo-class',
          kind: 'custom-function',
          name: 'current',
        })
      },
    },
    {
      name: 'is pseudo class',
      input: ':is(p, li, dt, dd)',
    },
    {
      name: 'has pseudo class',
      input: 'a:has(> img)',
    },
    {
      name: 'where pseudo class',
      input: 'a:where(:not(:hover))',
    },
    {
      name: 'nested pseudo classes',
      input: 'section:not( :has(h1, h2 ) )',
      expected: 'section:not(:has(h1, h2))',
    },
  ])

  runSupportedCases([
    {
      name: 'escaped numbers in class name with pseudo',
      input: 'a:before.\\31\\ 0',
      expected: false,
    },
    {
      name: 'is pseudo class with namespace',
      input: '*|*:is(:hover, :focus) ',
      expected: '*|*:is(:hover, :focus)',
    },
  ])
})

describe('migrated from nonstandard.mjs', () => {
  runSupportedCases([
    {
      name: 'leading combinator',
      input: '> *',
    },
  ])
})

describe('migrated from namespaces.mjs', () => {
  runSupportedCases([
    {
      name: 'match tags in the postcss namespace',
      input: 'postcss|button',
    },
    {
      name: 'match everything in the postcss namespace',
      input: 'postcss|*',
    },
    {
      name: 'match any namespace',
      input: '*|button',
    },
    {
      name: 'match all elements within the postcss namespace',
      input: 'postcss|*',
    },
    {
      name: 'match all elements in all namespaces',
      input: '*|*',
    },
    {
      name: 'match all elements without a namespace',
      input: '|*',
    },
    {
      name: 'match tags with no namespace',
      input: '|button',
    },
    {
      name: 'match namespace inside attribute selector',
      input: '[postcss|href=test]',
    },
    {
      name: 'match namespace inside attribute selector (2)',
      input: '[postcss|href]',
    },
    {
      name: 'match namespace inside attribute selector (3)',
      input: '[*|href]',
    },
    {
      name: 'match default namespace inside attribute selector',
      input: '[|href]',
    },
    {
      name: 'match default namespace inside attribute selector with spaces',
      input: '[ |href ]',
      expected: '[|href]',
    },
    {
      name: 'namespace with qualified id selector',
      input: 'ns|h1#foo',
    },
    {
      name: 'namespace with qualified class selector',
      input: 'ns|h1.foo',
    },
    {
      name: 'ns alias for namespace',
      input: 'f\\oo|h1.foo',
      expected: false,
    },
  ])

  runErrorCases([
    {
      name: 'lone pipe symbol',
      input: '|',
    },
    {
      name: 'lone pipe symbol with leading spaces',
      input: ' |',
    },
    {
      name: 'lone pipe symbol with trailing spaces',
      input: '| ',
    },
    {
      name: 'lone pipe symbol with surrounding spaces',
      input: ' | ',
    },
    {
      name: 'trailing pipe symbol with a namespace',
      input: 'foo| ',
    },
    {
      name: 'trailing pipe symbol with any namespace',
      input: '*| ',
    },
  ])
})

describe('migrated from escapes.mjs', () => {
  runSupportedCases([
    {
      name: 'escaped semicolon in class',
      input: '.\\;',
      expected: false,
    },
    {
      name: 'escaped semicolon in id',
      input: '#\\;',
      expected: false,
    },
  ])
})

describe('migrated from exceptions.mjs', () => {
  runErrorCases([
    { name: 'unclosed string', input: 'a[href="wow]' },
    { name: 'unclosed comment', input: '/* oops' },
    { name: 'unclosed pseudo element', input: 'button::' },
    { name: 'unclosed pseudo class', input: 'a:' },
    { name: 'unclosed attribute selector', input: '[name="james"][href' },
    { name: 'no opening parenthesis', input: ')' },
    { name: 'no opening parenthesis (2)', input: ':global.foo)' },
    { name: 'no opening parenthesis (3)', input: 'h1:not(h2:not(h3)))' },
    { name: 'no opening square bracket', input: ']' },
    { name: 'no opening square bracket (2)', input: ':global.foo]' },
    { name: 'no opening square bracket (3)', input: '[global]]' },
    { name: 'bad pseudo element', input: 'button::"after"' },
    {
      name: 'missing closing parenthesis in pseudo',
      input: ':not([attr="test"]:not([attr="test"])',
    },
    {
      name: 'bad syntax',
      input: '-moz-osx-font-smoothing: grayscale',
    },
    { name: 'bad syntax (2)', input: '! .body' },
    { name: 'missing backslash for semicolon', input: '.;' },
    { name: 'missing backslash for semicolon (2)', input: '.;' },
    { name: 'unexpected / foo', input: '-Option/root' },
    { name: 'bang in selector', input: '.foo !optional' },
  ])
})

describe('adapted from lossy.mjs', () => {
  runSupportedCases([
    {
      name: 'combinator, descendant - single',
      input: '.one .two',
    },
    {
      name: 'combinator, descendant - multiple',
      input: '.one   .two',
      expected: '.one .two',
    },
    {
      name: 'combinator, child - space before',
      input: '.one >.two',
      expected: '.one > .two',
    },
    {
      name: 'combinator, child - space after',
      input: '.one> .two',
      expected: '.one > .two',
    },
    {
      name: 'combinator, sibling - space before',
      input: '.one ~.two',
      expected: '.one ~ .two',
    },
    {
      name: 'combinator, sibling - space after',
      input: '.one~ .two',
      expected: '.one ~ .two',
    },
    {
      name: 'combinator, adj sibling - space before',
      input: '.one +.two',
      expected: '.one + .two',
    },
    {
      name: 'combinator, adj sibling - space after',
      input: '.one+ .two',
      expected: '.one + .two',
    },
    {
      name: 'classes, extraneous spaces',
      input: '  .h1   ,  .h2   ',
      expected: '.h1, .h2',
    },
    {
      name: 'ids, extraneous spaces',
      input: '  #h1   ,  #h2   ',
      expected: '#h1, #h2',
    },
    {
      name: 'attribute, spaces in selector',
      input: 'h1[  href  *=  "test"  ]',
      expected: 'h1[href*=test]',
    },
    {
      name: 'attribute, extraneous whitespace',
      input: '  [href]   ,  [class]   ',
      expected: '[href], [class]',
    },
    {
      name: 'tag - extraneous whitespace',
      input: '  h1   ,  h2   ',
      expected: 'h1, h2',
    },
    {
      name: 'tag - trailing comma',
      input: 'h1, ',
      expected: 'h1',
    },
    {
      name: 'tag - trailing comma (1)',
      input: 'h1,',
      expected: 'h1',
    },
    {
      name: 'tag - trailing comma (2)',
      input: 'h1',
    },
    {
      name: 'universal - combinator',
      input: ' * + * ',
      expected: '* + *',
    },
    {
      name: 'universal - extraneous whitespace',
      input: '  *   ,  *   ',
      expected: '*, *',
    },
    {
      name: 'universal - qualified universal selector',
      input: '*[href] *:not(*.green)',
    },
    {
      name: 'nesting - spacing before',
      input: '  &.class',
      expected: '&.class',
    },
    {
      name: 'nesting - spacing after',
      input: '&.class  ',
      expected: '&.class',
    },
    {
      name: 'nesting - spacing between',
      input: '&  .class  ',
      expected: '& .class',
    },
    {
      name: 'pseudo (single) - spacing before',
      input: '  :after',
      expected: ':after',
    },
    {
      name: 'pseudo (single) - spacing after',
      input: ':after  ',
      expected: ':after',
    },
    {
      name: 'pseudo (double) - spacing before',
      input: '  ::after',
      expected: '::after',
    },
    {
      name: 'pseudo (double) - spacing after',
      input: '::after  ',
      expected: '::after',
    },
    {
      name: 'pseudo - multiple',
      input: ' *:target::before ,   a:after  ',
      expected: '*:target::before, a:after',
    },
    {
      name: 'pseudo - negated',
      input: 'h1:not( .heading )',
      expected: 'h1:not(.heading)',
    },
    {
      name: 'pseudo - negated with combinators (1)',
      input: 'h1:not(.heading > .title)   >  h1',
      expected: 'h1:not(.heading > .title) > h1',
    },
    {
      name: 'pseudo - extra whitespace',
      input: 'a:not(   h2   )',
      expected: 'a:not(h2)',
    },
  ])

  runSupportedCases([
    ...[
      ['namespace, space before', '   postcss|button'],
      ['namespace, space after', 'postcss|button     '],
      ['namespace - all elements, space before', '   postcss|*'],
      ['namespace - all elements, space after', 'postcss|*     '],
      ['namespace - all namespaces, space before', '   *|button'],
      ['namespace - all namespaces, space after', '*|button     '],
      ['namespace - all elements in all namespaces, space before', '   *|*'],
      ['namespace - all elements in all namespaces, space after', '*|*     '],
      ['namespace - all elements without namespace, space before', '   |*'],
      ['namespace - all elements without namespace, space after', '|*     '],
      ['namespace - tag with no namespace, space before', '   |button'],
      ['namespace - tag with no namespace, space after', '|button     '],
      [
        'namespace - inside attribute, space before',
        ' [  postcss|href=test]',
        '[postcss|href=test]',
      ],
      [
        'namespace - inside attribute, space after',
        '[postcss|href=  test  ] ',
        '[postcss|href=test]',
      ],
      [
        'namespace - inside attribute (2), space before',
        ' [  postcss|href]',
        '[postcss|href]',
      ],
      [
        'namespace - inside attribute (2), space after',
        '[postcss|href ] ',
        '[postcss|href]',
      ],
      [
        'namespace - inside attribute (3), space before',
        ' [  *|href=test]',
        '[*|href=test]',
      ],
      [
        'namespace - inside attribute (3), space after',
        '[*|href=  test  ] ',
        '[*|href=test]',
      ],
      [
        'namespace - inside attribute (4), space after',
        '[|href=  test  ] ',
        '[|href=test]',
      ],
    ].map(([name, input, expected = input.trim()]) => ({
      name,
      input,
      expected,
    })),
    { name: 'tag - trailing slash (1)', input: 'h1\\    ', expected: false },
    {
      name: 'tag - trailing slash (2)',
      input: 'h1\\    h2\\',
      expected: false,
    },
  ])

  runSupportedCases([
    {
      name: 'comments - comment inside descendant selector',
      input: 'div /* wtf */.foo',
      expected: 'div /* wtf */.foo',
    },
    {
      name: 'comments - comment inside complex selector',
      input: 'div /* wtf */ > .foo',
      expected: 'div /* wtf */ > .foo',
    },
    {
      name: 'comments - comment inside compound selector with space',
      input: 'div    /* wtf */    .foo',
      expected: 'div    /* wtf */    .foo',
    },
  ])

  runSupportedCases([
    {
      name: 'attribute, insensitive flag 1',
      input: '[href="test" i  ]',
      expected: '[href=test i]',
    },
    {
      name: 'attribute, insensitive flag 2',
      input: '[href=TEsT i  ]',
      expected: '[href=TEsT i]',
    },
    {
      name: 'attribute, insensitive flag 3',
      input: '[href=test i  ]',
      expected: '[href=test i]',
    },
    {
      name: 'pseudo - negated with combinators (2)',
      input: '.foo:nth-child(2n + 1)',
      expected: '.foo:nth-child(odd)',
    },
  ])

  runSupportedCases([
    {
      name: '@words - space before',
      input: '  @media',
      expected: '@media',
    },
    {
      name: '@words - space after',
      input: '@media  ',
      expected: '@media',
    },
    {
      name: '@words - maintains space between',
      input: '@media (min-width: 700px) and (orientation: landscape)',
      expected: '@media (min-width: 700px) and (orientation: landscape)',
    },
    {
      name: '@words - extraneous space between',
      input: '@media  (min-width:  700px)  and   (orientation:   landscape)',
      expected: '@media (min-width: 700px) and (orientation: landscape)',
    },
    {
      name: '@words - multiple',
      input: '@media (min-width: 700px), (min-height: 400px)',
      expected: '@media (min-width: 700px),(min-height: 400px)',
    },
  ])
})

describe('stringifier regressions surfaced by the upstream migration', () => {
  test('custom selector-list functions round-trip their parsed selectors', () => {
    expect(
      parseAndStringify(
        ':current(p, li, dt, dd)',
        customSelectorListFunctionOptions,
      ),
    ).toBe(':current(p, li, dt, dd)')
  })

  test('relative selectors do not gain a leading combinator space', () => {
    expect(parseAndStringify('> *')).toBe('> *')
    expect(parseAndStringify('a:has(> img)')).toBe('a:has(> img)')
  })

  test('standard pseudo-class functions round-trip', () => {
    expect(parseAndStringify(':lang(en, "*-Latn")')).toBe(':lang(en, *-Latn)')
    expect(parseAndStringify(':dir(rtl)')).toBe(':dir(rtl)')
    expect(parseAndStringify(':nth-child(2n + 1 of .foo, .bar)')).toBe(
      ':nth-child(odd of .foo, .bar)',
    )
    expect(parseAndStringify(':nth-last-of-type(3n-2)')).toBe(
      ':nth-last-of-type(3n-2)',
    )
    expect(parseAndStringify(':nth-col(even)')).toBe(':nth-col(even)')
  })

  test('explicit case-sensitive attribute modifier round-trips', () => {
    expect(parseAndStringify('[href="test" s]')).toBe('[href=test s]')
  })
})
