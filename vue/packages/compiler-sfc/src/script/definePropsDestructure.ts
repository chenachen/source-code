import type {
  BlockStatement,
  Expression,
  Identifier,
  Node,
  ObjectPattern,
  Program,
  VariableDeclaration,
} from '@babel/types'
import { walk } from 'estree-walker'
import {
  BindingTypes,
  TS_NODE_TYPES,
  extractIdentifiers,
  isFunctionType,
  isInDestructureAssignment,
  isReferencedIdentifier,
  isStaticProperty,
  unwrapTSNode,
  walkFunctionParams,
} from '@vue/compiler-dom'
import { genPropsAccessExp } from '@vue/shared'
import { isCallOf, resolveObjectKey } from './utils'
import type { ScriptCompileContext } from './context'
import { DEFINE_PROPS } from './defineProps'

/**
 * 解析 `const { foo: local, bar = 1, ...rest } = defineProps()`。
 * 记录公共名、局部别名和默认值；嵌套/计算键因无法稳定映射回 `__props` 而禁止。
 */
export function processPropsDestructure(
  ctx: ScriptCompileContext,
  declId: ObjectPattern,
): void {
  if (ctx.options.propsDestructure === 'error') {
    ctx.error(`Props destructure is explicitly prohibited via config.`, declId)
  } else if (ctx.options.propsDestructure === false) {
    return
  }

  ctx.propsDestructureDecl = declId

  /** 登记 prop 解构名；别名还需写入模板 bindingMetadata 的反向映射。 */
  const registerBinding = (
    key: string,
    local: string,
    defaultValue?: Expression,
  ) => {
    ctx.propsDestructuredBindings[key] = { local, default: defaultValue }
    if (local !== key) {
      ctx.bindingMetadata[local] = BindingTypes.PROPS_ALIASED
      ;(ctx.bindingMetadata.__propsAliases ||
        (ctx.bindingMetadata.__propsAliases = {}))[local] = key
    }
  }

  for (const prop of declId.properties) {
    if (prop.type === 'ObjectProperty') {
      const propKey = resolveObjectKey(prop.key, prop.computed)

      if (!propKey) {
        ctx.error(
          `${DEFINE_PROPS}() destructure cannot use computed key.`,
          prop.key,
        )
      }

      if (prop.value.type === 'AssignmentPattern') {
        // 默认值解构 `{ foo = 123 }`。
        const { left, right } = prop.value
        if (left.type !== 'Identifier') {
          ctx.error(
            `${DEFINE_PROPS}() destructure does not support nested patterns.`,
            left,
          )
        }
        registerBinding(propKey, left.name, right)
      } else if (prop.value.type === 'Identifier') {
        // 普通或别名解构 `{ foo }` / `{ foo: local }`。
        registerBinding(propKey, prop.value.name)
      } else {
        ctx.error(
          `${DEFINE_PROPS}() destructure does not support nested patterns.`,
          prop.value,
        )
      }
    } else {
      // rest 由 createPropsRestProxy 生成只读响应式代理，单独记录接收变量。
      ctx.propsDestructureRestId = (prop.argument as Identifier).name
      // rest proxy 本身不会被重新赋值，归类为响应式常量。
      ctx.bindingMetadata[ctx.propsDestructureRestId] =
        BindingTypes.SETUP_REACTIVE_CONST
    }
  }
}

/**
 * 标识符作用域表：true 表示根 defineProps 解构绑定，false 表示遮蔽它的局部绑定。
 */
type Scope = Record<string, boolean>

/**
 * 把 script setup 中对解构 prop 的读取改写为 `__props.key`，保持响应性。
 *
 * 转换器自行模拟 JS 的函数/块/var 作用域，避免重写同名局部变量；同时禁止写入只读 prop，
 * 并诊断 `watch(foo)` / `toRef(foo)` 这类传值后丢失响应性的用法，要求改传 getter。
 */
