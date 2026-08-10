import type { NodeTransform, TransformContext } from '../transform'
import {
  type ArrayExpression,
  type CallExpression,
  type ComponentNode,
  ConstantTypes,
  type DirectiveArguments,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type ExpressionNode,
  type JSChildNode,
  NodeTypes,
  type ObjectExpression,
  type Property,
  type TemplateTextChildNode,
  type VNodeCall,
  createArrayExpression,
  createCallExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  createVNodeCall,
} from '../ast'
import {
  PatchFlags,
  camelize,
  capitalize,
  isBuiltInDirective,
  isObject,
  isOn,
  isReservedProp,
  isSymbol,
} from '@vue/shared'
import { ErrorCodes, createCompilerError } from '../errors'
import {
  GUARD_REACTIVE_PROPS,
  KEEP_ALIVE,
  MERGE_PROPS,
  NORMALIZE_CLASS,
  NORMALIZE_PROPS,
  NORMALIZE_STYLE,
  RESOLVE_COMPONENT,
  RESOLVE_DIRECTIVE,
  RESOLVE_DYNAMIC_COMPONENT,
  SUSPENSE,
  TELEPORT,
  TO_HANDLERS,
  UNREF,
} from '../runtimeHelpers'
import {
  findProp,
  isCoreComponent,
  isStaticArgOf,
  isStaticExp,
  toValidAssetId,
} from '../utils'
import { buildSlots } from './vSlot'
import { getConstantType } from './cacheStatic'
import { BindingTypes } from '../options'
import {
  CompilerDeprecationTypes,
  checkCompatEnabled,
  isCompatEnabled,
} from '../compat/compatConfig'
import { processExpression } from './transformExpression'

/**
 * 指令节点到内置运行时实现 Symbol 的映射。
 * v-model 等指令转换可直接返回 helper，代码生成时应导入它，而非调用 resolveDirective。
 */
const directiveImportMap = new WeakMap<DirectiveNode, symbol>()

/**
 * 为原生元素和组件建立最终 VNodeCall。
 *
 * 进入阶段不做事，退出阶段等 children、表达式和结构指令全部转换完，再解析组件类型、
 * 构造 props/slots、分析 patchFlag 和 block 要求。结果挂到 ElementNode.codegenNode，
 * 后续代码生成器无需重新理解模板语义。
 */
