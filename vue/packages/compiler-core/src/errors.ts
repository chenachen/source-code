import type { SourceLocation } from './ast'

/** 编译器各阶段共用的错误对象；`loc` 指向模板中的出错范围。 */
export interface CompilerError extends SyntaxError {
  /** 稳定数字错误码，或上层工具自定义的字符串错误码。 */
  code: number | string
  /** 能定位到模板时携带的出错源码范围。 */
  loc?: SourceLocation
}

/** compiler-core 自身产生的错误，错误码被收窄为 {@link ErrorCodes}。 */
export interface CoreCompilerError extends CompilerError {
  /** compiler-core 内置错误码。 */
  code: ErrorCodes
}

/** 默认错误处理器：立即抛出，使调用方中止本次编译。 */
export function defaultOnError(error: CompilerError): never {
  throw error
}

/** 默认警告处理器：仅在开发环境把编译警告输出到控制台。 */
export function defaultOnWarn(msg: CompilerError): void {
  __DEV__ && console.warn(`[Vue warn] ${msg.message}`)
}

/** 根据错误码是否属于 core，推导更精确的错误对象类型。 */
type InferCompilerError<T> = T extends ErrorCodes
  ? CoreCompilerError
  : CompilerError

/**
 * 创建带错误码和模板位置的编译错误。
 *
 * 开发版及 Node 端保留可读消息；浏览器生产版改用文档链接以减小包体积。
 * 上层编译器可传入自己的消息表，并通过 `additionalMessage` 附加解析器原始错误。
 */
export function createCompilerError<T extends number>(
  code: T,
  loc?: SourceLocation,
  messages?: {
    /** 数字错误码对应的开发期诊断文本。 */
    [code: number]: string
  },
  additionalMessage?: string,
): InferCompilerError<T> {
  const msg =
    __DEV__ || !__BROWSER__
      ? (messages || errorMessages)[code] + (additionalMessage || ``)
      : `https://vuejs.org/error-reference/#compiler-${code}`
  const error = new SyntaxError(String(msg)) as InferCompilerError<T>
  error.code = code
  error.loc = loc
  return error
}

/**
 * compiler-core 的稳定错误码表。
 *
 * 数值会出现在生产构建的错误链接中，因此不要随意重排；上层编译器应从
 * `__EXTEND_POINT__` 的值起继续编号；它是 core 的尾部占位，不是实际抛出的 core 错误。
 */
export enum ErrorCodes {
  /** 空注释以非法形式突然闭合，例如 `<!-->`。 */
  ABRUPT_CLOSING_OF_EMPTY_COMMENT,
  /** 在 HTML 命名空间中使用了只允许 XML 的 CDATA。 */
  CDATA_IN_HTML_CONTENT,
  /** 同一开始标签重复声明了属性。 */
  DUPLICATE_ATTRIBUTE,
  /** 结束标签携带了属性，例如 `</div id=x>`。 */
  END_TAG_WITH_ATTRIBUTES,
  /** 结束标签尾部包含非法 `/`，例如 `</div/>`。 */
  END_TAG_WITH_TRAILING_SOLIDUS,
  /** 读到 `<` 后尚未出现标签名便到达文件末尾。 */
  EOF_BEFORE_TAG_NAME,
  /** CDATA 尚未以 `]]>` 闭合便到达文件末尾。 */
  EOF_IN_CDATA,
  /** HTML 注释尚未闭合便到达文件末尾。 */
  EOF_IN_COMMENT,
  /** script 的 HTML 注释式文本状态尚未结束便到达文件末尾。 */
  EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT,
  /** 开始或结束标签尚未闭合便到达文件末尾。 */
  EOF_IN_TAG,
  /** 注释使用了错误的闭合序列，例如 `--!>`。 */
  INCORRECTLY_CLOSED_COMMENT,
  /** `<` 后的内容看似注释，却没有合法的 `<!--` 开头。 */
  INCORRECTLY_OPENED_COMMENT,
  /** `<` 后首字符不能开始合法标签名。 */
  INVALID_FIRST_CHARACTER_OF_TAG_NAME,
  /** 属性写出等号却缺少属性值。 */
  MISSING_ATTRIBUTE_VALUE,
  /** `</` 后缺少结束标签名。 */
  MISSING_END_TAG_NAME,
  /** 两个属性之间没有空白分隔。 */
  MISSING_WHITESPACE_BETWEEN_ATTRIBUTES,
  /** 注释内部再次出现 `<!--`，形成不受支持的嵌套注释。 */
  NESTED_COMMENT,
  /** 属性名包含引号、`<` 等非法字符。 */
  UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
  /** 未加引号的属性值包含引号、`<`、`=`、反引号等非法字符。 */
  UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
  /** 属性名开始前意外出现等号。 */
  UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME,
  /** 模板中出现 U+0000 空字符。 */
  UNEXPECTED_NULL_CHARACTER,
  /** HTML 中出现 XML 处理指令式的 `<?...>`。 */
  UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
  /** 标签内部在不允许的位置出现 `/`。 */
  UNEXPECTED_SOLIDUS_IN_TAG,

