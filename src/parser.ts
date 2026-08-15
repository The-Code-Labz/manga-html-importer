import { Parser } from 'htmlparser2'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { extractCoverPath, extractSlugFromUrl, humanizeSlug, isNumericSlug } from './humanize.js'
import type { ParseOptions, ParsedManga, ParseResult } from './types.js'

interface SectionFrame {
  id: string
  depth: number
}

interface ParserState {
  currentSection: string | null
  sectionStack: SectionFrame[]
  inCard: boolean
  cardDepth: number
  cardHref: string | null
  cardImgAttr: string | null
  cardTitle: string | null
  capturingTitle: boolean
}

const TARGET_TAB_IDS = new Set(['plan-to-read', 'favorites', 'subscriptions', 'reading-history'])

export function inferSectionFromFilename(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.includes('fav')) return 'favorites'
  if (lower.includes('plan-to-read') || lower.includes('plantoread') || lower.includes('plan')) return 'plan-to-read'
  if (lower.includes('sub')) return 'subscriptions'
  return 'unknown'
}

function createParserHandlers(
  fileName: string,
  resolve: (value: ParseResult) => void,
  reject: (reason?: unknown) => void
) {
  const state: ParserState = {
    currentSection: null,
    sectionStack: [],
    inCard: false,
    cardDepth: 0,
    cardHref: null,
    cardImgAttr: null,
    cardTitle: null,
    capturingTitle: false
  }

  const entries: ParsedManga[] = []
  const seenSlugs = new Set<string>()
  let duplicatesRemoved = 0
  let foundAnySection = false

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'div') {
          const cls = attribs.class ?? ''
          const id = attribs.id ?? ''
          if (cls.includes('tab') && cls.includes('segment') && TARGET_TAB_IDS.has(id)) {
            state.sectionStack.push({ id, depth: 1 })
            state.currentSection = id
            foundAnySection = true
          } else if (state.sectionStack.length > 0) {
            state.sectionStack[state.sectionStack.length - 1].depth++
          }
        }

        if (name === 'li' && (attribs.class ?? '').includes('segment-poster-sm')) {
          state.inCard = true
          state.cardDepth = 1
          state.cardHref = null
          state.cardImgAttr = null
          state.cardTitle = null
          state.capturingTitle = false
          return
        }

        if (!state.inCard) return

        state.cardDepth++

        if (name === 'a' && attribs.href) {
          const href = attribs.href
          if (href.includes('/manga/')) {
            state.cardHref = href
          }
        }

        if (name === 'img') {
          const img = attribs['data-img'] || attribs['data-src'] || attribs.src || null
          if (img && !img.startsWith('data:image')) {
            state.cardImgAttr = img
          }
        }

        if (name === 'h2') {
          state.capturingTitle = true
          state.cardTitle = ''
        }
      },

      ontext(text) {
        if (state.inCard && state.capturingTitle && state.cardTitle !== null) {
          state.cardTitle += text
        }
      },

      onclosetag(name) {
        if (name === 'div' && state.sectionStack.length > 0) {
          const frame = state.sectionStack[state.sectionStack.length - 1]
          frame.depth--
          if (frame.depth === 0) {
            state.sectionStack.pop()
            const prev = state.sectionStack[state.sectionStack.length - 1]
            state.currentSection = prev?.id ?? null
          }
        }

        if (!state.inCard) return

        state.cardDepth--

        if (name === 'h2') {
          state.capturingTitle = false
          if (state.cardTitle) {
            state.cardTitle = state.cardTitle.trim()
          }
        }

        if (name === 'li' && state.cardDepth === 0) {
          const href = state.cardHref
          if (href) {
            const slug = extractSlugFromUrl(href)
            if (slug) {
              if (seenSlugs.has(slug)) {
                duplicatesRemoved++
              } else {
                seenSlugs.add(slug)
                const section = state.currentSection ?? inferSectionFromFilename(fileName)
                const canonicalUrl = `https://readm.today/manga/${slug}`
                entries.push({
                  title: humanizeSlug(slug),
                  slug,
                  cover_path: extractCoverPath(state.cardImgAttr ?? ''),
                  list_section: section,
                  source_url: canonicalUrl,
                  needs_review: isNumericSlug(slug)
                })
              }
            }
          }

          state.inCard = false
          state.cardDepth = 0
          state.cardHref = null
          state.cardImgAttr = null
          state.cardTitle = null
          state.capturingTitle = false
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
    finalize: () => {
      parser.end()
      const effectiveSection =
        state.currentSection ??
        (foundAnySection ? null : inferSectionFromFilename(fileName))

      resolve({
        file: fileName,
        section: effectiveSection,
        entries,
        duplicatesRemoved,
        needsReview: entries.filter((e) => e.needs_review).length
      })
    },
    onError: reject
  }
}

/**
 * Streaming parser for readm.today profile HTML files.
 * Uses htmlparser2 to avoid loading the entire ~3.3MB file into a DOM
 * and to avoid regex backtracking on huge inputs.
 */
export function parseHtmlFile(
  filePath: string,
  _options: ParseOptions = {}
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const { parser, finalize, onError } = createParserHandlers(filePath, resolve, reject)

    const stream = createReadStream(filePath, { encoding: 'utf-8' })
    stream.on('data', (chunk) => parser.write(chunk as string))
    stream.on('end', finalize)
    stream.on('error', onError)
  })
}

/**
 * Parse HTML from a readable stream.
 */
export function parseHtmlStream(
  stream: Readable,
  fileName = 'upload.html',
  _options: ParseOptions = {}
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const { parser, finalize, onError } = createParserHandlers(fileName, resolve, reject)

    stream.setEncoding('utf-8')
    stream.on('data', (chunk) => parser.write(chunk as string))
    stream.on('end', finalize)
    stream.on('error', onError)
  })
}

/**
 * Parse HTML from a string.
 */
export function parseHtmlString(
  html: string,
  fileName = 'upload.html',
  _options: ParseOptions = {}
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const { parser, finalize, onError } = createParserHandlers(fileName, resolve, reject)

    try {
      parser.write(html)
      finalize()
    } catch (err) {
      onError(err)
    }
  })
}
