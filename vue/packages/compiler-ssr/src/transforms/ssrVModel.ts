import {
  DOMErrorCodes,
  type DirectiveTransform,
  ElementTypes,
  type ExpressionNode,
  NodeTypes,
  type PlainElementNode,
  type TemplateChildNode,
  createCallExpression,
  createConditionalExpression,
  createDOMCompilerError,
  createInterpolation,
  createObjectProperty,
  createSimpleExpression,
  findProp,
  hasDynamicKeyVBind,
  transformModel,
} from '@vue/compiler-dom'
import {
  SSR_INCLUDE_BOOLEAN_ATTR,
  SSR_LOOSE_CONTAIN,
  SSR_LOOSE_EQUAL,
  SSR_RENDER_DYNAMIC_MODEL,
} from '../runtimeHelpers'
import type { DirectiveTransformResult } from '../../../compiler-core/src/transform'

/**
 * 将 v-model 转换为原生表单控件的初始 HTML 状态，或复用组件 v-model props。
 *
 * input 根据 type 生成 value/checked，textarea 把值放进转义文本 children，select 递归给
 * 匹配 option 添加 selected。服务端无 DOM directive 生命周期，所有初始状态必须显式输出。
 */
export const ssrTransformModel: DirectiveTransform = (dir, node, context) => {
  const model = dir.exp!

  /** 检查用户显式 value 与 v-model 同时控制同一表单值。 */
  function checkDuplicatedValue() {
    const value = findProp(node, 'value')
    if (value) {
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_V_MODEL_UNNECESSARY_VALUE,
          value.loc,
        ),
      )
    }
  }

  /** 递归穿过 v-if/v-for/optgroup，处理 select 下所有可能的 option。 */
  const processSelectChildren = (children: TemplateChildNode[]) => {
    children.forEach(child => {
      if (child.type === NodeTypes.ELEMENT) {
        processOption(child as PlainElementNode)
      } else if (child.type === NodeTypes.FOR) {
        processSelectChildren(child.children)
      } else if (child.type === NodeTypes.IF) {
        child.branches.forEach(b => processSelectChildren(b.children))
      }
    })
  }

  /**
   * 为没有显式 selected 的 option 注入选择条件。
   * 多选数组使用 looseContain，单值使用 looseEqual，以匹配客户端 v-model 宽松比较语义。
   */
  function processOption(plainNode: PlainElementNode) {
    if (plainNode.tag === 'option') {
      if (plainNode.props.findIndex(p => p.name === 'selected') === -1) {
        const value = findValueBinding(plainNode)
        plainNode.ssrCodegenNode!.elements.push(
          createConditionalExpression(
            createCallExpression(context.helper(SSR_INCLUDE_BOOLEAN_ATTR), [
              createConditionalExpression(
                createCallExpression(`Array.isArray`, [model]),
                createCallExpression(context.helper(SSR_LOOSE_CONTAIN), [
                  model,
                  value,
                ]),
                createCallExpression(context.helper(SSR_LOOSE_EQUAL), [
                  model,
                  value,
                ]),
              ),
            ]),
            createSimpleExpression(' selected', true),
            createSimpleExpression('', true),
            false /* no newline */,
          ),
        )
      }
    } else if (plainNode.tag === 'optgroup') {
      processSelectChildren(plainNode.children)
    }
  }

  if (node.tagType === ElementTypes.ELEMENT) {
    const res: DirectiveTransformResult = { props: [] }
    if (node.tag === 'input') {
      const defaultProps = [
        // 文本类 input 默认把 model 输出为 value 属性。
        createObjectProperty(`value`, model),
      ]
      const type = findProp(node, 'type')
      if (type) {
        const value = findValueBinding(node)
        if (type.type === NodeTypes.DIRECTIVE) {
          // 动态 type 运行时才知道应输出 value 还是 checked，交给统一 helper。
          res.ssrTagParts = [
            createCallExpression(context.helper(SSR_RENDER_DYNAMIC_MODEL), [
              type.exp!,
              model,
              value,
            ]),
          ]
        } else if (type.value) {
          // 静态 type 可在编译期选择最小输出表达式。
          switch (type.value.content) {
            case 'radio':
              res.props = [
                createObjectProperty(
                  `checked`,
                  createCallExpression(context.helper(SSR_LOOSE_EQUAL), [
                    model,
                    value,
                  ]),
                ),
              ]
              break
            case 'checkbox':
              const trueValueBinding = findProp(node, 'true-value')
              if (trueValueBinding) {
                const trueValue =
                  trueValueBinding.type === NodeTypes.ATTRIBUTE
                    ? JSON.stringify(trueValueBinding.value!.content)
                    : trueValueBinding.exp!
                res.props = [
                  createObjectProperty(
                    `checked`,
                    createCallExpression(context.helper(SSR_LOOSE_EQUAL), [
                      model,
                      trueValue,
                    ]),
                  ),
                ]
              } else {
                res.props = [
                  createObjectProperty(
                    `checked`,
                    createConditionalExpression(
                      createCallExpression(`Array.isArray`, [model]),
                      createCallExpression(context.helper(SSR_LOOSE_CONTAIN), [
                        model,
                        value,
                      ]),
                      model,
                    ),
                  ),
                ]
              }
              break
            case 'file':
              context.onError(
                createDOMCompilerError(
                  DOMErrorCodes.X_V_MODEL_ON_FILE_INPUT_ELEMENT,
                  dir.loc,
                ),
              )
              break
            default:
              checkDuplicatedValue()
              res.props = defaultProps
              break
          }
        }
      } else if (hasDynamicKeyVBind(node)) {
        // 无参数 v-bind/动态键可能提供 type，需要结合完整 props 对象判断；这里不生成，
        // 由 ssrTransformElement 重写整个 props 表达式并调用动态 model helper。
      } else {
        // 缺少 type 的 input 按 HTML 默认文本类型处理。
        checkDuplicatedValue()
        res.props = defaultProps
      }
    } else if (node.tag === 'textarea') {
      checkDuplicatedValue()
      node.children = [createInterpolation(model, model.loc)]
    } else if (node.tag === 'select') {
      processSelectChildren(node.children)
    } else {
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_V_MODEL_ON_INVALID_ELEMENT,
          dir.loc,
        ),
      )
    }

    return res
  } else {
    // 组件 v-model 与客户端相同，只需 modelValue/onUpdate props，复用 core 转换。
    return transformModel(dir, node, context)
  }
}

/** 取得表单元素静态/动态 value 表达式；未提供时以 null 参与 v-model 比较。 */
function findValueBinding(node: PlainElementNode): ExpressionNode {
  const valueBinding = findProp(node, 'value')
  return valueBinding
    ? valueBinding.type === NodeTypes.DIRECTIVE
      ? valueBinding.exp!
      : createSimpleExpression(valueBinding.value!.content, true)
    : createSimpleExpression(`null`, false)
}
