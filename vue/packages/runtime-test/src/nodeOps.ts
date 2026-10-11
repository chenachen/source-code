import { markRaw } from '@vue/reactivity'

/** 测试宿主的节点判别标签；序列化与渲染断言据此区分元素、文本、注释。 */
export enum TestNodeTypes {
  /** 承载文本内容的叶节点；空文本节点仍有对象身份。 */
  TEXT = 'text',
  /** 持有 props、事件表与有序 children 的容器节点。 */
  ELEMENT = 'element',
  /** 承载占位/锚点内容的注释叶节点。 */
  COMMENT = 'comment',
}

/** 测试宿主操作日志的类别；断言可区分创建、移动、移除与内容/属性更新。 */
export enum NodeOpTypes {
  /** 创建新的宿主对象，尚未插入父 children。 */
  CREATE = 'create',
  /** 插入或移动已有对象；移动过程内部移除不额外记录 REMOVE。 */
  INSERT = 'insert',
  /** 从已有父节点脱离；已无父节点时不产生此记录。 */
  REMOVE = 'remove',
  /** 更新一个文本节点的内容，不更换其身份。 */
  SET_TEXT = 'setText',
  /** 替换元素全部 children；非空内容变成一个新文本节点。 */
  SET_ELEMENT_TEXT = 'setElementText',
  /** 记录 prop 的前后值，包含事件 prop。 */
  PATCH = 'patch',
}

/** 测试渲染器的元素对象；parentNode 与父级 children 必须双向一致，props 和事件表互不代替。 */
export interface TestElement {
  /** 全局递增的宿主身份；日志重置不会复用已有编号。 */
  id: number
  /** 节点判别标签，与该接口表示的节点种类一致。 */
  type: TestNodeTypes.ELEMENT
  /** 当前父元素；insert/remove 与父 children 同步维护，未挂载时为 null。 */
  parentNode: TestElement | null
  /** 创建时传入的标签名，序列化生成开始/结束标签。 */
  tag: string
  /** 有序宿主子节点列表，是 nextSibling 与序列化的顺序依据。 */
  children: TestNode[]
  /** 保存未经 DOM 转换的绑定值，序列化排除事件和 nullish 值。 */
  props: Record<string, any>
  /** 按规范化事件名保存函数或函数数组；triggerEvent 直接调用而不模拟浏览器冒泡。 */
  eventListeners: Record<string, Function | Function[]> | null
}

/** 测试宿主文本对象；text 更新保留 id，移动只改变 parentNode。 */
export interface TestText {
  /** 全局递增的宿主身份；日志重置不会复用已有编号。 */
  id: number
  /** 节点判别标签，与该接口表示的节点种类一致。 */
  type: TestNodeTypes.TEXT
  /** 当前父元素；insert/remove 与父 children 同步维护，未挂载时为 null。 */
  parentNode: TestElement | null
  /** 文本或注释的原始内容，序列化不额外转义。 */
  text: string
}

/** 测试宿主注释对象；与文本节点独立标记，以观察占位和锚点。 */
export interface TestComment {
  /** 全局递增的宿主身份；日志重置不会复用已有编号。 */
  id: number
  /** 节点判别标签，与该接口表示的节点种类一致。 */
  type: TestNodeTypes.COMMENT
  /** 当前父元素；insert/remove 与父 children 同步维护，未挂载时为 null。 */
  parentNode: TestElement | null
  /** 文本或注释的原始内容，序列化不额外转义。 */
  text: string
}

/** 宿主树中允许的三类节点；由 type 收窄后访问对应内容。 */
export type TestNode = TestElement | TestText | TestComment

/** 一次宿主调用的记录；可选字段随 type 携带操作的目标、锚点与前后值，保留对象引用便于身份断言。 */
export interface NodeOp {
  /** 操作类别；决定其他可选字段在这条记录中的意义。 */
  type: NodeOpTypes
  /** CREATE 记录中的宿主节点种类。 */
  nodeType?: TestNodeTypes
  /** CREATE 元素记录中的标签名。 */
  tag?: string
  /** 创建/更新文本时传入的内容。 */
  text?: string
  /** 本次创建、移动、删除或更新的对象引用。 */
  targetNode?: TestNode
  /** 插入或移除时涉及的父容器引用。 */
  parentNode?: TestElement
  /** INSERT 的参考子节点；null/undefined 表示追加。 */
  refNode?: TestNode | null
  /** PATCH 更新的原始 prop 名。 */
  propKey?: string
  /** PATCH 收到的旧绑定值，用于核对更新输入。 */
  propPrevValue?: any
  /** PATCH 收到的新绑定值，用于核对最终赋值。 */
  propNextValue?: any
}