export function transformDestructuredProps(
  ctx: ScriptCompileContext,
  vueImportAliases: Record<string, string>,
): void {
  if (ctx.options.propsDestructure === false) {
    return
  }

  const rootScope: Scope = Object.create(null)
  const scopeStack: Scope[] = [rootScope]
  const functionScopeStack: Scope[] = [rootScope]
  let currentScope: Scope = rootScope
  const excludedIds = new WeakSet<Identifier>()
  const parentStack: Node[] = []
  const propsLocalToPublicMap: Record<string, string> = Object.create(null)

  for (const key in ctx.propsDestructuredBindings) {
    const { local } = ctx.propsDestructuredBindings[key]
    rootScope[local] = true
    propsLocalToPublicMap[local] = key
  }

  /** 建立继承当前绑定可见性的子作用域。 */
  function pushScope(isFunctionScope = false) {
    const scope = (currentScope = Object.create(currentScope))
    scopeStack.push(scope)
    if (isFunctionScope) {
      functionScopeStack.push(scope)
    }
  }

  /** 离开块/函数作用域并恢复父级作用域。 */
  function popScope(isFunctionScope = false) {
    scopeStack.pop()
    if (isFunctionScope) {
      functionScopeStack.pop()
    }
    currentScope = scopeStack[scopeStack.length - 1] || null
  }

  /** 登记会遮蔽同名 prop 的局部声明，并避免改写声明标识符本身。 */
  function registerLocalBinding(id: Identifier, scope = currentScope) {
    excludedIds.add(id)
    if (scope) {
      scope[id.name] = false
    } else {
      ctx.error(
        'registerBinding called without active scope, something is wrong.',
        id,
      )
    }
  }

  /** 预扫描当前块的词法声明，使引用改写不依赖声明出现顺序。 */
  function walkScope(node: Program | BlockStatement, isRoot = false) {
    for (const stmt of node.body) {
      if (stmt.type === 'VariableDeclaration') {
        walkVariableDeclaration(stmt, isRoot)
      } else if (
        stmt.type === 'FunctionDeclaration' ||
        stmt.type === 'ClassDeclaration'
      ) {
        if (stmt.declare || !stmt.id) continue
        registerLocalBinding(stmt.id)
      } else if (
        stmt.type === 'ExportNamedDeclaration' &&
        stmt.declaration &&
        stmt.declaration.type === 'VariableDeclaration'
      ) {
        walkVariableDeclaration(stmt.declaration, isRoot)
      } else if (
        stmt.type === 'LabeledStatement' &&
        stmt.body.type === 'VariableDeclaration'
      ) {
        walkVariableDeclaration(stmt.body, isRoot)
      }
    }
  }

  /** 按 let/const 块作用域或 var 函数作用域登记变量声明中的全部标识符。 */
  function walkVariableDeclaration(
    stmt: VariableDeclaration,
    isRoot = false,
    scope = stmt.kind === 'var'
      ? functionScopeStack[functionScopeStack.length - 1]
      : currentScope,
  ) {
    if (stmt.declare) {
      return
    }
    for (const decl of stmt.declarations) {
      const isDefineProps =
        isRoot && decl.init && isCallOf(unwrapTSNode(decl.init), 'defineProps')
      for (const id of extractIdentifiers(decl.id)) {
        if (isDefineProps) {
          // 根 defineProps 解构已由 knownProps 标为 true；这里只排除声明位置，不能覆盖其值。
          excludedIds.add(id)
        } else {
          registerLocalBinding(id, scope)
        }
      }
    }
  }

  /**
   * 提前收集函数体任意嵌套块中的 var，因为 var 会提升到整个函数作用域。
   * 类型节点、嵌套函数和 class 有独立作用域，不能向当前函数泄漏声明。
   */
  function walkFunctionScopeVarDeclarations(
    scopeNode: Program | BlockStatement,
    isRoot = false,
  ) {
    const scope = functionScopeStack[functionScopeStack.length - 1]
    walk(scopeNode, {
      /** 遍历当前函数体，跳过独立作用域并提前登记所有 var 声明。 */
      enter(node: Node, parent: Node | null) {
        if (
          parent &&
          parent.type.startsWith('TS') &&
          !TS_NODE_TYPES.includes(parent.type)
        ) {
          return this.skip()
        }

        if (
          isFunctionType(node) ||
          node.type === 'ClassDeclaration' ||
          node.type === 'ClassExpression'
        ) {
          return this.skip()
        }

        if (node.type === 'VariableDeclaration' && node.kind === 'var') {
          walkVariableDeclaration(node, isRoot && parent === scopeNode, scope)
        }
      },
    })
  }

  /** 把一个确认引用 prop 的标识符改写为属性访问，并拒绝赋值/自增。 */
  function rewriteId(id: Identifier, parent: Node, parentStack: Node[]) {
    if (
      (parent.type === 'AssignmentExpression' && id === parent.left) ||
      parent.type === 'UpdateExpression'
    ) {
      ctx.error(`Cannot assign to destructured props as they are readonly.`, id)
    }

    if (isStaticProperty(parent) && parent.shorthand) {
      // 对象简写读取 `{ foo }` 要扩展为 `{ foo: __props.foo }`；声明解构 pattern 不改，
      // 但解构赋值表达式属于真实读取/写入，仍需按引用规则处理。
      if (
        !(parent as any).inPattern ||
        isInDestructureAssignment(parent, parentStack)
      ) {
        // `{ prop }` → `{ prop: __props.prop }`。
        ctx.s.appendLeft(
          id.end! + ctx.startOffset!,
          `: ${genPropsAccessExp(propsLocalToPublicMap[id.name])}`,
        )
      }
    } else {
      // 普通读取 `x` → `__props.x`。
      ctx.s.overwrite(
        id.start! + ctx.startOffset!,
        id.end! + ctx.startOffset!,
        genPropsAccessExp(propsLocalToPublicMap[id.name]),
      )
    }
  }

  /** 检查 watch/toRef 直接接收解构值导致响应性丢失的易错调用。 */
  function checkUsage(node: Node, method: string, alias = method) {
    if (isCallOf(node, alias)) {
      const arg = unwrapTSNode(node.arguments[0])
      if (arg.type === 'Identifier' && currentScope[arg.name]) {
        ctx.error(
          `"${arg.name}" is a destructured prop and should not be passed directly to ${method}(). ` +
            `Pass a getter () => ${arg.name} instead.`,
          arg,
        )
      }
    }
  }

  // 先预扫描根作用域全部声明，再进行引用遍历和源码改写。
  const ast = ctx.scriptSetupAst!
  walkFunctionScopeVarDeclarations(ast, true)
  walkScope(ast, true)
  walk(ast, {
    /** 进入运行时节点时维护词法作用域、检查易错调用并改写 props 引用。 */
    enter(node: Node, parent: Node | null) {
      parent && parentStack.push(parent)

      // 纯类型节点不会产生运行时引用；TS_NODE_TYPES 白名单中的包装节点仍需继续进入。
      if (
        parent &&
        parent.type.startsWith('TS') &&
        !TS_NODE_TYPES.includes(parent.type)
      ) {
        return this.skip()
      }

      checkUsage(node, 'watch', vueImportAliases.watch)
      checkUsage(node, 'toRef', vueImportAliases.toRef)

      // 函数参数和 var 有自己的函数作用域。
      if (isFunctionType(node)) {
        pushScope(true)
        walkFunctionParams(node, registerLocalBinding)
        if (node.body.type === 'BlockStatement') {
          walkFunctionScopeVarDeclarations(node.body)
          walkScope(node.body)
        }
        return
      }

      // catch 参数只在 catch block 内遮蔽同名 prop。
      if (node.type === 'CatchClause') {
        pushScope()
        if (node.param && node.param.type === 'Identifier') {
          registerLocalBinding(node.param)
        }
        walkScope(node.body)
        return
      }

      // for 的循环变量只在循环头和循环体内有效。
      if (
        node.type === 'ForOfStatement' ||
        node.type === 'ForInStatement' ||
        node.type === 'ForStatement'
      ) {
        pushScope()
        const varDecl = node.type === 'ForStatement' ? node.init : node.left
        if (varDecl && varDecl.type === 'VariableDeclaration') {
          walkVariableDeclaration(varDecl)
        }
        if (node.body.type === 'BlockStatement') {
          walkScope(node.body)
        }
        return
      }

      // 普通 BlockStatement 为 let/const/class 建立词法作用域。
      if (node.type === 'BlockStatement' && !isFunctionType(parent!)) {
        pushScope()
        walkScope(node)
        return
      }

      if (node.type === 'Identifier') {
        if (
          isReferencedIdentifier(node, parent!, parentStack) &&
          !excludedIds.has(node)
        ) {
          if (currentScope[node.name]) {
            rewriteId(node, parent!, parentStack)
          }
        }
      }
    },
    /** 离开函数、块、catch 或循环时恢复父作用域并同步父节点栈。 */
    leave(node: Node, parent: Node | null) {
      parent && parentStack.pop()
      if (isFunctionType(node)) {
        popScope(true)
      } else if (node.type === 'BlockStatement' && !isFunctionType(parent!)) {
        popScope()
      } else if (
        node.type === 'CatchClause' ||
        node.type === 'ForOfStatement' ||
        node.type === 'ForInStatement' ||
        node.type === 'ForStatement'
      ) {
        popScope()
      }
    },
  })
}
