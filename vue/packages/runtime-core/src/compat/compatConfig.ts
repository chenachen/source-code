import { extend, hasOwn, isArray, isFunction } from '@vue/shared'
import {
  type Component,
  type ComponentInternalInstance,
  type ComponentOptions,
  formatComponentName,
  getComponentName,
  getCurrentInstance,
  isRuntimeOnly,
} from '../component'
import { warn } from '../warning'

/**
 * Vue 2 -> Vue 3 每项可独立开关的弃用行为标识。
 * 名称按全局 API、config、实例 API、Options、指令/attribute、内置组件与渲染函数分组；
 * 同一标识同时用于读取 compatConfig、去重警告和索引迁移说明。
 */
export enum DeprecationTypes {
  // Vue 2 全局 Vue 构造器 API
  /** 实例方法 `vm.$mount()`。 */
  GLOBAL_MOUNT = 'GLOBAL_MOUNT',
  /** `$mount` 会替换挂载容器元素的 Vue 2 行为。 */
  GLOBAL_MOUNT_CONTAINER = 'GLOBAL_MOUNT_CONTAINER',
  /** 全局构造器方法 `Vue.extend()`。 */
  GLOBAL_EXTEND = 'GLOBAL_EXTEND',
  /** 通过 `Vue.prototype` 安装全局属性。 */
  GLOBAL_PROTOTYPE = 'GLOBAL_PROTOTYPE',
  /** 全局响应式补值方法 `Vue.set()`。 */
  GLOBAL_SET = 'GLOBAL_SET',
  /** 全局响应式删值方法 `Vue.delete()`。 */
  GLOBAL_DELETE = 'GLOBAL_DELETE',
  /** Vue 2 的 `Vue.observable()`，在 Vue 3 中由 `reactive()` 取代。 */
  GLOBAL_OBSERVABLE = 'GLOBAL_OBSERVABLE',
  /** 暴露在 `Vue.util` 上、从未承诺稳定性的内部工具。 */
  GLOBAL_PRIVATE_UTIL = 'GLOBAL_PRIVATE_UTIL',

  // Vue.config 字段
  /** 全局关闭警告的 `Vue.config.silent`。 */
  CONFIG_SILENT = 'CONFIG_SILENT',
  /** 全局 Devtools 开关 `Vue.config.devtools`。 */
  CONFIG_DEVTOOLS = 'CONFIG_DEVTOOLS',
  /** 自定义键码别名 `Vue.config.keyCodes`。 */
  CONFIG_KEY_CODES = 'CONFIG_KEY_CODES',
  /** 生产提示开关 `Vue.config.productionTip`。 */
  CONFIG_PRODUCTION_TIP = 'CONFIG_PRODUCTION_TIP',
  /** 忽略自定义元素的 `Vue.config.ignoredElements`。 */
  CONFIG_IGNORED_ELEMENTS = 'CONFIG_IGNORED_ELEMENTS',
  /** 模板空白策略 `Vue.config.whitespace`。 */
  CONFIG_WHITESPACE = 'CONFIG_WHITESPACE',
  /** 自定义选项合并策略 `Vue.config.optionMergeStrategies`。 */
  CONFIG_OPTION_MERGE_STRATS = 'CONFIG_OPTION_MERGE_STRATS',

