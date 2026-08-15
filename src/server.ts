import 'dotenv/config'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import multer from 'multer'
import os from 'node:os'
import { lookupComick } from './comick.js'
import { parseHtmlFile, parseHtmlString } from './parser.js'
import type { ParseOptions, ParsedManga, ParseResult } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = parseInt(process.env.PORT ?? '4050', 10)
const API_KEY = process.env.API_KEY
const UPLOAD_MAX_FILES = parseInt(process.env.UPLOAD_MAX_FILES ?? '10', 10)
const UPLOAD_MAX_SIZE_MB = parseInt(process.env.UPLOAD_MAX_SIZE_MB ?? '50', 10)

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    files: UPLOAD_MAX_FILES,
    fileSize: UPLOAD_MAX_SIZE_MB * 1024 * 1024
  }
})

const app = express()
app.use(cors())
app.use(express.json())

interface ApiError {
  error: string
  code?: string
}

function requireApiKey(req: Request, res: Response, next: () => void) {
  if (!API_KEY) {
    next()
    return
  }
  const key = req.headers['x-api-key']
  if (!key || key !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized', code: 'missing_or_invalid_api_key' } as ApiError)
    return
  }
  next()
}

function sectionsFromQuery(raw: unknown): Set<string> | null {
  if (!raw) return null
  const arr = Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim())
  const filtered = arr.filter((s) => typeof s === 'string' && s.length > 0)
  return filtered.length > 0 ? new Set(filtered) : null
}

function filterSections(result: ParseResult, include: Set<string> | null): ParseResult {
  if (!include) return result
  return {
    ...result,
    entries: result.entries.filter((e) => include.has(e.list_section))
  }
}

async function applyComick(result: ParseResult, opts: ParseOptions): Promise<ParseResult> {
  if (!opts.comick) return result
  const delay = opts.comickDelay ?? 500
  const timeout = opts.comickTimeout ?? 5000
  const updated: ParsedManga[] = []
  for (const entry of result.entries) {
    updated.push(await lookupComick(entry, delay, timeout))
  }
  return {
    ...result,
    entries: updated,
    needsReview: updated.filter((e) => e.needs_review).length
  }
}

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'manga-html-importer' })
})

app.use('/docs', express.static(path.join(__dirname, '../docs')))
app.get('/', (req: Request, res: Response) => {
  res.redirect('/docs')
})

app.post(
  '/parse',
  requireApiKey,
  upload.array('files'),
  async (req: Request, res: Response) => {
    try {
      const files = (req.files ?? []) as Express.Multer.File[]
      if (files.length === 0) {
        res.status(400).json({ error: 'No files uploaded', code: 'no_files' } as ApiError)
        return
      }

      const includeSections = sectionsFromQuery(req.query.sections)
      const comick = req.query.comick === 'true' || req.query.comick === '1'
      const comickDelay = parseInt(String(req.query.comickDelay ?? '500'), 10)
      const comickTimeout = parseInt(String(req.query.comickTimeout ?? '5000'), 10)
      const opts: ParseOptions = { comick, comickDelay, comickTimeout }

      const results: ParseResult[] = []
      for (const file of files) {
        const originalName = file.originalname || file.filename
        let result = await parseHtmlFile(file.path, opts)
        result = filterSections(result, includeSections)
        result = await applyComick(result, opts)
        results.push(result)

        try {
          unlinkSync(file.path)
        } catch {
          // ignore cleanup errors
        }
      }

      const allSlugs = new Map<string, ParsedManga>()
      for (const result of results) {
        for (const entry of result.entries) {
          if (!allSlugs.has(entry.slug)) {
            allSlugs.set(entry.slug, entry)
          }
        }
      }
      const combined = Array.from(allSlugs.values())
      const bySection: Record<string, number> = {}
      for (const entry of combined) {
        bySection[entry.list_section] = (bySection[entry.list_section] ?? 0) + 1
      }

      res.json({
        files: results.map((r) => ({
          file: r.file,
          section: r.section,
          entries: r.entries.length,
          duplicatesRemoved: r.duplicatesRemoved,
          needsReview: r.needsReview
        })),
        totalUnique: combined.length,
        totalNeedsReview: combined.filter((e) => e.needs_review).length,
        bySection,
        combined
      })
    } catch (err) {
      console.error('[api] parse error', err)
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
        code: 'parse_error'
      } as ApiError)
    }
  }
)

app.post('/parse-text', requireApiKey, async (req: Request, res: Response) => {
  try {
    const html = String(req.body?.html ?? '')
    const fileName = String(req.body?.filename ?? 'upload.html')
    if (!html) {
      res.status(400).json({ error: 'Missing html body', code: 'missing_html' } as ApiError)
      return
    }

    const includeSections = sectionsFromQuery(req.query.sections)
    const comick = req.query.comick === 'true' || req.query.comick === '1'
    const comickDelay = parseInt(String(req.query.comickDelay ?? '500'), 10)
    const comickTimeout = parseInt(String(req.query.comickTimeout ?? '5000'), 10)
    const opts: ParseOptions = { comick, comickDelay, comickTimeout }

    let result = await parseHtmlString(html, fileName, opts)
    result = filterSections(result, includeSections)
    result = await applyComick(result, opts)

    res.json({
      file: result.file,
      section: result.section,
      entries: result.entries.length,
      duplicatesRemoved: result.duplicatesRemoved,
      needsReview: result.needsReview,
      combined: result.entries
    })
  } catch (err) {
    console.error('[api] parse-text error', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
      code: 'parse_error'
    } as ApiError)
  }
})

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'not_found' } as ApiError)
})

app.listen(PORT, () => {
  console.log(`Manga HTML Importer API listening on http://localhost:${PORT}`)
})
