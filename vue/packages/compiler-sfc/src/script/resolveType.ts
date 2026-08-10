import type {
  Expression,
  Identifier,
  Node,
  Statement,
  TSCallSignatureDeclaration,
  TSEnumDeclaration,
  TSExpressionWithTypeArguments,
  TSFunctionType,
  TSImportType,
  TSIndexedAccessType,
  TSInterfaceDeclaration,
  TSMappedType,
  TSMethodSignature,
  TSModuleBlock,
  TSModuleDeclaration,
  TSPropertySignature,
  TSQualifiedName,
  TSType,
  TSTypeAnnotation,
  TSTypeElement,
  TSTypeLiteral,
  TSTypeQuery,
  TSTypeReference,
  TemplateLiteral,
} from '@babel/types'
import {
  UNKNOWN_TYPE,
  createGetCanonicalFileName,
  getId,
  getImportedName,
  getStringLiteralKey,
  joinPaths,
  normalizePath,
} from './utils'
import { type ScriptCompileContext, resolveParserPlugins } from './context'
import type { ImportBinding, SFCScriptCompileOptions } from '../compileScript'
import { capitalize, hasOwn } from '@vue/shared'
import { parse as babelParse } from '@babel/parser'
import { parse } from '../parse'
import { createCache } from '../cache'
import type TS from 'typescript'
import { dirname, extname, join } from 'path'
import { minimatch as isMatch } from 'minimatch'
import * as process from 'process'

/** 在非完整 SFC 场景调用类型解析所需的最小选项。 */
export type SimpleTypeResolveOptions = Partial<
  Pick<
    SFCScriptCompileOptions,
    'globalTypeFiles' | 'fs' | 'babelParserPlugins' | 'isProd'
  >
>

/**
 * SimpleTypeResolveContext 与 ScriptCompileContext 的类型解析接口兼容，但只要求最少字段。
 * Babel 插件等非 SFC 场景可独立复用 resolveType，最简单的上下文如下：
 * ```ts
 * const ctx: SimpleTypeResolveContext = {
 *   filename: '...',
 *   source: '...',
 *   options: {},
 *   error() {},
 *   ast: []
 * }
 * ```
 */
export type SimpleTypeResolveContext = Pick<
  ScriptCompileContext,
  // 当前文件
  | 'source'
  | 'filename'

  // 诊断、helper 与源码读取工具
  | 'error'
  | 'warn'
  | 'helper'
  | 'getString'

  // props 类型推导输入
  | 'propsTypeDecl'
  | 'propsRuntimeDefaults'
  | 'propsDestructuredBindings'

  // emits 类型推导输入
  | 'emitsTypeDecl'

  // Custom Element 生成策略
  | 'isCE'
> &
  Partial<
    Pick<ScriptCompileContext, 'scope' | 'globalScopes' | 'deps' | 'fs'>
  > & {
    /** 待分析脚本的顶层 Babel 语句。 */
    ast: Statement[]
    /** 独立类型解析入口的文件系统与 tsconfig 配置。 */
    options: SimpleTypeResolveOptions
  }

/** 完整或精简类型解析上下文，并带“忽略 extends 失败”的内部软失败开关。 */
export type TypeResolveContext = (
  ScriptCompileContext | SimpleTypeResolveContext
) & {
  /** extends 无法解析时是否允许回退为局部属性，而不立即抛错。 */
  silentOnExtendsFailure?: boolean
}

/** 类型作用域只需记录 import 来源与原始导入名。 */
type Import = Pick<ImportBinding, 'source' | 'imported'>

/** 附着到解析后类型节点上的所属作用域。 */
interface WithScope {
  /** 声明该类型节点的文件或 namespace 作用域。 */
  _ownerScope: TypeScope
}

/** 已登记进 TypeScope 的类型节点；总带 ownerScope，并可合并同名 namespace。 */
type ScopeTypeNode = Node &
  WithScope & {
    /** 与 class/interface/enum 同名合并的 namespace 声明。 */
    _ns?: TSModuleDeclaration & WithScope
  }

/**
 * 单个源文件或 TypeScript namespace 的类型符号表。
 * imports/types/declares 使用原型链建立子作用域；exported* 单独记录跨模块可见成员。
 */
export class TypeScope {
  /** 创建文件或 namespace 作用域；子作用域可把符号表设为父表原型实现逐级查找。 */
  constructor(
    public filename: string,
    public source: string,
    public offset: number = 0,
    public imports: Record<string, Import> = Object.create(null),
    public types: Record<string, ScopeTypeNode> = Object.create(null),
    public declares: Record<string, ScopeTypeNode> = Object.create(null),
  ) {}
  /** 泛型实参创建的临时作用域，不能缓存依赖具体实参的解析结果。 */
  isGenericScope = false
  /** 模块 specifier 到已解析绝对路径的缓存。 */
  resolvedImportSources: Record<string, string> = Object.create(null)
  /** 可由其他模块按类型位置导入的符号。 */
  exportedTypes: Record<string, ScopeTypeNode> = Object.create(null)
  /** 可由 typeof 查询的导出值声明。 */
  exportedDeclares: Record<string, ScopeTypeNode> = Object.create(null)
}

/** 可能尚未登记所属类型作用域的节点。 */
export interface MaybeWithScope {
  /** 节点尚未登记进符号表时可以没有 owner scope。 */
  _ownerScope?: TypeScope
}

/** 宏类型展开后的属性签名与调用签名集合。 */
interface ResolvedElements {
  /** 展开 interface、交叉/联合和工具类型后得到的属性签名表。 */
  props: Record<
    string,
    (TSPropertySignature | TSMethodSignature) & {
      /** 原声明作用域，用于继续解析成员类型并记录 HMR 依赖。 */
      _ownerScope: TypeScope
    }
  >
  /** 函数类型或 callable interface 中的调用签名，主要用于类型式 defineEmits。 */
  calls?: (TSCallSignatureDeclaration | TSFunctionType)[]
}

/** 若解析结果来自其他文件，将其登记为当前 SFC 的类型/HMR 依赖。 */
function recordScopeDep(
  ctx: TypeResolveContext,
  scope: TypeScope | undefined,
): void {
  if (scope && scope.filename !== ctx.filename) {
    ;(ctx.deps || (ctx.deps = new Set())).add(scope.filename)
  }
}

/** 从缓存的已解析属性中补记所有跨文件依赖。 */
function recordResolvedElementDeps(
  ctx: TypeResolveContext,
  { props }: ResolvedElements,
): void {
  for (const key in props) {
    recordScopeDep(ctx, props[key]._ownerScope)
  }
}

/**
 * 把任意可支持的 TS 类型展开为属性/调用签名，供运行时 props 或 emits 生成。
 * 无泛型实参时结果缓存到 AST 节点；读取缓存仍会重放依赖登记，保证 HMR 信息完整。
 */
export function resolveTypeElements(
  ctx: TypeResolveContext,
  node: Node &
    MaybeWithScope & {
      /** 不依赖泛型实参时缓存的类型展开结果。 */
      _resolvedElements?: ResolvedElements
    },
  scope?: TypeScope,
  typeParameters?: Record<string, Node>,
): ResolvedElements {
  const canCache = !typeParameters
  if (canCache && node._resolvedElements) {
    recordResolvedElementDeps(ctx, node._resolvedElements)
    return node._resolvedElements
  }
  const resolved = innerResolveTypeElements(
    ctx,
    node,
    node._ownerScope || scope || ctxToScope(ctx),
    typeParameters,
  )
  return canCache ? (node._resolvedElements = resolved) : resolved
}

