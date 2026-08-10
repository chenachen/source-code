import path from 'path'
import {
  ConstantTypes,
  type ExpressionNode,
  type NodeTransform,
  NodeTypes,
  type SimpleExpressionNode,
  createCompoundExpression,
  createSimpleExpression,
} from '@vue/compiler-core'
import {
  isDataUrl,
  isExternalUrl,
  isRelativeUrl,
  normalizeDecodedImportPath,
  parseUrl,
} from './templateUtils'
import {
  type AssetURLOptions,
  defaultAssetUrlOptions,
} from './transformAssetUrl'

/** HTML 中支持 srcset 候选列表的元素。 */
const srcsetTags = ['img', 'source']

/** 单个 srcset 图片候选及其 `1x/2x/480w` 描述符。 */
interface ImageCandidate {
  /** 单个候选图片 URL。 */
  url: string
  /** 可选像素密度或宽度描述符，例如 `2x`、`480w`。 */
  descriptor: string
}

/** tokenizer 保留下来的空白转义序列；解析候选前统一恢复为空格。 */
// 规范：http://w3c.github.io/html/semantics-embedded-content.html#ref-for-image-candidate-string-5
const escapedSpaceCharacters = /( |\\t|\\n|\\f|\\r)+/g

/** 将自定义资产 URL 选项闭包成 srcset NodeTransform。 */
export const createSrcsetTransformWithOptions = (
  options: Required<AssetURLOptions>,
): NodeTransform => {
  return (node, context) =>
    (transformSrcset as Function)(node, context, options)
}

/**
 * 把静态 `srcset` 中每个本地候选 URL 分别转换为 import，再拼回完整属性表达式。
 * 外链和 data URL 原样保留；descriptor 及候选顺序必须保持不变。
 */
export const transformSrcset: NodeTransform = (
  node,
  context,
  options: Required<AssetURLOptions> = defaultAssetUrlOptions,
) => {
  if (node.type === NodeTypes.ELEMENT) {
    if (srcsetTags.includes(node.tag) && node.props.length) {
      node.props.forEach((attr, index) => {
        if (attr.name === 'srcset' && attr.type === NodeTypes.ATTRIBUTE) {
          if (!attr.value) return
          const value = attr.value.content
          if (!value) return
          const imageCandidates: ImageCandidate[] = value.split(',').map(s => {
            // parser 传来的普通空格保持原样，其他空白以转义序列出现；统一后再拆 URL/描述符。
            const [url, descriptor] = s
              .replace(escapedSpaceCharacters, ' ')
              .trim()
              .split(' ', 2)
            return { url, descriptor }
          })

          // data URL 编码头自身含逗号，简单 split(',') 会拆成两项，需要与下一段重新合并。
          for (let i = 0; i < imageCandidates.length; i++) {
            const { url } = imageCandidates[i]
            if (isDataUrl(url)) {
              imageCandidates[i + 1].url =
                url + ',' + imageCandidates[i + 1].url
              imageCandidates.splice(i, 1)
            }
          }

          /** 判断候选 URL 是否应转为模块 import 或 base 拼接表达式。 */
          const shouldProcessUrl = (url: string) => {
            return (
              url &&
              !isExternalUrl(url) &&
              !isDataUrl(url) &&
              (options.includeAbsolute || isRelativeUrl(url))
            )
          }
          // 没有任何需交给构建器的 URL 时保留静态属性，减少生成代码。
          if (!imageCandidates.some(({ url }) => shouldProcessUrl(url))) {
            return
          }

          if (options.base) {
            // `.` 开头的候选可直接基于 base 改写；若仍有其他需 import 的候选，继续生成
            // 复合表达式，不能只更新部分静态字符串后提前返回。
            const base = options.base
            const set: string[] = []
            let needImportTransform = false

            imageCandidates.forEach(candidate => {
              let { url, descriptor } = candidate
              descriptor = descriptor ? ` ${descriptor}` : ``
              if (url[0] === '.') {
                candidate.url = (path.posix || path).join(base, url)
                set.push(candidate.url + descriptor)
              } else if (shouldProcessUrl(url)) {
                needImportTransform = true
              } else {
                set.push(url + descriptor)
              }
            })

            if (!needImportTransform) {
              attr.value.content = set.join(', ')
              return
            }
          }

          const compoundExpression = createCompoundExpression([], attr.loc)
          // 每个本地资源复用 imports 表，常量/外链变成字符串片段，再精确补回 descriptor 和逗号。
          imageCandidates.forEach(({ url, descriptor }, index) => {
            if (shouldProcessUrl(url)) {
              const { path, hash } = parseUrl(url)
              const source = path ? path : hash
              if (source) {
                const normalizedSource = normalizeDecodedImportPath(source)
                const existingImportsIndex = context.imports.findIndex(
                  i => i.path === normalizedSource,
                )
                let exp: SimpleExpressionNode
                if (existingImportsIndex > -1) {
                  exp = createSimpleExpression(
                    `_imports_${existingImportsIndex}`,
                    false,
                    attr.loc,
                    ConstantTypes.CAN_STRINGIFY,
                  )
                } else {
                  exp = createSimpleExpression(
                    `_imports_${context.imports.length}`,
                    false,
                    attr.loc,
                    ConstantTypes.CAN_STRINGIFY,
                  )
                  context.imports.push({ exp, path: normalizedSource })
                }
                if (path && hash) {
                  exp = createSimpleExpression(
                    `${exp.content} + '${hash}'`,
                    false,
                    attr.loc,
                    ConstantTypes.CAN_STRINGIFY,
                  )
                }
                compoundExpression.children.push(exp)
              }
            } else {
              const exp = createSimpleExpression(
                `"${url}"`,
                false,
                attr.loc,
                ConstantTypes.CAN_STRINGIFY,
              )
              compoundExpression.children.push(exp)
            }
            const isNotLast = imageCandidates.length - 1 > index
            if (descriptor && isNotLast) {
              compoundExpression.children.push(` + ' ${descriptor}, ' + `)
            } else if (descriptor) {
              compoundExpression.children.push(` + ' ${descriptor}'`)
            } else if (isNotLast) {
              compoundExpression.children.push(` + ', ' + `)
            }
          })

          let exp: ExpressionNode = compoundExpression
          if (context.hoistStatic) {
            // srcset 全部由 import/字符串常量组成，可提升到 render 外并参与静态字符串化。
            exp = context.hoist(compoundExpression)
            exp.constType = ConstantTypes.CAN_STRINGIFY
          }

          node.props[index] = {
            type: NodeTypes.DIRECTIVE,
            name: 'bind',
            arg: createSimpleExpression('srcset', true, attr.loc),
            exp,
            modifiers: [],
            loc: attr.loc,
          }
        }
      })
    }
  }
}
