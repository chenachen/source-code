import {
  type Ref,
  isReactive,
  isReadonly,
  isRef,
  isShallow,
  pauseTracking,
  resetTracking,
  toRaw,
} from '@vue/reactivity'
import { EMPTY_OBJ, extend, isArray, isFunction, isObject } from '@vue/shared'
import type { ComponentInternalInstance, ComponentOptions } from './component'
import type { ComponentPublicInstance } from './componentPublicInstance'

/**
 * 在 Chrome DevTools 中注册 Vue 对象格式化器。
 * 开发者展开组件实例、ref 或 reactive/readonly 代理时，会看到按 props/setup/data/
 * computed/inject 分组的结构，而非充满内部字段的 Proxy。仅开发态浏览器执行。
 */
export function initCustomFormatter(): void {
  /* eslint-disable no-restricted-globals */
  if (!__DEV__ || typeof window === 'undefined') {
    return
  }

  /** Vue 类型标签颜色。 */
  const vueStyle = { style: 'color:#3ba776' }
  /** 数字值颜色。 */
  const numberStyle = { style: 'color:#1677ff' }
  /** 字符串值颜色。 */
  const stringStyle = { style: 'color:#f5222d' }
  /** 键名、布尔值等关键字颜色。 */
  const keywordStyle = { style: 'color:#eb2f96' }

  // Chrome 自定义格式化器协议：每个返回值都是 JSONML 数组。
  // https://www.mattzeunert.com/2016/02/19/custom-chrome-devtools-object-formatters.html
  const formatter = {
    __vue_custom_formatter: true,
    /** 返回 Vue 实例/响应式值的 JSONML 摘要；非 Vue 对象返回 null，ref 读取期间暂停跟踪。 */
    header(obj: unknown) {
      // TODO：未来也可单独格式化 ComponentPublicInstance 及 setup 中 ctx.slots/attrs。
      if (!isObject(obj)) {
        return null
      }

      if (obj.__isVue) {
        return ['div', vueStyle, `VueInstance`]
      } else if (isRef(obj)) {
        // DevTools 展开对象不是应用逻辑，读取 ref.value 前暂停依赖跟踪，避免当前恰好
        // 活动的 effect 因调试查看而订阅这个 ref。
        pauseTracking()
        const value = obj.value
        resetTracking()
        return [
          'div',
          {},
          ['span', vueStyle, genRefFlag(obj)],
          '<',
          formatValue(value),
          `>`,
        ]
      } else if (isReactive(obj)) {
        return [
          'div',
          {},
          ['span', vueStyle, isShallow(obj) ? 'ShallowReactive' : 'Reactive'],
          '<',
          formatValue(obj),
          `>${isReadonly(obj) ? ` (readonly)` : ``}`,
        ]
      } else if (isReadonly(obj)) {
        return [
          'div',
          {},
          ['span', vueStyle, isShallow(obj) ? 'ShallowReadonly' : 'Readonly'],
          '<',
          formatValue(obj),
          '>',
        ]
      }
      return null
    },
    /** 只有 Vue 公共实例需要可展开的字段分组；ref/代理的摘要本身已包含值。 */
    hasBody(obj: unknown) {
      return obj && (obj as any).__isVue
    },
    /** 从公开实例的 $ 内部实例生成分组正文，不修改应用状态。 */
    body(obj: unknown) {
      if (obj && (obj as any).__isVue) {
        return [
          'div',
          {},
          ...formatInstance((obj as ComponentPublicInstance).$),
        ]
      }
    },
  }

  /** 把组件内部实例拆成便于查看的多个字段分组。 */
  function formatInstance(instance: ComponentInternalInstance) {
    const blocks = []
    if (instance.type.props && instance.props) {
      blocks.push(createInstanceBlock('props', toRaw(instance.props)))
    }
    if (instance.setupState !== EMPTY_OBJ) {
      blocks.push(createInstanceBlock('setup', instance.setupState))
    }
    if (instance.data !== EMPTY_OBJ) {
      blocks.push(createInstanceBlock('data', toRaw(instance.data)))
    }
    const computed = extractKeys(instance, 'computed')
    if (computed) {
      blocks.push(createInstanceBlock('computed', computed))
    }
    const injected = extractKeys(instance, 'inject')
    if (injected) {
      blocks.push(createInstanceBlock('injected', injected))
    }

    blocks.push([
      'div',
      {},
      [
        'span',
        {
          style: keywordStyle.style + ';opacity:0.66',
        },
        '$ (internal): ',
      ],
      ['object', { object: instance }],
    ])
    return blocks
  }

  /** 把一个实例字段组转换为 Chrome formatter 的可展开 JSONML。 */
  function createInstanceBlock(type: string, target: any) {
    // 复制为普通对象，避免 DevTools 展开过程直接遍历响应式代理并触发 getter。
    target = extend({}, target)
    if (!Object.keys(target).length) {
      return ['span', {}]
    }
    return [
      'div',
      { style: 'line-height:1.25em;margin-bottom:0.6em' },
      [
        'div',
        {
          style: 'color:#476582',
        },
        type,
      ],
      [
        'div',
        {
          style: 'padding-left:1.25em',
        },
        ...Object.keys(target).map(key => {
          return [
            'div',
            {},
            ['span', keywordStyle, key + ': '],
            formatValue(target[key], false),
          ]
        }),
      ],
    ]
  }

  /** 按值类型生成带颜色的标量或可展开对象节点。 */
  function formatValue(v: unknown, asRaw = true) {
    if (typeof v === 'number') {
      return ['span', numberStyle, v]
    } else if (typeof v === 'string') {
      return ['span', stringStyle, JSON.stringify(v)]
    } else if (typeof v === 'boolean') {
      return ['span', keywordStyle, v]
    } else if (isObject(v)) {
      return ['object', { object: asRaw ? toRaw(v) : v }]
    } else {
      return ['span', stringStyle, String(v)]
    }
  }

  /**
   * 从实例 ctx 中提取 computed/inject 对应的键。
   * 键可能由当前组件、extends 或任意 mixin 声明，因此递归匹配完整 Options API 链。
   */
  function extractKeys(instance: ComponentInternalInstance, type: string) {
    const Comp = instance.type
    if (isFunction(Comp)) {
      return
    }
    const extracted: Record<string, any> = {}
    for (const key in instance.ctx) {
      if (isKeyOfType(Comp, key, type)) {
        extracted[key] = instance.ctx[key]
      }
    }
    return extracted
  }

  /** 判断某 key 是否在组件自身、extends 或 mixins 的指定选项中声明。 */
  function isKeyOfType(Comp: ComponentOptions, key: string, type: string) {
    const opts = Comp[type]
    if (
      (isArray(opts) && opts.includes(key)) ||
      (isObject(opts) && key in opts)
    ) {
      return true
    }
    if (Comp.extends && isKeyOfType(Comp.extends, key, type)) {
      return true
    }
    if (Comp.mixins && Comp.mixins.some(m => isKeyOfType(m, key, type))) {
      return true
    }
  }

  /** 根据响应式实现特征区分 ShallowRef、ComputedRef 与普通 Ref。 */
  function genRefFlag(v: Ref) {
    if (isShallow(v)) {
      return `ShallowRef`
    }
    if ((v as any).effect) {
      return `ComputedRef`
    }
    return `Ref`
  }

  // 保留其他框架/库已经注册的 formatter，Vue 只追加自己的处理器。
  if ((window as any).devtoolsFormatters) {
    ;(window as any).devtoolsFormatters.push(formatter)
  } else {
    ;(window as any).devtoolsFormatters = [formatter]
  }
}