/** resolveTypeElements 的递归实现，处理类型别名、引用、联合、映射及内置工具类型。 */
function innerResolveTypeElements(
  ctx: TypeResolveContext,
  node: Node,
  scope: TypeScope,
  typeParameters?: Record<string, Node>,
): ResolvedElements {
  if (hasVueIgnore(node)) {
    if (
      (node.type === 'TSIntersectionType' || node.type === 'TSUnionType') &&
      node.types.length > 1
    ) {
      // Babel 会把第一个联合/交叉成员前的注释放到父节点；`@vue-ignore` 只应忽略首成员，
      // 否则其余可解析成员也会被意外丢弃。
      return mergeElements(
        [
          { props: {} },
          ...node.types
            .slice(1)
            .map(t => resolveTypeElements(ctx, t, scope, typeParameters)),
        ],
        node.type,
      )
    }
    return { props: {} }
  }
  switch (node.type) {
    case 'TSTypeLiteral':
      return typeElementsToMap(ctx, node.members, scope, typeParameters)
    case 'TSInterfaceDeclaration':
      return resolveInterfaceMembers(ctx, node, scope, typeParameters)
    case 'TSTypeAliasDeclaration':
    case 'TSTypeAnnotation':
    case 'TSParenthesizedType':
      return resolveTypeElements(
        ctx,
        node.typeAnnotation,
        scope,
        typeParameters,
      )
    case 'TSFunctionType': {
      return { props: {}, calls: [node] }
    }
    case 'TSUnionType':
    case 'TSIntersectionType':
      return mergeElements(
        node.types.map(t => resolveTypeElements(ctx, t, scope, typeParameters)),
        node.type,
      )
    case 'TSMappedType':
      return resolveMappedType(ctx, node, scope, typeParameters)
    case 'TSIndexedAccessType': {
      const types = resolveIndexType(ctx, node, scope)
      return mergeElements(
        types.map(t => resolveTypeElements(ctx, t, t._ownerScope)),
        'TSUnionType',
      )
    }
    case 'TSExpressionWithTypeArguments': // interface extends 使用的引用形态
    case 'TSTypeReference': {
      const typeName = getReferenceName(node)
      if (
        (typeName === 'ExtractPropTypes' ||
          typeName === 'ExtractPublicPropTypes') &&
        node.typeParameters &&
        scope.imports[typeName]?.source === 'vue'
      ) {
        return resolveExtractPropTypes(
          resolveTypeElements(
            ctx,
            node.typeParameters.params[0],
            scope,
            typeParameters,
          ),
          scope,
        )
      }
      const resolved = resolveTypeReference(ctx, node, scope)
      if (resolved) {
        let typeParams: Record<string, Node> | undefined
        if (
          (resolved.type === 'TSTypeAliasDeclaration' ||
            resolved.type === 'TSInterfaceDeclaration') &&
          resolved.typeParameters &&
          node.typeParameters
        ) {
          typeParams = Object.create(null)
          resolved.typeParameters.params.forEach((p, i) => {
            let param = typeParameters && typeParameters[p.name]
            if (!param) param = node.typeParameters!.params[i]
            typeParams![p.name] = param
          })
        }
        return resolveTypeElements(
          ctx,
          resolved,
          resolved._ownerScope,
          typeParams,
        )
      } else {
        if (typeof typeName === 'string') {
          if (typeParameters && typeParameters[typeName]) {
            return resolveTypeElements(
              ctx,
              typeParameters[typeName],
              scope,
              typeParameters,
            )
          }
          if (
            // @ts-expect-error
            SupportedBuiltinsSet.has(typeName)
          ) {
            return resolveBuiltin(
              ctx,
              node,
              typeName as any,
              scope,
              typeParameters,
            )
          } else if (typeName === 'ReturnType' && node.typeParameters) {
            // ReturnType 仅做有限支持：参数需能解析到明确的函数引用。
            const ret = resolveReturnType(
              ctx,
              node.typeParameters.params[0],
              scope,
            )
            if (ret) {
              return resolveTypeElements(ctx, ret, scope)
            }
          }
        }
        return ctx.error(
          `Unresolvable type reference or unsupported built-in utility type`,
          node,
          scope,
        )
      }
    }
    case 'TSImportType': {
      if (
        getId(node.argument) === 'vue' &&
        node.qualifier?.type === 'Identifier' &&
        node.qualifier.name === 'ExtractPropTypes' &&
        node.typeParameters
      ) {
        return resolveExtractPropTypes(
          resolveTypeElements(ctx, node.typeParameters.params[0], scope),
          scope,
        )
      }
      const sourceScope = importSourceToScope(
        ctx,
        node.argument,
        scope,
        node.argument.value,
      )
      const resolved = resolveTypeReference(ctx, node, sourceScope)
      if (resolved) {
        return resolveTypeElements(ctx, resolved, resolved._ownerScope)
      }
      break
    }
    case 'TSTypeQuery':
      {
        const resolved = resolveTypeReference(ctx, node, scope)
        if (resolved) {
          return resolveTypeElements(ctx, resolved, resolved._ownerScope)
        }
      }
      break
  }
  return ctx.error(`Unresolvable type: ${node.type}`, node, scope)
}

/** 将 type literal/interface body 成员整理成按静态属性名索引的映射。 */
function typeElementsToMap(
  ctx: TypeResolveContext,
  elements: TSTypeElement[],
  scope = ctxToScope(ctx),
  typeParameters?: Record<string, Node>,
): ResolvedElements {
  const res: ResolvedElements = { props: {} }
  for (const e of elements) {
    if (e.type === 'TSPropertySignature' || e.type === 'TSMethodSignature') {
      // 泛型实参属于本次引用，建立临时子作用域附到成员上，避免污染原声明作用域。
      if (typeParameters) {
        scope = createChildScope(scope)
        scope.isGenericScope = true
        Object.assign(scope.types, typeParameters)
      }
      ;(e as MaybeWithScope)._ownerScope = scope
      const name = getStringLiteralKey(e)
      if (name !== null) {
        res.props[name] = e as ResolvedElements['props'][string]
      } else {
        ctx.error(
          `Unsupported computed key in type referenced by a macro`,
          e.key,
          scope,
        )
      }
    } else if (e.type === 'TSCallSignatureDeclaration') {
      ;(res.calls || (res.calls = [])).push(e)
    }
  }
  return res
}

/** 判断节点前是否有显式 `/* @vue-ignore *\/`，允许用户跳过无法解析的类型分支。 */
function hasVueIgnore(node: Node): boolean {
  return !!(
    node.leadingComments &&
    node.leadingComments.some(c => c.value.includes('@vue-ignore'))
  )
}

/**
 * 合并联合/交叉类型各分支的成员。
 * 同名属性合成为对应 union/intersection 类型，optional 只要任一来源可选即按可选处理；
 * 调用签名则全部保留给 defineEmits 提取。
 */
function mergeElements(
  maps: ResolvedElements[],
  type: 'TSUnionType' | 'TSIntersectionType',
): ResolvedElements {
  if (maps.length === 1) return maps[0]
  const res: ResolvedElements = { props: {} }
  const { props: baseProps } = res
  for (const { props, calls } of maps) {
    for (const key in props) {
      if (!hasOwn(baseProps, key)) {
        baseProps[key] = props[key]
      } else {
        baseProps[key] = createProperty(
          baseProps[key].key,
          {
            type,
            // @ts-expect-error
            types: [baseProps[key], props[key]],
          },
          baseProps[key]._ownerScope,
          baseProps[key].optional || props[key].optional,
        )
      }
    }
    if (calls) {
      ;(res.calls || (res.calls = [])).push(...calls)
    }
  }
  return res
}

/** 创建 compiler-sfc 内部合成的 TSPropertySignature，并附上来源作用域。 */
function createProperty(
  key: Expression,
  typeAnnotation: TSType,
  scope: TypeScope,
  optional: boolean,
): TSPropertySignature & WithScope {
  return {
    type: 'TSPropertySignature',
    key,
    kind: 'get',
    optional,
    typeAnnotation: {
      type: 'TSTypeAnnotation',
      typeAnnotation,
    },
    _ownerScope: scope,
  }
}

/**
 * 展开 interface 自身及 extends 的成员。
 * inferRuntimeType 场景会软忽略无法解析的基类，仍保留当前 interface 自身属性；正常 props
 * 提取则报告错误，并提示用 @vue-ignore 接受基类属性退化为 fallthrough attrs。
 */
function resolveInterfaceMembers(
  ctx: TypeResolveContext,
  node: TSInterfaceDeclaration & MaybeWithScope,
  scope: TypeScope,
  typeParameters?: Record<string, Node>,
): ResolvedElements {
  const base = typeElementsToMap(
    ctx,
    node.body.body,
    node._ownerScope,
    typeParameters,
  )
  if (node.extends) {
    for (const ext of node.extends) {
      try {
        const { props, calls } = resolveTypeElements(ctx, ext, scope)
        for (const key in props) {
          if (!hasOwn(base.props, key)) {
            base.props[key] = props[key]
          }
        }
        if (calls) {
          ;(base.calls || (base.calls = [])).push(...calls)
        }
      } catch (e) {
        // 运行时构造器推导采用尽力而为策略：基类失败不能连当前 interface 自身属性也丢掉。
        if (!ctx.silentOnExtendsFailure) {
          ctx.error(
            `Failed to resolve extends base type.\nIf this previously worked in 3.2, ` +
              `you can instruct the compiler to ignore this extend by adding ` +
              `/* @vue-ignore */ before it, for example:\n\n` +
              `interface Props extends /* @vue-ignore */ Base {}\n\n` +
              `Note: both in 3.2 or with the ignore, the properties in the base ` +
              `type are treated as fallthrough attrs at runtime.`,
            ext,
            scope,
          )
        }
      }
    }
  }
  return base
}

/**
 * 展开键集合有限的 mapped type，为每个静态键合成同类型的属性签名。
 * `as` 重映射存在时建立包含映射参数的泛型子作用域，再解析最终键字符串。
 */
function resolveMappedType(
  ctx: TypeResolveContext,
  node: TSMappedType,
  scope: TypeScope,
  typeParameters?: Record<string, Node>,
): ResolvedElements {
  const res: ResolvedElements = { props: {} }
  let keys: string[]
  if (node.nameType) {
    const { name, constraint } = node.typeParameter
    scope = createChildScope(scope)
    Object.assign(scope.types, { ...typeParameters, [name]: constraint })
    keys = resolveStringType(ctx, node.nameType, scope)
  } else {
    keys = resolveStringType(ctx, node.typeParameter.constraint!, scope)
  }
  for (const key of keys) {
    res.props[key] = createProperty(
      {
        type: 'Identifier',
        name: key,
      },
      node.typeAnnotation!,
      scope,
      !!node.optional,
    )
  }
  return res
}

/**
 * 解析 `T[K]` 为实际成员类型列表。
 * number 索引读取数组/元组元素；string 索引取全部静态键；字面量联合只取命中属性。
 */
function resolveIndexType(
  ctx: TypeResolveContext,
  node: TSIndexedAccessType,
  scope: TypeScope,
): (TSType & MaybeWithScope)[] {
  if (node.indexType.type === 'TSNumberKeyword') {
    return resolveArrayElementType(ctx, node.objectType, scope)
  }

  const { indexType, objectType } = node
  const types: TSType[] = []
  let keys: string[]
  let resolved: ResolvedElements
  if (indexType.type === 'TSStringKeyword') {
    resolved = resolveTypeElements(ctx, objectType, scope)
    keys = Object.keys(resolved.props)
  } else {
    keys = resolveStringType(ctx, indexType, scope)
    resolved = resolveTypeElements(ctx, objectType, scope)
  }
  for (const key of keys) {
    const targetType = resolved.props[key]?.typeAnnotation?.typeAnnotation
    if (targetType) {
      ;(targetType as TSType & MaybeWithScope)._ownerScope =
        resolved.props[key]._ownerScope
      types.push(targetType)
    }
  }
  return types
}

