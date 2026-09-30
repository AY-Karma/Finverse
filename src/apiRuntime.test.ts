import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('loads compiled API entrypoints in Node ESM and handles requests without a bundler', () => {
  const directory = mkdtempSync(join(tmpdir(), 'finverse-api-'))
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
    mkdirSync(join(directory, 'api'))
    mkdirSync(join(directory, 'src'))
    for (const file of ['api/news', 'api/history', 'api/quotes', 'api/requestBudget', 'src/marketDataProtocol']) {
      const compiled = ts.transpileModule(readFileSync(`${file}.ts`, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
      }).outputText
      writeFileSync(join(directory, `${file}.js`), compiled)
    }
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      globalThis.fetch = () => { throw new Error('Invalid requests must not reach providers') }
      for (const name of ['news', 'history', 'quotes']) {
        const { default: entry } = await import('./api/' + name + '.js')
        const response = await entry.fetch(new Request('https://example.com/api/' + name))
        if (response.status !== 400) throw new Error(name + ': HTTP ' + response.status)
        console.log(name + ': 400')
      }
    `], { cwd: directory, encoding: 'utf8', timeout: 10_000 })
    expect(output.trim().split(/\r?\n/)).toEqual(['news: 400', 'history: 400', 'quotes: 400'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
