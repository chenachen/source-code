import { getCompatibleVersions } from 'baseline-browser-mapping'

/** 本次大版本使用的 Baseline Widely Available 截点，传给浏览器版本映射器。 */
const targetDate = '2026-01-01'

/** 把 Baseline 的浏览器名称转成构建 target 使用的名称，其中 safari_ios 对应 ios。 */
// https://esbuild.github.io/api/#target
const baselineToEsbuildTargetMap: Record<string, string> = {
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  safari: 'safari',
  safari_ios: 'ios',
}

/** 映射后允许写入目标数组的浏览器集合，其余 Baseline 浏览器在下方过滤。 */
const esbuildSupportedBrowsers = new Set([
  'chrome',
  'edge',
  'firefox',
  'safari',
  'ios',
])

/** 在指定日期已广泛可用的各浏览器最低版本，作为生成 target 的原始输入。 */
const results = getCompatibleVersions({
  widelyAvailableOnDate: targetDate,
})

/** 按映射器顺序生成 chrome/edge/firefox/safari/ios 加版本号的构建 target 字符串。 */
const esbuildTargets = results
  .map((target) => {
    return {
      browser: baselineToEsbuildTargetMap[target.browser],
      version: target.version,
    }
  })
  .filter((target) => esbuildSupportedBrowsers.has(target.browser))
  .map((target) => `${target.browser}${target.version}`)

console.log('ESBuild Targets:', esbuildTargets)