  // 组件公共实例 API
  /** 实例响应式补值方法 `vm.$set()`。 */
  INSTANCE_SET = 'INSTANCE_SET',
  /** 实例响应式删值方法 `vm.$delete()`。 */
  INSTANCE_DELETE = 'INSTANCE_DELETE',
  /** 主动销毁实例的 `vm.$destroy()`。 */
  INSTANCE_DESTROY = 'INSTANCE_DESTROY',
  /** `$on/$off/$once` 组成的实例事件总线。 */
  INSTANCE_EVENT_EMITTER = 'INSTANCE_EVENT_EMITTER',
  /** `hook:mounted` 一类通过事件监听生命周期的写法。 */
  INSTANCE_EVENT_HOOKS = 'INSTANCE_EVENT_HOOKS',
  /** 枚举直接子组件实例的 `vm.$children`。 */
  INSTANCE_CHILDREN = 'INSTANCE_CHILDREN',
  /** 读取父级监听器的 `vm.$listeners`。 */
  INSTANCE_LISTENERS = 'INSTANCE_LISTENERS',
  /** 读取作用域插槽的 `vm.$scopedSlots`。 */
  INSTANCE_SCOPED_SLOTS = 'INSTANCE_SCOPED_SLOTS',
  /** 从 `$attrs` 中排除 class/style 的 Vue 2 行为。 */
  INSTANCE_ATTRS_CLASS_STYLE = 'INSTANCE_ATTRS_CLASS_STYLE',

  // Options API 行为差异
  /** 组件 `data` 允许直接使用对象，而非必须为函数。 */
  OPTIONS_DATA_FN = 'OPTIONS_DATA_FN',
  /** 来自 mixin/extends 的 data 执行深合并。 */
  OPTIONS_DATA_MERGE = 'OPTIONS_DATA_MERGE',
  /** 旧生命周期钩子 `beforeDestroy`。 */
  OPTIONS_BEFORE_DESTROY = 'OPTIONS_BEFORE_DESTROY',
  /** 旧生命周期钩子 `destroyed`。 */
  OPTIONS_DESTROYED = 'OPTIONS_DESTROYED',

  // watch 与 props 默认值行为
  /** watch 数组时，数组原地变更也触发未声明 deep 的 watcher。 */
  WATCH_ARRAY = 'WATCH_ARRAY',
  /** prop 默认值工厂把组件实例绑定为 `this`。 */
  PROPS_DEFAULT_THIS = 'PROPS_DEFAULT_THIS',

  // 模板事件与自定义指令
  /** `v-on` 支持数字 keyCode 和 `config.keyCodes` 修饰符。 */
  V_ON_KEYCODE_MODIFIER = 'V_ON_KEYCODE_MODIFIER',
  /** 把 Vue 2 自定义指令钩子映射到 Vue 3 钩子。 */
  CUSTOM_DIR = 'CUSTOM_DIR',

  // DOM attribute 强制转换规则
  /** 非布尔 attribute 的 `false` 值会移除 attribute。 */
  ATTR_FALSE_VALUE = 'ATTR_FALSE_VALUE',
  /** `contenteditable` 等枚举 attribute 按 Vue 2 规则转字符串。 */
  ATTR_ENUMERATED_COERCION = 'ATTR_ENUMERATED_COERCION',

  // Transition/TransitionGroup 历史行为
  /** 同时支持 `v-enter` 等 Vue 2 过渡 class 名。 */
  TRANSITION_CLASSES = 'TRANSITION_CLASSES',
  /** TransitionGroup 默认渲染一个包裹根元素。 */
  TRANSITION_GROUP_ROOT = 'TRANSITION_GROUP_ROOT',

  // 组件声明与 v-model 协议
  /** 使用返回 Promise/解析回调的 Vue 2 异步组件工厂。 */
  COMPONENT_ASYNC = 'COMPONENT_ASYNC',
  /** 组件选项中的 `functional: true` 声明。 */
  COMPONENT_FUNCTIONAL = 'COMPONENT_FUNCTIONAL',
  /** 组件使用 `value` prop、`input` 事件及 `model` 选项的旧 v-model 协议。 */
  COMPONENT_V_MODEL = 'COMPONENT_V_MODEL',

  // Vue 2 render(h)、过滤器与内部私有 API
  /** render 函数接收 `h` 参数，并使用 Vue 2 VNode data 结构。 */
  RENDER_FUNCTION = 'RENDER_FUNCTION',

  /** 模板和 Options API 中的过滤器能力。 */
  FILTERS = 'FILTERS',

