import path, { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { RollupPluginHooks } from './typeUtils'

/** 从当前包清单读取、供公开 VERSION 常量使用的原始版本字段。 */
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url)).toString(),
)

/**
 * Vite 会主动调度的 Rolldown/Rollup 钩子集合。
 *
 * 这里不是完整的 Rollup 钩子清单：被注释的钩子要么由底层打包器处理，
 * 要么尚未接入 Vite 的插件容器。集中维护该列表，可以让插件容器、构建环境
 * 和类型层对“哪些钩子由 Vite 负责”保持一致。
 */
export const ROLLUP_HOOKS: RollupPluginHooks[] = [
  'options',
  'buildStart',
  'buildEnd',
  'renderStart',
  'renderError',
  'renderChunk',
  'writeBundle',
  'generateBundle',
  'banner',
  'footer',
  'augmentChunkHash',
  'outputOptions',
  // 'renderDynamicImport',
  // 'resolveFileUrl',
  // 'resolveImportMeta',
  'intro',
  'outro',
  'closeBundle',
  'closeWatcher',
  'load',
  'moduleParsed',
  'watchChange',
  'resolveDynamicImport',
  'resolveId',
  // 'shouldTransformCachedModule',
  'transform',
  'onLog',
]

/** 当前安装的 Vite 包版本，读取自同一包内的 package.json。 */
export const VERSION = version as string

/** 客户端依赖解析时依次尝试的 package.json 入口字段。 */
const DEFAULT_MAIN_FIELDS = [
  'browser',
  'module',
  'jsnext:main', // Moment 等旧包仍使用该历史字段。
  'jsnext',
]
/** 客户端解析 package 入口时允许 browser 优先的字段顺序。 */
export const DEFAULT_CLIENT_MAIN_FIELDS: readonly string[] =
  Object.freeze(DEFAULT_MAIN_FIELDS)
/** 服务端解析入口时排除 browser 字段，避免加载浏览器替代实现。 */
export const DEFAULT_SERVER_MAIN_FIELDS: readonly string[] = Object.freeze(
  DEFAULT_MAIN_FIELDS.filter((f) => f !== 'browser'),
)

/**
 * 条件导出中的占位条件。
 *
 * 真正解析包时会依据 `NODE_ENV` 将它替换成 `production` 或
 * `development`，从而让默认条件列表无需在初始化阶段复制两份。
 */
export const DEV_PROD_CONDITION = `development|production` as const

/** 客户端和服务端共享的默认导出条件；随后分别去掉不适用的运行时条件。 */
const DEFAULT_CONDITIONS = ['module', 'browser', 'node', DEV_PROD_CONDITION]
/** 客户端条件导出列表排除 node 条件并保留 browser 语义。 */
export const DEFAULT_CLIENT_CONDITIONS: readonly string[] = Object.freeze(
  DEFAULT_CONDITIONS.filter((c) => c !== 'node'),
)
/** 服务端条件导出列表排除 browser 条件并保留 node 语义。 */
export const DEFAULT_SERVER_CONDITIONS: readonly string[] = Object.freeze(
  DEFAULT_CONDITIONS.filter((c) => c !== 'browser'),
)

/** SSR 外部化依赖交给原生运行时加载时使用的默认导出条件。 */
export const DEFAULT_EXTERNAL_CONDITIONS: readonly string[] = Object.freeze([
  'node',
  'module-sync',
])

/** 省略扩展名解析时按顺序尝试的默认脚本与 JSON 扩展名。 */
export const DEFAULT_EXTENSIONS: string[] = [
  '.mjs',
  '.js',
  '.mts',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
]

/**
 * 2025-05-01 被 Baseline Widely Available 覆盖的浏览器版本。
 *
 * Vite 以此作为默认 esbuild 转译目标，并只在主版本发布时提升，避免次版本升级
 * 意外改变产物兼容范围。该值由 `pnpm generate-target` 生成，不应手工猜测。
 *
 * iOS 与 Safari 目标需要同时列出，因为 esbuild 将它们视为独立平台。参见
 * #21193（引入 Baseline 目标）与 #21342（补齐 iOS 目标）的兼容场景。
 */
export const ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET: string[] = [
  'chrome111',
  'edge111',
  'firefox114',
  'safari16.4',
  'ios16.4',
]

/** 未显式传入 `--config` 时，在项目根目录依次寻找的配置文件名。 */
export const DEFAULT_CONFIG_FILES: string[] = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
]

/** 判断请求是否属于可由 JS/TS 转换流水线处理的常见脚本类型。 */
export const JS_TYPES_RE: RegExp = /\.(?:j|t)sx?$|\.mjs$/

/** 识别 CSS 及 Vite 支持的预处理器请求，并允许后接查询参数。 */
export const CSS_LANGS_RE: RegExp =
  /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/

/** 依赖预构建可直接作为入口处理的纯 JS/TS 文件扩展名。 */
export const OPTIMIZABLE_ENTRY_RE: RegExp = /\.[cm]?[jt]s$/

/** 会改变模块语义、需要走专用插件分支的内置资源查询参数。 */
export const SPECIAL_QUERY_RE: RegExp = /[?&](?:worker|sharedworker|raw|url)\b/

