// 构建时本文件会自动拼接到打包后的 d.ts 末尾。它只提供 JSX/DOM 类型，不生成运行时代码。

// This code is based on react definition in DefinitelyTyped published under the MIT license.
//      Repository: https://github.com/DefinitelyTyped/DefinitelyTyped
//      Path in the repository: types/react/index.d.ts
//
// Copyrights of original definition are:
//      AssureSign <http://www.assuresign.com>
//      Microsoft <https://microsoft.com>
//                 John Reilly <https://github.com/johnnyreilly>
//      Benoit Benezech <https://github.com/bbenezech>
//      Patricio Zavolinsky <https://github.com/pzavolinsky>
//      Digiguru <https://github.com/digiguru>
//      Eric Anderson <https://github.com/ericanderson>
//      Dovydas Navickas <https://github.com/DovydasNavickas>
//                 Josh Rutherford <https://github.com/theruther4d>
//                 Guilherme Hübner <https://github.com/guilhermehubner>
//                 Ferdy Budhidharma <https://github.com/ferdaber>
//                 Johann Rakotoharisoa <https://github.com/jrakotoharisoa>
//                 Olivier Pascal <https://github.com/pascaloliv>
//                 Martin Hochel <https://github.com/hotell>
//                 Frank Li <https://github.com/franklixuefei>
//                 Jessica Franco <https://github.com/Jessidhia>
//                 Saransh Kataria <https://github.com/saranshkataria>
//                 Kanitkorn Sujautra <https://github.com/lukyth>
//                 Sebastian Silbermann <https://github.com/eps1lon>

import type * as CSS from 'csstype'

/** Vue JSX `style` 对象类型，支持标准驼峰/连字符 CSS properties 与 CSS 自定义变量。 */
export interface CSSProperties
  extends
    CSS.Properties<string | number>,
    CSS.PropertiesHyphen<string | number> {
  /**
   * 为使用 CSSType 对 style 做封闭类型检查，这里移除了普通字符串索引签名。
   * 自定义非标准属性可用类型断言或 module augmentation 扩展；CSS 变量由下方模板
   * 字面量索引单独允许。
   *
   * 示例与更多说明请参阅：
   * https://github.com/frenic/csstype#what-should-i-do-when-i-get-type-errors
   */
  [v: `--${string}`]: string | number | undefined
}

/** ARIA/DOM attribute 可接受的布尔 property 或序列化字符串形式。 */
type Booleanish = boolean | 'true' | 'false'
/** JSX 数值 attribute 同时接受数字与 HTML 字符串表示。 */
type Numberish = number | string

/** WAI-ARIA 1.1 无障碍 attributes 的 JSX 类型。 */
export interface AriaAttributes {
  /** DOM 焦点位于复合控件、文本框、组或应用时，标识其中当前活动的元素。 */
  'aria-activedescendant'?: string | undefined
  /** 指示辅助技术应呈现变更区域的全部内容，还是仅呈现 aria-relevant 指定的部分。 */
  'aria-atomic'?: Booleanish | undefined
  /**
   * 指示文本输入是否会触发一个或多个预测候选，并规定产生预测时的呈现方式。
   */
  'aria-autocomplete'?: 'none' | 'inline' | 'list' | 'both' | undefined
  /** 指示元素正在修改，辅助技术可等修改完成后再向用户呈现。 */
  'aria-busy'?: Booleanish | undefined
  /**
   * 指示复选框、单选按钮等控件当前是否处于选中状态。
   * @see aria-pressed @see aria-selected.
   */
  'aria-checked'?: Booleanish | 'mixed' | undefined
  /**
   * 定义 table、grid 或 treegrid 的总列数。
   * @see aria-colindex.
   */
  'aria-colcount'?: Numberish | undefined
  /**
   * 定义元素在 table、grid 或 treegrid 总列数中的列索引/位置。
   * @see aria-colcount @see aria-colspan.
   */
  'aria-colindex'?: Numberish | undefined
  /**
   * 定义 cell/gridcell 在 table、grid 或 treegrid 中跨越的列数。
   * @see aria-colindex @see aria-rowspan.
   */
  'aria-colspan'?: Numberish | undefined
  /**
   * 标识内容或显示状态受当前元素控制的一个或多个元素。
   * @see aria-owns.
   */
  'aria-controls'?: string | undefined
  /** 指示容器或相关元素集合中代表“当前项”的元素及当前类型。 */
  'aria-current'?:
    Booleanish | 'page' | 'step' | 'location' | 'date' | 'time' | undefined
  /**
   * 标识用于描述当前对象的一个或多个元素。
   * @see aria-labelledby
   */
  'aria-describedby'?: string | undefined
  /**
   * 标识为当前对象提供详细扩展说明的元素。
   * @see aria-describedby.
   */
  'aria-details'?: string | undefined
  /**
   * 指示元素可以被感知但已禁用，因此不可编辑或操作。
   * @see aria-hidden @see aria-readonly.
   */
  'aria-disabled'?: Booleanish | undefined
  /**
   * 指示拖拽对象释放到当前放置目标时允许执行的操作。
   * @deprecated in ARIA 1.1
   */
  'aria-dropeffect'?:
    'none' | 'copy' | 'execute' | 'link' | 'move' | 'popup' | undefined
  /**
   * 标识为当前对象提供错误信息的元素。
   * @see aria-invalid @see aria-describedby.
   */
  'aria-errormessage'?: string | undefined
  /** 指示当前元素或其控制的分组元素处于展开还是折叠状态。 */
  'aria-expanded'?: Booleanish | undefined
  /**
   * 标识替代阅读顺序中的下一个元素，使辅助技术可按用户意愿覆盖文档源码顺序。
   */
  'aria-flowto'?: string | undefined
  /**
   * 指示元素在拖放操作中是否处于“已抓取”状态。
   * @deprecated in ARIA 1.1
   */
  'aria-grabbed'?: Booleanish | undefined
  /** 指示当前元素可触发的 menu/dialog 等交互式弹出层是否存在及其类型。 */
  'aria-haspopup'?:
    Booleanish | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog' | undefined
  /**
   * 指示元素是否暴露给无障碍 API。
   * @see aria-disabled.
   */
  'aria-hidden'?: Booleanish | undefined
  /**
   * 指示输入值不符合应用期望的格式。
   * @see aria-errormessage.
   */
  'aria-invalid'?: Booleanish | 'grammar' | 'spelling' | undefined
  /** 指示作者为激活元素或聚焦元素实现的键盘快捷键。 */
  'aria-keyshortcuts'?: string | undefined
  /**
   * 定义当前元素的文本标签。
   * @see aria-labelledby.
   */
  'aria-label'?: string | undefined
  /**
   * 标识为当前元素提供标签的一个或多个元素。
   * @see aria-describedby.
   */
  'aria-labelledby'?: string | undefined
  /** 定义元素在结构中的层级。 */
  'aria-level'?: Numberish | undefined
  /** 指示元素将更新，并描述 live region 可能发生的更新类型。 */
  'aria-live'?: 'off' | 'assertive' | 'polite' | undefined
  /** 指示元素显示时是否为模态。 */
  'aria-modal'?: Booleanish | undefined
  /** 指示文本框接受多行还是仅单行输入。 */
  'aria-multiline'?: Booleanish | undefined
  /** 指示用户是否可在当前可选后代中选择多项。 */
  'aria-multiselectable'?: Booleanish | undefined
  /** 指示元素方向为水平或垂直。 */
  'aria-orientation'?: 'horizontal' | 'vertical' | undefined
  /**
   * 当 DOM 层级无法表达关系时，标识一个或多个元素，以定义 DOM 元素之间视觉、
   * 功能或上下文上的父子关系。
   * @see aria-controls.
   */
  'aria-owns'?: string | undefined
  /**
   * 定义控件为空时辅助用户输入的简短提示，可以是示例值或期望格式的简要说明。
   */
  'aria-placeholder'?: string | undefined
  /**
   * 定义元素在当前 listitem/treeitem 集合中的序号；集合全部存在于 DOM 时可省略。
   * @see aria-setsize.
   */
  'aria-posinset'?: Numberish | undefined
  /**
   * 指示切换按钮当前是否处于按下状态。
   * @see aria-checked @see aria-selected.
   */
  'aria-pressed'?: Booleanish | 'mixed' | undefined
  /**
   * 指示元素不可编辑，但仍可进行其他操作。
   * @see aria-disabled.
   */
  'aria-readonly'?: Booleanish | undefined
  /**
   * 指示 live region 内无障碍树变化时，用户代理应触发哪些通知。
   * @see aria-atomic.
   */
  'aria-relevant'?:
    | 'additions'
    | 'additions removals'
    | 'additions text'
    | 'all'
    | 'removals'
    | 'removals additions'
    | 'removals text'
    | 'text'
    | 'text additions'
    | 'text removals'
    | undefined
  /** 指示提交表单前用户必须为该元素输入值。 */
  'aria-required'?: Booleanish | undefined
  /** 为元素角色定义作者本地化的人类可读说明。 */
  'aria-roledescription'?: string | undefined
  /**
   * 定义 table、grid 或 treegrid 的总行数。
   * @see aria-rowindex.
   */
  'aria-rowcount'?: Numberish | undefined
  /**
   * 定义元素在 table、grid 或 treegrid 总行数中的行索引/位置。
   * @see aria-rowcount @see aria-rowspan.
   */
  'aria-rowindex'?: Numberish | undefined
  /**
   * 定义 cell/gridcell 在 table、grid 或 treegrid 中跨越的行数。
   * @see aria-rowindex @see aria-colspan.
   */
  'aria-rowspan'?: Numberish | undefined
  /**
   * 指示各类控件当前是否处于选中状态。
   * @see aria-checked @see aria-pressed.
   */
  'aria-selected'?: Booleanish | undefined
  /**
   * 定义当前 listitem/treeitem 集合的项目总数；集合全部存在于 DOM 时可省略。
   * @see aria-posinset.
   */
  'aria-setsize'?: Numberish | undefined
  /** 指示 table/grid 项目按升序、降序或其他方式排序。 */
  'aria-sort'?: 'none' | 'ascending' | 'descending' | 'other' | undefined
  /** 定义范围控件允许的最大值。 */
  'aria-valuemax'?: Numberish | undefined
  /** 定义范围控件允许的最小值。 */
  'aria-valuemin'?: Numberish | undefined
  /**
   * 定义范围控件的当前值。
   * @see aria-valuetext.
   */
  'aria-valuenow'?: Numberish | undefined
  /** 定义范围控件 aria-valuenow 的人类可读文本替代。 */
  'aria-valuetext'?: string | undefined
}