  /** 为迁移构建临时保留、应用代码不应依赖的 Vue 2 私有 API。 */
  PRIVATE_APIS = 'PRIVATE_APIS',
}

/** 单项弃用警告的消息生成器和可选迁移文档地址。 */
type DeprecationData = {
  message: string | ((...args: any[]) => string)
  link?: string
}

/**
 * 所有兼容特性的迁移说明表。
 * 消息保留英文是因为它们会直接输出到 Vue 运行时控制台；函数形式用于把组件名、
 * attribute 值等现场信息插入提示。代码阅读时可通过同名 DeprecationTypes 对照调用点。
 */
export const deprecationData: Record<DeprecationTypes, DeprecationData> = {
  [DeprecationTypes.GLOBAL_MOUNT]: {
    message:
      `The global app bootstrapping API has changed: vm.$mount() and the "el" ` +
      `option have been removed. Use createApp(RootComponent).mount() instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/global-api.html#mounting-app-instance`,
  },

  [DeprecationTypes.GLOBAL_MOUNT_CONTAINER]: {
    message:
      `Vue detected directives on the mount container. ` +
      `In Vue 3, the container is no longer considered part of the template ` +
      `and will not be processed/replaced.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/mount-changes.html`,
  },

  [DeprecationTypes.GLOBAL_EXTEND]: {
    message:
      `Vue.extend() has been removed in Vue 3. ` +
      `Use defineComponent() instead.`,
    link: `https://vuejs.org/api/general.html#definecomponent`,
  },

  [DeprecationTypes.GLOBAL_PROTOTYPE]: {
    message:
      `Vue.prototype is no longer available in Vue 3. ` +
      `Use app.config.globalProperties instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/global-api.html#vue-prototype-replaced-by-config-globalproperties`,
  },

  [DeprecationTypes.GLOBAL_SET]: {
    message:
      `Vue.set() has been removed as it is no longer needed in Vue 3. ` +
      `Simply use native JavaScript mutations.`,
  },

  [DeprecationTypes.GLOBAL_DELETE]: {
    message:
      `Vue.delete() has been removed as it is no longer needed in Vue 3. ` +
      `Simply use native JavaScript mutations.`,
  },

  [DeprecationTypes.GLOBAL_OBSERVABLE]: {
    message:
      `Vue.observable() has been removed. ` +
      `Use \`import { reactive } from "vue"\` from Composition API instead.`,
    link: `https://vuejs.org/api/reactivity-core.html#reactive`,
  },

  [DeprecationTypes.GLOBAL_PRIVATE_UTIL]: {
    message:
      `Vue.util has been removed. Please refactor to avoid its usage ` +
      `since it was an internal API even in Vue 2.`,
  },

  [DeprecationTypes.CONFIG_SILENT]: {
    message:
      `config.silent has been removed because it is not good practice to ` +
      `intentionally suppress warnings. You can use your browser console's ` +
      `filter features to focus on relevant messages.`,
  },

  [DeprecationTypes.CONFIG_DEVTOOLS]: {
    message:
      `config.devtools has been removed. To enable devtools for ` +
      `production, configure the __VUE_PROD_DEVTOOLS__ compile-time flag.`,
    link: `https://github.com/vuejs/core/tree/main/packages/vue#bundler-build-feature-flags`,
  },

  [DeprecationTypes.CONFIG_KEY_CODES]: {
    message:
      `config.keyCodes has been removed. ` +
      `In Vue 3, you can directly use the kebab-case key names as v-on modifiers.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/keycode-modifiers.html`,
  },

  [DeprecationTypes.CONFIG_PRODUCTION_TIP]: {
    message: `config.productionTip has been removed.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/global-api.html#config-productiontip-removed`,
  },

  [DeprecationTypes.CONFIG_IGNORED_ELEMENTS]: {
    message: () => {
      let msg = `config.ignoredElements has been removed.`
      if (isRuntimeOnly()) {
        msg += ` Pass the "isCustomElement" option to @vue/compiler-dom instead.`
      } else {
        msg += ` Use config.isCustomElement instead.`
      }
      return msg
    },
    link: `https://v3-migration.vuejs.org/breaking-changes/global-api.html#config-ignoredelements-is-now-config-iscustomelement`,
  },

  [DeprecationTypes.CONFIG_WHITESPACE]: {
    // 只有完整版运行时编译模板才涉及 whitespace 默认值，因此警告放在运行时兼容表。
    message:
      `Vue 3 compiler's whitespace option will default to "condense" instead of ` +
      `"preserve". To suppress this warning, provide an explicit value for ` +
      `\`config.compilerOptions.whitespace\`.`,
  },

  [DeprecationTypes.CONFIG_OPTION_MERGE_STRATS]: {
    message:
      `config.optionMergeStrategies no longer exposes internal strategies. ` +
      `Use custom merge functions instead.`,
  },

  [DeprecationTypes.INSTANCE_SET]: {
    message:
      `vm.$set() has been removed as it is no longer needed in Vue 3. ` +
      `Simply use native JavaScript mutations.`,
  },

  [DeprecationTypes.INSTANCE_DELETE]: {
    message:
      `vm.$delete() has been removed as it is no longer needed in Vue 3. ` +
      `Simply use native JavaScript mutations.`,
  },

  [DeprecationTypes.INSTANCE_DESTROY]: {
    message: `vm.$destroy() has been removed. Use app.unmount() instead.`,
    link: `https://vuejs.org/api/application.html#app-unmount`,
  },

  [DeprecationTypes.INSTANCE_EVENT_EMITTER]: {
    message:
      `vm.$on/$once/$off() have been removed. ` +
      `Use an external event emitter library instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/events-api.html`,
  },

  [DeprecationTypes.INSTANCE_EVENT_HOOKS]: {
    message: event =>
      `"${event}" lifecycle events are no longer supported. From templates, ` +
      `use the "vue:" prefix instead of "hook:". For example, @${event} ` +
      `should be changed to @vue:${event.slice(5)}. ` +
      `From JavaScript, use Composition API to dynamically register lifecycle ` +
      `hooks.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/vnode-lifecycle-events.html`,
  },

  [DeprecationTypes.INSTANCE_CHILDREN]: {
    message:
      `vm.$children has been removed. Consider refactoring your logic ` +
      `to avoid relying on direct access to child components.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/children.html`,
  },

  [DeprecationTypes.INSTANCE_LISTENERS]: {
    message:
      `vm.$listeners has been removed. In Vue 3, parent v-on listeners are ` +
      `included in vm.$attrs and it is no longer necessary to separately use ` +
      `v-on="$listeners" if you are already using v-bind="$attrs". ` +
      `(Note: the Vue 3 behavior only applies if this compat config is disabled)`,
    link: `https://v3-migration.vuejs.org/breaking-changes/listeners-removed.html`,
  },

  [DeprecationTypes.INSTANCE_SCOPED_SLOTS]: {
    message: `vm.$scopedSlots has been removed. Use vm.$slots instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/slots-unification.html`,
  },

  [DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE]: {
    message: componentName =>
      `Component <${
        componentName || 'Anonymous'
      }> has \`inheritAttrs: false\` but is ` +
      `relying on class/style fallthrough from parent. In Vue 3, class/style ` +
      `are now included in $attrs and will no longer fallthrough when ` +
      `inheritAttrs is false. If you are already using v-bind="$attrs" on ` +
      `component root it should render the same end result. ` +
      `If you are binding $attrs to a non-root element and expecting ` +
      `class/style to fallthrough on root, you will need to now manually bind ` +
      `them on root via :class="$attrs.class".`,
    link: `https://v3-migration.vuejs.org/breaking-changes/attrs-includes-class-style.html`,
  },

  [DeprecationTypes.OPTIONS_DATA_FN]: {
    message:
      `The "data" option can no longer be a plain object. ` +
      `Always use a function.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/data-option.html`,
  },

  [DeprecationTypes.OPTIONS_DATA_MERGE]: {
    message: (key: string) =>
      `Detected conflicting key "${key}" when merging data option values. ` +
      `In Vue 3, data keys are merged shallowly and will override one another.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/data-option.html#mixin-merge-behavior-change`,
  },

  [DeprecationTypes.OPTIONS_BEFORE_DESTROY]: {
    message: `\`beforeDestroy\` has been renamed to \`beforeUnmount\`.`,
  },

  [DeprecationTypes.OPTIONS_DESTROYED]: {
    message: `\`destroyed\` has been renamed to \`unmounted\`.`,
  },

  [DeprecationTypes.WATCH_ARRAY]: {
    message:
      `"watch" option or vm.$watch on an array value will no longer ` +
      `trigger on array mutation unless the "deep" option is specified. ` +
      `If current usage is intended, you can disable the compat behavior and ` +
      `suppress this warning with:` +
      `\n\n  configureCompat({ ${DeprecationTypes.WATCH_ARRAY}: false })\n`,
    link: `https://v3-migration.vuejs.org/breaking-changes/watch.html`,
  },

  [DeprecationTypes.PROPS_DEFAULT_THIS]: {
    message: (key: string) =>
      `props default value function no longer has access to "this". The compat ` +
      `build only offers access to this.$options.` +
      `(found in prop "${key}")`,
    link: `https://v3-migration.vuejs.org/breaking-changes/props-default-this.html`,
  },

  [DeprecationTypes.CUSTOM_DIR]: {
    message: (legacyHook: string, newHook: string) =>
      `Custom directive hook "${legacyHook}" has been removed. ` +
      `Use "${newHook}" instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/custom-directives.html`,
  },

  [DeprecationTypes.V_ON_KEYCODE_MODIFIER]: {
    message:
      `Using keyCode as v-on modifier is no longer supported. ` +
      `Use kebab-case key name modifiers instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/keycode-modifiers.html`,
  },

  [DeprecationTypes.ATTR_FALSE_VALUE]: {
    message: (name: string) =>
      `Attribute "${name}" with v-bind value \`false\` will render ` +
      `${name}="false" instead of removing it in Vue 3. To remove the attribute, ` +
      `use \`null\` or \`undefined\` instead. If the usage is intended, ` +
      `you can disable the compat behavior and suppress this warning with:` +
      `\n\n  configureCompat({ ${DeprecationTypes.ATTR_FALSE_VALUE}: false })\n`,
    link: `https://v3-migration.vuejs.org/breaking-changes/attribute-coercion.html`,
  },

  [DeprecationTypes.ATTR_ENUMERATED_COERCION]: {
    message: (name: string, value: any, coerced: string) =>
      `Enumerated attribute "${name}" with v-bind value \`${value}\` will ` +
      `${
        value === null ? `be removed` : `render the value as-is`
      } instead of coercing the value to "${coerced}" in Vue 3. ` +
      `Always use explicit "true" or "false" values for enumerated attributes. ` +
      `If the usage is intended, ` +
      `you can disable the compat behavior and suppress this warning with:` +
      `\n\n  configureCompat({ ${DeprecationTypes.ATTR_ENUMERATED_COERCION}: false })\n`,
    link: `https://v3-migration.vuejs.org/breaking-changes/attribute-coercion.html`,
  },

  [DeprecationTypes.TRANSITION_CLASSES]: {
    // class 名变化无法在运行时可靠检测，仅保留开关供 transition 实现查询。
    message: ``,
  },

  [DeprecationTypes.TRANSITION_GROUP_ROOT]: {
    message:
      `<TransitionGroup> no longer renders a root <span> element by ` +
      `default if no "tag" prop is specified. If you do not rely on the span ` +
      `for styling, you can disable the compat behavior and suppress this ` +
      `warning with:` +
      `\n\n  configureCompat({ ${DeprecationTypes.TRANSITION_GROUP_ROOT}: false })\n`,
    link: `https://v3-migration.vuejs.org/breaking-changes/transition-group.html`,
  },

  [DeprecationTypes.COMPONENT_ASYNC]: {
    message: (comp: any) => {
      const name = getComponentName(comp)
      return (
        `Async component${
          name ? ` <${name}>` : `s`
        } should be explicitly created via \`defineAsyncComponent()\` ` +
        `in Vue 3. Plain functions will be treated as functional components in ` +
        `non-compat build. If you have already migrated all async component ` +
        `usage and intend to use plain functions for functional components, ` +
        `you can disable the compat behavior and suppress this ` +
        `warning with:` +
        `\n\n  configureCompat({ ${DeprecationTypes.COMPONENT_ASYNC}: false })\n`
      )
    },
    link: `https://v3-migration.vuejs.org/breaking-changes/async-components.html`,
  },

  [DeprecationTypes.COMPONENT_FUNCTIONAL]: {
    message: (comp: any) => {
      const name = getComponentName(comp)
      return (
        `Functional component${
          name ? ` <${name}>` : `s`
        } should be defined as a plain function in Vue 3. The "functional" ` +
        `option has been removed. NOTE: Before migrating to use plain ` +
        `functions for functional components, first make sure that all async ` +
        `components usage have been migrated and its compat behavior has ` +
        `been disabled.`
      )
    },
    link: `https://v3-migration.vuejs.org/breaking-changes/functional-components.html`,
  },

  [DeprecationTypes.COMPONENT_V_MODEL]: {
    message: (comp: ComponentOptions) => {
      const configMsg =
        `opt-in to ` +
        `Vue 3 behavior on a per-component basis with \`compatConfig: { ${DeprecationTypes.COMPONENT_V_MODEL}: false }\`.`
      if (
        comp.props &&
        (isArray(comp.props)
          ? comp.props.includes('modelValue')
          : hasOwn(comp.props, 'modelValue'))
      ) {
        return (
          `Component declares "modelValue" prop, which is Vue 3 usage, but ` +
          `is running under Vue 2 compat v-model behavior. You can ${configMsg}`
        )
      }
      return (
        `v-model usage on component has changed in Vue 3. Component that expects ` +
        `to work with v-model should now use the "modelValue" prop and emit the ` +
        `"update:modelValue" event. You can update the usage and then ${configMsg}`
      )
    },
    link: `https://v3-migration.vuejs.org/breaking-changes/v-model.html`,
  },

  [DeprecationTypes.RENDER_FUNCTION]: {
    message:
      `Vue 3's render function API has changed. ` +
      `You can opt-in to the new API with:` +
      `\n\n  configureCompat({ ${DeprecationTypes.RENDER_FUNCTION}: false })\n` +
      `\n  (This can also be done per-component via the "compatConfig" option.)`,
    link: `https://v3-migration.vuejs.org/breaking-changes/render-function-api.html`,
  },

  [DeprecationTypes.FILTERS]: {
    message:
      `filters have been removed in Vue 3. ` +
      `The "|" symbol will be treated as native JavaScript bitwise OR operator. ` +
      `Use method calls or computed properties instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/filters.html`,
  },

  [DeprecationTypes.PRIVATE_APIS]: {
    message: name =>
      `"${name}" is a Vue 2 private API that no longer exists in Vue 3. ` +
      `If you are seeing this warning only due to a dependency, you can ` +
      `suppress this warning via { PRIVATE_APIS: 'suppress-warning' }.`,
  },
}

