import type { TrustedTypePolicy } from 'trusted-types/lib/index.js';

/**
 * 控制单次净化或 DOMPurify 实例持久配置的公开参数。
 *
 * @remarks
 * 上游由 `sanitize()`、`setConfig()` 接收；核心会先复制并规范化为无原型查询表，再由
 * 元素、属性、命名空间、序列化和返回值分支读取。数组型选项会被当作集合，调用方不应
 * 依赖输入对象在调用后的身份或稀疏槽形态。
 */
export interface Config {
  /**
   * 在当前允许属性集合上追加名称，或提供按属性名和标签名执行的额外判定函数。
   *
   * @remarks 数组在配置解析时合并；函数在逐属性检查时调用。`FORBID_ATTR` 始终优先。
   */
  ADD_ATTR?:
    | string[]
    | ((attributeName: string, tagName: string) => boolean)
    | undefined;

  /**
   * 追加可在 URI 属性中使用 `data:` 值的元素名称。
   *
   * @remarks 仅影响 `src`、`href`、`xlink:href` 分支，且不会放行 `script` 元素。
   */
  ADD_DATA_URI_TAGS?: string[] | undefined;

  /**
   * 在当前允许元素集合上追加名称，或提供按标签名执行的额外判定函数。
   *
   * @remarks 数组在配置解析时合并；函数在逐元素检查时调用。`FORBID_TAGS` 始终优先。
   */
  ADD_TAGS?: string[] | ((tagName: string) => boolean) | undefined;

  /**
   * 追加其值无需 URI 协议检查的属性名。
   *
   * @remarks 该选项扩大信任边界，错误加入可执行 URI 属性会造成 XSS 风险。
   */
  ADD_URI_SAFE_ATTR?: string[] | undefined;

  /**
   * 是否允许匹配 `aria-*` 语法的属性；默认 `true`。
   *
   * @remarks 只放行属性名，其他结构安全检查仍然生效。
   */
  ALLOW_ARIA_ATTR?: boolean | undefined;

  /**
   * 是否允许匹配 `data-*` 语法的 HTML 数据属性；默认 `true`。
   *
   * @remarks 启用 `SAFE_FOR_TEMPLATES` 时核心会强制关闭此选项，防止模板数据通道残留。
   */
  ALLOW_DATA_ATTR?: boolean | undefined;

  /**
   * 是否允许默认规则未知的外部协议处理器；默认 `false`，扩大范围会增加 XSS 风险。
   *
   * @remarks
   * 关闭时默认只允许相对值及 `http`、`https`、`ftp`、`ftps`、`tel`、`mailto`、
   * `callto`、`sms`、`cid`、`xmpp`、`matrix`。开启后仍拒绝 `data:` 与脚本协议。
   */
  ALLOW_UNKNOWN_PROTOCOLS?: boolean | undefined;

  /**
   * 是否允许属性值包含自闭合标记；默认 `true`。
   *
   * @remarks 设为 `false` 时逐属性移除含 `/>` 的值，用于规避 jQuery 3.0 相关 mXSS 场景。
   */
  ALLOW_SELF_CLOSE_IN_ATTR?: boolean | undefined;

  /**
   * 用给定属性名集合替换默认允许属性目录。
   *
   * @remarks 后续仍会叠加 `ADD_ATTR`，并受 `FORBID_ATTR`、URI 和结构安全检查约束。
   */
  ALLOWED_ATTR?: string[] | undefined;

  /**
   * 用给定标签名集合替换默认允许元素目录。
   *
   * @remarks `USE_PROFILES` 启用时会重建允许表并覆盖此集合；`FORBID_TAGS` 最终优先。
   */
  ALLOWED_TAGS?: string[] | undefined;

  /**
   * 限定元素可使用的命名空间。默认包含：
   *  - `http://www.w3.org/1999/xhtml`
   *  - `http://www.w3.org/2000/svg`
   *  - `http://www.w3.org/1998/Math/MathML`
   *
   * @remarks 名称按原大小写写入查询表；标签获准不代表错误命名空间也会获准。
   */
  ALLOWED_NAMESPACES?: string[] | undefined;

  /**
   * 用正则表达式替换 URL 属性的默认协议允许规则；错误放宽会造成 XSS 风险。
   * 默认表达式为：
   * ```
   * /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
   * ```
   *
   * @remarks 只有通过 RegExp 品牌检查的值才会采用，否则回退到内置表达式。
   */
  ALLOWED_URI_REGEXP?: RegExp | undefined;