export const transformElement: NodeTransform = (node, context) => {
  // 必须在退出阶段执行，才能读取子节点已经生成的 codegenNode 与动态插槽信息。
  return function postTransformElement() {
    node = context.currentNode!

    if (!(
      node.type === NodeTypes.ELEMENT &&
      (node.tagType === ElementTypes.ELEMENT ||
        node.tagType === ElementTypes.COMPONENT)
    )) {
      return
    }

    const { tag, props } = node
    const isComponent = node.tagType === ElementTypes.COMPONENT

    // 组件 tag 可能是 helper、setup 绑定或 resolveComponent 局部变量；原生标签直接用字符串。
    let vnodeTag = isComponent
      ? resolveComponentType(node as ComponentNode, context)
      : `"${tag}"`

    const isDynamicComponent =
      isObject(vnodeTag) && vnodeTag.callee === RESOLVE_DYNAMIC_COMPONENT

    let vnodeProps: VNodeCall['props']
    let vnodeChildren: VNodeCall['children']
    let patchFlag: VNodeCall['patchFlag'] | 0 = 0
    let vnodeDynamicProps: VNodeCall['dynamicProps']
    let dynamicPropNames: string[] | undefined
    let vnodeDirectives: VNodeCall['directives']
    let needsPatch = false
    let isBlockRequired = false

    let shouldUseBlock =
      // 动态组件可能在不同渲染间解析成组件或原生元素，需要 block 维护正确更新边界。
      isDynamicComponent ||
      vnodeTag === TELEPORT ||
      vnodeTag === SUSPENSE ||
      (!isComponent &&
        // #639/#643：svg/foreignObject/math 强制为 block，让内部动态后代更新时携带正确命名空间；
        // 否则 SVG class 等属性可能走 HTML patch 分支报错。逻辑虽偏 DOM，拆到平台层会使
        // core/block 分工显著复杂，因此保留在这里。
        (tag === 'svg' || tag === 'foreignObject' || tag === 'math'))

    // 构建 props、运行时指令与 patch 元数据。
    if (props.length > 0) {
      const propsBuildResult = buildProps(
        node,
        context,
        undefined,
        isComponent,
        isDynamicComponent,
      )
      vnodeProps = propsBuildResult.props
      patchFlag = propsBuildResult.patchFlag
      dynamicPropNames = propsBuildResult.dynamicPropNames
      needsPatch = propsBuildResult.needsPatch
      isBlockRequired = propsBuildResult.isBlockRequired
      const directives = propsBuildResult.directives
      vnodeDirectives =
        directives && directives.length
          ? (createArrayExpression(
              directives.map(dir => buildDirectiveArgs(dir, context)),
            ) as DirectiveArguments)
          : undefined

      if (propsBuildResult.shouldUseBlock) {
        shouldUseBlock = true
      }
    }

    // 组件通常把 children 编译成 slots；原生/Teleport/KeepAlive 保留原始 children 形态。
    if (node.children.length > 0) {
      if (vnodeTag === KEEP_ALIVE) {
        // KeepAlive 虽是内置组件，却保留 raw children，才能嵌在 Transition 等包装组件中。
        // 它必须独立成为 block，防止 raw children 被父 block 收集。
        shouldUseBlock = true
        // raw children 不走普通 slots 稳定性分析，所以强制每轮更新 KeepAlive。
        patchFlag |= PatchFlags.DYNAMIC_SLOTS
        if (__DEV__ && node.children.length > 1) {
          context.onError(
            createCompilerError(ErrorCodes.X_KEEP_ALIVE_INVALID_CHILDREN, {
              start: node.children[0].loc.start,
              end: node.children[node.children.length - 1].loc.end,
              source: '',
            }),
          )
        }
      }

      const shouldBuildAsSlots =
        isComponent &&
        // Teleport 不是普通组件，runtime 直接管理真实 children。
        vnodeTag !== TELEPORT &&
        // KeepAlive 原因见上方说明。
        vnodeTag !== KEEP_ALIVE

      if (shouldBuildAsSlots) {
        const { slots, hasDynamicSlots } = buildSlots(node, context)
        vnodeChildren = slots
        if (hasDynamicSlots) {
          patchFlag |= PatchFlags.DYNAMIC_SLOTS
        }
      } else if (node.children.length === 1 && vnodeTag !== TELEPORT) {
        const child = node.children[0]
        const type = child.type
        // 单动态文本加 TEXT 标记，renderer 可只更新 textContent。
        const hasDynamicTextChild =
          type === NodeTypes.INTERPOLATION ||
          type === NodeTypes.COMPOUND_EXPRESSION
        if (
          hasDynamicTextChild &&
          getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
        ) {
          patchFlag |= PatchFlags.TEXT
        }
        // 单文本/插值直接传节点，不生成 children 数组，减少运行时归一化。
        if (hasDynamicTextChild || type === NodeTypes.TEXT) {
          vnodeChildren = child as TemplateTextChildNode
        } else {
          vnodeChildren = node.children
        }
      } else {
        vnodeChildren = node.children
      }
    }

    // PROPS patchFlag 还需要精确动态 prop 名单，运行时只遍历这些键。
    if (dynamicPropNames && dynamicPropNames.length) {
      vnodeDynamicProps = stringifyDynamicPropNames(dynamicPropNames)
    }

    const vnodeCall = (node.codegenNode = createVNodeCall(
      context,
      vnodeTag,
      vnodeProps,
      vnodeChildren,
      patchFlag === 0 ? undefined : patchFlag,
      vnodeDynamicProps,
      vnodeDirectives,
      !!shouldUseBlock,
      false /* 正常收集动态后代 */,
      isComponent,
      node.loc,
    ))
    needsPatch =
      needsPatch && (patchFlag === 0 || patchFlag === PatchFlags.NEED_HYDRATION)
    if (needsPatch) {
      vnodeCall.needsPatch = true
    }
    if (isBlockRequired) {
      vnodeCall.isBlockRequired = true
    }
  }
}

/**
 * 解析组件标签最终在生成代码中的表达式。
 * 优先级：动态 component/is → 内置组件 → script setup 绑定 → 文件名自引用 → resolveComponent。
 */