/** 从 `T[]`、tuple、`Array<T>` 或其别名中取得元素类型。 */
function resolveArrayElementType(
  ctx: TypeResolveContext,
  node: Node,
  scope: TypeScope,
): TSType[] {
  // `T[]`。
  if (node.type === 'TSArrayType') {
    return [node.elementType]
  }
  // tuple（具名 tuple member 取内部 elementType）。
  if (node.type === 'TSTupleType') {
    return node.elementTypes.map(t =>
      t.type === 'TSNamedTupleMember' ? t.elementType : t,
    )
  }
  if (node.type === 'TSTypeReference') {
    // `Array<T>` 或可继续解析为数组类型的引用。
    if (getReferenceName(node) === 'Array' && node.typeParameters) {
      return node.typeParameters.params
    } else {
      const resolved = resolveTypeReference(ctx, node, scope)
      if (resolved) {
        return resolveArrayElementType(ctx, resolved, scope)
      }
    }
  }
  return ctx.error(
    'Failed to resolve element type from target type',
    node,
    scope,
  )
}

/**
 * 把类型解析为有限字符串键集合，供 mapped/Pick/Omit/索引访问使用。
 * 支持字面量联合、模板字面量、泛型参数及常见字符串工具类型；无法枚举的 string 会报错。
 */
function resolveStringType(
  ctx: TypeResolveContext,
  node: Node,
  scope: TypeScope,
  typeParameters?: Record<string, Node>,
): string[] {
  switch (node.type) {
    case 'StringLiteral':
      return [node.value]
    case 'TSLiteralType':
      return resolveStringType(ctx, node.literal, scope, typeParameters)
    case 'TSUnionType':
      return node.types
        .map(t => resolveStringType(ctx, t, scope, typeParameters))
        .flat()
    case 'TemplateLiteral': {
      return resolveTemplateKeys(ctx, node, scope)
    }
    case 'TSTypeReference': {
      const resolved = resolveTypeReference(ctx, node, scope)
      if (resolved) {
        return resolveStringType(ctx, resolved, scope, typeParameters)
      }
      if (node.typeName.type === 'Identifier') {
        const name = node.typeName.name
        if (typeParameters && typeParameters[name]) {
          return resolveStringType(
            ctx,
            typeParameters[name],
            scope,
            typeParameters,
          )
        }
        /** 展开指定位置的工具类型参数为字符串字面量集合。 */
        const getParam = (index = 0) =>
          resolveStringType(
            ctx,
            node.typeParameters!.params[index],
            scope,
            typeParameters,
          )
        switch (name) {
          case 'Extract':
            return getParam(1)
          case 'Exclude': {
            const excluded = getParam(1)
            return getParam().filter(s => !excluded.includes(s))
          }
          case 'Uppercase':
            return getParam().map(s => s.toUpperCase())
          case 'Lowercase':
            return getParam().map(s => s.toLowerCase())
          case 'Capitalize':
            return getParam().map(capitalize)
          case 'Uncapitalize':
            return getParam().map(s => s[0].toLowerCase() + s.slice(1))
          default:
            ctx.error(
              'Unsupported type when resolving index type',
              node.typeName,
              scope,
            )
        }
      }
    }
  }
  return ctx.error('Failed to resolve index type into finite keys', node, scope)
}

/**
 * 递归计算模板字面量类型的笛卡尔积，例如 `` `on${'Click'|'Input'}` ``。
 */
function resolveTemplateKeys(
  ctx: TypeResolveContext,
  node: TemplateLiteral,
  scope: TypeScope,
): string[] {
  if (!node.expressions.length) {
    return [node.quasis[0].value.raw]
  }

  const res: string[] = []
  const e = node.expressions[0]
  const q = node.quasis[0]
  const leading = q ? q.value.raw : ``
  const resolved = resolveStringType(ctx, e, scope)
  const restResolved = resolveTemplateKeys(
    ctx,
    {
      ...node,
      expressions: node.expressions.slice(1),
      quasis: q ? node.quasis.slice(1) : node.quasis,
    },
    scope,
  )

  for (const r of resolved) {
    for (const rr of restResolved) {
      res.push(leading + r + rr)
    }
  }

  return res
}

/** resolveTypeElements 可结构化展开的 TypeScript 工具类型白名单。 */
const SupportedBuiltinsSet = new Set([
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
] as const)

/** 从 Set 类型提取成员联合，用于保持 resolveBuiltin 的 name 与白名单同步。 */
type GetSetType<T> = T extends Set<infer V> ? V : never

/** 实现 Partial/Required/Readonly/Pick/Omit 对已解析属性集合的变换。 */
function resolveBuiltin(
  ctx: TypeResolveContext,
  node: TSTypeReference | TSExpressionWithTypeArguments,
  name: GetSetType<typeof SupportedBuiltinsSet>,
  scope: TypeScope,
  typeParameters?: Record<string, Node>,
): ResolvedElements {
  const t = resolveTypeElements(
    ctx,
    node.typeParameters!.params[0],
    scope,
    typeParameters,
  )
  switch (name) {
    case 'Partial': {
      const res: ResolvedElements = { props: {}, calls: t.calls }
      Object.keys(t.props).forEach(key => {
        res.props[key] = { ...t.props[key], optional: true }
      })
      return res
    }
    case 'Required': {
      const res: ResolvedElements = { props: {}, calls: t.calls }
      Object.keys(t.props).forEach(key => {
        res.props[key] = { ...t.props[key], optional: false }
      })
      return res
    }
    case 'Readonly':
      return t
    case 'Pick': {
      const picked = resolveStringType(
        ctx,
        node.typeParameters!.params[1],
        scope,
        typeParameters,
      )
      const res: ResolvedElements = { props: {}, calls: t.calls }
      for (const key of picked) {
        res.props[key] = t.props[key]
      }
      return res
    }
    case 'Omit':
      const omitted = resolveStringType(
        ctx,
        node.typeParameters!.params[1],
        scope,
        typeParameters,
      )
      const res: ResolvedElements = { props: {}, calls: t.calls }
      for (const key in t.props) {
        if (!omitted.includes(key)) {
          res.props[key] = t.props[key]
        }
      }
      return res
  }
}

/** 所有可按名称查找目标声明的 Babel TS 引用节点。 */
type ReferenceTypes =
  TSTypeReference | TSExpressionWithTypeArguments | TSImportType | TSTypeQuery

/**
 * 解析类型引用并缓存结果；泛型临时作用域依赖实参，禁止把结果挂到共享 AST 节点。
 */
function resolveTypeReference(
  ctx: TypeResolveContext,
  node: ReferenceTypes & {
    /** 在非泛型作用域中缓存的引用目标声明。 */
    _resolvedReference?: ScopeTypeNode
  },
  scope?: TypeScope,
  name?: string,
  onlyExported = false,
): ScopeTypeNode | undefined {
  const canCache = !scope?.isGenericScope
  if (canCache && node._resolvedReference) {
    recordScopeDep(ctx, node._resolvedReference._ownerScope)
    return node._resolvedReference
  }
  const resolved = innerResolveTypeReference(
    ctx,
    scope || ctxToScope(ctx),
    name || getReferenceName(node),
    node,
    onlyExported,
  )
  return canCache ? (node._resolvedReference = resolved) : resolved
}

/**
 * 按“import → 当前作用域 → globalTypeFiles”顺序解析简单名称；限定名则逐层进入 namespace。
 */
function innerResolveTypeReference(
  ctx: TypeResolveContext,
  scope: TypeScope,
  name: string | string[],
  node: ReferenceTypes,
  onlyExported: boolean,
): ScopeTypeNode | undefined {
  if (typeof name === 'string') {
    if (scope.imports[name]) {
      return resolveTypeFromImport(ctx, node, name, scope)
    } else {
      const lookupSource =
        node.type === 'TSTypeQuery'
          ? onlyExported
            ? scope.exportedDeclares
            : scope.declares
          : onlyExported
            ? scope.exportedTypes
            : scope.types
      if (lookupSource[name]) {
        return lookupSource[name]
      } else {
        // 当前文件未命中时回退到用户配置的全局声明文件，并记录实际来源依赖。
        const globalScopes = resolveGlobalScope(ctx)
        if (globalScopes) {
          for (const s of globalScopes) {
            const src = node.type === 'TSTypeQuery' ? s.declares : s.types
            if (src[name]) {
              ;(ctx.deps || (ctx.deps = new Set())).add(s.filename)
              const resolved = src[name]
              if (resolved._ownerScope && resolved._ownerScope !== s) {
                ctx.deps.add(resolved._ownerScope.filename)
              }
              return resolved
            }
          }
        }
      }
    }
  } else {
    let ns = innerResolveTypeReference(ctx, scope, name[0], node, onlyExported)
    if (ns) {
      if (ns.type !== 'TSModuleDeclaration') {
        // namespace 可与 class/interface/enum 同名合并，此时挂在实体节点的 `_ns` 上。
        ns = ns._ns
      }
      if (ns) {
        const childScope = moduleDeclToScope(ctx, ns, ns._ownerScope || scope)
        return innerResolveTypeReference(
          ctx,
          childScope,
          name.length > 2 ? name.slice(1) : name[name.length - 1],
          node,
          !ns.declare,
        )
      }
    }
  }
}

/** 将各种引用节点统一提取为简单名称或 namespace 路径。 */
function getReferenceName(node: ReferenceTypes): string | string[] {
  const ref =
    node.type === 'TSTypeReference'
      ? node.typeName
      : node.type === 'TSExpressionWithTypeArguments'
        ? node.expression
        : node.type === 'TSImportType'
          ? node.qualifier
          : node.exprName
  if (ref?.type === 'Identifier') {
    return ref.name
  } else if (ref?.type === 'TSQualifiedName') {
    return qualifiedNameToPath(ref)
  } else {
    return 'default'
  }
}

