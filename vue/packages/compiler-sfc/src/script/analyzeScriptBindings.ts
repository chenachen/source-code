import type {
  ArrayExpression,
  Node,
  ObjectExpression,
  Statement,
} from '@babel/types'
import { type BindingMetadata, BindingTypes } from '@vue/compiler-dom'
import { resolveObjectKey } from './utils'

/**
 * 从普通 `<script>` 的 Options API 默认导出中提取模板可见绑定。
 * 既用于普通 script 单入口，也用于与 script setup 合并时补充 Options API bindings。
 */
export function analyzeScriptBindings(ast: Statement[]): BindingMetadata {
  for (const node of ast) {
    if (
      node.type === 'ExportDefaultDeclaration' &&
      node.declaration.type === 'ObjectExpression'
    ) {
      return analyzeBindingsFromOptions(node.declaration)
    }
  }
  return {}
}

/** 分析 props/inject/computed/methods/setup/data 等静态 Options API 形状。 */
function analyzeBindingsFromOptions(node: ObjectExpression): BindingMetadata {
  const bindings: BindingMetadata = {}
  // #3270/#3275：标记为非 script setup，模板编译器便不会把 Options API 名称当作可直接
  // 解析组件/指令的 setup import；它们应继续通过组件实例代理访问。
  Object.defineProperty(bindings, '__isScriptSetup', {
    enumerable: false,
    value: false,
  })
  for (const property of node.properties) {
    if (
      property.type === 'ObjectProperty' &&
      !property.computed &&
      property.key.type === 'Identifier'
    ) {
      // props 支持数组和对象两种静态声明。
      if (property.key.name === 'props') {
        // props: ['foo']
        // props: { foo: ... }
        for (const key of getObjectOrArrayExpressionKeys(property.value)) {
          bindings[key] = BindingTypes.PROPS
        }
      }

      // inject 同样支持数组和对象形式，统一归为 Options API 绑定。
      else if (property.key.name === 'inject') {
        // inject: ['foo']
        // inject: { foo: {} }
        for (const key of getObjectOrArrayExpressionKeys(property.value)) {
          bindings[key] = BindingTypes.OPTIONS
        }
      }

      // computed/methods 的对象静态键在 render 中通过实例代理可见。
      else if (
        property.value.type === 'ObjectExpression' &&
        (property.key.name === 'computed' || property.key.name === 'methods')
      ) {
        // methods: { foo() {} }
        // computed: { foo() {} }
        for (const key of getObjectExpressionKeys(property.value)) {
          bindings[key] = BindingTypes.OPTIONS
        }
      }
    }

    // 对 setup/data 方法，只能静态识别直接返回的对象字面量键。
    else if (
      property.type === 'ObjectMethod' &&
      property.key.type === 'Identifier' &&
      (property.key.name === 'setup' || property.key.name === 'data')
    ) {
      for (const bodyItem of property.body.body) {
        // setup() {
        //   return {
        //     foo: null
        //   }
        // }
        if (
          bodyItem.type === 'ReturnStatement' &&
          bodyItem.argument &&
          bodyItem.argument.type === 'ObjectExpression'
        ) {
          for (const key of getObjectExpressionKeys(bodyItem.argument)) {
            bindings[key] =
              property.key.name === 'setup'
                ? BindingTypes.SETUP_MAYBE_REF
                : BindingTypes.DATA
          }
        }
      }
    }
  }

  return bindings
}

/** 提取对象字面量的静态键；spread 与动态计算键无法可靠推导。 */
function getObjectExpressionKeys(node: ObjectExpression): string[] {
  const keys = []
  for (const prop of node.properties) {
    if (prop.type === 'SpreadElement') continue
    const key = resolveObjectKey(prop.key, prop.computed)
    if (key) keys.push(String(key))
  }
  return keys
}

/** 提取数组字面量中的字符串成员，忽略洞和非字符串表达式。 */
function getArrayExpressionKeys(node: ArrayExpression): string[] {
  const keys = []
  for (const element of node.elements) {
    if (element && element.type === 'StringLiteral') {
      keys.push(element.value)
    }
  }
  return keys
}

/** 从 Options API 常见的对象/数组声明形式中提取静态名称。 */
export function getObjectOrArrayExpressionKeys(value: Node): string[] {
  if (value.type === 'ArrayExpression') {
    return getArrayExpressionKeys(value)
  }
  if (value.type === 'ObjectExpression') {
    return getObjectExpressionKeys(value)
  }
  return []
}
