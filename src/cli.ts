#!/usr/bin/env node
import { Command } from 'commander'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { lookupComick } from './comick.js'
import { parseHtmlFile } from './parser.js'
import type { ParseOptions, ParseSummary } from './types.js'

const program = new Command()

program
  .name('manga-html-importer')
  .description('Parse readm.today profile HTML files for Manga Sanctuary import')
  .version('1.0.0')
  .argument('<files...>', 'HTML files to parse')
  .option('-o, --output <dir>', 'output directory', 'output')
  .option('-c, --comick', 'cross-reference comick.dev for canonical titles/covers', false)
  .option('--comick-delay <ms>', 'delay between comick requests', '500')
  .option('--comick-timeout <ms>', 'timeout for comick requests', '5000')
  .option('--sections <sections...>', 'sections to include', [
    'plan-to-read',
    'favorites',
    'subscriptions'
  ])
  .action(async (files: string[], options) => {
    const outputDir = resolve(options.output)
    await mkdir(outputDir, { recursive: true })

    const parseOptions: ParseOptions = {
      inferSectionFromFilename: true,
      comick: options.comick,
      comickDelay: parseInt(options.comickDelay, 10),
      comickTimeout: parseInt(options.comickTimeout, 10)
    }

    const includeSections = new Set(options.sections as string[])

    const summary: ParseSummary = {
      files: [],
      totalUnique: 0,
      totalNeedsReview: 0,
      bySection: {}
    }

    for (const file of files) {
      const filePath = resolve(file)
      console.error(`Parsing ${basename(filePath)}...`)

      const result = await parseHtmlFile(filePath, parseOptions)

      // Filter to requested sections
      result.entries = result.entries.filter((e) => includeSections.has(e.list_section))

      // Optionally cross-reference comick.dev
      if (parseOptions.comick) {
        console.error('  Looking up titles on comick.dev...')
        for (let i = 0; i < result.entries.length; i++) {
          result.entries[i] = await lookupComick(
            result.entries[i],
            parseOptions.comickDelay,
            parseOptions.comickTimeout
          )
          process.stderr.write(`    ${i + 1}/${result.entries.length}\r`)
        }
        console.error('')
      }

      // Update needsReview count after filtering/comick
      result.needsReview = result.entries.filter((e) => e.needs_review).length

      summary.files.push(result)
      summary.totalUnique += result.entries.length
      summary.totalNeedsReview += result.needsReview

      for (const entry of result.entries) {
        summary.bySection[entry.list_section] =
          (summary.bySection[entry.list_section] ?? 0) + 1
      }

      const outName = basename(filePath, '.html') + '.json'
      await writeFile(
        resolve(outputDir, outName),
        JSON.stringify(result, null, 2)
      )
      console.error(`  Wrote ${result.entries.length} entries to ${outName}`)
    }

    // Write combined deduplicated summary
    const allSlugs = new Map<string, (typeof summary.files)[number]['entries'][number]>()
    for (const file of summary.files) {
      for (const entry of file.entries) {
        // Prefer comick-enhanced entries; otherwise keep first seen
        if (!allSlugs.has(entry.slug)) {
          allSlugs.set(entry.slug, entry)
        }
      }
    }
    const combined = Array.from(allSlugs.values())
    const combinedNeedsReview = combined.filter((e) => e.needs_review).length

    await writeFile(
      resolve(outputDir, 'combined.json'),
      JSON.stringify(
        {
          ...summary,
          combined,
          combinedCount: combined.length,
          combinedNeedsReview
        },
        null,
        2
      )
    )

    console.error('\n--- Summary ---')
    console.error(`Files parsed:           ${summary.files.length}`)
    console.error(`Total entries:          ${summary.totalUnique}`)
    console.error(`Unique combined:        ${combined.length}`)
    console.error(`Needs review (raw):     ${summary.totalNeedsReview}`)
    console.error(`Needs review (unique):  ${combinedNeedsReview}`)
    console.error('By section:')
    for (const [section, count] of Object.entries(summary.bySection)) {
      console.error(`  ${section}: ${count}`)
    }
    console.error(`\nOutput written to: ${outputDir}`)

    // Also write newline-delimited JSON for easy streaming import
    await writeFile(
      resolve(outputDir, 'combined.ndjson'),
      combined.map((e) => JSON.stringify(e)).join('\n') + '\n'
    )
  })

program.parse()
