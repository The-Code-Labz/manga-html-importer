export interface ParsedManga {
  /** Human-readable title derived from the slug */
  title: string
  /** Canonical slug from the readm.today URL */
  slug: string
  /** Cover image filename from data-img or data-src */
  cover_path: string
  /** Which list section this entry belongs to */
  list_section: string
  /** Full readm.today URL */
  source_url: string
  /** True if the slug is numeric-only and needs manual review */
  needs_review: boolean
  /** Optional comick.dev cross-reference data */
  comick?: ComickResult
}

export interface ComickResult {
  title?: string
  slug?: string
  cover_url?: string
  matched: boolean
  source: 'comick' | 'humanized'
}

export interface ParseOptions {
  /** Infer section from filename if no tab structure is found */
  inferSectionFromFilename?: boolean
  /** Cross-reference comick.dev for canonical titles/covers */
  comick?: boolean
  /** Delay between comick requests in ms */
  comickDelay?: number
  /** Timeout for comick requests */
  comickTimeout?: number
}

export interface ParseResult {
  file: string
  section: string | null
  entries: ParsedManga[]
  duplicatesRemoved: number
  needsReview: number
}

export interface ParseSummary {
  files: ParseResult[]
  totalUnique: number
  totalNeedsReview: number
  bySection: Record<string, number>
}
