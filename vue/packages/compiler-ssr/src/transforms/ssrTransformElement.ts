import {
  type ArrayExpression,
  type AttributeNode,
  type CallExpression,
  type DirectiveNode,
  ElementTypes,
  ErrorCodes,
  type ExpressionNode,
  type InterpolationNode,
  type JSChildNode,
  MERGE_PROPS,
  type NodeTransform,
  NodeTypes,
  type PlainElementNode,
  type PropsExpression,
  type TemplateLiteral,
  type TextNode,
  type TransformContext,
  buildDirectiveArgs,
  buildProps,
  createArrayExpression,
  createAssignmentExpression,
  createCallExpression,
  createCompilerError,
  createCompoundExpression,
  createConditionalExpression,
  createInterpolation,
  createSequenceExpression,
  createSimpleExpression,
  createTemplateLiteral,
  findDir,
  hasDynamicKeyVBind,
  isStaticArgOf,
  isStaticExp,
} from '@vue/compiler-dom'
import {
  NO,
  escapeHtml,
  isBooleanAttr,
  isBuiltInDirective,
  isSSRSafeAttrName,
  propsToAttrMap,
} from '@vue/shared'
import { SSRErrorCodes, createSSRCompilerError } from '../errors'
import {
  SSR_GET_DIRECTIVE_PROPS,
  SSR_GET_DYNAMIC_MODEL_PROPS,
  SSR_INCLUDE_BOOLEAN_ATTR,
  SSR_INTERPOLATE,
  SSR_RENDER_ATTR,
  SSR_RENDER_ATTRS,
  SSR_RENDER_CLASS,
  SSR_RENDER_DYNAMIC_ATTR,
  SSR_RENDER_STYLE,
} from '../runtimeHelpers'
import {
  type SSRTransformContext,
  processChildren,
} from '../ssrCodegenTransform'

/**
 * v-html/v-text/textarea value 会覆盖模板 children；第一遍保存其最终原始内容表达式，
 * 第二遍输出标签体时优先使用，避免再次遍历已失效 children。
 */
const rawChildrenMap = new WeakMap<
  PlainElementNode,
  TemplateLiteral['elements'][0]
>()

/**
 * SSR 第一遍原生元素转换：构造开始标签 TemplateLiteral。
 *
 * 静态属性尽量直接拼字符串；class/style/布尔/动态属性调用专用转义 helper；无参数 v-bind、
 * 动态键或自定义指令可能覆盖前面属性时，退化为 mergeProps + ssrRenderAttrs 全量路径。
 * 子节点和结束标签留给第二遍 {@link ssrProcessElement}。
 * 转换延迟到 exit：select v-model 需要 option 的开始标签已经构建，静态 style 转换也已
 * 改写 props。函数修改 props 顺序、children 和 ssrCodegenNode，供后续父转换与第二遍消费。
 */
