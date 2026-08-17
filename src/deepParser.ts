import { Parser } from 'htmlparser2'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { extractCoverPath, extractSlugFromUrl, humanizeSlug, isNumericSlug } from './humanize.js'
import type { DeepParseResult, DeepMangaSignals, ParseOptions } from './types.js'

interface CardSignals {
  slug: string
  section: string
  sourceUrl: string
  coverPath: string
  displayTitles: string[]
  imgAlts: string[]
  imgTitles: string[]
  anchorTitles: string[]
  dataAttributes: Record<string, string[]>
  nearbyText: string[]
}

interface ParserState {
  currentSection: string | null
  inCard: boolean
  cardDepth: number
  cardHref: string | null
  cardImgAttr: string | null
  cardDisplayTitle: string | null
  capturingHeading: boolean
  headingBuffer: string
  imgAlt: string | null
  imgTitle: string | null
  anchorTitle: string | null
  dataAttributes: Record<string, string[]>
  nearbyText: string[]
  captureNearby: boolean
}

const TARGET_TAB_IDS = new Set(['plan-to-read', 'favorites', 'subscriptions', 'reading-history'])

function inferSectionFromFilename(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.includes('fav')) return 'favorites'
  if (lower.includes('plan-to-read') || lower.includes('plantoread') || lower.includes('plan')) return 'plan-to-read'
  if (lower.includes('sub')) return 'subscriptions'
  return 'unknown'
}

function cleanText(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length === 0) return null
  if (t === 'Read Manga Online') return null
  return t
}

function isUsefulTitle(text: string): boolean {
  const t = text.trim()
  if (t.length < 2) return false
  if (/^Read\s+Manga/i.test(t)) return false
  if (/^\.{3,}$/.test(t)) return false
  if (/^\d+$/.test(t)) return false
  return true
}

const UI_NOISE_PATTERNS = new Set([
  'remove',
  'delete',
  'edit',
  'move',
  'chapter',
  'ch.',
  'vol.',
  'volume',
  'read now',
  'read manga online',
  'readm',
  'loading',
  'close',
  'cancel',
  'submit',
  'save'
])

function isUiNoise(text: string): boolean {
  const lower = text.toLowerCase().trim()
  if (lower.length < 3) return true
  if (UI_NOISE_PATTERNS.has(lower)) return true
  if (/^chapter\s*\d+/i.test(lower)) return true
  if (/^vol\.?\s*\d+/i.test(lower)) return true
  if (/^ch\.?\s*\d+/i.test(lower)) return true
  if (/^\d+:\d+$/.test(lower)) return true
  return false
}

