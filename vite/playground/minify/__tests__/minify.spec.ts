import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { isBuild, readFile, testDir } from '~utils'

/** 场景：仅构建执行：配置关闭语法压缩后读取首个JS/CSS产物；核对JS保留console.log表达式、CSS保留#ff0000，两者均去除显式版权注释。 */
test.runIf(isBuild)('no minifySyntax', () => {
  const assetsDir = path.resolve(testDir, 'dist/assets')
  const files = fs.readdirSync(assetsDir)

  const jsFile = files.find((f) => f.endsWith('.js'))
  const jsContent = readFile(path.resolve(assetsDir, jsFile))

  const cssFile = files.find((f) => f.endsWith('.css'))
  const cssContent = readFile(path.resolve(assetsDir, cssFile))

  expect(jsContent).toContain('console.log("hello world")')
  expect(jsContent).not.toContain('/*! explicit comment */')

  expect(cssContent).toContain('color:#ff0000')
  expect(cssContent).not.toContain('/*! explicit comment */')
})
