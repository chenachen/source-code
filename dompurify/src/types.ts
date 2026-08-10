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
   * 最近一次 `sanitize()` 记录的已移除元素或属性。
   *
   * @remarks 每次净化开始时重置；没有移除项时为空数组。记录用于观察结果，不参与允许决策。
   */
  removed: Array<RemovedElement | RemovedAttribute>;

  /**
   * 当前 realm 是否具备完整净化流程所需的 DOM 能力。
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
   * @remarks 同时清空持久允许表快照；不会移除已注册 hook。
   */
  clearConfig(): void;

  /**
   * 净化字符串或 DOM 节点，并在请求且平台支持时返回 `TrustedHTML`。
   *
   * @param dirty - 待解析的字符串或待复制净化的 DOM 节点。
   * @param cfg - `RETURN_TRUSTED_TYPE` 明确为 `true` 的单次配置。
   * @returns 经当前 Trusted Types 策略签名的净化结果。
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
   * 直接净化传入 DOM 节点并返回同一路径上的 DOM 结果。
   *
   * @param dirty - 允许原地处理的 DOM 节点。
   * @param cfg - `IN_PLACE` 明确为 `true` 的单次配置。
   * @returns 原地净化后的 DOM 节点。
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
   * @returns 通常为 `HTMLBodyElement`、完整文档模式下为文档元素的净化节点。
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
   * @returns 包含净化后子树的文档片段。
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
   * 使用默认字符串返回模式净化字符串或 DOM 节点。
   *
   * @param dirty - 待解析的字符串或待复制净化的 DOM 节点。
   * @param cfg - 可选单次配置；实例已调用 `setConfig()` 时不会采用该值。
   * @returns 序列化后的安全字符串。
   */
  sanitize(dirty: string | Node, cfg?: Config): string;

  /**
   * 按当前策略检查给定元素上的属性名和值是否可保留。
   *
   * @remarks 已设置持久配置时复用该配置，否则使用默认配置；不会修改 DOM。
   * @param tag - 属性所属元素的标签名。
   * @param attr - 属性名。
   * @param value - 待检查属性值。
   * @returns 名称和取值均满足当前策略时为 `true`。
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
   * 注册接收 `Element` 的属性净化前后 hook。
   *
   * @param entryPoint - 属性净化前或后阶段名称。
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
 * DOMPurify 从净化树中移除元素时写入 `removed` 的诊断记录。
 */
export interface RemovedElement {
  /**
   * 被移除的节点；部分失败关闭路径会保存其克隆，以免后续 DOM 变化覆盖现场。
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
/** 使用 `Element` 且不携带事件数据的属性遍历阶段名称。 */
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
  /** 当前元素的属性数组开始处理前执行的 hook。 */
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
 * @param config - 本次净化使用的已解析配置引用。
 */
export type NodeHook = (
  this: DOMPurify,
  currentNode: Node,
  hookEvent: null,
  config: Config
) => void;

/**
 * 属性遍历前后 hook；以当前 DOMPurify 实例为 `this`，不提供可变事件对象。
 *
 * @param currentNode - 正在处理属性的元素。
 * @param hookEvent - 此类阶段固定为 `null`。
 * @param config - 本次净化使用的已解析配置引用。
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
 * @param config - 本次净化使用的已解析配置引用。
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
 * @param config - 本次净化使用的已解析配置引用。
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
 * @param hookEvent - 每个属性处理前重置并复用的可变事件对象。
 * @param config - 本次净化使用的已解析配置引用。
 */
export type UponSanitizeAttributeHook = (
  this: DOMPurify,
  currentNode: Element,
  hookEvent: UponSanitizeAttributeHookEvent,
  config: Config
) => void;

/** 传给 `uponSanitizeElement` hook 的当前元素决策上下文。 */
export interface UponSanitizeElementHookEvent {
  /** 按当前解析模式规范化后的标签名。 */
  tagName: string;
  /** 本次净化使用的活动标签允许表；核心暴露前会与共享默认表解除引用。 */
  allowedTags: Record<string, boolean>;
}

/** 传给 `uponSanitizeAttribute` hook、并在每个属性开始前重置的可变决策上下文。 */
export interface UponSanitizeAttributeHookEvent {
  /** 按当前解析模式规范化后的属性名。 */
  attrName: string;
  /** 当前属性值；hook 写入的新值会进入后续模板、URI 与结构安全检查。 */
  attrValue: string;
  /** 普通保留开关；设为 `false` 会在后续检查前移除属性。 */
  keepAttr: boolean;
  /** 本次净化使用的活动属性允许表；核心暴露前会与共享默认表解除引用。 */
  allowedAttributes: Record<string, boolean>;
  /** 显式强制保留开关；真值会跳过后续普通允许及属性值检查，调用方须自行保证安全。 */
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
