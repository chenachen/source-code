import type { TrustedTypePolicy } from 'trusted-types/lib/index.js';

/**
 * 控制单次净化或 DOMPurify 实例持久配置的公开参数。
 *
 * @remarks
 * `sanitize()`、`setConfig()` 接收配置后，核心复制出无原型配置快照，另建标签、属性等
 * 查询表供净化流程读取。配置中的数组仍复用调用方引用：稀疏槽会填为 `null`，集合构造
 * 还会向未冻结数组写回规范化名称。`setConfig()` 生效期间，单次调用的配置会被忽略。
 * 函数型增量和 Custom Elements 谓词使用当前 realm 的 `instanceof Function` 判断，
 * Custom Elements 正则同样使用当前 realm 的 `instanceof RegExp`，跨 realm 值不满足这些条件。
 */
export interface Config {
  /**
   * 在当前允许属性集合上追加名称，或提供按属性名和标签名执行的额外判定函数。
   *
   * @remarks
   * 数组在配置解析时合并；名称不在允许表时才调用函数作为追加条件。函数返回 `true`
   * 仍需通过取值检查；普通属性检查中 `FORBID_ATTR` 优先，`forceKeepAttr` hook 可跳过该检查。
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
   * @remarks
   * 数组在配置解析时合并；函数在遍历时先于允许表查询执行，返回 `false` 不会否决已有
   * 允许项。禁止表中的标签不会调用函数；`tbody` 的配置例外见 `FORBID_TAGS`。
   */
  ADD_TAGS?: string[] | ((tagName: string) => boolean) | undefined;

  /**
   * 追加其值无需 URI 协议检查的属性名。
   *
   * @remarks 该选项不放行属性名，只跳过已允许属性的协议检查；应仅加入不承载可执行 URI 的属性。
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
   * @remarks
   * `SAFE_FOR_TEMPLATES` 会关闭此自动放行规则；显式加入 `ALLOWED_ATTR` 或 `ADD_ATTR`
   * 的 `data-*` 名称仍可按普通属性规则保留。
   */
  ALLOW_DATA_ATTR?: boolean | undefined;

  /**
   * 是否允许默认规则未知的外部协议处理器；默认 `false`，扩大范围会增加 XSS 风险。
   *
   * @remarks
   * 普通 URI 分支默认只允许相对值及 `http`、`https`、`ftp`、`ftps`、`tel`、`mailto`、
   * `callto`、`sms`、`cid`、`xmpp`、`matrix`。开启后增加的回退分支仍拒绝 `data:` 和
   * 匹配 `\w+script:` 的协议，例如 `javascript:`、`vbscript:`；媒体 `data:` 白名单独立生效。
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
   * @remarks
   * `USE_PROFILES` 启用时会重建允许表并覆盖此集合；之后再应用增量、完整文档和 `tbody`
   * 补充规则。禁止表通常优先，`tbody` 的例外见 `FORBID_TAGS`。
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
   * @remarks
   * 核心用捕获的 `RegExp.prototype.test` 测试空串，调用未抛错才采用，否则回退到内置表达式。
   * 该探测保留自定义 `exec` 行为；此规则只替换普通属性的 URI 分支，`data-*`、`aria-*`
   * 与 custom-element 额外允许分支不进入该检查。
   */
  ALLOWED_URI_REGEXP?: RegExp | undefined;