export function resolveComponentType(
  node: ComponentNode,
  context: TransformContext,
  ssr = false,
): string | symbol | CallExpression {
  let { tag } = node

  // 1. `<component :is>` 或兼容模式原生元素 is：生成 resolveDynamicComponent。
  const isExplicitDynamic = isComponentTag(tag)
  const isProp = findProp(node, 'is', false, true /* allow empty */)
  if (isProp) {
    if (
      isExplicitDynamic ||
      (__COMPAT__ &&
        isCompatEnabled(
          CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
          context,
        ))
    ) {
      let exp: ExpressionNode | undefined
      if (isProp.type === NodeTypes.ATTRIBUTE) {
        exp = isProp.value && createSimpleExpression(isProp.value.content, true)
      } else {
        exp = isProp.exp
        if (!exp) {
          // 修复 #10469：`<component :is>` 是 `<component :is="is">` 同名简写；
          // 没有显式 exp 时补建 is 读取表达式，否则会错误解析名为 component 的静态组件。
          exp = createSimpleExpression(`is`, false, isProp.arg!.loc)
          if (!__BROWSER__) {
            exp = isProp.exp = processExpression(exp, context)
          }
        }
      }
      if (exp) {
        return createCallExpression(context.helper(RESOLVE_DYNAMIC_COMPONENT), [
          exp,
        ])
      }
    } else if (
      isProp.type === NodeTypes.ATTRIBUTE &&
      isProp.value!.content.startsWith('vue:')
    ) {
      // Vue 3 仅把原生标签上的 `is="vue:xxx"` 视为组件转换；普通 is 保留给原生 custom element。
      // 兼容模式例外：沿用 Vue 2，所有 is 值都可触发组件解析。
      tag = isProp.value!.content.slice(4)
    }
  }

  // 2. Teleport、Transition、KeepAlive、Suspense 等内置组件直接使用 helper Symbol。
  const builtIn = isCoreComponent(tag) || context.isBuiltInComponent(tag)
  if (builtIn) {
    // SSR 对内置组件有专用转换或透传，不需要导入客户端运行时实现。
    if (!ssr) context.helper(builtIn)
    return builtIn
  }

  // 3. Node 构建可用 script setup bindingMetadata 直接引用导入/局部组件，省去运行时 resolve。
  if (!__BROWSER__) {
    const fromSetup = resolveSetupReference(tag, context)
    if (fromSetup) {
      return fromSetup
    }
    const dotIndex = tag.indexOf('.')
    if (dotIndex > 0) {
      const ns = resolveSetupReference(tag.slice(0, dotIndex), context)
      if (ns) {
        return ns + tag.slice(dotIndex)
      }
    }
  }

  // 4. 标签与 SFC 文件名同名时允许隐式自递归，即使 setup 未显式导入自身。
  if (
    !__BROWSER__ &&
    context.selfName &&
    capitalize(camelize(tag)) === context.selfName
  ) {
    context.helper(RESOLVE_COMPONENT)
    // `__self` 是内部后缀；codegen 去掉它并向 resolveComponent 传 maybeSelfReference=true。
    context.components.add(tag + `__self`)
    return toValidAssetId(tag, `component`)
  }

  // 5. 其余用户组件登记名称，在 render 顶部调用 resolveComponent。
  context.helper(RESOLVE_COMPONENT)
  context.components.add(tag)
  return toValidAssetId(tag, `component`)
}

/**
 * 从 script setup 绑定中解析组件/指令引用，同时兼容 kebab、camelCase、PascalCase 名称。
 * inline 模式直接访问局部变量；非 inline 模式从 `$setup` / `$props` 参数读取。
 */
function resolveSetupReference(name: string, context: TransformContext) {
  const bindings = context.bindingMetadata
  if (!bindings || bindings.__isScriptSetup === false) {
    return
  }

  const camelName = camelize(name)
  const PascalName = capitalize(camelName)
  /** 按原名、camelCase、PascalCase 顺序查找指定绑定类型。 */
  const checkType = (type: BindingTypes) => {
    if (bindings[name] === type) {
      return name
    }
    if (bindings[camelName] === type) {
      return camelName
    }
    if (bindings[PascalName] === type) {
      return PascalName
    }
  }

  const fromConst =
    checkType(BindingTypes.SETUP_CONST) ||
    checkType(BindingTypes.SETUP_REACTIVE_CONST) ||
    checkType(BindingTypes.LITERAL_CONST)
  if (fromConst) {
    return context.inline
      ? // import 等 const 绑定可直接作为组件类型。
        fromConst
      : `$setup[${JSON.stringify(fromConst)}]`
  }

  const fromMaybeRef =
    checkType(BindingTypes.SETUP_LET) ||
    checkType(BindingTypes.SETUP_REF) ||
    checkType(BindingTypes.SETUP_MAYBE_REF)
  if (fromMaybeRef) {
    return context.inline
      ? // 动态组件变量可能是 ref，先 unref 再作为 VNode type。
        `${context.helperString(UNREF)}(${fromMaybeRef})`
      : `$setup[${JSON.stringify(fromMaybeRef)}]`
  }

  const fromProps = checkType(BindingTypes.PROPS)
  if (fromProps) {
    return `${context.helperString(UNREF)}(${
      context.inline ? '__props' : '$props'
    }[${JSON.stringify(fromProps)}])`
  }
}

