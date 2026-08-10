/**
 * `@vue/runtime-core` 的公共出口。
 * 本文件本身几乎不实现业务逻辑，而是把响应式系统、组件 API、渲染器协议、编译器
 * helper 与 SSR/兼容层能力按稳定性分组导出。阅读具体机制时应跳转到对应源文件。
 */

// 核心公共 API ---------------------------------------------------------------

/** 当前构建的 Vue 版本号，由打包阶段注入 `__VERSION__`。 */
export const version: string = __VERSION__
export {
  // 响应式核心
  reactive,
  ref,
  readonly,
  // 响应式工具
  unref,
  proxyRefs,
  isRef,
  toRef,
  toValue,
  toRefs,
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  // 高级响应式 API
  customRef,
  triggerRef,
  shallowRef,
  shallowReactive,
  shallowReadonly,
  markRaw,
  toRaw,
  // 响应式副作用
  effect,
  stop,
  getCurrentWatcher,
  onWatcherCleanup,
  ReactiveEffect,
  // 副作用作用域
  effectScope,
  EffectScope,
  getCurrentScope,
  onScopeDispose,
} from '@vue/reactivity'
export { computed } from './apiComputed'
export {
  watch,
  watchEffect,
  watchPostEffect,
  watchSyncEffect,
} from './apiWatch'
export {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  onActivated,
  onDeactivated,
  onRenderTracked,
  onRenderTriggered,
  onErrorCaptured,
  onServerPrefetch,
} from './apiLifecycle'
export { provide, inject, hasInjectionContext } from './apiInject'
export { nextTick } from './scheduler'
export { defineComponent } from './apiDefineComponent'
export { defineAsyncComponent } from './apiAsyncComponent'
export { useAttrs, useSlots } from './apiSetupHelpers'
export { useModel } from './helpers/useModel'
export { useTemplateRef, type TemplateRef } from './helpers/useTemplateRef'
export { useId } from './helpers/useId'
export {
  hydrateOnIdle,
  hydrateOnVisible,
  hydrateOnMediaQuery,
  hydrateOnInteraction,
} from './hydrationStrategies'

// <script setup> 编译宏 -------------------------------------------------------

export {
  // 宏的运行时占位，仅用于类型推导和错误用法警告；正常 SFC 输出会将调用编译掉。
  defineProps,
  defineEmits,
  defineExpose,
  defineOptions,
  defineSlots,
  defineModel,
  withDefaults,
  type DefineProps,
  type ModelRef,
  type ComponentTypeEmits,
} from './apiSetupHelpers'

/**
 * @internal 仅供 SFC 编译产物调用的宏运行时 helper。
 */
export {
  mergeDefaults,
  mergeModels,
  createPropsRestProxy,
  withAsyncContext,
} from './apiSetupHelpers'

// 高级公共 API ----------------------------------------------------------------

// 在 setup 中取得内部组件实例，主要供需要接入底层能力的高级插件使用。
export { getCurrentInstance } from './component'

// 供手写 render 函数使用。
export { h } from './h'
// 高级 VNode/渲染函数工具。
export { createVNode, cloneVNode, mergeProps, isVNode } from './vnode'
// 特殊 VNode 类型。
export { Fragment, Text, Comment, Static, type VNodeRef } from './vnode'
// 内置组件。
export { Teleport, type TeleportProps } from './components/Teleport'
export { Suspense, type SuspenseProps } from './components/Suspense'
export { KeepAlive, type KeepAliveProps } from './components/KeepAlive'
export {
  BaseTransition,
  BaseTransitionPropsValidators,
  type BaseTransitionProps,
} from './components/BaseTransition'
// 自定义指令 helper。
export { withDirectives } from './directives'
// SSR 请求上下文。
export { useSSRContext, ssrContextKey } from './helpers/useSsrContext'

// 自定义渲染器 API ------------------------------------------------------------

export { createRenderer, createHydrationRenderer } from './renderer'
export { queuePostFlushCb } from './scheduler'
import { warn as _warn } from './warning'
/** 开发构建使用完整警告实现；生产构建为空函数，调用方无需重复条件编译。 */
export const warn = (__DEV__ ? _warn : NOOP) as typeof _warn

/** @internal */
export { assertNumber } from './warning'
export {
  handleError,
  callWithErrorHandling,
  callWithAsyncErrorHandling,
  ErrorCodes,
} from './errorHandling'
export {
  resolveComponent,
  resolveDirective,
  resolveDynamicComponent,
} from './helpers/resolveAssets'
// 运行时模板编译器接入点。
export { registerRuntimeCompiler, isRuntimeOnly } from './component'
export {
  useTransitionState,
  resolveTransitionHooks,
  setTransitionHooks,
  getTransitionRawChildren,
} from './components/BaseTransition'
export { initCustomFormatter } from './customFormatter'

import { ErrorTypeStrings as _ErrorTypeStrings } from './errorHandling'
/**
 * @internal 运行时错误码到可读说明的映射，仅开发或 ESM/CJS 构建暴露；精简生产
 * 全局构建使用 null 以节省体积。
 */