function createDeepParserHandlers(
  fileName: string,
  onCard: (signals: CardSignals) => void,
  onError: (reason?: unknown) => void
) {
  const state: ParserState = {
    currentSection: inferSectionFromFilename(fileName),
    inCard: false,
    cardDepth: 0,
    cardHref: null,
    cardImgAttr: null,
    cardDisplayTitle: null,
    capturingHeading: false,
    headingBuffer: '',
    imgAlt: null,
    imgTitle: null,
    anchorTitle: null,
    dataAttributes: {},
    nearbyText: [],
    captureNearby: false
  }

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'div') {
          const id = attribs.id ?? ''
          if (TARGET_TAB_IDS.has(id)) {
            state.currentSection = id
          }
        }

        if (name === 'li' && (attribs.class ?? '').includes('segment-poster-sm')) {
          state.inCard = true
          state.cardDepth = 1
          state.cardHref = null
          state.cardImgAttr = null
          state.cardDisplayTitle = null
          state.capturingHeading = false
          state.headingBuffer = ''
          state.imgAlt = null
          state.imgTitle = null
          state.anchorTitle = null
          state.dataAttributes = {}
          state.nearbyText = []
          state.captureNearby = true
          return
        }

        if (!state.inCard) return
        state.cardDepth++

        if (name === 'a' && attribs.href) {
          const href = attribs.href
          if (href.includes('/manga/')) {
            state.cardHref = href
            if (attribs.title) {
              state.anchorTitle = cleanText(attribs.title)
            }
          }
        }

        if (name === 'img') {
          const img = attribs['data-img'] || attribs['data-src'] || attribs.src || null
          if (img && !img.startsWith('data:image')) {
            state.cardImgAttr = img
          }
          if (attribs.alt) state.imgAlt = cleanText(attribs.alt)
          if (attribs.title) state.imgTitle = cleanText(attribs.title)

          // Collect any data-* attributes that look like they might hold titles
          const SKIP_DATA_ATTRS = new Set(['data-src', 'data-img', 'data-was-processed', 'data-lazy-src', 'data-original'])
          for (const [key, value] of Object.entries(attribs)) {
            if (key.startsWith('data-') && !SKIP_DATA_ATTRS.has(key)) {
              const cleaned = cleanText(value)
              if (cleaned && cleaned.length > 2 && cleaned.length < 200 && !isUiNoise(cleaned)) {
                state.dataAttributes[key] = state.dataAttributes[key] ?? []
                state.dataAttributes[key].push(cleaned)
              }
            }
          }
        }

        if (name === 'h2' || name === 'h3' || name === 'h4') {
          state.capturingHeading = true
          state.headingBuffer = ''
        }
      },

      ontext(text) {
        if (!state.inCard) return
        if (state.capturingHeading) {
          state.headingBuffer += text
        } else if (state.captureNearby) {
          const cleaned = cleanText(text)
          if (cleaned && cleaned.length > 2 && cleaned.length < 200 && !isUiNoise(cleaned)) {
            state.nearbyText.push(cleaned)
          }
        }
      },

      onclosetag(name) {
        if (!state.inCard) return
        state.cardDepth--

        if (name === 'h2' || name === 'h3' || name === 'h4') {
          state.capturingHeading = false
          const cleaned = cleanText(state.headingBuffer)
          if (cleaned && isUsefulTitle(cleaned)) {
            state.cardDisplayTitle = cleaned
          }
          state.captureNearby = true
        }

        if (name === 'a') {
          state.captureNearby = true
        }

        if (name === 'li' && state.cardDepth === 0) {
          const href = state.cardHref
          if (href) {
            const slug = extractSlugFromUrl(href)
            if (slug) {
              const signals: CardSignals = {
                slug,
                section: state.currentSection ?? inferSectionFromFilename(fileName),
                sourceUrl: `https://readm.today/manga/${slug}`,
                coverPath: extractCoverPath(state.cardImgAttr ?? ''),
                displayTitles: state.cardDisplayTitle ? [state.cardDisplayTitle] : [],
                imgAlts: state.imgAlt ? [state.imgAlt] : [],
                imgTitles: state.imgTitle ? [state.imgTitle] : [],
                anchorTitles: state.anchorTitle ? [state.anchorTitle] : [],
                dataAttributes: state.dataAttributes,
                nearbyText: [...new Set(state.nearbyText)].slice(0, 10)
              }
              onCard(signals)
            }
          }

          state.inCard = false
          state.cardDepth = 0
          state.cardHref = null
          state.cardImgAttr = null
          state.cardDisplayTitle = null
          state.capturingHeading = false
          state.headingBuffer = ''
          state.imgAlt = null
          state.imgTitle = null
          state.anchorTitle = null
          state.dataAttributes = {}
          state.nearbyText = []
          state.captureNearby = false
        }
      }
    },
    {
      decodeEntities: true,
      lowerCaseAttributeNames: false
    }
  )

  return {
    parser,
    onError
  }
}

function mergeSignals(signals: CardSignals[]): DeepMangaSignals {
  const first = signals[0]
  const allDisplayTitles = new Set<string>()
  const allImgAlts = new Set<string>()
  const allImgTitles = new Set<string>()
  const allAnchorTitles = new Set<string>()
  const allDataAttributes: Record<string, Set<string>> = {}
  const allNearbyText = new Set<string>()
  const sections = new Set<string>()

  for (const s of signals) {
    sections.add(s.section)
    s.displayTitles.forEach((t) => allDisplayTitles.add(t))
    s.imgAlts.forEach((t) => allImgAlts.add(t))
    s.imgTitles.forEach((t) => allImgTitles.add(t))
    s.anchorTitles.forEach((t) => allAnchorTitles.add(t))
    s.nearbyText.forEach((t) => allNearbyText.add(t))
    for (const [key, values] of Object.entries(s.dataAttributes)) {
      allDataAttributes[key] = allDataAttributes[key] ?? new Set()
      values.forEach((v) => allDataAttributes[key].add(v))
    }
  }

  // Prefer the longest display title across all occurrences (less likely truncated)
  const displayTitleList = Array.from(allDisplayTitles)
  const bestDisplayTitle = displayTitleList.sort((a, b) => b.length - a.length)[0]

  // Collect all candidate titles by likely quality
  const candidateTitles: string[] = []
  if (bestDisplayTitle) candidateTitles.push(bestDisplayTitle)
  Array.from(allImgTitles).forEach((t) => candidateTitles.push(t))
  Array.from(allAnchorTitles).forEach((t) => candidateTitles.push(t))
  Array.from(allImgAlts).forEach((t) => candidateTitles.push(t))
  Array.from(allNearbyText).forEach((t) => candidateTitles.push(t))

  // Deduplicate preserving order
  const uniqueCandidates = [...new Set(candidateTitles.filter(isUsefulTitle))]

  return {
    slug: first.slug,
    title: humanizeSlug(first.slug),
    display_title: bestDisplayTitle,
    cover_path: first.coverPath,
    list_section: Array.from(sections).join(', '),
    source_url: first.sourceUrl,
    needs_review: isNumericSlug(first.slug),
    occurrence_count: signals.length,
    candidate_titles: uniqueCandidates,
    signals: {
      display_titles: Array.from(allDisplayTitles),
      img_alts: Array.from(allImgAlts),
      img_titles: Array.from(allImgTitles),
      anchor_titles: Array.from(allAnchorTitles),
      data_attributes: Object.fromEntries(
        Object.entries(allDataAttributes).map(([k, v]) => [k, Array.from(v)])
      ),
      nearby_text: Array.from(allNearbyText).slice(0, 20)
    }
  }
}

