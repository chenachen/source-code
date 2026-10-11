import {
  type DirectiveBinding,
  type DirectiveHook,
  type ObjectDirective,
  type VNode,
  nextTick,
  warn,
} from '@vue/runtime-core'
import { addEventListener } from '../modules/events'
import {
  invokeArrayFns,
  isArray,
  isSet,
  looseEqual,
  looseIndexOf,
  looseToNumber,
} from '@vue/shared'

/** 把 DOM 新值写回父组件 model 的 `onUpdate:modelValue` 处理器。 */
type AssignerFn = (value: any) => void

/** 从 VNode 提取当前 model assigner；多个监听器按数组顺序全部执行。 */
const getModelAssigner = (vnode: VNode): AssignerFn => {
  const fn =
    vnode.props!['onUpdate:modelValue'] ||
    (__COMPAT__ && vnode.props!['onModelCompat:input'])
  return isArray(fn) ? value => invokeArrayFns(fn, value) : fn
}

/** 输入法组合开始：标记期间 input 事件只是未确认中间文本，不应写回 model。 */
function onCompositionStart(e: Event) {
  ;(e.target as any).composing = true
}

/** 输入法组合结束：清标记并补发 input，让最终确认文本进入正常 v-model 流程。 */
function onCompositionEnd(e: Event) {
  const target = e.target as any
  if (target.composing) {
    target.composing = false
    target.dispatchEvent(new Event('input'))
  }
}

/** 元素上缓存本次渲染 model assigner 的私有键。 */
const assignKey: unique symbol = Symbol('_assign')
/** 水合时保存浏览器从 SSR DOM 得到的初始可编辑值。 */
const initialValueKey: unique symbol = Symbol('_initialValue')

/** 带 v-model 内部状态的指令类型。 */
type ModelDirective<T, Modifiers extends string = string> = ObjectDirective<
  T & {
    /** 当前 VNode 的 model 回写处理器；每次更新替换它，让稳定事件监听器读取最新闭包。 */
    [assignKey]: AssignerFn
    /** 水合 created 保存的规范化 defaultValue；mounted 用它判断用户是否提前输入，随后删除。 */
    [initialValueKey]?: string
    /** select change 回写到 nextTick 之间为 true，阻止同轮 updated 用旧 model 覆盖选中状态。 */
    _assigning?: boolean
  },
  any,
  Modifiers
>

/** 按 `.trim`、`.number` 顺序转换文本输入值。looseToNumber 转换失败时保留原字符串。 */
function castValue(value: string, trim?: boolean, number?: boolean | null) {
  if (trim) value = value.trim()
  if (number) value = looseToNumber(value)
  return value
}

/**
 * 文本 input/textarea 的 v-model 指令。
 *
 * 直接导出各控件指令而非一个总入口，使未使用 v-model 或只使用某类控件时可 tree-shaking。
 * 负责输入法组合、lazy/trim/number、水合用户输入保护和焦点输入框光标稳定性。
 */
export const vModelText: ModelDirective<
  HTMLInputElement | HTMLTextAreaElement,
  'trim' | 'number' | 'lazy'
