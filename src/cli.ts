#!/usr/bin/env node
import { Command } from 'commander'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { lookupComick } from './comick.js'
import { deepParseFiles } from './deepParser.js'
import { parseHtmlFile } from './parser.js'
import { rescueTitles, waybackSample } from './rescue.js'
import type { ParsedManga, ParseOptions, ParseSummary, RescueOptions } from './types.js'

const program = new Command()

program
  .name('manga-html-importer')
  .description('Parse readm.today profile HTML files for Manga Sanctuary import')
  .version('1.1.0')

program
  .command('parse')
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
  .option('--rescue-titles', 'attempt to rescue real titles for numeric slugs', false)
  .option('--rescue-kitsu', 'use Kitsu during title rescue', false)
  .option('--rescue-anilist', 'use AniList during title rescue', false)
  .option('--rescue-wayback', 'use Wayback Machine during title rescue', false)
  .action(async (files: string[], options) => {
    const outputDir = resolve(options.output)
    await mkdir(outputDir, { recursive: true })

    const parseOptions: ParseOptions = {
      inferSectionFromFilename: true,
      comick: options.comick,
      comickDelay: parseInt(options.comickDelay, 10),
      comickTimeout: parseInt(options.comickTimeout, 10)
    }

    const rescueOptions: RescueOptions = options.rescueTitles
      ? {
          comick: true,
          comickDelay: parseInt(options.comickDelay, 10),
          comickTimeout: parseInt(options.comickTimeout, 10),
          kitsu: options.rescueKitsu,
          anilist: options.rescueAnilist,
          wayback: options.rescueWayback
        }
      : {}

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

      // Optionally rescue numeric slugs. When multiple files are passed, we skip
      // per-file rescue to avoid duplicate API work; combined rescue handles the
      // unique slugs once at the end.
      let rescueResults = null
      if (options.rescueTitles && files.length === 1 && result.entries.some((e) => e.needs_review)) {
        console.error('  Rescuing numeric slug titles...')
        rescueResults = await rescueTitles(result.entries, rescueOptions)
        console.error(`    rescued ${rescueResults.summary.rescued}/${rescueResults.summary.total}`)
      }

      // Update needsReview count after filtering/comick/rescue
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
        JSON.stringify({ ...result, rescue: rescueResults }, null, 2)
      )
      console.error(`  Wrote ${result.entries.length} entries to ${outName}`)
    }

    // Write combined deduplicated summary
    const allSlugs = new Map<string, ParsedManga>()
    for (const file of summary.files) {
      for (const entry of file.entries) {
        if (!allSlugs.has(entry.slug)) {
          allSlugs.set(entry.slug, entry)
        }
      }
    }
    const combined = Array.from(allSlugs.values())
    const combinedNeedsReview = combined.filter((e) => e.needs_review).length

    // Rescue combined numeric slugs if requested
    let combinedRescue = null
    if (options.rescueTitles && combined.some((e) => e.needs_review)) {
      console.error('\nRescuing combined numeric slugs...')
      combinedRescue = await rescueTitles(combined, rescueOptions)
    }

    await writeFile(
      resolve(outputDir, 'combined.json'),
      JSON.stringify(
        {
          ...summary,
          combined,
          combinedCount: combined.length,
          combinedNeedsReview,
          rescue: combinedRescue
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
    if (combinedRescue) {
      console.error(`Rescued titles:         ${combinedRescue.summary.rescued}`)
      console.error('By source:')
      for (const [source, count] of Object.entries(combinedRescue.summary.bySource)) {
        console.error(`  ${source}: ${count}`)
      }
    }
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

    if (combinedRescue) {
      await writeFile(
        resolve(outputDir, 'rescue.ndjson'),
        combinedRescue.results.map((r) => JSON.stringify(r)).join('\n') + '\n'
      )
    }
  })

program
  .command('rescue')
  .description('Run title rescue on an existing JSON/NDJSON file of ParsedManga entries')
  .argument('<input>', 'JSON or NDJSON file containing parsed manga entries')
  .option('-o, --output <dir>', 'output directory', 'output')
  .option('--comick', 'use comick.dev', true)
  .option('--kitsu', 'use Kitsu', false)
  .option('--anilist', 'use AniList', false)
  .option('--wayback', 'use Wayback Machine', false)
  .option('--delay <ms>', 'delay between API requests', '500')
  .option('--timeout <ms>', 'API request timeout', '5000')
  .action(async (input: string, options) => {
    const outputDir = resolve(options.output)
    await mkdir(outputDir, { recursive: true })

    const raw = await readFile(resolve(input), 'utf8')
    const entries: ParsedManga[] = raw.trim().startsWith('[')
      ? (JSON.parse(raw) as ParsedManga[])
      : raw
          .split('\n')
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as ParsedManga)

    const rescueOptions: RescueOptions = {
      comick: options.comick,
      comickDelay: parseInt(options.delay, 10),
      comickTimeout: parseInt(options.timeout, 10),
      kitsu: options.kitsu,
      anilist: options.anilist,
      wayback: options.wayback
    }

    console.error(`Rescuing titles for ${entries.length} entries...`)
    const { results, summary } = await rescueTitles(entries, rescueOptions, true)

    const base = basename(input, '.json').replace(/\.ndjson$/, '')
    await writeFile(
      resolve(outputDir, `${base}-rescue.json`),
      JSON.stringify({ results, summary }, null, 2)
    )
    await writeFile(
      resolve(outputDir, `${base}-rescue.ndjson`),
      results.map((r) => JSON.stringify(r)).join('\n') + '\n'
    )

    console.error('\n--- Rescue Summary ---')
    console.error(`Total:        ${summary.total}`)
    console.error(`Rescued:      ${summary.rescued}`)
    console.error(`Needs review: ${summary.needs_review}`)
    console.error('By source:')
    for (const [source, count] of Object.entries(summary.bySource)) {
      console.error(`  ${source}: ${count}`)
    }
    console.error(`\nOutput written to: ${outputDir}`)
  })


