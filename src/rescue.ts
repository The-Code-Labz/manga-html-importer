import type { DeepMangaSignals, ParsedManga, RescueOptions, RescueResult, TitleCandidate } from './types.js'

const MIN_RESCUE_CONFIDENCE = 0.6
const HIGH_CONFIDENCE_API = 0.85
const MIN_DEEP_PARSE_TITLE_LENGTH = 4

/** Decide whether a candidate is trustworthy enough to auto-rescue. */
function isTrustworthyCandidate(candidate: TitleCandidate): boolean {
  if (candidate.confidence < MIN_RESCUE_CONFIDENCE) return false
  if (isGibberishTitle(candidate.title)) return false
  // Cover filenames, wayback titles, and deep-parsed titles are primary evidence.
  if (
    candidate.source === 'cover_filename' ||
    candidate.source === 'wayback' ||
    candidate.source === 'deep_parse'
  )
    return true
  // Exact API matches only.
  return candidate.confidence >= HIGH_CONFIDENCE_API
}

/** Build title candidates from deep-parsed HTML signals, if available. */
export function candidatesFromDeepSignals(deep?: DeepMangaSignals): TitleCandidate[] {
  if (!deep) return []
  const candidates: TitleCandidate[] = []

  // Best display title across all occurrences (usually the longest, least truncated)
  if (deep.display_title && deep.display_title.length >= MIN_DEEP_PARSE_TITLE_LENGTH) {
    candidates.push({
      source: 'deep_parse',
      title: deep.display_title,
      confidence: 0.65
    })
  }

  // Image alt/title attributes sometimes hold the full title
  for (const t of [...deep.signals.img_titles, ...deep.signals.img_alts, ...deep.signals.anchor_titles]) {
    if (t.length >= MIN_DEEP_PARSE_TITLE_LENGTH && !candidates.some((c) => c.title === t)) {
      candidates.push({
        source: 'deep_parse',
        title: t,
        confidence: 0.6
      })
    }
  }

  // Nearby text can be noisy; only accept longer, cleaner strings
  for (const t of deep.signals.nearby_text) {
    if (t.length >= 8 && !candidates.some((c) => c.title === t)) {
      candidates.push({
        source: 'deep_parse',
        title: t,
        confidence: 0.45
      })
    }
  }

  return candidates
}

export function extractTitleFromCoverFilename(coverPath: string): TitleCandidate | null {
  if (!coverPath) return null

  // Strip any directory path and extension
  let base = coverPath.split('/').pop() ?? coverPath
  base = base.replace(/\.[^.]+$/, '')

  // Strip dimension suffixes like _30x0, _198x0, _240x0
  base = base.replace(/_\d+x\d+$/, '')

  // Pure numeric (e.g. 1587550898, 1642242961) — no title here
  if (/^\d+$/.test(base)) return null

  // Patterns like 0001_569 — probably not a real title
  if (/^\d+_\d+$/.test(base)) return null

  // Heuristic: if more than half the characters are digits, low confidence
  const digitRatio = (base.match(/\d/g) ?? []).length / base.length

  // Humanize the filename: replace _ and - with spaces
  const title = humanizeCoverName(base)
  if (!title || title.length < 2) return null

  const confidence = digitRatio > 0.3 ? 0.35 : 0.6

  return {
    source: 'cover_filename',
    title,
    confidence
  }
}

function humanizeCoverName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word, i, arr) => {
      if (i === 0 || i === arr.length - 1) return capitalize(word)
      if (/^(a|an|and|as|at|but|by|for|from|in|into|of|on|or|the|to|with)$/i.test(word)) {
        return word.toLowerCase()
      }
      return capitalize(word)
    })
    .join(' ')
}

