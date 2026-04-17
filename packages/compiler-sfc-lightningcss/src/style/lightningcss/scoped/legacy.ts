import { walkCssBlockPreludes } from '@vue/lightningcss-utils'

interface LegacyScopedSyntax {
  pattern: RegExp
  replacement: string
  syntax: string
}

const legacyScopedSyntaxes: readonly LegacyScopedSyntax[] = [
  {
    syntax: '::v-deep',
    pattern: /::?v-deep\b/i,
    replacement: ':deep(...)',
  },
  {
    syntax: '::v-slotted',
    pattern: /::?v-slotted\b/i,
    replacement: ':slotted(...)',
  },
  {
    syntax: '::v-global',
    pattern: /::?v-global\b/i,
    replacement: ':global(...)',
  },
  {
    syntax: '>>>',
    pattern: />>>/,
    replacement: ':deep(...)',
  },
  {
    syntax: '/deep/',
    pattern: /\/deep\//i,
    replacement: ':deep(...)',
  },
] as const

export function findLegacyVueScopedSyntaxError(source: string): Error | null {
  let foundError: Error | null = null

  walkCssBlockPreludes(source, prelude => {
    if (
      foundError ||
      !prelude.normalizedPrelude ||
      prelude.normalizedPrelude.startsWith('@') ||
      prelude.parentKind === 'keyframes'
    ) {
      return
    }

    for (const legacySyntax of legacyScopedSyntaxes) {
      if (!legacySyntax.pattern.test(prelude.preludeSource)) {
        continue
      }

      foundError = new Error(
        `[@vue/compiler-sfc-lightningcss] Legacy Vue scoped CSS syntax \`${legacySyntax.syntax}\` is not supported. Use \`${legacySyntax.replacement}\` instead.`,
      )
      return
    }
  })

  return foundError
}
