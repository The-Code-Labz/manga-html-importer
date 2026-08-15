export const DOCS_MARKDOWN = `# Manga HTML Importer API

Parse **readm.today** profile HTML files and extract full manga titles, slugs, cover image paths, and list sections for import into **Manga Sanctuary**.

## Base URL

- Local: \`http://localhost:4050\`
- Forge: \`https://manga-html-importer.forge.neurolearninglabs.com\`

## Endpoints

### GET /health

Health check.

\`\`\`bash
curl https://manga-html-importer.forge.neurolearninglabs.com/health
\`\`\`

### POST /parse

Upload one or more HTML files as \`multipart/form-data\`.

**Form field:** \`files\` (may be repeated)

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| \`sections\` | string | Comma-separated sections to include: \`plan-to-read\`, \`favorites\`, \`subscriptions\` |
| \`comick\` | boolean | Set \`true\` to cross-reference comick.dev for titles/covers |
| \`comickDelay\` | number | Delay between comick requests in ms (default: 500) |
| \`comickTimeout\` | number | Timeout for comick requests in ms (default: 5000) |

\`\`\`bash
curl -X POST 'https://manga-html-importer.forge.neurolearninglabs.com/parse?sections=favorites,plan-to-read' \\
  -F 'files=@Profile___Read_Manga_Online_fav.html'
\`\`\`

### POST /parse-text

Send raw HTML in the request body.

\`\`\`bash
curl -X POST https://manga-html-importer.forge.neurolearninglabs.com/parse-text \\
  -H 'Content-Type: application/json' \\
  -d '{"html": "<html>...</html>", "filename": "profile.html"}'
\`\`\`

## Response format

\`\`\`json
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
\`\`\`

## Configuration

| Variable | Description |
|---|---|
| \`PORT\` | Server port (default: 4050) |
| \`API_KEY\` | Optional \`x-api-key\` header value for API auth |
| \`UPLOAD_MAX_FILES\` | Max files per upload (default: 10) |
| \`UPLOAD_MAX_SIZE_MB\` | Max upload size in MB (default: 50) |

## Notes

- Numeric-only slugs like \`17318\` are flagged with \`needs_review: true\`.
- The parser ignores \`reading-history\` and \`collections\` sections by default.
- Uploaded files are deleted immediately after parsing.
`

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function markdownToHtml(md: string): string {
  let html = escapeHtml(md)
    .replace(/^###### (.*$)/gim, '<h6>$1</h6>')
    .replace(/^##### (.*$)/gim, '<h5>$1</h5>')
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\s*[-*] (.*$)/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/^\|(.+)\|$/gim, (match) => {
      const cells = match.slice(1, -1).split('|').map((c) => `<td>${c.trim()}</td>`).join('')
      return `<tr>${cells}</tr>`
    })
    .replace(/<tr>(?:(?!<tr>).)*<\/tr>/gs, (match) => `<table>${match}</table>`)
    .replace(/\`\`\`(\w+)?\n?([\s\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>')

  html = html.replace(/<\/ul>\s*<ul>/g, '')
  return html
}

export function renderDocsPage(): string {
  const htmlBody = markdownToHtml(DOCS_MARKDOWN)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manga HTML Importer — API Docs</title>
  <style>
    :root {
      --bg: #0f0f12;
      --surface: #18181c;
      --text: #e4e4e7;
      --muted: #a1a1aa;
      --accent: #f97316;
      --accent-hover: #fb923c;
      --border: #27272a;
      --code: #27272a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    header {
      position: sticky;
      top: 0;
      background: rgba(15, 15, 18, 0.95);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      padding: 1rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      z-index: 10;
    }
    header h1 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    header span {
      color: var(--accent);
    }
    button#copyBtn {
      background: var(--accent);
      color: #000;
      border: none;
      padding: 0.55rem 1rem;
      border-radius: 0.5rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button#copyBtn:hover { background: var(--accent-hover); }
    button#copyBtn.copied { background: #22c55e; color: #fff; }
    main {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #fff;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
    }
    h1 { font-size: 2rem; border-bottom: 2px solid var(--accent); padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
    h3 { font-size: 1.2rem; color: var(--accent); }
    p { margin: 0.75rem 0; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul {
      padding-left: 1.5rem;
      margin: 0.75rem 0;
    }
    li { margin: 0.35rem 0; }
    code {
      background: var(--code);
      padding: 0.15rem 0.35rem;
      border-radius: 0.3rem;
      font-size: 0.9em;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    pre {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.6rem;
      padding: 1rem;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code {
      background: transparent;
      padding: 0;
      font-size: 0.85rem;
      white-space: pre;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      overflow: hidden;
    }
    th, td {
      padding: 0.7rem 0.9rem;
      border-bottom: 1px solid var(--border);
      text-align: left;
      font-size: 0.95rem;
    }
    th {
      background: var(--bg);
      color: #fff;
      font-weight: 600;
    }
    tr:last-child td { border-bottom: none; }
    @media (max-width: 640px) {
      header { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
      h1 { font-size: 1.6rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1><span>📚</span> Manga HTML Importer — API Docs</h1>
    <button id="copyBtn">Copy Markdown</button>
  </header>
  <main>
    ${htmlBody}
  </main>
  <script>
    const markdown = ${JSON.stringify(DOCS_MARKDOWN)};
    const btn = document.getElementById('copyBtn');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(markdown);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy Markdown';
          btn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        btn.textContent = 'Failed to copy';
        setTimeout(() => { btn.textContent = 'Copy Markdown'; }, 2000);
      }
    });
  </script>
</body>
</html>`
}
