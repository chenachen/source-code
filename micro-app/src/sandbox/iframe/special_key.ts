/** 保持 iframe realm 原生 `instanceof` 语义、不合并基座构造器的类型名。 */
export const UN_PROXY_INSTANCEOF_KEYS = [
  'Array'
]

/** 直接取自基座 window 的 API；普通函数绑定宿主，构造器和非函数保持原引用。 */
export const escape2RawWindowKeys = [
  'getComputedStyle',
  // 修复 DOMParser realm 冲突：https://github.com/jd-opensource/micro-app/issues/1292
  'DOMParser',
  'visualViewport',
  'matchMedia',
  'ResizeObserver',
  'IntersectionObserver',
]

/** 匹配 iframe 自有名称且 parent 存在的布局等属性；patchWindowProperty 从当前基座取值或建立访问器桥接。 */
export const escape2RawWindowRegExpKeys = [
  /animationFrame$/i,
  /mutationObserver$/i,
  /height$|width$/i,
  /offset$/i,
  /selection$/i,
  /^range/i,
  /^screen/i,
  /^scroll/i,
  /X$|Y$/,
]

/** iframe document 上需要单独桥接到可见宿主文档的唯一结构元素名。 */
export const uniqueDocumentElement = [
  'body',
  'head',
  'html',
  'title',
]

/** 预留的 iframe location 特殊来源字段；当前版本 `src` 尚未引用。 */
export const hijackMicroLocationKeys = [
  'host',
  'hostname',
  'port',
  'protocol',
  'origin',
]

/** 预留的跨 realm `instanceof` 构造器匹配规则；当前版本 `src` 尚未引用。 */
export const hijackInstanceOfWindowRegExpKeys = [
  /^((HTML|SVG)\w*|MathML)?Element$/,
  /^(Node|Text|Attr|Comment|EventTarget|CharacterData|NamedNodeMap|ShadowRoot)$/,
  /^Document(Type|Fragment)?$/,
  /^(?!PopState).*Event$/,
  /^DataTransfer/
]

/** 当前统一从基座 document 读取的结构属性；名称为后续 ShadowRoot 分流保留。 */
export const proxy2RawDocOrShadowKeys = [
  'childElementCount',
  'children',
  'firstElementChild',
  'firstChild',
  'lastElementChild',
  'activeElement', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'fullscreenElement', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'pictureInPictureElement', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'pointerLockElement', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'styleSheets', // 仅适用于 document/ShadowRoot，不属于普通 Element。
]

/** 当前统一绑定基座 document 的结构方法；名称为后续 ShadowRoot 分流保留。 */
export const proxy2RawDocOrShadowMethods = [
  'append',
  'contains',
  'replaceChildren',
  'createRange', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'getSelection', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'elementFromPoint', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'elementsFromPoint', // 仅适用于 document/ShadowRoot，不属于普通 Element。
  'getAnimations', // 仅适用于 document/ShadowRoot，不属于普通 Element。
]

/** 始终从基座原生 document 读取的环境属性。 */
export const proxy2RawDocumentKeys = [
  'characterSet',
  'compatMode',
  'contentType',
  'designMode',
  'dir',
  'doctype',
  'embeds',
  'fullscreenEnabled',
  'hidden',
  'implementation',
  'lastModified',
  'pictureInPictureEnabled',
  'plugins',
  'readyState',
  'referrer',
  'visibilityState',
  'fonts',
]

/** 始终绑定到基座原生 document 执行的方法。 */
export const proxy2RawDocumentMethods = [
  'execCommand',
  'createRange',
  'exitFullscreen',
  'exitPictureInPicture',
  'getElementsByTagNameNS',
  'hasFocus',
  'prepend',
]