/** 把递归 TSQualifiedName（如 A.B.C）展平为路径数组。 */
function qualifiedNameToPath(node: Identifier | TSQualifiedName): string[] {
  if (node.type === 'Identifier') {
    return [node.name]
  } else {
    return [...qualifiedNameToPath(node.left), node.right.name]
  }
}

/** 加载 options.globalTypeFiles 为全局查找作用域。 */
function resolveGlobalScope(ctx: TypeResolveContext): TypeScope[] | undefined {
  if (ctx.options.globalTypeFiles) {
    const fs = resolveFS(ctx)
    if (!fs) {
      throw new Error('[vue/compiler-sfc] globalTypeFiles requires fs access.')
    }
    return ctx.options.globalTypeFiles.map(file =>
      fileToScope(ctx, normalizePath(file), true),
    )
  }
}

/** 延迟加载并在进程内复用的 TypeScript 模块。 */
let ts: typeof TS | undefined
/** 由 Node 入口注册的 TypeScript 加载器；浏览器构建默认不存在。 */
let loadTS: (() => typeof TS) | undefined

/**
 * 注册延迟 TypeScript 加载函数，并把缺少 peer dependency 转换为清晰诊断。
 * @private 内部构建入口使用
 */
export function registerTS(_loadTS: () => typeof TS): void {
  loadTS = () => {
    try {
      return _loadTS()
    } catch (err: any) {
      if (
        typeof err.message === 'string' &&
        err.message.includes('Cannot find module')
      ) {
        throw new Error(
          'Failed to load TypeScript, which is required for resolving imported types. ' +
            'Please make sure "TypeScript" is installed as a project dependency.',
        )
      } else {
        throw new Error(
          'Failed to load TypeScript for resolving imported types.',
        )
      }
    }
  }
}

/** 类型解析所需的最小文件系统接口。 */
type FS = NonNullable<SFCScriptCompileOptions['fs']>

/**
 * 解析并缓存文件系统适配器；处理 TS resolver 为 `.vue` 虚构的 `.vue.ts` 文件名。
 */
function resolveFS(ctx: TypeResolveContext): FS | undefined {
  if (ctx.fs) {
    return ctx.fs
  }
  if (!ts && loadTS) {
    ts = loadTS()
  }
  const fs = ctx.options.fs || ts?.sys
  if (!fs) {
    return
  }
  return (ctx.fs = {
    /** 判断依赖是否存在，并把 TS 为 Vue 文件构造的 `.vue.ts` 名还原为 `.vue`。 */
    fileExists(file) {
      if (file.endsWith('.vue.ts') && !file.endsWith('.d.vue.ts')) {
        file = file.replace(/\.ts$/, '')
      }
      return fs.fileExists(file)
    },
    /** 读取依赖源码，并同样还原虚构的 `.vue.ts` 文件名。 */
    readFile(file) {
      if (file.endsWith('.vue.ts') && !file.endsWith('.d.vue.ts')) {
        file = file.replace(/\.ts$/, '')
      }
      return fs.readFile(file)
    },
    realpath: fs.realpath,
  })
}

/** 跟随当前作用域 import 到源文件，并只从其 exported 符号中解析目标。 */
function resolveTypeFromImport(
  ctx: TypeResolveContext,
  node: ReferenceTypes,
  name: string,
  scope: TypeScope,
): ScopeTypeNode | undefined {
  const { source, imported } = scope.imports[name]
  const sourceScope = importSourceToScope(ctx, node, scope, source)
  return resolveTypeReference(ctx, node, sourceScope, imported, true)
}

/**
 * 将 import specifier 解析为文件并加载 TypeScope。
 * 相对路径先走轻量扩展名探测；包名/alias 使用完整 TS 模块解析。结果按当前作用域缓存，
 * 默认同时登记为 HMR 类型依赖。
 */
function importSourceToScope(
  ctx: TypeResolveContext,
  node: Node,
  scope: TypeScope,
  source: string,
  trackDep = true,
): TypeScope {
  let fs: FS | undefined
  try {
    fs = resolveFS(ctx)
  } catch (err: any) {
    return ctx.error(err.message, node, scope)
  }
  if (!fs) {
    return ctx.error(
      `No fs option provided to \`compileScript\` in non-Node environment. ` +
        `File system access is required for resolving imported types.`,
      node,
      scope,
    )
  }

  let resolved: string | undefined = scope.resolvedImportSources[source]
  if (!resolved) {
    if (source.startsWith('..')) {
      // Windows 的 dirname 可能带盘符，需要原生 join；其他平台统一走 posix 缓存路径。
      const osSpecificJoinFn = process.platform === 'win32' ? join : joinPaths

      const filename = osSpecificJoinFn(dirname(scope.filename), source)
      resolved = resolveExt(filename, fs)
    } else if (source[0] === '.') {
      // 同目录相对 import 直接按扩展名探测，避免启动完整 TypeScript resolver。
      const filename = joinPaths(dirname(scope.filename), source)
      resolved = resolveExt(filename, fs)
    } else {
      // 包名或 tsconfig alias 需要完整 TypeScript resolver，仅 Node/CJS 构建支持。
      if (!__CJS__) {
        return ctx.error(
          `Type import from non-relative sources is not supported in the browser build.`,
          node,
          scope,
        )
      }
      if (!ts) {
        if (loadTS) ts = loadTS()
        if (!ts) {
          return ctx.error(
            `Failed to resolve import source ${JSON.stringify(source)}. ` +
              `TypeScript is required as a peer dep for vue in order ` +
              `to support resolving types from module imports.`,
            node,
            scope,
          )
        }
      }
      resolved = resolveWithTS(scope.filename, source, ts, fs)
    }
    if (!resolved && source[0] === '.' && __CJS__) {
      if (!ts) {
        if (loadTS) ts = loadTS()
      }
      if (ts) {
        resolved = resolveWithTS(scope.filename, source, ts, fs)
      }
    }
    if (resolved) {
      resolved = scope.resolvedImportSources[source] = normalizePath(resolved)
    }
  }
  if (resolved) {
    // 类型源文件变化会改变宏生成结果，必须成为当前 SFC 的 HMR 依赖。
    if (trackDep) {
      ;(ctx.deps || (ctx.deps = new Set())).add(resolved)
    }
    return fileToScope(ctx, resolved)
  } else {
    return ctx.error(
      `Failed to resolve import source ${JSON.stringify(source)}.`,
      node,
      scope,
    )
  }
}

/**
 * 为无扩展名或 JS 扩展名的相对 import 探测实际 TS/声明文件。
 * 保留 mjs/cjs 模块种类以模拟 TS NodeNext 的 `.mts/.cts` 优先级；#8339 中源码写 `.js`
 * 仍应解析到对应 `.ts`/`.d.ts`，因为这是 TypeScript 常见的 ESM 写法。
 */
function resolveExt(filename: string, fs: FS) {
  let moduleType: /*cjs*/ 'c' | /*mjs*/ 'm' | /*unknown*/ 'u' = 'u'
  if (filename.endsWith('.mjs')) {
    moduleType = 'm'
  } else if (filename.endsWith('.cjs')) {
    moduleType = 'c'
  }
  // 去掉显式 JS/JSX 扩展名后再按 TS 对应扩展探测。
  filename = filename.replace(/\.[cm]?jsx?$/, '')
  /** 文件存在时返回原路径，供多候选短路链使用。 */
  const tryResolve = (filename: string) => {
    if (fs.fileExists(filename)) return filename
  }
  /** 按普通 TS 模块顺序尝试 `.ts`、`.tsx`、`.d.ts`。 */
  const resolveTs = () =>
    tryResolve(filename + `.ts`) ||
    tryResolve(filename + `.tsx`) ||
    tryResolve(filename + `.d.ts`)
  /** 尝试 ESM TypeScript 源码和声明扩展。 */
  const resolveMts = () =>
    tryResolve(filename + `.mts`) || tryResolve(filename + `.d.mts`)
  /** 尝试 CommonJS TypeScript 源码和声明扩展。 */
  const resolveCts = () =>
    tryResolve(filename + `.cts`) || tryResolve(filename + `.d.cts`)

  return (
    tryResolve(filename) ||
    // 显式 .mjs/.cjs import 优先匹配同模块种类的 .mts/.cts 声明。
    (moduleType === 'm'
      ? resolveMts() || resolveTs()
      : moduleType === 'c'
        ? resolveCts() || resolveTs()
        : resolveTs() || resolveMts() || resolveCts()) ||
    tryResolve(joinPaths(filename, `index.ts`)) ||
    tryResolve(joinPaths(filename, `index.tsx`)) ||
    tryResolve(joinPaths(filename, `index.d.ts`))
  )
}

/** 一个已解析 tsconfig 及其惰性 ModuleResolutionCache。 */
interface CachedConfig {
  /** TypeScript 解析并合并 extends 后的 tsconfig。 */
  config: TS.ParsedCommandLine
  /** 按需创建的 TypeScript 模块解析缓存。 */
  cache?: TS.ModuleResolutionCache
}

/** tsconfig 路径到其自身及 project references 配置链的缓存。 */
const tsConfigCache = createCache<CachedConfig[]>()
/** 被引用 tsconfig 到父配置的映射，供任一配置变化时连带失效。 */
const tsConfigRefMap = new Map<string, string>()

/**
 * 使用 TypeScript 官方模块解析器处理包、paths alias 与 project references。
 * 多配置时按 include/exclude 选择覆盖当前 SFC 的 tsconfig，并复用模块解析缓存。
 */
