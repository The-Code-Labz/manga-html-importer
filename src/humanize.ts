const LOWERCASE_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or',
  'the', 'to', 'unto', 'upon', 'with', 'within', 'without'
])

const ROMAN_NUMERALS = new Set([
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
  'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'
])

/**
 * Convert a readm.today slug like "i-became-the-target-of-the-harem-in-another-world"
 * into a human-readable title: "I Became the Target of the Harem in Another World".
 */
export function humanizeSlug(slug: string): string {
  if (!slug || slug.trim().length === 0) return ''

  const parts = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter((p) => p.length > 0)

  if (parts.length === 0) return slug

  const titleCased = parts.map((word, index) => {
    // Always uppercase the first and last word
    if (index === 0 || index === parts.length - 1) {
      return capitalize(word)
    }

    // Keep small words lowercase unless they're roman numerals
    if (LOWERCASE_WORDS.has(word)) {
      return word
    }

    // Uppercase roman numerals
    if (ROMAN_NUMERALS.has(word)) {
      return word.toUpperCase()
    }

    return capitalize(word)
  })

  return titleCased.join(' ')
}

function capitalize(word: string): string {
  if (word.length === 0) return word
  if (word.length === 1) return word.toUpperCase()

  // Preserve existing capitalization for mixed-case strings (e.g. "MC", "II")
  if (/^[A-Z0-9]+$/.test(word)) {
    return word
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/** Detect numeric-only slugs like "17318" that can't be humanized meaningfully. */
export function isNumericSlug(slug: string): boolean {
  return /^\d+$/.test(slug.trim())
}

/**
 * Extract the manga slug from a readm.today URL.
 * Handles chapter-page URLs like /manga/some-title/1 by returning the base slug.
 */
export function extractSlugFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/manga\/(.+?)\/?$/)
    if (!match) return null
    const full = match[1]
    // If the URL points to a specific chapter (/manga/title/1), use the base manga slug
    const base = full.replace(/\/\d+$/, '')
    return base || full
  } catch {
    return null
  }
}

/** Extract cover filename from a data-src or data-img path. */
export function extractCoverPath(attr: string): string {
  if (!attr) return ''

  // data-src often looks like "/uploads/chapter/tbn/1721041464_30x0.jpg"
  // data-img often looks like "1721041464.jpg"
  const match = attr.match(/\/([^/]+\.(?:jpg|jpeg|png|webp|gif|avif))$/i)
  if (match) {
    return match[1].replace(/_\d+x\d+(?=\.|$)/i, '')
  }

  // Strip dimension suffixes like "_30x0" from the filename while preserving extension
  const base = attr.split('/').pop() ?? attr
  return base.replace(/_\d+x\d+(?=\.|$)/i, '')
}