export const ssrTransformElement: NodeTransform = (node, context) => {
  if (
    node.type !== NodeTypes.ELEMENT ||
    node.tagType !== ElementTypes.ELEMENT
  ) {
    return
  }

  return function ssrPostTransformElement() {
    // 开始标签由静态字符串与动态 helper 调用交错组成，第二遍直接追加到输出缓冲。
    const openTag: TemplateLiteral['elements'] = [`<${node.tag}`]
    // textarea 和自定义元素的属性/property 语义特殊，runtime helper 需要知道 tag 名。
    const needTagForRuntime =
      node.tag === 'textarea' || node.tag.indexOf('-') > 0

    // `v-bind="obj"`、动态参数和自定义指令可能按源码顺序覆盖静态 attrs，逐个提前输出会失去
    // mergeProps 优先级，所以退回完整 props 对象统一 ssrRenderAttrs。
    const hasDynamicVBind = hasDynamicKeyVBind(node)
    const hasCustomDir = node.props.some(
      p => p.type === NodeTypes.DIRECTIVE && !isBuiltInDirective(p.name),
    )

    // SSR v-show 的 display:none 必须覆盖用户 style，把它移到 props 合并末尾取得更高优先级。
    const vShowPropIndex = node.props.findIndex(
      i => i.type === NodeTypes.DIRECTIVE && i.name === 'show',
    )
    if (vShowPropIndex !== -1) {
      const vShowProp = node.props[vShowPropIndex]
      node.props.splice(vShowPropIndex, 1)
      node.props.push(vShowProp)
    }

    const needMergeProps = hasDynamicVBind || hasCustomDir
    if (needMergeProps) {
      const { props, directives } = buildProps(
        node,
        context,
        node.props,
        false /* 按组件处理 props */,
        false /* 不按动态组件处理 */,
        true /* SSR 模式 */,
      )
      if (props || directives.length) {
        const mergedProps = buildSSRProps(props, directives, context)
        const propsExp = createCallExpression(
          context.helper(SSR_RENDER_ATTRS),
          [mergedProps],
        )

        if (node.tag === 'textarea') {
          const existingText = node.children[0] as
            TextNode | InterpolationNode | undefined
          // textarea 的插值可能由 v-model 注入，优先级高于 v-bind value；v-text/v-html 又会
          // 覆盖全部内容。仅没有这些更高优先来源时才从合并 props 读取 value。
          if (
            !hasContentOverrideDirective(node) &&
            (!existingText || existingText.type !== NodeTypes.INTERPOLATION)
          ) {
            // 动态 v-bind 是否含 value 只有运行时知道：把 merged props 缓存到临时变量，
            // 属性照常输出，同时若存在 value 就将其转义后作为 textarea 文本内容。
            const tempId = `_temp${context.temps++}`
            propsExp.arguments = [
              createAssignmentExpression(
                createSimpleExpression(tempId, false),
                mergedProps,
              ),
            ]
            rawChildrenMap.set(
              node,
              createCallExpression(context.helper(SSR_INTERPOLATE), [
                createConditionalExpression(
                  createSimpleExpression(`"value" in ${tempId}`, false),
                  createSimpleExpression(`${tempId}.value`, false),
                  createSimpleExpression(
                    existingText ? existingText.content : ``,
                    true,
                  ),
                  false,
                ),
              ]),
            )
          }
        } else if (node.tag === 'input') {
          // `<input v-bind="obj" v-model>` 的 type 可能来自 obj；先缓存完整 props，再让
          // ssrGetDynamicModelProps 根据最终 type/model 补 value 或 checked，并二次 merge。
          const vModel = findVModel(node)
          if (vModel) {
            // 先保存“不含 v-model 补充项”的 props，避免 mergedProps 表达式求值两次。
            const tempId = `_temp${context.temps++}`
            const tempExp = createSimpleExpression(tempId, false)
            propsExp.arguments = [
              createSequenceExpression([
                createAssignmentExpression(tempExp, mergedProps),
                createCallExpression(context.helper(MERGE_PROPS), [
                  tempExp,
                  createCallExpression(
                    context.helper(SSR_GET_DYNAMIC_MODEL_PROPS),
                    [
                      tempExp, // 最终 input props（含运行时 type）
                      vModel.exp!, // model 当前值
                    ],
                  ),
                ]),
              ]),
            ]
          }
        } else if (directives.length && !node.children.length) {
          // 自定义指令 getSSRProps 也可能返回 textContent/innerHTML；显式 v-text/v-html
          // 优先级更高，否则运行时检查合并结果并生成标签内容。
          if (!hasContentOverrideDirective(node)) {
            const tempId = `_temp${context.temps++}`
            propsExp.arguments = [
              createAssignmentExpression(
                createSimpleExpression(tempId, false),
                mergedProps,
              ),
            ]
            rawChildrenMap.set(
              node,
              createConditionalExpression(
                createSimpleExpression(`"textContent" in ${tempId}`, false),
                createCallExpression(context.helper(SSR_INTERPOLATE), [
                  createSimpleExpression(`${tempId}.textContent`, false),
                ]),
                createSimpleExpression(`${tempId}.innerHTML ?? ''`, false),
                false,
              ),
            )
          }
        }

        if (needTagForRuntime) {
          propsExp.arguments.push(`"${node.tag}"`)
        }

        openTag.push(propsExp)
      }
    }

    // 记录静态/动态 class，遍历结束后合并成一次 ssrRenderClass，避免重复 class 属性。
    let dynamicClassBinding: CallExpression | undefined = undefined
    let staticClassBinding: string | undefined = undefined
    // transformStyle 已把静态 style 改成 v-bind；多个 style 仍需合进一次 ssrRenderStyle。
    let dynamicStyleBinding: CallExpression | undefined = undefined

    for (let i = 0; i < node.props.length; i++) {
      const prop = node.props[i]
      // true-value/false-value 仅供 checkbox v-model 比较，不是应输出到 HTML 的标准属性。
      if (node.tag === 'input' && isTrueFalseValue(prop)) {
        continue
      }
      // 先处理会改写标签体或需专用 SSR 逻辑的指令。
      if (prop.type === NodeTypes.DIRECTIVE) {
        if (prop.name === 'html' && prop.exp) {
          rawChildrenMap.set(
            node,
            createCompoundExpression([`(`, prop.exp, `) ?? ''`]),
          )
        } else if (prop.name === 'text' && prop.exp) {
          node.children = [createInterpolation(prop.exp, prop.loc)]
        } else if (prop.name === 'slot') {
          context.onError(
            createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, prop.loc),
          )
        } else if (isTextareaWithValue(node, prop) && prop.exp) {
          if (!needMergeProps) {
            node.children = [createInterpolation(prop.exp, prop.loc)]
          }
        } else if (!needMergeProps && prop.name !== 'on') {
          // 未走全量 props 路径时，逐个执行指令转换并把结果直接编码进开始标签。
          const directiveTransform = context.directiveTransforms[prop.name]
          if (directiveTransform) {
            const { props, ssrTagParts } = directiveTransform(
              prop,
              node,
              context,
            )
            if (ssrTagParts) {
              openTag.push(...ssrTagParts)
            }
            for (let j = 0; j < props.length; j++) {
              const { key, value } = props[j]
              if (isStaticExp(key)) {
                let attrName = key.content
                // key/ref 是 VNode 身份信息，不对应 SSR HTML 属性。
                if (attrName === 'key' || attrName === 'ref') {
                  continue
                }
                if (attrName === 'class') {
                  openTag.push(
                    ` class="`,
                    (dynamicClassBinding = createCallExpression(
                      context.helper(SSR_RENDER_CLASS),
                      [value],
                    )),
                    `"`,
                  )
                } else if (attrName === 'style') {
                  if (dynamicStyleBinding) {
                    // 已有 style 调用时把新值追加为数组，交给 normalizeStyle 按顺序合并。
                    mergeCall(dynamicStyleBinding, value)
                  } else {
                    openTag.push(
                      ` style="`,
                      (dynamicStyleBinding = createCallExpression(
                        context.helper(SSR_RENDER_STYLE),
                        [value],
                      )),
                      `"`,
                    )
                  }
                } else {
                  attrName =
                    node.tag.indexOf('-') > 0
                      ? attrName // 自定义元素保留用户原始属性大小写/拼写
                      : propsToAttrMap[attrName] || attrName.toLowerCase()
                  if (isBooleanAttr(attrName)) {
                    openTag.push(
                      createConditionalExpression(
                        createCallExpression(
                          context.helper(SSR_INCLUDE_BOOLEAN_ATTR),
                          [value],
                        ),
                        createSimpleExpression(' ' + attrName, true),
                        createSimpleExpression('', true),
                        false /* 表达式不换行 */,
                      ),
                    )
                  } else if (attrName === 'hidden') {
                    openTag.push(
                      createCallExpression(
                        context.helper(SSR_RENDER_DYNAMIC_ATTR),
                        [key, value],
                      ),
                    )
                  } else if (isSSRSafeAttrName(attrName)) {
                    openTag.push(
                      createCallExpression(context.helper(SSR_RENDER_ATTR), [
                        key,
                        value,
                      ]),
                    )
                  } else {
                    context.onError(
                      createSSRCompilerError(
                        SSRErrorCodes.X_SSR_UNSAFE_ATTR_NAME,
                        key.loc,
                      ),
                    )
                  }
                }
              } else {
                // 动态键只可能来自自定义 directive transform；helper 在运行时校验名称安全性。
                const args: CallExpression['arguments'] = [key, value]
                if (needTagForRuntime) {
                  args.push(`"${node.tag}"`)
                }
                openTag.push(
                  createCallExpression(
                    context.helper(SSR_RENDER_DYNAMIC_ATTR),
                    args,
                  ),
                )
              }
            }
          }
        }
      } else {
        // textarea 的 value 属性在 HTML 语义中应渲染成标签文本，而非 value="..."。
        const name = prop.name
        if (node.tag === 'textarea' && name === 'value' && prop.value) {
          rawChildrenMap.set(node, escapeHtml(prop.value.content))
        } else if (!needMergeProps) {
          if (name === 'key' || name === 'ref') {
            continue
          }
          // 静态 attrs 已由 parser 保证名称合法，值在编译期 escape 后直接拼接。
          if (name === 'class' && prop.value) {
            staticClassBinding = JSON.stringify(prop.value.content)
          }
          openTag.push(
            ` ${prop.name}` +
              (prop.value ? `="${escapeHtml(prop.value.content)}"` : ``),
          )
        }
      }
    }

    // 同时存在 class="a" 与 :class="b" 时，把静态值并入动态 helper，并删除原静态片段，
    // 确保只输出一个 class 且遵循 Vue class 规范化规则。
    if (dynamicClassBinding && staticClassBinding) {
      mergeCall(dynamicClassBinding, staticClassBinding)
      removeStaticBinding(openTag, 'class')
    }

    if (context.scopeId) {
      openTag.push(` ${context.scopeId}`)
    }

    node.ssrCodegenNode = createTemplateLiteral(openTag)
  }
}