// Vue 的 style 规范化支持嵌套数组。
/** Vue 样式绑定输入：假值忽略，字符串为 cssText，对象为 CSS 属性，数组可递归嵌套交由 normalizeStyle 展平。 */
export type StyleValue =
  false | null | undefined | string | CSSProperties | Array<StyleValue>

// 支持原生 `class` attribute。
/** Vue 类名绑定输入：字符串、按真值选键的对象、递归数组和被忽略的假值，由 normalizeClass 合并。 */
export type ClassValue =
  false | null | undefined | string | Record<string, any> | Array<ClassValue>

/** 所有 HTML 元素共享的全局、ARIA、RDFa 与事件 JSX attributes。 */
export interface HTMLAttributes extends AriaAttributes, EventHandlers<Events> {
  innerHTML?: string | undefined

  class?: ClassValue | undefined
  style?: StyleValue | undefined

  // 标准 HTML attributes。
  accesskey?: string | undefined
  contenteditable?: Booleanish | 'inherit' | 'plaintext-only' | undefined
  contextmenu?: string | undefined
  dir?: string | undefined
  draggable?: Booleanish | undefined
  enterkeyhint?:
    | 'enter'
    | 'done'
    | 'go'
    | 'next'
    | 'previous'
    | 'search'
    | 'send'
    | undefined
  /**
   * @deprecated 请使用 `enterkeyhint`。
   */
  enterKeyHint?: HTMLAttributes['enterkeyhint']
  hidden?: Booleanish | '' | 'hidden' | 'until-found' | undefined
  id?: string | undefined
  inert?: Booleanish | undefined
  lang?: string | undefined
  placeholder?: string | undefined
  spellcheck?: Booleanish | undefined
  tabindex?: Numberish | undefined
  title?: string | undefined
  translate?: 'yes' | 'no' | undefined

  // 类型未知的历史字段。
  radiogroup?: string | undefined // <command>, <menuitem>

  // WAI-ARIA 无障碍字段。
  role?: string | undefined

  // RDFa属性。
  about?: string | undefined
  datatype?: string | undefined
  inlist?: any
  prefix?: string | undefined
  property?: string | undefined
  resource?: string | undefined
  typeof?: string | undefined
  vocab?: string | undefined

  // 非标准 attributes。
  autocapitalize?: string | undefined
  autocorrect?: string | undefined
  autosave?: string | undefined
  color?: string | undefined
  itemprop?: string | undefined
  itemscope?: Booleanish | undefined
  itemtype?: string | undefined
  itemid?: string | undefined
  itemref?: string | undefined
  results?: Numberish | undefined
  security?: string | undefined
  unselectable?: 'on' | 'off' | undefined

  // HTML Living Standard 新增字段。
  /**
   * 提示用户编辑元素或其内容时可能输入的数据类型。
   * @see https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-inputmode-attribute
   */
  inputmode?:
    | 'none'
    | 'text'
    | 'tel'
    | 'url'
    | 'email'
    | 'numeric'
    | 'decimal'
    | 'search'
    | undefined
  /**
   * 指定标准 HTML 元素按已定义的 customized built-in element 行为运行。
   * @see https://html.spec.whatwg.org/multipage/custom-elements.html#attr-is
   */
  is?: string | undefined
  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/exportparts
   */
  exportparts?: string
  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/part
   */
  part?: string
}

/** HTML `referrerpolicy` attribute 的标准取值。 */
type HTMLAttributeReferrerPolicy =
  | ''
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url'

/** `<a>` 元素专用 JSX attributes。 */
export interface AnchorHTMLAttributes extends HTMLAttributes {
  download?: any
  href?: string | undefined
  hreflang?: string | undefined
  media?: string | undefined
  ping?: string | undefined
  rel?: string | undefined
  target?: string | undefined
  type?: string | undefined
  referrerpolicy?: HTMLAttributeReferrerPolicy | undefined
}

