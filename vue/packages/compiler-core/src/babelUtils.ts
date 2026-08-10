// 此文件只能使用 @babel/types 的类型，不能导入其运行时方法；否则浏览器编译器会被迫
// 打包 Babel 中对 Node `process` 的引用。运行时遍历使用体积更小的 estree-walker。
import type {
  BlockStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Function,
  Identifier,
  Node,
  ObjectProperty,
  Program,
  SwitchCase,
  SwitchStatement,
} from '@babel/types'
import { walk } from 'estree-walker'

/**
 * 遍历 Babel AST 中的标识符，同时维护函数、块、catch、for、switch 局部作用域。
 *
 * 默认只回调真正引用且不属于局部声明的标识符，供模板表达式添加 `_ctx.`；
 * `includeAll` 用于需要同时观察声明位置的分析。`knownIds` 使用计数支持嵌套同名遮蔽。
 */
export function walkIdentifiers(
  root: Node,
  onIdentifier: (
    node: Identifier,
    parent: Node | null,
    parentStack: Node[],
    isReference: boolean,
    isLocal: boolean,
  ) => void,
  includeAll = false,
  parentStack: Node[] = [],
  knownIds: Record<string, number> = Object.create(null),
): void {
  if (__BROWSER__) {
    return
  }

  const rootExp =
    root.type === 'Program'
      ? root.body[0].type === 'ExpressionStatement' && root.body[0].expression
      : root

  walk(root, {
    /** 进入 Babel 节点时登记父栈、跳过无关 TS 子树并报告自由标识符。 */
    enter(
      node: Node & {
        /** 当前 Babel 节点建立的局部标识符集合。 */
        scopeIds?: Set<string>
      },
      parent: Node | null,
    ) {
      parent && parentStack.push(parent)
      if (
        parent &&
        parent.type.startsWith('TS') &&
        !TS_NODE_TYPES.includes(parent.type)
      ) {
        return this.skip()
      }
      if (node.type === 'Identifier') {
        const isLocal = !!knownIds[node.name]
        const isRefed = isReferencedIdentifier(node, parent, parentStack)
        if (includeAll || (isRefed && !isLocal)) {
          onIdentifier(node, parent, parentStack, isRefed, isLocal)
        }
      } else if (
        node.type === 'ObjectProperty' &&
        // eslint-disable-next-line no-restricted-syntax
        parent?.type === 'ObjectPattern'
      ) {
        // 标记解构属性，区分 `{ foo } = obj` 中的声明/赋值目标与普通对象读取。
        ;(node as any).inPattern = true
      } else if (isFunctionType(node)) {
        if (node.scopeIds) {
          node.scopeIds.forEach(id => markKnownIds(id, knownIds))
        } else {
          // 函数参数是局部绑定，函数体引用它们时不能添加 `_ctx.`。
          walkFunctionParams(node, id =>
            markScopeIdentifier(node, id, knownIds),
          )
        }
      } else if (node.type === 'BlockStatement') {
        if (node.scopeIds) {
          node.scopeIds.forEach(id => markKnownIds(id, knownIds))
        } else {
          // 修复 #3445：记录块级 `let` / `const` / function / class；否则事件表达式中的
          // `{ const x = 1; use(x) }` 会把局部 x 错误改写成 `_ctx.x`。
          walkBlockDeclarations(node, id =>
            markScopeIdentifier(node, id, knownIds),
          )
        }
      } else if (node.type === 'SwitchStatement') {
        if (node.scopeIds) {
          node.scopeIds.forEach(id => markKnownIds(id, knownIds))
        } else {
          // switch 的各 case 共享同一词法块，提前收集所有 case 中的块级声明。
          walkSwitchStatement(node, false, id =>
            markScopeIdentifier(node, id, knownIds),
          )
        }
      } else if (node.type === 'CatchClause' && node.param) {
        if (node.scopeIds) {
          node.scopeIds.forEach(id => markKnownIds(id, knownIds))
        } else {
          for (const id of extractIdentifiers(node.param)) {
            markScopeIdentifier(node, id, knownIds)
          }
        }
      } else if (isForStatement(node)) {
        if (node.scopeIds) {
          node.scopeIds.forEach(id => markKnownIds(id, knownIds))
        } else {
          walkForStatement(node, false, id =>
            markScopeIdentifier(node, id, knownIds),
          )
        }
      }
    },
    /** 离开节点时弹出父栈并撤销该节点声明的局部标识符。 */
    leave(
      node: Node & {
        /** 与 enter 阶段对应，离开节点时据此撤销局部标识符。 */
        scopeIds?: Set<string>
      },
      parent: Node | null,
    ) {
      parent && parentStack.pop()
      if (node !== rootExp && node.scopeIds) {
        for (const id of node.scopeIds) {
          knownIds[id]--
          if (knownIds[id] === 0) {
            delete knownIds[id]
          }
        }
      }
    },
  })
}

