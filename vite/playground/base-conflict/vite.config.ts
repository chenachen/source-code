import { defineConfig, normalizePath } from 'vite'

/** 规范化当前夹具目录的磁盘路径，作为绝对导入与 base 冲突场景的来源。 */
const rootPath = normalizePath(import.meta.dirname)
/** 确保 Windows 与 POSIX 都具有前导斜杠，便于生成与 URL base 相同的首段。 */
const absoluteRoot = rootPath.startsWith('/') ? rootPath : `/${rootPath}`
/** 磁盘路径的首个非空段，故意用它构造冲突 base。 */
const [firstSegment] = absoluteRoot.split('/').filter(Boolean)
/** 与磁盘绝对路径共享首段的 URL 前缀，验证 import analysis 不误删磁盘路径段。 */
const base = firstSegment ? `/${firstSegment}/` : '/'

/** 页面使用的虚拟导入名；由本配置中的 resolveId 接管。 */
const VIRTUAL_MODULE_ID = 'absolute-importer'
/** 带零字节前缀的内部模块 ID，隔离虚拟模块与真实磁盘路径。 */
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID

/** 虚拟模块生成的 import 指向该真实文件，路径首段同时出现在 base 中。 */
const absoluteDepPath = `${rootPath}/src/importee.ts`
export default defineConfig({
  base,
  plugins: [
    {
      name: 'absolute-path-import',
      /** 把 absolute-importer 映射为内部虚拟 ID；其余导入交给后续解析器。 */
      resolveId(id) {
        if (id === VIRTUAL_MODULE_ID) {
          return RESOLVED_VIRTUAL_MODULE_ID
        }
      },
      /** 为内部虚拟模块生成磁盘绝对路径 import，并转发其默认导出供页面断言。 */
      load(id) {
        if (id === RESOLVED_VIRTUAL_MODULE_ID) {
          return (
            `import dep from ${JSON.stringify(absoluteDepPath)}\n` +
            `export default dep`
          )
        }
      },
    },
  ],
})
