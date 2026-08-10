import path from 'path'
import {
  ConstantTypes,
  type ExpressionNode,
  type NodeTransform,
  NodeTypes,
  type SimpleExpressionNode,
  type SourceLocation,
  type TransformContext,
  createSimpleExpression,
} from '@vue/compiler-core'
import {
  isDataUrl,
  isExternalUrl,
  isRelativeUrl,
  normalizeDecodedImportPath,
  parseUrl,
} from './templateUtils'
import { isArray } from '@vue/shared'

/** 标签名到资源 URL 属性名列表的配置；`*` 可提供所有标签通配项。 */
export interface AssetURLTagConfig {
  /** 标签名对应需要检查并转换的 URL 属性名列表。 */
  [name: string]: string[]
}

/** 模板静态资源 URL 转换选项。 */
export interface AssetURLOptions {
  /**
   * 提供 base 后，相对 URL 直接拼成以 base 开头的 URL，不再生成模块 import。
   */
  base?: string | null
  /**
   * 是否连 `/assets/a.png` 这类根绝对路径也交给转换器处理。
   */
  includeAbsolute?: boolean
  /** 覆盖默认标签到资源属性的映射；可用 `*` 添加全局属性。 */
  tags?: AssetURLTagConfig
}

/**
 * 始终代表外部资源 URL 的内置标签属性。
 * SVG `use/image` 故意不在这里：仅 hash 的 `href="#clip"` 指向当前文档元素，不是模块；
 * 但它们仍出现在默认 tags 中，以便处理真正带路径的 URL。
 */
const resourceUrlTagConfig: AssetURLTagConfig = {
  video: ['src', 'poster'],
  source: ['src'],
  img: ['src'],
}

/** Vue SFC 默认进行资产 import 转换的标签/属性及路径策略。 */
export const defaultAssetUrlOptions: Required<AssetURLOptions> = {
  base: null,
  includeAbsolute: false,
  tags: {
    ...resourceUrlTagConfig,
    image: ['xlink:href', 'href'],
    use: ['xlink:href', 'href'],
  },
}

/**
 * 兼容旧版“直接传 tags map”格式，并补齐现代 AssetURLOptions 默认值。
 */
export const normalizeOptions = (
  options: AssetURLOptions | AssetURLTagConfig,
): Required<AssetURLOptions> => {
  if (Object.keys(options).some(key => isArray((options as any)[key]))) {
    // 任一顶层值为数组即视为旧 tags map，而不是带 base/includeAbsolute 的现代配置。
    return {
      ...defaultAssetUrlOptions,
      tags: options as any,
    }
  }
  return {
    ...defaultAssetUrlOptions,
    ...options,
  }
}

/** 将已规范化选项闭包成 compiler-core NodeTransform。 */
export const createAssetUrlTransformWithOptions = (
  options: Required<AssetURLOptions>,
): NodeTransform => {
  return (node, context) =>
    (transformAssetUrl as Function)(node, context, options)
}

/** 仅普通资源属性允许把 hash-only 值当模块子路径；SVG fragment 引用必须保留。 */
function canTransformHashImport(tag: string, attrName: string): boolean {
  return !!resourceUrlTagConfig[tag]?.includes(attrName)
}

/**
 * 将模板静态资源 URL 转换为模块 import 或基于 base 的绝对 URL。
 *
 * ``` js
 * // 转换前
 * createVNode('img', { src: './logo.png' })
 *
 * // 转换后
 * import _imports_0 from './logo.png'
 * createVNode('img', { src: _imports_0 })
 * ```
 */
