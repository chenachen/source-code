import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { cspHashes } from '..'

/** 从 README 按出现顺序抽取反引号内的 sha256 值，与插件导出的 cspHashes 严格比对，防止文档哈希与实际内联片段脱节。 */
test('CSP hashes in README.md should be correct', () => {
  const readme = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../README.md'),
    'utf-8',
  )
  const hashesInDoc = [...readme.matchAll(/`sha256-(.+)`/g)].map(
    (match) => match[1],
  )

  expect(hashesInDoc).toStrictEqual(cspHashes)
})
