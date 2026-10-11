/**
 * DOMPurify 的同步净化实现与实例工厂。
 *
 * tags/attrs/regexp 提供名称和表达式规则，utils 提供捕获原生函数后的安全调用包装。
 * createDOMPurify 把这些规则与目标 Window 的 DOM API 组合成一个实例；sanitize 将字符串
 * 解析为隔离 DOM，或导入/原地处理 Node，再以同一元素、属性和 fragment 管线得到结果。
 * 规则集合、配置、hooks 和活动 Trusted Types 策略都保存在实例闭包中，公开 API 读取或更新
 * 这些绑定。整个 walk 同步执行，hook 与浏览器的 DOM reaction 可在其中同步修改树和状态。
 */
import type { Config, UseProfilesConfig } from './config';
import type { DOMPurify, HooksMap, HookFunction, WindowLike } from './types';
import * as TAGS from './tags.js';
import * as ATTRS from './attrs.js';
import * as EXPRESSIONS from './regexp.js';
import {
  addToSet,
  clone,
  entries,
  freeze,
  seal,
  arrayForEach,
  arrayIsArray,
  arrayLastIndexOf,
  arrayPop,
  arrayPush,
  arraySplice,
  stringMatch,
  stringReplace,
  stringToLowerCase,
  stringToString,
  stringIndexOf,
  stringTrim,
  regExpTest,
  isRegex,
  typeErrorCreate,
  lookupGetter,
  create,
  objectHasOwnProperty,
  stringifyValue,
} from './utils.js';

export type { Config } from './config';

export type {
  DOMPurify,
  RemovedElement,
  RemovedAttribute,
  HookName,
  NodeHook,
  ElementHook,
  DocumentFragmentHook,
  UponSanitizeElementHook,
  UponSanitizeAttributeHook,
  UponSanitizeElementHookEvent,
  UponSanitizeAttributeHookEvent,
  WindowLike,
} from './types';

/** 构建阶段注入的发布版本号，对外暴露为 `DOMPurify.version`。 */
declare const VERSION: string;

/**
 * DOM 标准节点类型编号，供跨 realm 的数值判定复用。
 *
 * 真实节点的 nodeType 由缓存原型 getter 读取，而不是用目标 Window 的 instanceof 判断；
 * 这样 iframe 中的 Node、DocumentFragment 和 Element 也能进入对应净化分支。
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType
 */
const NODE_TYPE = {
  element: 1,
  attribute: 2,
  text: 3,
  cdataSection: 4,
  entityReference: 5, // 已废弃
  entityNode: 6, // 已废弃
  processingInstruction: 7,
  comment: 8,
  document: 9,
  documentType: 10,
  documentFragment: 11,
  notation: 12, // 已废弃
};

/** 为默认实例及无参工厂调用选择全局 window；不存在时返回 null，让工厂保留不可净化状态。 */
const getGlobal = function (): WindowLike {
  return typeof window === 'undefined' ? null : window;
};

/**
 * 创建仅供模块内部使用的恒等 Trusted Types 策略。
 *
 * 策略不改变输入：既会在 parse/walk 前包装待解析的 dirty HTML，也会包装最终输出或属性值，
 * 安全检查由 DOM 净化流程承担。策略名可由加载脚本的 `data-tt-policy-suffix` 隔离；浏览器不支持
 * Trusted Types 或创建失败时返回 `null`，后续使用普通字符串；页面若强制 Trusted Types，
 * 对应 sink 仍可能拒绝写入。该策略仅供内部包装使用，不向外暴露。
 *
 * 由实例的 _getDefaultTrustedTypesPolicy 惰性调用；创建结果和失败的 null 都由该实例缓存。
 * createPolicy 调用的异常在这里转为告警和 null；读取能力和脚本后缀发生在该 catch 之外，
 * 这些准备步骤的异常仍传播。策略后续回调的异常由调用点处理。
 *
 * @param trustedTypes - 当前 realm 的策略工厂。
 * @param purifyHostElement - 加载 DOMPurify 的脚本元素，用于读取策略名后缀。
 * @returns 创建的策略；不支持或创建失败时返回 `null`。
 */
const _createTrustedTypesPolicy = function (
  trustedTypes: TrustedTypePolicyFactory,
  purifyHostElement: HTMLScriptElement
) {
  if (
    typeof trustedTypes !== 'object' ||
    typeof trustedTypes.createPolicy !== 'function'
  ) {
    return null;
  }

  // 调用方可在加载脚本上设置 data-tt-policy-suffix，避免 Trusted Types 因策略重名而抛错。
  let suffix = null;
  /** 只从加载脚本读取的策略名后缀属性；后缀为空时沿用 dompurify 名称。 */
  const ATTR_NAME = 'data-tt-policy-suffix';
  if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) {
    suffix = purifyHostElement.getAttribute(ATTR_NAME);
  }

  const policyName = 'dompurify' + (suffix ? '#' + suffix : '');

  try {
    return trustedTypes.createPolicy(policyName, {
      /** 原样包装 HTML；调用点可能传入待解析 dirty HTML 或已净化输出。 */
      createHTML(html) {
        return html;
      },
      /** 原样包装属性准入分支保留的脚本 URL；策略自身不补做 URI 校验。 */
      createScriptURL(scriptUrl) {
        return scriptUrl;
      },
    });
  } catch (_) {
    // 策略重名或 CSP 限制都可能使创建失败；记录告警，后续不再用该策略包装值。
    console.warn(
      'TrustedTypes policy ' + policyName + ' could not be created.'
    );
    return null;
  }
};

/** 为实例初始化或 removeAllHooks 创建新的 hook map；每个入口独占数组，旧分发仍持有旧数组。 */
const _createHooksMap = function (): HooksMap {
  return {
    afterSanitizeAttributes: [],
    afterSanitizeElements: [],
    afterSanitizeShadowDOM: [],
    beforeSanitizeAttributes: [],
    beforeSanitizeElements: [],
    beforeSanitizeShadowDOM: [],
    uponSanitizeAttribute: [],
    uponSanitizeElement: [],
    uponSanitizeShadowNode: [],
  };
};

/**
 * 解析集合型配置项，并保证调用方数组不会直接成为内部可变集合。
 *
 * 只有 `cfg` 的自有数组属性才生效；存在 `base` 时先克隆基础集合，再按 `transform`
 * 规范化并合并数组。缺失、继承或非数组值统一使用 `fallback`。
 * _parseConfig 用它区分替换型集合与增量集合：ALLOWED_TAGS 等显式数组从空表建立，
 * ADD_URI_SAFE_ATTR 等传入 base 的选项保留默认成员。fallback 按引用返回，不在此复制。
 *
 * @param cfg - 已克隆且无原型的配置对象。
 * @param key - 要读取的配置键。
 * @param fallback - 配置缺失或类型不符时使用的集合。
 * @param options - 大小写转换规则及可选基础集合。
 * @returns 本次配置实际使用的查找集合。
 */
const _resolveSetOption = function (
  cfg: Config,
  key: keyof Config,
  fallback: Record<string, boolean>,
  options: {
    /** 把配置项规范化为当前解析模式所需大小写。 */
    transform: Parameters<typeof addToSet>[2];
    /** 合并用户增量前要复制的基础集合。 */
    base?: Record<string, boolean>;
  }
): Record<string, boolean> {
  return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key])
    ? addToSet(
        options.base ? clone(options.base) : {},
        cfg[key] as readonly unknown[],
        options.transform
      )
    : fallback;
};

/**
 * 为指定 `WindowLike` 创建隔离的 DOMPurify 实例。
 *
 * 每个实例独占配置、allowlist、hooks 与 Trusted Types 状态，并缓存目标 realm 的原型
 * getter，避免元素上的同名属性遮蔽这些读取。无可用 DOM 时返回仅可继续充当工厂的
 * `isSupported=false` 对象；有效 DOM 下再安装完整净化 API。
 *
 * 默认导出和实例的可调用工厂都进入这里。originalDocument 保留调用方文档，内部 document
 * 可切换到 template.content 的 ownerDocument；前者供结果重新导入，后者供隔离树创建。
 * 初始 DOM 检查失败时没有 sanitize 等方法；通过该检查后即使后续能力探针不支持，也会安装
 * 方法，由 sanitize 在支持检查处返回归一后的输入。已有调用方策略与回调对象可能由外部共享，
 * 工厂隔离的是实例内部绑定与默认集合，不深复制这些外部对象。
 *
 * @param window - 提供 DOM 构造器、解析器和 document 的目标 realm。
 * @returns 可调用的 DOMPurify 实例。
 */
