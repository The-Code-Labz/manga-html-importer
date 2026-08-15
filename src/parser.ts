import { Parser } from 'htmlparser2'
import { createReadStream } from 'node:fs'
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

function inferSectionFromFilename(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.includes('fav')) return 'favorites'
  if (lower.includes('plan-to-read') || lower.includes('plantoread') || lower.includes('plan')) return 'plan-to-read'
  if (lower.includes('sub')) return 'subscriptions'
  return 'unknown'
}

/**
 * Streaming parser for readm.today profile HTML files.
 * Uses htmlparser2 to avoid loading the entire ~3.3MB file into a DOM
 * and to avoid regex backtracking on huge inputs.
 */
export function parseHtmlFile(
  filePath: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
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
          // Track tab segments: <div class="...tab segment..." id="plan-to-read"
          if (name === 'div') {
            const cls = attribs.class ?? ''
            const id = attribs.id ?? ''
            if (cls.includes('tab') && cls.includes('segment') && TARGET_TAB_IDS.has(id)) {
              state.sectionStack.push({ id, depth: 1 })
              state.currentSection = id
              foundAnySection = true
            } else if (state.sectionStack.length > 0) {
              // Nested div inside active section
              state.sectionStack[state.sectionStack.length - 1].depth++
            }
          }

          // Enter a manga card
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

          // Capture the manga link and slug
          if (name === 'a' && attribs.href) {
            const href = attribs.href
            if (href.includes('/manga/')) {
              state.cardHref = href
            }
          }

          // Capture cover image from data-src, data-img, or src
          if (name === 'img') {
            const img =
              attribs['data-img'] || attribs['data-src'] || attribs.src || null
            if (img && !img.startsWith('data:image')) {
              state.cardImgAttr = img
            }
          }

          // Start capturing the displayed (possibly truncated) title
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
          // Update section depth tracking
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

          // When the card closes, finalize the entry
          if (name === 'li' && state.cardDepth === 0) {
            const href = state.cardHref
            if (href) {
              const slug = extractSlugFromUrl(href)
              if (slug) {
                if (seenSlugs.has(slug)) {
                  duplicatesRemoved++
                } else {
                  seenSlugs.add(slug)
                  const section = state.currentSection ?? inferSectionFromFilename(filePath)
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

    const stream = createReadStream(filePath, { encoding: 'utf-8' })
    stream.on('data', (chunk) => parser.write(chunk as string))
    stream.on('end', () => {
      parser.end()

      const effectiveSection =
        state.currentSection ??
        (foundAnySection ? null : inferSectionFromFilename(filePath))

      resolve({
        file: filePath,
        section: effectiveSection,
        entries,
        duplicatesRemoved,
        needsReview: entries.filter((e) => e.needs_review).length
      })
    })
    stream.on('error', reject)
  })
}

export { inferSectionFromFilename }