/** 已针对“特性+参数+组件”输出过完整警告的集合，避免同组件重复刷屏。 */
const instanceWarned: Record<string, true> = Object.create(null)
/** 同一警告跨不同组件出现的次数；后续只输出短计数。 */
const warnCount: Record<string, number> = Object.create(null)

/** 仅测试使用的总警告开关。 */
let warningEnabled = true

/** 测试中临时启停弃用警告，不改变兼容行为本身。 */
export function toggleDeprecationWarning(flag: boolean): void {
  warningEnabled = flag
}

/**
 * 输出一次去重后的弃用警告。
 * 优先遵守 `suppress-warning`；同组件同参数只输出一次，同警告出现在其他组件时只
 * 增加计数。若兼容行为已关闭但旧用法仍执行，再追加错误提示说明可能运行失败。
 */
export function warnDeprecation(
  key: DeprecationTypes,
  instance: ComponentInternalInstance | null,
  ...args: any[]
): void {
  if (!__DEV__) {
    return
  }
  if (__TEST__ && !warningEnabled) {
    return
  }

  instance = instance || getCurrentInstance()

  // suppress-warning 保留 Vue 2 行为但静默迁移提示。
  const config = getCompatConfigForKey(key, instance)
  if (config === 'suppress-warning') {
    return
  }

  const dupKey = key + args.join('')
  let compId: string | number | null =
    instance && formatComponentName(instance, instance.type)
  if (compId === 'Anonymous' && instance) {
    compId = instance.uid
  }

  // 相同特性、参数和组件只发一次；匿名组件用 uid 区分实例。
  const componentDupKey = dupKey + compId
  if (!__TEST__ && componentDupKey in instanceWarned) {
    return
  }
  instanceWarned[componentDupKey] = true

  // 同一警告已在其他组件完整展示过，后续仅显示 key 和累计次数，减少控制台噪音。
  if (!__TEST__ && dupKey in warnCount) {
    warn(`(deprecation ${key}) (${++warnCount[dupKey] + 1})`)
    return
  }

  warnCount[dupKey] = 0

  const { message, link } = deprecationData[key]
  warn(
    `(deprecation ${key}) ${
      typeof message === 'function' ? message(...args) : message
    }${link ? `\n  Details: ${link}` : ``}`,
  )
  if (!isCompatEnabled(key, instance, true)) {
    console.error(
      `^ The above deprecation's compat behavior is disabled and will likely ` +
        `lead to runtime errors.`,
    )
  }
}

