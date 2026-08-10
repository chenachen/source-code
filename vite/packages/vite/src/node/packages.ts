import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  createFilter,
  isInNodeModules,
  normalizePath,
  safeRealpathSync,
  stripBomTag,
  tryStatSync,
} from './utils'
import type { Plugin } from './plugin'
import type { InternalResolveOptions } from './plugins/resolve'

let pnp: typeof import('pnpapi') | undefined
if (process.versions.pnp) {
  try {
    pnp = createRequire(/** #__KEEP__ */ import.meta.url)('pnpapi')
  } catch {}
}

/** package.json 定位、内容与入口解析结果的共享缓存。 */
export type PackageCache = Map<string, PackageData>

/** 一个已读取 package.json 的规范化运行数据。 */
export interface PackageData {
  /** package.json 所在的规范化绝对目录。 */
  dir: string
  /** 按 package.json sideEffects 字段判断模块副作用。 */
  hasSideEffects: (id: string) => boolean | 'no-treeshake' | null
  /** 按影响解析的 options 缓存包入口/deep import 结果。 */
  setResolvedCache: (
    key: string,
    entry: string,
    options: InternalResolveOptions,
  ) => void
  /** 读取同一 options 组合下的包入口/deep import 缓存。 */
  getResolvedCache: (
    key: string,
    options: InternalResolveOptions,
  ) => string | undefined
  /** package.json 原始字段；插件生态允许额外自定义字段。 */
  data: {
    [field: string]: any
    /** 包名，用于诊断和 self-reference 解析。 */
    name: string
    /** Node package 边界的 module/commonjs 身份。 */
    type: string
    /** 包管理器声明的版本字符串。 */
    version: string
    /** CommonJS 传统主入口。 */
    main: string
    /** 生态约定的 ESM 主入口。 */
    module: string
    /** 浏览器入口或逐文件替换表。 */
    browser: string | Record<string, string | false>
    /** Node 条件导出定义。 */
    exports: string | Record<string, any> | string[]
    /** 包内 `#` 私有导入映射。 */
    imports: Record<string, any>
    /** 直接依赖版本范围，用于可选 peer 等解析判断。 */
    dependencies: Record<string, string>
  }
}

/** package.json 变化时删除指向同一包目录的所有 basedir/preserveSymlinks 缓存键。 */
function invalidatePackageData(
  packageCache: PackageCache,
  pkgPath: string,
): void {
  const pkgDir = normalizePath(path.dirname(pkgPath))
  packageCache.forEach((pkg, cacheKey) => {
    if (pkg.dir === pkgDir) {
      packageCache.delete(cacheKey)
    }
  })
}

/**
 * 从 basedir 向上寻找 `node_modules/pkgName/package.json`，或通过 Yarn PnP 定位包。
 * preserveSymlinks 决定缓存/包目录使用链接路径还是真实路径；命中结果会回填遍历过的目录。
 */
export function resolvePackageData(
  pkgName: string,
  basedir: string,
  preserveSymlinks = false,
  packageCache?: PackageCache,
): PackageData | null {
  if (pnp) {
    const cacheKey = getRpdCacheKey(pkgName, basedir, preserveSymlinks)
    if (packageCache?.has(cacheKey)) return packageCache.get(cacheKey)!

    try {
      const pkg = pnp.resolveToUnqualified(pkgName, basedir, {
        considerBuiltins: false,
      })
      if (!pkg) return null

      const pkgData = loadPackageData(path.join(pkg, 'package.json'))
      packageCache?.set(cacheKey, pkgData)
      return pkgData
    } catch {
      return null
    }
  }

  const originalBasedir = basedir
  while (basedir) {
    if (packageCache) {
      const cached = getRpdCache(
        packageCache,
        pkgName,
        basedir,
        originalBasedir,
        preserveSymlinks,
      )
      if (cached) return cached
    }

    const pkg = path.join(basedir, 'node_modules', pkgName, 'package.json')
    try {
      if (fs.existsSync(pkg)) {
        const pkgPath = preserveSymlinks ? pkg : safeRealpathSync(pkg)
        const pkgData = loadPackageData(pkgPath)

        if (packageCache) {
          setRpdCache(
            packageCache,
            pkgData,
            pkgName,
            basedir,
            originalBasedir,
            preserveSymlinks,
          )
        }

        return pkgData
      }
    } catch {}

    const nextBasedir = path.dirname(basedir)
    if (nextBasedir === basedir) break
    basedir = nextBasedir
  }

  return null
}

