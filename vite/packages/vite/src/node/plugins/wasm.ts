import fsp from 'node:fs/promises'
import MagicString from 'magic-string'
import { exactRegex } from 'rolldown/filter'
import type { RolldownMagicString } from 'rolldown'
import { createToImportMetaURLBasedRelativeRuntime } from '../build'
import { type Plugin, perEnvironmentPlugin } from '../plugin'
import { cleanUrl } from '../../shared/utils'
import { assetUrlRE, fileToUrl } from './asset'

/** WebAssembly 初始化运行时辅助模块的内部虚拟 ID。 */
const wasmHelperId = '\0vite/wasm-helper.js'

/** 识别显式要求返回 WebAssembly 初始化函数的请求。 */
const wasmInitRE = /(?<![?#].*)\.wasm\?init/
/** 识别未带查询参数的直接 `.wasm` 导入。 */
const wasmDirectRE = /(?<![?#].*)\.wasm$/

// 直接导入且包含 Global 导出的 `.wasm` 会生成底层 instance 模块。它持有
// WebAssembly.Instance，并原样暴露导出，使 wasm-to-wasm 的全局变量导入拿到
// 真正的 WebAssembly.Global 活单元格；面向 JS 的外层模块再把 Global 解包成值。
const wasmInstanceSuffix = '?vite-wasm-instance'
/** 识别 Vite 内部的 WebAssembly 实例包装请求。 */
const wasmInstanceRE = /[?&]vite-wasm-instance(?:&|$)/

/** 匹配构建期写入的 WebAssembly 初始化函数占位符。 */
const wasmInitUrlRE: RegExp = /__VITE_WASM_INIT__([\w$]+)__/g

// 按 WebAssembly JS String Builtins / Imported String Constants 提案启用编译选项。
const wasmCompileOptions = {
  builtins: ['js-string'],
  importedStringConstants: 'wasm:js/string-constants',
}

// 启用上述提案后，这些模块由引擎直接提供，不应变成胶水代码里的 JS import。
// 执行 `parseWasm` 的旧版 Node 可能尚不支持提案，Module.imports 仍会返回它们，
// 因此这里必须显式过滤，保证不同 Node 版本生成相同胶水代码。
const wasmReservedModules = new Set<string>([
  ...wasmCompileOptions.builtins.map((name) => `wasm:${name}`),
  wasmCompileOptions.importedStringConstants,
])

/**
 * 运行时 Wasm 初始化器：同时支持内联 data URL 与网络/文件 URL。
 *
 * 该函数会通过 `toString()` 嵌入虚拟 helper 模块，所以只能依赖参数、全局对象和
 * 同样被注入的辅助函数，不能捕获当前 Node 模块中的局部状态。
 */
const wasmHelper = async (opts = {}, url: string) => {
  let result
  if (url.startsWith('data:')) {
    const urlContent = url.replace(/^data:.*?base64,/, '')
    let bytes
    if (typeof Buffer === 'function' && typeof Buffer.from === 'function') {
      bytes = Buffer.from(urlContent, 'base64')
    } else if (typeof atob === 'function') {
      const binaryString = atob(urlContent)
      bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
    } else {
      throw new Error(
        'Failed to decode base64-encoded data URL, Buffer and atob are not supported',
      )
    }
    result = await WebAssembly.instantiate(bytes, opts, wasmCompileOptions)
  } else {
    result = await instantiateFromUrl(url, opts)
  }
  return result.instance
}

/** 序列化 WebAssembly 通用初始化辅助函数，供虚拟模块直接返回。 */
const wasmHelperCode = wasmHelper.toString()

/** 在浏览器中实例化 Wasm；MIME 正确时走流式编译，否则回退到 ArrayBuffer。 */
const instantiateFromUrl = async (url: string, opts?: WebAssembly.Imports) => {
  // instantiateStreaming 要求服务端返回 application/wasm，但不少静态服务器
  // 配置不正确；此时先读取原始 buffer，避免部署后因 MIME 而无法启动。
  // 背景：https://github.com/mdn/webassembly-examples/issues/5
  const response = await fetch(url)
  const contentType = response.headers.get('Content-Type') || ''
  if (
    'instantiateStreaming' in WebAssembly &&
    contentType.startsWith('application/wasm')
  ) {
    return WebAssembly.instantiateStreaming(response, opts, wasmCompileOptions)
  } else {
    const buffer = await response.arrayBuffer()
    return WebAssembly.instantiate(buffer, opts, wasmCompileOptions)
  }
}

/** 序列化浏览器端按 URL 实例化 WebAssembly 的辅助函数。 */
const instantiateFromUrlCode = instantiateFromUrl.toString()

/** SSR 运行时使用文件 URL 读取并实例化构建产物。 */
const instantiateFromFile = async (
  fileUrlString: string,
  opts?: WebAssembly.Imports,
) => {
  const { readFile } = await import('node:fs/promises')
  const fileUrl = new URL(fileUrlString, /** #__KEEP__ */ import.meta.url)
  const buffer = await readFile(fileUrl)
  return WebAssembly.instantiate(buffer, opts, wasmCompileOptions)
}

/** 序列化服务端按文件路径实例化 WebAssembly 的辅助函数。 */
const instantiateFromFileCode = instantiateFromFile.toString()

/**
 * 为 `?init` 与直接 `.wasm` 导入生成 ESM 胶水代码。
 *
 * `?init` 暴露显式初始化函数；直接导入会静态分析 Wasm imports/exports，生成顶层
 * await 实例化与 ESM 导出。SSR 构建中的资产占位符还需在 `renderChunk` 阶段
 * 转换为相对当前 chunk 的文件 URL。
 */
export const wasmHelperPlugin = (): Plugin => {
  return perEnvironmentPlugin('vite:wasm-helper', (env) => {
    return {
      name: 'vite:wasm-helper',

      resolveId: {
        filter: { id: exactRegex(wasmHelperId) },
        /** 声明 WebAssembly 初始化辅助虚拟模块 ID。 */
        handler(id) {
          return id
        },
      },

      load: {
        filter: {
          id: [
            exactRegex(wasmHelperId),
            wasmInitRE,
            wasmDirectRE,
            wasmInstanceRE,
          ],
        },
        /** 把 `?init` 请求转换为加载 wasm URL 并调用初始化辅助函数的模块。 */
        async handler(id) {
          const ssr = this.environment.config.consumer === 'server'

          if (id === wasmHelperId) {
            return `
const wasmCompileOptions = ${JSON.stringify(wasmCompileOptions)}
const instantiateFromUrl = ${ssr ? instantiateFromFileCode : instantiateFromUrlCode}
export default ${wasmHelperCode}
`
          }

          const isInit = wasmInitRE.test(id)
          const isInstance = wasmInstanceRE.test(id)
          const cleanedId = isInstance ? cleanUrl(id) : id.split('?')[0]

          // 直接 `.wasm` 导入实现 Wasm ESM Integration 语义。
          let wasmInfo: WasmInfo | undefined
          if (!isInit) {
            wasmInfo = await parseWasm(cleanedId)
            // 含 Global 导出时，外层给 JS 提供解包后的值，底层 instance 模块则
            // 保留 WebAssembly.Global，供另一个 Wasm 模块导入同一活单元格。
            if (!isInstance && wasmInfo.hasGlobalExport) {
              return generateWrapperGlue(
                wasmInfo,
                cleanedId + wasmInstanceSuffix,
              )
            }
          }

          let url = await fileToUrl(this, cleanedId, ssr)
          assetUrlRE.lastIndex = 0
          if (ssr && assetUrlRE.test(url)) {
            url = url.replace('__VITE_ASSET__', '__VITE_WASM_INIT__')
          }

          if (isInit) {
            return `
  import initWasm from "${wasmHelperId}"
  export default opts => initWasm(opts, ${JSON.stringify(url)})
  `
          }

          const glueCode = generateInstanceGlue(wasmInfo!, {
            initWasm: '__vite__initWasm',
            wasmUrl: '__vite__wasmUrl',
          })

          return `
import __vite__initWasm from "${wasmHelperId}"
const __vite__wasmUrl = ${JSON.stringify(url)}
${glueCode}
`
        },
      },

      renderChunk:
        env.config.consumer === 'server'
          ? {
              filter: { code: wasmInitUrlRE },
              /** 替换 wasm 初始化占位符，并为目标平台选择 URL 或文件实例化代码。 */
              handler(code, chunk, opts, meta) {
                const toRelativeRuntime =
                  createToImportMetaURLBasedRelativeRuntime(
                    opts.format,
                    this.environment.config.isWorker,
                  )

                let match: RegExpExecArray | null
                let s: RolldownMagicString | MagicString | undefined

                wasmInitUrlRE.lastIndex = 0
                while ((match = wasmInitUrlRE.exec(code))) {
                  const [full, referenceId] = match
                  const file = this.getFileName(referenceId)
                  chunk.viteMetadata!.importedAssets.add(cleanUrl(file))
                  const { runtime } = toRelativeRuntime(file, chunk.fileName)

                  s ??= meta.magicString ?? new MagicString(code)

                  s.update(
                    match.index,
                    match.index + full.length,
                    `"+${runtime}+"`,
                  )
                }

                if (!s) return null

                return meta.magicString
                  ? {
                      code: s as RolldownMagicString,
                    }
                  : {
                      code: s.toString(),
                      map: this.environment.config.build.sourcemap
                        ? (s as MagicString).generateMap({
                            hires: 'boundary',
                          })
                        : null,
                    }
              },
            }
          : undefined,
    }
  })
}

/** 描述 WebAssembly 导入或导出名称及其全局属性。 */
interface WasmName {
  /** WebAssembly 导入或导出段记录的原始名称。 */
  name: string
  /** 指示该 WebAssembly 名称是否引用可变全局值。 */
  isGlobal: boolean
}

/** 汇总 WebAssembly 模块的导入分组、导出和全局导出状态。 */
interface WasmInfo {
  /** 按来源模块分组的 WebAssembly 导入。 */
  imports: {
    /** WebAssembly 导入项的来源模块名。 */
    from: string
    /** 该来源下的 WebAssembly 导入名称列表。 */
    names: WasmName[]
  }[]
  /** WebAssembly 模块暴露的导出名称。 */
  exports: WasmName[]
  /** 指示导出中是否存在需特殊包装的 WebAssembly Global。 */
  hasGlobalExport: boolean
}

/**
 * 编译 Wasm 二进制并提取生成 ESM 胶水所需的导入、导出和 Global 类型信息。
 * 引擎保留模块在这里被排除，剩余导入按源模块聚合成 import object。
 */
async function parseWasm(wasmFilePath: string): Promise<WasmInfo> {
  try {
    const wasmBinary = await fsp.readFile(wasmFilePath)
    const wasmModule = await WebAssembly.compile(wasmBinary, wasmCompileOptions)
    const importMap = new Map<string, WasmName[]>()
    for (const item of WebAssembly.Module.imports(wasmModule)) {
      if (wasmReservedModules.has(item.module)) continue
      let names = importMap.get(item.module)
      if (!names) importMap.set(item.module, (names = []))
      names.push({ name: item.name, isGlobal: item.kind === 'global' })
    }
    const imports = [...importMap].map(([from, names]) => ({ from, names }))

    let hasGlobalExport = false
    const exports = WebAssembly.Module.exports(wasmModule).map((item) => {
      const isGlobal = item.kind === 'global'
      if (isGlobal) hasGlobalExport = true
      return { name: item.name, isGlobal }
    })

    return { imports, exports, hasGlobalExport }
  } catch (e) {
    throw new Error(
      `Failed to parse WASM file "${wasmFilePath}": ${(e as Error).message}`,
      { cause: e },
    )
  }
}

/**
 * 生成底层 instance 模块：构造 import object、实例化 Wasm，并原样重导出 exports。
 * Global 保持 WebAssembly.Global 对象，确保 wasm-to-wasm 导入拿到活绑定。
 */
function generateInstanceGlue(
  wasmInfo: WasmInfo,
  names: {
    /** 生成模块中调用的 WebAssembly 初始化函数绑定名。 */
    initWasm: string;
    /** 生成模块中保存 wasm 资源 URL 的绑定名。 */
    wasmUrl: string
  },
): string {
  const importStatements: string[] = []
  const importObject: SimpleObject = wasmInfo.imports.map(
    ({ from, names: importNames }, i) => {
      const value: SimpleObject = []
      const globals = importNames.filter((n) => n.isGlobal)
      const others = importNames.filter((n) => !n.isGlobal)
      if (others.length > 0) {
        const ns = `__vite__wasmImport_${i}`
        importStatements.push(`import * as ${ns} from ${JSON.stringify(from)};`)
        for (const { name } of others) {
          value.push({
            key: JSON.stringify(name),
            value: `${ns}[${JSON.stringify(name)}]`,
          })
        }
      }
      if (globals.length > 0) {
        // Wasm Global 导入必须拿到 WebAssembly.Global 对象，因此从依赖的
        // instance 层读取，而不是使用面向 JS 解包后的普通值。
        const ns = `__vite__wasmImportInstance_${i}`
        importStatements.push(
          `import * as ${ns} from ${JSON.stringify(from + wasmInstanceSuffix)};`,
        )
        for (const { name } of globals) {
          value.push({
            key: JSON.stringify(name),
            value: `${ns}[${JSON.stringify(name)}]`,
          })
        }
      }
      return { key: JSON.stringify(from), value }
    },
  )

  const initCode = `const __vite__wasmModule = (await ${names.initWasm}(${codegenSimpleObject(importObject)}, ${names.wasmUrl})).exports;`

  if (wasmInfo.exports.length === 0) {
    return [...importStatements, initCode].join('\n')
  }

  const exportStatements: string[] = []
  const nameMap = new Map<string, string>()
  for (const [index, { name }] of wasmInfo.exports.entries()) {
    if (isValidJsDeclareName(name)) {
      exportStatements.push(`  ${name},`)
    } else {
      const placeholderName = `__vite__wasmExport_${index}`
      exportStatements.push(`  ${JSON.stringify(name)}: ${placeholderName},`)
      nameMap.set(name, placeholderName)
    }
  }

  if (nameMap.size > 0) {
    exportStatements.unshift(`const {`)
    exportStatements.push(`} = __vite__wasmModule;`)
    exportStatements.push(`export {`)
    for (const { name } of wasmInfo.exports) {
      const localName = nameMap.get(name)
      if (localName) {
        exportStatements.push(`  ${localName} as ${JSON.stringify(name)},`)
      } else {
        exportStatements.push(`  ${name},`)
      }
    }
    exportStatements.push(`};`)
  } else {
    exportStatements.unshift(`export const {`)
    exportStatements.push(`} = __vite__wasmModule;`)
  }

  return [...importStatements, initCode, ...exportStatements].join('\n')
}

/**
 * 生成面向 JS 的外层模块：先重导出 instance 层，再用 `.value` 覆盖 Global 导出。
 * 这同时保留函数/内存等原始导出，并让 JS 使用者得到符合直觉的普通值。
 */
function generateWrapperGlue(wasmInfo: WasmInfo, instanceId: string): string {
  const instanceIdLiteral = JSON.stringify(instanceId)
  const lines = [`export * from ${instanceIdLiteral};`]

  // `export *` 不包含 default，存在时必须显式重导出。
  if (wasmInfo.exports.some((e) => e.name === 'default')) {
    lines.push(`export { default } from ${instanceIdLiteral};`)
  }

  const imports: string[] = []
  const bindings: string[] = []
  const unwraps: string[] = []
  const reExports: string[] = []
  for (const [index, { name, isGlobal }] of wasmInfo.exports.entries()) {
    if (!isGlobal || name === 'default') continue
    const alias = `__vite__wasmGlobal_${index}`
    imports.push(`${codegenModuleExportName(name)} as ${alias}`)
    // 合法标识符可直接作为本地绑定；其他 Wasm 名称需要额外的别名。
    const binding = isValidJsDeclareName(name)
      ? name
      : `__vite__wasmGlobalValue_${index}`
    bindings.push(binding)
    // v128 Global 在 GetGlobalValue 时会抛错且没有 JS 表示，捕获后保持 undefined。
    unwraps.push(`try { ${binding} = ${alias}.value; } catch {}`)
    reExports.push(
      binding === name ? name : `${binding} as ${JSON.stringify(name)}`,
    )
  }

  if (bindings.length > 0) {
    lines.push(`import { ${imports.join(', ')} } from ${instanceIdLiteral};`)
    lines.push(`let ${bindings.join(', ')};`)
    lines.push(...unwraps)
    lines.push(`export { ${reExports.join(', ')} };`)
  }

  return lines.join('\n')
}

/** 生成可用于 import/export 子句的模块导出名。 */
function codegenModuleExportName(name: string): string {
  return isValidJsDeclareName(name) ? name : JSON.stringify(name)
}

/** 表示可递归序列化为对象字面量的键值项列表。 */
type SimpleObject = SimpleObjectKeyValue[]

/** 描述生成 WebAssembly 胶水代码时的一个递归键值项。 */
interface SimpleObjectKeyValue {
  /** 生成对象字面量时使用的属性键。 */
  key: string
  /** 生成对象字面量时使用的标量值或嵌套对象。 */
  value: string | SimpleObject
}

/** 把受控的键值树生成 import object 字面量，值均来自内部生成的标识符表达式。 */
function codegenSimpleObject(obj: SimpleObject): string {
  if (obj.length === 0) return '{}'
  return `{ ${obj
    .map(({ key, value }) => {
      return `${key}: ${typeof value === 'string' ? value : codegenSimpleObject(value as SimpleObject)}`
    })
    .join(', ')} }`
}

/** 判断 WebAssembly 名称能否直接作为 JavaScript 标识符输出。 */
const VALID_JS_IDENTIFIER = /^[$_\p{ID_Start}][$\p{ID_Continue}]*$/u

/** 保存不能作为裸对象属性输出的 JavaScript 保留字。 */
const RESERVED_WORDS = new Set([
  'abstract',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'double',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'function',
  'goto',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'int',
  'interface',
  'let',
  'long',
  'native',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'volatile',
  'while',
  'with',
  'yield',
])

/** 判断 Wasm 名称能否直接声明为 JavaScript 绑定。 */
function isValidJsDeclareName(name: string): boolean {
  return !RESERVED_WORDS.has(name) && VALID_JS_IDENTIFIER.test(name)
}