function resolveWithTS(
  containingFile: string,
  source: string,
  ts: typeof TS,
  fs: FS,
): string | undefined {
  if (!__CJS__) return

  // 1. 从当前文件向上定位 tsconfig.json。
  const configPath = ts.findConfigFile(containingFile, fs.fileExists)
  // 2. 加载配置及其 project references，并挑选覆盖 containingFile 的一项。
  let tsCompilerOptions: TS.CompilerOptions
  let tsResolveCache: TS.ModuleResolutionCache | undefined
  if (configPath) {
    let configs: CachedConfig[]
    const normalizedConfigPath = normalizePath(configPath)
    const cached = tsConfigCache.get(normalizedConfigPath)
    if (!cached) {
      configs = loadTSConfig(configPath, ts, fs).map(config => ({ config }))
      tsConfigCache.set(normalizedConfigPath, configs)
    } else {
      configs = cached
    }
    let matchedConfig: CachedConfig | undefined
    if (configs.length === 1) {
      matchedConfig = configs[0]
    } else {
      const [major, minor] = ts.versionMajorMinor.split('.').map(Number)
      /** 解析 include/exclude pattern，并按 TS 版本展开 `${configDir}`。 */
      const getPattern = (base: string, p: string) => {
        // TS 5.5+ 的 include/exclude 路径可使用 `${configDir}` 模板变量。
        const supportsConfigDir = major > 5 || (major === 5 && minor >= 5)
        return p.startsWith('${configDir}') && supportsConfigDir
          ? normalizePath(p.replace('${configDir}', dirname(configPath!)))
          : joinPaths(base, p)
      }
      // project references 可能包含多个配置，按 include/exclude 找当前文件所属项目。
      for (const c of configs) {
        const base = normalizePath(
          (c.config.options.pathsBasePath as string) ||
            dirname(c.config.options.configFilePath as string),
        )
        const included: string[] | undefined = c.config.raw?.include
        const excluded: string[] | undefined = c.config.raw?.exclude
        if (
          (!included && (!base || containingFile.startsWith(base))) ||
          included?.some(p => isMatch(containingFile, getPattern(base, p)))
        ) {
          if (
            excluded &&
            excluded.some(p => isMatch(containingFile, getPattern(base, p)))
          ) {
            continue
          }
          matchedConfig = c
          break
        }
      }
      if (!matchedConfig) {
        matchedConfig = configs[configs.length - 1]
      }
    }
    tsCompilerOptions = matchedConfig.config.options
    tsResolveCache =
      matchedConfig.cache ||
      (matchedConfig.cache = ts.createModuleResolutionCache(
        process.cwd(),
        createGetCanonicalFileName(ts.sys.useCaseSensitiveFileNames),
        tsCompilerOptions,
      ))
  } else {
    tsCompilerOptions = {}
  }

  // 3. 交给 TS 按 compilerOptions/baseUrl/paths/moduleResolution 解析模块。
  const res = ts.resolveModuleName(
    source,
    containingFile,
    tsCompilerOptions,
    fs,
    tsResolveCache,
  )

  if (res.resolvedModule) {
    let filename = res.resolvedModule.resolvedFileName
    if (filename.endsWith('.vue.ts') && !filename.endsWith('.d.vue.ts')) {
      filename = filename.replace(/\.ts$/, '')
    }
    return fs.realpath ? fs.realpath(filename) : filename
  }
}

/**
 * 递归解析 tsconfig 与 project references，子项目排在父配置前以优先匹配。
 * visited 防止循环引用；同时建立反向映射供 HMR 精确清理父配置缓存。
 */
function loadTSConfig(
  configPath: string,
  ts: typeof TS,
  fs: FS,
  visited = new Set<string>(),
): TS.ParsedCommandLine[] {
  // 当前只有测试会使用非 ts.sys 的精简 fs；parseJsonConfigFileContent 还要求
  // readDirectory/useCaseSensitiveFileNames，因此测试适配器补最小桩。
  const parseConfigHost = __TEST__
    ? {
        ...fs,
        useCaseSensitiveFileNames: true,
        readDirectory: () => [],
      }
    : ts.sys
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, fs.readFile).config,
    parseConfigHost,
    dirname(configPath),
    undefined,
    configPath,
  )
  const res = [config]
  visited.add(configPath)
  if (config.projectReferences) {
    for (const ref of config.projectReferences) {
      const refPath = ts.resolveProjectReferencePath(ref)
      if (visited.has(refPath) || !fs.fileExists(refPath)) {
        continue
      }
      tsConfigRefMap.set(refPath, configPath)
      res.unshift(...loadTSConfig(refPath, ts, fs, visited))
    }
  }
  return res
}

// recordTypes 在 asGlobal 与普通模块模式下登记不同成员，二者不能共享缓存；否则先按全局
// 加载同一文件会污染之后的 import 解析，使未导出的符号也可能错误可见。
/** 普通模块文件到 TypeScope 的缓存。 */
const fileToScopeCache = createCache<TypeScope>()
/** globalTypeFiles 按全局语义加载的独立 TypeScope 缓存。 */
const fileToGlobalScopeCache = createCache<TypeScope>()

/**
 * 使类型文件/tsconfig 的解析缓存失效，供构建工具文件监听回调使用。
 * @private 内部构建插件 API
 */
export function invalidateTypeCache(filename: string): void {
  filename = normalizePath(filename)
  fileToScopeCache.delete(filename)
  fileToGlobalScopeCache.delete(filename)
  tsConfigCache.delete(filename)
  const affectedConfig = tsConfigRefMap.get(filename)
  if (affectedConfig) tsConfigCache.delete(affectedConfig)
}

/** 读取并解析一个类型源文件，建立且缓存普通模块或全局 TypeScope。 */
export function fileToScope(
  ctx: TypeResolveContext,
  filename: string,
  asGlobal = false,
): TypeScope {
  const cache = asGlobal ? fileToGlobalScopeCache : fileToScopeCache
  const cached = cache.get(filename)
  if (cached) {
    return cached
  }
  // 调用路径已在 importSourceToScope/resolveGlobalScope 验证 fs 存在。
  const fs = resolveFS(ctx)!
  const source = fs.readFile(filename) || ''
  const body = parseFile(filename, source, fs, ctx.options.babelParserPlugins)
  const scope = new TypeScope(filename, source, 0, recordImports(body))
  recordTypes(ctx, body, scope, asGlobal)
  cache.set(filename, scope)
  return scope
}

/**
 * 按扩展名把 TS/JS/Vue/任意扩展声明文件解析为 Babel statements。
 * Vue 文件会拼接两个 script block 并用空格保持原始 offset；TS 5 的任意扩展声明约定
 * `foo.ext` → `foo.d.ext.ts` 也在这里模拟。
 */
function parseFile(
  filename: string,
  content: string,
  fs: FS,
  parserPlugins?: SFCScriptCompileOptions['babelParserPlugins'],
): Statement[] {
  const ext = extname(filename)
  if (
    ext === '.ts' ||
    ext === '.mts' ||
    ext === '.tsx' ||
    ext === '.cts' ||
    ext === '.mtsx'
  ) {
    return babelParse(content, {
      plugins: resolveParserPlugins(
        ext.slice(1),
        parserPlugins,
        /\.d\.[cm]?ts$/.test(filename),
      ),
      sourceType: 'module',
    }).program.body
  }

  // 模拟 TS >=5.0 allowArbitraryExtensions 的配套声明文件查找。
  const isUnknownTypeSource = !/\.[cm]?[tj]sx?$/.test(filename)
  const arbitraryTypeSource = `${filename.slice(0, -ext.length)}.d${ext}.ts`
  const hasArbitraryTypeDeclaration =
    isUnknownTypeSource && fs.fileExists(arbitraryTypeSource)
  if (hasArbitraryTypeDeclaration) {
    return babelParse(fs.readFile(arbitraryTypeSource)!, {
      plugins: resolveParserPlugins('ts', parserPlugins, true),
      sourceType: 'module',
    }).program.body
  }

  if (ext === '.vue') {
    const {
      descriptor: { script, scriptSetup },
    } = parse(content)
    if (!script && !scriptSetup) {
      return []
    }

    // 用空格补到 block 原始 offset，使类型节点诊断仍能指向完整 `.vue` 源码。
    const scriptOffset = script ? script.loc.start.offset : Infinity
    const scriptSetupOffset = scriptSetup
      ? scriptSetup.loc.start.offset
      : Infinity
    const firstBlock = scriptOffset < scriptSetupOffset ? script : scriptSetup
    const secondBlock = scriptOffset < scriptSetupOffset ? scriptSetup : script

    let scriptContent =
      ' '.repeat(Math.min(scriptOffset, scriptSetupOffset)) +
      firstBlock!.content
    if (secondBlock) {
      scriptContent +=
        ' '.repeat(secondBlock.loc.start.offset - script!.loc.end.offset) +
        secondBlock.content
    }
    const lang = script?.lang || scriptSetup?.lang
    return babelParse(scriptContent, {
      plugins: resolveParserPlugins(lang!, parserPlugins),
      sourceType: 'module',
    }).program.body
  }
  return []
}

/** 从完整/精简上下文的 AST 和 import 信息惰性创建根类型作用域。 */
function ctxToScope(ctx: TypeResolveContext): TypeScope {
  if (ctx.scope) {
    return ctx.scope
  }

  const body =
    'ast' in ctx
      ? ctx.ast
      : ctx.scriptAst
        ? [...ctx.scriptAst.body, ...ctx.scriptSetupAst!.body]
        : ctx.scriptSetupAst!.body

  const scope = new TypeScope(
    ctx.filename,
    ctx.source,
    'startOffset' in ctx ? ctx.startOffset! : 0,
    'userImports' in ctx ? Object.create(ctx.userImports) : recordImports(body),
  )

  recordTypes(ctx, body, scope)

  return (ctx.scope = scope)
}