  /** 结束标签没有与当前元素栈中的开始标签匹配。 */
  X_INVALID_END_TAG,
  /** 元素缺少配对结束标签；关闭外层元素或到达末尾时均可能报告。 */
  X_MISSING_END_TAG,
  /** 插值缺少配置的结束定界符，默认是 `}}`。 */
  X_MISSING_INTERPOLATION_END,
  /** 写出了 `v-` 前缀却没有合法指令名。 */
  X_MISSING_DIRECTIVE_NAME,
  /** 动态指令参数缺少 `]`，例如 `:[foo="bar"`。 */
  X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END,

  /** `v-if` 或 `v-else-if` 没有条件表达式。 */
  X_V_IF_NO_EXPRESSION,
  /** 同一 `v-if` 分支组使用了重复的显式 key。 */
  X_V_IF_SAME_KEY,
  /** `v-else` / `v-else-if` 前面没有可连接的条件分支。 */
  X_V_ELSE_NO_ADJACENT_IF,
  /** `v-for` 没有循环表达式。 */
  X_V_FOR_NO_EXPRESSION,
  /** `v-for` 表达式无法拆成别名和数据源。 */
  X_V_FOR_MALFORMED_EXPRESSION,
  /** `<template v-for>` 的 key 错放在其子元素上。 */
  X_V_FOR_TEMPLATE_KEY_PLACEMENT,
  /** `v-bind` 没有表达式，且不属于合法同名简写。 */
  X_V_BIND_NO_EXPRESSION,
  /** `v-on` 没有事件处理表达式。 */
  X_V_ON_NO_EXPRESSION,
  /** `<slot>` 出口上使用了无意义的自定义指令。 */
  X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET,
  /** 同一组件混用了组件级 `v-slot` 和嵌套 `<template v-slot>`。 */
  X_V_SLOT_MIXED_SLOT_USAGE,
  /** 同一组件声明了重名插槽。 */
  X_V_SLOT_DUPLICATE_SLOT_NAMES,
  /** 已显式声明默认插槽时又提供了会被忽略的额外默认子节点。 */
  X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN,
  /** `v-slot` 用在组件或 `<template>` 之外的位置。 */
  X_V_SLOT_MISPLACED,
  /** `v-model` 没有绑定表达式。 */
  X_V_MODEL_NO_EXPRESSION,
  /** `v-model` 目标不是可赋值的成员表达式。 */
  X_V_MODEL_MALFORMED_EXPRESSION,
  /** `v-model` 试图直接替换 v-for/v-slot 的局部别名；这种赋值不能写回其来源。 */
  X_V_MODEL_ON_SCOPE_VARIABLE,
  /** `v-model` 直接绑定到只读 props。 */
  X_V_MODEL_ON_PROPS,
  /** `v-model` 直接绑定到编译期已知的 const。 */
  X_V_MODEL_ON_CONST,
  /** 模板中的 JavaScript 表达式无法被解析。 */
  X_INVALID_EXPRESSION,
  /** `<KeepAlive>` 同时接收了多个组件子节点。 */
  X_KEEP_ALIVE_INVALID_CHILDREN,