  /**
   * 定义自定义元素、其属性及 customized built-in 元素的额外允许规则。
   *
   * @remarks 核心复制并筛选三个子字段；未提供或类型无效时保持默认拒绝策略。
   */
  CUSTOM_ELEMENT_HANDLING?: {
    /**
     * 匹配可允许自定义元素名称的正则或判定函数；默认 `null`，不额外允许。
     *
     * @remarks 基础名称语法与规范保留名称检查先于该自定义规则执行。
     */
    tagNameCheck?: RegExp | ((tagName: string) => boolean) | null | undefined;

    /**
     * 匹配自定义元素可额外使用属性名的正则或判定函数；默认 `null`。
     *
     * @remarks 函数可同时接收属性名和所属标签名；常规允许属性不依赖此字段。
     */
    attributeNameCheck?:
      | RegExp
      | ((attributeName: string, tagName?: string) => boolean)
      | null
      | undefined;

    /**
     * 是否允许 `is` 属性引用通过 `tagNameCheck` 的 customized built-in 元素；默认 `false`。
     */
    allowCustomizedBuiltInElements?: boolean | undefined;
  };

  /**
   * 把属性名加入显式禁止集合。
   *
   * @remarks 禁止集合覆盖默认、`ALLOWED_ATTR`、`ADD_ATTR` 及 hook 修改后的普通允许结果。
   */
  FORBID_ATTR?: string[] | undefined;

  /**
   * 指定父元素被移除时不得向上保留其子内容的标签集合。
   *
   * @remarks 该数组替换内置 `FORBID_CONTENTS` 基线；仅在 `KEEP_CONTENT` 流程中有意义。
   */
  FORBID_CONTENTS?: string[] | undefined;

  /**
   * 在当前或默认 `FORBID_CONTENTS` 集合上追加标签，不替换既有成员。
   */
  ADD_FORBID_CONTENTS?: string[] | undefined;

  /**
   * 把标签名加入显式禁止集合。
   *
   * @remarks 禁止集合覆盖默认、`ALLOWED_TAGS`、`ADD_TAGS` 及配置档生成的允许结果。
   */
  FORBID_TAGS?: string[] | undefined;

  /**
   * 是否强制把 `style`、`script` 等顶层输入置于 `document.body` 解析；默认 `false`。
   *
   * @remarks 用于避免浏览器把元素自动移动到 `head` 等位置而产生反直觉解析结果。
   */
  FORCE_BODY?: boolean | undefined;

  /**
   * HTML 集成点名称到启用状态的映射；值为 `true` 才启用。例如：
   *
   * ```
   * HTML_INTEGRATION_POINTS: { foreignobject: true }
   * ```
   *
   * @remarks 替换默认集成点映射，供 SVG/MathML 与 HTML 命名空间切换判定读取。
   */
  HTML_INTEGRATION_POINTS?: Record<string, boolean> | undefined;

  /**
   * 是否直接修改传入 DOM 节点，而非导入隔离文档后返回副本。
   *
   * @remarks 可减少复制成本，但输入必须是允许原地处理的元素，失败路径也会影响同一对象。
   */
  IN_PLACE?: boolean | undefined;

  /**
   * 移除元素时是否把允许的子内容提升到父级；默认 `true`。
   *
   * @remarks `FORBID_CONTENTS` 中的元素例外，其子树随元素一并丢弃。
   */
  KEEP_CONTENT?: boolean | undefined;

  /**
   * MathML 文本集成点名称到启用状态的映射；值为 `true` 才启用。例如：
   *
   * ```
   * MATHML_TEXT_INTEGRATION_POINTS: { mtext: true }
   * ```
   *
   * @remarks 替换默认集成点映射，供 MathML 子树中的命名空间转换判定读取。
   */
  MATHML_TEXT_INTEGRATION_POINTS?: Record<string, boolean> | undefined;

  /**
   * 设置解析根节点使用的默认命名空间；未提供时使用 HTML 命名空间。
   *
   * @remarks 该值还参与元素命名空间合法性检查，不等同于扩大 `ALLOWED_NAMESPACES`。
   */
  NAMESPACE?: string | undefined;

  /**
   * 设置 `DOMParser` 媒体类型，决定输入按 HTML 还是 XHTML/XML 规则解析。
   *
   * @remarks 核心仅支持 `text/html` 与 `application/xhtml+xml`，无效值回退到 HTML。
   */
  PARSER_MEDIA_TYPE?: DOMParserSupportedType | undefined;

