/**
 * 将指定正式版本及其随后 alpha/beta/rc 段落按分类合并写回 CHANGELOG.md。
 * 正文重复行保留；另附各预发布 tag 的 changelog 链接，更新与上一正式版本的 compare 链接。
 * 运行：pnpm merge-changelog <package> <version>，例如 pnpm merge-changelog vite 8.0.0。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 命令行指定的 packages 子目录名，决定 changelog 路径和非 Vite 包的标签前缀。 */
const pkg = process.argv[2]
/** 要合并其 alpha/beta/rc 段落的正式版本号。 */
const version = process.argv[3]

if (!pkg || !version) {
  console.error('Usage: pnpm merge-changelog <package> <version>')
  process.exit(1)
}

/** 合并输出的固定分类顺序；输入出现其他 ### 分类时明确失败。 */
const CATEGORY_ORDER = [
  '### ⚠ BREAKING CHANGES',
  '### Features',
  '### Bug Fixes',
  '### Performance Improvements',
  '### Documentation',
  '### Miscellaneous Chores',
  '### Code Refactoring',
  '### Tests',
]

/** 转义版本字符串中的正则元字符，使 release header 匹配使用字面量版本。 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 识别正式或 small 包装的二级版本标题，用于重置分类和确定合并边界。 */
const versionHeaderRe = /^## (?:<small>)?\[/

/** 查找目标正式版本标题；不存在时打印错误并以状态 1 退出。 */
function findReleaseHeaderIndex(lines: string[], version: string): number {
  const re = new RegExp(`^## (?:<small>)?\\[${escapeRegex(version)}\\]`)
  const idx = lines.findIndex((l) => re.test(l))
  if (idx === -1) {
    console.error(`Could not find header for version ${version}`)
    process.exit(1)
  }
  return idx
}

/** 从正式标题向后扫描，跨过该版本的 alpha/beta/rc 数字序号标题，遇到其他版本标题结束。 */
function findEndBoundary(
  lines: string[],
  startIdx: number,
  version: string,
): number {
  const prereleaseRe = new RegExp(
    `^## (?:<small>)?\\[${escapeRegex(version)}-(beta|alpha|rc)\\.\\d+\\]`,
  )
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (versionHeaderRe.test(lines[i]) && !prereleaseRe.test(lines[i])) {
      return i
    }
  }
  return lines.length
}

/** 按 ### 分类收集非空正文行，遇到版本标题重置当前分类；同名分类合并行，保留重复内容。 */
function parseCategories(releaseLines: string[]): Map<string, string[]> {
  const categories = new Map<string, string[]>()
  let currentCategory: string | null = null

  for (let i = 1; i < releaseLines.length; i++) {
    const line = releaseLines[i]
    if (versionHeaderRe.test(line)) {
      currentCategory = null
      continue
    }
    if (line.startsWith('### ')) {
      currentCategory = line.trim()
      if (!categories.has(currentCategory)) {
        categories.set(currentCategory, [])
      }
      continue
    }

    if (currentCategory && line.trim() !== '') {
      categories.get(currentCategory)!.push(line)
    }
  }

  return categories
}

/** 从边界向后取首个不含 alpha/beta/rc 的版本标题；没有匹配时返回空字符串。 */
function findPreviousStableVersion(lines: string[], startIdx: number): string {
  for (let i = startIdx; i < lines.length; i++) {
    const match = lines[i].match(/^## (?:<small>)?\[([^\]]+)\]/)
    if (match) {
      const v = match[1]
      if (!/alpha|beta|rc/.test(v)) {
        return v
      }
    }
  }
  return ''
}

/** 有上一正式版本时替换标题 compare 链接，按 vite 或其他包生成标签前缀；否则保留标题。 */
function updateHeaderCompareLink(
  headerLine: string,
  prevStable: string,
  pkg: string,
  version: string,
): string {
  if (!prevStable) return headerLine
  const tagPrefix = pkg === 'vite' ? 'v' : `${pkg}@`
  return headerLine.replace(
    /compare\/[^)]+/,
    `compare/${tagPrefix}${prevStable}...${tagPrefix}${version}`,
  )
}