/**
 * 合并普通 props 与自定义指令 `getSSRProps` 结果，生成 SSR 可消费的 props 表达式。
 * 已是 mergeProps 调用时复用其参数，避免嵌套 mergeProps。
 * directives 的运行时结果追加在普通 props 之后，后者可能被覆盖；返回调用表达式，
 * 并不在编译器中执行 getSSRProps。调用方保证 props 或 directives 至少有一项。
 */
export function buildSSRProps(
  props: PropsExpression | undefined,
  directives: DirectiveNode[],
  context: TransformContext,
): JSChildNode {
  let mergePropsArgs: JSChildNode[] = []
  if (props) {
    if (props.type === NodeTypes.JS_CALL_EXPRESSION) {
      // 展平已有 mergeProps 参数，维持原覆盖顺序。
      mergePropsArgs = props.arguments as JSChildNode[]
    } else {
      mergePropsArgs.push(props)
    }
  }
  if (directives.length) {
    for (const dir of directives) {
      mergePropsArgs.push(
        createCallExpression(context.helper(SSR_GET_DIRECTIVE_PROPS), [
          `_ctx`,
          ...buildDirectiveArgs(dir, context).elements,
        ] as JSChildNode[]),
      )
    }
  }

  return mergePropsArgs.length > 1
    ? createCallExpression(context.helper(MERGE_PROPS), mergePropsArgs)
    : mergePropsArgs[0]
}