/**
 * 兼容模式配置。
 * `MODE:2` 默认开启所有未显式关闭的旧行为；`MODE:3` 默认关闭，仅显式 true 的启用；
 * 函数 MODE 可按组件逐步迁移。`suppress-warning` 等同启用行为但不显示弃用警告。
 */
export type CompatConfig = Partial<
  Record<DeprecationTypes, boolean | 'suppress-warning'>
> & {
  MODE?: 2 | 3 | ((comp: Component | null) => 2 | 3)
}

/** 全局兼容配置，迁移构建默认模拟 Vue 2。 */
export const globalCompatConfig: CompatConfig = {
  MODE: 2,
}

/** 合并全局兼容开关；开发环境先检查无效键和错误配置位置。 */
export function configureCompat(config: CompatConfig): void {
  if (__DEV__) {
    validateCompatConfig(config)
  }
  extend(globalCompatConfig, config)
}

/** 已校验过的配置对象；WeakSet 避免重复校验且不阻止组件定义回收。 */
const seenConfigObjects = /*@__PURE__*/ new WeakSet<CompatConfig>()
/** 已提示的非法 key，跨组件只提示一次。 */
const warnedInvalidKeys: Record<string, boolean> = {}

/** 开发环境校验 compatConfig 键，并提示编译器专属配置放错位置。 */
export function validateCompatConfig(
  config: CompatConfig,
  instance?: ComponentInternalInstance,
): void {
  if (seenConfigObjects.has(config)) {
    return
  }
  seenConfigObjects.add(config)

  for (const key of Object.keys(config)) {
    if (
      key !== 'MODE' &&
      !(key in deprecationData) &&
      !(key in warnedInvalidKeys)
    ) {
      if (key.startsWith('COMPILER_')) {
        if (isRuntimeOnly()) {
          warn(
            `Deprecation config "${key}" is compiler-specific and you are ` +
              `running a runtime-only build of Vue. This deprecation should be ` +
              `configured via compiler options in your build setup instead.\n` +
              `Details: https://v3-migration.vuejs.org/breaking-changes/migration-build.html`,
          )
        }
      } else {
        warn(`Invalid deprecation config "${key}".`)
      }
      warnedInvalidKeys[key] = true
    }
  }

  if (instance && config[DeprecationTypes.OPTIONS_DATA_MERGE] != null) {
    warn(
      `Deprecation config "${DeprecationTypes.OPTIONS_DATA_MERGE}" can only be configured globally.`,
    )
  }
}

