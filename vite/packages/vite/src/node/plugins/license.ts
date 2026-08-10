import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from '../plugin'
import { isInNodeModules, sortObjectKeys } from '../utils'
import type { PackageCache } from '../packages'
import { findNearestMainPackageData } from '../packages'

/** 描述一个依赖许可证条目的名称、版本、标识和正文。 */
export interface LicenseEntry {
  /** 包名。 */
  name: string
  /** 包版本。 */
  version: string
  /** package.json `license` 字段中的 SPDX 标识。 */
  identifier?: string
  /** 许可证文件全文。 */
  text?: string
}

/** 定义许可证输出文件名，以及将条目渲染为文本的回调。 */
export interface LicenseOptions {
  /**
   * 相对输出目录的许可证文件名；以 `.json` 结尾时输出原始 JSON metadata。
   *
   * @default '.vite/license.md'
   */
  fileName: string
}

/** 保存许可证插件的默认文件名与文本渲染格式。 */
const licenseConfigDefaults = Object.freeze({
  fileName: '.vite/license.md',
} satisfies LicenseOptions)

// https://github.com/npm/npm-packlist/blob/53b2a4f42b7fef0f63e8f26a3ea4692e23a58fed/lib/index.js#L284-L286
const licenseFiles = [/^license/i, /^licence/i, /^copying/i]

/**
 * 扫描所有输出 chunk 的 node_modules 模块，按 `name@version` 去重依赖许可证，
 * 并生成 JSON 元数据或 Markdown 汇总文件。
 */
export function licensePlugin(): Plugin {
  return {
    name: 'vite:license',

    /** 遍历 bundle 模块许可证信息，去重排序后按用户渲染器发射清单文件。 */
    generateBundle(_, bundle) {
      const licenseOption = this.environment.config.build.license
      if (licenseOption === false) return

      const packageCache: PackageCache = new Map()
      // 以 name@version 为 key，避免同一依赖被多个 chunk 重复登记。
      const licenses: Record<string, LicenseEntry> = {}

      for (const file in bundle) {
        const chunk = bundle[file]
        if (chunk.type === 'asset') continue

        for (const moduleId of chunk.moduleIds) {
          if (moduleId.startsWith('\0') || !isInNodeModules(moduleId)) continue

          // 从模块所在目录向上查找所属依赖 package.json。
          const pkgData = findNearestMainPackageData(
            path.dirname(moduleId),
            packageCache,
          )
          if (!pkgData) continue

          // 包名/版本确定去重身份；缺失版本使用稳定占位值。
          const { name, version = '0.0.0', license } = pkgData.data
          const key = `${name}@${version}`
          if (licenses[key]) continue

          // 首次出现时同时读取 SPDX 字段与约定命名的许可证文件。
          const entry: LicenseEntry = { name, version }
          if (license) {
            entry.identifier = license.trim()
          }
          const licenseFile = findLicenseFile(pkgData.dir)
          if (licenseFile) {
            entry.text = fs.readFileSync(licenseFile, 'utf-8').trim()
          }
          licenses[key] = entry
        }
      }

      const licenseEntries = Object.values(sortObjectKeys(licenses))
      const licenseOutputFileName =
        typeof licenseOption === 'object'
          ? licenseOption.fileName
          : licenseConfigDefaults.fileName

      // `.json` 输出便于框架自行展示或进一步加工。
      if (licenseOutputFileName.endsWith('.json')) {
        this.emitFile({
          fileName: licenseOutputFileName,
          type: 'asset',
          source: JSON.stringify(licenseEntries, null, 2),
        })
        return
      }

      // 其他扩展名使用适合直接分发的 Markdown 文本。
      const markdown = licenseEntryToMarkdown(licenseEntries)
      this.emitFile({
        fileName: licenseOutputFileName,
        type: 'asset',
        source: markdown,
      })
    },
  }
}

/** 把排序后的许可证条目生成人类可读 Markdown。 */
function licenseEntryToMarkdown(licenses: LicenseEntry[]) {
  if (licenses.length === 0) {
    return `\
# Licenses

The app does not bundle any dependencies with licenses.
`
  }

  let text = `\
# Licenses

The app bundles dependencies which contain the following licenses:
`
  for (const license of licenses) {
    const nameAndVersionText = `${license.name} - ${license.version}`
    const identifierText = license.identifier ? ` (${license.identifier})` : ''

    text += `\n## ${nameAndVersionText}${identifierText}\n`
    if (license.text) {
      text += `\n${license.text}\n`
    }
  }
  return text
}

/** 按 npm-packlist 兼容命名查找 LICENSE/LICENCE/COPYING 文件。 */
function findLicenseFile(pkgDir: string) {
  const files = fs.readdirSync(pkgDir)
  const matchedFile = files.find((file) =>
    licenseFiles.some((re) => re.test(file)),
  )
  if (matchedFile) {
    return path.join(pkgDir, matchedFile)
  }
}
