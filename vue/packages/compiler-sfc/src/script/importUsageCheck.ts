import type { SFCDescriptor } from '../parse'
import type { SFCTemplateCompileOptions } from '../compileTemplate'
import {
  type ExpressionNode,
  NodeTypes,
  type SimpleExpressionNode,
  type TemplateChildNode,
  isSimpleIdentifier,
  parserOptions,
  walkIdentifiers,
} from '@vue/compiler-dom'
import type { LRUCache } from 'lru-cache'
import { createCache } from '../cache'
import { camelize, capitalize, isBuiltInDirective } from '@vue/shared'
import { resolveTemplateAST } from '../template/resolveTemplateAST'

/** 模板 import 使用分析真正需要的编译选项子集。 */
type TemplateOptions = Pick<
  SFCTemplateCompileOptions,
  'compiler' | 'compilerOptions' | 'ssr'
>

/**
 * 判断 script setup import 是否被模板使用。
 * 非 inline 模式据此决定 setup() 返回对象中要暴露哪些 import，并允许 TS 模式裁掉仅类型或
 * 完全未使用的导入。
 */
export function isImportUsed(
  local: string,
  sfc: SFCDescriptor,
  options?: TemplateOptions,
): boolean {
  return resolveTemplateUsedIdentifiers(sfc, options).has(local)
}

/** 一次模板遍历得到的普通使用标识符与简单 v-model 写目标。 */
type TemplateAnalysisResult = {
  /** 模板读取或引用的全部脚本标识符；轻量 v-model 分析时省略。 */
  usedIds?: Set<string>
  /** 简单 `v-model="id"` 的写入目标，用于 defineModel 优化。 */
  vModelIds: Set<string>
}

/** 按 template 内容缓存标识符分析，避免 HMR/多阶段编译重复遍历 AST。 */
export const templateAnalysisCache:
  | Map<string, TemplateAnalysisResult>
  | LRUCache<string, TemplateAnalysisResult> =
  createCache<TemplateAnalysisResult>()

/** 返回模板中 `v-model="simpleIdentifier"` 的直接写目标集合。 */
export function resolveTemplateVModelIdentifiers(
  sfc: SFCDescriptor,
  options?: TemplateOptions,
): Set<string> {
  return resolveTemplateAnalysisResult(sfc, false, options).vModelIds
}

/** 返回组件、指令、表达式、ref 等全部模板可见标识符。 */
function resolveTemplateUsedIdentifiers(
  sfc: SFCDescriptor,
  options?: TemplateOptions,
): Set<string> {
  return resolveTemplateAnalysisResult(sfc, true, options).usedIds!
}

/**
 * 解析干净模板 AST 并收集 script import 使用信息。
 * collectUsedIds=false 是 defineModel 所需的轻量路径，只查找简单 v-model 目标。
 */
function resolveTemplateAnalysisResult(
  sfc: SFCDescriptor,
  collectUsedIds = true,
  options?: TemplateOptions,
): {
  /** 模板使用标识符；仅 collectUsedIds=true 时存在。 */
  usedIds?: Set<string>
  /** 简单 v-model 写目标。 */
  vModelIds: Set<string>
} {
  const { content, ast } = sfc.template!
  const cached = templateAnalysisCache.get(content)
  if (cached && (!collectUsedIds || cached.usedIds)) {
    return cached
  }

  // 轻量模式跳过表达式 AST 标识符遍历，只收集 vModelIds。
  const ids = collectUsedIds ? new Set<string>() : undefined
  const vModelIds = new Set<string>()

  const root = resolveTemplateAST(ast, {
    compiler: options?.compiler,
    compilerOptions: options?.compilerOptions,
    ssr: options?.ssr,
    // SFC parse 阶段已经报告语法错误，此处是二次分析，避免重复诊断。
    onError: () => {},
  })

  root!.children.forEach(walk)

  /** 递归收集模板节点可能引用的 setup binding。 */
  function walk(node: TemplateChildNode) {
    switch (node.type) {
      case NodeTypes.ELEMENT:
        let tag = node.tag
        if (tag.includes('.')) tag = tag.split('.')[0].trim()
        if (
          !parserOptions.isNativeTag!(tag) &&
          !parserOptions.isBuiltInComponent!(tag)
        ) {
          if (ids) {
            ids.add(camelize(tag))
            ids.add(capitalize(camelize(tag)))
          }
        }
        for (let i = 0; i < node.props.length; i++) {
          const prop = node.props[i]
          if (prop.type === NodeTypes.DIRECTIVE) {
            if (ids) {
              if (!isBuiltInDirective(prop.name)) {
                ids.add(`v${capitalize(camelize(prop.name))}`)
              }
            }

            // 只收集简单 v-model 写目标；成员表达式不对应单个 setup binding 的替换决策。
            if (prop.name === 'model') {
              const exp = prop.exp
              if (exp && exp.type === NodeTypes.SIMPLE_EXPRESSION) {
                const expString = exp.content.trim()
                if (
                  isSimpleIdentifier(expString) &&
                  expString !== 'undefined'
                ) {
                  vModelIds.add(expString)
                }
              }
            }

            // 动态指令参数本身也是运行时表达式，例如 `:[attrName]`。
            if (
              ids &&
              prop.arg &&
              !(prop.arg as SimpleExpressionNode).isStatic
            ) {
              extractIdentifiers(ids, prop.arg)
            }

            if (ids) {
              if (prop.name === 'for') {
                extractIdentifiers(ids, prop.forParseResult!.source)
              } else if (prop.exp) {
                extractIdentifiers(ids, prop.exp)
              } else if (prop.name === 'bind' && !prop.exp) {
                // 同名 v-bind 简写 `:foo` 隐式读取变量 foo。
                ids.add(camelize((prop.arg as SimpleExpressionNode).content))
              }
            }
          }
          if (
            ids &&
            prop.type === NodeTypes.ATTRIBUTE &&
            prop.name === 'ref' &&
            prop.value?.content
          ) {
            ids.add(prop.value.content)
          }
        }
        node.children.forEach(walk)
        break
      case NodeTypes.INTERPOLATION:
        if (ids) extractIdentifiers(ids, node.content)
        break
    }
  }

  const result = { usedIds: ids, vModelIds }
  templateAnalysisCache.set(content, result)
  return result
}

/** 从已解析表达式 AST 提取引用标识符；解析失败/简单回退时使用原内容。 */
function extractIdentifiers(ids: Set<string>, node: ExpressionNode) {
  if (node.ast) {
    walkIdentifiers(node.ast, n => ids.add(n.name))
  } else if (node.ast === null) {
    ids.add((node as SimpleExpressionNode).content)
  }
}