function capitalize(word: string): string {
  if (!word) return word
  if (/^[A-Z0-9]+$/.test(word)) return word
  if (word.length === 1) return word.toUpperCase()
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/** Detect titles that should never be trusted as canonical. */
export function isGibberishTitle(title: string): boolean {
  const t = title.trim()
  if (t.length === 0) return true
  if (/^\d+$/.test(t)) return true
  if (/^\d{6,}$/.test(t.replace(/\s/g, ''))) return true
  if (/^[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.\/<>?]+$/.test(t)) return true
  // Pure leetspeak
  if (/^[0-9]{3,}$/.test(t.replace(/[^a-zA-Z0-9]/g, ''))) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; body?: string; method?: string } = {}
): Promise<unknown | null> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: opts.headers ?? { Accept: 'application/json' },
      method: opts.method ?? 'GET',
      body: opts.body
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function searchComick(query: string, timeoutMs = 5000): Promise<TitleCandidate[]> {
  const url = `https://api.comick.dev/search?q=${encodeURIComponent(query)}&limit=5`
  const data = (await fetchJson(url, { timeoutMs, headers: { 'User-Agent': 'manga-html-importer/1.1' } })) as Array<{
    title?: string
    slug?: string
    md_covers?: Array<{ b2key?: string }>
    cover_url?: string
  }> | null

  if (!Array.isArray(data)) return []

  const qLower = query.toLowerCase()
  return data
    .filter((item) => item.title)
    .map((item) => {
      const title = item.title!
      const cover =
        item.cover_url ??
        (item.md_covers?.[0]?.b2key
          ? `https://meo.comick.pictures/${item.md_covers[0].b2key}`
          : undefined)

      const exact = title.toLowerCase() === qLower
      const slugMatch = item.slug?.toLowerCase().replace(/-/g, ' ') === qLower
      const confidence = exact ? 0.95 : slugMatch ? 0.85 : 0.72

      return {
        source: 'comick' as const,
        title,
        slug: item.slug,
        cover_url: cover,
        confidence,
        url: `https://comick.io/comic/${item.slug ?? ''}`
      }
    })
}

interface KitsuAttributes {
  canonicalTitle?: string
  titles?: Record<string, string>
  posterImage?: { medium?: string; large?: string; original?: string }
}

async function searchKitsu(query: string, timeoutMs = 5000): Promise<TitleCandidate[]> {
  const url = `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(query)}&page[limit]=5`
  const data = (await fetchJson(url, { timeoutMs, headers: { Accept: 'application/vnd.api+json' } })) as {
    data?: Array<{ attributes: KitsuAttributes }>
  } | null

  if (!data?.data) return []

  const qLower = query.toLowerCase()
  return data.data
    .map((item): TitleCandidate | null => {
      const attrs = item.attributes
      const title = attrs.canonicalTitle ?? Object.values(attrs.titles ?? {})[0]
      if (!title) return null
      const cover = attrs.posterImage?.large ?? attrs.posterImage?.medium ?? attrs.posterImage?.original
      const confidence = title.toLowerCase() === qLower ? 0.9 : 0.68
      return {
        source: 'kitsu',
        title,
        cover_url: cover,
        confidence,
        url: `https://kitsu.io/manga/${encodeURIComponent(title)}`
      }
    })
    .filter((c): c is TitleCandidate => c !== null)
}

async function searchAnilist(query: string, timeoutMs = 5000): Promise<TitleCandidate[]> {
  const q = `
    query($search: String) {
      Page(perPage: 5) {
        media(search: $search, type: MANGA) {
          id
          title { english romaji }
          coverImage { large }
        }
      }
    }
  `
  const data = (await fetchJson('https://graphql.anilist.co', {
    timeoutMs,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: q, variables: { search: query } })
  })) as {
    data?: {
      Page?: {
        media?: Array<{
          id: number
          title: { english?: string; romaji?: string }
          coverImage?: { large?: string }
        }>
      }
    }
  } | null

  const qLower = query.toLowerCase()
  const media = data?.data?.Page?.media ?? []
  return media
    .map((item): TitleCandidate | null => {
      const title = item.title.english ?? item.title.romaji
      if (!title) return null
      const confidence = title.toLowerCase() === qLower ? 0.88 : 0.66
      return {
        source: 'anilist',
        title,
        cover_url: item.coverImage?.large,
        confidence,
        url: `https://anilist.co/manga/${item.id}`
      }
    })
    .filter((c): c is TitleCandidate => c !== null)
}

/**
 * Query the Wayback Machine CDX API for archived snapshots of
 * readm.today/manga/{slug}, then fetch the newest snapshot and extract
 * the page title.
 */
