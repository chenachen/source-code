import fs from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { TestCssLinkPlugin } from './css-link/plugin.ts'

export default defineConfig(({ command }) => ({
  input: [
    path.resolve(import.meta.dirname, './index.html'),
    ...(command === 'build'
      ? []
      : [path.resolve(import.meta.dirname, './missing-import/index.html')]),
    path.resolve(
      import.meta.dirname,
      './unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html',
    ),
    path.resolve(import.meta.dirname, './counter/index.html'),
    path.resolve(
      import.meta.dirname,
      './self-accept-within-circular/index.html',
    ),
    path.resolve(import.meta.dirname, './css-deps/index.html'),
  ],
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
      async hotUpdate({ file, read }) {
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
        server.environments.client.hot.on(
          'custom:remote-add',
          ({ a, b }, client) => {
            client.send('custom:remote-add-result', { result: a + b })
          },
        )
      },
    },
    virtualPlugin(),
    transformCountPlugin(),
    watchCssDepsPlugin(),
    TestCssLinkPlugin(),
    hotEventsPlugin(),
  ],
}))

/** 创建带闭包计数的虚拟模块插件；模块导入真实依赖并把当前计数拼进导出。
 * @returns 含解析、加载和事件驱动 reload 的插件。 */
function virtualPlugin(): Plugin {
  let num = 0
  return {
    name: 'virtual-file',
    /** 把目标虚拟请求转为带空字节的内部 ID；SSR 只接收固定入口，浏览器变体接收此前缀的全部后缀。
     * @param id 待解析请求。
     * @returns 虚拟内部 ID，未命中时无结果。 */
    resolveId(id) {
      if (id.startsWith('virtual:file')) {
        return '\0' + id
      }
    },
    /** 命中内部虚拟 ID 时生成导入真实消息模块及拼接闭包计数的 ESM；其他 ID 继续由后续插件处理。
     * @param id 已解析 ID。
     * @returns 命中时的模块源码。 */
    load(id) {
      if (id.startsWith('\0virtual:file')) {
        return `\
import { virtual as _virtual } from "/importedVirtual.js";
export const virtual = _virtual + '${num}';`
      }
    },
    /** 收到 increment 事件后在对应图中找虚拟节点；存在才递增闭包计数并 reloadModule，浏览器按 suffix 选择节点，SSR 使用固定节点。
     * @param server 当前开发服务。 */
    configureServer(server) {
      server.environments.client.hot.on('virtual:increment', async (suffix) => {
        const mod = await server.environments.client.moduleGraph.getModuleById(
          '\0virtual:file' + (suffix || ''),
        )
        if (mod) {
          num++
          server.environments.client.reloadModule(mod)
        }
      })
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

/** 读取邻近 JS 的颜色并登记 watch 依赖，供 CSS 的间接文件变化触发重转换。
 * @returns 测试 CSS 依赖插件。 */
function watchCssDepsPlugin(): Plugin {
  return {
    name: 'watch-css-deps',
    /** 仅处理目标 CSS，等待读取相邻依赖并提取颜色；addWatchFile 后替换 CSS 占位符。
     * @param code CSS 输入文本。
     * @param id 已解析模块 ID。
     * @returns 命中时的 CSS 转换 Promise。 */
    async transform(code, id) {
      // 将 CSS 中的占位标识符替换为相邻依赖文件
      // dep.js 导出的 color 值。
      if (id.includes('css-deps/main.css')) {
        const depPath = path.resolve(import.meta.dirname, './css-deps/dep.js')
        const dep = await fs.readFile(depPath, 'utf-8')
        const color = dep.match(/color = '(.+?)'/)[1]
        this.addWatchFile(depPath)
        return code.replace('replaced', color)
      }
    },
  }
}

/** 给 client 通道的连接/断开计数，并提供 JSON 端点给浏览器测试读取。
 * @returns 通道生命周期测试插件。 */
function hotEventsPlugin(): Plugin {
  return {
    name: 'hot-events',
    /** 注册两个事件计数监听及计数端点；其他 URL 调 next 继续中间件。
     * @param server 当前开发服务。 */
    configureServer(server) {
      let connectCount = 0
      let disconnectCount = 0
      const clientEnv = server.environments.client
      clientEnv.hot.on('vite:client:connect', () => connectCount++)
      clientEnv.hot.on('vite:client:disconnect', () => disconnectCount++)

      server.middlewares.use((req, res, next) => {
        if (req.url === '/hot-events-counts') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ connectCount, disconnectCount }))
          return
        }
        next()
      })
    },
  }
}