  /**
   * 是否返回 `DocumentFragment` 而非字符串；默认 `false`。
   *
   * @remarks 启用时核心同时启用 `RETURN_DOM`，再把净化后的子节点迁入新片段。
   */
  RETURN_DOM_FRAGMENT?: boolean | undefined;

  /**
   * 是否返回净化后的 DOM 根节点而非字符串；默认 `false`。
   *
   * @remarks 通常返回 `HTMLBodyElement`；`WHOLE_DOCUMENT` 启用时返回文档元素。
   */
  RETURN_DOM?: boolean | undefined;

  /**
   * 在 Trusted Types 可用且策略创建成功时，是否返回 `TrustedHTML` 而非字符串。
   *
   * @remarks DOM 返回模式优先；平台或策略不可用时仍返回普通字符串。
   */
  RETURN_TRUSTED_TYPE?: boolean | undefined;

  /**
   * 擦除 `{{ ... }}`、`${ ... }` 和 `<% ... %>`，降低输出被模板系统再次解释的风险。
   *
   * @remarks
   * 启用后同时禁用 `data-*` 属性，并在属性、文本节点和最终序列化结果上执行清理。
   * 这不是在生产环境解析不可信模板的安全许可，只应在无法避免二次模板处理时使用。
   */
  SAFE_FOR_TEMPLATES?: boolean | undefined;

  /**
   * 是否启用面向 HTML、SVG、MathML 混合内容的结构威胁检查；默认 `true`。
   *
   * @remarks
   * 该检查会处理含危险标记的注释、命名空间混淆等场景。仅处理纯 HTML 且明确接受
   * 风险时才可设为 `false`；对 SVG、MathML 或 XML 关闭可能导致 XSS。
   */
  SAFE_FOR_XML?: boolean | undefined;

  /**
   * 是否移除可通过 `id`、`name` 覆盖 DOM 内建属性的值；默认 `true`。
   *
   * @remarks 关闭会扩大 DOM Clobbering 风险；启用也不等同于严格命名空间隔离。
   */
  SANITIZE_DOM?: boolean | undefined;

  /**
   * 是否通过命名空间隔离实施严格 DOM Clobbering 防护；默认 `false`。
   *
   * @remarks 启用后给 `id`、`name` 值添加 `user-content-` 前缀，使命名属性与 JS 变量隔离。
   */
  SANITIZE_NAMED_PROPS?: boolean | undefined;

  /**
   * 指定调用方提供的 Trusted Types 策略；`null` 表示明确不使用自定义策略。
   *
   * @remarks 策略必须定义 `createHTML` 和 `createScriptURL`，否则配置解析会抛出错误。
   */
  TRUSTED_TYPES_POLICY?: TrustedTypePolicy | null | undefined;

  /**
   * 按 HTML、SVG、SVG Filter、MathML 类别重建允许元素和属性集合。
   *
   * @remarks
   * 该选项重建并覆盖 `ALLOWED_TAGS` 与 `ALLOWED_ATTR`，不应同时使用；多个值为
   * `true` 的类别会合并，之后仍可应用 `ADD_TAGS`、`ADD_ATTR` 与显式禁止集合。
   * `false` 表示不启用配置档。
   */
  USE_PROFILES?: false | UseProfilesConfig | undefined;

  /**
   * 是否保留并返回包含 `<html>`、`<head>`、`<body>` 的完整文档；默认 `false`。
   *
   * @remarks 启用时核心把三个文档元素加入允许表，并在合法时重新序列化 HTML doctype。
   */
  WHOLE_DOCUMENT?: boolean | undefined;
}

/**
 * `USE_PROFILES` 可组合启用的内置安全目录类别。
 *
 * @remarks 每个值只有严格等于 `true` 才会合并对应标签和属性预设；未启用类别不贡献成员。
 */
export interface UseProfilesConfig {
  /**
   * 合并内置安全 MathML 标签、MathML 属性与 XML 属性目录。
   */
  mathMl?: boolean | undefined;

  /**
   * 合并内置安全 SVG 标签、SVG 属性与 XML 属性目录，不含 Filter 专属标签。
   */
  svg?: boolean | undefined;

  /**
   * 合并内置安全 SVG Filter 标签，并复用 SVG 与 XML 属性目录。
   */
  svgFilters?: boolean | undefined;

  /**
   * 合并内置安全 HTML 标签与 HTML 属性目录。
   */
  html?: boolean | undefined;
}