/** 把 namespace/module declaration 转换为可递归查找的子 TypeScope，并缓存到节点。 */
function moduleDeclToScope(
  ctx: TypeResolveContext,
  node: TSModuleDeclaration & {
    /** 已由该 namespace/module declaration 建立的子作用域。 */
    _resolvedChildScope?: TypeScope
  },
  parentScope: TypeScope,
): TypeScope {
  if (node._resolvedChildScope) {
    return node._resolvedChildScope
  }

  const scope = createChildScope(parentScope)

  if (node.body.type === 'TSModuleDeclaration') {
    const decl = node.body as TSModuleDeclaration & WithScope
    decl._ownerScope = scope
    const id = getId(decl.id)
    scope.types[id] = scope.exportedTypes[id] = decl
  } else {
    recordTypes(ctx, node.body.body, scope)
  }

  return (node._resolvedChildScope = scope)
}

/** 创建继承父 imports/types/declares 的词法类型子作用域。 */
function createChildScope(parentScope: TypeScope) {
  return new TypeScope(
    parentScope.filename,
    parentScope.source,
    parentScope.offset,
    Object.create(parentScope.imports),
    Object.create(parentScope.types),
    Object.create(parentScope.declares),
  )
}

/** 判断声明文件是否包含顶层模块语法，从而区分 ambient script 与 external module。 */
const importExportRE = /^Import|^Export/

/**
 * 扫描 statements，把类型和值声明登记到当前 TypeScope。
 * asGlobal 模式只接收 ambient 顶层声明或 `declare global` 内容；普通模块模式还构造
 * exportedTypes、re-export 与 export-all 链。
 */
function recordTypes(
  ctx: TypeResolveContext,
  body: Statement[],
  scope: TypeScope,
  asGlobal = false,
) {
  const { types, declares, exportedTypes, exportedDeclares, imports } = scope
  const isAmbient = asGlobal
    ? !body.some(s => importExportRE.test(s.type))
    : false
  for (const stmt of body) {
    if (asGlobal) {
      if (isAmbient) {
        if ((stmt as any).declare) {
          recordType(stmt, types, declares)
        }
      } else if (stmt.type === 'TSModuleDeclaration' && stmt.global) {
        for (const s of (stmt.body as TSModuleBlock).body) {
          if (s.type === 'ExportNamedDeclaration') {
            if (s.declaration) {
              // `declare global` 中的直接导出声明仍进入全局 types/declares。
              recordType(s.declaration, types, declares)
            } else if (s.source) {
              // `declare global` 内的 re-export（如 `export type { Foo } from './foo'`）
              // 需立即跟随源文件，因为全局查找只读取 types/declares，不读取 exported*。
              const sourceScope = importSourceToScope(
                ctx,
                s.source,
                scope,
                s.source.value,
                false,
              )
              for (const spec of s.specifiers) {
                if (spec.type === 'ExportSpecifier') {
                  const exported = getId(spec.exported)
                  const local = spec.local.name
                  if (sourceScope.exportedTypes[local]) {
                    types[exported] = sourceScope.exportedTypes[local]
                  }
                  if (sourceScope.exportedDeclares[local]) {
                    declares[exported] = sourceScope.exportedDeclares[local]
                  }
                }
              }
            }
          } else if (s.type === 'ExportAllDeclaration' && s.source) {
            // `declare global` 内 export-all 同样立即合并源模块导出。
            const sourceScope = importSourceToScope(
              ctx,
              s.source,
              scope,
              s.source.value,
              false,
            )
            Object.assign(types, sourceScope.exportedTypes)
            Object.assign(declares, sourceScope.exportedDeclares)
          } else {
            recordType(s, types, declares)
          }
        }
      }
    } else {
      recordType(stmt, types, declares)
    }
  }
  if (!asGlobal) {
    for (const stmt of body) {
      if (stmt.type === 'ExportNamedDeclaration') {
        if (stmt.declaration) {
          recordType(stmt.declaration, types, declares)
          recordType(stmt.declaration, exportedTypes, exportedDeclares)
        } else {
          for (const spec of stmt.specifiers) {
            if (spec.type === 'ExportSpecifier') {
              const local = spec.local.name
              const exported = getId(spec.exported)
              if (stmt.source) {
                // re-export 登记为合成 import + 类型引用，后续按需跟随而不是立即展开。
                imports[exported] = {
                  source: stmt.source.value,
                  imported: local,
                }
                exportedTypes[exported] = {
                  type: 'TSTypeReference',
                  typeName: {
                    type: 'Identifier',
                    name: local,
                  },
                  _ownerScope: scope,
                }
              } else if (types[local]) {
                // 无 source 的说明符直接把本地类型映射到导出名。
                exportedTypes[exported] = types[local]
              }
            }
          }
        }
      } else if (stmt.type === 'ExportAllDeclaration') {
        const sourceScope = importSourceToScope(
          ctx,
          stmt.source,
          scope,
          stmt.source.value,
        )
        Object.assign(scope.exportedTypes, sourceScope.exportedTypes)
      } else if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration) {
        if (stmt.declaration.type !== 'Identifier') {
          recordType(stmt.declaration, types, declares, 'default')
          recordType(
            stmt.declaration,
            exportedTypes,
            exportedDeclares,
            'default',
          )
        } else if (types[stmt.declaration.name]) {
          exportedTypes['default'] = types[stmt.declaration.name]
        }
      }
    }
  }
  for (const key of Object.keys(types)) {
    const node = types[key]
    if (!node._ownerScope) node._ownerScope = scope
    if (node._ns && !node._ns._ownerScope) node._ns._ownerScope = scope
  }
  for (const key of Object.keys(declares)) {
    if (!declares[key]._ownerScope) declares[key]._ownerScope = scope
  }
}

/**
 * 将单条声明登记到类型表或 typeof 可查询的值声明表。
 * 实现 TypeScript 的 interface/enum/namespace 声明合并；同名 namespace 与 class/interface
 * 会通过 `_ns` 关联，使 `Foo.Bar` 仍可继续解析。
 */
function recordType(
  node: Node,
  types: Record<string, Node>,
  declares: Record<string, Node>,
  overwriteId?: string,
) {
  switch (node.type) {
    case 'TSInterfaceDeclaration':
    case 'TSEnumDeclaration':
    case 'TSModuleDeclaration': {
      // `declare global` 的内部成员直接递归登记到目标全局表。
      if (node.type === 'TSModuleDeclaration' && node.global) {
        const body = node.body as TSModuleBlock
        for (const s of body.body) {
          if (s.type === 'ExportNamedDeclaration' && s.declaration) {
            recordType(s.declaration, types, declares)
          } else {
            recordType(s, types, declares)
          }
        }
        break
      }
      const id = overwriteId || getId(node.id)
      let existing = types[id]
      if (existing) {
        if (node.type === 'TSModuleDeclaration') {
          if (existing.type === 'TSModuleDeclaration') {
            mergeNamespaces(existing as typeof node, node)
          } else {
            attachNamespace(existing, node)
          }
          break
        }
        if (existing.type === 'TSModuleDeclaration') {
          // 新实体声明取代 namespace 成为主节点，同时把 namespace 附到 `_ns`。
          types[id] = node
          attachNamespace(node, existing)
          break
        }

        if (existing.type !== node.type) {
          // 非法的异类重复声明属于 TS 类型错误；compiler-sfc 不重复承担完整类型检查。
          break
        }
        if (node.type === 'TSInterfaceDeclaration') {
          ;(existing as typeof node).body.body.push(...node.body.body)
        } else {
          ;(existing as typeof node).members.push(...node.members)
        }
      } else {
        types[id] = node
      }
      break
    }
    case 'ClassDeclaration':
      if (overwriteId || node.id) types[overwriteId || getId(node.id!)] = node
      break
    case 'TSTypeAliasDeclaration':
      types[node.id.name] = node.typeParameters ? node : node.typeAnnotation
      break
    case 'TSDeclareFunction':
      if (node.id) declares[node.id.name] = node
      break
    case 'VariableDeclaration': {
      if (node.declare) {
        for (const decl of node.declarations) {
          if (decl.id.type === 'Identifier' && decl.id.typeAnnotation) {
            declares[decl.id.name] = (
              decl.id.typeAnnotation as TSTypeAnnotation
            ).typeAnnotation
          }
        }
      }
      break
    }
  }
}

/** 合并同名 namespace 的嵌套声明或 module block，模拟 TypeScript declaration merging。 */
function mergeNamespaces(to: TSModuleDeclaration, from: TSModuleDeclaration) {
  const toBody = to.body
  const fromBody = from.body
  if (toBody.type === 'TSModuleDeclaration') {
    if (fromBody.type === 'TSModuleDeclaration') {
      // 双方都是 `namespace A.B` 形式，递归合并下一层。
      mergeNamespaces(toBody, fromBody)
    } else {
      // 目标是嵌套声明、来源是 block：把目标作为 type export 注入来源 block。
      fromBody.body.push({
        type: 'ExportNamedDeclaration',
        declaration: toBody,
        exportKind: 'type',
        specifiers: [],
      })
    }
  } else if (fromBody.type === 'TSModuleDeclaration') {
    // 目标是 block、来源是嵌套声明：把来源作为 type export 注入目标 block。
    toBody.body.push({
      type: 'ExportNamedDeclaration',
      declaration: fromBody,
      exportKind: 'type',
      specifiers: [],
    })
  } else {
    // 双方都是 block，直接拼接成员。
    toBody.body.push(...fromBody.body)
  }
}