> = {
  /** 初始化文本输入监听与水合初值；lazy 监听 change，其余监听 input/组合输入；事件读取元素上最新 assigner。 */
  created(el, { modifiers: { lazy, trim, number } }, vnode) {
    // 水合 created 面对已在 DOM 的元素。保存 SSR/defaultValue 规范化结果，mounted 时可
    // 判断用户是否在 JS 加载前已经输入；若已输入，应写回 model 而非覆盖用户内容。
    if (el.parentNode) {
      if (el.type === 'text') {
        // text input.value 会去掉 CR/LF，但 defaultValue 保留，先按浏览器 value 规则规范化。
        el[initialValueKey] = el.defaultValue.replace(/[\r\n]/g, '')
      } else if (el.type === 'textarea') {
        // textarea.value 把 CRLF/CR 统一成 LF。
        el[initialValueKey] = el.defaultValue.replace(/\r\n?/g, '\n')
      }
    }
    el[assignKey] = getModelAssigner(vnode)
    const castToNumber =
      number || (vnode.props && vnode.props.type === 'number')
    addEventListener(el, lazy ? 'change' : 'input', e => {
      if ((e.target as any).composing) return
      el[assignKey](castValue(el.value, trim, castToNumber))
    })
    if (trim || castToNumber) {
      addEventListener(el, 'change', () => {
        el.value = castValue(el.value, trim, castToNumber)
      })
    }
    if (!lazy) {
      addEventListener(el, 'compositionstart', onCompositionStart)
      addEventListener(el, 'compositionend', onCompositionEnd)
      // Safari <10.2/UIWebView 在输入法确认前切焦点可能不发 compositionend；部分浏览器
      //（如 iOS Chrome）自动填充只发 change。change 兜底统一结束 composing 并补 input。
      addEventListener(el, 'change', onCompositionEnd)
    }
  },
  // mounted 才设 value，保证 range 的 min/max 等 props 已先写入。
  /** 待 type/min/max 等 props 已写入后设置 value。水合前用户已编辑文本时，把现值按修饰符回写 model 并删除初值缓存，避免覆盖输入。 */
  mounted(el, { value, modifiers: { trim, number } }) {
    const newValue = value == null ? '' : value
    const initialValue = el[initialValueKey]
    delete el[initialValueKey]
    if (
      initialValue !== undefined &&
      (el.type === 'text' || el.type === 'textarea') &&
      el.value !== initialValue
    ) {
      el[assignKey](castValue(el.value, trim, number))
    } else {
      el.value = newValue
    }
  },
  /** 更新 assigner，组合输入中直接返回；等价值或焦点下 lazy/trim 的等价变化不重写 value，减少光标跳动。 */
  beforeUpdate(
    el,
    { value, oldValue, modifiers: { lazy, trim, number } },
    vnode,
  ) {
    el[assignKey] = getModelAssigner(vnode)
    // #2302：输入法组合尚未确认时不能用响应式旧值覆盖 DOM 中间文本。
    if ((el as any).composing) return
    const elValue =
      (number || el.type === 'number') && !/^0\d/.test(el.value)
        ? looseToNumber(el.value)
        : el.value
    const newValue = value == null ? '' : value

    if (elValue === newValue) {
      return
    }

    const rootNode = el.getRootNode()
    if (
      (rootNode instanceof Document || rootNode instanceof ShadowRoot) &&
      rootNode.activeElement === el &&
      el.type !== 'range'
    ) {
      // #8546：正在编辑的输入框尽量不写等价值，避免光标跳动/selection 重置。
      if (lazy && value === oldValue) {
        return
      }
      if (trim && el.value.trim() === newValue) {
        return
      }
    }

    el.value = newValue
  },
}

/**
 * checkbox v-model：支持 Array、Set 以及 true-value/false-value 标量模式。
 * 数组/Set 更新都创建新集合，触发父 model 响应式赋值。
 */
export const vModelCheckbox: ModelDirective<HTMLInputElement> = {
  // #4096：数组内部增删也应影响每个 checkbox checked，指令绑定需深度追踪。
  deep: true,
  /** 登记 checkbox change 监听；Array 按宽松索引增删，Set 克隆后按原值增删，标量使用 true/false-value；读取最新 _modelValue。 */
  created(el, _, vnode) {
    el[assignKey] = getModelAssigner(vnode)
    addEventListener(el, 'change', () => {
      const modelValue = (el as any)._modelValue
      const elementValue = getValue(el)
      const checked = el.checked
      const assign = el[assignKey]
      if (isArray(modelValue)) {
        const index = looseIndexOf(modelValue, elementValue)
        const found = index !== -1
        if (checked && !found) {
          assign(modelValue.concat(elementValue))
        } else if (!checked && found) {
          const filtered = [...modelValue]
          filtered.splice(index, 1)
          assign(filtered)
        }
      } else if (isSet(modelValue)) {
        const cloned = new Set(modelValue)
        if (checked) {
          cloned.add(elementValue)
        } else {
          cloned.delete(elementValue)
        }
        assign(cloned)
      } else {
        assign(getCheckboxValue(el, checked))
      }
    })
  },
  // 挂载后再算初始 checked，等待 true-value/false-value props 已写入元素私有字段。
  mounted: setChecked,
  /** 替换 checkbox assigner 后计算 checked；保持监听器身份不变。 */
  beforeUpdate(el, binding, vnode) {
    el[assignKey] = getModelAssigner(vnode)
    setChecked(el, binding, vnode)
  },
}

/** 按当前 Array/Set/标量 model 计算并最小化更新 checkbox.checked。 */
function setChecked(
  el: HTMLInputElement,
  { value, oldValue }: DirectiveBinding,
  vnode: VNode,
) {
  // change listener 闭包保持稳定，最新 modelValue 单独存在元素上供事件发生时读取。
  ;(el as any)._modelValue = value
  let checked: boolean

  if (isArray(value)) {
    checked = looseIndexOf(value, vnode.props!.value) > -1
  } else if (isSet(value)) {
    checked = value.has(vnode.props!.value)
  } else {
    if (value === oldValue) return
    checked = looseEqual(value, getCheckboxValue(el, true))
  }

  // 只写变化状态，减少浏览器表单副作用。
  if (el.checked !== checked) {
    el.checked = checked
  }
}

