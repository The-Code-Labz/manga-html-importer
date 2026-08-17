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
  /** Truncated title displayed on the readm.today card, if available */
  display_title?: string
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

export interface RescueOptions {
  /** Query comick.dev for canonical titles/covers */
  comick?: boolean
  /** Delay between comick requests in ms */
  comickDelay?: number
  /** Timeout for comick requests */
  comickTimeout?: number
  /** Query Kitsu for canonical titles/covers */
  kitsu?: boolean
  /** Query AniList for canonical titles */
  anilist?: boolean
  /** Query the Wayback Machine for archived readm.today manga pages */
  wayback?: boolean
  /** Timeout for Wayback requests */
  waybackTimeout?: number
}

export interface TitleCandidate {
  source: 'cover_filename' | 'comick' | 'kitsu' | 'anilist' | 'wayback' | 'humanized' | 'deep_parse'
  title: string
  slug?: string
  cover_url?: string
  confidence: number
  url?: string
}

export interface DeepMangaSignals {
  slug: string
  title: string
  display_title?: string
  cover_path: string
  list_section: string
  source_url: string
  needs_review: boolean
  occurrence_count: number
  candidate_titles: string[]
  signals: {
    display_titles: string[]
    img_alts: string[]
    img_titles: string[]
    anchor_titles: string[]
    data_attributes: Record<string, string[]>
    nearby_text: string[]
  }
}

export interface DeepParseResult {
  files: string[]
  totalCards: number
  uniqueSlugs: number
  needsReview: number
  entries: DeepMangaSignals[]
}

export interface RescueResult {
  /** Original numeric slug */
  slug: string
  /** Original humanized title from the numeric slug */
  original_title: string
  /** Truncated title displayed on the readm.today card, if available */
  display_title?: string
  /** Cover image filename */
  cover_path: string
  /** List section */
  list_section: string
  /** Full readm.today URL */
  source_url: string
  /** All title candidates found, sorted by confidence descending */
  candidates: TitleCandidate[]
  /** Best candidate (highest confidence) */
  best_candidate?: TitleCandidate
  /** True if no usable candidate was found */
  needs_review: boolean
  /** True if a candidate with acceptable confidence was found */
  rescued: boolean
}

export interface RescueSummary {
  total: number
  rescued: number
  needs_review: number
  bySource: Record<string, number>
}