/**
 * 读取某个兼容键：组件 `compatConfig` 的自有配置优先，否则回退全局配置。
 */
export function getCompatConfigForKey(
  key: DeprecationTypes | 'MODE',
  instance: ComponentInternalInstance | null,
): CompatConfig[DeprecationTypes | 'MODE'] {
  const instanceConfig =
    instance && (instance.type as ComponentOptions).compatConfig
  if (instanceConfig && key in instanceConfig) {
    return instanceConfig[key]
  }
  return globalCompatConfig[key]
}

/**
 * 根据 MODE 与单项值判断旧行为是否启用。
 * 内置组件默认跳过兼容逻辑，避免 Vue 自己的实现被旧规则改写；少数警告检查可通过
 * `enableForBuiltIn` 明确覆盖。
 */
export function isCompatEnabled(
  key: DeprecationTypes,
  instance: ComponentInternalInstance | null,
  enableForBuiltIn = false,
): boolean {
  // 内置组件属于 Vue 3 实现，不应用面向用户组件的 Vue 2 转换。
  if (!enableForBuiltIn && instance && instance.type.__isBuiltIn) {
    return false
  }

  const rawMode = getCompatConfigForKey('MODE', instance) || 2
  const val = getCompatConfigForKey(key, instance)

  const mode = isFunction(rawMode)
    ? rawMode(instance && instance.type)
    : rawMode

  if (mode === 2) {
    return val !== false
  } else {
    return val === true || val === 'suppress-warning'
  }
}