export const transformAssetUrl: NodeTransform = (
  node,
  context,
  options: AssetURLOptions = defaultAssetUrlOptions,
) => {
  if (node.type === NodeTypes.ELEMENT) {
    if (!node.props.length) {
      return
    }

    const tags = options.tags || defaultAssetUrlOptions.tags
    const attrs = tags[node.tag]
    const wildCardAttrs = tags['*']
    if (!attrs && !wildCardAttrs) {
      return
    }

    const assetAttrs = (attrs || []).concat(wildCardAttrs || [])
    node.props.forEach((attr, index) => {
      if (
        attr.type !== NodeTypes.ATTRIBUTE ||
        !assetAttrs.includes(attr.name) ||
        !attr.value
      ) {
        return
      }

      const urlValue = attr.value.content
      const isHashOnlyValue = urlValue[0] === '#'
      if (
        isExternalUrl(urlValue) ||
        isDataUrl(urlValue) ||
        // 单独 `#` 永远不是合法 import specifier。
        urlValue === '#' ||
        (isHashOnlyValue && !canTransformHashImport(node.tag, attr.name)) ||
        (!options.includeAbsolute && !isRelativeUrl(urlValue))
      ) {
        return
      }

      const url = parseUrl(urlValue)
      if (options.base && urlValue[0] === '.') {
        // 显式 base 只直接重写 `.` 开头的相对路径，避免额外 import；base 允许包含完整主机名。
        const base = parseUrl(options.base)
        const protocol = base.protocol || ''
        const host = base.host ? protocol + '//' + base.host : ''
        const basePath = base.path || '/'

        // 浏览器包中的 path 是 rollup-plugin-node-builtins 提供的 posix-only 实现。
        attr.value.content =
          host +
          (path.posix || path).join(basePath, url.path + (url.hash || ''))
        return
      }

      // 其余候选 URL 改为 v-bind import 表达式，由 webpack/Vite 等构建器解析成最终地址。
      const exp = getImportsExpressionExp(url.path, url.hash, attr.loc, context)
      node.props[index] = {
        type: NodeTypes.DIRECTIVE,
        name: 'bind',
        arg: createSimpleExpression(attr.name, true, attr.loc),
        exp,
        modifiers: [],
        loc: attr.loc,
      }
    })
  }
}

/**
 * 复用或登记给定资源路径的 import。
 * @param source - 要导入的资源路径
 * @param loc - 原属性源码位置
 * @param context - 模板转换上下文
 * @returns import 局部名及其表达式节点
 */
function resolveOrRegisterImport(
  source: string,
  loc: SourceLocation,
  context: TransformContext,
): {
  /** 生成代码中使用的稳定 import 局部名。 */
  name: string
  /** 指向 import 局部名的常量简单表达式。 */
  exp: SimpleExpressionNode
} {
  const normalizedSource = normalizeDecodedImportPath(source)
  const existingIndex = context.imports.findIndex(
    i => i.path === normalizedSource,
  )
  if (existingIndex > -1) {
    return {
      name: `_imports_${existingIndex}`,
      exp: context.imports[existingIndex].exp as SimpleExpressionNode,
    }
  }

  const name = `_imports_${context.imports.length}`
  const exp = createSimpleExpression(
    name,
    false,
    loc,
    ConstantTypes.CAN_STRINGIFY,
  )

  // import specifier 中路径分隔符不能保持 `%2F` 等编码；入表前尽可能还原。
  context.imports.push({
    exp,
    path: normalizedSource,
  })

  return { name, exp }
}

/**
 * 根据 path/hash 组合生成资产 import 表达式，并复用可提升的 `import + hash`。
 */
function getImportsExpressionExp(
  path: string | null,
  hash: string | null,
  loc: SourceLocation,
  context: TransformContext,
): ExpressionNode {
  // path/hash 均为空时保持为空字符串常量。
  if (!path && !hash) {
    return createSimpleExpression(`''`, false, loc, ConstantTypes.CAN_STRINGIFY)
  }

  // 仅 hash：对允许的标签，它可能是包 subpath import，按完整 source 登记。
  if (!path && hash) {
    const { exp } = resolveOrRegisterImport(hash, loc, context)
    return exp
  }

  // 仅路径：直接复用/登记 import 表达式。
  if (path && !hash) {
    const { exp } = resolveOrRegisterImport(path, loc, context)
    return exp
  }

  // 同时含路径与 hash：构建器解析路径，运行时字符串拼接保留 fragment。
  const { name } = resolveOrRegisterImport(path!, loc, context)

  const hashExp = `${name} + '${hash}'`
  const finalExp = createSimpleExpression(
    hashExp,
    false,
    loc,
    ConstantTypes.CAN_STRINGIFY,
  )

  // 未启用静态提升时直接返回拼接表达式。
  if (!context.hoistStatic) {
    return finalExp
  }

  // 同一 `import + hash` 可能出现多次，先在 hoists 中按表达式内容复用。
  const existingHoistIndex = context.hoists.findIndex(h => {
    return (
      h &&
      h.type === NodeTypes.SIMPLE_EXPRESSION &&
      !h.isStatic &&
      h.content === hashExp
    )
  })

  // hoist 下标从 0 存储，生成变量名从 1 开始。
  if (existingHoistIndex > -1) {
    return createSimpleExpression(
      `_hoisted_${existingHoistIndex + 1}`,
      false,
      loc,
      ConstantTypes.CAN_STRINGIFY,
    )
  }

  // 首次出现则登记新 hoist，避免每次 render 重复拼接。
  return context.hoist(finalExp)
}