/** VNode props 的三种最终形态：对象、helper 调用或整体 v-bind 表达式。 */
export type PropsExpression = ObjectExpression | CallExpression | ExpressionNode

/**
 * 把元素属性/指令编译成 props 表达式，并分析运行时最小 patch 范围。
 *
 * 静态/具名绑定先聚合为对象；无参数 v-bind/v-on 切断对象片段并形成 mergeProps 参数。
 * 返回值同时携带运行时自定义指令、patchFlag、动态键名单和必须成为 block 的约束。
 */
export function buildProps(
  node: ElementNode,
  context: TransformContext,
  props: ElementNode['props'] | undefined = node.props,
  isComponent: boolean,
  isDynamicComponent: boolean,
  ssr = false,
): {
  /** 合并后的 props 对象、helper 调用或提升引用。 */
  props: PropsExpression | undefined
  /** 仍需在运行时执行的自定义指令。 */
  directives: DirectiveNode[]
  /** 根据动态 class/style/props 等信息计算的 patch 位掩码。 */
  patchFlag: number
  /** `PROPS` patch 标志对应的动态属性名。 */
  dynamicPropNames: string[]
  /** 当前语义是否建议使用 block 以追踪动态子节点。 */
  shouldUseBlock: boolean
  /** 即使没有普通动态 props，也必须让运行时 patch 当前 VNode。 */
  needsPatch: boolean
  /** 后续优化不得把该节点从 block 降级。 */
  isBlockRequired: boolean
} {
  const { tag, loc: elementLoc, children } = node
  let properties: ObjectExpression['properties'] = []
  const mergeArgs: PropsExpression[] = []
  const runtimeDirectives: DirectiveNode[] = []
  const hasChildren = children.length > 0
  let shouldUseBlock = false
  let isBlockRequired = false

  // 以下状态最终折叠成互斥/可组合 patchFlag 和动态 prop 名单。
  let patchFlag = 0
  let hasRef = false
  let hasClassBinding = false
  let hasStyleBinding = false
  let hasHydrationEventBinding = false
  let hasDynamicKeys = false
  let hasVnodeHook = false
  const dynamicPropNames: string[] = []

  /** 把当前 properties 对象片段去重后推入 mergeArgs，并可追加整体绑定参数。 */
  const pushMergeArg = (arg?: PropsExpression) => {
    if (properties.length) {
      mergeArgs.push(
        createObjectExpression(dedupeProperties(properties), elementLoc),
      )
      properties = []
    }
    if (arg) mergeArgs.push(arg)
  }

  /** v-for 内的 template ref 必须标记 ref_for，运行时才会收集为数组而非反复覆盖。 */
  const pushRefVForMarker = () => {
    if (context.scopes.vFor > 0) {
      properties.push(
        createObjectProperty(
          createSimpleExpression('ref_for', true),
          createSimpleExpression('true'),
        ),
      )
    }
  }

  /** 从单个生成 Property 更新 hydration、class/style、动态 props 等 patch 信息。 */
  const analyzePatchFlag = ({ key, value }: Property) => {
    if (isStaticExp(key)) {
      const name = key.content
      const isEventHandler = isOn(name)
      if (
        isEventHandler &&
        (!isComponent || isDynamicComponent) &&
        // click hydration 有专用快速路径，不必为它单独设置 NEED_HYDRATION。
        name.toLowerCase() !== 'onclick' &&
        // v-model 更新监听器不是真实 DOM 事件。
        name !== 'onUpdate:modelValue' &&
        // VNode 生命周期 hook 由 renderer 调用，不参与 DOM 事件 hydration。
        !isReservedProp(name)
      ) {
        hasHydrationEventBinding = true
      }

      if (isEventHandler && isReservedProp(name)) {
        hasVnodeHook = true
      }

      if (name === 'ref') {
        hasRef = true
      }

      if (isEventHandler && value.type === NodeTypes.JS_CALL_EXPRESSION) {
        // withModifiers/withKeys 等内部 helper 包装不改变处理器本身的动态性，检查第一个参数。
        value = value.arguments[0] as JSChildNode
      }

      if (
        value.type === NodeTypes.JS_CACHE_EXPRESSION ||
        ((value.type === NodeTypes.SIMPLE_EXPRESSION ||
          value.type === NodeTypes.COMPOUND_EXPRESSION) &&
          getConstantType(value, context) > 0)
      ) {
        // 已缓存 handler 或常量 prop 不需要每轮 patch。
        return
      }

      if (name === 'class') {
        hasClassBinding = true
      } else if (name === 'style') {
        hasStyleBinding = true
      } else if (
        name !== 'ref' &&
        name !== 'key' &&
        !dynamicPropNames.includes(name)
      ) {
        dynamicPropNames.push(name)
      }

      // 组件 class/style 会作为普通 props 传递，不能使用原生元素专用 CLASS/STYLE 快速路径。
      if (
        isComponent &&
        (name === 'class' || name === 'style') &&
        !dynamicPropNames.includes(name)
      ) {
        dynamicPropNames.push(name)
      }
    } else {
      hasDynamicKeys = true
    }
  }

  for (let i = 0; i < props.length; i++) {
    // 普通静态属性直接进入对象字面量；指令走下面的专用转换。
    const prop = props[i]
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const { loc, name, nameLoc, value } = prop
      let isStatic = true
      if (name === 'ref') {
        hasRef = true
        pushRefVForMarker()
        // setup 内联模式没有 setupState 名称映射，`ref="foo"` 需把实际 ref 变量传给运行时；
        // ref_key 仍保留字符串名供 devtools/兼容行为使用。
        if (!__BROWSER__ && value && context.inline) {
          const binding = context.bindingMetadata[value.content]
          if (
            binding === BindingTypes.SETUP_LET ||
            binding === BindingTypes.SETUP_REF ||
            binding === BindingTypes.SETUP_MAYBE_REF
          ) {
            isStatic = false
            properties.push(
              createObjectProperty(
                createSimpleExpression('ref_key', true),
                createSimpleExpression(value.content, true, value.loc),
              ),
            )
          }
        }
      }
      // is 已被 resolveComponentType 消费，不应再作为普通 prop 重复传入。
      if (
        name === 'is' &&
        (isComponentTag(tag) ||
          (value && value.content.startsWith('vue:')) ||
          (__COMPAT__ &&
            isCompatEnabled(
              CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
              context,
            )))
      ) {
        continue
      }
      properties.push(
        createObjectProperty(
          createSimpleExpression(name, true, nameLoc),
          createSimpleExpression(
            value ? value.content : '',
            isStatic,
            value ? value.loc : loc,
          ),
        ),
      )
    } else {
      // 指令先过滤结构/专用语法，再调用注册的 DirectiveTransform。
      const { name, arg, exp, loc, modifiers } = prop
      const isVBind = name === 'bind'
      const isVOn = name === 'on'

      // v-slot 由 buildSlots 处理；放在非组件上属于语法错误。
      if (name === 'slot') {
        if (!isComponent) {
          context.onError(
            createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, loc),
          )
        }
        continue
      }
      // v-once/v-memo 已由节点级转换包装整个 codegenNode。
      if (name === 'once' || name === 'memo') {
        continue
      }
      // v-is 与动态 component 的 :is 已用于解析 VNode type。
      if (
        name === 'is' ||
        (isVBind &&
          isStaticArgOf(arg, 'is') &&
          (isComponentTag(tag) ||
            (__COMPAT__ &&
              isCompatEnabled(
                CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
                context,
              ))))
      ) {
        continue
      }
      // SSR 不注册客户端事件；带 vnode hook 等特殊情况由 SSR 转换另行处理。
      if (isVOn && ssr) {
        continue
      }

      // 修复 #938：动态 key 变化必须让该节点进入 block 更新列表，renderer 才会销毁旧 DOM
      // 并新建节点；作为静态树后代跳过 patch 会错误地原地复用 DOM。
      if (isVBind && isStaticArgOf(arg, 'key')) {
        shouldUseBlock = true
      }
      // onVnodeBeforeUpdate 必须在 children 更新前调用；保留 block 才能维持该时序。
      if (
        isVOn &&
        hasChildren &&
        arg &&
        isStaticExp(arg) &&
        camelize(arg.content) === 'vue:beforeUpdate'
      ) {
        shouldUseBlock = true
        isBlockRequired = true
      }

      if (isVBind && isStaticArgOf(arg, 'ref')) {
        pushRefVForMarker()
      }

      // 无参数 v-bind/v-on 产生整对象，必须参与 mergeProps 而非单 Property。
      if (!arg && (isVBind || isVOn)) {
        hasDynamicKeys = true
        if (exp) {
          if (isVBind) {
            if (__COMPAT__) {
              // 兼容检查需要知道 v-bind 前已有何种属性，先封口当前对象片段。
              pushMergeArg()
              // Vue 2 让 v-bind 对象优先级低于显式属性；Vue 3 遵循对象展开的书写顺序。
              if (__DEV__) {
                const hasOverridableKeys = mergeArgs.some(arg => {
                  if (arg.type === NodeTypes.JS_OBJECT_EXPRESSION) {
                    return arg.properties.some(({ key }) => {
                      if (
                        key.type !== NodeTypes.SIMPLE_EXPRESSION ||
                        !key.isStatic
                      ) {
                        return true
                      }
                      return (
                        key.content !== 'class' &&
                        key.content !== 'style' &&
                        !isOn(key.content)
                      )
                    })
                  } else {
                    // 非对象字面量的键集合未知，保守视为可能冲突。
                    return true
                  }
                })
                if (hasOverridableKeys) {
                  checkCompatEnabled(
                    CompilerDeprecationTypes.COMPILER_V_BIND_OBJECT_ORDER,
                    context,
                    loc,
                  )
                }
              }

              if (
                isCompatEnabled(
                  CompilerDeprecationTypes.COMPILER_V_BIND_OBJECT_ORDER,
                  context,
                )
              ) {
                mergeArgs.unshift(exp)
                continue
              }
            }

            // 修复 #10696：v-for 中 `v-bind="{ ref: itemRefs }"` 也需 ref_for 标记；
            // 否则每次迭代覆盖同一 ref，最终数组只剩最后一个元素。
            pushRefVForMarker()
            pushMergeArg()
            mergeArgs.push(exp)
          } else {
            // `v-on="obj"` 把事件名对象转换为 onXxx props；原生元素额外启用大小写保留模式。
            pushMergeArg({
              type: NodeTypes.JS_CALL_EXPRESSION,
              loc,
              callee: context.helper(TO_HANDLERS),
              arguments: isComponent ? [exp] : [exp, `true`],
            })
          }
        } else {
          context.onError(
            createCompilerError(
              isVBind
                ? ErrorCodes.X_V_BIND_NO_EXPRESSION
                : ErrorCodes.X_V_ON_NO_EXPRESSION,
              loc,
            ),
          )
        }
        continue
      }

      // `.prop` 可能依赖 DOM property 初始状态，SSR hydration 必须执行一次 patch。
      if (isVBind && modifiers.some(mod => mod.content === 'prop')) {
        patchFlag |= PatchFlags.NEED_HYDRATION
      }

      const directiveTransform = context.directiveTransforms[name]
      if (directiveTransform) {
        // 编译期已知指令：把结果 props 纳入 patchFlag 分析，并按需保留运行时部分。
        const { props, needRuntime } = directiveTransform(prop, node, context)
        !ssr && props.forEach(analyzePatchFlag)
        if (isVOn && arg && !isStaticExp(arg)) {
          pushMergeArg(createObjectExpression(props, elementLoc))
        } else {
          properties.push(...props)
        }
        if (needRuntime) {
          runtimeDirectives.push(prop)
          if (isSymbol(needRuntime)) {
            directiveImportMap.set(prop, needRuntime)
          }
        }
      } else if (!isBuiltInDirective(name)) {
        // 用户自定义指令必须保留到 withDirectives 运行时调用。
        runtimeDirectives.push(prop)
        // 自定义指令可能实现 beforeUpdate；有 children 时强制 block，保证 hook 先于 children patch。
        if (hasChildren) {
          shouldUseBlock = true
          isBlockRequired = true
        }
      }
    }
  }

  let propsExpression: PropsExpression | undefined = undefined

  // 出现整体 v-bind/v-on 时按书写顺序用 mergeProps 合并各对象片段。
  if (mergeArgs.length) {
    // 循环末尾仍可能积累一段普通 properties，先封装为最后参数。
    pushMergeArg()
    if (mergeArgs.length > 1) {
      propsExpression = createCallExpression(
        context.helper(MERGE_PROPS),
        mergeArgs,
        elementLoc,
      )
    } else {
      // 只有单个整体绑定时直接复用表达式，省去 mergeProps 调用。
      propsExpression = mergeArgs[0]
    }
  } else if (properties.length) {
    propsExpression = createObjectExpression(
      dedupeProperties(properties),
      elementLoc,
    )
  }

  // 动态 key 集合未知只能 FULL_PROPS 全量比较；否则按 class/style/具名 props 分配快速路径。
  if (hasDynamicKeys) {
    patchFlag |= PatchFlags.FULL_PROPS
  } else {
    if (hasClassBinding && !isComponent) {
      patchFlag |= PatchFlags.CLASS
    }
    if (hasStyleBinding && !isComponent) {
      patchFlag |= PatchFlags.STYLE
    }
    if (dynamicPropNames.length) {
      patchFlag |= PatchFlags.PROPS
    }
    if (hasHydrationEventBinding) {
      patchFlag |= PatchFlags.NEED_HYDRATION
    }
  }
  const needsPatch =
    (patchFlag === 0 || patchFlag === PatchFlags.NEED_HYDRATION) &&
    (hasRef || hasVnodeHook || runtimeDirectives.length > 0)
  if (!shouldUseBlock && needsPatch) {
    patchFlag |= PatchFlags.NEED_PATCH
  }

  // 客户端提前生成归一化 helper；SSR 当前由服务端属性渲染路径自行处理。
  if (!context.inSSR && propsExpression) {
    switch (propsExpression.type) {
      case NodeTypes.JS_OBJECT_EXPRESSION:
        // 纯对象表达式没有整体 v-bind，但仍可能含 `:[key]` 动态键。
        let classKeyIndex = -1
        let styleKeyIndex = -1
        let hasDynamicKey = false

        for (let i = 0; i < propsExpression.properties.length; i++) {
          const key = propsExpression.properties[i].key
          if (isStaticExp(key)) {
            if (key.content === 'class') {
              classKeyIndex = i
            } else if (key.content === 'style') {
              styleKeyIndex = i
            }
          } else if (!key.isHandlerKey) {
            hasDynamicKey = true
          }
        }

        const classProp = propsExpression.properties[classKeyIndex]
        const styleProp = propsExpression.properties[styleKeyIndex]

        // 键集合稳定时可只对具体 class/style 值做局部归一化。
        if (!hasDynamicKey) {
          if (classProp && !isStaticExp(classProp.value)) {
            classProp.value = createCallExpression(
              context.helper(NORMALIZE_CLASS),
              [classProp.value],
            )
          }
          if (
            styleProp &&
            // 静态 style 已被 DOM 转换编译成对象；hasStyleBinding 用于确认是否仍含动态 style。
            (hasStyleBinding ||
              (styleProp.value.type === NodeTypes.SIMPLE_EXPRESSION &&
                styleProp.value.content.trim()[0] === `[`) ||
              // 静态 style 与 v-bind:style 合并后为数组，即使绑定值是静态对象也需 normalizeStyle。
              styleProp.value.type === NodeTypes.JS_ARRAY_EXPRESSION)
          ) {
            styleProp.value = createCallExpression(
              context.helper(NORMALIZE_STYLE),
              [styleProp.value],
            )
          }
        } else {
          // 动态键可能运行时才成为 class/style/onXxx，必须整体 normalizeProps。
          propsExpression = createCallExpression(
            context.helper(NORMALIZE_PROPS),
            [propsExpression],
          )
        }
        break
      case NodeTypes.JS_CALL_EXPRESSION:
        // mergeProps 已在运行时执行必要归一化。
        break
      default:
        // 单 `v-bind="obj"`：先复制响应式对象防止 normalize 修改原值，再整体归一化。
        propsExpression = createCallExpression(
          context.helper(NORMALIZE_PROPS),
          [
            createCallExpression(context.helper(GUARD_REACTIVE_PROPS), [
              propsExpression,
            ]),
          ],
        )
        break
    }
  }

  return {
    props: propsExpression,
    directives: runtimeDirectives,
    patchFlag,
    dynamicPropNames,
    shouldUseBlock,
    needsPatch,
    isBlockRequired,
  }
}