  /** 当前浏览器构建不支持 `prefixIdentifiers`。 */
  X_PREFIX_ID_NOT_SUPPORTED,
  /** 当前浏览器构建不支持 ES module 输出模式。 */
  X_MODULE_MODE_NOT_SUPPORTED,
  /** 未启用标识符前缀时不能缓存事件处理器。 */
  X_CACHE_HANDLER_NOT_SUPPORTED,
  /** 非 module 模式不能使用 `scopeId`。 */
  X_SCOPE_ID_NOT_SUPPORTED,
  /** 已移除的 `@vnode-*` 钩子语法，应改用 `@vue:*`。 */
  X_VNODE_HOOKS,

  /** 同名 `v-bind` 简写只能使用静态参数，动态参数无法推导值名称。 */
  X_V_BIND_INVALID_SAME_NAME_ARGUMENT,

  /** 上层平台错误码的起始边界；必须保持为最后一个成员。 */
  __EXTEND_POINT__,
}

/** 错误码到开发环境可读英文消息的映射；生产浏览器构建不会内联这些文本。 */
export const errorMessages: Record<ErrorCodes, string> = {
  // HTML 解析错误。
  [ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT]: 'Illegal comment.',
  [ErrorCodes.CDATA_IN_HTML_CONTENT]:
    'CDATA section is allowed only in XML context.',
  [ErrorCodes.DUPLICATE_ATTRIBUTE]: 'Duplicate attribute.',
  [ErrorCodes.END_TAG_WITH_ATTRIBUTES]: 'End tag cannot have attributes.',
  [ErrorCodes.END_TAG_WITH_TRAILING_SOLIDUS]: "Illegal '/' in tags.",
  [ErrorCodes.EOF_BEFORE_TAG_NAME]: 'Unexpected EOF in tag.',
  [ErrorCodes.EOF_IN_CDATA]: 'Unexpected EOF in CDATA section.',
  [ErrorCodes.EOF_IN_COMMENT]: 'Unexpected EOF in comment.',
  [ErrorCodes.EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT]:
    'Unexpected EOF in script.',
  [ErrorCodes.EOF_IN_TAG]: 'Unexpected EOF in tag.',
  [ErrorCodes.INCORRECTLY_CLOSED_COMMENT]: 'Incorrectly closed comment.',
  [ErrorCodes.INCORRECTLY_OPENED_COMMENT]: 'Incorrectly opened comment.',
  [ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME]:
    "Illegal tag name. Use '&lt;' to print '<'.",
  [ErrorCodes.MISSING_ATTRIBUTE_VALUE]: 'Attribute value was expected.',
  [ErrorCodes.MISSING_END_TAG_NAME]: 'End tag name was expected.',
  [ErrorCodes.MISSING_WHITESPACE_BETWEEN_ATTRIBUTES]:
    'Whitespace was expected.',
  [ErrorCodes.NESTED_COMMENT]: "Unexpected '<!--' in comment.",
  [ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME]:
    'Attribute name cannot contain U+0022 ("), U+0027 (\'), and U+003C (<).',
  [ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE]:
    'Unquoted attribute value cannot contain U+0022 ("), U+0027 (\'), U+003C (<), U+003D (=), and U+0060 (`).',
  [ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME]:
    "Attribute name cannot start with '='.",
  [ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME]:
    "'<?' is allowed only in XML context.",
  [ErrorCodes.UNEXPECTED_NULL_CHARACTER]: `Unexpected null character.`,
  [ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG]: "Illegal '/' in tags.",

  // Vue 模板解析错误。
  [ErrorCodes.X_INVALID_END_TAG]: 'Invalid end tag.',
  [ErrorCodes.X_MISSING_END_TAG]: 'Element is missing end tag.',
  [ErrorCodes.X_MISSING_INTERPOLATION_END]:
    'Interpolation end sign was not found.',
  [ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END]:
    'End bracket for dynamic directive argument was not found. ' +
    'Note that dynamic directive argument cannot contain spaces.',
  [ErrorCodes.X_MISSING_DIRECTIVE_NAME]: 'Legal directive name was expected.',

  // AST 转换错误。
  [ErrorCodes.X_V_IF_NO_EXPRESSION]: `v-if/v-else-if is missing expression.`,
  [ErrorCodes.X_V_IF_SAME_KEY]: `v-if/else branches must use unique keys.`,
  [ErrorCodes.X_V_ELSE_NO_ADJACENT_IF]: `v-else/v-else-if has no adjacent v-if or v-else-if.`,
  [ErrorCodes.X_V_FOR_NO_EXPRESSION]: `v-for is missing expression.`,
  [ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION]: `v-for has invalid expression.`,
  [ErrorCodes.X_V_FOR_TEMPLATE_KEY_PLACEMENT]: `<template v-for> key should be placed on the <template> tag.`,
  [ErrorCodes.X_V_BIND_NO_EXPRESSION]: `v-bind is missing expression.`,
  [ErrorCodes.X_V_BIND_INVALID_SAME_NAME_ARGUMENT]: `v-bind with same-name shorthand only allows static argument.`,
  [ErrorCodes.X_V_ON_NO_EXPRESSION]: `v-on is missing expression.`,
  [ErrorCodes.X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET]: `Unexpected custom directive on <slot> outlet.`,
  [ErrorCodes.X_V_SLOT_MIXED_SLOT_USAGE]:
    `Mixed v-slot usage on both the component and nested <template>. ` +
    `When there are multiple named slots, all slots should use <template> ` +
    `syntax to avoid scope ambiguity.`,
  [ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES]: `Duplicate slot names found. `,
  [ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN]:
    `Extraneous children found when component already has explicitly named ` +
    `default slot. These children will be ignored.`,
  [ErrorCodes.X_V_SLOT_MISPLACED]: `v-slot can only be used on components or <template> tags.`,
  [ErrorCodes.X_V_MODEL_NO_EXPRESSION]: `v-model is missing expression.`,
  [ErrorCodes.X_V_MODEL_MALFORMED_EXPRESSION]: `v-model value must be a valid JavaScript member expression.`,
  [ErrorCodes.X_V_MODEL_ON_SCOPE_VARIABLE]: `v-model cannot be used on v-for or v-slot scope variables because they are not writable.`,
  [ErrorCodes.X_V_MODEL_ON_PROPS]: `v-model cannot be used on a prop, because local prop bindings are not writable.\nUse a v-bind binding combined with a v-on listener that emits update:x event instead.`,
  [ErrorCodes.X_V_MODEL_ON_CONST]: `v-model cannot be used on a const binding because it is not writable.`,
  [ErrorCodes.X_INVALID_EXPRESSION]: `Error parsing JavaScript expression: `,
  [ErrorCodes.X_KEEP_ALIVE_INVALID_CHILDREN]: `<KeepAlive> expects exactly one child component.`,
  [ErrorCodes.X_VNODE_HOOKS]: `@vnode-* hooks in templates are no longer supported. Use the vue: prefix instead. For example, @vnode-mounted should be changed to @vue:mounted. @vnode-* hooks support has been removed in 3.4.`,

  // 通用编译错误。
  [ErrorCodes.X_PREFIX_ID_NOT_SUPPORTED]: `"prefixIdentifiers" option is not supported in this build of compiler.`,
  [ErrorCodes.X_MODULE_MODE_NOT_SUPPORTED]: `ES module mode is not supported in this build of compiler.`,
  [ErrorCodes.X_CACHE_HANDLER_NOT_SUPPORTED]: `"cacheHandlers" option is only supported when the "prefixIdentifiers" option is enabled.`,
  [ErrorCodes.X_SCOPE_ID_NOT_SUPPORTED]: `"scopeId" option is only supported in module mode.`,

  // 仅用于让映射覆盖枚举全部成员；不会作为真实错误抛出。
  [ErrorCodes.__EXTEND_POINT__]: ``,
}