function createDOMPurify(window: WindowLike = getGlobal()): DOMPurify {
  /** 把实例作为工厂调用时，为传入 realm 创建新实例，而不复用当前闭包状态。 */
  const DOMPurify: DOMPurify = (root: WindowLike) => createDOMPurify(root);

  /** 当前构建的版本标签。 */
  DOMPurify.version = VERSION;

  /**
   * 当前删除记录表，在 `sanitize` 越过支持检查、配置解析和 allowlist 隔离阶段后重新绑定。
   *
   * 重置发生在这些阶段成功之后；更早的输入异常、不支持早退或配置异常会保留旧记录。
   * 元素删除、属性删除与逐节点模板替换可追加项，部分属性写回会弹出末项；hook 删除和
   * 返回前模板 scrub 不一定留下记录。同实例 hook 重入也会重绑该表，不能把它作为安全判据。
   */
  DOMPurify.removed = [];

  if (
    !window ||
    !window.document ||
    window.document.nodeType !== NODE_TYPE.document ||
    !window.Element
  ) {
    // 当前环境没有可用 DOM；保留可调用工厂，让使用方稍后显式传入自己的 Window。
    DOMPurify.isSupported = false;

    return DOMPurify;
  }

  /** 内部建树上下文；初始化时可换成 template 内容的 ownerDocument，之后供解析及探针复用。 */
  let { document } = window;

  /** 调用方 realm 的原始文档；DOM 返回路径需要用它重新导入结果。 */
  const originalDocument = document;
  /** 初始化时的加载脚本快照；以后首次创建默认 TT 策略时仍从它读取策略名后缀。 */
  const currentScript: HTMLScriptElement =
    originalDocument.currentScript as HTMLScriptElement;
  /** 捕获目标 realm 的构造器和能力对象；不从脏输入节点上查找这些 API。 */
  const {
    DocumentFragment,
    HTMLTemplateElement,
    Node,
    Element,
    NodeFilter,
    NamedNodeMap = window.NamedNodeMap || (window as any).MozNamedAttrMap,
    HTMLFormElement,
    DOMParser,
    trustedTypes,
  } = window;

  /** 原型方法查找起点；继承的 Node getter 也由 lookupGetter 沿该原型链找到。 */
  const ElementPrototype = Element.prototype;

  // 通过目标 realm 的原型链缓存 getter/方法；后续读取不经过元素自有属性，抵御 form 命名属性遮蔽。
  /** KEEP_CONTENT 根边界使用的原生深克隆包装。 */
  const cloneNode = lookupGetter(ElementPrototype, 'cloneNode');
  /** 在 removeChild 失败与 patch 预处理中使用的原生移除包装。 */
  const remove = lookupGetter(ElementPrototype, 'remove');
  /** 内容提升时定位当前节点后一位置，不读取节点自有 nextSibling。 */
  const getNextSibling = lookupGetter(ElementPrototype, 'nextSibling');
  /** 清理与 attached-root 发现读取普通后代的入口，不自动进入 template 或 shadow。 */
  const getChildNodes = lookupGetter(ElementPrototype, 'childNodes');
  /** 为 detach 判定、namespace 父级判断及删除路径读取真实父节点。 */
  const getParentNode = lookupGetter(ElementPrototype, 'parentNode');
  /** 读取浏览器公开的 attached shadow root；closed root 在此不可见。 */
  const getShadowRoot = lookupGetter(ElementPrototype, 'shadowRoot');
  /** 清理和 clobber 比对使用的真实属性表读取入口；普通属性 walk 仍直接读取 attributes。 */
  const getAttributes = lookupGetter(ElementPrototype, 'attributes');
  /** Node 原型的类型读取入口，供跨 realm brand/类型判定使用。 */
  const getNodeType =
    Node && Node.prototype ? lookupGetter(Node.prototype, 'nodeType') : null;
  /** 根预检及元素名称判定读取的真实 nodeName，避免 form 命名属性遮蔽。 */
  const getNodeName =
    Node && Node.prototype ? lookupGetter(Node.prototype, 'nodeName') : null;
  /** 迭代器绑定实际文档的读取入口，避免 ownerDocument 被命名子节点替换。 */
  const getOwnerDocument =
    Node && Node.prototype
      ? lookupGetter(Node.prototype, 'ownerDocument')
      : null;

  // 模板 template.content 的 ownerDocument 与页面文档分离。可用时选它作为隔离 DOM 的创建上下文，
  // 避免直接用页面文档创建净化节点时关联页面的 custom-element registry（issue #47）。
  if (typeof HTMLTemplateElement === 'function') {
    const template = document.createElement('template');
    if (template.content && template.content.ownerDocument) {
      document = template.content.ownerDocument;
    }
  }

  /** 当前活动 TT 策略；undefined 可触发默认解析，null 表示默认解析已得不到策略。 */
  let trustedTypesPolicy;
  /** 与当前策略配套的空 HTML 值，供 fallback 写入和无解析根的 Trusted Type 返回路径使用。 */
  let emptyHTML = '';

  // 缓存默认 Trusted Types 策略的正常解析结果，避免在同一 realm 中重复创建同名策略。
  // clearConfig() 保留该缓存；调用方策略则在 clearConfig() 时解除。
  /** 默认策略解析结果，包括不支持或创建失败得到的 null；clearConfig 不清除此缓存。 */
  let defaultTrustedTypesPolicy;
  /** 标记解析已正常返回，避免把 null 结果当成尚未创建；准备步骤抛错时仍为 false。 */
  let defaultTrustedTypesPolicyResolved = false;

  // 两类策略回调共用计数器；回调尚未退出时若再次进入任一包装函数，立即抛错，阻断循环签名。
  // 守卫检查的是策略包装重入；sanitize 本身没有统一的重入锁（#1422）。
  /** 同一实例内 HTML/ScriptURL 包装的同步活动深度，由各包装函数的 finally 成对恢复。 */
  let IN_TRUSTED_TYPES_POLICY = 0;
  /**
   * 在两类包装函数调用策略前拒绝回调重入。
   *
   * IN_TRUSTED_TYPES_POLICY 是同一实例内的同步调用深度，不是 sanitize 的执行次数。
   * 计数大于零时抛 TypeError；此函数不修改计数，恢复由包装函数的 finally 完成。
   */
  const _assertNotInTrustedTypesPolicy = function (): void {
    if (IN_TRUSTED_TYPES_POLICY > 0) {
      throw typeErrorCreate(
        'A configured TRUSTED_TYPES_POLICY callback (createHTML or ' +
          'createScriptURL) must not call DOMPurify.sanitize, as that causes ' +
          'infinite recursion. Do not pass a policy whose callbacks wrap ' +
          'DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted ' +
          'Types" section of the README.'
      );
    }
  };

  /**
   * 用当前活动策略包装 HTML，并用 `finally` 恢复共享重入计数器。
   *
   * 配置初始化的空值、_initDocument 的脏解析输入、属性 sink 和最终返回值都可从此经过。
   * 调用方必须先选出可用策略；此函数不净化字符串，也不吞掉策略异常。先做重入检查再增量，
   * 因而被拒绝的内层调用不会错误减少外层计数，正常返回和抛错都会恢复已有深度。
   *
   * @param html - 已准备交给 DOM sink 或作为 TrustedHTML 返回的字符串。
   * @returns 当前策略产生的 TrustedHTML 兼容值。
   */
  const _createTrustedHTML = function (html: string): string {
    _assertNotInTrustedTypesPolicy();

    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createHTML(html);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };

  /**
   * 用当前活动策略包装脚本 URL，并用 `finally` 恢复共享重入计数器。
   *
   * _applyTrustedTypesToAttribute 只在浏览器报告 TrustedScriptURL sink 时调用它。
   * 与 HTML 包装共用深度计数，因此 HTML 回调重入 URL 包装、URL 回调重入 HTML 包装也会
   * 被拒绝；策略异常继续传播，finally 只恢复计数，不回滚配置或 DOM。
   *
   * @param scriptUrl - 属性准入分支已保留、准备交给脚本 URL sink 的值；不保证走过通用 URI 分支。
   * @returns 当前策略产生的 TrustedScriptURL 兼容值。
   */
  const _createTrustedScriptURL = function (scriptUrl: string): string {
    _assertNotInTrustedTypesPolicy();

    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createScriptURL(scriptUrl);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };

  /**
   * 惰性解析并缓存实例内部默认 Trusted Types 策略。
   *
   * 辅助函数正常返回后标记已解析，策略对象和不支持/创建失败得到的 null 都只解析一次：
   * 这避免重复创建同名策略及重复告警。若辅助函数的准备步骤直接抛错，赋值和 resolved 标志
   * 尚未完成，本函数不会把该异常缓存为 null，后续调用仍可再次进入解析。
   * 只有 _parseConfig 需要默认策略且活动绑定为 undefined 时进入；clearConfig 恢复该缓存，
   * 不清除 resolved 标志。缓存属于此实例，同一 realm 的另一实例仍有自己的创建尝试。
   */
  const _getDefaultTrustedTypesPolicy = function () {
    if (!defaultTrustedTypesPolicyResolved) {
      defaultTrustedTypesPolicy = _createTrustedTypesPolicy(
        trustedTypes,
        currentScript
      );
      defaultTrustedTypesPolicyResolved = true;
    }

    return defaultTrustedTypesPolicy;
  };

  /** 隔离文档的原生方法快照；使用时显式 call 到实际 ownerDocument，不依赖节点自有同名属性。 */
  const {
    implementation,
    createNodeIterator,
    createDocumentFragment,
    getElementsByTagName,
  } = document;
  /** 结果返回原文档时的深复制入口，与隔离文档上的 Node 输入导入区分。 */
  const { importNode } = originalDocument;

  /** 实例注册表；add/removeHook 改数组，removeHooks/removeAllHooks 替换数组或整张表。 */
  let hooks = _createHooksMap();

  /**
   * 暴露当前实例的基础能力探针结果。
   *
   * 检查 entries、parent getter 和文档实现能力；不是一次试运行。sanitize 读取该公开值，
   * 未通过时在解析配置与清空 removed 之前早退。
   */
  DOMPurify.isSupported =
    typeof entries === 'function' &&
    typeof getParentNode === 'function' &&
    implementation &&
    implementation.createHTMLDocument !== undefined;

  /** 模板、属性名、URI 和 custom-element 名称的默认表达式，来自 regexp 模块。 */
  const {
    MUSTACHE_EXPR,
    ERB_EXPR,
    TMPLIT_EXPR,
    DATA_ATTR,
    ARIA_ATTR,
    IS_SCRIPT_OR_DATA,
    ATTR_WHITESPACE,
    CUSTOM_ELEMENT,
  } = EXPRESSIONS;

  /** 活动 URI 正则；_parseConfig 每次按 ALLOWED_URI_REGEXP 重绑，否则恢复模块默认表达式。 */
  let { IS_ALLOWED_URI } = EXPRESSIONS;

  /** 当前元素名称表；配置解析重绑，持久调用恢复捕获绑定，暴露给 upon hook 前按需复制。 */
  let ALLOWED_TAGS = null;
  /** HTML、SVG、SVG Filter、MathML 与文本节点组成的实例默认元素集合。 */
  const DEFAULT_ALLOWED_TAGS = addToSet({}, [
    ...TAGS.html,
    ...TAGS.svg,
    ...TAGS.svgFilters,
    ...TAGS.mathMl,
    ...TAGS.text,
  ]);

  /** 当前属性名称表；upon hook 可在调用内修改成员，普通获准名称继续执行属性值规则。 */
  let ALLOWED_ATTR = null;
  /** HTML、SVG、MathML 与 XML 属性组成的实例默认属性集合。 */
  const DEFAULT_ALLOWED_ATTR = addToSet({}, [
    ...ATTRS.html,
    ...ATTRS.svg,
    ...ATTRS.mathMl,
    ...ATTRS.xml,
  ]);

  /**
   * 当前调用的 Custom Elements 策略。
   *
   * `tagNameCheck` 与 `attributeNameCheck` 接受正则或谓词；未配置时不额外放行名称。
   * `allowCustomizedBuiltInElements` 与 `tagNameCheck` 共同控制名称准入之外的 `is` 属性；
   * 显式用 `ALLOWED_ATTR`/`ADD_ATTR` 放行 `is` 时则走普通属性值规则。_parseConfig 每次创建
   * 新的无原型对象，只接收自有、类型合适的策略成员，再 seal；缺失的成员保持 undefined。
   */
  let CUSTOM_ELEMENT_HANDLING = Object.seal(
    create(null, {
      tagNameCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null,
      },
      attributeNameCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null,
      },
      allowCustomizedBuiltInElements: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: false,
      },
    })
  );

  /** 名称判定中优先拒绝的元素集合；允许 table 时，配置解析会移除其中的 tbody 禁令。 */
  let FORBID_TAGS = null;

  /** 普通属性准入中优先拒绝的名称集合；受信任 hook 的 forceKeepAttr 可跳过该判定。 */
  let FORBID_ATTR = null;

  /** 保存函数型 `ADD_TAGS`/`ADD_ATTR` 谓词；每次解析配置先清空，防止跨调用泄漏。 */
  const EXTRA_ELEMENT_HANDLING = Object.seal(
    create(null, {
      tagCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null,
      },
      attributeCheck: {
        writable: true,
        configurable: false,
        enumerable: true,
        value: null,
      },
    })
  );

  /** 是否按 aria-* 名称规则直接放行；该分支不执行通用 URI 检查。 */
  let ALLOW_ARIA_ATTR = true;

  /** 是否按 data-* 名称规则直接放行；SAFE_FOR_TEMPLATES 会关闭该额外准入。 */
  let ALLOW_DATA_ATTR = true;

  /** 是否允许非脚本、非 data 的未知 URI scheme。 */
  let ALLOW_UNKNOWN_PROTOCOLS = false;

  /** 是否允许属性值中的自闭合标签片段；关闭可规避 jQuery 3.0 的 mXSS 场景。 */
  let ALLOW_SELF_CLOSE_IN_ATTR = true;

  /** 是否清理模板表达式并关闭 data-* 额外准入；显式允许的数据属性仍走普通属性流程。 */
  let SAFE_FOR_TEMPLATES = false;

  /** 是否启用 XML/foreign-content 结构防护，包括危险注释、mXSS canary 与 patch linkage。 */
  let SAFE_FOR_XML = true;

  /** 是否选择完整文档根并允许 html/head/body；显式 FORBID_TAGS 仍可拒绝这些名称。 */
  let WHOLE_DOCUMENT = false;

  /** 标记实例是否进入 `setConfig()` 持久配置模式；该模式会忽略逐调用配置。 */
  let SET_CONFIG = false;

  /** 在 setConfig 成功后捕获的标签表；每次持久调用先恢复它，再复制给 hooks，clearConfig 时清空。 */
  let SET_CONFIG_ALLOWED_TAGS = null;
  /** 与标签表一起捕获的属性表；保存配置解析结果，不保存上次 hook 修改过的调用级副本。 */
  let SET_CONFIG_ALLOWED_ATTR = null;

  /** 是否加前置 remove 哨兵，让 HTML 片段尽早进入 body 解析上下文。 */
  let FORCE_BODY = false;

  /** 是否返回净化 DOM 根；字符串输入通常为 body，完整文档模式为 html。 */
  let RETURN_DOM = false;

  /** 是否把净化根的 children 移入并返回 DocumentFragment；该选项隐含 RETURN_DOM。 */
  let RETURN_DOM_FRAGMENT = false;

  /** 字符串返回路径是否包装为 TrustedHTML；DOM/IN_PLACE 优先，活动策略不可用时仍返回字符串。 */
  let RETURN_TRUSTED_TYPE = false;

  /** 是否拒绝会与 document/form 内建成员冲突的 `id`、`name` 值。 */
  let SANITIZE_DOM = true;

  /** 给 id/name 增加 user-content- 前缀，减少净化内容与应用命名访问发生冲突。 */
  let SANITIZE_NAMED_PROPS = false;
  /** 严格命名属性隔离使用的幂等前缀。 */
  const SANITIZE_NAMED_PROPS_PREFIX = 'user-content-';

  /** 删除不允许元素时是否把其 children 提升到父节点。 */
  let KEEP_CONTENT = true;

  /** 请求原地处理 Node；sanitize 用局部 inPlace 解析本次输入，字符串调用不会关闭此配置。 */
  let IN_PLACE = false;

  /** 真值时先按类别重建标签/属性表；具体类别只接收 true，之后仍可由 ADD_* 扩充。 */
  let USE_PROFILES: UseProfilesConfig | false = {};

  /** 被名称规则拒绝后禁止提升内容的标签表；它不单独拒绝已被允许的元素。 */
  let FORBID_CONTENTS = null;
  /**
   * 默认禁止提升内容的元素集合。
   *
   * 这些元素的内容可能采用特殊解析语义、携带活动内容，或由 UA 镜像生成；提升会改变语境。
   */
  const DEFAULT_FORBID_CONTENTS = addToSet({}, [
    'annotation-xml',
    'audio',
    'colgroup',
    'desc',
    'foreignobject',
    'head',
    'iframe',
    'math',
    'mi',
    'mn',
    'mo',
    'ms',
    'mtext',
    'noembed',
    'noframes',
    'noscript',
    'plaintext',
    'script',
    // 元素 selectedcontent 可承载 select 的选中内容副本；拒绝其名称时连内容一起丢弃，
    // 避免把镜像副本提升回树。显式允许该元素时，本集合不会单独将它删除。
    'selectedcontent',
    'style',
    'svg',
    'template',
    'thead',
    'title',
    'video',
    'xmp',
  ]);

  /** 允许 data URI 特例的元素表；属性名仍限 src/xlink:href/href，且 lcTag 不能为 script。 */
  let DATA_URI_TAGS = null;
  /** 默认可承载 data URI 的媒体元素集合；`script` 明确不在其中。 */
  const DEFAULT_DATA_URI_TAGS = addToSet({}, [
    'audio',
    'video',
    'img',
    'source',
    'image',
    'track',
  ]);

  /** 普通名称准入后无需执行 URI scheme 检查的属性集合。 */
  let URI_SAFE_ATTRIBUTES = null;
  /** 语义上不把值解释为可导航 URI 的默认属性集合。 */
  const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
    'alt',
    'class',
    'for',
    'id',
    'label',
    'name',
    'pattern',
    'placeholder',
    'role',
    'summary',
    'title',
    'value',
    'style',
    'xmlns',
  ]);

  /** MathML 元素的标准 namespace URI。 */
  const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
  /** SVG 元素的标准 namespace URI。 */
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  /** HTML/XHTML 元素的标准 namespace URI。 */
  const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
  /** 解析根与 parentless/shadow 节点模拟父级所使用的文档 namespace。 */
  let NAMESPACE = HTML_NAMESPACE;
  /** 最近一次 sanitize 输入的 falsy 状态；_initDocument fallback 用它选择 emptyHTML 而非哨兵。 */
  let IS_EMPTY_INPUT = false;

  /** 按 namespace URI 精确匹配的表；命中只完成第一步，元素仍须通过父子转换规则。 */
  let ALLOWED_NAMESPACES = null;
  /** 默认仅允许 MathML、SVG 与 HTML namespace。 */
  const DEFAULT_ALLOWED_NAMESPACES = addToSet(
    {},
    [MATHML_NAMESPACE, SVG_NAMESPACE, HTML_NAMESPACE],
    stringToString
  );

  /** MathML 中允许子节点切换回 HTML 解析规则的默认文本 integration points。 */
  const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze([
    'mi',
    'mo',
    'mn',
    'ms',
    'mtext',
  ]);
  /** 当前配置下的 MathML 文本 integration-point 查找集合。 */
  let MATHML_TEXT_INTEGRATION_POINTS = addToSet(
    {},
    DEFAULT_MATHML_TEXT_INTEGRATION_POINTS
  );

  /** 本实现供 SVG 父级转换检查使用的默认 HTML integration-point 名称。 */
  const DEFAULT_HTML_INTEGRATION_POINTS = freeze(['annotation-xml']);
  /** 当前配置下的 HTML integration-point 查找集合。 */
  let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);

  // 这些元素同时存在于 SVG 与 HTML 规范中；显式列出，避免仅因出现在 HTML namespace 就被误删。
  /** 同时可合法存在于 SVG 与 HTML namespace 的元素集合。 */
  const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
    'title',
    'style',
    'font',
    'a',
    'script',
  ]);

  /** 当前解析器媒体类型；只接受受支持值，其余回退到 HTML。 */
  let PARSER_MEDIA_TYPE: null | DOMParserSupportedType = null;
  /** DOMParser 在本模块中允许使用的媒体类型。 */
  const SUPPORTED_PARSER_MEDIA_TYPES = ['application/xhtml+xml', 'text/html'];
  /** 未配置或配置无效时使用的 HTML 解析模式。 */
  const DEFAULT_PARSER_MEDIA_TYPE = 'text/html';
  /** HTML 模式将名称转小写，XHTML 原样保留；namespace 转换函数另用小写标签名做规则查询。 */
  let transformCaseFunc: null | Parameters<typeof addToSet>[2] = null;

  /** 最近一次成功解析的配置，仅顶层冻结；hook 逐次读取此绑定，clearConfig 会将它置空。 */
  let CONFIG: Config | null = null;

  /** 用于判断 `id`/`name` 是否会 clobber form 内建成员的探针元素。 */
  const formElement = document.createElement('form');

  /** 在 _parseConfig 接收 custom-element 谓词前检查 Function/RegExp，其他类型不进入策略对象。 */
  const isRegexOrFunction = function (
    testValue: unknown
  ): testValue is Function | RegExp {
    return testValue instanceof RegExp || testValue instanceof Function;
  };

  /**
   * 解析配置，重建名称集合、规则和模式，并冻结内部配置对象的顶层。
   *
   * 配置先复制到无原型对象，随后按 parser 模式构建 allowlist、合并 profile/增量规则，
   * 最后选择 Trusted Types 策略。setConfig() 复用该状态；逐调用模式重新解析，除非传入的
   * 正是当前内部 CONFIG。clone 递归复制普通对象，但复用数组、函数和 RegExp；数组填洞及
   * 名称规范化可能回写调用方数组。内部名称查找集合另行构建，不直接以数组作为查询表。
   * 未提供 TRUSTED_TYPES_POLICY 时也可能继续使用此前活动策略，生命周期见下方策略分支。
   *
   * sanitize 的逐调用分支、setConfig 和首次 isValidAttribute 都由此装载规则。顺序是基本集合
   * → 模式联动 → profile 重建 → ADD_* 扩充 → 文本/文档/table 修正 → 活动策略选择；因此
   * profile 覆盖显式允许表，ADD_* 又能扩充 profile，table 还能撤销 tbody 禁令。
   * CONFIG 只在结尾成功写入；前面的闭包字段逐项更新，异常没有整份配置的事务回滚。
   *
   * @param cfg - 可选配置字面量；非对象值按空配置处理。
   */
  // eslint-disable-next-line complexity
  /** 装载名称规则、模式与策略。 */ const _parseConfig = function (
    cfg: Config = {}
  ): void {
    if (CONFIG && CONFIG === cfg) {
      return;
    }

    /* 非对象配置不可信，统一降级为空配置。 */
    if (!cfg || typeof cfg !== 'object') {
      cfg = {};
    }

    /* 复制自有可枚举项到无原型对象；嵌套数组与非普通对象仍可能共享引用。 */
    cfg = clone(cfg);

    PARSER_MEDIA_TYPE =
      // eslint-disable-next-line unicorn/prefer-includes
      SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1
        ? DEFAULT_PARSER_MEDIA_TYPE
        : cfg.PARSER_MEDIA_TYPE;

    // HTML 元素/属性名不区分大小写，统一转小写；XHTML 名称保持原样。
    transformCaseFunc =
      PARSER_MEDIA_TYPE === 'application/xhtml+xml'
        ? stringToString
        : stringToLowerCase;

    /* 替换型集合未配置时复用默认表；增量型 URI/data 集合传 base，在默认成员上建立新表。
       FORBID_CONTENTS 的显式数组替换默认表，ADD_FORBID_CONTENTS 才在所选表上追加。 */
    ALLOWED_TAGS = _resolveSetOption(
      cfg,
      'ALLOWED_TAGS',
      DEFAULT_ALLOWED_TAGS,
      { transform: transformCaseFunc }
    );
    ALLOWED_ATTR = _resolveSetOption(
      cfg,
      'ALLOWED_ATTR',
      DEFAULT_ALLOWED_ATTR,
      { transform: transformCaseFunc }
    );
    ALLOWED_NAMESPACES = _resolveSetOption(
      cfg,
      'ALLOWED_NAMESPACES',
      DEFAULT_ALLOWED_NAMESPACES,
      { transform: stringToString }
    );
    URI_SAFE_ATTRIBUTES = _resolveSetOption(
      cfg,
      'ADD_URI_SAFE_ATTR',
      DEFAULT_URI_SAFE_ATTRIBUTES,
      { transform: transformCaseFunc, base: DEFAULT_URI_SAFE_ATTRIBUTES }
    );
    DATA_URI_TAGS = _resolveSetOption(
      cfg,
      'ADD_DATA_URI_TAGS',
      DEFAULT_DATA_URI_TAGS,
      { transform: transformCaseFunc, base: DEFAULT_DATA_URI_TAGS }
    );
    FORBID_CONTENTS = _resolveSetOption(
      cfg,
      'FORBID_CONTENTS',
      DEFAULT_FORBID_CONTENTS,
      { transform: transformCaseFunc }
    );
    FORBID_TAGS = _resolveSetOption(cfg, 'FORBID_TAGS', clone({}), {
      transform: transformCaseFunc,
    });
    FORBID_ATTR = _resolveSetOption(cfg, 'FORBID_ATTR', clone({}), {
      transform: transformCaseFunc,
    });
    USE_PROFILES = objectHasOwnProperty(cfg, 'USE_PROFILES')
      ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === 'object'
        ? clone(cfg.USE_PROFILES)
        : cfg.USE_PROFILES
      : false;

    ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false; // 默认 true
    ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false; // 默认 true
    ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false; // 默认 false
    ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false; // 默认 true
    SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false; // 默认 false
    SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false; // 默认 true
    WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false; // 默认 false
    RETURN_DOM = cfg.RETURN_DOM || false; // 默认 false
    RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false; // 默认 false
    RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false; // 默认 false
    FORCE_BODY = cfg.FORCE_BODY || false; // 默认 false
    SANITIZE_DOM = cfg.SANITIZE_DOM !== false; // 默认 true
    SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false; // 默认 false
    KEEP_CONTENT = cfg.KEEP_CONTENT !== false; // 默认 true
    IN_PLACE = cfg.IN_PLACE || false; // 默认 false
    IS_ALLOWED_URI = isRegex(cfg.ALLOWED_URI_REGEXP)
      ? cfg.ALLOWED_URI_REGEXP
      : EXPRESSIONS.IS_ALLOWED_URI; // 默认 URI 正则

    NAMESPACE =
      typeof cfg.NAMESPACE === 'string' ? cfg.NAMESPACE : HTML_NAMESPACE; // 默认 HTML namespace

    MATHML_TEXT_INTEGRATION_POINTS =
      objectHasOwnProperty(cfg, 'MATHML_TEXT_INTEGRATION_POINTS') &&
      cfg.MATHML_TEXT_INTEGRATION_POINTS &&
      typeof cfg.MATHML_TEXT_INTEGRATION_POINTS === 'object'
        ? clone(cfg.MATHML_TEXT_INTEGRATION_POINTS)
        : addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS); // 默认内建映射

    HTML_INTEGRATION_POINTS =
      objectHasOwnProperty(cfg, 'HTML_INTEGRATION_POINTS') &&
      cfg.HTML_INTEGRATION_POINTS &&
      typeof cfg.HTML_INTEGRATION_POINTS === 'object'
        ? clone(cfg.HTML_INTEGRATION_POINTS)
        : addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS); // 默认内建映射

    /* 单独复制自定义元素策略后再挑选自有成员，不让继承的谓词或错误类型进入活动策略。 */
    const customElementHandling =
      objectHasOwnProperty(cfg, 'CUSTOM_ELEMENT_HANDLING') &&
      cfg.CUSTOM_ELEMENT_HANDLING &&
      typeof cfg.CUSTOM_ELEMENT_HANDLING === 'object'
        ? clone(cfg.CUSTOM_ELEMENT_HANDLING)
        : create(null);

    CUSTOM_ELEMENT_HANDLING = create(null);

    if (
      objectHasOwnProperty(customElementHandling, 'tagNameCheck') &&
      isRegexOrFunction(customElementHandling.tagNameCheck)
    ) {
      CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck; // 默认 undefined
    }

    if (
      objectHasOwnProperty(customElementHandling, 'attributeNameCheck') &&
      isRegexOrFunction(customElementHandling.attributeNameCheck)
    ) {
      CUSTOM_ELEMENT_HANDLING.attributeNameCheck =
        customElementHandling.attributeNameCheck; // 默认 undefined
    }

    if (
      objectHasOwnProperty(
        customElementHandling,
        'allowCustomizedBuiltInElements'
      ) &&
      typeof customElementHandling.allowCustomizedBuiltInElements === 'boolean'
    ) {
      CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements =
        customElementHandling.allowCustomizedBuiltInElements; // 默认 undefined
    }

    seal(CUSTOM_ELEMENT_HANDLING);

    if (SAFE_FOR_TEMPLATES) {
      ALLOW_DATA_ATTR = false;
    }

    if (RETURN_DOM_FRAGMENT) {
      RETURN_DOM = true;
    }

    /* 配置的 profile 从文本节点集合重建标签与属性准入，因此覆盖显式 ALLOWED_TAGS/ALLOWED_ATTR。 */
    if (USE_PROFILES) {
      ALLOWED_TAGS = addToSet({}, TAGS.text);
      ALLOWED_ATTR = create(null);
      if (USE_PROFILES.html === true) {
        addToSet(ALLOWED_TAGS, TAGS.html);
        addToSet(ALLOWED_ATTR, ATTRS.html);
      }

      if (USE_PROFILES.svg === true) {
        addToSet(ALLOWED_TAGS, TAGS.svg);
        addToSet(ALLOWED_ATTR, ATTRS.svg);
        addToSet(ALLOWED_ATTR, ATTRS.xml);
      }

      if (USE_PROFILES.svgFilters === true) {
        addToSet(ALLOWED_TAGS, TAGS.svgFilters);
        addToSet(ALLOWED_ATTR, ATTRS.svg);
        addToSet(ALLOWED_ATTR, ATTRS.xml);
      }

      if (USE_PROFILES.mathMl === true) {
        addToSet(ALLOWED_TAGS, TAGS.mathMl);
        addToSet(ALLOWED_ATTR, ATTRS.mathMl);
        addToSet(ALLOWED_ATTR, ATTRS.xml);
      }
    }

    /* 始终重置函数型 ADD_TAGS/ADD_ATTR，避免从函数配置切换到数组配置时跨调用残留。 */
    EXTRA_ELEMENT_HANDLING.tagCheck = null;
    EXTRA_ELEMENT_HANDLING.attributeCheck = null;

    /* 合并数组型增量，或保存函数型动态判定。 */
    if (objectHasOwnProperty(cfg, 'ADD_TAGS')) {
      if (typeof cfg.ADD_TAGS === 'function') {
        EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
      } else if (arrayIsArray(cfg.ADD_TAGS)) {
        if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) {
          ALLOWED_TAGS = clone(ALLOWED_TAGS);
        }

        addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
      }
    }

    if (objectHasOwnProperty(cfg, 'ADD_ATTR')) {
      if (typeof cfg.ADD_ATTR === 'function') {
        EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
      } else if (arrayIsArray(cfg.ADD_ATTR)) {
        if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) {
          ALLOWED_ATTR = clone(ALLOWED_ATTR);
        }

        addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
      }
    }

    if (
      objectHasOwnProperty(cfg, 'ADD_URI_SAFE_ATTR') &&
      arrayIsArray(cfg.ADD_URI_SAFE_ATTR)
    ) {
      addToSet(URI_SAFE_ATTRIBUTES, cfg.ADD_URI_SAFE_ATTR, transformCaseFunc);
    }

    if (
      objectHasOwnProperty(cfg, 'FORBID_CONTENTS') &&
      arrayIsArray(cfg.FORBID_CONTENTS)
    ) {
      if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) {
        FORBID_CONTENTS = clone(FORBID_CONTENTS);
      }

      addToSet(FORBID_CONTENTS, cfg.FORBID_CONTENTS, transformCaseFunc);
    }

    if (
      objectHasOwnProperty(cfg, 'ADD_FORBID_CONTENTS') &&
      arrayIsArray(cfg.ADD_FORBID_CONTENTS)
    ) {
      if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) {
        FORBID_CONTENTS = clone(FORBID_CONTENTS);
      }

      addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
    }

    /* KEEP_CONTENT 在显式标签表没有 #text 时也补上它，使提升后的文字可继续保留。 */
    if (KEEP_CONTENT) {
      ALLOWED_TAGS['#text'] = true;
    }

    /* 完整文档模式将 html/head/body 加入允许集合；FORBID_TAGS 仍在元素判定时优先。 */
    if (WHOLE_DOCUMENT) {
      addToSet(ALLOWED_TAGS, ['html', 'head', 'body']);
    }

    /* 允许 table 时同步允许解析器隐式插入的 tbody，见 #286、#365。 */
    if (ALLOWED_TAGS.table) {
      addToSet(ALLOWED_TAGS, ['tbody']);
      delete FORBID_TAGS.tbody;
    }

    // 有效调用方策略替换当前策略，null 退出活动策略；未提供策略则复用当前策略或取得默认策略。
    // clearConfig()/显式 null 会解除旧调用方策略，避免它继续改变后续输出（GHSA-vxr8-fq34-vvx9）。
    if (cfg.TRUSTED_TYPES_POLICY) {
      if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== 'function') {
        throw typeErrorCreate(
          'TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.'
        );
      }

      if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== 'function') {
        throw typeErrorCreate(
          'TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.'
        );
      }

      // 先切到调用方策略；若初始化签名失败，下面会恢复此前策略。
      const previousTrustedTypesPolicy = trustedTypesPolicy;
      trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;

      // 为 sanitize 所需的空值签名。若回调重新进入策略包装，重入守卫会抛错；
      // 失败时先恢复旧活动策略再传播错误；此前已写入的其他配置字段不在此回滚（#1422）。
      try {
        emptyHTML = _createTrustedHTML('');
      } catch (error) {
        trustedTypesPolicy = previousTrustedTypesPolicy;
        throw error;
      }
    } else if (cfg.TRUSTED_TYPES_POLICY === null) {
      // 显式关闭本次 Trusted Types 签名且不创建策略，使禁止 dompurify 策略的严格 CSP 仍可从
      // 自有策略中调用 sanitize（#1422）。使用 undefined 而非持久 null：既丢弃旧调用方策略，
      // 防止它在后续调用复活，又允许下一次无策略配置恢复内部默认策略。见 GHSA-vxr8-fq34-vvx9。
      trustedTypesPolicy = undefined;
      emptyHTML = '';
    } else {
      // 未提供策略时，已有活动策略会跨无配置调用继续使用；否则惰性取得实例内部默认策略。
      // 单次调用提供的策略因此会暂留；新的调用方策略会替换它，clearConfig 或显式 null 会解除它。
      if (trustedTypesPolicy === undefined) {
        trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
      }

      // 仅在策略有效时签名内部空值；不支持、创建失败或显式关闭时保留普通字符串，避免对
      // 非策略调用 createHTML。见 #1422。
      if (trustedTypesPolicy && typeof emptyHTML === 'string') {
        emptyHTML = _createTrustedHTML('');
      }
    }

    // 仅冻结配置对象顶层；数组、正则和其他共享值没有深度冻结。旧环境的 freeze 回退不做冻结。
    if (freeze) {
      freeze(cfg);
    }

    CONFIG = cfg;
  };

  /* 汇合模块中的 foreign-content 名称表；列入这些表不等于元素已获名称准入。 */
  /** SVG allowlist、filter 与明确禁用标签的全集，仅用于 namespace 合法性判断。 */
  const ALL_SVG_TAGS = addToSet({}, [
    ...TAGS.svg,
    ...TAGS.svgFilters,
    ...TAGS.svgDisallowed,
  ]);
  /** MathML allowlist 与明确禁用标签的全集，仅用于 namespace 合法性判断。 */
  const ALL_MATHML_TAGS = addToSet({}, [
    ...TAGS.mathMl,
    ...TAGS.mathMlDisallowed,
  ]);

  /**
   * 检查 SVG namespace 元素是否满足本模块允许的父子转换规则。
   *
   * HTML 只能通过 `<svg>` 切入；MathML 只能从 annotation-xml 或文本 integration point
   * 通过 `<svg>` 切入；其余父级按 ALL_SVG_TAGS 判定名称，包括 SVG 或自定义 XML 父级。
   * _checkValidNamespace 在确认元素本身是 SVG namespace 后分派到这里，不修改 DOM。
   *
   * @param tagName - 转换检查使用的小写元素名，与 XHTML 的名称 allowlist 查询分开。
   * @param parent - 真实或模拟父节点。
   * @param parentTagName - 小写父级名，用于识别允许 namespace 转换的 integration point。
   * @returns 当前 namespace 转换是否合法。
   */
  const _checkSvgNamespace = function (
    tagName: string,
    parent: {
      /* prettier-ignore */
      /** 真实或模拟父级的 namespace；非 HTML/MathML 值进入 SVG 名称表检查。 */
      namespaceURI?: string
    },
    parentTagName: string
  ): boolean {
    // 从 HTML 切换到 SVG 的唯一入口是 <svg>；其他标签形成该转换时必须删除。
    if (parent.namespaceURI === HTML_NAMESPACE) {
      return tagName === 'svg';
    }

    // 从 MathML 切换到 SVG 还要求标签为 <svg>，且父级是 annotation-xml 或 MathML 文本 integration point。
    if (parent.namespaceURI === MATHML_NAMESPACE) {
      return (
        tagName === 'svg' &&
        (parentTagName === 'annotation-xml' ||
          MATHML_TEXT_INTEGRATION_POINTS[parentTagName])
      );
    }

    // 其余父级按 SVG 规则表检查；该表含明确禁用名称，只判转换，不替代元素 allowlist。
    return Boolean(ALL_SVG_TAGS[tagName]);
  };

  /**
   * 检查 MathML namespace 元素是否满足本模块允许的父子转换规则。
   *
   * HTML 只能通过 `<math>` 切入；SVG 只能在 HTML integration point 下通过 `<math>`
   * 切入；其余父级按 ALL_MATHML_TAGS 判定名称。_checkValidNamespace 只对 MathML 元素
   * 调用本函数，名称已转小写；此处不重复执行元素 allowlist 或改变树。
   *
   * @param tagName - 转换检查使用的小写元素名。
   * @param parent - 真实或模拟父节点。
   * @param parentTagName - 小写父级名，供 HTML integration-point 表查询。
   * @returns 当前 namespace 转换是否合法。
   */
  const _checkMathMlNamespace = function (
    tagName: string,
    parent: {
      /* prettier-ignore */
      /** 真实或模拟父级的 namespace；非 HTML/SVG 值进入 MathML 名称表检查。 */
      namespaceURI?: string
    },
    parentTagName: string
  ): boolean {
    // 从 HTML 切换到 MathML 的唯一入口是 <math>。
    if (parent.namespaceURI === HTML_NAMESPACE) {
      return tagName === 'math';
    }

    // 从 SVG 切换到 MathML 必须同时经过 HTML integration point 与 <math>。
    if (parent.namespaceURI === SVG_NAMESPACE) {
      return tagName === 'math' && HTML_INTEGRATION_POINTS[parentTagName];
    }

    // 其余父级按 MathML 规则表检查；标签是否允许仍由外层元素阶段决定。
    return Boolean(ALL_MATHML_TAGS[tagName]);
  };

  /**
   * 检查 HTML namespace 元素是否满足本模块对 foreign-content 父级的转换规则。
   *
   * SVG 父级必须是 HTML integration point，MathML 父级必须是文本 integration point；
   * 其他父级不要求 integration point。之后所有路径都拒绝 MathML 名称，以及仅属于 SVG 的
   * 名称，COMMON_SVG_AND_HTML_ELEMENTS 中的 SVG/HTML 共有名例外。该检查由
   * _checkValidNamespace 分派，不修改当前元素或父级。
   *
   * @param tagName - 转换检查使用的小写元素名。
   * @param parent - 真实或模拟父节点。
   * @param parentTagName - 小写父级名，供 integration-point 表查询。
   * @returns 当前 namespace 转换是否合法。
   */
  const _checkHtmlNamespace = function (
    tagName: string,
    parent: {
      /* prettier-ignore */
      /** 真实或模拟父级的 namespace；只有 SVG/MathML 值增加 integration-point 条件。 */
      namespaceURI?: string
    },
    parentTagName: string
  ): boolean {
    // SVG 只能经 HTML integration point 切回 HTML；MathML 只能经文本 integration point 切回。
    if (
      parent.namespaceURI === SVG_NAMESPACE &&
      !HTML_INTEGRATION_POINTS[parentTagName]
    ) {
      return false;
    }

    if (
      parent.namespaceURI === MATHML_NAMESPACE &&
      !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]
    ) {
      return false;
    }

    // HTML namespace 拒绝 MathML/SVG 专属标签，但接受 SVG 与 HTML 的共有标签。
    return (
      !ALL_MATHML_TAGS[tagName] &&
      (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName])
    );
  };

  /**
   * 校验元素的 namespace 及其相对父级的转换路径。
   *
   * parentless 或 shadow 场景用配置的 `NAMESPACE` 和 template 父级模拟解析上下文。进入本函数的
   * 自定义 XML namespace 仅在 XHTML parser 模式且显式 allowlist 时允许；名称阶段经
   * `CUSTOM_ELEMENT_HANDLING` 保留的非 allowlisted basic custom element 会在调用本函数前早退，
   * 刻意跳过 namespace 与 fallback-tag 判定。
   * _sanitizeElements 在名称准入之后、属性净化之前调用本函数；先检查元素 namespace 是否
   * 在 ALLOWED_NAMESPACES 中，再检查父子组合。无 tagName 的父级用 NAMESPACE/template
   * 模拟，使 parentless 根与 fragment 顶层元素使用同一规则。这里只判定，false 由外层整删。
   *
   * @param element - 要检查 namespace 的 DOM 元素。
   * @returns namespace 获准且满足本模块转换规则时返回 `true`。
   */
  const _checkValidNamespace = function (element: Element): boolean {
    let parent = getParentNode(element);

    // 无父节点，或父级为 Document/DocumentFragment 等无 tagName 节点时，模拟 template 父级。
    if (!parent || !parent.tagName) {
      parent = {
        namespaceURI: NAMESPACE,
        tagName: 'template',
      };
    }

    const tagName = stringToLowerCase(element.tagName);
    const parentTagName = stringToLowerCase(parent.tagName);

    if (!ALLOWED_NAMESPACES[element.namespaceURI]) {
      return false;
    }

    if (element.namespaceURI === SVG_NAMESPACE) {
      return _checkSvgNamespace(tagName, parent, parentTagName);
    }

    if (element.namespaceURI === MATHML_NAMESPACE) {
      return _checkMathMlNamespace(tagName, parent, parentTagName);
    }

    if (element.namespaceURI === HTML_NAMESPACE) {
      return _checkHtmlNamespace(tagName, parent, parentTagName);
    }

    // XHTML/XML 模式允许显式配置的自定义 namespace。
    if (
      PARSER_MEDIA_TYPE === 'application/xhtml+xml' &&
      ALLOWED_NAMESPACES[element.namespaceURI]
    ) {
      return true;
    }

    // HTML parser 模式不接受其余 namespace，即使它出现在 ALLOWED_NAMESPACES 中。
    return false;
  };

  /**
   * 记录删除决策，并优先通过父节点移除当前节点。
   *
   * 常规路径通过缓存 getter 找到父节点并调用其 removeChild；该调用成功后直接结束。
   * 常规路径抛错时改用缓存 remove，随后若节点无父节点则抛错。这个分支会拒绝原本就
   * parentless 的待删根，因为 remove 对它没有效果，不能把它作为净化结果交还调用方。
   * 元素拒绝、namespace 拒绝、结构威胁、is 属性特殊删除和 FORCE_BODY 哨兵删除共用此入口。
   * removed 在移除动作之前写入原节点引用，所以移除异常也会留下删除决策；它不是节点已
   * 成功离树的证明。正常 removeChild 不遍历或净化后代，IN_PLACE 收尾另行处理原子树。
   *
   * @param node - 已被安全策略判定必须删除的 DOM 节点。
   */
  const _forceRemove = function (node: Node): void {
    arrayPush(DOMPurify.removed, { element: node });

    try {
      // eslint-disable-next-line unicorn/prefer-dom-node-remove
      getParentNode(node).removeChild(node);
    } catch (_) {
      /* 无父节点的根调用 remove 是空操作；这里明确抛错，外层 IN_PLACE 流程再处理原树。
         缓存 remove/getParentNode 避免从待删 form 上读取可能被命名后代遮蔽的方法。 */
      remove(node);

      if (!getParentNode(node)) {
        throw typeErrorCreate(
          'a node selected for removal could not be detached from its tree ' +
            'and cannot be safely returned; refusing to sanitize in place'
        );
      }
    }
  };

  /**
   * 在 IN_PLACE 预检失败或遍历中止时，尝试中和根节点及其普通后代。
   *
   * 遍历异常可能留下尚未访问的事件处理属性。先沿 childNodes 剥离非 allowlist 属性，再尝试
   * 删除根的 children 和 attributes，调用方随后传播错误；清理动作的单项失败会被忽略。
   * 结构读取使用缓存 getter，清理不进入 template.content 或 attached shadow root。
   * 根预检、attached-root 预扫 catch 和主 walk catch 都可调用它。这里不产生 removed 记录，
   * 也不继续原来的净化遍历；清理范围是 root 的普通树，不包括此前已 detach 的节点。
   * 那些节点由主 walk catch 后续遍历 removed 处理。getter/子树清理本身的异常未统一捕获，
   * 所以清理异常仍可能替代调用方原本准备传播的错误。
   *
   * @param root - 要失败关闭的 IN_PLACE 根。
   */
  const _neutralizeRoot = function (root: Node): void {
    /*
     * 先清理普通后代再 detach，避免只把携带资源事件处理属性的原节点移出树。
     * 待删 form 自身方法可能被遮蔽；缓存 childNodes getter 仍能让清理继续到正常后代。
     */
    _neutralizeSubtree(root);

    const childNodes = getChildNodes(root);
    if (childNodes) {
      /* 当前 childNodes 是 live 集合；先保存引用，再逐个 remove，避免索引移动漏删相邻 children。 */
      const snapshot: Node[] = [];
      arrayForEach(childNodes, (child) => {
        arrayPush(snapshot, child);
      });
      arrayForEach(snapshot, (child) => {
        try {
          remove(child);
        } catch (_) {
          /* 单个 child 的拆除失败不阻断其余清理；该 child 可能仍留在根中。 */
        }
      });
    }

    const attributes = getAttributes(root);
    if (attributes) {
      for (let i = attributes.length - 1; i >= 0; --i) {
        const attribute = attributes[i];
        const name = attribute && attribute.name;
        if (typeof name === 'string') {
          try {
            (root as Element).removeAttribute(name);
          } catch (_) {
            /* 此时 removeAttribute 已被 clobber；失败关闭流程尽力继续处理其余属性。 */
          }
        }
      }
    }
  };

  /**
   * 记录并删除一个属性，对 `is` 再按返回模式处理元素或属性值。
   *
   * 名称为 is 时，DOM 返回模式会尝试删除整个元素；字符串模式则尝试写回空值。两者都不先
   * 检查 removeAttribute 后是否仍有该属性，因为删除属性未必撤销 customized built-in 状态。
   * 取属性节点失败时仍记录 attribute:null；实际删除记录不等于完整的执行日志。
   * _sanitizeAttributes 与 _setAttributeValue 的失败分支都会调用它。普通 removeAttribute
   * 抛错会向上传播，只有 is 的附加处理捕获异常；成功的属性写回还可能由 helper 弹掉记录。
   *
   * @param name - 元素上实际存在的属性名。
   * @param element - 承载该属性的元素。
   */
  const _removeAttribute = function (name: string, element: Element): void {
    try {
      arrayPush(DOMPurify.removed, {
        attribute: element.getAttributeNode(name),
        from: element,
      });
    } catch (_) {
      arrayPush(DOMPurify.removed, {
        attribute: null,
        from: element,
      });
    }

    element.removeAttribute(name);

    // 属性 is 的特殊处理无条件执行；其中移除元素或写回空值的异常被忽略。
    if (name === 'is') {
      if (RETURN_DOM || RETURN_DOM_FRAGMENT) {
        try {
          _forceRemove(element);
        } catch (_) {}
      } else {
        try {
          element.setAttribute(name, '');
        } catch (_) {}
      }
    }
  };

  /**
   * 从单个待丢弃元素上移除不在活动名称 allowlist 中的属性。
   *
   * 该函数只复用主属性流程的名称集合，因此会移除默认不允许的 `on*`，而不引入另一套
   * `/^on/` blocklist；它不执行 URI/value 校验，也不替代完整 `_sanitizeAttributes`。
   * _neutralizeSubtree 对每个 Element 调用它。这里不采用 data/aria、ADD_ATTR 函数、FORBID_ATTR
   * 或 custom-element 的完整准入链，只查看 ALLOWED_ATTR 成员；显式放行的 on* 也会保留。
   * 倒序访问缓存 getter 返回的 live 属性表，删除失败逐项忽略，不触发 hooks 或 removed 记录。
   *
   * @param element - 要剥离非 allowlist 属性的待丢弃元素。
   */
  const _stripDisallowedAttributes = function (element: Element): void {
    const attributes = getAttributes(element);
    if (!attributes) {
      return;
    }

    for (let i = attributes.length - 1; i >= 0; --i) {
      const attribute = attributes[i];
      const name = attribute && attribute.name;
      if (typeof name !== 'string' || ALLOWED_ATTR[transformCaseFunc(name)]) {
        continue;
      }

      try {
        element.removeAttribute(name);
      } catch (_) {
        /* 待丢弃节点的 removeAttribute 已被 clobber；忽略并继续处理可达后代。 */
      }
    }
  };

  /**
   * 沿 childNodes 迭代清理 IN_PLACE 路径已经丢弃或即将丢弃的节点。
   *
   * 移出树不会自动清除原节点上的事件处理属性。主流程在返回或传播遍历错误前，清理 removed
   * 记录中的节点；hook 已 detach 的节点则在元素阶段立即清理，因为它们不进入 removed。
   * 此处只按活动属性名称 allowlist 剥离属性，不触发 hook，也不执行 URI/value 校验；不进入
   * template.content 或 attached shadow root。clobbered 节点自身无法清理时仍继续处理普通后代。
   * 根也进入工作栈；每次剥离当前元素后才读取并逆序压入其普通 children，因此不会因函数递归
   * 累积调用栈。它接受已 detached 的原节点，仍在这些对象上删属性，而不是创建净化副本。
   *
   * @param root - 待中和的 removed subtree 根。
   */
  const _neutralizeSubtree = function (root: Node): void {
    const stack: Node[] = [root];

    while (stack.length > 0) {
      const node = stack.pop();
      const nodeType = getNodeType ? getNodeType(node) : (node as any).nodeType;

      if (nodeType === NODE_TYPE.element) {
        _stripDisallowedAttributes(node as Element);
      }

      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push(childNodes[i]);
        }
      }
    }
  };

  /**
   * 在 IN_PLACE 主 walk 前预先移除普通后代上的 patch 关联标记。
   *
   * 机制参考：https://github.com/WICG/declarative-partial-updates
   *
   * SAFE_FOR_XML 开启时，沿 childNodes 移除 PI、含 markup 的注释、patchsrc，以及非
   * label/output 元素上的 for。先于逐节点净化执行，避免这些关联一直保留到主迭代器访问它们。
   * 属性操作逐节点捕获异常，clobbered 节点不会阻断其普通后代的预扫。该流程不进入
   * template.content 或 attached shadow root，也不能撤销调用前已发生的 DOM 变化。
   * sanitize 在根名称/clobber 预检之前调用它；这批删除不记入 removed，也不触发 hooks。
   * 标签与属性值的完整净化仍在后续 walk 执行，label/output 的 for 在此保留后仍受普通规则约束。
   *
   * @param root - 主 walk 前要预扫的 IN_PLACE 根。
   */
  const _neutralizePatchLinkage = function (root: Node): void {
    if (!SAFE_FOR_XML) {
      return;
    }

    const stack: Node[] = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      const nodeType = getNodeType ? getNodeType(node) : (node as any).nodeType;

      /* 删除 patch linkage 的 target 端：全部 PI 与包含 markup 的 comment range marker。 */
      if (
        nodeType === NODE_TYPE.processingInstruction ||
        (nodeType === NODE_TYPE.comment &&
          regExpTest(EXPRESSIONS.COMMENT_MARKUP_PROBE, (node as any).data))
      ) {
        try {
          remove(node);
        } catch (_) {
          /* 预扫尽力删除；继续处理仍可达节点。 */
        }

        continue;
      }

      /* 删除元素上作为 patch source 端的 linkage 属性。 */
      if (nodeType === NODE_TYPE.element) {
        const element = node as Element;
        const lcTag = transformCaseFunc(
          getNodeName ? getNodeName(node) : (node as any).nodeName
        );
        try {
          if (element.hasAttribute && element.hasAttribute('patchsrc')) {
            element.removeAttribute('patchsrc');
          }

          if (
            element.hasAttribute &&
            element.hasAttribute('for') &&
            lcTag !== 'label' &&
            lcTag !== 'output'
          ) {
            element.removeAttribute('for');
          }
        } catch (_) {
          /* 待删节点的 hasAttribute/removeAttribute 已被 clobber；忽略并继续遍历后代。 */
        }
      }

      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push(childNodes[i]);
        }
      }
    }
  };

  /**
   * 把脏字符串解析到隔离文档，并返回本次 walk 的 html/body 根。
   *
   * HTML namespace 优先使用 DOMParser；不可用或失败时以 `createDocument` + `innerHTML`
   * 回退。XHTML 会补齐根结构；非 FORCE_BODY 模式手工恢复解析器可能丢失的前导空白。
   * DOMParser 调用和 fallback innerHTML 写入各自捕获异常；调用方未取得根时返回空结果。
   * 策略包装、文档创建和前导空白插入的异常仍会向外传播。
   * sanitize 的字符串分支传入脏内容，Node copy 分支只传空注释占位来准备导入上下文。
   * 返回的对象实际是选定的 Element 根，而不是外层 Document；WHOLE_DOCUMENT 只改变选择
   * 和后续序列化方式。DOMParser 产生带 documentElement 的 XML 错误文档不会触发 fallback，
   * HTML namespace 分支若再找不到 html/body，便把 undefined 交给调用方的空结果路径。
   *
   * @param dirty - 待解析的脏 markup 字符串。
   * @returns `WHOLE_DOCUMENT` 下的 html 根，否则为 body/namespace 根。
   */
  const _initDocument = function (dirty: string): Document {
    /* 创建隔离解析文档。 */
    let doc = null;
    let leadingWhitespace = null;

    if (FORCE_BODY) {
      dirty = '<remove></remove>' + dirty;
    } else {
      /* 未使用 FORCE_BODY 时，解析器可能吞掉前导空白，需手工保存。 */
      const matches = stringMatch(dirty, /^[\r\n\t ]+/);
      leadingWhitespace = matches && matches[0];
    }

    if (
      PARSER_MEDIA_TYPE === 'application/xhtml+xml' &&
      NAMESPACE === HTML_NAMESPACE
    ) {
      // 严格 XHTML 根必须声明 xmlns，见 https://www.w3.org/TR/xhtml1/normative.html#strict
      dirty =
        '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>' +
        dirty +
        '</body></html>';
    }

    const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
    /* HTML namespace 尝试 DOMParser；非 HTML namespace 直接进入下方 createDocument 路径。 */
    if (NAMESPACE === HTML_NAMESPACE) {
      try {
        doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
      } catch (_) {}
    }

    /* DOMParser 不可用或未生成 documentElement 时，使用 namespace document + innerHTML 回退。 */
    if (!doc || !doc.documentElement) {
      doc = implementation.createDocument(NAMESPACE, 'template', null);
      try {
        doc.documentElement.innerHTML = IS_EMPTY_INPUT
          ? emptyHTML
          : dirtyPayload;
      } catch (_) {
        // 无效 XML 等写入错误在此忽略；根保持未成功写入时的内容，再按下方 namespace 规则选根。
      }
    }

    const body = doc.body || doc.documentElement;

    if (dirty && leadingWhitespace) {
      body.insertBefore(
        document.createTextNode(leadingWhitespace),
        body.childNodes[0] || null
      );
    }

    /* 完整文档走 html 根，片段净化走 body/namespace 根。 */
    if (NAMESPACE === HTML_NAMESPACE) {
      return getElementsByTagName.call(
        doc,
        WHOLE_DOCUMENT ? 'html' : 'body'
      )[0];
    }

    return WHOLE_DOCUMENT ? doc.documentElement : body;
  };

  /**
   * 为净化根创建只遍历安全相关节点类型的 `NodeIterator`。
   *
   * ownerDocument 必须经缓存的 Node.prototype getter 读取，避免 form 命名属性把调用接收者
   * 替换成子元素并造成 `Illegal invocation`。迭代器包含 Element、Comment、Text、PI、CDATA；
   * shadow tree 与 template.content 由专门流程显式进入。
   * 主 sanitize 与 _sanitizeShadowDOM 分别以 Element/fragment 作为根调用；迭代范围含根自身
   * 及普通后代中匹配位掩码的节点，没有 filter 回调。walk 是 live 的，删除当前节点或提升其
   * children 会影响后续访问；此函数只创建迭代器，不预先保存整棵树的节点快照。
   *
   * @param root - walk 的根元素或节点。
   * @returns 绑定真实 owner document 的节点迭代器。
   */
  const _createNodeIterator = function (root: Node): NodeIterator {
    /*
     * HTMLFormElement 具有 [LegacyOverrideBuiltIns]；<input name="ownerDocument"> 或外部关联
     * input 会遮蔽原型 getter，使直接读取返回 input。随后 createNodeIterator.call(input, ...)
     * 会抛出 "Illegal invocation"。缓存 getter 使接收者仍为真实文档，不必依赖这个具名属性。
     * 缓存的 Node.prototype getter 始终读取真实 Document，不受该 clobber 影响。
     */
    const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
    return createNodeIterator.call(
      doc || root,
      root,
      // eslint-disable-next-line no-bitwise
      NodeFilter.SHOW_ELEMENT |
        NodeFilter.SHOW_COMMENT |
        NodeFilter.SHOW_TEXT |
        NodeFilter.SHOW_PROCESSING_INSTRUCTION |
        NodeFilter.SHOW_CDATA_SECTION,
      null
    );
  };

  /**
   * 把 Mustache、ERB 与模板字面量表达式替换为空格。
   *
   * 所有 SAFE_FOR_TEMPLATES 清理点共享该顺序：先 Mustache，再 ERB，最后模板字面量；
   * 每种表达式只替换一次，不循环重跑前面的正则。
   * 元素文本、属性值、DOM 返回前的字符数据 scrub，以及字符串序列化收尾都复用它；这里
   * 只处理传入字符串，不访问 DOM、配置或 removed。调用点决定是否记录文本替换。
   *
   * @param value - 要清理的字符数据或属性值。
   * @returns 去除模板表达式后的字符串。
   */
  const _stripTemplateExpressions = function (value: string): string {
    value = stringReplace(value, MUSTACHE_EXPR, ' ');
    value = stringReplace(value, ERB_EXPR, ' ');
    value = stringReplace(value, TMPLIT_EXPR, ' ');
    return value;
  };

  /**
   * 从元素子树的字符数据中去除 `{{...}}`、`${...}`、`<%...%>` 模板表达式。
   *
   * DOM 返回路径在 SAFE_FOR_TEMPLATES 下调用此函数：先 normalize，让原本相邻的多个 text
   * node 合并后再清理，其中包括删除元素后变得相邻的文本。遍历 Text、Comment、CDATA、PI 并修改
   * `.data`，避免 innerHTML 序列化/重解析，也让 ERB 正则匹配真实 `<%...%>` 字节而非实体转义。
   *
   * 此处不访问属性值；属性模板表达式由逐节点 `_sanitizeAttributes` 处理。NodeIterator 不进入
   * template.content，因此递归 querySelectorAll 找到的后代 template fragment；它不包含根自身，
   * 也不进入 attached shadow roots。这些位置的逐节点清理由 fragment walk 完成。
   * sanitize 在主 walk 正常完成后、返回 IN_PLACE/DOM 结果前调用它；normalize 与 data 写入
   * 直接修改将返回的树，不创建新的 removed 项。该阶段处于主 walk catch 之外，异常直接传播。
   *
   * @param node - 要清理字符数据的元素或 DocumentFragment 形根。
   */
  const _scrubTemplateExpressions = function (node: Element): void {
    node.normalize();
    /* 与 _createNodeIterator 相同，必须防 clobber 地读取 ownerDocument；live IN_PLACE form 根
       可能用命名子节点遮蔽 ownerDocument。 */
    const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
    const walker = createNodeIterator.call(
      doc || node,
      node,
      // eslint-disable-next-line no-bitwise
      NodeFilter.SHOW_TEXT |
        NodeFilter.SHOW_COMMENT |
        NodeFilter.SHOW_CDATA_SECTION |
        NodeFilter.SHOW_PROCESSING_INSTRUCTION,
      null
    );

    let currentNode = walker.nextNode() as CharacterData | null;
    while (currentNode) {
      currentNode.data = _stripTemplateExpressions(currentNode.data);
      currentNode = walker.nextNode() as CharacterData | null;
    }

    // DOM 规范规定 NodeIterator 不进入 template.content；像 _sanitizeShadowDOM 一样显式递归。
    const templates = node.querySelectorAll?.('template');
    if (templates) {
      arrayForEach(templates, (tmpl: HTMLTemplateElement) => {
        if (_isDocumentFragment(tmpl.content)) {
          _scrubTemplateExpressions(tmpl.content as unknown as Element);
        }
      });
    }
  };

  /**
   * 检测 `HTMLFormElement` 的关键结构成员是否被命名子节点 clobber。
   *
   * Form 具有 [LegacyOverrideBuiltIns] 的命名访问机制；后代的 `name` 命中原型属性时，
   * 直接读取可能返回命名子节点。函数先用缓存 nodeName 跨 realm 识别 form，再检查关键成员
   * 类型；attributes、nodeType、childNodes 还与缓存 getter 的结果比较。IN_PLACE 入口和
   * 元素阶段都会调用它，属性写回后也重新检查。
   * 非 form 或无法取得字符串节点名时返回 false；它不删除节点，入口决定拒绝原地根，元素
   * 阶段或属性写回阶段则调用 _forceRemove。类型探针只确认列出的成员仍有预期形状，
   * attributes/nodeType/childNodes 的引用或数值比较再识别形状相似的命名后代。
   *
   * @param element - 要检查 DOM clobbering 的元素。
   * @returns form 的任一所列探针不满足预期类型或引用时返回 `true`。
   */
  const _isClobbered = function (element: Element): boolean {
    // 通过缓存 getter 跨 realm 探测标签；无法确定标签时不在此函数判死，仍由其他屏障处理。
    const realTagName = getNodeName ? getNodeName(element) : null;
    if (typeof realTagName !== 'string') {
      return false;
    }

    if (transformCaseFunc(realTagName) !== 'form') {
      return false;
    }

    return (
      typeof element.nodeName !== 'string' ||
      typeof element.textContent !== 'string' ||
      typeof element.removeChild !== 'function' ||
      // 跨 realm 比较直接 attributes 与缓存 getter：clobbered form 会分叉，干净 form 都指向
      // 同一 canonical NamedNodeMap。
      element.attributes !== getAttributes(element) ||
      typeof element.removeAttribute !== 'function' ||
      typeof element.setAttribute !== 'function' ||
      typeof element.namespaceURI !== 'string' ||
      typeof element.insertBefore !== 'function' ||
      typeof element.hasChildNodes !== 'function' ||
      // 缓存 Node.prototype.nodeType 从内部 slot 跨 realm 返回整数 1；命名为 nodeType 的子节点
      // 会使 form 直接读取返回元素。该探针同时保护 _sanitizeElements 的 mXSS/PI/comment 分支。
      element.nodeType !== getNodeType(element) ||
      // 名为 childNodes 的后代会让 form.childNodes 返回该元素而非真实 NodeList，导致 walk 跳过
      // children。与缓存 getter 做引用比较，可覆盖 input/select 等所有子类型；仅检查 length 类型
      // 会漏掉本就具有数值 length 的 HTMLSelectElement。
      element.childNodes !== getChildNodes(element)
    );
  };

  /**
   * 跨 realm 判断值是否为真实 `DocumentFragment`。
   *
   * 不使用 realm-bound `instanceof`，而由缓存 Node.prototype getter 读取内部 slot 的数值
   * `nodeType`，与 DOCUMENT_FRAGMENT_NODE（11）比较；伪对象或 getter 抛错统一返回 false。
   * 主 walk、shadow/template 递归和模板 scrub 用它决定是否能进入 content/shadowRoot。
   * 原生 getter 的接收者检查承担 Node 品牌验证；仅把普通对象的 nodeType 写成 11 不会获准。
   *
   * @param value - 待检查对象。
   * @returns 任意 realm 的真实 DocumentFragment 返回 `true`。
   */
  const _isDocumentFragment = function (value: unknown): boolean {
    if (!getNodeType || typeof value !== 'object' || value === null) {
      return false;
    }

    try {
      return getNodeType(value as Node) === NODE_TYPE.documentFragment;
    } catch (_) {
      return false;
    }
  };

  /**
   * 跨 realm 判断值是否为真实 DOM Node。
   *
   * 旧 `value instanceof Node` 受 realm 绑定；iframe 节点会被误判为普通对象、被字符串化，并令
   * IN_PLACE 失效，调用方继续使用的原节点保持未净化。缓存 nodeType getter 从内部 slot 读取
   * 数值，修复 GHSA-4w3q-35jp-p934；伪对象或 getter 抛错返回 false。
   * sanitize 用它在字符串化之前选择 Node 路径，并再次决定原地处理；mXSS/style 探针也用它
   * 检查 firstElementChild。判定不依赖节点自有 nodeType，不读取输入的 toString，也不改变对象。
   *
   * @param value - 待检查对象。
   * @returns 任意 realm 的真实 DOM Node 返回 `true`。
   */
  const _isNode = function (value: unknown): value is Node {
    if (!getNodeType || typeof value !== 'object' || value === null) {
      return false;
    }

    try {
      return typeof getNodeType(value) === 'number';
    } catch (_) {
      return false;
    }
  };

  /**
   * 按注册顺序执行一个 hook 队列。
   *
   * hook 的 this 绑定当前实例，接收当前 CONFIG。使用原生 forEach 语义：分发开始后追加的
   * hook 不进入本次分发，splice 删除当前数组中的项可能改变后续访问；removeHooks/
   * removeAllHooks 替换数组则只影响之后的分发。配置仅顶层冻结，异常不在此处吞掉；主遍历
   * 和 attached-root 预扫的 IN_PLACE 调用由外层清理逻辑接住异常。
   * data 是同一入口各 hook 共用的事件对象；前一回调对其字段或所指名称表的修改会被后续
   * 回调看到。CONFIG 则在每次 hook.call 时从闭包读取，同实例重入改变配置后不会自动恢复。
   *
   * @param hooks - 当前 entry point 的 hook 数组。
   * @param currentNode - 当前节点或 shadow fragment。
   * @param data - entry point 对应的可变事件数据；无数据的 hook 传 `null`。
   */
  function _executeHooks<T extends HookFunction>(
    hooks: HookFunction[],
    currentNode: Parameters<T>[0],
    data: Parameters<T>[1]
  ): void {
    if (hooks.length === 0) {
      return;
    }

    arrayForEach(hooks, (hook: T) => {
      hook.call(DOMPurify, currentNode, data, CONFIG);
    });
  }

  /**
   * 检测无论 allowlist 如何都必须删除的结构威胁。
   *
   * SAFE_FOR_XML 门控 mXSS 探针、HTML style 的 Element child 和危险注释；PI 则始终拒绝。
   * mXSS 探针要求存在子节点但没有 Element child，且 textContent/innerHTML 同时含 markup
   * 标记。函数仅做判定，命中后由调用方整节点移除，不走 KEEP_CONTENT 提升。
   * _sanitizeElements 在 upon hook 后、名称准入之前调用它，因此扩展标签允许表不会绕过
   * 这些结构条件。探针判断的是当前 DOM 形状，文本中的 markup 标记不会在此被重新解析。
   *
   * @param currentNode - 当前 NodeIterator 节点。
   * @param tagName - 经当前 parser 大小写规则规范化的节点名。
   * @returns 节点必须整棵删除时返回 `true`。
   */
  const _isUnsafeNode = function (currentNode: any, tagName: string): boolean {
    /* 检测利用 namespace confusion 的 mXSS。 */
    if (
      SAFE_FOR_XML &&
      currentNode.hasChildNodes() &&
      !_isNode(currentNode.firstElementChild) &&
      regExpTest(EXPRESSIONS.ELEMENT_MARKUP_PROBE, currentNode.textContent) &&
      regExpTest(EXPRESSIONS.ELEMENT_MARKUP_PROBE, currentNode.innerHTML)
    ) {
      return true;
    }

    /* HTML style 通常只有文本；出现 Element child 时按结构威胁处理。 */
    if (
      SAFE_FOR_XML &&
      currentNode.namespaceURI === HTML_NAMESPACE &&
      tagName === 'style' &&
      _isNode(currentNode.firstElementChild)
    ) {
      return true;
    }

    /* PI 始终删除，与 SAFE_FOR_XML 是否开启无关。 */
    if (currentNode.nodeType === NODE_TYPE.processingInstruction) {
      return true;
    }

    /* SAFE_FOR_XML 下删除含 markup 的潜在危险 comment。 */
    if (
      SAFE_FOR_XML &&
      currentNode.nodeType === NODE_TYPE.comment &&
      regExpTest(EXPRESSIONS.COMMENT_MARKUP_PROBE, currentNode.data)
    ) {
      return true;
    }

    return false;
  };

  /**
   * 处理 forbidden 或未进入 allowlist 的节点。
   *
   * 通过 `CUSTOM_ELEMENT_HANDLING` 的 custom element 会保留并返回 false；该早退刻意跳过后续
   * namespace 与 fallback-tag 判定。其他节点按 KEEP_CONTENT/FORBID_CONTENTS 决定是否提升
   * children 后删除。false 只代表“保留 custom element”，调用方据此触发 afterSanitizeElements，
   * 主循环随后仍执行属性净化（GHSA-c2j3-45gr-mqc4）。
   * 只由 _sanitizeElements 的名称拒绝分支调用；结构威胁或 namespace 拒绝已经整删，不到此
   * 提升内容。函数型 ADD_TAGS 的准入在外层完成，CUSTOM_ELEMENT_HANDLING 则作为这里的
   * 名称例外；FORBID_TAGS 同时限制两者。移除动作和自定义谓词的异常向外层 walk 传播。
   *
   * @param currentNode - 被元素名称规则拒绝的节点。
   * @param tagName - 经当前 parser 规则规范化的标签名。
   * @param root - 当前 NodeIterator 根，用于区分根删除时的 clone 语义。
   * @returns 已删除返回 `true`；仅保留 custom element 时返回 `false`。
   */
  const _sanitizeDisallowedNode = function (
    currentNode: any,
    tagName: string,
    root: Node
  ): boolean {
    /* FORBID_TAGS 先胜出；否则允许配置谓词认可的基本 custom element。 */
    if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName)) {
      if (
        CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof RegExp &&
        regExpTest(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)
      ) {
        return false;
      }

      if (
        CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof Function &&
        CUSTOM_ELEMENT_HANDLING.tagNameCheck(tagName)
      ) {
        return false;
      }
    }

    /* 只有 KEEP_CONTENT 开启且名称不在 FORBID_CONTENTS 中才提升子节点。
       缓存 getter 避免 form 命名后代遮蔽 parentNode/childNodes；没有父级时无法提升。 */
    if (KEEP_CONTENT && !FORBID_CONTENTS[tagName]) {
      const parentNode = getParentNode(currentNode);
      const childNodes = getChildNodes(currentNode);

      if (childNodes && parentNode) {
        const childCount = childNodes.length;

        /*
         * 非根节点把 child 原对象提升到当前节点后方，不做深克隆。嵌套不允许元素可能使同一
         * 后代多次上移，但不会逐层复制其整棵子树；原对象的资源事件状态也随之保留，后续 walk
         * 因而会在携带事件的同一对象上清除默认不允许的 on* 属性。
         *
         * 删除 walk root 时改为 clone。字符串路径会从该根序列化结果；若严格
         * ALLOWED_TAGS 拒绝 body，将副本插到根旁边，同时让原 children 留在根内继续 walk 与
         * 序列化。IN_PLACE 根在入口按允许集合预检；hook 随后若改变该集合，仍可能重新拒绝根。
         *
         * childNodes 是 live NodeList；从尾到头处理可同时保证 move 时索引随尾项删除仍有效，
         * clone 时原列表不变；每次插在当前节点后方也保持 children 的原始顺序。
         */
        for (let i = childCount - 1; i >= 0; --i) {
          const hoisted =
            currentNode === root
              ? cloneNode(childNodes[i], true)
              : childNodes[i];
          parentNode.insertBefore(hoisted, getNextSibling(currentNode));
        }
      }
    }

    _forceRemove(currentNode);
    return true;
  };

  /**
   * 在 `uponSanitize*` hook 首次看到共享 allowlist 前，按需分叉为调用级副本。
   *
   * hook 事件公开 allowlist 引用；若它仍指向实例默认集合或 `setConfig()` 捕获集合，hook 的扩展
   * 会越过当前调用永久污染状态。即使 upon hook 是由 before hook 延迟安装，此函数也在暴露前
   * 关闭时序缝隙。集合已是调用级副本时原样返回，因而跨元素重复调用幂等。
   * _sanitizeElements/_sanitizeAttributes 把返回值重新绑定到 ALLOWED_TAGS/ALLOWED_ATTR，
   * 再构造 hook 事件。这里不复制 hook 数组，也不复制任意已有调用级表；身份比较只识别两种
   * 共享来源，避免每个节点都重新复制表而丢掉本次此前 hook 的成员修改。
   *
   * @param hookList - 当前事件的 upon hook 数组。
   * @param set - 当前 `ALLOWED_TAGS` 或 `ALLOWED_ATTR` 绑定。
   * @param defaultSet - 当前实例的 `DEFAULT_ALLOWED_*` 集合。
   * @param setConfigSet - `setConfig()` 捕获的集合；未启用时为 null。
   * @returns 必要时创建的调用级 clone，否则返回原集合。
   */
  const _forkSharedAllowlist = function <T extends Record<string, any>>(
    hookList: unknown[],
    set: T,
    defaultSet: T,
    setConfigSet: T | null
  ): T {
    if (hookList.length === 0) {
      return set;
    }

    return set === defaultSet || set === setConfigSet ? clone(set) : set;
  };

  /**
   * 对一个迭代节点执行元素级 hook、结构威胁、名称与 namespace 判定。
   *
   * 顺序不变量：before hook → detach/clobber → upon hook → 再次 detach → mXSS/结构威胁 →
   * tag allowlist → namespace → fallback 标签 → 模板文本 → after hook。删除分支通常不触发
   * after hook；通过 custom-element 策略保留的节点会显式补发。hook 主动 detach 的节点不记入
   * DOMPurify.removed，但配置 IN_PLACE 时会立即中和其普通子树。
   *
   * 主 walk 与 fragment walk 都调用此函数，并无条件继续 _sanitizeAttributes；返回 true
   * 不会使调用方跳过当前节点的属性处理。只有名称拒绝路径有 KEEP_CONTENT 提升，结构或
   * namespace 拒绝直接交给 _forceRemove。before hook 后先探测 clobber，避免随后依赖的
   * 节点名、文本和结构读取被 form 命名成员遮蔽；upon hook 对允许表的成员修改则在名称判定
   * 前生效。hook 可改树，但不能通过给事件 tagName/allowedTags 换值来重绑定此函数的局部名或表。
   *
   * @protect nodeName
   * @protect textContent
   * @protect removeChild
   * @param currentNode - 要判断能否保留的当前迭代节点。
   * @param root - 当前 walk 根；根本身即使 parentless 也必须继续净化。
   * @returns 节点已删除或已被 hook detach 时返回 `true`，保留时返回 `false`。
   */
  // eslint-disable-next-line complexity
  /** 净化节点结构、名称和 namespace。 */ const _sanitizeElements = function (
    currentNode: any,
    root: Node
  ): boolean {
    /* 元素判定前 hook 可观察并修改当前树。 */
    _executeHooks(hooks.beforeSanitizeElements, currentNode, null);

    /* 被 before hook detach 的非根节点不再进入后续元素判定；配置 IN_PLACE 时先清理其普通后代。 */
    if (currentNode !== root && getParentNode(currentNode) === null) {
      if (IN_PLACE) {
        _neutralizeSubtree(currentNode);
      }

      return true;
    }

    /* 此类 clobbered form 无法可信读取或写入，整节点删除。 */
    if (_isClobbered(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }

    /* 从缓存 getter 读取节点名，并按 parser 模式规范化。 */
    const tagName = transformCaseFunc(
      getNodeName ? getNodeName(currentNode) : currentNode.nodeName
    );

    /* 主 walk 前的 clone guard 采样后，before hook 仍可能延迟安装 uponSanitizeElement；此时
       ALLOWED_TAGS 可能仍引用共享集合。暴露给新 hook 前再次按需分叉，关闭时序缝隙。 */
    ALLOWED_TAGS = _forkSharedAllowlist(
      hooks.uponSanitizeElement,
      ALLOWED_TAGS,
      DEFAULT_ALLOWED_TAGS,
      SET_CONFIG_ALLOWED_TAGS
    );

    /* 此处 upon hook 可在本次调用内扩展 allowedTags。 */
    _executeHooks(hooks.uponSanitizeElement, currentNode, {
      tagName,
      allowedTags: ALLOWED_TAGS,
    });

    /* 此处 upon hook 可主动 detach 当前非根节点（issue #469）。确认它已无父节点后，停止元素判定，
       避免把 hook 的删除再次交给 _forceRemove 并触发 parentless 错误。它不进入 removed 记录，
       因而配置 IN_PLACE 时立即清理其普通后代。walk 根即使 detached 也必须继续净化。 */
    if (currentNode !== root && getParentNode(currentNode) === null) {
      if (IN_PLACE) {
        _neutralizeSubtree(currentNode);
      }

      return true;
    }

    /* 结构威胁不受 allowlist 扩展影响，命中即删除。 */
    if (_isUnsafeNode(currentNode, tagName)) {
      _forceRemove(currentNode);
      return true;
    }

    /* FORBID_TAGS 优先；否则需通过函数型 ADD_TAGS 或元素 allowlist。 */
    if (
      FORBID_TAGS[tagName] ||
      (!(
        EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function &&
        EXTRA_ELEMENT_HANDLING.tagCheck(tagName)
      ) &&
        !ALLOWED_TAGS[tagName])
    ) {
      const removed = _sanitizeDisallowedNode(currentNode, tagName, root);

      /* 由 custom-element 规则放行的早退也触发 afterSanitizeElements；主循环随后净化属性，
         本函数中的 namespace/fallback 判定则已跳过（GHSA-c2j3-45gr-mqc4）。 */
      if (removed === false) {
        _executeHooks(hooks.afterSanitizeElements, currentNode, null);
      }

      return removed;
    }

    /* 使用缓存 Node.prototype.nodeType 跨 realm 判断 Element（GHSA-hpcv-96wg-7vj8）。
       `instanceof Element` 会对 foreign-realm 节点返回 false，导致非法 namespace 完全绕过检查。 */
    const nt = getNodeType ? getNodeType(currentNode) : currentNode.nodeType;
    if (nt === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }

    /* 删除旧浏览器 raw-text fallback 标签中的闭合片段，阻断重解析 mXSS。 */
    if (
      (tagName === 'noscript' ||
        tagName === 'noembed' ||
        tagName === 'noframes') &&
      regExpTest(EXPRESSIONS.FALLBACK_TAG_CLOSE, currentNode.innerHTML)
    ) {
      _forceRemove(currentNode);
      return true;
    }

    /* NodeIterator 的文本节点先做逐节点模板清理；返回前仍有 normalize 后的最终清理。 */
    if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
      /* 读取并替换当前文本节点内容。 */
      const content = _stripTemplateExpressions(currentNode.textContent);

      if (currentNode.textContent !== content) {
        arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
        currentNode.textContent = content;
      }
    }

    /* 到达此处的普通节点触发 after hook；该 hook 的修改不会重新接受元素判定。 */
    _executeHooks(hooks.afterSanitizeElements, currentNode, null);

    return false;
  };

  /**
   * 按互斥分支判断属性能否保留，并明确区分需做 URI 校验与直接放行的名称类别。
   *
   * `_sanitizeAttributes` 在 hook、XML/animation 屏障与模板替换后调用本函数；公开
   * `isValidAttribute` 也直接调用，因此 `value` 不一定已经 trim 或经过前述处理。本函数只读
   * 当前闭包规则，不验证承载元素本身，不写 DOM，也不调用 attribute hook 或 Trusted Types。
   *
   * `FORBID_ATTR`、结构型 patch linkage 与 clobbering 规则先于所有放行条件。data-*、aria-*，
   * 以及 `CUSTOM_ELEMENT_HANDLING` 在 `!nameIsPermitted` 分支认可的属性会结束 else-if 链，并在
   * 函数尾直接返回 `true`，不进入通用 URI 检查。只有 `ALLOWED_ATTR`/ADD_ATTR 等形成的
   * `nameIsPermitted` 路径继续检查 URI-safe 属性、scheme、data URI、unknown protocol 或空值。
   * URI 正则和 unknown-protocol 检查先删除 ATTR_WHITESPACE；媒体 data URI 分支则对传入值
   * 做区分大小写的 `data:` 前缀检查。规则或用户谓词抛错时直接交还调用者处理。
   *
   * @param lcTag - 承载属性的规范化标签名。
   * @param lcName - 规范化属性名。
   * @param value - 当前待检查的值；公开 API 传入的原值不会在本函数中 trim。
   * @returns 此属性通过当前名称和值分支时返回 `true`；不代表完整属性净化已执行。
   */
  // eslint-disable-next-line complexity
  /** 检查属性名称和值的准入。 */ const _isValidAttribute = function (
    lcTag: string,
    lcName: string,
    value: string
  ): boolean {
    /* FORBID_ATTR 必须始终胜出，即使 ADD_ATTR 谓词返回 true。 */
    if (FORBID_ATTR[lcName]) {
      return false;
    }

    /* SAFE_FOR_XML 开启时，patchsrc 以及非 label/output 元素上的 for 优先拒绝，
       显式 ADD_ATTR 或 custom-element 属性谓词也不能在本函数中放行它们。
       这与 IN_PLACE 预扫采用相同名称规则；PI 则由 _isUnsafeNode 无条件拒绝。
       关联提案：https://github.com/WICG/declarative-partial-updates */
    if (SAFE_FOR_XML && lcName === 'patchsrc') {
      return false;
    }

    if (
      SAFE_FOR_XML &&
      lcName === 'for' &&
      lcTag !== 'label' &&
      lcTag !== 'output'
    ) {
      return false;
    }

    /* 拒绝会遮蔽 document 或 form 内建成员的 id/name 值。 */
    if (
      SANITIZE_DOM &&
      (lcName === 'id' || lcName === 'name') &&
      (value in document || value in formElement)
    ) {
      return false;
    }

    /* 名称谓词在 data/aria 分支之前计算，所以即使后续直接放行，其副作用或异常仍会发生。 */
    const nameIsPermitted =
      ALLOWED_ATTR[lcName] ||
      (EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function &&
        EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag));

    /* 以下为单一 else-if 链：一旦 data/aria/custom-element 分支命中，便跳到函数尾返回 true。
       对 data-* 名称要求连字符后至少一个字符且兼容 XML；其值不解释为 URI，无需 scheme 检查。
       规范：https://html.spec.whatwg.org/multipage/dom.html#embedding-custom-non-visible-data-with-the-data-*-attributes
       兼容性：https://html.spec.whatwg.org/multipage/infrastructure.html#xml-compatible */
    if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR, lcName)) {
      // 该名称类别直接放行，保留 value，不进入下面的 URI 分支。
    } else if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR, lcName)) {
      // 该名称类别直接放行，保留 value，不进入下面的 URI 分支。
      /* 其他名称必须通过 allowlist、ADD_ATTR 或 custom-element 规则。 */
    } else if (!nameIsPermitted) {
      if (
        // 条件一：基本 custom-element 名称、配置的 tagNameCheck、attributeNameCheck 必须同时通过。
        (_isBasicCustomElement(lcTag) &&
          ((CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof RegExp &&
            regExpTest(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag)) ||
            (CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof Function &&
              CUSTOM_ELEMENT_HANDLING.tagNameCheck(lcTag))) &&
          ((CUSTOM_ELEMENT_HANDLING.attributeNameCheck instanceof RegExp &&
            regExpTest(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName)) ||
            (CUSTOM_ELEMENT_HANDLING.attributeNameCheck instanceof Function &&
              CUSTOM_ELEMENT_HANDLING.attributeNameCheck(lcName, lcTag)))) ||
        // 条件二：`is` 属性需显式允许 customized built-in，且其值通过 tagNameCheck。
        (lcName === 'is' &&
          CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements &&
          ((CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof RegExp &&
            regExpTest(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value)) ||
            (CUSTOM_ELEMENT_HANDLING.tagNameCheck instanceof Function &&
              CUSTOM_ELEMENT_HANDLING.tagNameCheck(value))))
      ) {
        // 此处 custom element 分支已经认可该属性；它不进入后续通用 URI 检查，函数尾直接返回 true。
      } else {
        return false;
      }
      /* `is` 分支已经用 tagNameCheck 检查 value；其他 custom-element 属性只经过名称谓词。 */
    } else if (URI_SAFE_ATTRIBUTES[lcName]) {
      // 当前 URI-safe 集合指定该属性不必检查 scheme；集合可由配置扩展。
      /* 对可能承载 URI 的属性应用默认或调用方正则。 */
    } else if (
      regExpTest(IS_ALLOWED_URI, stringReplace(value, ATTR_WHITESPACE, ''))
    ) {
      // 值通过允许 URI 正则。
      /* 允许指定媒体标签的 src/xlink:href/href 使用 data URI；script 始终排除，避免 gadget XSS。 */
    } else if (
      (lcName === 'src' || lcName === 'xlink:href' || lcName === 'href') &&
      lcTag !== 'script' &&
      stringIndexOf(value, 'data:') === 0 &&
      DATA_URI_TAGS[lcTag]
    ) {
      // 指定媒体标签允许 data URI。
      /* 显式允许未知协议时仍拒绝 script/data；用于 fb:、spotify: 等外部 protocol handler。 */
    } else if (
      ALLOW_UNKNOWN_PROTOCOLS &&
      !regExpTest(IS_SCRIPT_OR_DATA, stringReplace(value, ATTR_WHITESPACE, ''))
    ) {
      // 未知但非 script/data 的协议获准。
      /* 其他规则未命中时，只接受空字符串。 */
    } else if (value) {
      return false;
    } else {
      // 空值允许保留；属性不必属于 HTML 的布尔属性。
    }

    return true;
  };

  /**
   * HTML 规范从 valid-custom-element-name 中保留的名称集合。
   *
   * 即使调用方配置宽松的 `CUSTOM_ELEMENT_HANDLING.tagNameCheck`，这些名称也不能被当作基本
   * custom element，避免把规范已有 foreign-content 名称错误提升为扩展点。
   */
  const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
    'annotation-xml',
    'color-profile',
    'font-face',
    'font-face-format',
    'font-face-name',
    'font-face-src',
    'font-face-uri',
    'missing-glyph',
  ]);

  /**
   * 对 custom-element 标签名执行模块所需的最小结构检查。
   *
   * 元素名称拒绝分支和属性名称拒绝分支都先用它筛选基本名称，再运行调用方的名称谓词。
   * CUSTOM_ELEMENT 正则要求 ASCII 字母开头、至少一个连字符，且每个连字符后都有由点、
   * 字母、数字或下划线组成的非空片段；再排除规范保留名。它不查询 customElements 注册表，
   * 也不决定该元素的 namespace 或属性是否可保留。
   *
   * @param tagName - 待净化节点的标签名。
   * @returns 满足基本 custom-element 条件时返回 `true`。
   */
  const _isBasicCustomElement = function (tagName: string): boolean {
    return (
      !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] &&
      regExpTest(CUSTOM_ELEMENT, tagName)
    );
  };

  /**
   * 按浏览器声明的 attribute sink 类型，用活动策略包装属性值。
   *
   * `_sanitizeAttributes` 在名称和值准入后调用，随后只在值与原值不同的时候交给写回 helper。
   * 本函数询问的是规范化标签名和属性名，并未向 getAttributeType 传入元素 namespace；只有
   * 活动策略、trustedTypes 对象、查询函数同时存在且属性 namespace 为空时才查询。
   * 仅处理 getAttributeType 报告的 TrustedHTML/TrustedScriptURL。本实现不包装 namespaced
   * 属性，沿用原值。查询函数或策略抛错发生在 `_setAttributeValue` 的局部 catch 之外，交给
   * 上层 walk 的异常路径处理；它不会被转换成一次普通属性删除。相关实现背景：
   * https://bugs.chromium.org/p/chromium/issues/detail?id=1305293
   *
   * @param lcTag - 承载属性的规范化标签名。
   * @param lcName - 规范化属性名。
   * @param namespaceURI - 属性 namespace；非空时不包装。
   * @param value - 属性准入函数保留的值；data/aria/custom-element 直通分支不保证执行通用 URI 校验。
   * @returns sink 要求时返回策略生成的受信任值，否则返回原值；这里不重新检查 URI。
   */
  const _applyTrustedTypesToAttribute = function (
    lcTag: string,
    lcName: string,
    namespaceURI: string | null,
    value: string
  ): string {
    if (
      trustedTypesPolicy &&
      typeof trustedTypes === 'object' &&
      typeof trustedTypes.getAttributeType === 'function' &&
      !namespaceURI
    ) {
      switch (trustedTypes.getAttributeType(lcTag, lcName)) {
        case 'TrustedHTML': {
          return _createTrustedHTML(value);
        }

        case 'TrustedScriptURL': {
          return _createTrustedScriptURL(value);
        }

        default: {
          break;
        }
      }
    }

    return value;
  };

  /**
   * 把修改后的属性值写回元素，并在写入后重新探测 DOM clobbering。
   *
   * namespaced 属性用 `setAttributeNS`，其他属性用 `setAttribute`。写入可能改变 form 的命名访问；
   * 命中时删除整个元素，否则无条件弹出 `removed` 的最后一项。SANITIZE_NAMED_PROPS 路径此前确有
   * `_removeAttribute` 与它配对，但 trim/template/hook 改值触发写回时未必有配对记录，因此
   * `removed` 只能用于诊断，不能作为安全判据。写入抛错则删除属性。
   *
   * `_sanitizeAttributes` 只在处理值不同于最初属性值时调用。catch 同时覆盖 setter、写后
   * clobber 检查和整节点删除；补救 `_removeAttribute` 自身若抛错，仍会传播到上层 walk。
   * 本函数没有成功返回值，调用者随后继续访问 live 属性集合。
   *
   * @param currentNode - 承载属性的元素。
   * @param name - 元素上原始属性名。
   * @param namespaceURI - 属性 namespace；可为空。
   * @param value - hook、模板与 Trusted Types 处理后的新值。
   */
  const _setAttributeValue = function (
    currentNode: Element,
    name: string,
    namespaceURI: string | null,
    value: string
  ): void {
    try {
      if (namespaceURI) {
        currentNode.setAttributeNS(namespaceURI, name, value);
      } else {
        /* 属性 namespaceURI 为空时采用普通 setAttribute。 */
        currentNode.setAttribute(name, value);
      }

      if (_isClobbered(currentNode)) {
        _forceRemove(currentNode);
      } else {
        arrayPop(DOMPurify.removed);
      }
    } catch (_) {
      _removeAttribute(name, currentNode);
    }
  };

  /**
   * 反向遍历一个元素的 live 属性集合，执行 hook、硬屏障、名称和值校验及必要写回。
   *
   * beforeSanitizeAttributes 在属性存在性检查前执行；随后反向访问当前 live 属性集合。
   * 主 walk 与 fragment walk 都会调用，即使刚才的元素判定已经删除了当前节点。获取属性后
   * 仅对有 attributes 且未 clobber 的节点继续；这里没有把集合复制为快照。删除当前属性能
   * 保持尚未访问的索引稳定，但 hook 自行增删属性仍可改变后续访问，异常由上层 walk 接收。
   * 顺序不变量：hook → named-props 前缀 → XML/animation 硬屏障 → force/keep flag → 自闭合规则
   * →模板清理→ `_isValidAttribute` → Trusted Types → 写回。`forceKeepAttr` 是受信任逃生口，
   * 可跳过它之后的校验，也不把 hook 的 attrValue 写回；此前 named-props 处理若已删去旧属性，
   * force 分支不会再创建新属性。每个元素复用同一事件对象；修改 attrName 不会替换已捕获的
   * 名称，替换 allowedAttributes 字段也不会重绑闭包集合。成员修改影响仍引用该表的后续属性；
   * 若 hook 重入已经重绑闭包，事件仍持有原表。遍历完成后才触发 after hook，其新增属性不再验证。
   *
   * @protect attributes
   * @protect nodeName
   * @protect removeAttribute
   * @protect setAttribute
   *
   * @param currentNode - 当前迭代节点；非元素因没有 attributes 而提前返回。
   */
  const _sanitizeAttributes = function (currentNode: Element): void {
    /* 此处 before hook 先执行，因此也可能观察到没有属性的 Text/Comment 等节点。 */
    _executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);

    const { attributes } = currentNode;

    /* 无属性通常表示非元素；clobbered form 的属性读取不可信，同样停止。 */
    if (!attributes || _isClobbered(currentNode)) {
      return;
    }

    /* 与 uponSanitizeElement 相同：before hook 可能延迟安装 upon hook，暴露共享集合前再次分叉。 */
    ALLOWED_ATTR = _forkSharedAllowlist(
      hooks.uponSanitizeAttribute,
      ALLOWED_ATTR,
      DEFAULT_ALLOWED_ATTR,
      SET_CONFIG_ALLOWED_ATTR
    );

    /* 一个元素共享一个事件对象；每轮重置值和决策，allowlist 引用保持本轮捕获的集合。 */
    const hookEvent = {
      attrName: '',
      attrValue: '',
      keepAttr: true,
      allowedAttributes: ALLOWED_ATTR,
      forceKeepAttr: undefined,
    };
    /* 只捕获初始长度，后续按索引读取 live 集合；并非保存属性对象的快照。 */
    let l = attributes.length;
    const lcTag = transformCaseFunc(currentNode.nodeName);

    /* 反向遍历 live NamedNodeMap，使删除当前属性不会移动尚未访问的索引。 */
    while (l--) {
      const attr = attributes[l];
      const { name, namespaceURI, value: attrValue } = attr;
      const lcName = transformCaseFunc(name);

      const initValue = attrValue;
      let value = name === 'value' ? initValue : stringTrim(initValue);

      /* 复用事件对象，但每次重置名称、值与决策字段；hook 可改值或 keep flag。 */
      hookEvent.attrName = lcName;
      hookEvent.attrValue = value;
      hookEvent.keepAttr = true;
      hookEvent.forceKeepAttr = undefined; // 显式暴露该可选字段，便于 hook 设置
      _executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
      value = hookEvent.attrValue;

      /* 严格 DOM Clobbering 防护：给 id/name 增加 user-content- 命名空间前缀。 */
      if (
        SANITIZE_NAMED_PROPS &&
        (lcName === 'id' || lcName === 'name') &&
        stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0
      ) {
        // 先删除旧值并记录，再在统一写回路径创建带前缀的新值。
        _removeAttribute(name, currentNode);
        // 前缀后的值仍需通过后续属性规则。
        value = SANITIZE_NAMED_PROPS_PREFIX + value;
      }
      // 已有前缀本身就是隔离边界；保持不变，保证净化幂等。

      /* SAFE_FOR_XML 下拒绝可跨属性边界闭合危险元素/注释的片段。 */
      if (
        SAFE_FOR_XML &&
        regExpTest(
          /((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i,
          value
        )
      ) {
        _removeAttribute(name, currentNode);
        continue;
      }

      /* 即使允许动画，也拒绝 attributeName 值中区分大小写的 href 片段；不是完整名称相等检查。 */
      if (lcName === 'attributename' && stringMatch(value, 'href')) {
        _removeAttribute(name, currentNode);
        continue;
      }

      /* 标志 forceKeepAttr 跳过后续准入、TT 和写回；保留此刻 DOM 状态，而非写入 hookEvent.attrValue。 */
      if (hookEvent.forceKeepAttr) {
        continue;
      }

      /* 标志 keepAttr=false 明确拒绝当前属性。 */
      if (!hookEvent.keepAttr) {
        _removeAttribute(name, currentNode);
        continue;
      }

      /* 配置关闭时，删除会触发 jQuery 3.0 mXSS 的自闭合标签片段。 */
      if (
        !ALLOW_SELF_CLOSE_IN_ATTR &&
        regExpTest(EXPRESSIONS.SELF_CLOSING_TAG, value)
      ) {
        _removeAttribute(name, currentNode);
        continue;
      }

      /* 属性值的模板表达式在 URI 校验前替换。 */
      if (SAFE_FOR_TEMPLATES) {
        value = _stripTemplateExpressions(value);
      }

      /* 进入统一属性准入；普通 allowlist 名称继续 URI 检查，data/aria/custom 分支按各自规则返回。 */
      if (!_isValidAttribute(lcTag, lcName, value)) {
        _removeAttribute(name, currentNode);
        continue;
      }

      /* 浏览器把该 sink 标为 TrustedHTML/TrustedScriptURL 时，用活动策略包装。 */
      value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);

      /* 与原值比较决定是否写回；原值未变时也已完成准入。setter 拒绝的值由 helper 尝试删除。 */
      if (value !== initValue) {
        _setAttributeValue(currentNode, name, namespaceURI, value);
      }
    }

    /* 此时 after hook 看到最终 surviving 属性；它新增的属性不会再经过本轮校验。 */
    _executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
  };

  /**
   * 用与主文档相同的元素/属性管线净化一个 shadow 或 template fragment。
   *
   * fragment 级 before/after hook 包围整个 walk；每个节点先触发 uponSanitizeShadowNode，再走
   * 元素与属性判定。NodeIterator 不进入 template.content 或可访问的 attached shadow root，故两者都需
   * 显式递归。异常不在此吞掉，由调用路径决定 copy 失败或 IN_PLACE 失败关闭。
   * 迭代器在 before hook 前创建；fragment 自身不匹配其节点掩码，逐节点 hook 只接收后代。
   * 删除节点的布尔结果不控制后续属性与 content 处理。attached-root 发现预扫和此处递归可能
   * 再次访问同一可见 shadow fragment，所以 hook 不保证每个节点只调用一次。
   *
   * @param fragment - 要递归净化的 DocumentFragment。
   */
  const _sanitizeShadowDOM = function (fragment: DocumentFragment): void {
    let shadowNode = null;
    const shadowIterator = _createNodeIterator(fragment);

    /* 此处 fragment walk 开始前 hook。 */
    _executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);

    while ((shadowNode = shadowIterator.nextNode())) {
      /* 此处 shadow 专用逐节点 hook 在通用元素/属性 hook 之前执行。 */
      _executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);

      /* 复用主元素判定管线。 */
      _sanitizeElements(shadowNode, fragment);

      /* 元素判定后复用主属性管线。 */
      _sanitizeAttributes(shadowNode);

      /* 检测 template.content。使用 nodeType 而非 realm-bound instanceof，确保 foreign-realm
         DocumentFragment 也会递归，修复 GHSA-hpcv-96wg-7vj8。 */
      if (_isDocumentFragment(shadowNode.content)) {
        _sanitizeShadowDOM(shadowNode.content);
      }

      /* 当前元素也可能承载可访问的 shadow root。虽然入口预扫会进入 template.content 寻找它们，
         fragment walk 仍在此处理当前 host；嵌套 root 因而可能经历多次净化和 hook 分发。
         nodeType guard 避免对 Text/Comment/CDATA/PI 读取 Element 的 shadowRoot getter。 */
      const shadowNodeType = getNodeType
        ? getNodeType(shadowNode)
        : shadowNode.nodeType;
      if (shadowNodeType === NODE_TYPE.element) {
        const innerSr = getShadowRoot(shadowNode);
        if (_isDocumentFragment(innerSr)) {
          _sanitizeAttachedShadowRoots(innerSr);
          _sanitizeShadowDOM(innerSr);
        }
      }
    }

    /* 此处 fragment 正常完成后 hook；异常路径不触发。 */
    _executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
  };

  /**
   * 显式发现并净化 root 下 shadowRoot getter 可读取的 attached roots。
   *
   * 默认 NodeIterator 不进入 shadow tree，因此把每个发现的 fragment 交给 `_sanitizeShadowDOM`。
   * 两条输入路径需要该预扫：IN_PLACE 输入已带 shadow root；或 DOM Node copy 的
   * importNode(dirty, true) 克隆了 clonable:true shadow root。closed root 的 getter 返回 null，
   * 因而不会由本流程发现。字符串路径没有该入口预扫。
   *
   * 发现阶段使用显式数组栈，普通后代的深度不再形成 JS 递归。fragment 净化仍可能递归调用。
   * work item 分为“继续发现节点”和“延迟净化已发现 shadow fragment”，
   * 从而先发现 shadow 内嵌套根，再净化外层 fragment。普通树和 template.content 只是寻找
   * attached roots 的通道，并不在此执行普通元素/属性净化；它们仍由后续主 walk 或 fragment
   * walk 处理。发现与净化共用当前闭包配置和 hooks，hook 修改后的状态不会在任务切换时恢复。
   *
   * @param root - 要搜索 attached shadow roots 的子树根。
   */
  const _sanitizeAttachedShadowRoots = function (root: Node): void {
    /*
     * 工作项要么继续发现一个 node，要么延迟调用 _sanitizeShadowDOM。对同一节点，实际
     * push 顺序是：逆序 light children → template.content → 延迟 shadow sanitize → shadow root walk。
     * 因 LIFO，实际执行顺序正好相反：先 walk shadow root 并发现其嵌套 shadow，再净化该 shadow，
     * 然后进入 template.content，最后按文档序处理 light children。这样外层 shadow 净化前，
     * 其中所有嵌套 shadow 已先被发现。
     */
    const stack: Array<{
      /** 发现任务的节点；延迟任务中为空。 */
      node: Node | null;
      /* prettier-ignore */
      /** 延迟净化的片段；发现任务中为空。 */
      shadow: DocumentFragment | null
    }> = [{ node: root, shadow: null }];

    while (stack.length > 0) {
      const item = stack.pop();

      /* 延迟任务：shadow 子树的 attached-root 发现完成后，再运行通用 fragment 净化。 */
      if (item.shadow) {
        _sanitizeShadowDOM(item.shadow);
        continue;
      }

      const node = item.node;
      const nodeType = getNodeType ? getNodeType(node) : (node as any).nodeType;
      const isElement = nodeType === NODE_TYPE.element;

      /* 对 light children 先逆序 push，因而最终仍按文档序执行；push 时按索引取快照，避免后续 hook
         detach sibling 改变待处理引用。它们最早 push，所以会在 shadow 与 template.content 后执行。 */
      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push({ node: childNodes[i], shadow: null });
        }
      }

      /* 对 template.content 在 light children 之后 push，故 LIFO 下先于 light children 执行。
         NodeIterator 不进入 template fragment，只对真实 template 显式加入工作栈。 */
      if (isElement) {
        const rootName = getNodeName ? getNodeName(node) : null;
        if (
          typeof rootName === 'string' &&
          transformCaseFunc(rootName) === 'template'
        ) {
          const content = (node as HTMLTemplateElement).content;
          if (_isDocumentFragment(content)) {
            stack.push({ node: content, shadow: null });
          }
        }
      }

      /* 将 shadow root 最后 push、最先执行：先 walk 其子树，再执行延迟净化。用 nodeType 而非
         realm-bound instanceof DocumentFragment，避免静默跳过 iframe 等 foreign-realm shadow root，
         修复 GHSA-hpcv-96wg-7vj8。 */
      if (isElement) {
        const sr = getShadowRoot(node);
        if (_isDocumentFragment(sr)) {
          /* 先 push 延迟净化，再 push shadow walk；LIFO 保证嵌套 shadow 先发现，本层后净化。 */
          stack.push({ node: null, shadow: sr }, { node: sr, shadow: null });
        }
      }
    }
  };

  /**
   * 净化字符串或 DOM Node，并按配置返回字符串、TrustedHTML、DOM 副本或原地修改的输入。
   *
   * 输入归一、支持检查和配置/allowlist 隔离后，按 IN_PLACE、Node copy 或字符串 parse 选择根。
   * 纯文本可提前返回；其余输入经过 NodeIterator 元素/属性 walk，再按配置返回结果。
   * Node 输入还会在主 walk 前处理可访问的 attached shadow roots。
   * 成功的原地路径最先返回原输入对象；其余路径先选 RETURN_DOM/RETURN_DOM_FRAGMENT，再选
   * 字符串或 RETURN_TRUSTED_TYPE。WHOLE_DOCUMENT 决定解析根和序列化范围，doctype 还需要
   * 单独允许。DOM 结果可在 declarative-shadow 属性放行时被深复制回创建实例的原文档。
   *
   * removed 在配置和 allowlist 克隆成功后重置。原地根预检失败、attached-root 预扫异常和
   * 主 walk 异常各有清理路径；只有主 walk catch 还遍历 removed 中的离树节点。输入归一、
   * 配置解析、patch 预处理、Node 导入、FORCE_BODY 删除以及返回前模板清理/序列化/签名
   * 都不在该 catch 内。清理也可能抛错，因此不能据此推断所有异常都恢复了同一状态。
   * 同一实例没有通用的 sanitize 重入锁：hook 内重入会重绑配置、allowlist、removed 和空输入
   * 标志，外层恢复执行时继续使用这些状态，返回时不会恢复外层快照。TT 回调只有自己的深度保护。
   *
   * @param dirty - 待净化的 markup 或任意 realm 的 DOM Node；非 Node 对象先字符串化，falsy 值先变为哨兵。
   * @param cfg - 逐调用配置；实例处于 `setConfig()` 模式时忽略。
   * @returns 与 RETURN/IN_PLACE 配置匹配的净化结果。
   */
  // eslint-disable-next-line complexity
  DOMPurify.sanitize = function (dirty, cfg = {}) {
    /* 局部 body 是复制/解析路径的 walk 根；原地路径保持为空，最终用 dirty 自身作为根。 */
    let body = null;
    /* 导入副本与最终 DOM 返回值分别保存，避免将输入对象作为 copy 路径的净化对象。 */
    let importedNode = null;
    /* 迭代器逐次更新当前节点；返回分支决定 returnNode，二者不是净化前树的快照。 */
    let currentNode = null;
    let returnNode = null;
    /* 对 falsy 输入先变成可解析哨兵；不可提前返回，否则 RETURN_DOM 等模式会得到错误返回类型。 */
    IS_EMPTY_INPUT = !dirty;
    if (IS_EMPTY_INPUT) {
      dirty = '<!-->';
    }

    /* 非 Node 对象通过加固的转换函数字符串化；foreign-realm Node 由 `_isNode` 保留。 */
    if (typeof dirty !== 'string' && !_isNode(dirty)) {
      dirty = stringifyValue(dirty);

      if (typeof dirty !== 'string') {
        throw typeErrorCreate('dirty is not a string, aborting');
      }
    }

    /* 能力标志 isSupported=false 时直接返回已归一输入，尚未解析 cfg，也未重置上次 removed。 */
    if (!DOMPurify.isSupported) {
      return dirty;
    }

    /* 装载本次配置；持久模式恢复 pristine allowlist，并忽略逐调用 cfg。 */
    if (SET_CONFIG) {
      /* 此处 setConfig 路径跳过 _parseConfig，不会逐调用重建集合；从捕获绑定恢复，防止前次 hook
       * 修改下面创建的调用级 clone 后把状态带入本次。 */
      ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
      ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
    } else {
      _parseConfig(cfg);
    }

    /* 通过 upon hook 事件的 allowedTags/allowedAttributes 暴露集合引用。已有 upon hook 时先克隆，
     * 既允许 hook 的扩展影响本次 walk 后续元素，又阻止它永久污染后续调用或持久集合。逐调用配置
     * 已在 _parseConfig 重绑集合，持久配置刚从捕获绑定恢复；同一 guard 覆盖两条路径。 */
    if (
      hooks.uponSanitizeElement.length > 0 ||
      hooks.uponSanitizeAttribute.length > 0
    ) {
      ALLOWED_TAGS = clone(ALLOWED_TAGS);
    }

    if (hooks.uponSanitizeAttribute.length > 0) {
      ALLOWED_ATTR = clone(ALLOWED_ATTR);
    }

    /* 此刻才开启新的删除记录；归一、配置或 allowlist 克隆失败都保留旧记录。
       hook 重入可重新绑定它，因此公开数组不是外层调用独占的审计日志。 */
    DOMPurify.removed = [];

    /* 用局部值决定本次是否原地处理，不改配置中的 IN_PLACE；因此持久配置先接收字符串，
       再接收 Node 时，后一次仍会修改原节点。 */
    const inPlace = IN_PLACE && typeof dirty !== 'string' && _isNode(dirty);

    if (inPlace) {
      /* 主 walk 和根预检前先处理普通后代上的 patch 标记；规则受 SAFE_FOR_XML 门控。 */
      _neutralizePatchLinkage(dirty as Node);

      /* IN_PLACE 根无法像普通 child 一样安全移除，故先验证标签。这里只看 ALLOWED_TAGS 与
         FORBID_TAGS，不调用 ADD_TAGS/custom-element 谓词，hook 也尚未执行。nodeName 必须由缓存 getter 读取；
         form 根中名为 nodeName 的子节点可遮蔽直接属性并让根 allowlist 检查失效。 */
      const nn = getNodeName
        ? getNodeName(dirty as Node)
        : (dirty as Node).nodeName;
      if (typeof nn === 'string') {
        const tagName = transformCaseFunc(nn);
        if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
          /* 抛错前清除根属性并移走普通 children；后代属性按当前 ALLOWED_ATTR 做名称剥离。 */
          _neutralizeRoot(dirty as Node);

          throw typeErrorCreate(
            'root node is forbidden and cannot be sanitized in-place'
          );
        }
      }

      /* 对根预检 clobber。迭代删除无法 detach parentless 根：_forceRemove 最终调用的
         Element.prototype.remove() 按规范为空操作；同时 _sanitizeAttributes 会对 clobbered 节点
         提前返回，最终可能把带 event handler 的攻击者 form 原样交还应用。像 forbidden 根一样
         直接拒绝，修复 GHSA-r47g-fvhr-h676。 */
      if (_isClobbered(dirty as Element)) {
        /* 抛错前失败关闭 clobbered live 根；_neutralizeRoot 使用缓存 getter，仍可清理 form 中
           未被 clobber 的 armed 后代，例如 `<img>`。 */
        _neutralizeRoot(dirty as Node);

        throw typeErrorCreate(
          'root node is clobbered and cannot be sanitized in-place'
        );
      }

      /* 主迭代器不进入 shadow tree，故先处理可访问的 attached roots；预扫异常时，
         尝试清理原地根后再传播异常。 */
      try {
        _sanitizeAttachedShadowRoots(dirty as Node);
      } catch (error) {
        _neutralizeRoot(dirty as Node);

        throw error;
      }
    } else if (_isNode(dirty)) {
      /* Node copy 路径先创建隔离空文档并深导入输入，保留 Node 结构而不重新解析其 markup。
         输入原对象留在原树中；缓存构造器/getter 并不意味着这里另建了 foreign-realm 实例。 */
      body = _initDocument('<!---->');
      importedNode = body.ownerDocument.importNode(dirty, true);
      if (
        importedNode.nodeType === NODE_TYPE.element &&
        importedNode.nodeName === 'BODY'
      ) {
        /* BODY/HTML 自身可直接作为 walk 根；其他 Node 挂入 body。 */
        body = importedNode;
      } else if (importedNode.nodeName === 'HTML') {
        body = importedNode;
      } else {
        // eslint-disable-next-line unicorn/prefer-dom-node-append
        body.appendChild(importedNode);
      }

      /* 支持 clonable shadow root 的引擎可能连同输入深克隆该 root；主迭代器不进入其中，故预先净化。
         结构读取走缓存 getter，form 命名后代无法遮蔽 childNodes 或 shadowRoot。 */
      _sanitizeAttachedShadowRoots(importedNode);
    } else {
      /* 没有 < 且不需要 DOM、模板或完整文档时跳过解析与全部节点 hook；FORCE_BODY 单独
         开启并不阻止此快路。RETURN_TRUSTED_TYPE 仅在有活动策略时改变返回值。 */
      if (
        !RETURN_DOM &&
        !SAFE_FOR_TEMPLATES &&
        !WHOLE_DOCUMENT &&
        // eslint-disable-next-line unicorn/prefer-includes
        dirty.indexOf('<') === -1
      ) {
        return trustedTypesPolicy && RETURN_TRUSTED_TYPE
          ? _createTrustedHTML(dirty)
          : dirty;
      }

      /* 字符串 markup 进入隔离文档解析。 */
      body = _initDocument(dirty);

      /* 无解析根时按请求的返回类型给出安全空值。 */
      if (!body) {
        return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : '';
      }
    }

    /* FORCE_BODY 移除所选 body 的首个 child。字符串路径的普通情形是移除前置哨兵；
       Node copy 路径没有追加该哨兵，也会执行此删除。这里位于主 walk catch 之前。 */
    if (body && FORCE_BODY) {
      _forceRemove(body.firstChild);
    }

    /* IN_PLACE 直接遍历输入；其他路径遍历隔离文档根。 */
    const walkRoot: Node = inPlace ? (dirty as Node) : body;

    /* 此处 catch 覆盖迭代器创建、逐节点元素/属性处理以及 template fragment 递归。
       这些步骤中断时，IN_PLACE 先尝试清理原地根，再清理 removed 中已离树的节点；
       copy/string 路径直接传播错误，不返回未完成的局部 DOM。 */
    try {
      const nodeIterator = _createNodeIterator(walkRoot);
      while ((currentNode = nodeIterator.nextNode())) {
        /* 先做节点结构、名称与 namespace 判定。 */
        _sanitizeElements(currentNode, walkRoot);

        /* 即使元素函数已删除节点，也继续走属性函数；其属性仍可能需要记录或中和。 */
        _sanitizeAttributes(currentNode);

        /* 对 template.content 需显式递归。使用 nodeType 而非 realm-bound instanceof，保证
           foreign-realm fragment 也被处理，修复 GHSA-hpcv-96wg-7vj8。 */
        if (_isDocumentFragment(currentNode.content)) {
          _sanitizeShadowDOM(currentNode.content);
        }
      }
    } catch (error) {
      if (inPlace) {
        _neutralizeRoot(dirty as Node);
        /* 中止前由 _forceRemove detach 的节点已不在 root 下，_neutralizeRoot 无法触达；像成功路径
           一样遍历 removed 记录，额外中和这些原子树。 */
        arrayForEach(DOMPurify.removed, (entry) => {
          if (entry.element) {
            _neutralizeSubtree(entry.element as Node);
          }
        });
      }

      throw error;
    }

    /* IN_PLACE 成功路径必须返回输入对象本身。 */
    if (inPlace) {
      /* 记录在 removed 中的原节点已离开主树，仍由外部引用持有；返回前遍历其普通后代，删除
         不在 ALLOWED_ATTR 中的属性。这里不运行完整属性准入，也不进入 template/shadow。
         KEEP_CONTENT 提升路径之外的整节点删除同样在此处理。 */
      arrayForEach(DOMPurify.removed, (entry) => {
        if (entry.element) {
          _neutralizeSubtree(entry.element as Node);
        }
      });

      /* 最终 normalize/模板清理位于主 walk catch 外；抛错会直接阻止成功返回。 */
      if (SAFE_FOR_TEMPLATES) {
        _scrubTemplateExpressions(dirty as Element);
      }

      return dirty;
    }

    /* 非 IN_PLACE 路径按配置返回隔离 DOM、Fragment 或序列化结果。 */
    if (RETURN_DOM) {
      if (SAFE_FOR_TEMPLATES) {
        _scrubTemplateExpressions(body);
      }

      if (RETURN_DOM_FRAGMENT) {
        /* 将根的 children 移入新 fragment，返回范围不包含 body/HTML 根本身；不是再次 clone。 */
        returnNode = createDocumentFragment.call(body.ownerDocument);

        while (body.firstChild) {
          // eslint-disable-next-line unicorn/prefer-dom-node-append
          returnNode.appendChild(body.firstChild);
        }
      } else {
        returnNode = body;
      }

      if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) {
        /*
         * 当前 ALLOWED_ATTR 中 shadowroot/shadowrootmode 任一成员为真即深复制回原文档；
         * 不要求实际结果中出现该属性，也不再次运行元素、属性或 fragment hook。
         * 复制产生新节点；与直接 adopt 原对象不同，不保留 form 的 past names map 等实例状态。
         */
        returnNode = importNode.call(originalDocument, returnNode, true);
      }

      return returnNode;
    }

    /* DOM 分支已返回；此处只序列化所选根，WHOLE_DOCUMENT 包含根标签，普通模式只取其 children。 */
    let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;

    /* 完整文档模式仅在显式允许且名称通过正则时序列化 doctype。 */
    if (
      WHOLE_DOCUMENT &&
      ALLOWED_TAGS['!doctype'] &&
      body.ownerDocument &&
      body.ownerDocument.doctype &&
      body.ownerDocument.doctype.name &&
      regExpTest(EXPRESSIONS.DOCTYPE_NAME, body.ownerDocument.doctype.name)
    ) {
      serializedHTML =
        '<!DOCTYPE ' + body.ownerDocument.doctype.name + '>\n' + serializedHTML;
    }

    /* 序列化可能让跨节点片段重新相邻；字符串返回前再做一次模板表达式清理。 */
    if (SAFE_FOR_TEMPLATES) {
      serializedHTML = _stripTemplateExpressions(serializedHTML);
    }

    /* 最终签名发生在全部字符串处理之后；策略可以转换值，签名异常不触发 walk 的原地清理。 */
    return trustedTypesPolicy && RETURN_TRUSTED_TYPE
      ? _createTrustedHTML(serializedHTML)
      : serializedHTML;
  };

  /**
   * 解析并锁定实例级持久配置。
   *
   * 后续 `sanitize` 忽略逐调用 `cfg`，并在每次 walk 前从这里捕获的 pristine allowlist 恢复，
   * 使 hook 的调用内扩展不能跨调用累积。调用 `clearConfig()` 才恢复逐调用配置模式。
   * 只有 `_parseConfig` 成功后才开启 SET_CONFIG 并捕获两个集合。解析错误不会执行这三步，
   * 但解析函数已修改的其他规则绑定仍可能保留；它不是整份配置的事务提交。这里不清空 hooks
   * 或 removed，也不先净化任何输入。
   *
   * @param cfg - 要持久应用到该实例的配置。
   */
  DOMPurify.setConfig = function (cfg = {}) {
    _parseConfig(cfg);
    SET_CONFIG = true;
    SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
    SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
  };

  /**
   * 清除实例级持久配置，并解除调用方 Trusted Types 策略。
   *
   * 清空 CONFIG、持久模式和捕获的两个 allowlist，将活动策略指向已缓存的内部默认策略，
   * 并把 emptyHTML 变回普通空字符串。默认策略的解析状态仍保留，下一次 `_parseConfig` 可
   * 复用它而不重建同名策略，并重新生成对应空值。其他规则绑定在下一次解析前仍保留旧值；
   * hooks 和 removed 也不在这里重置。`isValidAttribute` 看到空 CONFIG 时同样会重建默认配置。
   */
  DOMPurify.clearConfig = function () {
    CONFIG = null;
    SET_CONFIG = false;
    SET_CONFIG_ALLOWED_TAGS = null;
    SET_CONFIG_ALLOWED_ATTR = null;

    // 解除调用方策略；默认策略对象或失败结果的缓存仍保留，供下次解析复用。见 GHSA-vxr8-fq34-vvx9。
    trustedTypesPolicy = defaultTrustedTypesPolicy;
    emptyHTML = '';
  };

  /**
   * 用当前闭包配置检查单个属性名称和值。
   *
   * `CONFIG` 尚未建立时（包括 `clearConfig()` 后）才创建默认配置；否则可能复用最近一次逐调用
   * 配置、`setConfig()` 持久配置，以及上次 hook 在该调用级 allowlist 上留下的修改。该 API
   * 直接复用 `_isValidAttribute`，不运行元素 walk、attribute hooks 或 Trusted Types 写回。
   * 它只规范化 tag/attr 大小写，原样传入 value：没有普通属性 walk 的 trim、XML/animation
   * 屏障、模板替换或 named-props 前缀步骤，也不判断 tag 本身是否允许。返回 true 只表示
   * 这次名称和值判定通过，不能代替 `sanitize`。默认配置解析或名称/值谓词的错误直接传播。
   *
   * @param tag - 承载属性的标签名。
   * @param attr - 属性名。
   * @param value - 待验证属性值。
   * @returns 属性在当前配置下可保留时返回 `true`。
   */
  DOMPurify.isValidAttribute = function (tag, attr, value) {
    /* CONFIG 尚未建立时（包括 clearConfig 后）先创建默认共享配置状态。 */
    if (!CONFIG) {
      _parseConfig({});
    }

    const lcTag = transformCaseFunc(tag);
    const lcName = transformCaseFunc(attr);
    return _isValidAttribute(lcTag, lcName, value);
  };

  /**
   * 向已知 entry point 追加一个 hook。
   *
   * 非函数或非 HooksMap 自有键静默忽略；own-property 检查阻止 `__proto__` 等键把数组写入
   * Object.prototype。hook 按注册顺序执行。
   * 同一函数可重复注册。追加发生在当前数组上；已开始的 forEach 分发固定初始长度，新增项
   * 要到下一次分发才会执行，之后的节点可能已经使用它。
   *
   * @param entryPoint - HooksMap 中的合法 hook 名。
   * @param hookFunction - 要追加的回调。
   */
  DOMPurify.addHook = function (
    entryPoint: keyof HooksMap,
    hookFunction: HookFunction
  ) {
    if (typeof hookFunction !== 'function') {
      return;
    }

    /* 未知键（如 __proto__）会沿原型链取得非 hook 值，arrayPush 随后可能写入 Object.prototype；
     * 只接受 hook map 的自有键。 */
    if (!objectHasOwnProperty(hooks, entryPoint)) {
      return;
    }

    arrayPush(hooks[entryPoint], hookFunction);
  };

  /**
   * 从指定 entry point 移除一个 hook。
   *
   * 提供 `hookFunction` 时移除最后一个引用相同的回调；省略时弹出最后注册项。未知键或未找到
   * 回调返回 `undefined`。
   * 这会原地 splice/pop 当前数组；分发中的 forEach 仍持有该数组，移动的索引会影响尚未
   * 执行的回调。它与 removeHooks 的整体数组替换有不同的当前分发行为。
   *
   * @param entryPoint - HooksMap 中的合法 hook 名。
   * @param hookFunction - 可选的目标回调。
   * @returns 实际移除的回调；不存在时为 `undefined`。
   */
  DOMPurify.removeHook = function (
    entryPoint: keyof HooksMap,
    hookFunction: HookFunction
  ) {
    if (!objectHasOwnProperty(hooks, entryPoint)) {
      return undefined;
    }

    if (hookFunction !== undefined) {
      const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);

      return index === -1
        ? undefined
        : arraySplice(hooks[entryPoint], index, 1)[0];
    }

    return arrayPop(hooks[entryPoint]);
  };

  /**
   * 清空指定 entry point 的全部 hooks；未知键静默忽略。
   *
   * 通过替换数组清空注册表；已经开始的分发仍持有旧数组并继续，后续分发读取新的空数组。
   * 不改变其他 entry point，也不恢复 hook 已修改的 DOM、事件对象或配置。
   *
   * @param entryPoint - HooksMap 中的合法 hook 名。
   */
  DOMPurify.removeHooks = function (entryPoint: keyof HooksMap) {
    if (!objectHasOwnProperty(hooks, entryPoint)) {
      return;
    }

    hooks[entryPoint] = [];
  };

  /**
   * 用全新的 HooksMap 清除实例的全部注册项。
   *
   * 已开始的分发继续持有各自旧数组；后续分发才读到新 map。它只改变 hook 注册表，
   * 不恢复 hook 之前修改的 DOM、配置或 allowlist 成员。
   */
  DOMPurify.removeAllHooks = function () {
    hooks = _createHooksMap();
  };

  return DOMPurify;
}

/** 默认导出绑定当前全局 Window 的实例；无浏览器全局时导出可接收 Window 的降级工厂。 */
export default createDOMPurify();