/**
 * 对对象字面量 props 去重。
 * parser 已报告重复原始属性，但多个指令转换仍可能生成同名 onXxx/class/style。
 * 这三类允许多值并合成数组，交给运行时规范化；其他意外重复保留第一项。
 */
function dedupeProperties(properties: Property[]): Property[] {
  const knownProps: Map<string, Property> = new Map()
  const deduped: Property[] = []
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]
    // 动态 key 编译期无法判断是否重复，全部保留并由运行时对象语义决定。
    if (prop.key.type === NodeTypes.COMPOUND_EXPRESSION || !prop.key.isStatic) {
      deduped.push(prop)
      continue
    }
    const name = prop.key.content
    const existing = knownProps.get(name)
    if (existing) {
      if (name === 'style' || name === 'class' || isOn(name)) {
        mergeAsArray(existing, prop)
      }
      // 其他静态重复理论上已由 parser 报错，此处不再把错误项加入输出。
    } else {
      knownProps.set(name, prop)
      deduped.push(prop)
    }
  }
  return deduped
}

/** 把重复 class/style/handler 的值合并为数组；已有数组则原地追加。 */
function mergeAsArray(existing: Property, incoming: Property) {
  if (existing.value.type === NodeTypes.JS_ARRAY_EXPRESSION) {
    existing.value.elements.push(incoming.value)
  } else {
    existing.value = createArrayExpression(
      [existing.value, incoming.value],
      existing.loc,
    )
  }
}