/** 从合并范围提取带 compare URL 的预发布标题和可选日期，生成指向对应 tag changelog 的链接。 */
function collectPrereleaseHeaders(
  releaseLines: string[],
  pkg: string,
): string[] {
  const lines: string[] = []
  for (const line of releaseLines) {
    const match = line.match(
      /^## (?:<small>)?\[([^\]]+)\]\(([^)]+)\)(?: \((\d{4}-\d{2}-\d{2})\))?/,
    )
    if (!match) continue
    const [, ver, compareUrl, date] = match
    if (!/alpha|beta|rc/.test(ver)) continue

    const tagPrefix = pkg === 'vite' ? 'v' : `${pkg}@`
    const tag = `${tagPrefix}${ver}`
    const header = date
      ? `#### [${ver}](${compareUrl}) (${date})`
      : `#### [${ver}](${compareUrl})`
    lines.push(
      header,
      '',
      `See [${ver} changelog](https://github.com/vitejs/vite/blob/${tag}/packages/${pkg}/CHANGELOG.md)`,
      '',
    )
  }
  return lines
}

/** 按固定分类顺序输出合并正文，附加预发布链接；未知分类抛错，不对正文行去重。 */
function buildOutputLines(
  headerLine: string,
  categories: Map<string, string[]>,
  prereleaseLines: string[],
): string[] {
  const hasUnknownCategories = [...categories.keys()].filter(
    (c) => !CATEGORY_ORDER.includes(c),
  )
  if (hasUnknownCategories.length > 0) {
    throw new Error(
      `Unknown categories found: ${hasUnknownCategories.join(', ')}`,
    )
  }

  const outputLines: string[] = [headerLine, '']
  for (const category of CATEGORY_ORDER) {
    const items = categories.get(category)
    if (items && items.length > 0) {
      outputLines.push(category, '')
      outputLines.push(...items)
      outputLines.push('')
    }
  }

  if (prereleaseLines.length > 0) {
    outputLines.push('### Beta Changelogs', '', ...prereleaseLines)
  }

  return outputLines
}

/** 目标包 CHANGELOG.md 的绝对路径，以本脚本目录定位。 */
const filePath = path.resolve(
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  import.meta.dirname,
  `../packages/${pkg}/CHANGELOG.md`,
)
/** 读取的完整 changelog 原文，用于保留合并范围外的内容。 */
const content = await readFile(filePath, 'utf-8')
/** 按换行拆分的 changelog，标题定位和分类收集共用同一数组。 */
const lines = content.split('\n')

/** 目标正式版本标题在原始行数组中的索引。 */
const releaseHeaderIdx = findReleaseHeaderIndex(lines, version)
/** 合并范围的排他结束索引，指向下一非目标预发布版本标题。 */
const endIdx = findEndBoundary(lines, releaseHeaderIdx, version)
/** 目标正式版本及随后同版本预发布的完整行区间。 */
const releaseLines = lines.slice(releaseHeaderIdx, endIdx)

/** 合并范围内按三级分类归组的非空正文行，重复行保留。 */
const categories = parseCategories(releaseLines)
/** 合并范围中预发布版本的标题与 tagged changelog 链接。 */
const prereleaseLines = collectPrereleaseHeaders(releaseLines, pkg)
/** 合并区间之后首个正式版本号，供 compare 起点使用。 */
const prevStable = findPreviousStableVersion(lines, endIdx)
/** 已按前一正式版本更新 compare 链接的目标标题。 */
const headerLine = updateHeaderCompareLink(
  releaseLines[0],
  prevStable,
  pkg,
  version,
)
/** 按固定分类顺序重建的正式版本段及 Beta Changelogs 链接段。 */
const outputLines = buildOutputLines(headerLine, categories, prereleaseLines)

/** 原文前缀、重建段与原文后缀连接后的最终 changelog；下方写回同一文件。 */
const result = [
  ...lines.slice(0, releaseHeaderIdx),
  ...outputLines,
  ...lines.slice(endIdx),
].join('\n')

await writeFile(filePath, result, 'utf-8')
console.log(`Merged prerelease changelog sections for ${version} in ${pkg}`)
