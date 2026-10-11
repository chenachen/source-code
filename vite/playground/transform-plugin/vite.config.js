import { resolve } from 'node:path'
import { defineConfig, normalizePath } from 'vite'

/** 规范化入口 index.js 的绝对路径；load/transform 只对这个模块登记外部 watch 文件和注入计数。 */
const file = normalizePath(resolve(import.meta.dirname, 'index.js'))
let transformCount = 1

/** 入口计数插件，在 load 与 transform 分别登记不同非导入依赖，覆盖 watch 文件失效后的重新求值。 */
const transformPlugin = {
  name: 'transform',
  /** 入口加载时登记 plugin-dep-load.js；该文件变化应使入口重新 load。 */
  load(id) {
    if (id === file) {
      // 外部 watch 文件变化使入口重新加载。
      this.addWatchFile('./plugin-dep-load.js')
    }
  },
  /** 入口转换时登记 plugin-dep.js 并注入递增计数；测试通过 DOM 检查两种依赖变化都使转换重跑。 */
  transform(code, id) {
    if (id === file) {
      // 此 watch 文件变化使入口转换结果失效。
      this.addWatchFile('./plugin-dep.js')

      return `
        // Inject TRANSFORM_COUNT
        let TRANSFORM_COUNT = ${transformCount++};

        ${code}
      `
    }
  },
}

/** pre/post transform 观察真实与虚拟 JSON 的 moduleType，并提供虚拟 JSON load 插件。 */
const moduleTypePlugins = [
  /** @type {const} */ ...['pre', 'post'].map((enforce) => ({
    name: `module-type-${enforce}`,
    enforce,
    /** 将 JSON 字符串中的阶段标记替换为 opts.moduleType；pre 应见 json，JSON 插件之后的 post 应见 js。 */
    transform(code, id, opts) {
      if (id.endsWith('/foo.json') || id.endsWith('\0/bar.json')) {
        code = code.replace(
          `MODULE_TYPE_${enforce.toUpperCase()}`,
          opts.moduleType,
        )
        return code
      }
    },
  })),
  {
    name: `module-type-load`,
    /** 把 virtual:/bar.json 映射到零字节 JSON ID，让核心 JSON 转换识别扩展名。 */
    resolveId(id) {
      if (id === 'virtual:/bar.json') {
        return '\0/bar.json'
      }
    },
    /** 返回含两个阶段占位值的 JSON 原文，分别由 pre/post transform 改写并展示。 */
    load(id) {
      if (id.endsWith('\0/bar.json')) {
        return JSON.stringify({
          moduleTypePre: 'MODULE_TYPE_PRE',
          moduleTypePost: 'MODULE_TYPE_POST',
        })
      }
    },
  },
]

/** 初始排除 JS 的对象 hook；options 在调用前修改 filter，验证惰性 hook filter 使用最终值。 */
const lazyHookFilterPlugin = {
  name: 'lazy-hook-filter',
  /** 在 options 阶段将 transform.filter 改为入口 index.js 模式，覆盖 hook filter 的延迟初始化。 */
  options() {
    lazyHookFilterPlugin.transform.filter = { id: '**/index.js' }
  },
  transform: {
    filter: /** @type {import('vite').Rolldown.HookFilter} */ ({
      id: { exclude: ['**/*.js'] },
    }),
    /** 对最终 filter 命中的入口替换页面占位文本，供 success 断言检查。 */
    handler(code) {
      return code.replaceAll('LAZY_HOOK_FILTER_CONTENT', 'success')
    },
  },
}

export default defineConfig({
  plugins: [transformPlugin, moduleTypePlugins, lazyHookFilterPlugin],
})