/**
 * 构造传给 `withDirectives` 的 `[runtimeDir, exp?, arg?, modifiers?]` 参数。
 * 内置运行时指令使用 import Symbol；script setup 可直接引用 `vName` 局部变量；其余调用
 * resolveDirective。中间缺省参数用 `void 0` 占位，保持四项位置协议。
 */
export function buildDirectiveArgs(
  dir: DirectiveNode,
  context: TransformContext,
): ArrayExpression {
  const dirArgs: ArrayExpression['elements'] = []
  const runtime = directiveImportMap.get(dir)
  if (runtime) {
    // compiler-dom 等平台转换登记的内置运行时实现。
    dirArgs.push(context.helperString(runtime))
  } else {
    // 优先查找 `<script setup>` 暴露的 `v-foo` / `vFoo` 绑定。
    const fromSetup =
      !__BROWSER__ && resolveSetupReference('v-' + dir.name, context)
    if (fromSetup) {
      dirArgs.push(fromSetup)
    } else {
      // 未找到局部指令时，在 render 顶部生成 resolveDirective 常量。
      context.helper(RESOLVE_DIRECTIVE)
      context.directives.add(dir.name)
      dirArgs.push(toValidAssetId(dir.name, `directive`))
    }
  }
  const { loc } = dir
  if (dir.exp) dirArgs.push(dir.exp)
  if (dir.arg) {
    if (!dir.exp) {
      dirArgs.push(`void 0`)
    }
    dirArgs.push(dir.arg)
  }
  if (Object.keys(dir.modifiers).length) {
    if (!dir.arg) {
      if (!dir.exp) {
        dirArgs.push(`void 0`)
      }
      dirArgs.push(`void 0`)
    }
    const trueExpression = createSimpleExpression(`true`, false, loc)
    dirArgs.push(
      createObjectExpression(
        dir.modifiers.map(modifier =>
          createObjectProperty(modifier, trueExpression),
        ),
        loc,
      ),
    )
  }
  return createArrayExpression(dirArgs, dir.loc)
}

/** 把动态 prop 名称列表序列化为紧凑 JS 数组源码。 */
function stringifyDynamicPropNames(props: string[]): string {
  let propsNamesString = `[`
  for (let i = 0, l = props.length; i < l; i++) {
    propsNamesString += JSON.stringify(props[i])
    if (i < l - 1) propsNamesString += ', '
  }
  return propsNamesString + `]`
}

/** 是否为大小写两种内置动态组件容器标签。 */
function isComponentTag(tag: string) {
  return tag === 'component' || tag === 'Component'
}
