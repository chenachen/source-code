import type {
  TrustedHTML,
  TrustedTypesWindow,
} from 'trusted-types/lib/index.js';
import type { Config } from './config';

/**
 * DOMPurify 默认实例、实例工厂与公开操作组成的可调用对象契约。
 *
 * @remarks
 * 包默认导出是一个已绑定当前全局环境的实例，同时可把 `WindowLike` 作为参数再次调用，
 * 创建隔离到另一 realm 的实例。方法共享该实例的持久配置与 hook 状态。
 * `sanitize()` 重载按传入配置的类型选择签名，实际返回由生效配置决定；`setConfig()` 可使
 * 单次配置失效。组合返回模式依次优先选择真实节点的 `IN_PLACE`、`RETURN_DOM_FRAGMENT`、
 * `RETURN_DOM`、有活动策略的 `RETURN_TRUSTED_TYPE`，其余返回字符串。
 * 传给 hook 的配置快照只在支持冻结时冻结顶层，嵌套数组仍复用调用方引用；活动允许表
 * 通过事件对象单独暴露，修改这些表的成员才会改变本次遍历中的允许规则。
 */
export interface DOMPurify {
  /**
   * 使用给定类 Window 对象创建 DOMPurify 实例；省略时使用当前全局 `window`。
   *
   * @param root - 提供 DOM 构造器、文档和可选 Trusted Types API 的 realm 根对象。
   * @returns 状态和 hook 数组独立的新实例；环境不完整时实例的 `isSupported` 为 `false`。
   */
  (root?: WindowLike): DOMPurify;

  /**
   * 构建时注入的版本标签，供调用方核对正在运行的分发产物版本。
   */
  version: string;

  /**
   * 最近一次进入净化流程后记录的节点或属性删除决策。
   *
   * @remarks
   * 配置解析和允许表隔离成功后重置；更早的输入异常、不支持早退或配置异常保留旧记录。
   * 文本模板清理也会记录修改前的克隆；hook 自行删除的节点不会登记，因此它不是完整变更日志。
   */
  removed: Array<RemovedElement | RemovedAttribute>;

  /**
   * 当前 realm 是否通过 DOM 净化所需的基础能力检查。
   *
   * @remarks 由实例创建时捕获的原生 API 计算，不随单次配置变化。
   */
  isSupported: boolean;

  /**
   * 设置实例级持久配置，后续 `sanitize()` 调用忽略各自传入的临时配置。
   *
   * @param cfg - 要复制、规范化并持久保存的配置；省略时使用空配置。
   */
  setConfig(cfg?: Config): void;

  /**
   * 清除实例级持久配置，使后续调用重新采用单次配置或默认值。
   *
   * @remarks 同时清空持久允许表快照，解除调用方 Trusted Types 策略；已注册 hook 保留。
   */
  clearConfig(): void;

  /**
   * 净化字符串或 DOM 节点，并在请求且平台支持时返回 `TrustedHTML`。
   *
   * @param dirty - 待解析的字符串或待净化的 DOM 节点。
   * @param cfg - `RETURN_TRUSTED_TYPE` 明确为 `true` 的单次配置。
   * @returns 没有更优先的 DOM 返回模式时，用活动策略签名；没有活动策略时仍为字符串。
   */
  sanitize(
    dirty: string | Node,
    cfg: Config & {
      // prettier-ignore
      /** 选择 TrustedHTML 返回值重载。 */
      RETURN_TRUSTED_TYPE: true
    }
  ): TrustedHTML;

  /**
   * 直接净化传入 DOM 节点并返回输入对象本身。
   *
   * @param dirty - 允许原地处理的 DOM 节点。
   * @param cfg - `IN_PLACE` 明确为 `true` 的单次配置。
   * @returns 原地净化后的同一节点；根不允许原地处理或遍历中止时触发根属性和普通子树清理并抛错。
   */
  sanitize(
    dirty: Node,
    cfg: Config & {
      // prettier-ignore
      /** 选择原地 DOM 返回值重载。 */
      IN_PLACE: true
    }
  ): Node;