let nodeId: number = 0
let recordedNodeOps: NodeOp[] = []

/** 追加操作记录，保留目标对象引用；由每个宿主实现同步调用。 */
export function logNodeOp(op: NodeOp): void {
  recordedNodeOps.push(op)
}

/** 清空当前操作日志，节点树和全局 nodeId 不随日志重置。 */
export function resetOps(): void {
  recordedNodeOps = []
}

/** 取日志数组的浅拷贝并清空缓冲；返回记录仍引用真实宿主对象。 */
export function dumpOps(): NodeOp[] {
  const ops = recordedNodeOps.slice()
  resetOps()
  return ops
}

/** 创建未挂载的元素并记录 CREATE；markRaw 阻止测试节点被响应式代理，保持身份断言稳定。 */
function createElement(tag: string): TestElement {
  const node: TestElement = {
    id: nodeId++,
    type: TestNodeTypes.ELEMENT,
    tag,
    children: [],
    props: {},
    parentNode: null,
    eventListeners: null,
  }
  logNodeOp({
    type: NodeOpTypes.CREATE,
    nodeType: TestNodeTypes.ELEMENT,
    targetNode: node,
    tag,
  })
  // 保持测试宿主对象原始身份，防止响应式观察将其代理。
  markRaw(node)
  return node
}

/** 创建未挂载的文本节点并记录 CREATE；markRaw 保留原始宿主对象身份。 */
function createText(text: string): TestText {
  const node: TestText = {
    id: nodeId++,
    type: TestNodeTypes.TEXT,
    text,
    parentNode: null,
  }
  logNodeOp({
    type: NodeOpTypes.CREATE,
    nodeType: TestNodeTypes.TEXT,
    targetNode: node,
    text,
  })
  // 保持测试宿主对象原始身份，防止响应式观察将其代理。
  markRaw(node)
  return node
}

/** 创建未挂载的注释节点并记录 CREATE；注释内容可被序列化为锚点。 */
function createComment(text: string): TestComment {
  const node: TestComment = {
    id: nodeId++,
    type: TestNodeTypes.COMMENT,
    text,
    parentNode: null,
  }
  logNodeOp({
    type: NodeOpTypes.CREATE,
    nodeType: TestNodeTypes.COMMENT,
    targetNode: node,
    text,
  })
  // 保持测试宿主对象原始身份，防止响应式观察将其代理。
  markRaw(node)
  return node
}

/** 记录 SET_TEXT 并就地更新文本；不重建节点或改变父级。 */
function setText(node: TestText, text: string): void {
  logNodeOp({
    type: NodeOpTypes.SET_TEXT,
    targetNode: node,
    text,
  })
  node.text = text
}

/**
 * 将 child 插到 parent 的 ref 前，无 ref 时追加。
 * 先验证 ref 属于新父，再记录 INSERT；从旧父脱离后重新计算 ref 索引，防止同父移动使索引偏移。内部 remove 不记录 REMOVE；最后同时更新 children 与 parentNode。
 */
function insert(
  child: TestNode,
  parent: TestElement,
  ref?: TestNode | null,
): void {
  let refIndex
  if (ref) {
    refIndex = parent.children.indexOf(ref)
    if (refIndex === -1) {
      console.error('ref: ', ref)
      console.error('parent: ', parent)
      throw new Error('ref is not a child of parent')
    }
  }
  logNodeOp({
    type: NodeOpTypes.INSERT,
    targetNode: child,
    parentNode: parent,
    refNode: ref,
  })
  // 移动前先从旧父脱离；这属于 INSERT，不另记 REMOVE。
  remove(child, false)
  // 同父移动会改变 ref 索引，移除后按当前 children 重新定位。
  refIndex = ref ? parent.children.indexOf(ref) : -1
  if (refIndex === -1) {
    parent.children.push(child)
    child.parentNode = parent
  } else {
    parent.children.splice(refIndex, 0, child)
    child.parentNode = parent
  }
}