/** `<area>` 元素专用 JSX attributes。 */
export interface AreaHTMLAttributes extends HTMLAttributes {
  alt?: string | undefined
  coords?: string | undefined
  download?: any
  href?: string | undefined
  hreflang?: string | undefined
  media?: string | undefined
  referrerpolicy?: HTMLAttributeReferrerPolicy | undefined
  rel?: string | undefined
  shape?: string | undefined
  target?: string | undefined
}

/** `<audio>` 元素专用 JSX attributes，复用媒体元素公共属性。 */
export interface AudioHTMLAttributes extends MediaHTMLAttributes {}

/** `<base>` 元素专用 JSX attributes。 */
export interface BaseHTMLAttributes extends HTMLAttributes {
  href?: string | undefined
  target?: string | undefined
}

/** `<blockquote>` 元素专用 JSX attributes。 */
export interface BlockquoteHTMLAttributes extends HTMLAttributes {
  cite?: string | undefined
}

/** `<button>` 元素专用 JSX attributes。 */
export interface ButtonHTMLAttributes extends HTMLAttributes {
  autofocus?: Booleanish | undefined
  disabled?: Booleanish | undefined
  form?: string | undefined
  formaction?: string | undefined
  formenctype?: string | undefined
  formmethod?: string | undefined
  formnovalidate?: Booleanish | undefined
  formtarget?: string | undefined
  name?: string | undefined
  type?: 'submit' | 'reset' | 'button' | undefined
  value?: string | ReadonlyArray<string> | number | undefined
}

/** `<canvas>` 元素专用 JSX attributes。 */
export interface CanvasHTMLAttributes extends HTMLAttributes {
  height?: Numberish | undefined
  width?: Numberish | undefined
}

/** `<col>` 元素专用 JSX attributes。 */
export interface ColHTMLAttributes extends HTMLAttributes {
  span?: Numberish | undefined
  width?: Numberish | undefined
}

/** `<colgroup>` 元素专用 JSX attributes。 */
export interface ColgroupHTMLAttributes extends HTMLAttributes {
  span?: Numberish | undefined
}

/** `<data>` 元素专用 JSX attributes。 */
export interface DataHTMLAttributes extends HTMLAttributes {
  value?: string | ReadonlyArray<string> | number | undefined
}

/** `<details>` 元素专用 JSX attributes。 */
export interface DetailsHTMLAttributes extends HTMLAttributes {
  name?: string | undefined
  open?: Booleanish | undefined
}

/** `<del>` 元素专用 JSX attributes。 */
export interface DelHTMLAttributes extends HTMLAttributes {
  cite?: string | undefined
  datetime?: string | undefined
}

/** `<dialog>` 元素专用 JSX attributes 与 close/cancel 事件。 */
export interface DialogHTMLAttributes extends HTMLAttributes {
  open?: Booleanish | undefined
  onClose?: ((payload: Event) => void) | undefined
  onCancel?: ((payload: Event) => void) | undefined
}

/** `<embed>` 元素专用 JSX attributes。 */
export interface EmbedHTMLAttributes extends HTMLAttributes {
  height?: Numberish | undefined
  src?: string | undefined
  type?: string | undefined
  width?: Numberish | undefined
}

/** `<fieldset>` 元素专用 JSX attributes。 */
export interface FieldsetHTMLAttributes extends HTMLAttributes {
  disabled?: Booleanish | undefined
  form?: string | undefined
  name?: string | undefined
}

/** `<form>` 元素专用 JSX attributes。 */
export interface FormHTMLAttributes extends HTMLAttributes {
  acceptcharset?: string | undefined
  action?: string | undefined
  autocomplete?: string | undefined
  enctype?: string | undefined
  method?: string | undefined
  name?: string | undefined
  novalidate?: Booleanish | undefined
  target?: string | undefined
}

/** 根 `<html>` 元素专用 JSX attributes。 */
export interface HtmlHTMLAttributes extends HTMLAttributes {
  manifest?: string | undefined
}

/** `<iframe>` 元素专用 JSX attributes，包含部分浏览器兼容历史字段。 */
export interface IframeHTMLAttributes extends HTMLAttributes {
  allow?: string | undefined
  allowfullscreen?: Booleanish | undefined
  allowtransparency?: Booleanish | undefined
  /** @deprecated */
  frameborder?: Numberish | undefined
  height?: Numberish | undefined
  loading?: 'eager' | 'lazy' | undefined
  /** @deprecated */
  marginheight?: Numberish | undefined
  /** @deprecated */
  marginwidth?: Numberish | undefined
  name?: string | undefined
  referrerpolicy?: HTMLAttributeReferrerPolicy | undefined
  sandbox?: string | undefined
  /** @deprecated */
  scrolling?: string | undefined
  seamless?: Booleanish | undefined
  src?: string | undefined
  srcdoc?: string | undefined
  width?: Numberish | undefined
}

/** `<img>` 元素专用 JSX attributes。 */
export interface ImgHTMLAttributes extends HTMLAttributes {
  alt?: string | undefined
  crossorigin?: 'anonymous' | 'use-credentials' | '' | undefined
  decoding?: 'async' | 'auto' | 'sync' | undefined
  fetchpriority?: 'high' | 'low' | 'auto' | undefined
  height?: Numberish | undefined
  loading?: 'eager' | 'lazy' | undefined
  referrerpolicy?: HTMLAttributeReferrerPolicy | undefined
  sizes?: string | undefined
  src?: string | undefined
  srcset?: string | undefined
  usemap?: string | undefined
  width?: Numberish | undefined
}

/** `<ins>` 元素专用 JSX attributes。 */
export interface InsHTMLAttributes extends HTMLAttributes {
  cite?: string | undefined
  datetime?: string | undefined
}

/** `<input type>` 的标准取值，同时允许平台新增的自定义字符串。 */
export type InputTypeHTMLAttribute =
  | 'button'
  | 'checkbox'
  | 'color'
  | 'date'
  | 'datetime-local'
  | 'email'
  | 'file'
  | 'hidden'
  | 'image'
  | 'month'
  | 'number'
  | 'password'
  | 'radio'
  | 'range'
  | 'reset'
  | 'search'
  | 'submit'
  | 'tel'
  | 'text'
  | 'time'
  | 'url'
  | 'week'
  | (string & {})

/** autocomplete 地址类别 token。 */
type AutoFillAddressKind = 'billing' | 'shipping'
/** autocomplete 的基础开关。 */
type AutoFillBase = '' | 'off' | 'on'
/** autocomplete 联系方式字段 token。 */
type AutoFillContactField =
  | 'email'
  | 'tel'
  | 'tel-area-code'
  | 'tel-country-code'
  | 'tel-extension'
  | 'tel-local'
  | 'tel-local-prefix'
  | 'tel-local-suffix'
  | 'tel-national'