  /**
   * 净化字符串或节点并返回 DOM 根节点。
   *
   * @param dirty - 待解析的字符串或待复制净化的 DOM 节点。
   * @param cfg - `RETURN_DOM` 明确为 `true` 的单次配置。
   * @returns 字符串输入通常得到 `HTMLBodyElement`，完整文档模式得到文档元素；更优先模式见接口说明。
   */
  sanitize(
    dirty: string | Node,
    cfg: Config & {
      // prettier-ignore
      /** 选择 DOM 根节点返回值重载。 */
      RETURN_DOM: true
    }
  ): Node;

  /**
   * 净化字符串或节点并把结果子节点返回为新 `DocumentFragment`。
   *
   * @param dirty - 待解析的字符串或待复制净化的 DOM 节点。
   * @param cfg - `RETURN_DOM_FRAGMENT` 明确为 `true` 的单次配置。
   * @returns 包含净化后子树的新文档片段；真实节点的原地返回模式优先。
   */
  sanitize(
    dirty: string | Node,
    cfg: Config & {
      // prettier-ignore
      /** 选择文档片段返回值重载。 */
      RETURN_DOM_FRAGMENT: true
    }
  ): DocumentFragment;

  /**
   * 使用可选配置净化字符串或 DOM 节点；没有专用返回模式时返回字符串。
   *
   * @param dirty - 待解析的字符串或待复制净化的 DOM 节点。
   * @param cfg - 可选单次配置；实例已调用 `setConfig()` 时不会采用该值。
   * @returns 默认返回净化后的字符串；持久配置或非字面量配置可选择其他运行时返回模式。
   */
  sanitize(dirty: string | Node, cfg?: Config): string;

  /**
   * 按当前策略检查给定元素上的属性名和值是否可保留。
   *
   * @remarks
   * 仅在配置尚未建立或被 `clearConfig()` 清除时加载默认配置；否则复用最近一次 `sanitize()`
   * 或 `setConfig()` 的状态，包括上次 hook 对活动允许表的修改。不会修改 DOM，也不执行属性 hook。
   * @param tag - 属性所属元素的标签名。
   * @param attr - 属性名。
   * @param value - 待检查属性值。
   * @returns 单个属性通过当前准入分支时为 `true`；不执行完整的元素、属性遍历和写回流程。
   */
  isValidAttribute(tag: string, attr: string, value: string): boolean;

  /**
   * 注册接收普通 `Node` 的元素遍历阶段 hook。
   *
   * @param entryPoint - 元素净化前、后或 Shadow Node 阶段名称。
   * @param hookFunction - 按注册顺序追加到该阶段数组的回调。
   */
  addHook(entryPoint: BasicHookName, hookFunction: NodeHook): void;

  /**
   * 注册属性净化前后 hook；公开类型将当前节点标为 `Element`。
   *
   * @param entryPoint - 属性净化前或后阶段；前置阶段实际也会收到没有属性集合的非元素节点。
   * @param hookFunction - 按注册顺序追加到该阶段数组的回调。
   */
  addHook(entryPoint: ElementHookName, hookFunction: ElementHook): void;

  /**
   * 注册接收 `DocumentFragment` 的 Shadow DOM 净化前后 hook。
   *
   * @param entryPoint - Shadow DOM 净化前或后阶段名称。
   * @param hookFunction - 按注册顺序追加到该阶段数组的回调。
   */
  addHook(
    entryPoint: DocumentFragmentHookName,
    hookFunction: DocumentFragmentHook
  ): void;

  /**
   * 注册逐元素决策 hook，可读取或调整本次调用的活动标签允许表。
   *
   * @param entryPoint - 固定为 `uponSanitizeElement`。
   * @param hookFunction - 接收元素事件对象的回调。
   */
  addHook(
    entryPoint: 'uponSanitizeElement',
    hookFunction: UponSanitizeElementHook
  ): void;

