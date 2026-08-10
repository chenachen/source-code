import { seal } from './utils.js';

/** 匹配完整或残缺 Mustache 表达式，供 `SAFE_FOR_TEMPLATES` 擦除模板语法。 */
export const MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
/** 匹配完整或残缺 ERB 表达式，按 Mustache 之后的固定顺序执行擦除。 */
export const ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
/** 匹配模板字面量插值起点至字符串末尾，防止残缺的 `${...}` 进入模板引擎。 */
export const TMPLIT_EXPR = seal(/\${[\w\W]*/g);
/** 验证 `data-*` 属性名语法；命中后属性值按非 URI 数据处理。 */
export const DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/); // eslint-disable-line no-useless-escape
/** 验证 `aria-*` 属性名语法；是否启用仍由 `ALLOW_ARIA_ATTR` 决定。 */
export const ARIA_ATTR = seal(/^aria-[\-\w]+$/); // eslint-disable-line no-useless-escape
/**
 * 默认 URI 策略：允许相对值，以及 `http`、`https`、`ftp`、`ftps`、`mailto`、
 * `tel`、`callto`、`sms`、`cid`、`xmpp`、`matrix` 协议。
 *
 * @remarks 调用方提供合法 `ALLOWED_URI_REGEXP` 时，核心会用配置值替换此默认表达式。
 */
export const IS_ALLOWED_URI = seal(
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i // eslint-disable-line no-useless-escape
);
/** 在允许未知协议时仍拒绝 `data:` 及名称以 `script` 结尾的脚本协议。 */
export const IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
/** 匹配 URI 中可隐藏协议边界的 ASCII 控制符及 Unicode 空白；协议检查前统一移除。 */
export const ATTR_WHITESPACE = seal(
  /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g // eslint-disable-line no-control-regex
);
/** 限定可重新序列化的文档类型名称为 HTML，避免输出任意 doctype。 */
export const DOCTYPE_NAME = seal(/^html$/i);
/** 对自定义元素名称执行基础连字符语法检查；规范保留名称由核心另行排除。 */
export const CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);

/**
 * 探测元素文本或序列化内容中的标记起始字符，供结构性 mXSS 检查使用。
 *
 * @remarks 虽带全局标志并在模块级复用，`unapply()` 会在每次测试前把 `lastIndex` 归零。
 */
export const ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
/**
 * 探测注释数据中的潜在标记，供 `SAFE_FOR_XML` 评论节点检查和原地净化预处理使用。
 *
 * @remarks 与元素探针相同，共享实例的游标由 `unapply()` 在每次测试前重置。
 */
export const COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
/** 检测 fallback 元素内容中的危险闭合标签，兼容旧浏览器的 mXSS 防护分支。 */
export const FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
/** 检测属性值中的自闭合标记；仅在 `ALLOW_SELF_CLOSE_IN_ATTR` 关闭时触发移除。 */
export const SELF_CLOSING_TAG = seal(/\/>/i);