/**
 * Deep-parse readm.today profile HTML files, extracting every possible title
 * signal per manga slug. Numeric slugs are flagged for review. Occurrences
 * across multiple files are merged so the longest/cleanest title wins.
 */
export async function deepParseFiles(
  filePaths: string[],
  _options: ParseOptions = {}
): Promise<DeepParseResult> {
  const allSignals = new Map<string, CardSignals[]>()
  let totalCards = 0

  for (const filePath of filePaths) {
    const perFileSignals: CardSignals[] = await new Promise((resolve, reject) => {
      const signals: CardSignals[] = []
      const { parser, onError } = createDeepParserHandlers(
        filePath,
        (card) => signals.push(card),
        reject
      )

      const stream = createReadStream(filePath, { encoding: 'utf-8' })
      stream.on('data', (chunk) => parser.write(chunk as string))
      stream.on('end', () => {
        try {
          parser.end()
          resolve(signals)
        } catch (err) {
          onError(err)
        }
      })
      stream.on('error', onError)
    })

    totalCards += perFileSignals.length
    for (const s of perFileSignals) {
      const list = allSignals.get(s.slug) ?? []
      list.push(s)
      allSignals.set(s.slug, list)
    }
  }

  const merged = Array.from(allSignals.values()).map(mergeSignals)
  merged.sort((a, b) => a.slug.localeCompare(b.slug))

  return {
    files: filePaths,
    totalCards,
    uniqueSlugs: merged.length,
    needsReview: merged.filter((m) => m.needs_review).length,
    entries: merged
  }
}

/**
 * Deep-parse a single HTML string.
 */
export async function deepParseString(
  html: string,
  fileName = 'upload.html',
  _options: ParseOptions = {}
): Promise<DeepParseResult> {
  const allSignals = new Map<string, CardSignals[]>()

  await new Promise<void>((resolve, reject) => {
    const { parser, onError } = createDeepParserHandlers(
      fileName,
      (card) => {
        const list = allSignals.get(card.slug) ?? []
        list.push(card)
        allSignals.set(card.slug, list)
      },
      reject
    )

    try {
      parser.write(html)
      parser.end()
      resolve()
    } catch (err) {
      onError(err)
    }
  })

  const merged = Array.from(allSignals.values()).map(mergeSignals)
  merged.sort((a, b) => a.slug.localeCompare(b.slug))

  return {
    files: [fileName],
    totalCards: merged.reduce((sum, m) => sum + m.occurrence_count, 0),
    uniqueSlugs: merged.length,
    needsReview: merged.filter((m) => m.needs_review).length,
    entries: merged
  }
}

/**
 * Deep-parse an HTML stream.
 */
export async function deepParseStream(
  stream: Readable,
  fileName = 'upload.html',
  _options: ParseOptions = {}
): Promise<DeepParseResult> {
  const allSignals = new Map<string, CardSignals[]>()

  await new Promise<void>((resolve, reject) => {
    const { parser, onError } = createDeepParserHandlers(
      fileName,
      (card) => {
        const list = allSignals.get(card.slug) ?? []
        list.push(card)
        allSignals.set(card.slug, list)
      },
      reject
    )

    stream.setEncoding('utf-8')
    stream.on('data', (chunk) => parser.write(chunk as string))
    stream.on('end', () => {
      try {
        parser.end()
        resolve()
      } catch (err) {
        onError(err)
      }
    })
    stream.on('error', onError)
  })

  const merged = Array.from(allSignals.values()).map(mergeSignals)
  merged.sort((a, b) => a.slug.localeCompare(b.slug))

  return {
    files: [fileName],
    totalCards: merged.reduce((sum, m) => sum + m.occurrence_count, 0),
    uniqueSlugs: merged.length,
    needsReview: merged.filter((m) => m.needs_review).length,
    entries: merged
  }
}