/** radio v-model：当前 model 与 radio 原始 value 宽松相等时选中。 */
export const vModelRadio: ModelDirective<HTMLInputElement> = {
  /** 按宽松比较设置 radio 初始 checked，登记 change 时回写原始 _value 的监听器。 */
  created(el, { value }, vnode) {
    el.checked = looseEqual(value, vnode.props!.value)
    el[assignKey] = getModelAssigner(vnode)
    addEventListener(el, 'change', () => {
      el[assignKey](getValue(el))
    })
  },
  /** 刷新 radio assigner；model 新旧值不同时再更新 checked。 */
  beforeUpdate(el, { value, oldValue }, vnode) {
    el[assignKey] = getModelAssigner(vnode)
    if (value !== oldValue) {
      el.checked = looseEqual(value, vnode.props!.value)
    }
  },
}

/**
 * select v-model：单选返回单值，多选按原 model 容器类型返回 Array 或 Set。
 * option 必须先挂载，因此选择状态在 mounted/updated 阶段提交。
 */
export const vModelSelect: ModelDirective<HTMLSelectElement, 'number'> = {
  // multiple 的 Array/Set 内部变化会改变 option.selected，需要深度追踪。
  deep: true,
  /** 登记 select change 监听，按 number 修饰符读取选中 options，并依最新 model 类型返回 Array/Set；_assigning 保护同轮回写到 nextTick 结束。 */
  created(el, { value, modifiers: { number } }, vnode) {
    ;(el as any)._modelValue = value
    addEventListener(el, 'change', () => {
      const selectedVal = Array.prototype.filter
        .call(el.options, (o: HTMLOptionElement) => o.selected)
        .map((o: HTMLOptionElement) =>
          number ? looseToNumber(getValue(o)) : getValue(o),
        )
      el[assignKey](
        el.multiple
          ? isSet((el as any)._modelValue)
            ? new Set(selectedVal)
            : selectedVal
          : selectedVal[0],
      )
      el._assigning = true
      nextTick(() => {
        el._assigning = false
      })
    })
    el[assignKey] = getModelAssigner(vnode)
  },
  // select 状态依赖 option children，mounted/updated 后它们才是本轮最终集合。
  /** 等所有 option 挂载后，以 model 初始化 selected/selectedIndex。 */
  mounted(el, { value }) {
    setSelected(el, value)
  },
  /** option patch 前更新 _modelValue 与 assigner；选择状态留给 updated。 */
  beforeUpdate(el, { value }, vnode) {
    ;(el as any)._modelValue = value
    el[assignKey] = getModelAssigner(vnode)
  },
  /** option patch 后重算选择；change 刚回写产生的同轮 updated 用 _assigning 跳过，避免读回旧值。 */
  updated(el, { value }) {
    if (!el._assigning) {
      setSelected(el, value)
    }
  },
}

/** 遍历 options，把 modelValue 映射到 selected/selectedIndex。 */
function setSelected(el: HTMLSelectElement, value: any) {
  const isMultiple = el.multiple
  const isArrayValue = isArray(value)
  if (isMultiple && !isArrayValue && !isSet(value)) {
    __DEV__ &&
      warn(
        `<select multiple v-model> expects an Array or Set value for its binding, ` +
          `but got ${Object.prototype.toString.call(value).slice(8, -1)}.`,
      )
    return
  }

  for (let i = 0, l = el.options.length; i < l; i++) {
    const option = el.options[i]
    const optionValue = getValue(option)
    if (isMultiple) {
      if (isArrayValue) {
        const optionType = typeof optionValue
        // 字符串/数字用字符串比较覆盖 DOM 序列化差异；对象再走 looseIndexOf。
        if (optionType === 'string' || optionType === 'number') {
          option.selected = value.some(v => String(v) === String(optionValue))
        } else {
          option.selected = looseIndexOf(value, optionValue) > -1
        }
      } else {
        option.selected = value.has(optionValue)
      }
    } else if (looseEqual(getValue(option), value)) {
      if (el.selectedIndex !== i) el.selectedIndex = i
      return
    }
  }
  if (!isMultiple && el.selectedIndex !== -1) {
    el.selectedIndex = -1
  }
}

