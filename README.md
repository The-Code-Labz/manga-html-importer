# Manga HTML Importer

Parse **readm.today** profile HTML files and extract full manga titles, slugs, cover image paths, and list sections for import into **Manga Sanctuary**.

## Why

Docuflow and other document parsers strip the HTML structure and return only the **truncated** titles shown on the page (e.g. `I Became the Ta..`). This tool parses the raw HTML with a streaming parser and derives the full title from the canonical URL slug.

## Features

- Streaming parser handles ~3.3MB HTML files without regex backtracking
- Extracts:
  - Full title (humanized from slug)
  - Canonical slug
  - Cover image filename
  - List section: `plan-to-read`, `favorites`, `subscriptions`
- Deduplicates by slug across files
- Flags numeric-only slugs for manual review
- Optional comick.dev cross-reference for canonical titles + covers
- Outputs JSON, NDJSON, and a combined summary

## Install

```bash
git clone https://github.com/The-Code-Labz/manga-html-importer.git
cd manga-html-importer
npm install
npm run build
```

## Usage

```bash
npm start -- path/to/Profile___Read_Manga_Online.html \
  path/to/Profile___Read_Manga_Online_fav.html \
  path/to/Profile___Read_Manga_Online_Plan_to_read.html
```

Or with comick.dev lookups:

```bash
npm start -- --comick *.html
```

Output lands in `output/`:
- `Profile___Read_Manga_Online.json`
- `Profile___Read_Manga_Online_fav.json`
- `Profile___Read_Manga_Online_Plan_to_read.json`
- `combined.json`
- `combined.ndjson`

## Options

| Flag | Description |
|---|---|
| `-o, --output <dir>` | Output directory (default: `output`) |
| `-c, --comick` | Cross-reference comick.dev for titles/covers |
| `--comick-delay <ms>` | Delay between comick requests (default: 500) |
| `--comick-timeout <ms>` | Timeout for comick requests (default: 5000) |
| `--sections <sections...>` | Sections to include (default: plan-to-read favorites subscriptions) |

## Output format

```json
{
  "title": "I Became the Target of the Harem in Another World",
  "slug": "i-became-the-target-of-the-harem-in-another-world",
  "cover_path": "1721041464.jpg",
  "list_section": "plan-to-read",
  "source_url": "https://readm.today/manga/i-became-the-target-of-the-harem-in-another-world",
  "needs_review": false
}
```

## Notes

- Numeric-only slugs like `17318` are flagged with `needs_review: true`.
- The parser ignores `reading-history` and `collections` sections by default.
- For single-section HTML files (e.g. `*_fav.html`), the section is inferred from the filename.