/** 将同名 namespace 附着到 class/interface/enum 主声明，重复附着时继续合并。 */
function attachNamespace(
  to: Node & {
    /** 与实体声明合并的 namespace。 */
    _ns?: TSModuleDeclaration
  },
  ns: TSModuleDeclaration,
) {
  if (!to._ns) {
    to._ns = ns
  } else {
    mergeNamespaces(to._ns, ns)
  }
}

/** 从 statements 收集全部 import 的局部名→来源/原名映射。 */
export function recordImports(body: Statement[]): Record<string, Import> {
  const imports: TypeScope['imports'] = Object.create(null)
  for (const s of body) {
    recordImport(s, imports)
  }
  return imports
}

/** 若节点为 ImportDeclaration，则把每个 specifier 写入目标 import 表。 */
function recordImport(node: Node, imports: TypeScope['imports']) {
  if (node.type !== 'ImportDeclaration') {
    return
  }
  for (const s of node.specifiers) {
    imports[s.local.name] = {
      imported: getImportedName(s),
      source: node.source.value,
    }
  }
}

/**
 * 从 TypeScript 类型尽力推导 Vue prop 校验所需的运行时构造器名称。
 *
 * 该过程不是完整 TS 类型检查器：支持常见关键字、容器、联合/交叉、工具类型、import、
 * enum、keyof 及 Vue Ref 包装；任何解析失败都软退化为 `Unknown`，不应阻断正常编译。
 */
export function inferRuntimeType(
  ctx: TypeResolveContext,
  node: Node & MaybeWithScope,
  scope: TypeScope = node._ownerScope || ctxToScope(ctx),
  isKeyOf = false,
  typeParameters?: Record<string, Node>,
): string[] {
  if (
    node.leadingComments &&
    node.leadingComments.some(c => c.value.includes('@vue-ignore'))
  ) {
    return [UNKNOWN_TYPE]
  }

  // 运行时类型推导是附加优化，extends 失败在此静默，不覆盖外层显式解析策略。
  const prevSilent = ctx.silentOnExtendsFailure
  ctx.silentOnExtendsFailure = true

  try {
    switch (node.type) {
      case 'TSStringKeyword':
        return ['String']
      case 'TSNumberKeyword':
        return ['Number']
      case 'TSBooleanKeyword':
        return ['Boolean']
      case 'TSObjectKeyword':
        return ['Object']
      case 'TSNullKeyword':
        return ['null']
      case 'TSTypeLiteral':
      case 'TSInterfaceDeclaration': {
        // TODO：未来可进一步为对象成员生成细粒度运行时校验；当前只映射到 Object/Function。
        const types = new Set<string>()
        const members =
          node.type === 'TSTypeLiteral' ? node.members : node.body.body

        for (const m of members) {
          if (isKeyOf) {
            if (
              m.type === 'TSPropertySignature' &&
              m.key.type === 'NumericLiteral'
            ) {
              types.add('Number')
            } else if (m.type === 'TSIndexSignature') {
              const annotation = m.parameters[0].typeAnnotation
              if (annotation && annotation.type !== 'Noop') {
                const type = inferRuntimeType(
                  ctx,
                  annotation.typeAnnotation,
                  scope,
                )[0]
                if (type === UNKNOWN_TYPE) return [UNKNOWN_TYPE]
                types.add(type)
              }
            } else {
              types.add('String')
            }
          } else if (
            m.type === 'TSCallSignatureDeclaration' ||
            m.type === 'TSConstructSignatureDeclaration'
          ) {
            types.add('Function')
          } else {
            types.add('Object')
          }
        }

        return types.size
          ? Array.from(types)
          : [isKeyOf ? UNKNOWN_TYPE : 'Object']
      }
      case 'TSPropertySignature':
        if (node.typeAnnotation) {
          return inferRuntimeType(
            ctx,
            node.typeAnnotation.typeAnnotation,
            scope,
          )
        }
        break
      case 'TSMethodSignature':
      case 'TSFunctionType':
        return ['Function']
      case 'TSArrayType':
      case 'TSTupleType':
        // TODO：未来可为数组元素类型和 tuple 长度生成细粒度校验；当前统一为 Array。
        return ['Array']

      case 'TSLiteralType':
        switch (node.literal.type) {
          case 'StringLiteral':
            return ['String']
          case 'BooleanLiteral':
            return ['Boolean']
          case 'NumericLiteral':
          case 'BigIntLiteral':
            return ['Number']
          default:
            return [UNKNOWN_TYPE]
        }

      case 'TSTypeReference': {
        // #14729：引用解析失败（例如消费构建产物时找不到原始 vue 类型）不能立即返回。
        // 仍按名字识别 Ref/MaybeRef/Promise 等已知类型，保留可获得的运行时信息。
        let resolved: ScopeTypeNode | undefined
        try {
          resolved = resolveTypeReference(ctx, node, scope)
        } catch {}
        if (resolved) {
          if (resolved.type === 'TSTypeAliasDeclaration') {
            // #13240：函数类型别名必须推导为 Function，运行时才能正确区分函数 prop；
            // 其他无法展开的别名仍沿用 Unknown 回退。
            if (resolved.typeAnnotation.type === 'TSFunctionType') {
              return ['Function']
            }

            if (node.typeParameters) {
              const typeParams: Record<string, Node> = Object.create(null)
              if (resolved.typeParameters) {
                resolved.typeParameters.params.forEach((p, i) => {
                  typeParams![p.name] = node.typeParameters!.params[i]
                })
              }
              return inferRuntimeType(
                ctx,
                resolved.typeAnnotation,
                resolved._ownerScope,
                isKeyOf,
                typeParams,
              )
            }
          }

          return inferRuntimeType(ctx, resolved, resolved._ownerScope, isKeyOf)
        }
        if (node.typeName.type === 'Identifier') {
          if (typeParameters && typeParameters[node.typeName.name]) {
            return inferRuntimeType(
              ctx,
              typeParameters[node.typeName.name],
              scope,
              isKeyOf,
              typeParameters,
            )
          }
          if (isKeyOf) {
            switch (node.typeName.name) {
              case 'String':
              case 'Array':
              case 'ArrayLike':
              case 'Parameters':
              case 'ConstructorParameters':
              case 'ReadonlyArray':
                return ['String', 'Number']

              // keyof 场景下常见 TS 工具类型的键类型近似。
              case 'Record':
              case 'Partial':
              case 'Required':
              case 'Readonly':
                if (node.typeParameters && node.typeParameters.params[0]) {
                  return inferRuntimeType(
                    ctx,
                    node.typeParameters.params[0],
                    scope,
                    true,
                  )
                }
                break
              case 'Pick':
              case 'Extract':
                if (node.typeParameters && node.typeParameters.params[1]) {
                  return inferRuntimeType(
                    ctx,
                    node.typeParameters.params[1],
                    scope,
                  )
                }
                break

              case 'Function':
              case 'Object':
              case 'Set':
              case 'Map':
              case 'WeakSet':
              case 'WeakMap':
              case 'Date':
              case 'Promise':
              case 'Error':
              case 'Uppercase':
              case 'Lowercase':
              case 'Capitalize':
              case 'Uncapitalize':
              case 'ReadonlyMap':
              case 'ReadonlySet':
                return ['String']
            }
          } else {
            switch (node.typeName.name) {
              case 'Array':
              case 'Function':
              case 'Object':
              case 'Set':
              case 'Map':
              case 'WeakSet':
              case 'WeakMap':
              case 'Date':
              case 'Promise':
              case 'Error':
                return [node.typeName.name]

              // 常见 TS 工具类型对应的运行时容器。
              // https://www.typescriptlang.org/docs/handbook/utility-types.html
              case 'Partial':
              case 'Required':
              case 'Readonly':
              case 'Record':
              case 'Pick':
              case 'Omit':
              case 'InstanceType':
                return ['Object']

              case 'Uppercase':
              case 'Lowercase':
              case 'Capitalize':
              case 'Uncapitalize':
                return ['String']

              case 'Parameters':
              case 'ConstructorParameters':
              case 'ReadonlyArray':
                return ['Array']

              case 'ReadonlyMap':
                return ['Map']
              case 'ReadonlySet':
                return ['Set']

              // Vue Ref 包装按名称兜底，使无法解析 vue 类型源文件时仍能推导；见 #14729。
              case 'Ref':
              case 'ShallowRef':
              case 'ComputedRef':
              case 'WritableComputedRef':
                return ['Object']
              case 'MaybeRef':
              case 'MaybeRefOrGetter': {
                const types = new Set<string>(['Object'])
                if (node.typeName.name === 'MaybeRefOrGetter') {
                  types.add('Function')
                }
                if (node.typeParameters && node.typeParameters.params[0]) {
                  for (const t of inferRuntimeType(
                    ctx,
                    node.typeParameters.params[0],
                    scope,
                    false,
                    typeParameters,
                  )) {
                    types.add(t)
                  }
                }
                return Array.from(types)
              }

              case 'NonNullable':
                if (node.typeParameters && node.typeParameters.params[0]) {
                  return inferRuntimeType(
                    ctx,
                    node.typeParameters.params[0],
                    scope,
                  ).filter(t => t !== 'null')
                }
                break
              case 'Extract':
                if (node.typeParameters && node.typeParameters.params[1]) {
                  return inferRuntimeType(
                    ctx,
                    node.typeParameters.params[1],
                    scope,
                  )
                }
                break
              case 'Exclude':
              case 'OmitThisParameter':
                if (node.typeParameters && node.typeParameters.params[0]) {
                  return inferRuntimeType(
                    ctx,
                    node.typeParameters.params[0],
                    scope,
                  )
                }
                break
            }
          }
        }
        // ThisParameterType 等无法从名称可靠映射的类型统一回退 Unknown。
        break
      }

      case 'TSParenthesizedType':
        return inferRuntimeType(ctx, node.typeAnnotation, scope)

      case 'TSUnionType':
        return flattenTypes(ctx, node.types, scope, isKeyOf, typeParameters)
      case 'TSIntersectionType': {
        return flattenTypes(
          ctx,
          node.types,
          scope,
          isKeyOf,
          typeParameters,
        ).filter(t => t !== UNKNOWN_TYPE)
      }
      case 'TSMappedType': {
        // 映射类型目前只识别保持原形的 `{ [K in keyof T]: T[K] }`，可直接回到 T 推导。
        const { typeAnnotation, typeParameter } = node
        if (
          typeAnnotation &&
          typeAnnotation.type === 'TSIndexedAccessType' &&
          typeParameter &&
          typeParameter.constraint &&
          typeParameters
        ) {
          const constraint = typeParameter.constraint
          if (
            constraint.type === 'TSTypeOperator' &&
            constraint.operator === 'keyof' &&
            constraint.typeAnnotation &&
            constraint.typeAnnotation.type === 'TSTypeReference' &&
            constraint.typeAnnotation.typeName.type === 'Identifier'
          ) {
            const typeName = constraint.typeAnnotation.typeName.name
            const index = typeAnnotation.indexType
            const obj = typeAnnotation.objectType
            if (
              obj &&
              obj.type === 'TSTypeReference' &&
              obj.typeName.type === 'Identifier' &&
              obj.typeName.name === typeName &&
              index &&
              index.type === 'TSTypeReference' &&
              index.typeName.type === 'Identifier' &&
              index.typeName.name === typeParameter.name
            ) {
              const targetType = typeParameters[typeName]
              if (targetType) {
                return inferRuntimeType(ctx, targetType, scope)
              }
            }
          }
        }

        return [UNKNOWN_TYPE]
      }

      case 'TSEnumDeclaration':
        return inferEnumType(node)

      case 'TSSymbolKeyword':
        return ['Symbol']

      case 'TSIndexedAccessType': {
        const types = resolveIndexType(ctx, node, scope)
        return flattenTypes(ctx, types, scope, isKeyOf)
      }

      case 'ClassDeclaration':
        return ['Object']

      case 'TSImportType': {
        const sourceScope = importSourceToScope(
          ctx,
          node.argument,
          scope,
          node.argument.value,
        )
        const resolved = resolveTypeReference(ctx, node, sourceScope)
        if (resolved) {
          return inferRuntimeType(ctx, resolved, resolved._ownerScope)
        }
        break
      }

      case 'TSTypeQuery': {
        const id = node.exprName
        if (id.type === 'Identifier') {
          // typeof 目前只支持当前作用域简单标识符，对应 declares 值声明表。
          const matched = scope.declares[id.name]
          if (matched) {
            return inferRuntimeType(ctx, matched, matched._ownerScope, isKeyOf)
          }
        }
        break
      }

      // readonly 等普通 operator 透传内部类型；keyof 则切换为键类型推导。
      case 'TSTypeOperator': {
        return inferRuntimeType(
          ctx,
          node.typeAnnotation,
          scope,
          node.operator === 'keyof',
        )
      }

      case 'TSAnyKeyword': {
        if (isKeyOf) {
          return ['String', 'Number', 'Symbol']
        }
        break
      }
    }
  } catch (e) {
    // 运行时类型只用于开发校验/转换优化，失败必须软降级而不能阻止组件编译。
  } finally {
    ctx.silentOnExtendsFailure = prevSilent
  }
  return [UNKNOWN_TYPE] // Unknown 会在 props 生成阶段转换为跳过/取消运行时校验。
}

