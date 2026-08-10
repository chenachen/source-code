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

/** 返回当前全局 `window`；非浏览器环境返回 `null`，由工厂进入降级路径。 */
const getGlobal = function (): WindowLike {
  return typeof window === 'undefined' ? null : window;
};

/**
 * 创建仅供模块内部使用的恒等 Trusted Types 策略。
 *
 * 策略不改变输入：既会在 parse/walk 前包装待解析的 dirty HTML，也会包装最终输出或属性值，
 * 本身绝不是净化器。策略名可由加载脚本的 `data-tt-policy-suffix` 隔离；浏览器不支持
 * Trusted Types 或创建失败时返回 `null`，让调用方退回普通字符串。此函数不得导出，
 * 否则外部代码可能误把恒等策略当作安全边界。
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
    // 创建失败通常表示同名 DOMPurify 策略已存在；跳过策略，仅在页面强制 TT 时才会影响后续写入。
    console.warn(
      'TrustedTypes policy ' + policyName + ' could not be created.'
    );
    return null;
  }
};

/** 为一个 DOMPurify 实例创建完整且互不共享的 hook 数组集合。 */
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
    /** 合并用户增量前要复制的只读基础集合。 */
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
 * getter，避免净化期间被 DOM clobbering 改写。无可用 DOM 时返回仅可继续充当工厂的
 * `isSupported=false` 对象；有效 DOM 下再安装完整净化 API。
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
   * 最近一次越过支持检查、配置解析和 allowlist 隔离阶段的 `sanitize` 删除记录。
   *
   * 重置发生在这些阶段成功之后；更早的输入异常、不支持早退或配置异常会保留旧记录。
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

  let { document } = window;

  /** 调用方 realm 的原始文档；DOM 返回路径需要用它重新导入结果。 */
  const originalDocument = document;
  const currentScript: HTMLScriptElement =
    originalDocument.currentScript as HTMLScriptElement;
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

  const ElementPrototype = Element.prototype;

  // 通过目标 realm 的原型链缓存 getter/方法；后续读取不经过元素自有属性，抵御 form 命名属性遮蔽。
  const cloneNode = lookupGetter(ElementPrototype, 'cloneNode');
  const remove = lookupGetter(ElementPrototype, 'remove');
  const getNextSibling = lookupGetter(ElementPrototype, 'nextSibling');
  const getChildNodes = lookupGetter(ElementPrototype, 'childNodes');
  const getParentNode = lookupGetter(ElementPrototype, 'parentNode');
  const getShadowRoot = lookupGetter(ElementPrototype, 'shadowRoot');
  const getAttributes = lookupGetter(ElementPrototype, 'attributes');
  const getNodeType =
    Node && Node.prototype ? lookupGetter(Node.prototype, 'nodeType') : null;
  const getNodeName =
    Node && Node.prototype ? lookupGetter(Node.prototype, 'nodeName') : null;
  const getOwnerDocument =
    Node && Node.prototype
      ? lookupGetter(Node.prototype, 'ownerDocument')
      : null;

  // 关于 issue #47：createHTMLDocument 产生的新文档会继承 Web Components registry；而规范要求
  // template 内容的 owner document 使用空 registry。改用该文档，防止页面已注册 custom element
  // 在净化用的隔离 DOM 中触发生命周期反应。
  if (typeof HTMLTemplateElement === 'function') {
    const template = document.createElement('template');
    if (template.content && template.content.ownerDocument) {
      document = template.content.ownerDocument;
    }
  }

  let trustedTypesPolicy;
  let emptyHTML = '';

  // 实例内部默认 Trusted Types 策略最多解析一次，因为同一 realm 中重名策略会抛错。
  // 它是唯一允许跨配置并在 clearConfig() 后继续缓存的策略；调用方策略不得获得该生命周期。
  let defaultTrustedTypesPolicy;
  let defaultTrustedTypesPolicyResolved = false;

  // 记录当前是否正在调用配置策略的 createHTML/createScriptURL。调用方策略若在回调内再次调用
  // DOMPurify.sanitize（#1422），会无限重入同一策略；两个回调共享计数器并在首次重入时快速失败。
  let IN_TRUSTED_TYPES_POLICY = 0;
  /** 检测调用方 Trusted Types 策略对 `sanitize` 的递归重入，并以明确错误快速失败。 */
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
   * 无论成功、失败还是环境不支持，都只尝试一次：成功后重建会因策略重名抛错，失败后也不应在
   * 每次解析时重复产生告警和开销。
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

  const {
    implementation,
    createNodeIterator,
    createDocumentFragment,
    getElementsByTagName,
  } = document;
  const { importNode } = originalDocument;

  let hooks = _createHooksMap();

  /**
   * 标记当前浏览器是否具备运行完整 DOMPurify 所需的原生能力。
   */
  DOMPurify.isSupported =
    typeof entries === 'function' &&
    typeof getParentNode === 'function' &&
    implementation &&
    implementation.createHTMLDocument !== undefined;

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

  let { IS_ALLOWED_URI } = EXPRESSIONS;

  /** 下方集合定义默认安全元素和属性；新增成员会扩大安全边界，删除成员只会收紧输出。 */

  /** 当前调用实际使用的元素 allowlist；解析配置时重新绑定，hook 执行前按需克隆。 */
  let ALLOWED_TAGS = null;
  /** HTML、SVG、SVG Filter、MathML 与文本节点组成的实例默认元素集合。 */
  const DEFAULT_ALLOWED_TAGS = addToSet({}, [
    ...TAGS.html,
    ...TAGS.svg,
    ...TAGS.svgFilters,
    ...TAGS.mathMl,
    ...TAGS.text,
  ]);

  /** 当前调用实际使用的属性 allowlist；名称获准后仍须通过属性值安全检查。 */
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
   * `tagNameCheck` 与 `attributeNameCheck` 接受正则或谓词；默认均为空，因而不额外放行
   * custom element/attribute。`allowCustomizedBuiltInElements` 只有在 `is` 值也通过
   * `tagNameCheck` 时才允许 customized built-in，默认关闭。
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

  /** 显式禁止的元素集合；优先级高于 `ALLOWED_TAGS`、`ADD_TAGS` 与 custom-element 策略。 */
  let FORBID_TAGS = null;

  /** 显式禁止的属性集合；优先级高于 `ALLOWED_ATTR`、`ADD_ATTR` 与 custom-element 策略。 */
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

  /** 是否按 ARIA 名称规则额外放行 aria-* 属性。 */
  let ALLOW_ARIA_ATTR = true;

  /** 是否按 data-* 名称规则额外放行自定义数据属性。 */
  let ALLOW_DATA_ATTR = true;

  /** 是否允许非脚本、非 data 的未知 URI scheme。 */
  let ALLOW_UNKNOWN_PROTOCOLS = false;

  /** 是否允许属性值中的自闭合标签片段；关闭可规避 jQuery 3.0 的 mXSS 场景。 */
  let ALLOW_SELF_CLOSE_IN_ATTR = true;

  /** 是否去除 data 属性及 Mustache、ERB、模板字面量表达式，使结果适配常见模板引擎。 */
  let SAFE_FOR_TEMPLATES = false;

  /** 是否启用 XML/foreign-content 结构防护，包括危险注释、mXSS canary 与 patch linkage。 */
  let SAFE_FOR_XML = true;

  /** 是否保留并返回包含 `<html>` 的完整文档结构。 */
  let WHOLE_DOCUMENT = false;

  /** 标记实例是否进入 `setConfig()` 持久配置模式；该模式会忽略逐调用配置。 */
  let SET_CONFIG = false;

  /*
   * `setConfig()` 时捕获的 pristine allowlist 绑定。持久配置路径在每次 walk 的 hook
   * clone guard 之前恢复它们，确保 hook 在一次调用中的扩展不会带入下一次调用；
   * 调用 setConfig 前为 null，clearConfig 后重置。
   */
  let SET_CONFIG_ALLOWED_TAGS = null;
  let SET_CONFIG_ALLOWED_ATTR = null;

  /** 是否用前置哨兵强制所有元素进入 body，避免解析器把 style/script 等移动到 head。 */
  let FORCE_BODY = false;

  /** 是否返回 DOM：通常为 body；`WHOLE_DOCUMENT` 下为 html，而非字符串或 TrustedHTML。 */
  let RETURN_DOM = false;

  /** 是否把净化后 body 的 children 移入并返回 `DocumentFragment`；该选项隐含 `RETURN_DOM`。 */
  let RETURN_DOM_FRAGMENT = false;

  /** 是否在活动策略可用时返回 TrustedHTML；无策略或不支持 Trusted Types 时仍返回字符串。 */
  let RETURN_TRUSTED_TYPE = false;

  /** 是否拒绝会与 document/form 内建成员冲突的 `id`、`name` 值。 */
  let SANITIZE_DOM = true;

  /*
   * 通过隔离命名属性与 JS 变量的命名空间提供更严格的 DOM Clobbering 防护，覆盖以下
   * HTML/DOM 规范机制：
   *
   *   - Window 命名访问（§7.3.3）
   *   - DOM Tree Accessors（§3.1.5）
   *   - Form 父子关系（§4.10.3）
   *   - Iframe srcdoc / Nested WindowProxies (§4.8.5)
   *   - HTMLCollection (§4.2.10.2)
   *
   * 实现方式：给 `id`、`name` 统一增加固定前缀 `user-content-`。
   */
  let SANITIZE_NAMED_PROPS = false;
  /** 严格命名属性隔离使用的幂等前缀。 */
  const SANITIZE_NAMED_PROPS_PREFIX = 'user-content-';

  /** 删除不允许元素时是否把其 children 提升到父节点。 */
  let KEEP_CONTENT = true;

  /** Node 输入是否直接修改原树，而非导入隔离文档并返回副本。 */
  let IN_PLACE = false;

  /** 按 HTML、SVG、SVG Filter、MathML 类别重建 allowlist 的 profile 配置。 */
  let USE_PROFILES: UseProfilesConfig | false = {};

  /** 即使 `KEEP_CONTENT=true`，删除这些元素时也必须连同内容丢弃。 */
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
    // 在 customizable <select> 中，UA 会把选中 <option> 的子树（包括 on* handler）克隆到
    // <selectedcontent>；删除操作改变当前 option/selectedcontent 时，即使在隔离 DOMParser
    // 文档中也会同步重新镜像。若删除时提升其 children，会在 walk 前方重新插入镜像目标，
    // 引擎随即回填并形成 DoS/输出放大循环。直接丢弃重复内容可打断级联；原 option 会单独净化。
    // 证据：campaign-3 F1/F6。
    'selectedcontent',
    'style',
    'svg',
    'template',
    'thead',
    'title',
    'video',
    'xmp',
  ]);

  /** 当前允许在 src/href 类属性中使用 data URI 的媒体元素集合。 */
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

  /** 当前无需执行 URI scheme 检查的惰性属性集合。 */
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
  /** 标记原始输入是否为空，用于 fallback parser 写入正确类型的空值。 */
  let IS_EMPTY_INPUT = false;

  /** 当前允许出现的 namespace 查找集合。 */
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

  /** 默认允许切换到 HTML 解析规则的通用 integration point。 */
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
  /** 与 parser 媒体类型配套的配置名规范化函数。 */
  let transformCaseFunc: null | Parameters<typeof addToSet>[2] = null;

  /** 传给 hooks 的冻结配置快照；`setConfig` 模式下跨调用保持。 */
  let CONFIG: Config | null = null;

  /* 下方开始进入净化实现；修改顺序可能改变安全不变量。 */
  /* ____________________________________________ */

  /** 用于判断 `id`/`name` 是否会 clobber form 内建成员的探针元素。 */
  const formElement = document.createElement('form');

  /** 判断 Custom Elements 配置项是否为可执行谓词或正则。 */
  const isRegexOrFunction = function (
    testValue: unknown
  ): testValue is Function | RegExp {
    return testValue instanceof RegExp || testValue instanceof Function;
  };

  /**
   * 解析并冻结一次配置，把所有闭包状态重建为本次净化使用的值。
   *
   * 配置先复制到无原型对象，随后按 parser 模式构建 allowlist、合并 profile/增量规则，
   * 最后解析 Trusted Types 策略。`setConfig()` 复用该状态；逐调用模式则每次重新解析，
   * 防止函数规则、集合写入或调用方对象变更跨调用泄漏。
   *
   * @param cfg - 可选配置字面量；非对象值按空配置处理。
   */
  // eslint-disable-next-line complexity
  /** 执行上述完整配置解析流程。 */ const _parseConfig = function (
    cfg: Config = {}
  ): void {
    if (CONFIG && CONFIG === cfg) {
      return;
    }

    /* 非对象配置不可信，统一降级为空配置。 */
    if (!cfg || typeof cfg !== 'object') {
      cfg = {};
    }

    /* 克隆为无原型对象，隔离调用方后续篡改与原型污染。 */
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

    /* 先从默认集合或显式集合重建所有配置状态。 */
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

    /* 配置 profile 从文本节点集合开始重建 allowlist，因此覆盖显式 ALLOWED_TAGS。 */
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

    /* KEEP_CONTENT 需要保留提升后的文本节点，因此显式允许 #text。 */
    if (KEEP_CONTENT) {
      ALLOWED_TAGS['#text'] = true;
    }

    /* 完整文档模式必须保留 html、head 与 body 容器。 */
    if (WHOLE_DOCUMENT) {
      addToSet(ALLOWED_TAGS, ['html', 'head', 'body']);
    }

    /* 允许 table 时同步允许解析器隐式插入的 tbody，见 #286、#365。 */
    if (ALLOWED_TAGS.table) {
      addToSet(ALLOWED_TAGS, ['tbody']);
      delete FORBID_TAGS.tbody;
    }

    // 每次解析配置都重新决定活动 Trusted Types 策略。调用方策略不能在 clearConfig() 或显式
    // TRUSTED_TYPES_POLICY:null 后继续存在，否则后续“默认”RETURN_TRUSTED_TYPE 结果可能被外部、
    // 甚至不安全的策略签名。见 GHSA-vxr8-fq34-vvx9。
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

      // 为 sanitize 所需的空值签名。若 createHTML 递归调用 DOMPurify.sanitize，重入守卫会抛错；
      // 必须先恢复旧策略再传播错误，避免实例停留在中毒状态。见 #1422。
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
      // 单次调用提供的策略因此会暂留，只有 clearConfig() 或显式 null 才终止其生命周期。
      if (trustedTypesPolicy === undefined) {
        trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
      }

      // 仅在策略有效时签名内部空值；不支持、创建失败或显式关闭时保留普通字符串，避免对
      // 非策略调用 createHTML。见 #1422。
      if (trustedTypesPolicy && typeof emptyHTML === 'string') {
        emptyHTML = _createTrustedHTML('');
      }
    }

    // 冻结内部配置快照，防止 hook 或调用方在 walk 中改写；旧浏览器无 freeze 时使用兼容实现。
    if (freeze) {
      freeze(cfg);
    }

    CONFIG = cfg;
  };

  /* 收集所有可能的 SVG 与 MathML 标签，供 namespace 转换规则识别跨规范元素。 */
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
   * 检查 SVG namespace 元素是否可能由符合规范的解析器在当前父级下产生。
   *
   * HTML 只能通过 `<svg>` 切入；MathML 只能从 annotation-xml 或文本 integration point
   * 通过 `<svg>` 切入；已在 SVG 中时只接受 SVG 规范标签。
   *
   * @param tagName - 元素的规范化标签名。
   * @param parent - 真实或模拟父节点。
   * @param parentTagName - 父节点的规范化标签名。
   * @returns 当前 namespace 转换是否合法。
   */
  const _checkSvgNamespace = function (
    tagName: string,
    parent: {
      /* prettier-ignore */
      /** 父节点 namespace。 */
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

    // SVG namespace 内只接受 SVG 规范定义的标签。
    return Boolean(ALL_SVG_TAGS[tagName]);
  };

  /**
   * 检查 MathML namespace 元素是否可能由符合规范的解析器在当前父级下产生。
   *
   * HTML 只能通过 `<math>` 切入；SVG 只能在 HTML integration point 下通过 `<math>`
   * 切入；已在 MathML 中时只接受 MathML 规范标签。
   *
   * @param tagName - 元素的规范化标签名。
   * @param parent - 真实或模拟父节点。
   * @param parentTagName - 父节点的规范化标签名。
   * @returns 当前 namespace 转换是否合法。
   */
  const _checkMathMlNamespace = function (
    tagName: string,
    parent: {
      /* prettier-ignore */
      /** 父节点 namespace。 */
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

    // MathML namespace 内只接受 MathML 规范定义的标签。
    return Boolean(ALL_MATHML_TAGS[tagName]);
  };

  /**
   * 检查 HTML namespace 元素是否可从当前 foreign-content 父级合法切入。
   *
   * SVG 父级必须是 HTML integration point，MathML 父级必须是文本 integration point；
   * 同时拒绝只属于 MathML/SVG 的标签，但保留两个规范共有的标签。
   *
   * @param tagName - 元素的规范化标签名。
   * @param parent - 真实或模拟父节点。
   * @param parentTagName - 父节点的规范化标签名。
   * @returns 当前 namespace 转换是否合法。
   */
  const _checkHtmlNamespace = function (
    tagName: string,
    parent: {
      /* prettier-ignore */
      /** 父节点 namespace。 */
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
   *
   * @param element - 要检查 namespace 的 DOM 元素。
   * @returns 符合解析器可达状态时返回 `true`。
   */
  const _checkValidNamespace = function (element: Element): boolean {
    let parent = getParentNode(element);

    // JSDOM 的 shadow DOM 中 parentNode 可能为空；用配置的根 namespace 模拟 template 父级。
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

    // 理论上只剩 HTML、SVG、MathML 或显式允许 namespace；未知状态一律失败关闭。
    return false;
  };

  /**
   * 记录并强制从树中移除节点；无法安全移除 parentless 节点时失败关闭。
   *
   * 常规路径使用缓存的 parent getter 与原生 removeChild。失败后只调用缓存的 `remove`；
   * 若节点仍无法形成可信的“已移除”结果，则抛错，避免把待删除的 IN_PLACE 根原样交还调用方。
   *
   * @param node - 已被安全策略判定必须删除的 DOM 节点。
   */
  const _forceRemove = function (node: Node): void {
    arrayPush(DOMPurify.removed, { element: node });

    try {
      // eslint-disable-next-line unicorn/prefer-dom-node-remove
      getParentNode(node).removeChild(node);
    } catch (_) {
      /*
       * 常规 detach 失败时通常是 parentless 节点：getParentNode() 为 null，removeChild 因而抛错。
       * 按规范，Element.prototype.remove() 对 parentless 节点也是空操作；若只记录“已删除”，
       * 会把仍含 payload 的节点交还调用方，例如被 mXSS canary 或 style-child 规则判死的
       * detached IN_PLACE 根。这里像 IN_PLACE 入口的 clobbered 根一样抛错，而不调用节点自身的
       * getAttributeNames/removeAttribute 做“中和”：<form> 的命名子节点可遮蔽这些方法，且
       * _isClobbered 甚至不探测 getAttributeNames，中和可能静默失效。此路径仅使用缓存的
       * remove/getParentNode，把 GHSA-r47g-fvhr-h676 从 clobbered form 根推广到所有根删除原因。
       * REPORT-3。
       *
       * 该分支位于 catch 内；树内节点的 removeChild 成功后不会到达。实际触发者是无法按常规
       * 路径移除的节点，尤其是仍要作为返回值的 parentless 根。
       */
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
   * 在 IN_PLACE walk 中止后，以失败关闭方式清空 live 根节点。
   *
   * campaign-3 F2：custom-element reaction 或其他重入 DOM 变更可在 walk 中途使 `_forceRemove`
   * 抛错，若直接退出，调用方 live tree 的未访问尾部仍带 handler。树已在迭代中变化，无法安全
   * 续跑，因此先清理整棵子树的危险属性，再删除根的全部 children 和 attributes，最后由上层
   * 传播原错误。所有结构读取均使用缓存 getter；根已在 IN_PLACE 入口完成 clobber 预检。
   *
   * @param root - 要失败关闭的 IN_PLACE 根。
   */
  const _neutralizeRoot = function (root: Node): void {
    /*
     * 必须先清理整棵子树的非 allowlist 属性（包括 on*），再 detach。反向顺序会留下带 handler
     * 的原节点，例如正在加载的 `<img onerror>`；即使随后抛错，已排队资源事件仍会在页面域执行。
     * 读取均防 clobber；必删 clobbered 节点自身属性无关紧要，但其正常后代仍会被遍历并清理。
     */
    _neutralizeSubtree(root);

    const childNodes = getChildNodes(root);
    if (childNodes) {
      const snapshot: Node[] = [];
      arrayForEach(childNodes, (child) => {
        arrayPush(snapshot, child);
      });
      arrayForEach(snapshot, (child) => {
        try {
          remove(child);
        } catch (_) {
          /* 尽力拆除；无法移除的 child 最终仍受根失败关闭语义约束。 */
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
   * 记录并删除一个属性，并处理浏览器中不可完全删除的 `is` 属性。
   *
   * DOM 返回模式遇到残留 `is` 时删除整个元素；字符串模式则把值置空，避免 customized built-in
   * 语义复活。记录失败时仍写入 `attribute:null`，保证调用方知道发生过删除决策。
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

    // 某些浏览器无法彻底删除 is；DOM 返回时移除元素，字符串返回时至少清空其值。
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
   * 仅用于中和即将从 IN_PLACE 树中丢弃的节点。
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
   * 迭代清理待从 IN_PLACE live tree 丢弃的整棵子树。
   *
   * audit-5 F1：KEEP_CONTENT 的移动提升只覆盖“不允许标签”路径；clobber、mXSS canary、
   * namespace、注释、PI 与 KEEP_CONTENT:false 都会经 `_forceRemove` 整棵 detach。IN_PLACE
   * 下，正在加载的 `<img onerror>`/`<video>` 等原节点即使脱树，也可能在 sanitize 返回后执行
   * 已排队事件。此函数在返回前同步遍历 removed subtree，用同一属性名称 allowlist 去除 `on*`
   * 等属性。它刻意不触发 hook：这些节点不会进入输出，向扩展方报告属性生命周期会造成误导。
   * 结构读取使用缓存 getter；clobbered 待删节点自身无法清理时，其正常后代仍可继续处理。
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
   * 在 IN_PLACE 主 walk 前切断 declarative partial update/streaming linkage。
   *
   * 机制参考：https://github.com/WICG/declarative-partial-updates
   *
   * 主 walk 只会按文档序逐节点移除 `for`/`patchsrc` 与 PI/markup comment range marker。
   * live IN_PLACE 根从连接到迭代器抵达某节点之间，其 linkage 仍然有效；连接或 streaming patch
   * 可在 walk 的 microtask 中把未净化 DOM 注入/传送到迭代器已越过且不会重访的区域。入口预扫
   * 在 walk 开始前切断整棵树的 linkage，关闭该时间窗口。
   *
   * 该预扫无法撤销 sanitize 开始前已触发的 patch；因此仍不能把已连接的攻击者树安全地交给
   * IN_PLACE。它只保证从 sanitize 开始后的 linkage 被切断，并受 SAFE_FOR_XML 门控，以便与
   * 其他结构防护一致地显式关闭。
   *
   * 遍历使用缓存 childNodes getter；属性操作逐节点捕获异常，使 clobbered 节点不能阻断其
   * 正常后代的预扫。
   *
   * 仓库当前没有可定位的真浏览器 probe/回归文件来证明 declarative partial updates 的运行时
   * 行为；以上属于防御性平台假设，仍需在目标 Chromium 单独验证。当前与既有策略一致，保留
   * `<label>/<output>` 的 `for`。若正式特性能通过 surviving for+id 驱动 patch，IN_PLACE 预扫与
   * `_isBasicCustomElement` 调用方的属性检查还需删除该组合；分类确认前保持现状。
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
   * 回退。XHTML 会补齐严格根结构；非 FORCE_BODY 模式手工恢复解析器可能丢失的前导空白。
   * 解析语法错误被吸收，调用方再根据是否取得根节点决定空结果。
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
    /* 默认使用 DOMParser；多根 SVG 等场景可能失败，随后进入 createDocument 回退。 */
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
        // 无效 XML 会触发语法错误；保留空文档，让调用方按空结果处理。
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
   *
   * @param root - walk 的根元素或节点。
   * @returns 绑定真实 owner document 的节点迭代器。
   */
  const _createNodeIterator = function (root: Node): NodeIterator {
    /*
     * HTMLFormElement 具有 [LegacyOverrideBuiltIns]；<input name="ownerDocument"> 或外部关联
     * input 会遮蔽原型 getter，使直接读取返回 input。随后 createNodeIterator.call(input, ...)
     * 会抛出 "Illegal invocation"；IN_PLACE 下若发生在失败关闭 barrier 前，会留下未中和 live tree。
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
   * 顺序变化可能让前一轮替换产生的新边界逃过后续匹配。
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
   * 这是所有 DOM 返回路径在 SAFE_FOR_TEMPLATES 下的最终屏障：先 normalize，让被删除元素分隔、
   * 原本跨多个 text node 的表达式合并后再清理。遍历 Text、Comment、CDATA、PI 并原地修改
   * `.data`，避免 innerHTML 序列化/重解析，也让 ERB 正则匹配真实 `<%...%>` 字节而非实体转义。
   *
   * 此处不访问属性值；属性模板表达式由逐节点 `_sanitizeAttributes` 处理。NodeIterator 不进入
   * template.content，因此显式递归每个 template fragment。
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
   * Form 是唯一具有 [LegacyOverrideBuiltIns] 的 HTML 接口；后代的 `name` 命中原型属性时，
   * 直接读取会返回命名子节点。函数先用缓存 nodeName 跨 realm 识别 form，再比较直接读取与
   * 缓存 getter/方法结果。IN_PLACE 入口用它拒绝不可信根，属性写回后也重新检查。
   *
   * @param element - 要检查 DOM clobbering 的元素。
   * @returns 任一净化关键成员被遮蔽时返回 `true`。
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
   * hook 的 `this` 绑定当前 DOMPurify 实例，并接收当前冻结配置快照。异常不在此处吞掉：
   * copy/string 路径直接失败，IN_PLACE 路径由外层 barrier 中和 live root 后重抛。
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
   * 覆盖 namespace-confusion mXSS、危险 CSS DOM 结构、PI 与含 markup 的 comment。函数仅做
   * 判定，删除由调用方完成；检查顺序具有安全语义，避免先读取不适用于当前节点的属性。
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

    /* HTML style 出现真实 Element child 是危险 CSS/mXSS 结构。 */
    if (
      SAFE_FOR_XML &&
      currentNode.namespaceURI === HTML_NAMESPACE &&
      tagName === 'style' &&
      _isNode(currentNode.firstElementChild)
    ) {
      return true;
    }

    /* PI 可充当 XML/patch range marker，始终删除。 */
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
   * children 后删除。false 只代表“保留 custom element”，调用方据此补齐 after hook 生命周期，
   * 修复 GHSA-c2j3-45gr-mqc4。
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

    /*
     * 除 FORBID_CONTENTS 外按 KEEP_CONTENT 保留内容。这里只使用缓存原型 getter：旧代码的
     * `|| currentNode.parentNode/childNodes` 回退在安全节点上不可达，在攻击节点上反而重新暴露
     * clobber 面。真实 parentless 节点返回 null，下面的双重存在检查已足够门控。
     */
    if (KEEP_CONTENT && !FORBID_CONTENTS[tagName]) {
      const parentNode = getParentNode(currentNode);
      const childNodes = getChildNodes(currentNode);

      if (childNodes && parentNode) {
        const childCount = childNodes.length;

        /*
         * 普通节点把每个 child 原对象上移一级，不做深克隆。每个后代只移动一次，使嵌套不允许
         * 元素从逐层重克隆的 O(n²) 降为 O(n)，也让 removed 原节点不再持有整棵子树。更重要的
         * IN_PLACE 不变量：携带已排队资源事件的原 `<img onerror>`、video/audio、lazy/onload
         * 节点会被搬回 walk 并净化，而不是仅留下一个干净 clone、让 armed 原节点脱树后执行。
         *
         * 唯一必须 clone 的情况是删除 walk root。字符串路径会从该根序列化结果；若严格
         * ALLOWED_TAGS 删除 body，只有 clone children 才能让根对象仍保留待返回内容。IN_PLACE 根
         * 已在入口验证为允许标签，不会走到该 root-clone 分支。
         *
         * childNodes 是 live NodeList；从尾到头处理可同时保证 move 时索引随尾项删除仍有效，
         * clone 时原列表不变。
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
   * tag allowlist → namespace → fallback 标签 →模板文本→ after hook。删除分支通常不触发
   * after hook；通过 custom-element 策略保留的节点会显式补发。hook 主动 detach 的节点不记入
   * `DOMPurify.removed`，但 IN_PLACE 下会立即中和其子树。
   *
   * @protect nodeName
   * @protect textContent
   * @protect removeChild
   * @param currentNode - 要判断能否保留的当前迭代节点。
   * @param root - 当前 walk 根；根本身即使 parentless 也必须继续净化。
   * @returns 节点已删除或已被 hook detach 时返回 `true`，保留时返回 `false`。
   */
  // eslint-disable-next-line complexity
  /** 执行上述完整元素净化流程。 */ const _sanitizeElements = function (
    currentNode: any,
    root: Node
  ): boolean {
    /* 元素判定前 hook 可观察并修改当前树。 */
    _executeHooks(hooks.beforeSanitizeElements, currentNode, null);

    /* 此处 before hook 可能已 detach 非根节点；视为删除。IN_PLACE 下先中和原子树，避免其已排队资源
       handler 在返回后于页面域执行。完整所有权说明见 upon hook 后的同类检查。 */
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

    /*
     * 此处 upon hook 主动 detach 当前节点是既有用法（issue #469，draw.io 风格 foreignObject 过滤）。
     * 缓存 parentNode getter 确认非根节点已真正离树后，它既不会进入序列化输出，也不在 live tree；
     * 应停止处理。若继续，unsafe/namespace 分支会对 parentless 节点调用 _forceRemove，误触发
     * REPORT-3；该抛错只应处理“DOMPurify 要删除却无法 detach”的节点，而非已经安全离树的节点。
     *
     * walk root 例外：detached IN_PLACE 根是合法输入，仍须完整净化，判死时也必须触发 REPORT-3。
     * hook-detached 节点由 hook 决定后续放置，不写入 DOMPurify.removed，故成功后的 removed 清理
     * 无法触达。但其子树仍可能持有已排队资源 handler，例如建树时开始加载的 `<img onload>`，
     * 返回后仍能在页面域执行。这是 audit-5 F1；IN_PLACE 下需在此同步剥离非 allowlist 属性，
     * 与 `_forceRemove` 子树的 post-walk 中和一致。
     */
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

      /* 返回 false 只表示 CUSTOM_ELEMENT_HANDLING 保留了节点。补发 afterSanitizeElements，使“对所有
         surviving element 执行”的 hook 策略不会漏掉 custom element（GHSA-c2j3-45gr-mqc4）。
         随后主循环仍会净化其属性；刻意跳过的 namespace/fallback 删除判定不属于 hook 合约。 */
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

    /* 仅 surviving 普通节点到达 after hook。 */
    _executeHooks(hooks.afterSanitizeElements, currentNode, null);

    return false;
  };

  /**
   * 按互斥分支判断属性能否保留，并明确区分需做 URI 校验与直接放行的名称类别。
   *
   * `FORBID_ATTR`、结构型 patch linkage 与 clobbering 规则先于所有放行条件。data-*、aria-*，
   * 以及 `CUSTOM_ELEMENT_HANDLING` 在 `!nameIsPermitted` 分支认可的属性会结束 else-if 链，并在
   * 函数尾直接返回 `true`，不进入通用 URI 检查。只有 `ALLOWED_ATTR`/ADD_ATTR 等形成的
   * `nameIsPermitted` 路径继续检查 URI-safe 属性、scheme、data URI、unknown protocol 或空值。
   *
   * @param lcTag - 承载属性的规范化标签名。
   * @param lcName - 规范化属性名。
   * @param value - hook 与模板清理后的属性值。
   * @returns 名称和值均满足当前配置时返回 `true`。
   */
  // eslint-disable-next-line complexity
  /** 执行上述完整属性准入判定。 */ const _isValidAttribute = function (
    lcTag: string,
    lcName: string,
    value: string
  ): boolean {
    /* FORBID_ATTR 必须始终胜出，即使 ADD_ATTR 谓词返回 true。 */
    if (FORBID_ATTR[lcName]) {
      return false;
    }

    /*
     * 拒绝 declarative partial updates linkage 属性：
     * https://github.com/WICG/declarative-partial-updates
     *
     * 当前防御按以下平台假设设计：字符串路径在 sanitize 自身 parse 时展开，walk 能看到包括
     * 传送到 MathML/SVG integration point 的完整物化树；IN_PLACE 路径则在连接时、walk 前展开。
     * 仓库不包含原实现注释提到的临时 Chrome probe 文件，故这些时序不能当作仓内可复跑测试证据，
     * 仍需在目标浏览器验证。
     *
     * 删除 linkage 是纵深防御：防止活动关联进入输出后在调用方上下文再次扩展，也防未来引擎
     * 延迟展开造成行为变化。`for` 只在 label/output 上有合法语义；其他元素，尤其 template，
     * 可按 id/marker 传送或删除任意 DOM range。`patchsrc` 会获取远程 markup，按 CSP 中的
     * script-loading 机制处理。规则受 SAFE_FOR_XML 门控；PI range marker 已由 _isUnsafeNode 删除。
     */
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

    const nameIsPermitted =
      ALLOWED_ATTR[lcName] ||
      (EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function &&
        EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag));

    /* 以下为单一 else-if 链：一旦 data/aria/custom-element 分支命中，便跳到函数尾返回 true。
       对 data-* 名称要求连字符后至少一个字符且兼容 XML；其值不解释为 URI，无需 scheme 检查。
       规范：https://html.spec.whatwg.org/multipage/dom.html#embedding-custom-non-visible-data-with-the-data-*-attributes
       兼容性：https://html.spec.whatwg.org/multipage/infrastructure.html#xml-compatible */
    if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR, lcName)) {
      // 合法 data-* 属性值不具 URI sink 语义。
    } else if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR, lcName)) {
      // 合法 aria-* 属性值不具 URI sink 语义。
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
      // 惰性属性无需 URI scheme 检查。
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
      /* 空值在此视为安全二元属性。 */
    } else if (value) {
      return false;
    } else {
      // 空值二元属性安全；其他非空且未命中规则的值此前已拒绝。
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
   * 名称必须包含不位于首字符的连字符，并且不属于 HTML 规范保留名；更完整的名称校验可参考
   * https://github.com/sindresorhus/validate-element-name 。
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
   * 仅处理 `getAttributeType` 报告的 TrustedHTML/TrustedScriptURL。namespaced 属性保持原值，
   * 因为 Trusted Types 尚不支持该场景：
   * https://bugs.chromium.org/p/chromium/issues/detail?id=1305293
   *
   * @param lcTag - 承载属性的规范化标签名。
   * @param lcName - 规范化属性名。
   * @param namespaceURI - 属性 namespace；非空时不包装。
   * @param value - 属性准入函数保留的值；data/aria/custom-element 直通分支不保证执行通用 URI 校验。
   * @returns sink 要求时包装后的受信任值，否则返回原值。
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
   * namespaced 属性用 `setAttributeNS`，其他属性用 `setAttribute`。写入可能新建可遮蔽的 id/name；
   * 命中时删除整个元素，否则无条件弹出 `removed` 的最后一项。SANITIZE_NAMED_PROPS 路径此前确有
   * `_removeAttribute` 与它配对，但 trim/template/hook 改值触发写回时未必有配对记录，因此
   * `removed` 只能用于诊断，不能作为安全判据。写入抛错则删除属性。
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
        /* 浏览器无法识别的 namespace（如 x-schema）退回普通 setAttribute。 */
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
   * `beforeSanitizeAttributes` 在属性存在性检查前执行；随后每个原始属性触发一次 upon hook。
   * 顺序不变量：hook → named-props 前缀 → XML/animation 硬屏障 → force/keep flag → 自闭合规则
   * →模板清理→ `_isValidAttribute` → Trusted Types → 写回。`forceKeepAttr` 是受信任逃生口，
   * 可跳过它之后的校验，但不能绕过位于它之前的硬屏障。遍历完成后才触发 after hook。
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

    const hookEvent = {
      attrName: '',
      attrValue: '',
      keepAttr: true,
      allowedAttributes: ALLOWED_ATTR,
      forceKeepAttr: undefined,
    };
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

      /* 即使允许动画，也禁止用 attributeName 指向 href 构造动态 URI sink。 */
      if (lcName === 'attributename' && stringMatch(value, 'href')) {
        _removeAttribute(name, currentNode);
        continue;
      }

      /* 标志 forceKeepAttr 是受信任 hook 的逃生口；保留原属性并跳过后续常规校验。 */
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

      /* 只有值实际变化才写回；无效 data-* 名称或浏览器拒绝写入时由 helper 捕获。 */
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
   * 元素与属性判定。NodeIterator 不进入 template.content 或 attached shadow root，故两者都需
   * 显式递归。异常不在此吞掉，由调用路径决定 copy 失败或 IN_PLACE 失败关闭。
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

      /* 当前 Element 也可能承载 attached shadow root。默认 NodeIterator 不进入 shadow tree；
         `_sanitizeAttachedShadowRoots` 预扫只沿 childNodes，本身也不会进入 template.content，
         因而 template.content 内的 shadow host 必须在此显式处理。nodeType guard 避免对同一迭代器
         暴露的 Text/Comment/CDATA/PI 读取 shadowRoot。 */
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
   * 显式发现并净化 `root` 下所有 attached shadow root。
   *
   * 默认 NodeIterator 不进入 shadow tree，因此把每个发现的 fragment 交给 `_sanitizeShadowDOM`。
   * 两条输入路径需要该预扫：IN_PLACE 输入已带 shadow root；或 DOM Node copy 的
   * `importNode(dirty, true)` 克隆了 `clonable:true` shadow root。字符串解析路径不受影响。
   *
   * 使用显式 heap stack，避免攻击者用 DOM API 构造超深树造成 JS 调用栈溢出。work item 分为
   * “继续发现节点”和“延迟净化已发现 shadow fragment”，从而先发现 shadow 内嵌套根，再净化
   * 外层 fragment。
   *
   * @param root - 要搜索 attached shadow roots 的子树根。
   */
  const _sanitizeAttachedShadowRoots = function (root: Node): void {
    /*
     * DOM API 不限制树深；JSON/CRDT/editor 数据可直接构造超过 JS 调用栈的 IN_PLACE 树。逐 child
     * 递归会在入口预扫、尚未净化任何节点时栈溢出并失败开放。campaign-3 F4 改用 heap stack。
     *
     * work item 要么继续发现一个 node，要么延迟调用 `_sanitizeShadowDOM`。对同一节点，实际
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
   * 主链固定为：输入归一 → 配置/allowlist 隔离 → 选择 IN_PLACE、Node copy 或字符串 parse 路径
   * → attached shadow 预扫 → NodeIterator 元素/属性 walk → IN_PLACE 失败关闭或结果序列化。
   * `DOMPurify.removed` 在配置成功后重置，仅描述当前调用；hook 与 DOM reaction 的异常会传播，
   * 但 IN_PLACE live tree 会在传播前清空，避免半净化状态返回给调用方。
   *
   * @param dirty - 待净化的 markup 字符串或任意 realm 的 DOM Node。
   * @param cfg - 逐调用配置；实例处于 `setConfig()` 模式时忽略。
   * @returns 与 RETURN/IN_PLACE 配置匹配的净化结果。
   */
  // eslint-disable-next-line complexity
  DOMPurify.sanitize = function (dirty, cfg = {}) {
    let body = null;
    let importedNode = null;
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

    /* 环境只通过部分能力检查时，无法运行完整管线便返回已归一输入。 */
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

    /* 通过 upon hook 事件的 allowedTags/allowedAttributes 暴露集合引用。每次 walk 克隆可变集合，
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

    /* 删除记录属于单次调用；配置解析失败时保留上次记录，成功进入 walk 前才重置。 */
    DOMPurify.removed = [];

    /* 以局部值解析本次 IN_PLACE，不改持久配置闭包。若在 setConfig 模式因一次字符串输入把闭包
       置 false，后续 Node 调用会错误返回净化副本，而调用方继续使用、且常忽略返回值的原节点
       保持未净化。REPORT-2。 */
    const inPlace = IN_PLACE && typeof dirty !== 'string' && _isNode(dirty);

    if (inPlace) {
      /* 主 walk 前先切断 live tree 的全部 patch linkage，防止中途向已处理区域注入；该预扫也
         覆盖随后因 forbidden/clobbered 而抛错的根。 */
      _neutralizePatchLinkage(dirty as Node);

      /* IN_PLACE 根无法像普通 child 一样安全移除，故先验证标签。nodeName 必须由缓存 getter 读取；
         form 根中名为 nodeName 的子节点可遮蔽直接属性并让根 allowlist 检查失效。 */
      const nn = getNodeName
        ? getNodeName(dirty as Node)
        : (dirty as Node).nodeName;
      if (typeof nn === 'string') {
        const tagName = transformCaseFunc(nn);
        if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
          /* 对 live 根失败关闭：抛错前先中和 handler 与 children，与 walk 中止路径一致。 */
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

      /* 主迭代器不进入 shadow tree，故先净化 attached roots。该预扫使用与主 walk 相同的
         campaign-3 F2 失败关闭 barrier：shadow 内 custom-element reaction 若中止预扫，不能留下
         整棵 live tree 未净化。 */
      try {
        _sanitizeAttachedShadowRoots(dirty as Node);
      } catch (error) {
        _neutralizeRoot(dirty as Node);

        throw error;
      }
    } else if (_isNode(dirty)) {
      /* Node copy 路径先导入隔离空文档，避免再次通过字符串 parser 时丢失元素。 */
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

      /* 此处 importNode 会深克隆 clonable shadow root；主迭代器不进入其中，故预先净化。遍历结构读取
         均走缓存 getter，form 根的 clobbering 后代无法隐藏 shadow host。 */
      _sanitizeAttachedShadowRoots(importedNode);
    } else {
      /* 纯文本且不需要 DOM、模板或完整文档处理时走快速返回；TrustedHTML 请求仍需签名。 */
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

    /* FORCE_BODY 注入的首个哨兵只用于固定解析位置，walk 前删除。 */
    if (body && FORCE_BODY) {
      _forceRemove(body.firstChild);
    }

    /* IN_PLACE 直接遍历输入；其他路径遍历隔离文档根。 */
    const walkRoot: Node = inPlace ? (dirty as Node) : body;

    /*
     * 本段 campaign-3 F2 exception barrier 包住迭代器创建与整个 walk。引擎/custom-element 重入变更可在
     * 中途 detach 节点，使 `_forceRemove` 的 parentless guard 抛错；没有 barrier 时，IN_PLACE 树
     * 会停在半净化状态，未访问尾部仍 armed。迭代器创建也会解引用根文档，exotic/clobbered 根的
     * 异常同样必须触发中和。任意异常先清空 IN_PLACE 根，再保持原抛错合约向外传播。
     * 字符串/DOM-copy 路径不会返回局部 body，传播异常本身已失败关闭。
     */
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
      /* 对 audit-5 F1 的成功收尾：从 live tree 删除的节点虽然已 detach，仍可能持有返回后在页面域执行
         的已排队资源 handler。移动提升只覆盖 disallowed-tag + KEEP_CONTENT；对 clobber、mXSS、
         namespace、comment、KEEP_CONTENT:false 等其他 removed subtree，在返回前同步剥离非
         allowlist 属性，确保 handler 先被取消。 */
      arrayForEach(DOMPurify.removed, (entry) => {
        if (entry.element) {
          _neutralizeSubtree(entry.element as Node);
        }
      });

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
         * 不使用 adoptNode()：它不会重置 HTMLFormElement past names map 等内部状态，理论安全性
         * 不足以排除新攻击面。importNode() 会克隆哪些状态由规范明确限定，因此选用深导入。
         */
        returnNode = importNode.call(originalDocument, returnNode, true);
      }

      return returnNode;
    }

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

    return trustedTypesPolicy && RETURN_TRUSTED_TYPE
      ? _createTrustedHTML(serializedHTML)
      : serializedHTML;
  };

  /**
   * 解析并锁定实例级持久配置。
   *
   * 后续 `sanitize` 忽略逐调用 `cfg`，并在每次 walk 前从这里捕获的 pristine allowlist 恢复，
   * 使 hook 的调用内扩展不能跨调用累积。调用 `clearConfig()` 才恢复逐调用配置模式。
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
   * 内部默认策略仍保留一次性缓存；下一次 `_parseConfig` 可恢复它，而不会重建同名策略。
   */
  DOMPurify.clearConfig = function () {
    CONFIG = null;
    SET_CONFIG = false;
    SET_CONFIG_ALLOWED_TAGS = null;
    SET_CONFIG_ALLOWED_ATTR = null;

    // 丢弃调用方策略，防止它污染后续 RETURN_TRUSTED_TYPE 输出；下一次 _parseConfig 恢复已缓存、
    // 不会因重名而重建的内部默认策略。见 GHSA-vxr8-fq34-vvx9。
    trustedTypesPolicy = defaultTrustedTypesPolicy;
    emptyHTML = '';
  };

  /**
   * 用当前闭包配置检查单个属性名称和值。
   *
   * `CONFIG` 尚未建立时（包括 `clearConfig()` 后）才创建默认配置；否则可能复用最近一次逐调用
   * 配置、`setConfig()` 持久配置，以及上次 hook 在该调用级 allowlist 上留下的修改。该 API
   * 直接复用 `_isValidAttribute`，不运行元素 walk、attribute hooks 或 Trusted Types 写回。
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
   * @param entryPoint - HooksMap 中的合法 hook 名。
   */
  DOMPurify.removeHooks = function (entryPoint: keyof HooksMap) {
    if (!objectHasOwnProperty(hooks, entryPoint)) {
      return;
    }

    hooks[entryPoint] = [];
  };

  /** 用全新的 HooksMap 替换当前 map，一次清除实例上的全部 hooks。 */
  DOMPurify.removeAllHooks = function () {
    hooks = _createHooksMap();
  };

  return DOMPurify;
}

/** 默认导出绑定当前全局 Window 的实例；无浏览器全局时导出可接收 Window 的降级工厂。 */
export default createDOMPurify();
