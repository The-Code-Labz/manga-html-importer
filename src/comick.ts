import type { ComickResult, ParsedManga } from './types.js'

interface ComickSearchItem {
  title?: string
  slug?: string
  md_covers?: Array<{ b2key?: string }>
  cover_url?: string
}

/**
 * Search comick.dev for the canonical title + cover for a manga.
 * Respects rate limiting via delayMs between requests.
 */
export async function lookupComick(
  manga: ParsedManga,
  delayMs = 500,
  timeoutMs = 5000
): Promise<ParsedManga> {
  if (!manga.title) return manga

  await sleep(delayMs)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const query = encodeURIComponent(manga.title)
    const res = await fetch(`https://api.comick.dev/search?q=${query}&limit=5`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'manga-html-importer/1.0'
      }
    })

    if (!res.ok) {
      return {
        ...manga,
        comick: { matched: false, source: 'humanized' }
      }
    }

    const data = (await res.json()) as ComickSearchItem[]
    const match = data.find((item) =>
      item.slug?.toLowerCase() === manga.slug.toLowerCase() ||
      item.title?.toLowerCase() === manga.title.toLowerCase()
    ) ?? data[0]

    if (!match) {
      return {
        ...manga,
        comick: { matched: false, source: 'humanized' }
      }
    }

    const cover =
      match.cover_url ??
      (match.md_covers?.[0]?.b2key
        ? `https://meo.comick.pictures/${match.md_covers[0].b2key}`
        : undefined)

    return {
      ...manga,
      title: match.title ?? manga.title,
      comick: {
        title: match.title,
        slug: match.slug,
        cover_url: cover,
        matched: true,
        source: 'comick'
      }
    }
  } catch (err) {
    return {
      ...manga,
      comick: { matched: false, source: 'humanized' }
    }
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