/**
 * 用于非兼容构建中已彻底移除的 API。关闭时直接抛错；开启时执行并发出弃用警告。
 */
export function assertCompatEnabled(
  key: DeprecationTypes,
  instance: ComponentInternalInstance | null,
  ...args: any[]
): void {
  if (!isCompatEnabled(key, instance)) {
    throw new Error(`${key} compat has been disabled.`)
  } else if (__DEV__) {
    warnDeprecation(key, instance, ...args)
  }
}

/**
 * 用于语法仍能被识别、但关闭兼容后很可能运行错误的旧用法。无论是否启用都警告，
 * 并把开关结果返回调用方决定是否转换。
 */
export function softAssertCompatEnabled(
  key: DeprecationTypes,
  instance: ComponentInternalInstance | null,
  ...args: any[]
): boolean {
  if (__DEV__) {
    warnDeprecation(key, instance, ...args)
  }
  return isCompatEnabled(key, instance)
}

/**
 * 用于 Vue 2/3 语法相同但行为互斥的特性（如 render 函数）。仅实际采用 Vue 2 行为
 * 时警告；关闭后让 Vue 3 主路径自然执行。
 */
export function checkCompatEnabled(
  key: DeprecationTypes,
  instance: ComponentInternalInstance | null,
  ...args: any[]
): boolean {
  const enabled = isCompatEnabled(key, instance)
  if (__DEV__ && enabled) {
    warnDeprecation(key, instance, ...args)
  }
  return enabled
}

// 测试默认运行 Vue 3 模式，每个兼容用例再显式开启目标特性，避免测试互相依赖。
if (__TEST__) {
  configureCompat({
    MODE: 3,
  })
}