/**
 * 判断 Identifier 在父节点语境中是否为“读取/写入引用”，而非属性名、声明名或类型位置。
 */
export function isReferencedIdentifier(
  id: Identifier,
  parent: Node | null,
  parentStack: Node[],
): boolean {
  if (__BROWSER__) {
    return false
  }

  if (!parent) {
    return true
  }

  // `arguments` 虽由 parser 表示成 Identifier，却是函数内建绑定，不来自模板上下文。
  if (id.name === 'arguments') {
    return false
  }

  if (isReferenced(id, parent, parentStack[parentStack.length - 2])) {
    return true
  }

  // Babel 的 isReferenced 会把赋值左侧判为非引用；模板前缀化仍必须改写写入目标，
  // 例如 `foo = 1` 应变成 `_ctx.foo = 1`，因此补充这些分支。
  switch (parent.type) {
    case 'AssignmentExpression':
    case 'AssignmentPattern':
      return true
    case 'ObjectProperty':
      return parent.key !== id && isInDestructureAssignment(parent, parentStack)
    case 'ArrayPattern':
      return isInDestructureAssignment(parent, parentStack)
  }

  return false
}

/** 沿解构 Pattern 祖先向上检查当前属性/数组模式是否属于赋值表达式左侧。 */
export function isInDestructureAssignment(
  parent: Node,
  parentStack: Node[],
): boolean {
  if (
    parent &&
    (parent.type === 'ObjectProperty' || parent.type === 'ArrayPattern')
  ) {
    let i = parentStack.length
    while (i--) {
      const p = parentStack[i]
      if (p.type === 'AssignmentExpression') {
        return true
      } else if (p.type !== 'ObjectProperty' && !p.type.endsWith('Pattern')) {
        break
      }
    }
  }
  return false
}

/** 标识符是否位于 `new Foo.bar()` 的构造目标成员链中。 */
export function isInNewExpression(parentStack: Node[]): boolean {
  let i = parentStack.length
  while (i--) {
    const p = parentStack[i]
    if (p.type === 'NewExpression') {
      return true
    } else if (p.type !== 'MemberExpression') {
      break
    }
  }
  return false
}

/** 提取函数参数模式声明的全部 Identifier。 */
export function walkFunctionParams(
  node: Function,
  onIdent: (id: Identifier) => void,
): void {
  for (const p of node.params) {
    for (const id of extractIdentifiers(p)) {
      onIdent(id)
    }
  }
}

/**
 * 收集一个块/Program/SwitchCase 直接作用域中的变量、函数、类及 var 提升声明。
 */
export function walkBlockDeclarations(
  block: BlockStatement | SwitchCase | Program,
  onIdent: (node: Identifier) => void,
): void {
  const body = block.type === 'SwitchCase' ? block.consequent : block.body
  for (const stmt of body) {
    if (stmt.type === 'VariableDeclaration') {
      if (stmt.declare) continue
      for (const decl of stmt.declarations) {
        for (const id of extractIdentifiers(decl.id)) {
          onIdent(id)
        }
      }
    } else if (
      stmt.type === 'FunctionDeclaration' ||
      stmt.type === 'ClassDeclaration'
    ) {
      if (stmt.declare || !stmt.id) continue
      onIdent(stmt.id)
    } else if (isForStatement(stmt)) {
      walkForStatement(stmt, true, onIdent)
    } else if (stmt.type === 'SwitchStatement') {
      walkSwitchStatement(stmt, true, onIdent)
    }
  }
}

/** 节点是否为三类 for 语句。 */
function isForStatement(
  stmt: Node,
): stmt is ForStatement | ForOfStatement | ForInStatement {
  return (
    stmt.type === 'ForOfStatement' ||
    stmt.type === 'ForInStatement' ||
    stmt.type === 'ForStatement'
  )
}