/** autocomplete 联系方式使用场景 token。 */
type AutoFillContactKind = 'home' | 'mobile' | 'work'
/** autocomplete 凭据字段 token。 */
type AutoFillCredentialField = 'webauthn'
/** autocomplete 普通表单字段 token。 */
type AutoFillNormalField =
  | 'additional-name'
  | 'address-level1'
  | 'address-level2'
  | 'address-level3'
  | 'address-level4'
  | 'address-line1'
  | 'address-line2'
  | 'address-line3'
  | 'bday-day'
  | 'bday-month'
  | 'bday-year'
  | 'cc-csc'
  | 'cc-exp'
  | 'cc-exp-month'
  | 'cc-exp-year'
  | 'cc-family-name'
  | 'cc-given-name'
  | 'cc-name'
  | 'cc-number'
  | 'cc-type'
  | 'country'
  | 'country-name'
  | 'current-password'
  | 'family-name'
  | 'given-name'
  | 'honorific-prefix'
  | 'honorific-suffix'
  | 'name'
  | 'new-password'
  | 'one-time-code'
  | 'organization'
  | 'postal-code'
  | 'street-address'
  | 'transaction-amount'
  | 'transaction-currency'
  | 'username'
/** 把可选 token 表示为“token+空格”或空串，便于模板字面量拼接。 */
type OptionalPrefixToken<T extends string> = `${T} ` | ''
/** 把可选尾 token 表示为“空格+token”或空串。 */
type OptionalPostfixToken<T extends string> = ` ${T}` | ''
/** autocomplete 的普通字段或带联系方式类别字段。 */
type AutoFillField =
  | AutoFillNormalField
  | `${OptionalPrefixToken<AutoFillContactKind>}${AutoFillContactField}`
/** autocomplete 自定义 section token。 */
type AutoFillSection = `section-${string}`
/** 按 HTML 规范顺序拼接的完整 autocomplete 字符串。 */
type AutoFill =
  | AutoFillBase
  | `${OptionalPrefixToken<AutoFillSection>}${OptionalPrefixToken<AutoFillAddressKind>}${AutoFillField}${OptionalPostfixToken<AutoFillCredentialField>}`
/** `<input autocomplete>` 的已知组合，同时保留浏览器扩展字符串提示。 */
export type InputAutoCompleteAttribute = AutoFill | (string & {})

/** `<input>` 元素专用 JSX attributes，并放宽 value/checked 以适配 Vue v-model。 */
export interface InputHTMLAttributes extends HTMLAttributes {
  accept?: string | undefined
  alt?: string | undefined
  autocomplete?: InputAutoCompleteAttribute | undefined
  autofocus?: Booleanish | undefined
  capture?: boolean | 'user' | 'environment' | undefined // https://www.w3.org/tr/html-media-capture/#the-capture-attribute
  /** 为 IDE 多 checkbox 的 v-model 类型提示放宽到 Array/Set；运行时 checked 仍由指令计算为布尔。 */
  checked?: Booleanish | any[] | Set<any> | undefined // 为 IDE 的 v-model 多复选框类型提示接受集合。
  crossorigin?: string | undefined
  disabled?: Booleanish | undefined
  form?: string | undefined
  formaction?: string | undefined
  formenctype?: string | undefined
  formmethod?: string | undefined
  formnovalidate?: Booleanish | undefined
  formtarget?: string | undefined
  height?: Numberish | undefined
  indeterminate?: boolean | undefined
  list?: string | undefined
  max?: Numberish | undefined
  maxlength?: Numberish | undefined
  min?: Numberish | undefined
  minlength?: Numberish | undefined
  multiple?: Booleanish | undefined
  name?: string | undefined
  pattern?: string | undefined
  placeholder?: string | undefined
  readonly?: Booleanish | undefined
  required?: Booleanish | undefined
  size?: Numberish | undefined
  src?: string | undefined
  step?: Numberish | undefined
  type?: InputTypeHTMLAttribute | undefined
  /** 允许 v-model/:value 保存任意原始值；DOM 字符串 value 之外由 _value 保留对象供 model 比较。 */
  value?: any // v-model 的 :value 可保存任意原始值，运行时由 _value 与 DOM 字符串分开。
  width?: Numberish | undefined
  onCancel?: ((payload: Event) => void) | undefined
}

/** 已弃用 `<keygen>` 元素的历史 JSX attributes。 */
export interface KeygenHTMLAttributes extends HTMLAttributes {
  autofocus?: Booleanish | undefined
  challenge?: string | undefined
  disabled?: Booleanish | undefined
  form?: string | undefined
  keytype?: string | undefined
  keyparams?: string | undefined
  name?: string | undefined
}

/** `<label>` 元素专用 JSX attributes。 */
export interface LabelHTMLAttributes extends HTMLAttributes {
  for?: string | undefined
  form?: string | undefined
}

/** `<li>` 元素专用 JSX attributes。 */
export interface LiHTMLAttributes extends HTMLAttributes {
  value?: string | ReadonlyArray<string> | number | undefined
}

/** `<link>` 元素专用 JSX attributes。 */
export interface LinkHTMLAttributes extends HTMLAttributes {
  as?: string | undefined
  crossorigin?: string | undefined
  href?: string | undefined
  hreflang?: string | undefined
  integrity?: string | undefined
  media?: string | undefined
  referrerpolicy?: HTMLAttributeReferrerPolicy | undefined
  rel?: string | undefined
  sizes?: string | undefined
  type?: string | undefined
  charset?: string | undefined
}

/** `<map>` 元素专用 JSX attributes。 */
export interface MapHTMLAttributes extends HTMLAttributes {
  name?: string | undefined
}

/** `<menu>` 元素专用 JSX attributes。 */
export interface MenuHTMLAttributes extends HTMLAttributes {
  type?: string | undefined
}

/** `<audio>`/`<video>` 共享的媒体 JSX attributes。 */
export interface MediaHTMLAttributes extends HTMLAttributes {
  autoplay?: Booleanish | undefined
  controls?: Booleanish | undefined
  controlslist?: string | undefined
  crossorigin?: string | undefined
  loop?: Booleanish | undefined
  mediagroup?: string | undefined
  muted?: Booleanish | undefined
  playsinline?: Booleanish | undefined
  preload?: string | undefined
  src?: string | undefined
}

/** `<meta>` 元素专用 JSX attributes。 */
export interface MetaHTMLAttributes extends HTMLAttributes {
  charset?: string | undefined
  content?: string | undefined
  httpequiv?: string | undefined
  name?: string | undefined
}

/** `<meter>` 元素专用 JSX attributes。 */
export interface MeterHTMLAttributes extends HTMLAttributes {
  form?: string | undefined
  high?: Numberish | undefined
  low?: Numberish | undefined
  max?: Numberish | undefined
  min?: Numberish | undefined
  optimum?: Numberish | undefined
  value?: string | ReadonlyArray<string> | number | undefined
}

/** `<q>` 元素专用 JSX attributes。 */
export interface QuoteHTMLAttributes extends HTMLAttributes {
  cite?: string | undefined
}

/** `<object>` 元素专用 JSX attributes。 */
export interface ObjectHTMLAttributes extends HTMLAttributes {
  classid?: string | undefined
  data?: string | undefined
  form?: string | undefined
  height?: Numberish | undefined
  name?: string | undefined
  type?: string | undefined
  usemap?: string | undefined
  width?: Numberish | undefined
  wmode?: string | undefined
}

/** `<ol>` 元素专用 JSX attributes。 */
export interface OlHTMLAttributes extends HTMLAttributes {
  reversed?: Booleanish | undefined
  start?: Numberish | undefined
  type?: '1' | 'a' | 'A' | 'i' | 'I' | undefined
}

