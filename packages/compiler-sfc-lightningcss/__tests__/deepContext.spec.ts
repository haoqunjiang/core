import { describe, expect, test } from 'vitest'
import { analyzeSelectorNestingContext } from '../src/style/lightningcss/nesting/deepContext'

describe('analyzeSelectorNestingContext', () => {
  test.each([
    [':slotted(.x), .y', 'none', true],
    [':deep(.x), .y', 'none', true],
    [':is(:slotted(.x), .y)', 'none', true],
    [':where(:deep(.x), .y)', 'none', true],
    [':slotted(.x)', 'slotted', false],
    [':is(:deep(.x))', 'deep', false],
  ])('analyzes %s', (selector, expectedContext, expectedMixedBranches) => {
    expect(analyzeSelectorNestingContext(selector)).toEqual({
      context: expectedContext,
      hasMixedBranches: expectedMixedBranches,
    })
  })
})