/**
 * 收集 for 初始化区声明。`var` 属于外层函数/块扫描，`let/const` 属于 for 自身作用域，
 * `isVar` 用于在两个阶段只收集对应种类，避免重复登记。
 */
function walkForStatement(
  stmt: ForStatement | ForOfStatement | ForInStatement,
  isVar: boolean,
  onIdent: (id: Identifier) => void,
) {
  const variable = stmt.type === 'ForStatement' ? stmt.init : stmt.left
  if (
    variable &&
    variable.type === 'VariableDeclaration' &&
    (variable.kind === 'var' ? isVar : !isVar)
  ) {
    for (const decl of variable.declarations) {
      for (const id of extractIdentifiers(decl.id)) {
        onIdent(id)
      }
    }
  }
}

/** 收集 switch 各 case 中的 var 或块级声明。 */
function walkSwitchStatement(
  stmt: SwitchStatement,
  isVar: boolean,
  onIdent: (id: Identifier) => void,
) {
  for (const cs of stmt.cases) {
    for (const stmt of cs.consequent) {
      if (
        stmt.type === 'VariableDeclaration' &&
        (stmt.kind === 'var' ? isVar : !isVar)
      ) {
        for (const decl of stmt.declarations) {
          for (const id of extractIdentifiers(decl.id)) {
            onIdent(id)
          }
        }
      }
    }
    walkBlockDeclarations(cs, onIdent)
  }
}

/**
 * 从 Identifier 或对象/数组/剩余/默认值解构模式中递归提取被绑定的名字。
 */
export function extractIdentifiers(
  param: Node,
  nodes: Identifier[] = [],
): Identifier[] {
  switch (param.type) {
    case 'Identifier':
      nodes.push(param)
      break

    case 'MemberExpression':
      let object: any = param
      while (object.type === 'MemberExpression') {
        object = object.object
      }
      nodes.push(object)
      break

    case 'ObjectPattern':
      for (const prop of param.properties) {
        if (prop.type === 'RestElement') {
          extractIdentifiers(prop.argument, nodes)
        } else {
          extractIdentifiers(prop.value, nodes)
        }
      }
      break

    case 'ArrayPattern':
      param.elements.forEach(element => {
        if (element) extractIdentifiers(element, nodes)
      })
      break

    case 'RestElement':
      extractIdentifiers(param.argument, nodes)
      break

    case 'AssignmentPattern':
      extractIdentifiers(param.left, nodes)
      break
  }

  return nodes
}

/** 增加已知局部名的嵌套计数。 */
function markKnownIds(name: string, knownIds: Record<string, number>) {
  if (name in knownIds) {
    knownIds[name]++
  } else {
    knownIds[name] = 1
  }
}

/** 把局部名同时登记到当前作用域节点和全局计数表，便于 leave 时成组撤销。 */
function markScopeIdentifier(
  node: Node & {
    /** 在该作用域节点上累计声明的局部标识符。 */
    scopeIds?: Set<string>
  },
  child: Identifier,
  knownIds: Record<string, number>,
) {
  const { name } = child
  if (node.scopeIds && node.scopeIds.has(name)) {
    return
  }
  markKnownIds(name, knownIds)
  ;(node.scopeIds || (node.scopeIds = new Set())).add(name)
}

/** 节点是否为函数声明、函数表达式、箭头函数或方法。 */
export const isFunctionType = (node: Node): node is Function => {
  return /Function(?:Expression|Declaration)$|Method$/.test(node.type)
}

/** 节点是否为未计算的对象属性/方法，例如 `{ foo: value }`。 */
export const isStaticProperty = (node: Node): node is ObjectProperty =>
  node &&
  (node.type === 'ObjectProperty' || node.type === 'ObjectMethod') &&
  !node.computed

/** 当前节点是否正是静态对象属性的 key。 */
export const isStaticPropertyKey = (node: Node, parent: Node): boolean =>
  isStaticProperty(parent) && parent.key === node

/**
 * 判断节点相对父节点是否构成值引用。
 *
 * 逻辑复制自 Babel `isReferenced.ts`，以避免运行时依赖包含 `process` 引用的 @babel/types。
 * Babel 新增/调整 AST 节点语义时需同步检查此实现。
 * 原实现：https://github.com/babel/babel/blob/main/packages/babel-types/src/validators/isReferenced.ts
 *
 * https://github.com/babel/babel/blob/main/LICENSE
 */