/**
 * 已解析文件系统绝对路径的 URL 前缀。
 *
 * Windows 盘符等文件路径不能直接充当合法 URL，统一编码成 `/@fs/` 请求后，
 * 开发服务器再还原为磁盘路径。
 */
export const FS_PREFIX = `/@fs/`

/** 浏览器请求开发客户端和环境变量运行时代码时使用的保留公共路径。 */
export const CLIENT_PUBLIC_PATH = `/@vite/client`
/** 浏览器请求环境变量运行时代码时使用的保留公共路径。 */
export const ENV_PUBLIC_PATH = `/@vite/env`
/** 当前 Vite 包的根目录，是定位已构建客户端运行时代码的基准。 */
export const VITE_PACKAGE_DIR: string = resolve(
  fileURLToPath(import.meta.url),
  '../../..',
)

/** 已构建开发客户端在当前 Vite 包中的绝对入口路径。 */
export const CLIENT_ENTRY: string = resolve(
  VITE_PACKAGE_DIR,
  'dist/client/client.mjs',
)
/** bundled dev 模式使用的已构建客户端绝对入口路径。 */
export const BUNDLED_DEV_CLIENT_ENTRY: string = resolve(
  VITE_PACKAGE_DIR,
  'dist/client/bundledDevClient.mjs',
)
/** bundled-dev 服务器暴露 Vite 客户端时使用的 URL 文件名。 */
export const BUNDLED_DEV_CLIENT_FILENAME: string = 'bundledDevClient.mjs'
/** 注入 import.meta.env 的已构建运行时绝对入口路径。 */
export const ENV_ENTRY: string = resolve(
  VITE_PACKAGE_DIR,
  'dist/client/env.mjs',
)
/** 已构建客户端入口所在目录，用于识别 Vite 自身的客户端请求。 */
export const CLIENT_DIR: string = path.dirname(CLIENT_ENTRY)

// 修改 `KNOWN_ASSET_TYPES` 前必须同步检查三个位置：
// 1. 在 `packages/vite/client.d.ts` 增加对应的模块声明，让 TS 接受静态导入；
// 2. 若 mrmime 无法识别该扩展名，在 assets 插件的 `registerCustomMime` 中补 MIME；
// 3. 可用 `node --print "require('mrmime').lookup('foo.png')"` 验证 mrmime。
// 只改此数组会造成“运行时能识别、类型或响应 Content-Type 却不认识”的分裂。
/** 默认按静态资源处理的扩展名片段；其中可包含正则语法，如 `jpe?g`。 */
export const KNOWN_ASSET_TYPES: string[] = [
  // 图片
  'apng',
  'bmp',
  'png',
  'jpe?g',
  'jfif',
  'pjpeg',
  'pjp',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',
  'cur',
  'jxl',

  // 音视频与字幕
  'mp4',
  'webm',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',
  'opus',
  'mov',
  'm4a',
  'vtt',

  // 字体
  'woff2?',
  'eot',
  'ttf',
  'otf',

  // 其他可直接作为资源引用的文件
  'webmanifest',
  'pdf',
  'txt',
]

/** 由已知资源类型生成的默认匹配器，同时容纳 URL 查询参数。 */
export const DEFAULT_ASSETS_RE: RegExp = new RegExp(
  `\\.(` + KNOWN_ASSET_TYPES.join('|') + `)(\\?.*)?$`,
  'i',
)

/** 从依赖请求 URL 中提取预构建版本标记，用于缓存失效判断。 */
export const DEP_VERSION_RE: RegExp = /[?&](v=[\w.-]+)\b/

/** 无需暴露到局域网即可访问的标准回环主机写法。 */
export const loopbackHosts: Set<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0000:0000:0000:0000:0000:0000:0000:0001',
])
/** 表示监听所有网络接口的通配主机写法。 */
export const wildcardHosts: Set<string> = new Set([
  '0.0.0.0',
  '::',
  '0000:0000:0000:0000:0000:0000:0000:0000',
])

/** 开发服务器与预览服务器的默认端口。 */
export const DEFAULT_DEV_PORT = 5173

/** 生产构建预览服务器未配置端口时使用 4173。 */
export const DEFAULT_PREVIEW_PORT = 4173

/** 构建时将资源内联为 data URL 的默认上限，单位为字节。 */
export const DEFAULT_ASSETS_INLINE_LIMIT = 4096

// 默认 CORS 只放行回环来源：RFC 6761 规定必然解析到回环地址的 localhost
// 子域、IPv4 127.0.0.1 与 IPv6 ::1；协议和端口可变，但不会泛化到任意主机。
// 这是 #19249 收紧默认来源时要守住的安全边界。
export const defaultAllowedOrigins: RegExp =
  /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/

/** 依赖预构建目录中记录哈希、入口和 chunk 信息的元数据文件名。 */
export const METADATA_FILENAME = '_metadata.json'

/** 依赖优化器向上层区分“处理失败”和“缓存文件缺失”的稳定错误码。 */
export const ERR_OPTIMIZE_DEPS_PROCESSING_ERROR =
  'ERR_OPTIMIZE_DEPS_PROCESSING_ERROR'
/** 已发布优化依赖目录找不到目标文件时使用的稳定错误码。 */
export const ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR =
  'ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR'
