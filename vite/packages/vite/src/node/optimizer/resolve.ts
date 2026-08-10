import path from 'node:path'
import picomatch from 'picomatch'
import { globSync } from 'tinyglobby'
import type { ResolvedConfig } from '../config'
import { escapeRegex, getNpmPackageName } from '../utils'
import { resolvePackageData } from '../packages'
import { slash } from '../../shared/utils'
import type { Environment } from '../environment'
import { createBackCompatIdResolver } from '../idResolver'

/**
 * 为 optimizeDeps.include 创建 resolver；支持 `foo > bar > baz` 语法，从指定父依赖自身目录逐层
 * 定位嵌套依赖，而不是从项目 root 得到被 hoist 的另一个版本。
 */
export function createOptimizeDepsIncludeResolver(
  environment: Environment,
): (id: string) => Promise<string | undefined> {
  const topLevelConfig = environment.getTopLevelConfig()
  const resolve = createBackCompatIdResolver(topLevelConfig, {
    asSrc: false,
    scan: true,
    packageCache: new Map(),
  })

  return async (id: string) => {
    const lastArrowIndex = id.lastIndexOf('>')
    if (lastArrowIndex === -1) {
      return await resolve(environment, id, undefined)
    }
    // 从最后一个 `>` 拆：`foo > bar > baz` → 父链 `foo > bar` + 目标 `baz`。
    const nestedRoot = id.substring(0, lastArrowIndex).trim()
    const nestedPath = id.substring(lastArrowIndex + 1).trim()
    const basedir = nestedResolveBasedir(
      nestedRoot,
      topLevelConfig.root,
      topLevelConfig.resolve.preserveSymlinks,
    )
    return await resolve(
      environment,
      nestedPath,
      path.resolve(basedir, 'package.json'),
    )
  }
}

/**
 * 把 optimizeDeps.include 的 package glob 展开为实际 import paths。存在 exports 时只枚举公开子路径；
 * 无 exports 时才直接扫描包目录，并始终把包根入口放在结果首项。
 */
export function expandGlobIds(id: string, config: ResolvedConfig): string[] {
  const pkgName = getNpmPackageName(id)
  if (!pkgName) return []

  const pkgData = resolvePackageData(
    pkgName,
    config.root,
    config.resolve.preserveSymlinks,
    config.packageCache,
  )
  if (!pkgData) return []

  const pattern = '.' + id.slice(pkgName.length)
  const exports = pkgData.data.exports

  // exports 存在时先建立所有公开路径，再用用户 include pattern 过滤，不能绕过封装边界。
  if (exports) {
    if (typeof exports === 'string' || Array.isArray(exports)) {
      return [pkgName]
    }

    const possibleExportPaths: string[] = []
    for (const key in exports) {
      if (key[0] === '.') {
        if (key.includes('*')) {
          // 条件 exports 理论上可映射不同文件集；为避免复制完整条件 resolver，这里取首个字符串并
          // 假设各条件共享相同 wildcard 集合。
          const exportsValue = getFirstExportStringValue(exports[key])
          if (!exportsValue) continue

          // exports value 的每个 `*` 扩成 `**/*` 枚举；连续 glob 仍由 tinyglobby 等价处理。
          const exportValuePattern = exportsValue.replace(/\*/g, '**/*')
          // 同时生成捕获正则，以便把真实文件路径反推回 exports key。
          const exportsValueGlobRe = new RegExp(
            exportsValue.split('*').map(escapeRegex).join('(.*)'),
          )

          possibleExportPaths.push(
            ...globSync(exportValuePattern, {
              cwd: pkgData.dir,
              expandDirectories: false,
              ignore: ['node_modules'],
            })
              .map((filePath) => {
                // tinyglobby/fdir 会去掉开头 `./`，手工恢复以匹配 exports value 正则。
                if (exportsValue.startsWith('./')) {
                  filePath = './' + filePath
                }

                // 用 value 正则捕获真实 wildcard，再替换回 key 的 `*`，得到用户可 import 子路径。
                const matched = exportsValueGlobRe.exec(slash(filePath))
                // 多个 value wildcard 必须捕获同一字符串，因为 exports key 只允许一个 `*`。
                if (matched) {
                  let allGlobSame = matched.length === 2
                  // 两个以上捕获逐项验证相同。
                  if (!allGlobSame) {
                    // 任一组不同便无法反推单一 key wildcard。
                    allGlobSame = true
                    for (let i = 2; i < matched.length; i++) {
                      if (matched[i] !== matched[i - 1]) {
                        allGlobSame = false
                        break
                      }
                    }
                  }
                  if (allGlobSame) {
                    return key.replace('*', matched[1]).slice(2)
                  }
                }
                return ''
              })
              .filter(Boolean),
          )
        } else {
          // null 表示子路径被显式封锁，不能加入 include。
          // https://nodejs.org/api/packages.html#subpath-patterns
          if (exports[key] == null) continue
          possibleExportPaths.push(key.slice(2))
        }
      }
    }

    const isMatch = picomatch(pattern)
    const matched = possibleExportPaths
      .filter((p) => isMatch(p))
      .map((match) => path.posix.join(pkgName, match))
    matched.unshift(pkgName)
    return matched
  } else {
    // 无 exports 封装边界时可直接在包目录 glob。
    const matched = globSync(pattern, {
      cwd: pkgData.dir,
      expandDirectories: false,
      ignore: ['node_modules'],
    }).map((match) => path.posix.join(pkgName, slash(match)))
    matched.unshift(pkgName)
    return matched
  }
}

/** 深度优先取得 exports 条件树中的首个字符串目标，用于推导 glob 子路径模式。 */
function getFirstExportStringValue(
  obj: string | string[] | Record<string, any>,
): string | undefined {
  if (typeof obj === 'string') {
    return obj
  } else if (Array.isArray(obj)) {
    return obj[0]
  } else {
    for (const key in obj) {
      return getFirstExportStringValue(obj[key])
    }
  }
}

/** 沿 `>` 分隔父依赖逐层找 package dir，得到最后目标的真实解析 basedir。 */
function nestedResolveBasedir(
  id: string,
  basedir: string,
  preserveSymlinks = false,
) {
  const pkgs = id.split('>').map((pkg) => pkg.trim())
  for (const pkg of pkgs) {
    basedir = resolvePackageData(pkg, basedir, preserveSymlinks)?.dir || basedir
  }
  return basedir
}
