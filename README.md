# Manga HTML Importer

Parse **readm.today** profile HTML files and extract full manga titles, slugs, cover image paths, and list sections for import into **Manga Sanctuary**.

Includes a CLI and an HTTP API.

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
- HTTP API for uploading files and receiving JSON back
- Outputs JSON, NDJSON, and a combined summary

## Install

```bash
git clone https://github.com/The-Code-Labz/manga-html-importer.git
cd manga-html-importer
npm install
npm run build
```

## CLI Usage

```bash
npm run start:cli -- path/to/Profile___Read_Manga_Online.html \
  path/to/Profile___Read_Manga_Online_fav.html \
  path/to/Profile___Read_Manga_Online_Plan_to_read.html
```

Or with comick.dev lookups:

```bash
npm run start:cli -- --comick *.html
```

Output lands in `output/`:
- `Profile___Read_Manga_Online.json`
- `Profile___Read_Manga_Online_fav.json`
- `Profile___Read_Manga_Online_Plan_to_read.json`
- `combined.json`
- `combined.ndjson`

### CLI Options

| Flag | Description |
|---|---|
| `-o, --output <dir>` | Output directory (default: `output`) |
| `-c, --comick` | Cross-reference comick.dev for titles/covers |
| `--comick-delay <ms>` | Delay between comick requests (default: 500) |
| `--comick-timeout <ms>` | Timeout for comick requests (default: 5000) |
| `--sections <sections...>` | Sections to include (default: plan-to-read favorites subscriptions) |

## API Usage

Start the server:

```bash
cp .env.example .env
npm start
```

The server listens on `http://localhost:4050` by default.

### `GET /health`

```bash
curl http://localhost:4050/health
```

### `POST /parse`

Upload one or more HTML files as multipart/form-data.

```bash
curl -X POST http://localhost:4050/parse \
  -F 'files=@Profile___Read_Manga_Online.html' \
  -F 'files=@Profile___Read_Manga_Online_fav.html' \
  -F 'files=@Profile___Read_Manga_Online_Plan_to_read.html'
```

Query parameters:

| Param | Description |
|---|---|
| `sections` | Comma-separated sections to include (default: all) |
| `comick` | Set `true` to cross-reference comick.dev |
| `comickDelay` | Delay between comick requests in ms (default: 500) |
| `comickTimeout` | Timeout for comick requests in ms (default: 5000) |

Example:

```bash
curl -X POST 'http://localhost:4050/parse?sections=favorites,plan-to-read' \
  -F 'files=@Profile___Read_Manga_Online.html'
```

### `POST /parse-text`

Send raw HTML in the request body.

```bash
curl -X POST http://localhost:4050/parse-text \
  -H 'Content-Type: application/json' \
  -d '{"html": "<html>...</html>", "filename": "profile.html"}'
```

### Response format

```json
{
  "files": [
    {
      "file": "Profile___Read_Manga_Online.html",
      "section": "plan-to-read",
      "entries": 554,
      "duplicatesRemoved": 12,
      "needsReview": 45
    }
  ],
  "totalUnique": 1715,
  "totalNeedsReview": 902,
  "bySection": {
    "plan-to-read": 554,
    "favorites": 1161
  },
  "combined": [
    {
      "title": "I Became the Target of the Harem in Another World",
      "slug": "i-became-the-target-of-the-harem-in-another-world",
      "cover_path": "1721041464.jpg",
      "list_section": "plan-to-read",
      "source_url": "https://readm.today/manga/i-became-the-target-of-the-harem-in-another-world",
      "needs_review": false
    }
  ]
}
```

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 4050) |
| `API_KEY` | Optional `x-api-key` header value for API auth |
| `UPLOAD_MAX_FILES` | Max files per upload (default: 10) |
| `UPLOAD_MAX_SIZE_MB` | Max upload size in MB (default: 50) |

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
- The API keeps uploaded files in memory only during parsing and deletes them immediately after.