/** `<optgroup>` 元素专用 JSX attributes。 */
export interface OptgroupHTMLAttributes extends HTMLAttributes {
  disabled?: Booleanish | undefined
  label?: string | undefined
}

/** `<option>` 元素专用 JSX attributes；value 允许任意值以适配 v-model。 */
export interface OptionHTMLAttributes extends HTMLAttributes {
  disabled?: Booleanish | undefined
  label?: string | undefined
  selected?: Booleanish | undefined
  /** 允许 v-model/:value 保存任意原始值；DOM 字符串 value 之外由 _value 保留对象供 model 比较。 */
  value?: any // v-model 的 :value 可保存任意原始值，运行时由 _value 与 DOM 字符串分开。
}

/** `<output>` 元素专用 JSX attributes。 */
export interface OutputHTMLAttributes extends HTMLAttributes {
  for?: string | undefined
  form?: string | undefined
  name?: string | undefined
}

/** `<param>` 元素专用 JSX attributes。 */
export interface ParamHTMLAttributes extends HTMLAttributes {
  name?: string | undefined
  value?: string | ReadonlyArray<string> | number | undefined
}

/** `<progress>` 元素专用 JSX attributes。 */
export interface ProgressHTMLAttributes extends HTMLAttributes {
  max?: Numberish | undefined
  value?: string | ReadonlyArray<string> | number | undefined
}

/** `<script>` 元素专用 JSX attributes。 */
export interface ScriptHTMLAttributes extends HTMLAttributes {
  async?: Booleanish | undefined
  /** @deprecated */
  charset?: string | undefined
  crossorigin?: string | undefined
  defer?: Booleanish | undefined
  integrity?: string | undefined
  nomodule?: Booleanish | undefined
  referrerpolicy?: HTMLAttributeReferrerPolicy | undefined
  nonce?: string | undefined
  src?: string | undefined
  type?: string | undefined
}

/** `<select>` 元素专用 JSX attributes；value 允许任意值以适配 v-model。 */
export interface SelectHTMLAttributes extends HTMLAttributes {
  autocomplete?: string | undefined
  autofocus?: Booleanish | undefined
  disabled?: Booleanish | undefined
  form?: string | undefined
  multiple?: Booleanish | undefined
  name?: string | undefined
  required?: Booleanish | undefined
  size?: Numberish | undefined
  /** 允许 v-model/:value 保存任意原始值；DOM 字符串 value 之外由 _value 保留对象供 model 比较。 */
  value?: any // v-model 的 :value 可保存任意原始值，运行时由 _value 与 DOM 字符串分开。
}

/** `<source>` 元素专用 JSX attributes。 */
export interface SourceHTMLAttributes extends HTMLAttributes {
  media?: string | undefined
  sizes?: string | undefined
  src?: string | undefined
  srcset?: string | undefined
  type?: string | undefined
}

/** `<style>` 元素专用 JSX attributes。 */
export interface StyleHTMLAttributes extends HTMLAttributes {
  media?: string | undefined
  nonce?: string | undefined
  scoped?: Booleanish | undefined
  type?: string | undefined
}

/** `<table>` 元素专用 JSX attributes。 */
export interface TableHTMLAttributes extends HTMLAttributes {
  cellpadding?: Numberish | undefined
  cellspacing?: Numberish | undefined
  summary?: string | undefined
  width?: Numberish | undefined
}

/** `<textarea>` 元素专用 JSX attributes。 */
export interface TextareaHTMLAttributes extends HTMLAttributes {
  autocomplete?: string | undefined
  autofocus?: Booleanish | undefined
  cols?: Numberish | undefined
  dirname?: string | undefined
  disabled?: Booleanish | undefined
  form?: string | undefined
  maxlength?: Numberish | undefined
  minlength?: Numberish | undefined
  name?: string | undefined
  placeholder?: string | undefined
  readonly?: Booleanish | undefined
  required?: Booleanish | undefined
  rows?: Numberish | undefined
  value?: string | ReadonlyArray<string> | number | null | undefined
  wrap?: string | undefined
}

/** `<td>` 元素专用 JSX attributes，包含部分历史表格布局字段。 */
export interface TdHTMLAttributes extends HTMLAttributes {
  align?: 'left' | 'center' | 'right' | 'justify' | 'char' | undefined
  colspan?: Numberish | undefined
  headers?: string | undefined
  rowspan?: Numberish | undefined
  scope?: string | undefined
  abbr?: string | undefined
  height?: Numberish | undefined
  width?: Numberish | undefined
  valign?: 'top' | 'middle' | 'bottom' | 'baseline' | undefined
}

/** `<th>` 元素专用 JSX attributes。 */
export interface ThHTMLAttributes extends HTMLAttributes {
  align?: 'left' | 'center' | 'right' | 'justify' | 'char' | undefined
  colspan?: Numberish | undefined
  headers?: string | undefined
  rowspan?: Numberish | undefined
  scope?: string | undefined
  abbr?: string | undefined
}

/** `<time>` 元素专用 JSX attributes。 */
export interface TimeHTMLAttributes extends HTMLAttributes {
  datetime?: string | undefined
}

/** `<track>` 媒体字幕轨道元素专用 JSX attributes。 */
export interface TrackHTMLAttributes extends HTMLAttributes {
  default?: Booleanish | undefined
  kind?: string | undefined
  label?: string | undefined
  src?: string | undefined
  srclang?: string | undefined
}

/** `<video>` 元素专用 JSX attributes。 */
export interface VideoHTMLAttributes extends MediaHTMLAttributes {
  height?: Numberish | undefined
  playsinline?: Booleanish | undefined
  poster?: string | undefined
  width?: Numberish | undefined
  disablePictureInPicture?: Booleanish | undefined
  disableRemotePlayback?: Booleanish | undefined
}

/** Electron `<webview>` 等环境的非标准 JSX attributes。 */
export interface WebViewHTMLAttributes extends HTMLAttributes {
  allowfullscreen?: Booleanish | undefined
  allowpopups?: Booleanish | undefined
  autoFocus?: Booleanish | undefined
  autosize?: Booleanish | undefined
  blinkfeatures?: string | undefined
  disableblinkfeatures?: string | undefined
  disableguestresize?: Booleanish | undefined
  disablewebsecurity?: Booleanish | undefined
  guestinstance?: string | undefined
  httpreferrer?: string | undefined
  nodeintegration?: Booleanish | undefined
  partition?: string | undefined
  plugins?: Booleanish | undefined
  preload?: string | undefined
  src?: string | undefined
  useragent?: string | undefined
  webpreferences?: string | undefined
}

/** 所有 SVG 元素共享的 JSX attributes、ARIA 与事件类型。 */
export interface SVGAttributes extends AriaAttributes, EventHandlers<Events> {
  innerHTML?: string | undefined

  /**
   * SVG 样式 attributes。
   * @see https://www.w3.org/TR/SVG/styling.html#ElementSpecificStyling
   */
  class?: ClassValue | undefined
  style?: StyleValue | undefined

  color?: string | undefined
  height?: Numberish | undefined
  id?: string | undefined
  lang?: string | undefined
  max?: Numberish | undefined
  media?: string | undefined
  method?: string | undefined
  min?: Numberish | undefined
  name?: string | undefined
  target?: string | undefined
  type?: string | undefined
  width?: Numberish | undefined