/** 从 basedir 向文件系统根寻找最近的 package.json，并缓存沿途目录。 */
export function findNearestPackageData(
  basedir: string,
  packageCache?: PackageCache,
): PackageData | null {
  const originalBasedir = basedir
  while (basedir) {
    if (packageCache) {
      const cached = getFnpdCache(packageCache, basedir, originalBasedir)
      if (cached) return cached
    }

    const pkgPath = path.join(basedir, 'package.json')
    if (tryStatSync(pkgPath)?.isFile()) {
      try {
        const pkgData = loadPackageData(pkgPath)

        if (packageCache) {
          setFnpdCache(packageCache, pkgData, basedir, originalBasedir)
        }

        return pkgData
      } catch {}
    }

    const nextBasedir = path.dirname(basedir)
    if (nextBasedir === basedir) break
    basedir = nextBasedir
  }

  return null
}

/** 向上寻找最近一个包含 name 字段的主 package.json，跳过无名嵌套配置。 */
export function findNearestMainPackageData(
  basedir: string,
  packageCache?: PackageCache,
): PackageData | null {
  const nearestPackage = findNearestPackageData(basedir, packageCache)
  return (
    nearestPackage &&
    (nearestPackage.data.name
      ? nearestPackage
      : findNearestMainPackageData(
          path.dirname(nearestPackage.dir),
          packageCache,
        ))
  )
}

/**
 * 读取/去 BOM/解析 package.json，并编译 sideEffects 匹配器和选项敏感的入口缓存。
 */
export function loadPackageData(pkgPath: string): PackageData {
  const data = JSON.parse(stripBomTag(fs.readFileSync(pkgPath, 'utf-8')))
  const pkgDir = normalizePath(path.dirname(pkgPath))
  const { sideEffects } = data
  let hasSideEffects: (id: string) => boolean | null
  if (typeof sideEffects === 'boolean') {
    hasSideEffects = () => sideEffects
  } else if (Array.isArray(sideEffects)) {
    if (sideEffects.length <= 0) {
      // createFilter 的空 include 默认全匹配；package sideEffects:[] 的语义却是全部无副作用
      // （#16152）。
      hasSideEffects = () => false
    } else {
      const finalPackageSideEffects = sideEffects.map((sideEffect) => {
        // sideEffects 数组遵循 webpack 约定：不含 `/` 的 `*.css` 等模式等价 `**/*.css`。
        // 参考 https://webpack.js.org/guides/tree-shaking/ 与 https://github.com/vitejs/vite/pull/11807。
        if (sideEffect.includes('/')) {
          return sideEffect
        }
        return `**/${sideEffect}`
      })

      hasSideEffects = createFilter(finalPackageSideEffects, null, {
        resolve: pkgDir,
      })
    }
  } else {
    hasSideEffects = () => null
  }

  const resolvedCache: Record<string, string | undefined> = {}
  const pkg: PackageData = {
    dir: pkgDir,
    data,
    hasSideEffects,
    /** 按解析选项组合保存入口或 deep import 结果。 */
    setResolvedCache(key, entry, options) {
      resolvedCache[getResolveCacheKey(key, options)] = entry
    },
    /** 读取同一解析选项组合下的缓存结果。 */
    getResolvedCache(key, options) {
      return resolvedCache[getResolveCacheKey(key, options)]
    },
  }

  return pkg
}

/** 组合所有会改变 exports/main/扩展名入口选择的解析选项，防止跨 Environment 误复用。 */
function getResolveCacheKey(key: string, options: InternalResolveOptions) {
  return [
    key,
    options.isRequire ? '1' : '0',
    options.conditions.join('_'),
    options.extensions.join('_'),
    options.mainFields.join('_'),
  ].join('|')
}

/** 从 basedir 向上寻找最近的 node_modules 目录。 */
export function findNearestNodeModules(basedir: string): string | null {
  while (basedir) {
    const pkgPath = path.join(basedir, 'node_modules')
    if (tryStatSync(pkgPath)?.isDirectory()) {
      return pkgPath
    }

    const nextBasedir = path.dirname(basedir)
    if (nextBasedir === basedir) break
    basedir = nextBasedir
  }

  return null
}

/**
 * 监听 workspace/link 包的 package.json；变化时失效 PackageCache。
 * node_modules 包由包管理器维护且数量巨大，不逐个 watch。
 */
