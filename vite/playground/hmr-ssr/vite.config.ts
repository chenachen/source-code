import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

export default defineConfig({
  experimental: {
    hmrPartialAccept: true,
  },
  build: {
    /** 仅对指定的非内联 SVG 返回 false；其他资源返回 undefined，让默认大小策略继续判断。
     * @param filePath 待处理资产路径。
     * @returns 禁止此 SVG 内联，或沿用默认规则。 */
    assetsInlineLimit(filePath) {
      if (filePath.endsWith('logo-no-inline.svg')) {
        return false
      }
    },
  },
  plugins: [
    {
      name: 'mock-custom',
      /** 文件名命中自定义消息源时等待 read，提取导出字符串并通过当前 environment 发出两个消息事件。
       * @param options 更新文件、读取函数及服务信息。 */
      async hotUpdate({ file, read, server }) {
        if (file.endsWith('customFile.js')) {
          const content = await read()
          const msg = content.match(/export const msg = '(\w+)'/)[1]
          this.environment.hot.send('custom:foo', { msg })
          this.environment.hot.send('custom:remove', { msg })
        }
      },
      /** 订阅远程加法事件，只向发出请求的 client 回复两数之和。
       * @param server 当前开发服务，分别选择本 fixture 的 client 或 SSR hot 通道。 */
      configureServer(server) {
        server.environments.ssr.hot.on(
          'custom:remote-add',
          ({ a, b }, client) => {
            client.send('custom:remote-add-result', { result: a + b })
          },
        )
      },
    },
    virtualPlugin(),
    transformCountPlugin(),
    queryPlugin(),
  ],
})

/** 创建带闭包计数的虚拟模块插件；模块导入真实依赖并把当前计数拼进导出。
 * @returns 含解析、加载和事件驱动 reload 的插件。 */
function virtualPlugin(): Plugin {
  let num = 0
  return {
    name: 'virtual-file',
    /** 把目标虚拟请求转为带空字节的内部 ID；SSR 只接收固定入口，浏览器变体接收此前缀的全部后缀。
     * @param id 待解析请求。
     * @returns 虚拟内部 ID，未命中时无结果。 */
    resolveId(id, importer) {
      if (id === 'virtual:file' || id === '\0virtual:file') {
        return '\0virtual:file'
      }
    },
    /** 命中内部虚拟 ID 时生成导入真实消息模块及拼接闭包计数的 ESM；其他 ID 继续由后续插件处理。
     * @param id 已解析 ID。
     * @returns 命中时的模块源码。 */
    load(id) {
      if (id === '\0virtual:file') {
        return `\
import { virtual as _virtual } from "/importedVirtual.js";
export const virtual = _virtual + '${num}';`
      }
    },
    /** 收到 increment 事件后在对应图中找虚拟节点；存在才递增闭包计数并 reloadModule，浏览器按 suffix 选择节点，SSR 使用固定节点。
     * @param server 当前开发服务。 */
    configureServer(server) {
      server.environments.ssr.hot.on('virtual:increment', async () => {
        const mod =
          await server.environments.ssr.moduleGraph.getModuleByUrl(
            '\0virtual:file',
          )
        if (mod) {
          num++
          server.environments.ssr.reloadModule(mod)
        }
      })
    },
  }
}

/** 为两个 query 后缀构造 transform 插件，源文本与后缀组成不同默认导出。
 * @returns query 模块转换插件。 */
function queryPlugin(): Plugin {
  return {
    name: 'query-resolver',
    /** 按 query1/query2 后缀返回序列化字符串导出，包含原 code；其他请求返回 undefined。
     * @param code 原文件内容。
     * @param id 带 query 的解析 ID。
     * @returns 命中后缀时的默认字符串导出源码。 */
    transform(code, id) {
      if (id.includes('?query1')) {
        return `export default ${JSON.stringify(code + 'query1')}`
      }

      if (id.includes('?query2')) {
        return `export default ${JSON.stringify(code + 'query2')}`
      }
    },
  }
}

/** 用闭包累积包含转换占位符的次数，供软失效测试区分复用与重新 transform。
 * @returns 计数转换插件。 */
function transformCountPlugin(): Plugin {
  let num = 0
  return {
    name: 'transform-count',
    /** 只有 code 包含计数占位符时才递增，并替换该首次匹配；其余模块不修改也不计数。
     * @param code 待转换文本。
     * @returns 替换后的文本或 undefined。 */
    transform(code) {
      if (code.includes('__TRANSFORM_COUNT__')) {
        return code.replace('__TRANSFORM_COUNT__', String(++num))
      }
    },
  }
}
