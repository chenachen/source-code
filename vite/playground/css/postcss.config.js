import fs from 'node:fs'
import path from 'node:path'
import { globSync } from 'tinyglobby'
import { normalizePath } from 'vite'
import postcssNested from 'postcss-nested'

export default {
  plugins: [
    postcssNested,
    testDirDep,
    testSourceInput,
    testInjectUrl,
    testInjectUrlOnceExit,
  ],
}

/**
 * 创建目录依赖夹具插件，展开 @test 并发送含普通目录和特殊字符目录的 dir-dependency 消息。
 *
 * 验证 dir-dependency 消息被转为文件监听及 glob 匹配。
 */
function testDirDep() {
  return {
    postcssPlugin: 'dir-dep',
    /** 读取匹配 CSS 替换 @test，再登记相对源文件目录的监听消息；新增或删除 glob 文件也应触发 CSS 更新。 */
    AtRule(atRule, { result, Comment }) {
      if (atRule.name === 'test') {
        const pattern = normalizePath(
          path.resolve(path.dirname(result.opts.from), './glob-dep/**/*.css'),
        )
        const files = globSync(pattern, { expandDirectories: false })
        const text = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n')
        atRule.parent.insertAfter(atRule, text)
        atRule.remove()

        result.messages.push({
          type: 'dir-dependency',
          plugin: 'dir-dep',
          dir: './glob-dep',
          glob: '*.css',
          parent: result.opts.from,
        })

        result.messages.push({
          type: 'dir-dependency',
          plugin: 'dir-dep',
          dir: './glob-dep/nested (dir)', // 目录名包含 glob 特殊字符。
          glob: '*.css',
          parent: result.opts.from,
        })
      }
    },
  }
}
testDirDep.postcss = true

/** 创建源路径可观察插件，将 PostCSS input.from 写入 CSS content。 */
function testSourceInput() {
  return {
    postcssPlugin: 'source-input',
    /** 把 @source-input 替换为显示源文件路径的伪元素规则，验证 inline/query 转换保留输入来源。 */
    AtRule(atRule) {
      if (atRule.name === 'source-input') {
        atRule.after(
          `.source-input::before { content: ${JSON.stringify(
            atRule.source.input.from,
          )}; }`,
        )
        atRule.remove()
      }
    },
  }
}
testSourceInput.postcss = true

/** 创建早期 URL 注入插件，给 @inject-url 所在源文件插入带别名的背景图片规则。 */
function testInjectUrl() {
  return {
    postcssPlugin: 'inject-url',
    /** 遍历并替换 @inject-url，复制原 source 到新规则和声明，让后续 URL 重写按正确文件解析。 */
    Once(root, { Rule }) {
      root.walkAtRules('inject-url', (atRule) => {
        const rule = new Rule({
          selector: '.inject-url',
          source: atRule.source,
        })
        rule.append({
          prop: 'background',
          value: "url('=/ok.png')",
          source: atRule.source,
        })
        atRule.after(rule)
        atRule.remove()
      })
    },
  }
}
testInjectUrl.postcss = true

/**
 * 创建末期 URL 注入插件，模拟 CSS Modules compose 展开时插入具有独立来源的 CSS。
 *
 * 验证 OnceExit 注入且具有独立 source 的 CSS URL 重写，覆盖 compose 展开类似路径。
 */
function testInjectUrlOnceExit() {
  return {
    postcssPlugin: 'inject-url-once-exit',
    /** 在 OnceExit 前置另一源文件的背景规则；其 from 指向 injected-source/injected.css，URL 应相对该文件解析。 */
    OnceExit(root, { postcss }) {
      root.walkAtRules('inject-url-once-exit', (atRule) => {
        atRule.remove()
        root.prepend(
          postcss.parse(
            '.inject-url-once-exit { background: url(./injected-bg.png) }',
            {
              from: path.join(
                import.meta.dirname,
                'injected-source/injected.css',
              ),
            },
          ),
        )
      })
    },
  }
}
testInjectUrlOnceExit.postcss = true
