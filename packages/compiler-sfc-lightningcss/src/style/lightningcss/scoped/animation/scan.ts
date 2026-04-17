export function findTopLevelColon(segment: string): number {
  return findTopLevelSeparatorIndex(segment, ':')
}

export function findTopLevelSeparatorIndex(
  source: string,
  separator: string,
): number {
  let bracketDepth = 0
  let parenDepth = 0
  let quote: '"' | "'" | undefined

  for (let index = 0; index < source.length; index++) {
    const current = source[index]

    if (quote) {
      if (current === '\\') {
        index++
      } else if (current === quote) {
        quote = undefined
      }
      continue
    }

    if (current === '"' || current === "'") {
      quote = current
      continue
    }

    if (current === '(') {
      parenDepth++
      continue
    }
    if (current === ')' && parenDepth) {
      parenDepth--
      continue
    }

    if (current === '[') {
      bracketDepth++
      continue
    }
    if (current === ']' && bracketDepth) {
      bracketDepth--
      continue
    }

    if (!parenDepth && !bracketDepth && current === separator) {
      return index
    }
  }

  return -1
}

export function splitTopLevelSegments(
  source: string,
  separator: string,
): string[] {
  const result: string[] = []
  let start = 0
  let bracketDepth = 0
  let parenDepth = 0
  let quote: '"' | "'" | undefined

  for (let index = 0; index < source.length; index++) {
    const current = source[index]

    if (quote) {
      if (current === '\\') {
        index++
      } else if (current === quote) {
        quote = undefined
      }
      continue
    }

    if (current === '"' || current === "'") {
      quote = current
      continue
    }

    if (current === '(') {
      parenDepth++
      continue
    }
    if (current === ')' && parenDepth) {
      parenDepth--
      continue
    }

    if (current === '[') {
      bracketDepth++
      continue
    }
    if (current === ']' && bracketDepth) {
      bracketDepth--
      continue
    }

    if (!parenDepth && !bracketDepth && current === separator) {
      result.push(source.slice(start, index))
      start = index + 1
    }
  }

  result.push(source.slice(start))
  return result
}

export function splitTopLevelWhitespace(source: string): string[] {
  const result: string[] = []
  let tokenStart = -1
  let bracketDepth = 0
  let parenDepth = 0
  let quote: '"' | "'" | undefined

  for (let index = 0; index < source.length; index++) {
    const current = source[index]

    if (quote) {
      if (current === '\\') {
        index++
      } else if (current === quote) {
        quote = undefined
      }
      continue
    }

    if (current === '"' || current === "'") {
      quote = current
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }

    if (current === '(') {
      parenDepth++
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }
    if (current === ')' && parenDepth) {
      parenDepth--
      continue
    }

    if (current === '[') {
      bracketDepth++
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }
    if (current === ']' && bracketDepth) {
      bracketDepth--
      continue
    }

    if (!parenDepth && !bracketDepth && /\s/.test(current)) {
      if (tokenStart !== -1) {
        result.push(source.slice(tokenStart, index))
        tokenStart = -1
      }
      continue
    }

    if (tokenStart === -1) {
      tokenStart = index
    }
  }

  if (tokenStart !== -1) {
    result.push(source.slice(tokenStart))
  }

  return result
}