export const ErrorTypeStrings = (
  __ESM_BUNDLER__ || __CJS__ || __DEV__ ? _ErrorTypeStrings : null
) as typeof _ErrorTypeStrings

// Vue Devtools 接入点。
import {
  type DevtoolsHook,
  devtools as _devtools,
  setDevtoolsHook as _setDevtoolsHook,
} from './devtools'

/** 当前 Devtools hook；不暴露开发工具能力的生产构建中为 undefined。 */
export const devtools = (
  __DEV__ || __ESM_BUNDLER__ ? _devtools : undefined
) as DevtoolsHook
/** 安装 Devtools hook；不支持的生产构建退化为 NOOP。 */
export const setDevtoolsHook = (
  __DEV__ || __ESM_BUNDLER__ ? _setDevtoolsHook : NOOP
) as typeof _setDevtoolsHook

// 公共类型 --------------------------------------------------------------------

import type { VNode } from './vnode'
import type { ComponentInternalInstance } from './component'

// 扩展 ref 解包的停止类型：VNode/组件公共实例包含大量递归引用，不应被深度 UnwrapRef。
declare module '@vue/reactivity' {
  /** runtime-core 中不得继续递归解包的 VNode 与组件公共实例结构。 */
  export interface RefUnwrapBailTypes {
    runtimeCoreBailTypes:
      | VNode
      | {
          // 直接写 ComponentPublicInstance 会造成类型递归，使用其 `$` 内部实例字段作提示。
          $: ComponentInternalInstance
        }
  }
}

export { TrackOpTypes, TriggerOpTypes } from '@vue/reactivity'
export type {
  Ref,
  MaybeRef,
  MaybeRefOrGetter,
  ToRef,
  ToRefs,
  UnwrapRef,
  ShallowRef,
  ShallowUnwrapRef,
  CustomRefFactory,
  ReactiveFlags,
  DeepReadonly,
  ShallowReactive,
  UnwrapNestedRefs,
  ComputedRef,
  WritableComputedRef,
  WritableComputedOptions,
  ComputedGetter,
  ComputedSetter,
  ReactiveEffectRunner,
  ReactiveEffectOptions,
  EffectScheduler,
  DebuggerOptions,
  DebuggerEvent,
  DebuggerEventExtraInfo,
  Raw,
  Reactive,
} from '@vue/reactivity'
export type {
  MultiWatchSources,
  WatchEffect,
  WatchOptions,
  WatchEffectOptions as WatchOptionsBase,
  WatchCallback,
  WatchSource,
  WatchHandle,
  WatchStopHandle,
} from './apiWatch'
export type { InjectionKey } from './apiInject'
export type {
  App,
  AppConfig,
  AppContext,
  Plugin,
  ObjectPlugin,
  FunctionPlugin,
  CreateAppFunction,
  OptionMergeFunction,
} from './apiCreateApp'
export type {
  VNode,
  VNodeChild,
  VNodeTypes,
  VNodeProps,
  VNodeArrayChildren,
  VNodeNormalizedChildren,
} from './vnode'
export type {
  Component,
  ConcreteComponent,
  FunctionalComponent,
  ComponentInternalInstance,
  Attrs,
  SetupContext,
  AllowedAttrs,
  ComponentCustomProps,
  AllowedComponentProps,
  GlobalComponents,
  GlobalDirectives,
  ComponentInstance,
  ComponentCustomElementInterface,
} from './component'
export type {
  DefineComponent,
  DefineSetupFnComponent,
  PublicProps,
} from './apiDefineComponent'
export type {
  ComponentOptions,
  ComponentOptionsMixin,
  ComponentCustomOptions,
  ComponentOptionsBase,
  ComponentProvideOptions,
  RenderFunction,
  MethodOptions,
  ComputedOptions,
  RuntimeCompilerOptions,
  ComponentInjectOptions,
  // 已弃用的历史类型
  ComponentOptionsWithoutProps,
  ComponentOptionsWithArrayProps,
  ComponentOptionsWithObjectProps,
} from './componentOptions'
export type {
  EmitsOptions,
  ObjectEmitsOptions,
  EmitsToProps,
  ShortEmitsToObject,
  EmitFn,
} from './componentEmits'
export type {
  ComponentPublicInstance,
  ComponentCustomProperties,
  CreateComponentPublicInstance,
  CreateComponentPublicInstanceWithMixins,
} from './componentPublicInstance'
export type {
  Renderer,
  RendererNode,
  RendererElement,
  HydrationRenderer,
  RendererOptions,
  RootRenderFunction,
  ElementNamespace,
} from './renderer'
export type { RootHydrateFunction } from './hydration'
export type { Slot, Slots, SlotsType } from './componentSlots'
export type {
  Prop,
  PropType,
  ComponentPropsOptions,
  ComponentObjectPropsOptions,
  ExtractPropTypes,
  ExtractPublicPropTypes,
  ExtractDefaultPropTypes,
} from './componentProps'
export type {
  Directive,
  DirectiveBinding,
  DirectiveHook,
  ObjectDirective,
  FunctionDirective,
  DirectiveModifiers,
  DirectiveArguments,
} from './directives'
export type { SuspenseBoundary } from './components/Suspense'
export type {
  TransitionState,
  TransitionHooks,
} from './components/BaseTransition'
export type {
  AsyncComponentOptions,
  AsyncComponentLoader,
} from './apiAsyncComponent'
export type {
  HydrationStrategy,
  HydrationStrategyFactory,
} from './hydrationStrategies'
export type { HMRRuntime } from './hmr'