program
  .command('deep-parse')
  .description('Second-pass parse that extracts every possible title signal from HTML files')
  .argument('<files...>', 'HTML files to parse')
  .option('-o, --output <dir>', 'output directory', 'output')
  .action(async (files: string[], options) => {
    const outputDir = resolve(options.output)
    await mkdir(outputDir, { recursive: true })

    const filePaths = files.map((f) => resolve(f))
    console.error(`Deep-parsing ${filePaths.length} file(s)...`)
    const result = await deepParseFiles(filePaths)

    await writeFile(
      resolve(outputDir, 'deep-signals.json'),
      JSON.stringify(result, null, 2)
    )
    await writeFile(
      resolve(outputDir, 'deep-signals.ndjson'),
      result.entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    )

    console.error('\n--- Deep Parse Summary ---')
    console.error(`Files parsed:      ${result.files.length}`)
    console.error(`Total card hits:   ${result.totalCards}`)
    console.error(`Unique slugs:      ${result.uniqueSlugs}`)
    console.error(`Needs review:      ${result.needsReview}`)
    console.error(`\nOutput written to: ${outputDir}`)
  })

program
  .command('wayback-sample')
  .description('Check Wayback Machine snapshots for a sample of numeric slugs')
  .argument('<input>', 'JSON/NDJSON file or comma-separated slug list')
  .option('-o, --output <dir>', 'output directory', 'output')
  .option('-l, --limit <n>', 'number of slugs to sample', '20')
  .option('-t, --timeout <ms>', 'request timeout', '10000')
  .option('--no-titles', 'only check availability, do not parse titles')
  .action(async (input: string, options) => {
    const outputDir = resolve(options.output)
    await mkdir(outputDir, { recursive: true })

    let slugs: string[]
    if (input.includes(',')) {
      slugs = input.split(',').map((s) => s.trim()).filter(Boolean)
    } else {
      const raw = await readFile(resolve(input), 'utf8')
      const entries: Array<{ slug: string }> = raw.trim().startsWith('[')
        ? (JSON.parse(raw) as Array<{ slug: string }>)
        : raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as { slug: string })
      slugs = entries.map((e) => e.slug)
    }

    const numericSlugs = slugs.filter((s) => /^\d+$/.test(s))
    console.error(`Checking Wayback for ${numericSlugs.length} numeric slugs (sample limit: ${options.limit})...`)

    const result = await waybackSample(numericSlugs, {
      limit: parseInt(options.limit, 10),
      timeoutMs: parseInt(options.timeout, 10),
      parseTitles: options.titles !== false
    })

    await writeFile(
      resolve(outputDir, 'wayback-sample.json'),
      JSON.stringify(result, null, 2)
    )

    console.error('\n--- Wayback Sample Summary ---')
    console.error(`Checked:        ${result.checked}`)
    console.error(`With snapshots: ${result.withSnapshots}`)
    console.error(`With titles:    ${result.withTitles}`)
    console.error(`Errors:         ${result.errors}`)
    console.error(`\nOutput written to: ${outputDir}`)
  })

program.parse()
