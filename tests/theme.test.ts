import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCssColor } from '../src/shared/color'

describe('parseCssColor', () => {
  it('reads a token value as a Pixi colour number', () => {
    expect(parseCssColor('#2A1D16')).toBe(0x2a1d16)
    expect(parseCssColor(' #e8b84a ')).toBe(0xe8b84a)
  })

  it('fails loudly on a token that is not defined', () => {
    expect(() => parseCssColor('')).toThrow(/missing token/)
    expect(() => parseCssColor('  ')).toThrow(/missing token/)
  })
})

describe('colours in the renderer', () => {
  const root = join(__dirname, '../src/renderer/src')
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
    })

  it('are tokens, never hex literals (themes swap the tokens)', () => {
    const offenders = files(root).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (/#[0-9a-fA-F]{6}\b|0x[0-9a-fA-F]{6}\b/.test(line) ? [`${relative(root, file)}:${i + 1}`] : []))
    )
    expect(offenders).toEqual([])
  })
})
