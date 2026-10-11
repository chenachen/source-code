import path from 'node:path'
import { normalizePath } from 'vite'
import { bundle as bundleWithLightningCss } from 'lightningcss'
import { globSync } from 'tinyglobby'

/**
 * 用 Lightning CSS bundle 的 StyleSheet visitor 捕获文件 AST；失败保留原错误为 cause，供 glob 规则展开使用。
 *
 * @param {string} filename
 * @returns {import('lightningcss').StyleSheet}
 *
 * 实现参考 https://github.com/sardinedev/lightningcss-plugins/blob/9fb379486e402a4b4b8950d09e655b4cbf8a118b/packages/global-custom-queries/src/globalCustomQueries.ts#L9-L29
 * https://github.com/sardinedev/lightningcss-plugins/blob/main/LICENSE
 */
function obtainLightningCssAst(filename) {
  let ast
  try {
    bundleWithLightningCss({
      filename,
      visitor: {
        /** 接收 bundle 完成的样式表并保存到外层变量，供 obtainLightningCssAst 返回。 */
        StyleSheet(stylesheet) {
          ast = stylesheet
        },
      },
    })
    return ast
  } catch (error) {
    throw Error(`failed to obtain lightning css AST`, { cause: error })
  }
}

/**
 * 将自定义 @test 展开为同目录 glob 匹配文件的规则，并登记 glob 依赖以触发新增、删除和更新后的重编译。
 * @type {import('lightningcss').VisitorFunction<{}>} */
export function testDirDep({ addDependency }) {
  /** @type {string[]} */
  let currentStyleSheetSources
  return {
    /** 保存当前样式表 sources；规则的 source_index 随后用它定位原始文件目录。 */
    StyleSheet(stylesheet) {
      currentStyleSheetSources = stylesheet.sources
    },
    Rule: {
      unknown: {
        /** 按 @test 所在源文件目录收集 glob-dep CSS，登记依赖并返回各文件 AST 规则替换该 at-rule。 */
        test(rule) {
          const location = rule.loc
          const from = currentStyleSheetSources[location.source_index]
          const pattern = normalizePath(
            path.resolve(path.dirname(from), './glob-dep/**/*.css'),
          )
          const files = globSync(pattern, {
            expandDirectories: false,
            absolute: true,
          })
          addDependency({ type: 'glob', glob: pattern })
          return files.flatMap((file) => obtainLightningCssAst(file).rules)
        },
      },
    },
  }
}

/**
 * 创建 source-input visitor，把 at-rule 的原始文件路径写为伪元素 content，供测试观察输入路径与 query。
 * @returns {import('lightningcss').Visitor} */
export function testSourceInput() {
  /** @type {string[]} */
  let currentStyleSheetSources
  return {
    /** 记录当前样式表源文件表，供 source-input 规则按 source_index 查找来源。 */
    StyleSheet(stylesheet) {
      currentStyleSheetSources = stylesheet.sources
    },
    Rule: {
      unknown: {
        /** 把自定义 at-rule 替换为 .source-input::before 规则，content 保存其真实源路径，loc 继续沿用原规则。 */
        'source-input': (rule) => {
          const location = rule.loc
          const from = currentStyleSheetSources[location.source_index]
          return [
            {
              type: 'style',
              value: {
                // .source-input::before
                selectors: [
                  [
                    { type: 'class', name: 'source-input' },
                    { type: 'pseudo-element', kind: 'before' },
                  ],
                ],
                // content: ${JSON.stringify(from)};
                declarations: {
                  declarations: [
                    {
                      property: 'custom',
                      value:
                        /** @satisfies {import('lightningcss').CustomProperty} */ ({
                          name: 'content',
                          value: [
                            {
                              type: 'token',
                              value: { type: 'string', value: from },
                            },
                          ],
                        }),
                    },
                  ],
                },
                loc: rule.loc,
              },
            },
          ]
        },
      },
    },
  }
}

/**
 * 创建仅支持单选择器与 & 后缀拼接的简化 nesting visitor；用于测试 visitor 修改 AST 后仍参与 Vite CSS 处理。
 *
 * 这是 https://github.com/postcss/postcss-nested 的简化 nesting 场景。
 *
 * @returns {import('lightningcss').Visitor}
 */
export function nestedLikePlugin() {
  return {
    Rule: {
      /** 把可识别的嵌套 & 后缀规则提升为同级规则并从原规则移除；其他嵌套规则保持原样，多选择器父规则跳过。 */
      style(rule) {
        // 本夹具不处理多个选择器。
        if (rule.value.selectors.length > 1) {
          return
        }
        const parentSelector = rule.value.selectors[0]

        const nestedRules = rule.value.rules
        /** @type {import('lightningcss').Rule[]} */
        const additionalRules = []
        if (nestedRules) {
          const filteredNestedRules = []
          for (const nestedRule of nestedRules) {
            if (nestedRule.type === 'style') {
              const selectors = nestedRule.value.selectors
              // 本夹具不处理多个选择器。
              if (selectors.length === 1) {
                const selector = selectors[0]
                if (
                  selector.length >= 2 &&
                  selector[0].type === 'nesting' &&
                  selector[1].type === 'type'
                ) {
                  const lastParentSelectorComponent =
                    parentSelector[parentSelector.length - 1]
                  if ('name' in lastParentSelectorComponent) {
                    const newSelector = [
                      ...parentSelector.slice(0, -1),
                      {
                        ...lastParentSelectorComponent,
                        name:
                          lastParentSelectorComponent.name + selector[1].name,
                      },
                    ]
                    additionalRules.push({
                      type: 'style',
                      value: {
                        selectors: [newSelector],
                        declarations: nestedRule.value.declarations,
                        loc: nestedRule.value.loc,
                      },
                    })
                    continue
                  }
                }
              }
            }
            filteredNestedRules.push(nestedRule)
          }
          rule.value.rules = filteredNestedRules
        }
        return [rule, ...additionalRules]
      },
    },
  }
}

/**
 * 创建 visitor 注入带别名的背景 URL，验证插件生成 URL 仍被 Vite 重写。
 * @returns {import('lightningcss').Visitor} */
export function testInjectUrl() {
  return {
    Rule: {
      unknown: {
        /** 把 @inject-url 替换为背景图片规则，保留源 loc，让 =/ok.png 经 CSS 资产解析。 */
        'inject-url': (rule) => {
          return [
            {
              type: 'style',
              value: {
                selectors: [[{ type: 'class', name: 'inject-url' }]],
                declarations: {
                  declarations: [
                    {
                      property: 'background-image',
                      value: [
                        {
                          type: 'url',
                          value: {
                            url: '=/ok.png',
                            loc: rule.loc,
                          },
                        },
                      ],
                    },
                  ],
                },
                loc: rule.loc,
              },
            },
          ]
        },
      },
    },
  }
}