async function waybackLookup(
  slug: string,
  timeoutMs = 10000
): Promise<TitleCandidate | null> {
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    `readm.today/manga/${slug}`
  )}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=digest&limit=5`

  const cdx = (await fetchJson(url, { timeoutMs })) as [string[], ...string[][]] | null
  if (!Array.isArray(cdx) || cdx.length < 2) return null

  // cdx[0] is header ['timestamp','original','statuscode']; rest are rows
  const rows = cdx.slice(1).sort((a, b) => b[0].localeCompare(a[0]))
  const [timestamp, original] = rows[0]
  if (!timestamp || !original) return null

  const snapshotUrl = `https://web.archive.org/web/${timestamp}id_/${original}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(snapshotUrl, { signal: controller.signal })
    if (!res.ok) return null
    const html = await res.text()

    // Try <title> first
    let title = html.match(/<title\s*>([^]*?)<\/title\s*>/i)?.[1]?.trim()

    // Fall back to og:title
    if (!title || title.toLowerCase().includes('read manga online')) {
      const ogTitle = html.match(
        /<meta[^\u003e]*property=["']og:title["'][^\u003e]*content=["']([^"']+)["']/i
      )?.[1]
      if (ogTitle) title = ogTitle.trim()
    }

    if (!title) return null

    // Clean " - Read Manga Online" / " | ReadM" suffixes
    title = title.replace(/\s*[-|]\s*(Read Manga Online|ReadM|ReadM Today)$/i, '').trim()

    if (isGibberishTitle(title)) return null

    const confidence = title.toLowerCase().includes(slug.toLowerCase()) ? 0.75 : 0.55

    return {
      source: 'wayback',
      title,
      confidence,
      url: snapshotUrl
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Check Wayback Machine availability for a sample of slugs.
 * Returns which slugs have snapshots, the newest snapshot timestamp,
 * and the extracted title (if parseable) without doing a full rescue.
 */
export async function waybackSample(
  slugs: string[],
  opts: { limit?: number; timeoutMs?: number; parseTitles?: boolean } = {}
): Promise<{
  checked: number
  withSnapshots: number
  withTitles: number
  errors: number
  sample: Array<{
    slug: string
    available: boolean
    snapshotUrl?: string
    snapshotTimestamp?: string
    title?: string
    error?: string
  }>
}> {
  const limit = opts.limit ?? 20
  const timeoutMs = opts.timeoutMs ?? 10000
  const parseTitles = opts.parseTitles ?? true
  const sampleSlugs = slugs.slice(0, limit)

  const results = await Promise.all(
    sampleSlugs.map(async (slug) => {
      try {
        const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
          `readm.today/manga/${slug}`
        )}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=digest&limit=1`

        const cdx = (await fetchJson(url, { timeoutMs })) as [string[], ...string[][]] | null
        if (!Array.isArray(cdx) || cdx.length < 2) {
          return { slug, available: false }
        }

        const [timestamp, original] = cdx[1]
        if (!timestamp || !original) {
          return { slug, available: false }
        }

        const snapshotUrl = `https://web.archive.org/web/${timestamp}id_/${original}`

        if (!parseTitles) {
          return {
            slug,
            available: true,
            snapshotUrl,
            snapshotTimestamp: timestamp
          }
        }

        const candidate = await waybackLookup(slug, timeoutMs)
        return {
          slug,
          available: true,
          snapshotUrl,
          snapshotTimestamp: timestamp,
          title: candidate?.title
        }
      } catch (err) {
        return {
          slug,
          available: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    })
  )

  return {
    checked: results.length,
    withSnapshots: results.filter((r) => r.available).length,
    withTitles: results.filter((r) => r.title).length,
    errors: results.filter((r) => r.error).length,
    sample: results
  }
}


async function addApiCandidates(
  candidates: TitleCandidate[],
  query: string,
  opts: RescueOptions
): Promise<void> {
  const delay = opts.comickDelay ?? 500
  const timeout = opts.comickTimeout ?? 5000

  if (opts.comick) {
    try {
      const comick = await searchComick(query, timeout)
      candidates.push(...comick)
      await sleep(delay)
    } catch {
      // ignore
    }
  }

  if (opts.kitsu) {
    try {
      const kitsu = await searchKitsu(query, timeout)
      candidates.push(...kitsu)
      await sleep(delay)
    } catch {
      // ignore
    }
  }

  if (opts.anilist) {
    try {
      const anilist = await searchAnilist(query, timeout)
      candidates.push(...anilist)
      await sleep(delay)
    } catch {
      // ignore
    }
  }
}

/**
 * Attempt to rescue a real title for a numeric-slug manga entry.
 */
export async function rescueTitle(
  entry: ParsedManga,
  opts: RescueOptions = {},
  deep?: DeepMangaSignals
): Promise<RescueResult> {
  const candidates: TitleCandidate[] = []

  // 1. Deep-parsed HTML signals (display titles, alt/title attributes, nearby text)
  const deepCandidates = candidatesFromDeepSignals(deep)
  candidates.push(...deepCandidates)

  // 2. Cover filename title
  const coverCandidate = extractTitleFromCoverFilename(entry.cover_path)
  if (coverCandidate) candidates.push(coverCandidate)

  // 3. Displayed (truncated) title from the page, if available
  if (entry.title && !isGibberishTitle(entry.title) && entry.title !== entry.slug) {
    candidates.push({
      source: 'humanized',
      title: entry.title,
      confidence: 0.25
    })
  }

  // 4. Decide query for APIs: prefer deep-parsed title, then best local candidate
  const bestLocal = candidates.slice().sort((a, b) => b.confidence - a.confidence)[0]
  const query = bestLocal?.title ?? entry.title

  await addApiCandidates(candidates, query, opts)

  // 5. If the best local title differs from the slug/humanized, also try that
  if (entry.title && entry.title !== query && !isGibberishTitle(entry.title)) {
    await addApiCandidates(candidates, entry.title, opts)
  }

  // 6. Wayback Machine for the original readm.today page
  if (opts.wayback) {
    const wb = await waybackLookup(entry.slug, opts.waybackTimeout)
    if (wb) candidates.push(wb)
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence)

  const best = candidates[0]
  const trusted = candidates.find(isTrustworthyCandidate)
  const rescued = !!trusted

  return {
    slug: entry.slug,
    original_title: entry.title,
    display_title: entry.display_title,
    cover_path: entry.cover_path,
    list_section: entry.list_section,
    source_url: entry.source_url,
    candidates,
    best_candidate: trusted ?? best,
    needs_review: !rescued,
    rescued
  }
}

/**
 * Rescue titles for a list of entries. Only processes entries flagged
 * needs_review (numeric slugs) unless forceAll is true.
 * Processes up to `concurrency` entries in parallel to speed up external API calls.
 */
export async function rescueTitles(
  entries: ParsedManga[],
  opts: RescueOptions = {},
  forceAll = false,
  concurrency = 5,
  deepBySlug?: Map<string, DeepMangaSignals>
): Promise<{ results: RescueResult[]; summary: { total: number; rescued: number; needs_review: number; bySource: Record<string, number> } }> {
  const targets = forceAll ? entries : entries.filter((e) => e.needs_review)
  const results: RescueResult[] = new Array(targets.length)
  const bySource: Record<string, number> = {}

  async function worker(startIndex: number) {
    for (let i = startIndex; i < targets.length; i += concurrency) {
      const entry = targets[i]
      process.stderr.write(`Rescuing ${i + 1}/${targets.length}: ${entry.slug}\r`)
      const deep = deepBySlug?.get(entry.slug)
      const result = await rescueTitle(entry, opts, deep)
      results[i] = result
      if (result.best_candidate) {
        bySource[result.best_candidate.source] = (bySource[result.best_candidate.source] ?? 0) + 1
      }
    }
  }

  const workers: Promise<void>[] = []
  for (let w = 0; w < concurrency; w++) {
    workers.push(worker(w))
  }
  await Promise.all(workers)
  process.stderr.write('\n')

  const rescued = results.filter((r) => r.rescued).length
  return {
    results,
    summary: {
      total: targets.length,
      rescued,
      needs_review: targets.length - rescued,
      bySource
    }
  }
}
