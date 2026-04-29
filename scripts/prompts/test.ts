#!/usr/bin/env tsx
/**
 * Local test harness for prompt templates in scripts/prompts/.
 *
 * Renders each fixture's vars into the prompt template, runs the result
 * through the local `claude` CLI in headless mode (same execution path
 * as `anthropics/claude-code-action` uses in CI), and validates the
 * resulting JSON against the prompt's expected-shape schema.
 *
 * Usage:
 *   tsx scripts/prompts/test.ts                       # all prompts, all fixtures
 *   tsx scripts/prompts/test.ts proposal-block        # one prompt, all its fixtures
 *   tsx scripts/prompts/test.ts proposal-block linge  # match fixture by substring
 *
 * Auth:
 *   Uses your local `claude` CLI's auth — log in once with `claude` or
 *   set CLAUDE_CODE_OAUTH_TOKEN. Same token used in CI.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const PROMPTS_DIR = resolve(import.meta.dirname, '.')
const FIXTURES_DIR = join(PROMPTS_DIR, 'fixtures')

interface Fixture {
  vars: Record<string, unknown>
  outputFile: string
}

interface FixtureCase {
  prompt: string
  name: string
  fixturePath: string
  schemaPath: string
  templatePath: string
  fixture: Fixture
}

function discoverPrompts(): string[] {
  return readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
}

function discoverFixtures(prompt: string, filter?: string): FixtureCase[] {
  const dir = join(FIXTURES_DIR, prompt)
  if (!existsSync(dir)) return []
  const schemaPath = join(dir, 'expected-shape.json')
  const templatePath = join(PROMPTS_DIR, `${prompt}.txt`)
  return readdirSync(dir)
    .filter((f) => f.startsWith('input-') && f.endsWith('.json'))
    .filter((f) => !filter || f.includes(filter))
    .map((f) => {
      const fixturePath = join(dir, f)
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture
      return {
        prompt,
        name: basename(f, '.json').replace(/^input-/, ''),
        fixturePath,
        schemaPath,
        templatePath,
        fixture,
      }
    })
}

/** Render `${VAR}` placeholders. JSON-typed values get JSON-stringified. */
function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, key) => {
    if (!(key in vars)) {
      throw new Error(`Template references undefined variable: ${key}`)
    }
    const value = vars[key]
    if (typeof value === 'string') return value
    return JSON.stringify(value, null, 2)
  })
}

function runClaude(prompt: string): void {
  // Mirrors the `claude_args: --allowedTools Read,Write` invocation used by
  // anthropics/claude-code-action in CI. The prompt itself instructs the
  // model where to write its JSON output (via OUTPUT_PATH).
  const result = spawnSync(
    'claude',
    ['-p', prompt, '--allowedTools', 'Read,Write', '--output-format', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  if (result.status !== 0) {
    throw new Error(`claude exited with status ${result.status}\nstdout: ${result.stdout}`)
  }
}

function validateOutput(outputPath: string, schemaPath: string): { ok: boolean; errors?: unknown } {
  if (!existsSync(outputPath)) {
    return { ok: false, errors: [`Claude did not write output to ${outputPath}`] }
  }
  const output = JSON.parse(readFileSync(outputPath, 'utf8'))
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))

  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  const ok = validate(output)
  return ok ? { ok: true } : { ok: false, errors: validate.errors }
}

function runCase(c: FixtureCase): { pass: boolean; detail: string } {
  const template = readFileSync(c.templatePath, 'utf8')
  const promptHash = createHash('sha256').update(template).digest('hex').slice(0, 12)

  const tmp = mkdtempSync(join(tmpdir(), 'prompt-test-'))
  const outputPath = join(tmp, c.fixture.outputFile)

  const vars = {
    ...c.fixture.vars,
    OUTPUT_PATH: outputPath,
    PROMPT_HASH: promptHash,
  }
  const rendered = renderTemplate(template, vars)

  // Stash the rendered prompt so failures can be re-run without re-execing claude.
  writeFileSync(join(tmp, 'rendered-prompt.txt'), rendered)

  try {
    runClaude(rendered)
  } catch (err) {
    return { pass: false, detail: `claude failed: ${(err as Error).message}\nrendered prompt at: ${tmp}/rendered-prompt.txt` }
  }

  const validation = validateOutput(outputPath, c.schemaPath)
  if (!validation.ok) {
    return {
      pass: false,
      detail:
        `output failed schema validation:\n` +
        JSON.stringify(validation.errors, null, 2) +
        `\nraw output: ${outputPath}` +
        `\nrendered prompt: ${tmp}/rendered-prompt.txt`,
    }
  }

  return { pass: true, detail: `output: ${outputPath}` }
}

function main(): void {
  const [promptArg, fixtureFilter] = process.argv.slice(2)

  const prompts = promptArg ? [promptArg] : discoverPrompts()
  const cases: FixtureCase[] = prompts.flatMap((p) => discoverFixtures(p, fixtureFilter))

  if (cases.length === 0) {
    console.error('No fixtures matched.')
    process.exit(2)
  }

  // Sanity-check: claude CLI installed?
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' })
  } catch {
    console.error('`claude` CLI not found in PATH. Install Claude Code or run via the GitHub Action.')
    process.exit(2)
  }

  let failed = 0
  for (const c of cases) {
    const label = `${c.prompt}/${c.name}`
    process.stdout.write(`▶ ${label} ... `)
    const { pass, detail } = runCase(c)
    if (pass) {
      console.log(`✓ pass — ${detail}`)
    } else {
      failed++
      console.log(`✗ FAIL\n${detail}\n`)
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