export function watchPackageDataPlugin(packageCache: PackageCache): Plugin {
  // buildStart 前插件上下文不可用，先缓存待监听文件。
  const watchQueue = new Set<string>()
  const watchedDirs = new Set<string>()

  /** 插件未启动/已结束时，把新增 package.json 暂存到队列。 */
  const watchFileStub = (id: string) => {
    watchQueue.add(id)
  }
  let watchFile = watchFileStub

  const setPackageData = packageCache.set.bind(packageCache)
  packageCache.set = (id, pkg) => {
    if (!isInNodeModules(pkg.dir) && !watchedDirs.has(pkg.dir)) {
      watchedDirs.add(pkg.dir)
      watchFile(path.join(pkg.dir, 'package.json'))
    }
    return setPackageData(id, pkg)
  }

  return {
    name: 'vite:watch-package-data',
    /** 激活真实 addWatchFile，并补登记配置阶段排队的 package.json。 */
    buildStart() {
      watchFile = this.addWatchFile.bind(this)
      watchQueue.forEach(watchFile)
      watchQueue.clear()
    },
    /** 生命周期结束后恢复排队 stub，避免使用已关闭的插件上下文。 */
    buildEnd() {
      watchFile = watchFileStub
    },
    /** package.json 变化时失效指向该包目录的解析缓存。 */
    watchChange(id) {
      if (id.endsWith('/package.json')) {
        invalidatePackageData(packageCache, path.normalize(id))
      }
    },
  }
}

/**
 * 查找 `resolvePackageData` 的祖先 basedir 缓存；命中后把同一结果回填到原始目录与命中目录
 * 之间，使共享祖先的后续解析只读取一次文件系统。
 */
function getRpdCache(
  packageCache: PackageCache,
  pkgName: string,
  basedir: string,
  originalBasedir: string,
  preserveSymlinks: boolean,
) {
  const cacheKey = getRpdCacheKey(pkgName, basedir, preserveSymlinks)
  const pkgData = packageCache.get(cacheKey)
  if (pkgData) {
    traverseBetweenDirs(originalBasedir, basedir, (dir) => {
      packageCache.set(getRpdCacheKey(pkgName, dir, preserveSymlinks), pkgData)
    })
    return pkgData
  }
}

/** 为当前 basedir 及已遍历的所有子目录写入相同包解析结果。 */
function setRpdCache(
  packageCache: PackageCache,
  pkgData: PackageData,
  pkgName: string,
  basedir: string,
  originalBasedir: string,
  preserveSymlinks: boolean,
) {
  packageCache.set(getRpdCacheKey(pkgName, basedir, preserveSymlinks), pkgData)
  traverseBetweenDirs(originalBasedir, basedir, (dir) => {
    packageCache.set(getRpdCacheKey(pkgName, dir, preserveSymlinks), pkgData)
  })
}

/** `resolvePackageData` 缓存键；软链接策略也会改变结果。 */
function getRpdCacheKey(
  pkgName: string,
  basedir: string,
  preserveSymlinks: boolean,
) {
  return `rpd_${pkgName}_${basedir}_${preserveSymlinks}`
}

/**
 * 查找 `findNearestPackageData` 的祖先 basedir 缓存，并把命中结果回填到已遍历目录。
 */
function getFnpdCache(
  packageCache: PackageCache,
  basedir: string,
  originalBasedir: string,
) {
  const cacheKey = getFnpdCacheKey(basedir)
  const pkgData = packageCache.get(cacheKey)
  if (pkgData) {
    traverseBetweenDirs(originalBasedir, basedir, (dir) => {
      packageCache.set(getFnpdCacheKey(dir), pkgData)
    })
    return pkgData
  }
}

/** 为当前 basedir 及已遍历的所有子目录写入最近 package.json 结果。 */
function setFnpdCache(
  packageCache: PackageCache,
  pkgData: PackageData,
  basedir: string,
  originalBasedir: string,
) {
  packageCache.set(getFnpdCacheKey(basedir), pkgData)
  traverseBetweenDirs(originalBasedir, basedir, (dir) => {
    packageCache.set(getFnpdCacheKey(dir), pkgData)
  })
}

/** `findNearestPackageData` 的缓存键。 */
function getFnpdCacheKey(basedir: string) {
  return `fnpd_${basedir}`
}

/**
 * 从更深目录向上遍历到较浅目录，对起点（含）到终点（不含）的每层调用 cb。
 * @param longerDir 更深路径，例如 `/User/foo/bar/baz`。
 * @param shorterDir 更浅祖先，例如 `/User/foo`。
 */
function traverseBetweenDirs(
  longerDir: string,
  shorterDir: string,
  cb: (dir: string) => void,
) {
  while (longerDir !== shorterDir) {
    cb(longerDir)
    longerDir = path.dirname(longerDir)
  }
}