/** 读取 `:value` 保存的原始值；没有 `_value` 才回退 DOM 字符串 value。 */
function getValue(el: HTMLOptionElement | HTMLInputElement) {
  return '_value' in el ? (el as any)._value : el.value
}

/** 读取 checkbox 非字符串 true-value/false-value；未设置时回退原生布尔值。 */
function getCheckboxValue(
  el: HTMLInputElement & {
    /** patchProp 保存的未字符串化 true-value，勾选时用于标量 model。 */
    _trueValue?: any;
    /**
     * patchProp 保存的未字符串化 false-value，取消勾选时用于标量 model。
     */
    _falseValue?: any
  },
  checked: boolean,
) {
  const key = checked ? '_trueValue' : '_falseValue'
  return key in el ? el[key] : checked
}

/**
 * 动态 input type/标签的 v-model 分派指令。
 * 编译器无法静态确定控件类型时，各生命周期重新按真实 tag/type 选择具体实现。
 */
export const vModelDynamic: ObjectDirective<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
> = {
  /** created 时按真实 tag/type 转交专用 v-model 的创建钩子。 */
  created(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'created')
  },
  /** mounted 时重新解析控件类型，转交初始化 DOM 状态的钩子。 */
  mounted(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'mounted')
  },
  /** beforeUpdate 时按本轮 VNode type 转交更新钩子，带上 prevVNode 供专用实现使用。 */
  beforeUpdate(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'beforeUpdate')
  },
  /** updated 时重新选择控件实现，在 option 等 children 更新后同步 DOM。 */
  updated(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'updated')
  },
}

/** 根据大写 DOM tagName 与 input type 选择专用 v-model 指令。 */
function resolveDynamicModel(tagName: string, type: string | undefined) {
  switch (tagName) {
    case 'SELECT':
      return vModelSelect
    case 'TEXTAREA':
      return vModelText
    default:
      switch (type) {
        case 'checkbox':
          return vModelCheckbox
        case 'radio':
          return vModelRadio
        default:
          return vModelText
      }
  }
}

/** 调用当前动态控件对应指令的同名生命周期钩子。 */
function callModelHook(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  binding: DirectiveBinding,
  vnode: VNode,
  prevVNode: VNode | null,
  hook: keyof ObjectDirective,
) {
  const modelToUse = resolveDynamicModel(
    el.tagName,
    vnode.props && vnode.props.type,
  )
  const fn = modelToUse[hook] as DirectiveHook
  fn && fn(el, binding, vnode, prevVNode)
}

/**
 * 给各 v-model 指令安装 SSR props 生成器。
 * 仅用户在 SSR 中复用客户端 render 函数时使用；SSR 模板编译器有专门转换。
 */
export function initVModelForSSR(): void {
  /** 为客户端 render 的 SSR 复用输出绑定 value；不安装浏览器输入监听。 */
  vModelText.getSSRProps = ({ value }) => ({ value })

  /** SSR 中绑定 model 与 radio value 宽松相等时输出 checked:true，否则不添加。 */
  vModelRadio.getSSRProps = ({ value }, vnode) => {
    if (vnode.props && looseEqual(vnode.props.value, value)) {
      return { checked: true }
    }
  }

  /** SSR Array 用宽松索引、Set 用原值 has 判定 checked；标量真值输出 checked:true。 */
  vModelCheckbox.getSSRProps = ({ value }, vnode) => {
    if (isArray(value)) {
      if (vnode.props && looseIndexOf(value, vnode.props.value) > -1) {
        return { checked: true }
      }
    } else if (isSet(value)) {
      if (vnode.props && value.has(vnode.props.value)) {
        return { checked: true }
      }
    } else if (value) {
      return { checked: true }
    }
  }

  /** SSR 原生 VNode 根据大写标签和 type 分派专用指令的 getSSRProps；非字符串组件 VNode 直接返回。 */
  vModelDynamic.getSSRProps = (binding, vnode) => {
    if (typeof vnode.type !== 'string') {
      return
    }
    const modelToUse = resolveDynamicModel(
      // resolveDynamicModel 接收 DOM 风格大写 tagName，而 VNode 原生 type 是小写。
      vnode.type.toUpperCase(),
      vnode.props && vnode.props.type,
    )
    if (modelToUse.getSSRProps) {
      return modelToUse.getSSRProps(binding, vnode)
    }
  }
}

/** 全局 v-model 指令在类型系统中的所有可能专用实现。 */
export type VModelDirective =
  | typeof vModelText
  | typeof vModelCheckbox
  | typeof vModelSelect
  | typeof vModelRadio
  | typeof vModelDynamic