/** 判断属性是否为 checkbox v-model 专用 true-value/false-value。 */
function isTrueFalseValue(prop: DirectiveNode | AttributeNode) {
  if (prop.type === NodeTypes.DIRECTIVE) {
    return (
      prop.name === 'bind' &&
      prop.arg &&
      isStaticExp(prop.arg) &&
      (prop.arg.content === 'true-value' || prop.arg.content === 'false-value')
    )
  } else {
    return prop.name === 'true-value' || prop.name === 'false-value'
  }
}

/** 判断指令是否为 `<textarea :value>`，其值应进入 children。 */
function isTextareaWithValue(
  node: PlainElementNode,
  prop: DirectiveNode,
): boolean {
  return !!(
    node.tag === 'textarea' &&
    prop.name === 'bind' &&
    isStaticArgOf(prop.arg, 'value')
  )
}

/** 向 class/style helper 首参合并新值，首次冲突时把单值提升为数组。 */
function mergeCall(call: CallExpression, arg: string | JSChildNode) {
  const existing = call.arguments[0] as ExpressionNode | ArrayExpression
  if (existing.type === NodeTypes.JS_ARRAY_EXPRESSION) {
    existing.elements.push(arg)
  } else {
    call.arguments[0] = createArrayExpression([existing, arg])
  }
}

/** 从开始标签片段中删除已并入动态 helper 的静态 class/style 属性。 */
function removeStaticBinding(
  tag: TemplateLiteral['elements'],
  binding: string,
) {
  const regExp = new RegExp(`^ ${binding}=".+"$`)

  const i = tag.findIndex(e => typeof e === 'string' && regExp.test(e))

  if (i > -1) {
    tag.splice(i, 1)
  }
}

/** 查找带表达式的 v-model 指令。 */
function findVModel(node: PlainElementNode): DirectiveNode | undefined {
  return node.props.find(
    p => p.type === NodeTypes.DIRECTIVE && p.name === 'model' && p.exp,
  ) as DirectiveNode | undefined
}

/** 判断元素是否有显式覆盖 children 的 v-text/v-html。 */
function hasContentOverrideDirective(node: PlainElementNode): boolean {
  return !!findDir(node, 'text') || !!findDir(node, 'html')
}

/**
 * SSR 第二遍输出第一遍生成的开始标签、slot scopeId、内容与结束标签。
 * void tag 不输出结束标签；rawChildrenMap 中的覆盖内容优先于普通 children。
 * 调用时第一遍必须已经写入 ssrCodegenNode。此处只追加编译期字符串/表达式片段；
 * 插槽 _scopeId 在闭合开始标签前插入，与元素本身 scopeId 同时生效。
 */
export function ssrProcessElement(
  node: PlainElementNode,
  context: SSRTransformContext,
): void {
  const isVoidTag = context.options.isVoidTag || NO
  const elementsToAdd = node.ssrCodegenNode!.elements
  for (let j = 0; j < elementsToAdd.length; j++) {
    context.pushStringPart(elementsToAdd[j])
  }

  // 转发插槽内容携带调用方 scopeId，使其 scoped/slotted CSS 能匹配当前元素。
  if (context.withSlotScopeId) {
    context.pushStringPart(createSimpleExpression(`_scopeId`, false))
  }

  // scopeId 等追加完成后闭合开始标签。
  context.pushStringPart(`>`)

  const rawChildren = rawChildrenMap.get(node)
  if (rawChildren) {
    context.pushStringPart(rawChildren)
  } else if (node.children.length) {
    processChildren(node, context)
  }

  if (!isVoidTag(node.tag)) {
    // HTML void tag（如 input/img）不能输出结束标签。
    context.pushStringPart(`</${node.tag}>`)
  }
}