  /**
   * 注册逐属性决策 hook，可修改属性值和保留决定。
   *
   * @param entryPoint - 固定为 `uponSanitizeAttribute`。
   * @param hookFunction - 接收可变属性事件对象的回调。
   */
  addHook(
    entryPoint: 'uponSanitizeAttribute',
    hookFunction: UponSanitizeAttributeHook
  ): void;

  /**
   * 从普通节点阶段移除指定 hook；未指定回调时移除最后注册项。
   *
   * @param entryPoint - 目标普通节点阶段。
   * @param hookFunction - 可选目标回调；存在重复注册时移除最后一次注册。
   * @returns 实际移除的回调；目标不存在时为 `undefined`。
   */
  removeHook(
    entryPoint: BasicHookName,
    hookFunction?: NodeHook
  ): NodeHook | undefined;

  /**
   * 从属性前后阶段移除指定 hook；未指定回调时移除最后注册项。
   *
   * @param entryPoint - 目标属性阶段。
   * @param hookFunction - 可选目标回调；存在重复注册时移除最后一次注册。
   * @returns 实际移除的回调；目标不存在时为 `undefined`。
   */
  removeHook(
    entryPoint: ElementHookName,
    hookFunction?: ElementHook
  ): ElementHook | undefined;

  /**
   * 从 Shadow DOM 前后阶段移除指定 hook；未指定回调时移除最后注册项。
   *
   * @param entryPoint - 目标 Shadow DOM 阶段。
   * @param hookFunction - 可选目标回调；存在重复注册时移除最后一次注册。
   * @returns 实际移除的回调；目标不存在时为 `undefined`。
   */
  removeHook(
    entryPoint: DocumentFragmentHookName,
    hookFunction?: DocumentFragmentHook
  ): DocumentFragmentHook | undefined;

  /**
   * 从逐元素决策阶段移除指定 hook；未指定回调时移除最后注册项。
   *
   * @param entryPoint - 固定为 `uponSanitizeElement`。
   * @param hookFunction - 可选目标回调；存在重复注册时移除最后一次注册。
   * @returns 实际移除的回调；目标不存在时为 `undefined`。
   */
  removeHook(
    entryPoint: 'uponSanitizeElement',
    hookFunction?: UponSanitizeElementHook
  ): UponSanitizeElementHook | undefined;

  /**
   * 从逐属性决策阶段移除指定 hook；未指定回调时移除最后注册项。
   *
   * @param entryPoint - 固定为 `uponSanitizeAttribute`。
   * @param hookFunction - 可选目标回调；存在重复注册时移除最后一次注册。
   * @returns 实际移除的回调；目标不存在时为 `undefined`。
   */
  removeHook(
    entryPoint: 'uponSanitizeAttribute',
    hookFunction?: UponSanitizeAttributeHook
  ): UponSanitizeAttributeHook | undefined;

  /**
   * 清空指定阶段的全部 hook，其他阶段保持不变。
   *
   * @param entryPoint - 要重置的合法 hook 阶段名称。
   */
  removeHooks(entryPoint: HookName): void;

  /**
   * 用全新的空数组映射替换当前实例的全部 hook 状态。
   */
  removeAllHooks(): void;
}

/**
 * DOMPurify 删除节点或清理文本模板片段时写入 `removed` 的诊断记录。
 */
export interface RemovedElement {
  /**
   * 通常为选中删除的原节点；文本模板清理记录修改前的克隆，原文本节点可以继续保留。
   */
  element: Node;
}

/**
 * DOMPurify 从元素上移除属性时写入 `removed` 的诊断记录。
 */
export interface RemovedAttribute {
  /**
   * 移除前取得的属性节点；读取属性节点本身抛错时为 `null`，仍保留所属元素记录。
   */
  attribute: Attr | null;

  /**
   * 原本承载该属性的元素。
   */
  from: Node;
}

/** 使用普通 `Node` 且不携带事件数据的元素遍历阶段名称。 */
type BasicHookName =
  | 'beforeSanitizeElements'
  | 'afterSanitizeElements'
  | 'uponSanitizeShadowNode';