  // 浏览器中 SVG 元素支持的其他 HTML properties。
  role?: string | undefined
  tabindex?: Numberish | undefined
  crossOrigin?: 'anonymous' | 'use-credentials' | '' | undefined

  // SVG 专用 attributes。
  'accent-height'?: Numberish | undefined
  accumulate?: 'none' | 'sum' | undefined
  additive?: 'replace' | 'sum' | undefined
  'alignment-baseline'?:
    | 'auto'
    | 'baseline'
    | 'before-edge'
    | 'text-before-edge'
    | 'middle'
    | 'central'
    | 'after-edge'
    | 'text-after-edge'
    | 'ideographic'
    | 'alphabetic'
    | 'hanging'
    | 'mathematical'
    | 'inherit'
    | undefined
  allowReorder?: 'no' | 'yes' | undefined
  alphabetic?: Numberish | undefined
  amplitude?: Numberish | undefined
  'arabic-form'?: 'initial' | 'medial' | 'terminal' | 'isolated' | undefined
  ascent?: Numberish | undefined
  attributeName?: string | undefined
  attributeType?: string | undefined
  autoReverse?: Numberish | undefined
  azimuth?: Numberish | undefined
  baseFrequency?: Numberish | undefined
  'baseline-shift'?: Numberish | undefined
  baseProfile?: Numberish | undefined
  bbox?: Numberish | undefined
  begin?: Numberish | undefined
  bias?: Numberish | undefined
  by?: Numberish | undefined
  calcMode?: Numberish | undefined
  'cap-height'?: Numberish | undefined
  clip?: Numberish | undefined
  'clip-path'?: string | undefined
  clipPathUnits?: Numberish | undefined
  'clip-rule'?: Numberish | undefined
  'color-interpolation'?: Numberish | undefined
  'color-interpolation-filters'?:
    'auto' | 'sRGB' | 'linearRGB' | 'inherit' | undefined
  'color-profile'?: Numberish | undefined
  'color-rendering'?: Numberish | undefined
  contentScriptType?: Numberish | undefined
  contentStyleType?: Numberish | undefined
  cursor?: Numberish | undefined
  cx?: Numberish | undefined
  cy?: Numberish | undefined
  d?: string | undefined
  decelerate?: Numberish | undefined
  descent?: Numberish | undefined
  diffuseConstant?: Numberish | undefined
  direction?: Numberish | undefined
  display?: Numberish | undefined
  divisor?: Numberish | undefined
  'dominant-baseline'?: Numberish | undefined
  dur?: Numberish | undefined
  dx?: Numberish | undefined
  dy?: Numberish | undefined
  edgeMode?: Numberish | undefined
  elevation?: Numberish | undefined
  'enable-background'?: Numberish | undefined
  end?: Numberish | undefined
  exponent?: Numberish | undefined
  externalResourcesRequired?: Numberish | undefined
  fill?: string | undefined
  'fill-opacity'?: Numberish | undefined
  'fill-rule'?: 'nonzero' | 'evenodd' | 'inherit' | undefined
  filter?: string | undefined
  filterRes?: Numberish | undefined
  filterUnits?: Numberish | undefined
  'flood-color'?: Numberish | undefined
  'flood-opacity'?: Numberish | undefined
  focusable?: Numberish | undefined
  'font-family'?: string | undefined
  'font-size'?: Numberish | undefined
  'font-size-adjust'?: Numberish | undefined
  'font-stretch'?: Numberish | undefined
  'font-style'?: Numberish | undefined
  'font-variant'?: Numberish | undefined
  'font-weight'?: Numberish | undefined
  format?: Numberish | undefined
  from?: Numberish | undefined
  fx?: Numberish | undefined
  fy?: Numberish | undefined
  g1?: Numberish | undefined
  g2?: Numberish | undefined
  'glyph-name'?: Numberish | undefined
  'glyph-orientation-horizontal'?: Numberish | undefined
  'glyph-orientation-vertical'?: Numberish | undefined
  glyphRef?: Numberish | undefined
  gradientTransform?: string | undefined
  gradientUnits?: string | undefined
  hanging?: Numberish | undefined
  'horiz-adv-x'?: Numberish | undefined
  'horiz-origin-x'?: Numberish | undefined
  href?: string | undefined
  ideographic?: Numberish | undefined
  'image-rendering'?: Numberish | undefined
  in2?: Numberish | undefined
  in?: string | undefined
  intercept?: Numberish | undefined
  k1?: Numberish | undefined
  k2?: Numberish | undefined
  k3?: Numberish | undefined
  k4?: Numberish | undefined
  k?: Numberish | undefined
  kernelMatrix?: Numberish | undefined
  kernelUnitLength?: Numberish | undefined
  kerning?: Numberish | undefined
  keyPoints?: Numberish | undefined
  keySplines?: Numberish | undefined
  keyTimes?: Numberish | undefined
  lengthAdjust?: Numberish | undefined
  'letter-spacing'?: Numberish | undefined
  'lighting-color'?: Numberish | undefined
  limitingConeAngle?: Numberish | undefined
  local?: Numberish | undefined
  'marker-end'?: string | undefined
  markerHeight?: Numberish | undefined
  'marker-mid'?: string | undefined
  'marker-start'?: string | undefined
  markerUnits?: Numberish | undefined
  markerWidth?: Numberish | undefined
  mask?: string | undefined
  maskContentUnits?: Numberish | undefined
  maskUnits?: Numberish | undefined
  mathematical?: Numberish | undefined
  mode?: Numberish | undefined
  numOctaves?: Numberish | undefined
  offset?: Numberish | undefined
  opacity?: Numberish | undefined
  operator?: Numberish | undefined
  order?: Numberish | undefined
  orient?: Numberish | undefined
  orientation?: Numberish | undefined
  origin?: Numberish | undefined
  overflow?: Numberish | undefined
  'overline-position'?: Numberish | undefined
  'overline-thickness'?: Numberish | undefined
  'paint-order'?: Numberish | undefined
  'panose-1'?: Numberish | undefined
  pathLength?: Numberish | undefined
  patternContentUnits?: string | undefined
  patternTransform?: Numberish | undefined
  patternUnits?: string | undefined
  'pointer-events'?: Numberish | undefined
  points?: string | undefined
  pointsAtX?: Numberish | undefined
  pointsAtY?: Numberish | undefined
  pointsAtZ?: Numberish | undefined
  preserveAlpha?: Numberish | undefined
  preserveAspectRatio?: string | undefined
  primitiveUnits?: Numberish | undefined
  r?: Numberish | undefined
  radius?: Numberish | undefined
  refX?: Numberish | undefined
  refY?: Numberish | undefined
  renderingIntent?: Numberish | undefined
  repeatCount?: Numberish | undefined
  repeatDur?: Numberish | undefined
  requiredExtensions?: Numberish | undefined
  requiredFeatures?: Numberish | undefined
  restart?: Numberish | undefined
  result?: string | undefined
  rotate?: Numberish | undefined
  rx?: Numberish | undefined
  ry?: Numberish | undefined
  scale?: Numberish | undefined
  seed?: Numberish | undefined
  'shape-rendering'?: Numberish | undefined
  slope?: Numberish | undefined
  spacing?: Numberish | undefined
  specularConstant?: Numberish | undefined
  specularExponent?: Numberish | undefined
  speed?: Numberish | undefined
  spreadMethod?: string | undefined
  startOffset?: Numberish | undefined
  stdDeviation?: Numberish | undefined
  stemh?: Numberish | undefined
  stemv?: Numberish | undefined
  stitchTiles?: Numberish | undefined
  'stop-color'?: string | undefined
  'stop-opacity'?: Numberish | undefined
  'strikethrough-position'?: Numberish | undefined
  'strikethrough-thickness'?: Numberish | undefined
  string?: Numberish | undefined
  stroke?: string | undefined
  'stroke-dasharray'?: Numberish | undefined
  'stroke-dashoffset'?: Numberish | undefined
  'stroke-linecap'?: 'butt' | 'round' | 'square' | 'inherit' | undefined
  'stroke-linejoin'?: 'miter' | 'round' | 'bevel' | 'inherit' | undefined
  'stroke-miterlimit'?: Numberish | undefined
  'stroke-opacity'?: Numberish | undefined
  'stroke-width'?: Numberish | undefined
  surfaceScale?: Numberish | undefined
  systemLanguage?: Numberish | undefined
  tableValues?: Numberish | undefined
  targetX?: Numberish | undefined
  targetY?: Numberish | undefined
  'text-anchor'?: string | undefined
  'text-decoration'?: Numberish | undefined
  textLength?: Numberish | undefined
  'text-rendering'?: Numberish | undefined
  to?: Numberish | undefined
  transform?: string | undefined
  u1?: Numberish | undefined
  u2?: Numberish | undefined
  'underline-position'?: Numberish | undefined
  'underline-thickness'?: Numberish | undefined
  unicode?: Numberish | undefined
  'unicode-bidi'?: Numberish | undefined
  'unicode-range'?: Numberish | undefined
  'unitsPer-em'?: Numberish | undefined
  'v-alphabetic'?: Numberish | undefined
  values?: string | undefined
  'vector-effect'?: Numberish | undefined
  version?: string | undefined
  'vert-adv-y'?: Numberish | undefined
  'vert-origin-x'?: Numberish | undefined
  'vert-origin-y'?: Numberish | undefined
  'v-hanging'?: Numberish | undefined
  'v-ideographic'?: Numberish | undefined
  viewBox?: string | undefined
  viewTarget?: Numberish | undefined
  visibility?: Numberish | undefined
  'v-mathematical'?: Numberish | undefined
  widths?: Numberish | undefined
  'word-spacing'?: Numberish | undefined
  'writing-mode'?: Numberish | undefined
  x1?: Numberish | undefined
  x2?: Numberish | undefined
  x?: Numberish | undefined
  xChannelSelector?: string | undefined
  'x-height'?: Numberish | undefined
  xlinkActuate?: string | undefined
  xlinkArcrole?: string | undefined
  xlinkHref?: string | undefined
  xlinkRole?: string | undefined
  xlinkShow?: string | undefined
  xlinkTitle?: string | undefined
  xlinkType?: string | undefined
  xmlns?: string | undefined
  xmlnsXlink?: string | undefined
  y1?: Numberish | undefined
  y2?: Numberish | undefined
  y?: Numberish | undefined
  yChannelSelector?: string | undefined
  z?: Numberish | undefined
  zoomAndPan?: string | undefined
}