function isReferenced(node: Node, parent: Node, grandparent?: Node): boolean {
  switch (parent.type) {
    // 是引用：PARENT[NODE]、NODE.child；不是引用：parent.NODE。
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      if (parent.property === node) {
        return !!parent.computed
      }
      return parent.object === node

    case 'JSXMemberExpression':
      return parent.object === node
    // 声明名不是引用，初始化值是引用。
    case 'VariableDeclarator':
      return parent.init === node

    // 箭头函数 body 是引用，参数声明不是。
    case 'ArrowFunctionExpression':
      return parent.body === node

    // 私有名称 `#NODE` 在声明和访问中都不是上下文变量引用。
    case 'PrivateName':
      return false

    // 普通方法名/参数不是引用，计算方法名 `[NODE]` 是。
    case 'ClassMethod':
    case 'ClassPrivateMethod':
    case 'ObjectMethod':
      if (parent.key === node) {
        return !!parent.computed
      }
      return false

    // 对象计算 key 是引用，静态 key 不是；value 是否引用还取决于是否处于解构 Pattern。
    case 'ObjectProperty':
      if (parent.key === node) {
        return !!parent.computed
      }
      return !grandparent || grandparent.type !== 'ObjectPattern'
    // 类字段静态 key 不是引用；计算 key 和 value 是引用。
    case 'ClassProperty':
      if (parent.key === node) {
        return !!parent.computed
      }
      return true
    case 'ClassPrivateProperty':
      return parent.key !== node

    // 类名不是引用，extends 目标是引用。
    case 'ClassDeclaration':
    case 'ClassExpression':
      return parent.superClass === node

    // 此处沿用 Babel 语义只把赋值右值视为引用；写入左值由上层额外补齐。
    case 'AssignmentExpression':
      return parent.right === node

    // 默认值右侧是引用，Pattern 左侧是声明/写入目标。
    case 'AssignmentPattern':
      return parent.right === node

    // label 名不是变量引用。
    case 'LabeledStatement':
      return false

    // catch 参数是局部声明。
    case 'CatchClause':
      return false

    // rest 参数是局部声明。
    case 'RestElement':
      return false

    case 'BreakStatement':
    case 'ContinueStatement':
      return false

    // 函数名与参数由作用域收集处理，不是外部引用。
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      return false

    // re-export 的导出名不是本地变量引用。
    case 'ExportNamespaceSpecifier':
    case 'ExportDefaultSpecifier':
      return false

    // 本地 export 的 local 是引用，exported 名不是；带 source 的 re-export 两者都不是本地引用。
    case 'ExportSpecifier':
      // @ts-expect-error
      // eslint-disable-next-line no-restricted-syntax
      if (grandparent?.source) {
        return false
      }
      return parent.local === node

    // 所有 import specifier 都是声明，不是读取引用。
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ImportSpecifier':
      return false

    // import attribute 名不是变量引用。
    case 'ImportAttribute':
      return false

    // JSX 属性名不是变量引用。
    case 'JSXAttribute':
      return false

    // Pattern 内标识符由声明/写入逻辑另行处理。
    case 'ObjectPattern':
    case 'ArrayPattern':
      return false

    // MetaProperty 两侧都是语法关键字，不是变量。
    case 'MetaProperty':
      return false

    // Flow 对象类型的值类型可引用类型名，静态属性 key 不引用。
    case 'ObjectTypeProperty':
      return parent.key !== node

    // TS enum 初始化值是引用，成员名不是。
    case 'TSEnumMember':
      return parent.id !== node

    // TS 属性签名仅计算 key 是引用。
    case 'TSPropertySignature':
      if (parent.key === node) {
        return !!parent.computed
      }

      return true
  }

  return true
}

/**
 * 仅包装运行时表达式、不引入新值语义的 TypeScript AST 节点类型。
 * 前缀化和函数/成员判断时可连续剥离这些外壳。
 */
export const TS_NODE_TYPES: string[] = [
  'TSAsExpression', // foo as number
  'TSTypeAssertion', // (<number>foo)
  'TSNonNullExpression', // foo!
  'TSInstantiationExpression', // foo<string>
  'TSSatisfiesExpression', // foo satisfies T
]

/** 递归剥离 `as`、非空断言、泛型实例化、satisfies 等 TS 表达式包装。 */
export function unwrapTSNode(node: Node): Node {
  if (TS_NODE_TYPES.includes(node.type)) {
    return unwrapTSNode((node as any).expression)
  } else {
    return node
  }
}
