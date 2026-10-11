import { describe, expect, test } from 'vitest'
import { browserLogs, isBuild, page } from '~utils'

/** 场景：夹具使用外部包与import map；检查browserLogs没有import map晚于module script的警告。 */
test('importmap', () => {
  expect(browserLogs).not.toContain(
    'An import map is added after module script load was triggered.',
  )
})

/** 场景：分别通过import slash5/import slash3/require slash3取得默认导出；读取三个DOM布尔文本均为true。 */
test('should have default exports', async () => {
  expect(await page.textContent('#imported-slash5-exists')).toBe('true')
  expect(await page.textContent('#imported-slash3-exists')).toBe('true')
  expect(await page.textContent('#required-slash3-exists')).toBe('true')
})

describe.runIf(isBuild)('build', () => {
  /** 场景：仅构建执行：Vue经ES import external化，读取版本应为import map提供的3.4.38。 */
  test('should externalize imported packages', async () => {
    // 外部Vue由import map提供版本，不使用本地包的版本。
    expect(await page.textContent('#imported-vue-version')).toBe('3.4.38')
  })

  /** 场景：仅构建执行：Vue经require external化，读取版本同样为import map提供的3.4.38。 */
  test('should externalize required packages', async () => {
    // 外部Vue由import map提供版本，不使用本地包的版本。
    expect(await page.textContent('#required-vue-version')).toBe('3.4.38')
  })
})
