import type { SourceLocation } from '../ast'
import type { CompilerError } from '../errors'
import type { MergedParserOptions } from '../parser'
import type { TransformContext } from '../transform'

/**
 * Vue 2 → Vue 3 编译兼容配置。`MODE` 选择整体默认行为，单项可覆盖或仅屏蔽警告。
 */
export type CompilerCompatConfig = Partial<
  Record<CompilerDeprecationTypes, boolean | 'suppress-warning'>
> & {
  /** 兼容行为的整体默认模式：2 启用旧语义，3 使用 Vue 3 语义。 */
  MODE?: 2 | 3
}

/** 为 parser/transform options 挂载兼容配置的公共接口。 */
export interface CompilerCompatOptions {
  /** 按废弃特性覆盖默认兼容行为或仅屏蔽迁移警告。 */
  compatConfig?: CompilerCompatConfig
}

/** 编译器可独立开关的 Vue 2 废弃特性。 */
export enum CompilerDeprecationTypes {
  /** 原生元素上无 `vue:` 前缀的 `is` 属性。 */
  COMPILER_IS_ON_ELEMENT = 'COMPILER_IS_ON_ELEMENT',
  /** `v-bind:foo.sync` 旧双向绑定语法。 */
  COMPILER_V_BIND_SYNC = 'COMPILER_V_BIND_SYNC',
  /** 对象 `v-bind` 与普通属性冲突时的 Vue 2 覆盖顺序。 */
  COMPILER_V_BIND_OBJECT_ORDER = 'COMPILER_V_BIND_OBJECT_ORDER',
  /** `v-on` 的 `.native` 修饰符。 */
  COMPILER_V_ON_NATIVE = 'COMPILER_V_ON_NATIVE',
  /** 同一元素上 `v-if` / `v-for` 的 Vue 2 优先级。 */
  COMPILER_V_IF_V_FOR_PRECEDENCE = 'COMPILER_V_IF_V_FOR_PRECEDENCE',
  /** 无特殊指令 template 自动展开 children 的行为。 */
  COMPILER_NATIVE_TEMPLATE = 'COMPILER_NATIVE_TEMPLATE',
  /** `inline-template` 属性。 */
  COMPILER_INLINE_TEMPLATE = 'COMPILER_INLINE_TEMPLATE',
  /** 管道过滤器表达式。 */
  COMPILER_FILTERS = 'COMPILER_FILTERS',
}

/** 单项废弃特性的警告文本与迁移文档。 */
type DeprecationData = {
  /** 固定诊断文案，或根据模板参数动态生成的文案。 */
  message: string | ((...args: any[]) => string)
  /** 对应的 Vue 3 迁移指南。 */
  link?: string
}

/** 所有兼容特性的诊断元数据；运行时行为由各 parser/transform 分支实现。 */
const deprecationData: Record<CompilerDeprecationTypes, DeprecationData> = {
  [CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT]: {
    message:
      `Platform-native elements with "is" prop will no longer be ` +
      `treated as components in Vue 3 unless the "is" value is explicitly ` +
      `prefixed with "vue:".`,
    link: `https://v3-migration.vuejs.org/breaking-changes/custom-elements-interop.html`,
  },

  [CompilerDeprecationTypes.COMPILER_V_BIND_SYNC]: {
    message: key =>
      `.sync modifier for v-bind has been removed. Use v-model with ` +
      `argument instead. \`v-bind:${key}.sync\` should be changed to ` +
      `\`v-model:${key}\`.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-model.html`,
  },

  [CompilerDeprecationTypes.COMPILER_V_BIND_OBJECT_ORDER]: {
    message:
      `v-bind="obj" usage is now order sensitive and behaves like JavaScript ` +
      `object spread: it will now overwrite an existing non-mergeable attribute ` +
      `that appears before v-bind in the case of conflict. ` +
      `To retain 2.x behavior, move v-bind to make it the first attribute. ` +
      `You can also suppress this warning if the usage is intended.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-bind.html`,
  },

  [CompilerDeprecationTypes.COMPILER_V_ON_NATIVE]: {
    message: `.native modifier for v-on has been removed as is no longer necessary.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-on-native-modifier-removed.html`,
  },

  [CompilerDeprecationTypes.COMPILER_V_IF_V_FOR_PRECEDENCE]: {
    message:
      `v-if / v-for precedence when used on the same element has changed ` +
      `in Vue 3: v-if now takes higher precedence and will no longer have ` +
      `access to v-for scope variables. It is best to avoid the ambiguity ` +
      `with <template> tags or use a computed property that filters v-for ` +
      `data source.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/v-if-v-for.html`,
  },

  [CompilerDeprecationTypes.COMPILER_NATIVE_TEMPLATE]: {
    message:
      `<template> with no special directives will render as a native template ` +
      `element instead of its inner content in Vue 3.`,
  },

  [CompilerDeprecationTypes.COMPILER_INLINE_TEMPLATE]: {
    message: `"inline-template" has been removed in Vue 3.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/inline-template-attribute.html`,
  },

  [CompilerDeprecationTypes.COMPILER_FILTERS]: {
    message:
      `filters have been removed in Vue 3. ` +
      `The "|" symbol will be treated as native JavaScript bitwise OR operator. ` +
      `Use method calls or computed properties instead.`,
    link: `https://v3-migration.vuejs.org/breaking-changes/filters.html`,
  },
}

/** 读取单项配置；编译器未指定 MODE 时默认使用 Vue 3 行为。 */
function getCompatValue(
  key: CompilerDeprecationTypes | 'MODE',
  { compatConfig }: MergedParserOptions | TransformContext,
) {
  const value = compatConfig && compatConfig[key]
  if (key === 'MODE') {
    return value || 3
  } else {
    return value
  }
}

/**
 * 判断兼容特性是否启用：MODE 3 仅显式 true 启用；MODE 2 默认启用，显式 false 才关闭。
 */
export function isCompatEnabled(
  key: CompilerDeprecationTypes,
  context: MergedParserOptions | TransformContext,
): boolean {
  const mode = getCompatValue('MODE', context)
  const value = getCompatValue(key, context)
  return mode === 3 ? value === true : value !== false
}

/** 检查兼容特性，并在开发环境启用时同步发出迁移警告。 */
export function checkCompatEnabled(
  key: CompilerDeprecationTypes,
  context: MergedParserOptions | TransformContext,
  loc: SourceLocation | null,
  ...args: any[]
): boolean {
  const enabled = isCompatEnabled(key, context)
  if (__DEV__ && enabled) {
    warnDeprecation(key, context, loc, ...args)
  }
  return enabled
}

/** 构造带特性编号、源码位置和迁移链接的废弃警告。 */
export function warnDeprecation(
  key: CompilerDeprecationTypes,
  context: MergedParserOptions | TransformContext,
  loc: SourceLocation | null,
  ...args: any[]
): void {
  const val = getCompatValue(key, context)
  if (val === 'suppress-warning') {
    return
  }
  const { message, link } = deprecationData[key]
  const msg = `(deprecation ${key}) ${
    typeof message === 'function' ? message(...args) : message
  }${link ? `\n  Details: ${link}` : ``}`

  const err = new SyntaxError(msg) as CompilerError
  err.code = key
  if (loc) err.loc = loc
  context.onWarn(err)
}