/** JSX intrinsic tag 名称到对应 HTML/SVG attributes 类型的完整映射。 */
export interface IntrinsicElementAttributes {
  a: AnchorHTMLAttributes
  abbr: HTMLAttributes
  address: HTMLAttributes
  area: AreaHTMLAttributes
  article: HTMLAttributes
  aside: HTMLAttributes
  audio: AudioHTMLAttributes
  b: HTMLAttributes
  base: BaseHTMLAttributes
  bdi: HTMLAttributes
  bdo: HTMLAttributes
  blockquote: BlockquoteHTMLAttributes
  body: HTMLAttributes
  br: HTMLAttributes
  button: ButtonHTMLAttributes
  canvas: CanvasHTMLAttributes
  caption: HTMLAttributes
  cite: HTMLAttributes
  code: HTMLAttributes
  col: ColHTMLAttributes
  colgroup: ColgroupHTMLAttributes
  data: DataHTMLAttributes
  datalist: HTMLAttributes
  dd: HTMLAttributes
  del: DelHTMLAttributes
  details: DetailsHTMLAttributes
  dfn: HTMLAttributes
  dialog: DialogHTMLAttributes
  div: HTMLAttributes
  dl: HTMLAttributes
  dt: HTMLAttributes
  em: HTMLAttributes
  embed: EmbedHTMLAttributes
  fieldset: FieldsetHTMLAttributes
  figcaption: HTMLAttributes
  figure: HTMLAttributes
  footer: HTMLAttributes
  form: FormHTMLAttributes
  h1: HTMLAttributes
  h2: HTMLAttributes
  h3: HTMLAttributes
  h4: HTMLAttributes
  h5: HTMLAttributes
  h6: HTMLAttributes
  head: HTMLAttributes
  header: HTMLAttributes
  hgroup: HTMLAttributes
  hr: HTMLAttributes
  html: HtmlHTMLAttributes
  i: HTMLAttributes
  iframe: IframeHTMLAttributes
  img: ImgHTMLAttributes
  input: InputHTMLAttributes
  ins: InsHTMLAttributes
  kbd: HTMLAttributes
  keygen: KeygenHTMLAttributes
  label: LabelHTMLAttributes
  legend: HTMLAttributes
  li: LiHTMLAttributes
  link: LinkHTMLAttributes
  main: HTMLAttributes
  map: MapHTMLAttributes
  mark: HTMLAttributes
  menu: MenuHTMLAttributes
  meta: MetaHTMLAttributes
  meter: MeterHTMLAttributes
  nav: HTMLAttributes
  noindex: HTMLAttributes
  noscript: HTMLAttributes
  object: ObjectHTMLAttributes
  ol: OlHTMLAttributes
  optgroup: OptgroupHTMLAttributes
  option: OptionHTMLAttributes
  output: OutputHTMLAttributes
  p: HTMLAttributes
  param: ParamHTMLAttributes
  picture: HTMLAttributes
  pre: HTMLAttributes
  progress: ProgressHTMLAttributes
  q: QuoteHTMLAttributes
  rp: HTMLAttributes
  rt: HTMLAttributes
  ruby: HTMLAttributes
  s: HTMLAttributes
  samp: HTMLAttributes
  script: ScriptHTMLAttributes
  section: HTMLAttributes
  select: SelectHTMLAttributes
  small: HTMLAttributes
  source: SourceHTMLAttributes
  span: HTMLAttributes
  strong: HTMLAttributes
  style: StyleHTMLAttributes
  sub: HTMLAttributes
  summary: HTMLAttributes
  sup: HTMLAttributes
  table: TableHTMLAttributes
  template: HTMLAttributes
  tbody: HTMLAttributes
  td: TdHTMLAttributes
  textarea: TextareaHTMLAttributes
  tfoot: HTMLAttributes
  th: ThHTMLAttributes
  thead: HTMLAttributes
  time: TimeHTMLAttributes
  title: HTMLAttributes
  tr: HTMLAttributes
  track: TrackHTMLAttributes
  u: HTMLAttributes
  ul: HTMLAttributes
  var: HTMLAttributes
  video: VideoHTMLAttributes
  wbr: HTMLAttributes
  webview: WebViewHTMLAttributes