  /**
   * 定义自定义元素、其属性及 customized built-in 元素的额外允许规则。
   *
   * @remarks 核心复制并筛选三个子字段；未提供或类型无效时保持默认拒绝策略。
   */
  CUSTOM_ELEMENT_HANDLING?: {
    /**
     * 匹配可允许自定义元素名称的正则或判定函数；缺省或为 `null` 时不额外允许。
     *
     * @remarks
     * 基础名称语法与规范保留名称检查先于该规则执行。仅由这条额外规则保留、未进入
     * 常规允许表的元素会直接返回，跳过后面的命名空间与 fallback 标签检查。
     */
    tagNameCheck?: RegExp | ((tagName: string) => boolean) | null | undefined;

    /**
     * 匹配自定义元素可额外使用属性名的正则或判定函数；缺省或为 `null` 时不额外允许。
     *
     * @remarks
     * 函数可同时接收属性名和所属标签名；常规允许属性不依赖此字段。仅由这条额外规则
     * 放行的属性不会进入通用 URI 检查，规则应与自定义元素如何使用该属性相匹配。
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
   * @remarks
   * 禁止集合覆盖默认、`ALLOWED_ATTR`、`ADD_ATTR` 及 hook 修改后的普通允许结果。
   * 受信任 hook 的 `forceKeepAttr` 会在进入禁止表检查前直接保留原属性。
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
   * @remarks
   * 遍历时禁止集合覆盖默认、`ALLOWED_TAGS`、`ADD_TAGS` 及配置档生成的允许结果。
   * 配置解析有一个例外：允许表包含 `table` 时会补入 `tbody`，并删除禁止表中的 `tbody`。
   */
  FORBID_TAGS?: string[] | undefined;

  /**
   * 是否强制把 `style`、`script` 等顶层输入置于 `document.body` 解析；默认 `false`。
   *
   * @remarks 用于避免浏览器把元素自动移动到 `head` 等位置而产生反直觉解析结果。
   */
  FORCE_BODY?: boolean | undefined;

  /**
   * HTML 集成点名称到启用状态的映射；检查读取对应键的真值。例如：
   *
   * ```
   * HTML_INTEGRATION_POINTS: { foreignobject: true }
   * ```
   *
   * @remarks 替换默认集成点映射，键须为小写；供 SVG/MathML 与 HTML 命名空间切换判定读取。
   */
  HTML_INTEGRATION_POINTS?: Record<string, boolean> | undefined;

  /**
   * 是否直接修改传入 DOM 节点，而非导入隔离文档后返回副本。
   *
   * @remarks
   * 仅真实 DOM 节点启用此路径，字符串仍走解析路径。根标签必须在允许表中且未被禁止，
   * 不能只靠函数型 `ADD_TAGS` 放行；根被禁止、被 clobber 或遍历中止时会触发根属性和普通
   * 子树的失败关闭清理，再抛错。关闭的 shadow root 不在可访问范围内。
   * 成功时返回输入节点本身，优先于所有 `RETURN_*` 选项。
   */
  IN_PLACE?: boolean | undefined;

  /**
   * 移除元素时是否把允许的子内容提升到父级；默认 `true`。
   *
   * @remarks `FORBID_CONTENTS` 中的元素例外，其子树随元素一并丢弃。
   */
  KEEP_CONTENT?: boolean | undefined;

  /**
   * MathML 文本集成点名称到启用状态的映射；检查读取对应键的真值。例如：
   *
   * ```
   * MATHML_TEXT_INTEGRATION_POINTS: { mtext: true }
   * ```
   *
   * @remarks 替换默认集成点映射，键须为小写；供 MathML 子树中的命名空间转换判定读取。
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
   * @remarks 启用时同时启用 `RETURN_DOM`，再把净化后的子节点迁入新片段；原地返回模式优先。
   */
  RETURN_DOM_FRAGMENT?: boolean | undefined;

  /**
   * 是否返回净化后的 DOM 根节点而非字符串；默认 `false`。
   *
   * @remarks
   * 字符串输入通常返回 `HTMLBodyElement`；`WHOLE_DOCUMENT` 启用时返回文档元素。
   * `RETURN_DOM_FRAGMENT` 和真实节点的 `IN_PLACE` 返回路径优先。
   */
  RETURN_DOM?: boolean | undefined;

  /**
   * 是否用当前活动 Trusted Types 策略包装字符串结果；默认 `false`。
   *
   * @remarks DOM 和原地返回模式优先；没有活动策略或策略被显式关闭时仍返回普通字符串。
   */
  RETURN_TRUSTED_TYPE?: boolean | undefined;

  /**
   * 把 `{{ ... }}`、`${ ... }`、`<% ... %>` 及残缺模板边界替换为空格。
   *
   * @remarks
   * 启用后关闭 `data-*` 的自动放行，并清理属性和文本。字符串返回前再清理序列化结果；
   * DOM 或原地返回前合并当前根扫描树中的相邻文本，再清理字符数据并递归后代 `template.content`，
   * 处理该范围内删除元素后拼接出的模板边界。最终清理不进入已附着的 shadow root，也不直接
   * 进入输入 `template` 根自身的 `content`。
   * 该选项不能代替模板系统自身对不可信输入的处理。
   */
  SAFE_FOR_TEMPLATES?: boolean | undefined;

  /**
   * 是否启用面向 HTML、SVG、MathML 混合内容的结构威胁检查；默认 `true`。
   *
   * @remarks
   * 控制含危险标记的注释、部分 mXSS 结构、属性边界和声明式 patch 关联检查；常规元素
   * 路径的命名空间校验不受此开关控制。处理 SVG、MathML 或 XML 时关闭这些检查可能导致 XSS。
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
   * @remarks
   * 启用后给 `id`、`name` 值添加 `user-content-` 前缀，减少其与未加前缀的命名成员冲突；
   * 已有此前缀的值保持不变，重复净化不会继续叠加前缀。
   */
  SANITIZE_NAMED_PROPS?: boolean | undefined;

  /**
   * 指定调用方提供的 Trusted Types 策略；`null` 明确关闭本次活动策略和签名。
   *
   * @remarks
   * 策略必须定义 `createHTML` 和 `createScriptURL`，否则配置解析会抛错。策略也参与待解析
   * 输入及属性写回，不只处理返回值。单次传入的策略会被后续未指定策略的调用复用，直到
   * 显式传入 `null` 或调用 `clearConfig()`；之后的默认配置可恢复实例内部缓存的策略。
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
   * @remarks
   * 启用时把三个文档元素加入允许表；仅字符串路径会序列化 doctype，且要求允许表包含
   * `!doctype`、解析文档确有 doctype，名称还须匹配 HTML。
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