// 内部 API --------------------------------------------------------------------

// **注意**：内部 API 可能在任意版本变更，业务代码不应依赖。

// 供编译器生成代码调用；必须与 `@vue/compiler-core/src/runtimeHelpers.ts` 保持同步。
export {
  withCtx,
  pushScopeId,
  popScopeId,
  withScopeId,
} from './componentRenderContext'
export { renderList } from './helpers/renderList'
export { toHandlers } from './helpers/toHandlers'
export { renderSlot } from './helpers/renderSlot'
export { createSlots } from './helpers/createSlots'
export { withMemo, isMemoSame } from './helpers/withMemo'
export {
  openBlock,
  createBlock,
  setBlockTracking,
  createTextVNode,
  createCommentVNode,
  createStaticVNode,
  createElementVNode,
  createElementBlock,
  guardReactiveProps,
} from './vnode'
export {
  toDisplayString,
  camelize,
  capitalize,
  toHandlerKey,
  normalizeProps,
  normalizeClass,
  normalizeStyle,
} from '@vue/shared'

// 供 test-utils 替换 VNode 创建参数。
export { transformVNodeArgs } from './vnode'

// SSR 内部协议 ----------------------------------------------------------------

// **注意**：以下能力只为 `@vue/server-renderer` 暴露，可随版本改变，用户代码勿依赖。

import {
  createComponentInstance,
  getComponentPublicInstance,
  setupComponent,
} from './component'
import { renderComponentRoot } from './componentRenderUtils'
import { setCurrentRenderingInstance } from './componentRenderContext'
import { isVNode, normalizeVNode } from './vnode'
import { ensureValidVNode } from './helpers/renderSlot'
import { popWarningContext, pushWarningContext } from './warning'

/** server-renderer 所需函数的内部集合，后续按 __SSR__ 条件导出。 */
const _ssrUtils: {
  createComponentInstance: typeof createComponentInstance
  setupComponent: typeof setupComponent
  renderComponentRoot: typeof renderComponentRoot
  setCurrentRenderingInstance: typeof setCurrentRenderingInstance
  isVNode: typeof isVNode
  normalizeVNode: typeof normalizeVNode
  getComponentPublicInstance: typeof getComponentPublicInstance
  ensureValidVNode: typeof ensureValidVNode
  pushWarningContext: typeof pushWarningContext
  popWarningContext: typeof popWarningContext
} = {
  createComponentInstance,
  setupComponent,
  renderComponentRoot,
  setCurrentRenderingInstance,
  isVNode,
  normalizeVNode,
  getComponentPublicInstance,
  ensureValidVNode,
  pushWarningContext,
  popWarningContext,
}

/**
 * @internal `@vue/server-renderer` 所需的组件创建、setup、VNode 规范化等底层工具；
 * 只有支持 SSR 的构建暴露。
 */
export const ssrUtils = (__SSR__ ? _ssrUtils : null) as typeof _ssrUtils

// Vue 2 兼容构建 --------------------------------------------------------------

import { DeprecationTypes as _DeprecationTypes } from './compat/compatConfig'
export type { CompatVue } from './compat/global'
export type { LegacyConfig } from './compat/globalConfig'

import { warnDeprecation } from './compat/compatConfig'
import { createCompatVue } from './compat/global'
import {
  checkCompatEnabled,
  isCompatEnabled,
  softAssertCompatEnabled,
} from './compat/compatConfig'
import { resolveFilter as _resolveFilter } from './helpers/resolveAssets'
import { NOOP } from '@vue/shared'

/**
 * @internal 仅兼容构建暴露的过滤器解析 helper。
 */
export const resolveFilter: typeof _resolveFilter | null = __COMPAT__
  ? _resolveFilter
  : null

/** 兼容构建内部工具集合，非兼容构建最终导出 null。 */
const _compatUtils: {
  warnDeprecation: typeof warnDeprecation
  createCompatVue: typeof createCompatVue
  isCompatEnabled: typeof isCompatEnabled
  checkCompatEnabled: typeof checkCompatEnabled
  softAssertCompatEnabled: typeof softAssertCompatEnabled
} = {
  warnDeprecation,
  createCompatVue,
  isCompatEnabled,
  checkCompatEnabled,
  softAssertCompatEnabled,
}

/**
 * @internal 仅兼容构建暴露的弃用检查与全局 Vue 构造器工具集合。
 */
export const compatUtils = (
  __COMPAT__ ? _compatUtils : null
) as typeof _compatUtils

/** 仅兼容构建可用的 Vue 2 弃用特性枚举。 */
export const DeprecationTypes = (
  __COMPAT__ ? _DeprecationTypes : null
) as typeof _DeprecationTypes