  // SVG 元素映射。
  svg: SVGAttributes

  animate: SVGAttributes
  animateMotion: SVGAttributes
  animateTransform: SVGAttributes
  circle: SVGAttributes
  clipPath: SVGAttributes
  defs: SVGAttributes
  desc: SVGAttributes
  ellipse: SVGAttributes
  feBlend: SVGAttributes
  feColorMatrix: SVGAttributes
  feComponentTransfer: SVGAttributes
  feComposite: SVGAttributes
  feConvolveMatrix: SVGAttributes
  feDiffuseLighting: SVGAttributes
  feDisplacementMap: SVGAttributes
  feDistantLight: SVGAttributes
  feDropShadow: SVGAttributes
  feFlood: SVGAttributes
  feFuncA: SVGAttributes
  feFuncB: SVGAttributes
  feFuncG: SVGAttributes
  feFuncR: SVGAttributes
  feGaussianBlur: SVGAttributes
  feImage: SVGAttributes
  feMerge: SVGAttributes
  feMergeNode: SVGAttributes
  feMorphology: SVGAttributes
  feOffset: SVGAttributes
  fePointLight: SVGAttributes
  feSpecularLighting: SVGAttributes
  feSpotLight: SVGAttributes
  feTile: SVGAttributes
  feTurbulence: SVGAttributes
  filter: SVGAttributes
  foreignObject: SVGAttributes
  g: SVGAttributes
  image: SVGAttributes
  line: SVGAttributes
  linearGradient: SVGAttributes
  marker: SVGAttributes
  mask: SVGAttributes
  metadata: SVGAttributes
  mpath: SVGAttributes
  path: SVGAttributes
  pattern: SVGAttributes
  polygon: SVGAttributes
  polyline: SVGAttributes
  radialGradient: SVGAttributes
  rect: SVGAttributes
  set: SVGAttributes
  stop: SVGAttributes
  switch: SVGAttributes
  symbol: SVGAttributes
  text: SVGAttributes
  textPath: SVGAttributes
  tspan: SVGAttributes
  use: SVGAttributes
  view: SVGAttributes
}

/** Vue JSX 支持的标准 DOM 事件 prop 名到原生 Event 类型映射。 */
export interface Events {
  // 剪贴板事件。
  onCopy: ClipboardEvent
  onCut: ClipboardEvent
  onPaste: ClipboardEvent

  // 输入法组合事件。
  onCompositionend: CompositionEvent
  onCompositionstart: CompositionEvent
  onCompositionupdate: CompositionEvent

  // 拖放事件。
  onDrag: DragEvent
  onDragend: DragEvent
  onDragenter: DragEvent
  onDragexit: DragEvent
  onDragleave: DragEvent
  onDragover: DragEvent
  onDragstart: DragEvent
  onDrop: DragEvent

  // 焦点事件。
  onFocus: FocusEvent
  onFocusin: FocusEvent
  onFocusout: FocusEvent
  onBlur: FocusEvent

  // 表单事件。
  onChange: Event
  onBeforeinput: InputEvent
  onFormdata: FormDataEvent
  onInput: InputEvent
  onReset: Event
  onSubmit: SubmitEvent
  onInvalid: Event

  // 全屏事件。
  onFullscreenchange: Event
  onFullscreenerror: Event

  // 图像事件。
  onLoad: Event
  onError: Event

  // 键盘事件。
  onKeydown: KeyboardEvent
  onKeypress: KeyboardEvent
  onKeyup: KeyboardEvent

  // 鼠标事件。
  onDblclick: MouseEvent
  onMousedown: MouseEvent
  onMouseenter: MouseEvent
  onMouseleave: MouseEvent
  onMousemove: MouseEvent
  onMouseout: MouseEvent
  onMouseover: MouseEvent
  onMouseup: MouseEvent

  // 媒体事件。
  onAbort: UIEvent
  onCanplay: Event
  onCanplaythrough: Event
  onDurationchange: Event
  onEmptied: Event
  onEncrypted: MediaEncryptedEvent
  onEnded: Event
  onLoadeddata: Event
  onLoadedmetadata: Event
  onLoadstart: Event
  onPause: Event
  onPlay: Event
  onPlaying: Event
  onProgress: ProgressEvent
  onRatechange: Event
  onSeeked: Event
  onSeeking: Event
  onStalled: Event
  onSuspend: Event
  onTimeupdate: Event
  onVolumechange: Event
  onWaiting: Event

  // 文本选择事件。
  onSelect: Event

  // 滚动事件。
  onScroll: Event
  onScrollend: Event

  // 触摸事件。
  onTouchcancel: TouchEvent
  onTouchend: TouchEvent
  onTouchmove: TouchEvent
  onTouchstart: TouchEvent

  // Pointer Events 指针事件。
  onAuxclick: PointerEvent
  onClick: PointerEvent
  onContextmenu: PointerEvent
  onGotpointercapture: PointerEvent
  onLostpointercapture: PointerEvent
  onPointerdown: PointerEvent
  onPointermove: PointerEvent
  onPointerup: PointerEvent
  onPointercancel: PointerEvent
  onPointerenter: PointerEvent
  onPointerleave: PointerEvent
  onPointerover: PointerEvent
  onPointerout: PointerEvent

  // Popover 事件。
  onBeforetoggle: ToggleEvent
  onToggle: ToggleEvent

  // 滚轮事件。
  onWheel: WheelEvent

  // CSS Animation 事件。
  onAnimationcancel: AnimationEvent
  onAnimationstart: AnimationEvent
  onAnimationend: AnimationEvent
  onAnimationiteration: AnimationEvent

  // 内容安全策略事件。
  onSecuritypolicyviolation: SecurityPolicyViolationEvent

  // CSS Transition 事件。
  onTransitioncancel: TransitionEvent
  onTransitionend: TransitionEvent
  onTransitionrun: TransitionEvent
  onTransitionstart: TransitionEvent
}

/** 把事件类型映射转换成可选的 `(payload) => void` JSX 监听器 props。 */
type EventHandlers<E> = {
  [K in keyof E]?: E[K] extends (...args: any) => any
    ? E[K]
    : (payload: E[K]) => void
}

import type { VNodeRef } from '@vue/runtime-core'

/** Vue 在原生元素 JSX 上消费、不会直接落到 DOM 的保留 props。 */
export interface ReservedProps {
  /** VNode diff 身份键，不会作为普通 DOM attribute 写入。 */
  key?: PropertyKey | undefined
  /** 模板/函数 ref 描述。 */
  ref?: VNodeRef | undefined
  /** ref 是否位于 v-for 中，需要聚合为数组。 */
  ref_for?: boolean | undefined
  /** setupState 中接收该 ref 的显式键。 */
  ref_key?: string | undefined
}

/** 每个原生 JSX 标签的专用 attributes 与 Vue 保留 VNode props 交叉类型。 */
export type NativeElements = {
  [K in keyof IntrinsicElementAttributes]: IntrinsicElementAttributes[K] &
    ReservedProps
}