/** 展开一组类型并去重其运行时构造器；单项保留原作用域快速处理。 */
function flattenTypes(
  ctx: TypeResolveContext,
  types: TSType[],
  scope: TypeScope,
  isKeyOf: boolean = false,
  typeParameters: Record<string, Node> | undefined = undefined,
): string[] {
  if (types.length === 1) {
    return inferRuntimeType(
      ctx,
      types[0],
      (types[0] as MaybeWithScope)._ownerScope || scope,
      isKeyOf,
      typeParameters,
    )
  }
  return [
    ...new Set(
      ([] as string[]).concat(
        ...types.map(t =>
          inferRuntimeType(
            ctx,
            t,
            (t as MaybeWithScope)._ownerScope || scope,
            isKeyOf,
            typeParameters,
          ),
        ),
      ),
    ),
  ]
}

/** 根据 enum 显式初始化值推导 Number/String；无初始化的 TS enum 默认为 Number。 */
function inferEnumType(node: TSEnumDeclaration): string[] {
  const types = new Set<string>()
  for (const m of node.members) {
    if (m.initializer) {
      switch (m.initializer.type) {
        case 'StringLiteral':
          types.add('String')
          break
        case 'NumericLiteral':
          types.add('Number')
          break
      }
    }
  }
  return types.size ? [...types] : ['Number']
}

/**
 * 对 Vue `ExtractPropTypes` / `ExtractPublicPropTypes` 做反向推导。
 * 这是面向 Element Plus、Ant Design Vue 等常见组件库声明形状的非完备实现。
 */
function resolveExtractPropTypes(
  { props }: ResolvedElements,
  scope: TypeScope,
): ResolvedElements {
  const res: ResolvedElements = { props: {} }
  for (const key in props) {
    const raw = props[key]
    res.props[key] = reverseInferType(
      raw.key,
      raw.typeAnnotation!.typeAnnotation,
      scope,
    )
  }
  return res
}

/**
 * 从 `{ type: StringConstructor, required: true }` 等运行时 props 类型声明反推 TS 属性签名。
 * 无法识别时生成 TSNullKeyword，使后续运行时推导安全退化。
 */
function reverseInferType(
  key: Expression,
  node: TSType,
  scope: TypeScope,
  optional = true,
  checkObjectSyntax = true,
): TSPropertySignature & WithScope {
  if (checkObjectSyntax && node.type === 'TSTypeLiteral') {
    // 识别对象式 prop 声明的 type/required 静态成员。
    const typeType = findStaticPropertyType(node, 'type')
    if (typeType) {
      const requiredType = findStaticPropertyType(node, 'required')
      const optional =
        requiredType &&
        requiredType.type === 'TSLiteralType' &&
        requiredType.literal.type === 'BooleanLiteral'
          ? !requiredType.literal.value
          : true
      return reverseInferType(key, typeType, scope, optional, false)
    }
  } else if (
    node.type === 'TSTypeReference' &&
    node.typeName.type === 'Identifier'
  ) {
    if (node.typeName.name.endsWith('Constructor')) {
      return createProperty(
        key,
        ctorToType(node.typeName.name),
        scope,
        optional,
      )
    } else if (node.typeName.name === 'PropType' && node.typeParameters) {
      // `PropType<T>` 直接采用 T。
      return createProperty(key, node.typeParameters.params[0], scope, optional)
    }
  }
  if (
    (node.type === 'TSTypeReference' || node.type === 'TSImportType') &&
    node.typeParameters
  ) {
    // 递归检查泛型参数，覆盖 `Foo.Bar<StringConstructor>` 一类库声明包装。
    for (const t of node.typeParameters.params) {
      const inferred = reverseInferType(key, t, scope, optional)
      if (inferred) return inferred
    }
  }
  return createProperty(key, { type: `TSNullKeyword` }, scope, optional)
}

/** 把 `StringConstructor` 等构造器接口名映射回对应 TS 类型节点。 */
function ctorToType(ctorType: string): TSType {
  const ctor = ctorType.slice(0, -11)
  switch (ctor) {
    case 'String':
    case 'Number':
    case 'Boolean':
      return { type: `TS${ctor}Keyword` }
    case 'Array':
    case 'Function':
    case 'Object':
    case 'Set':
    case 'Map':
    case 'WeakSet':
    case 'WeakMap':
    case 'Date':
    case 'Promise':
      return {
        type: 'TSTypeReference',
        typeName: { type: 'Identifier', name: ctor },
      }
  }
  // 未知构造器用 null 节点标记不可可靠反推。
  return { type: `TSNullKeyword` }
}

/** 在对象类型字面量中查找指定静态属性的类型注解。 */
function findStaticPropertyType(node: TSTypeLiteral, key: string) {
  const prop = node.members.find(
    m =>
      m.type === 'TSPropertySignature' &&
      getStringLiteralKey(m) === key &&
      m.typeAnnotation,
  )
  return prop && prop.typeAnnotation!.typeAnnotation
}

/** 对有限的函数类型引用/typeof/import type 提取 ReturnType 的返回类型节点。 */
function resolveReturnType(
  ctx: TypeResolveContext,
  arg: Node,
  scope: TypeScope,
) {
  let resolved: Node | undefined = arg
  if (
    arg.type === 'TSTypeReference' ||
    arg.type === 'TSTypeQuery' ||
    arg.type === 'TSImportType'
  ) {
    resolved = resolveTypeReference(ctx, arg, scope)
  }
  if (!resolved) return
  if (resolved.type === 'TSFunctionType') {
    return resolved.typeAnnotation?.typeAnnotation
  }
  if (resolved.type === 'TSDeclareFunction') {
    return resolved.returnType
  }
}

/** 跟随顶层类型引用，并递归把联合类型展平成成员节点数组。 */
export function resolveUnionType(
  ctx: TypeResolveContext,
  node: Node &
    MaybeWithScope & {
      /** 可复用的类型元素展开缓存。 */
      _resolvedElements?: ResolvedElements
    },
  scope?: TypeScope,
): Node[] {
  if (node.type === 'TSTypeReference') {
    const resolved = resolveTypeReference(ctx, node, scope)
    if (resolved) node = resolved
  }

  let types: Node[]
  if (node.type === 'TSUnionType') {
    types = node.types.flatMap(node => resolveUnionType(ctx, node, scope))
  } else {
    types = [node]
  }

  return types
}