/** 公开回调类型使用 `Element`、不携带事件数据的属性遍历阶段名称。 */
type ElementHookName = 'beforeSanitizeAttributes' | 'afterSanitizeAttributes';
/** 使用 `DocumentFragment` 且不携带事件数据的 Shadow DOM 阶段名称。 */
type DocumentFragmentHookName =
  | 'beforeSanitizeShadowDOM'
  | 'afterSanitizeShadowDOM';
/** 携带元素允许表事件数据的逐元素阶段名称。 */
type UponSanitizeElementHookName = 'uponSanitizeElement';
/** 携带属性决策事件数据的逐属性阶段名称。 */
type UponSanitizeAttributeHookName = 'uponSanitizeAttribute';

/**
 * 一个 DOMPurify 实例持有的全部 hook 阶段及对应回调数组。
 *
 * @remarks
 * 每次创建实例时生成独立空数组；`addHook()` 追加，`removeHook()` 删除，执行时保持注册
 * 顺序。键集合也是公开 `HookName` 联合类型的来源。
 */
export interface HooksMap {
  /** 每个节点进入元素安全检查前执行的普通节点 hook。 */
  beforeSanitizeElements: NodeHook[];
  /** 每个保留节点完成元素安全检查后执行的普通节点 hook。 */
  afterSanitizeElements: NodeHook[];
  /** Shadow DOM 文档片段开始递归净化前执行的 hook。 */
  beforeSanitizeShadowDOM: DocumentFragmentHook[];
  /** 遍历 Shadow DOM 中当前节点时执行的普通节点 hook。 */
  uponSanitizeShadowNode: NodeHook[];
  /** Shadow DOM 文档片段递归净化完成后执行的 hook。 */
  afterSanitizeShadowDOM: DocumentFragmentHook[];
  /** 属性存在性检查前执行；实际也会接收 Text、Comment 等没有属性集合的节点。 */
  beforeSanitizeAttributes: ElementHook[];
  /** 当前元素的全部属性处理完成后执行的 hook。 */
  afterSanitizeAttributes: ElementHook[];
  /** 当前节点执行标签允许与结构判断时接收活动标签表的 hook。 */
  uponSanitizeElement: UponSanitizeElementHook[];
  /** 当前属性执行保留与取值判断时接收可变决策对象的 hook。 */
  uponSanitizeAttribute: UponSanitizeAttributeHook[];
}

/** 从 hook 数组类型中提取单个回调类型的内部条件类型。 */
type ArrayElement<T> = T extends Array<infer U> ? U : never;

/** `HooksMap` 中任一阶段可以保存的回调联合类型。 */
export type HookFunction = ArrayElement<HooksMap[keyof HooksMap]>;

/** 所有可传给 `addHook()`、`removeHook()` 与 `removeHooks()` 的合法阶段名称。 */
export type HookName =
  | BasicHookName
  | ElementHookName
  | DocumentFragmentHookName
  | UponSanitizeElementHookName
  | UponSanitizeAttributeHookName;

/**
 * 元素遍历通用 hook；以当前 DOMPurify 实例为 `this`，不提供可变事件对象。
 *
 * @param currentNode - 当前遍历节点。
 * @param hookEvent - 此类阶段固定为 `null`。
 * @param config - 本次净化的配置快照；活动查询表另保存在实例闭包中。
 */
export type NodeHook = (
  this: DOMPurify,
  currentNode: Node,
  hookEvent: null,
  config: Config
) => void;

/**
 * 属性遍历前后 hook；以当前 DOMPurify 实例为 `this`，不提供可变事件对象。
 * 前置阶段在检查属性集合前执行，运行时也可能传入非元素节点；读取元素 API 前需检查节点类型。
 *
 * @param currentNode - 当前遍历节点；前置阶段可能收到非元素节点。
 * @param hookEvent - 此类阶段固定为 `null`。
 * @param config - 本次净化的配置快照；活动查询表另保存在实例闭包中。
 */
export type ElementHook = (
  this: DOMPurify,
  currentNode: Element,
  hookEvent: null,
  config: Config
) => void;

