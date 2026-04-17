/* eslint-disable vitest/no-disabled-tests */

interface SkippedCase {
  name: string
  reason: string
}

const preprocessorReason =
  'Preprocessor interpolation syntax is outside the selector subset supported by the lightweight lexer.'
const stringPseudoArgumentReason =
  'String-valued pseudo arguments are not implemented by the lightweight lexer; only selector-list arguments are supported.'
const frameworkSyntaxReason =
  'Framework-specific identifier syntax is outside the selector subset supported by the lightweight lexer.'

function runSkippedCases(cases: SkippedCase[]): void {
  for (const { name, reason } of cases) {
    test.skip(name, () => {
      throw new Error(reason)
    })
  }
}

describe('migrated from classes.mjs', () => {
  runSkippedCases([
    {
      name: 'Less interpolation within a class',
      reason: preprocessorReason,
    },
    {
      name: 'ClassName#set value',
      reason:
        'This upstream case exercises mutable node raws on the postcss-selector-parser AST rather than selector parsing alone.',
    },
  ])
})

describe('migrated from id.mjs', () => {
  runSkippedCases([
    {
      name: 'Sass interpolation within a class',
      reason: preprocessorReason,
    },
    {
      name: 'Sass interpolation within an id',
      reason: preprocessorReason,
    },
    {
      name: 'Less interpolation within an id',
      reason: preprocessorReason,
    },
  ])
})

describe('migrated from attributes.mjs', () => {
  runSkippedCases([
    {
      name: 'non standard modifiers',
      reason:
        'Only the standard `i` and `s` attribute case-sensitivity modifiers are implemented by the lightweight lexer.',
    },
  ])
})

describe('migrated from pseudos.mjs', () => {
  runSkippedCases([
    {
      name: 'negation pseudo element with quotes',
      reason: stringPseudoArgumentReason,
    },
    {
      name: 'negation pseudo element with single quotes',
      reason: stringPseudoArgumentReason,
    },
  ])
})

describe('migrated from nonstandard.mjs', () => {
  runSkippedCases([
    {
      name: 'non-standard selector',
      reason: frameworkSyntaxReason,
    },
    {
      name: 'at word in selector',
      reason: frameworkSyntaxReason,
    },
    {
      name: 'sass escapes',
      reason: preprocessorReason,
    },
    {
      name: 'sass escapes (2)',
      reason: preprocessorReason,
    },
    {
      name: 'placeholder',
      reason: frameworkSyntaxReason,
    },
    {
      name: 'styled selector',
      reason: frameworkSyntaxReason,
    },
    {
      name: 'styled selector (2)',
      reason:
        'Framework-specific identifier syntax and non-selector-list pseudo arguments are outside the selector subset supported by the lightweight lexer.',
    },
  ])
})

describe('migrated from escapes.mjs', () => {
  runSkippedCases([
    {
      name: 'bare parens capture contents as a string',
      reason:
        'Lightning CSS does not accept bare parenthesized selector fragments as selectors.',
    },
  ])
})