/**
 * 从已有父 children 移除并清空 parentNode；logOp=false 用于移动，避免多记卸载。
 * 无父节点直接结束；parentNode 指向父却找不到对应 children 时抛错，暴露宿主树关系损坏。
 */
function remove(child: TestNode, logOp = true): void {
  const parent = child.parentNode
  if (parent) {
    if (logOp) {
      logNodeOp({
        type: NodeOpTypes.REMOVE,
        targetNode: child,
        parentNode: parent,
      })
    }
    const i = parent.children.indexOf(child)
    if (i > -1) {
      parent.children.splice(i, 1)
    } else {
      console.error('target: ', child)
      console.error('parent: ', parent)
      throw Error('target is not a childNode of parent')
    }
    child.parentNode = null
  }
}

/**
 * 记录 SET_ELEMENT_TEXT，先清除旧 children 的 parentNode，再以空数组或单个新文本节点替换。
 * 它表达整体文本覆盖，内部新文本不额外产生 CREATE/INSERT 日志。
 */
function setElementText(el: TestElement, text: string): void {
  logNodeOp({
    type: NodeOpTypes.SET_ELEMENT_TEXT,
    targetNode: el,
    text,
  })
  el.children.forEach(c => {
    c.parentNode = null
  })
  if (!text) {
    el.children = []
  } else {
    el.children = [
      {
        id: nodeId++,
        type: TestNodeTypes.TEXT,
        text,
        parentNode: el,
      },
    ]
  }
}

/** 向 core 返回记录的父容器；已脱离节点返回 null。 */
function parentNode(node: TestNode): TestElement | null {
  return node.parentNode
}

/** 按父 children 中的顺序返回下一个节点；无父级或末尾时返回 null。 */
function nextSibling(node: TestNode): TestNode | null {
  const parent = node.parentNode
  if (!parent) {
    return null
  }
  const i = parent.children.indexOf(node)
  return parent.children[i + 1] || null
}

/** 明确拒绝测试宿主中的选择器查询；Teleport 用例应直接提供目标对象。 */
function querySelector(): never {
  throw new Error('querySelector not supported in test renderer.')
}

/** 把 scopeId 作为值为空字符串的 prop 写入，供序列化观察 CSS 作用域标记。 */
function setScopeId(el: TestElement, id: string): void {
  el.props[id] = ''
}

/** 传给 createRenderer 的内存宿主操作表；接口字段分别引用同文件实现，日志用于核对渲染器实际操作。 */
export const nodeOps: {
  /** 宿主选项中对同名 insert 实现的精确签名引用；运行时直接复用该函数。 */
  insert: typeof insert
  /** 宿主选项中对同名 remove 实现的精确签名引用；运行时直接复用该函数。 */
  remove: typeof remove
  /** 宿主选项中对同名 createElement 实现的精确签名引用；运行时直接复用该函数。 */
  createElement: typeof createElement
  /** 宿主选项中对同名 createText 实现的精确签名引用；运行时直接复用该函数。 */
  createText: typeof createText
  /** 宿主选项中对同名 createComment 实现的精确签名引用；运行时直接复用该函数。 */
  createComment: typeof createComment
  /** 宿主选项中对同名 setText 实现的精确签名引用；运行时直接复用该函数。 */
  setText: typeof setText
  /** 宿主选项中对同名 setElementText 实现的精确签名引用；运行时直接复用该函数。 */
  setElementText: typeof setElementText
  /** 当前父元素；insert/remove 与父 children 同步维护，未挂载时为 null。 */
  parentNode: typeof parentNode
  /** 宿主选项中对同名 nextSibling 实现的精确签名引用；运行时直接复用该函数。 */
  nextSibling: typeof nextSibling
  /** 宿主选项中对同名 querySelector 实现的精确签名引用；运行时直接复用该函数。 */
  querySelector: typeof querySelector
  /** 宿主选项中对同名 setScopeId 实现的精确签名引用；运行时直接复用该函数。 */
  setScopeId: typeof setScopeId
} = {
  insert,
  remove,
  createElement,
  createText,
  createComment,
  setText,
  setElementText,
  parentNode,
  nextSibling,
  querySelector,
  setScopeId,
}