/**
 * Shadow DOM 文档片段前后 hook；以当前 DOMPurify 实例为 `this`。
 *
 * @param currentNode - 正在递归处理的文档片段。
 * @param hookEvent - 此类阶段固定为 `null`。
 * @param config - 本次净化的配置快照；活动查询表另保存在实例闭包中。
 */
export type DocumentFragmentHook = (
  this: DOMPurify,
  currentNode: DocumentFragment,
  hookEvent: null,
  config: Config
) => void;

/**
 * 逐元素决策 hook，可通过事件对象观察或调整本次调用的标签允许表。
 *
 * @param currentNode - 正在执行元素检查的节点。
 * @param hookEvent - 当前规范化标签名与活动标签允许表。
 * @param config - 本次净化的配置快照；修改允许规则应操作 `hookEvent.allowedTags` 的成员。
 */
export type UponSanitizeElementHook = (
  this: DOMPurify,
  currentNode: Node,
  hookEvent: UponSanitizeElementHookEvent,
  config: Config
) => void;

/**
 * 逐属性决策 hook，可修改属性值、普通保留决定或显式强制保留决定。
 *
 * @param currentNode - 当前属性所属元素。
 * @param hookEvent - 同一元素内逐属性重置并复用的可变事件对象，不应保存为某个属性的独立快照。
 * @param config - 本次净化的配置快照；修改允许规则应操作 `hookEvent.allowedAttributes` 的成员。
 */
export type UponSanitizeAttributeHook = (
  this: DOMPurify,
  currentNode: Element,
  hookEvent: UponSanitizeAttributeHookEvent,
  config: Config
) => void;

/** 传给 `uponSanitizeElement` hook 的当前元素决策上下文。 */
export interface UponSanitizeElementHookEvent {
  /** 按当前解析模式规范化后的标签名；改写此字段不会改变正在检查的节点名称。 */
  tagName: string;
  /** 本次调用的活动标签允许表；修改成员影响当前及后续节点，替换该字段不会替换核心表。 */
  allowedTags: Record<string, boolean>;
}

/** 同一元素的属性处理共用此事件对象，名称、值与保留开关在每个属性开始前重置。 */
export interface UponSanitizeAttributeHookEvent {
  /** 按当前解析模式规范化后的属性名；改写此字段不会重命名原属性。 */
  attrName: string;
  /** 除 `value` 属性外已去除首尾空白；hook 改写值进入后续检查，普通保留路径才会写回。 */
  attrValue: string;
  /** 普通保留开关；`forceKeepAttr` 未生效且前置检查通过时，`false` 会移除属性。 */
  keepAttr: boolean;
  /** 本次调用的活动属性允许表；修改成员影响当前及后续属性，替换该字段不会替换核心表。 */
  allowedAttributes: Record<string, boolean>;
  /**
   * 真值跳过其后的禁止表、URI、模板清理、Trusted Types 和写回，保留原属性而非 `attrValue` 新值。
   * 此前的 named-props 前缀、XML 边界和 `attributeName=href` 屏障仍先执行，可能已删除属性。
   */
  forceKeepAttr: boolean | undefined;
}

/**
 * DOMPurify 创建实例时所需的最小类 Window 对象。
 *
 * @remarks
 * 构造器必须来自同一目标 realm，避免用当前 realm 的 `instanceof` 或原型访问解释外部
 * 节点。`document` 和 Trusted Types 能力可缺省；能力不足时实例以不支持状态返回。
 */
export type WindowLike = Pick<
  typeof globalThis,
  | 'DocumentFragment'
  | 'HTMLTemplateElement'
  | 'Node'
  | 'Element'
  | 'NodeFilter'
  | 'NamedNodeMap'
  | 'HTMLFormElement'
  | 'DOMParser'
> & {
  /** 目标 realm 的文档；缺失时实例无法进入完整 DOM 净化路径。 */
  document?: Document;
  /** 旧版 Firefox 对 `NamedNodeMap` 构造器使用的兼容别名。 */
  MozNamedAttrMap?: typeof window.NamedNodeMap;
} & Pick<TrustedTypesWindow, 'trustedTypes'>;
