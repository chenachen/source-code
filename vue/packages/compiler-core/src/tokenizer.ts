/**
 * This Tokenizer is adapted from htmlparser2 under the MIT License listed at
 * https://github.com/fb55/htmlparser2/blob/master/LICENSE

Copyright 2010, 2011, Chris Winberry <chris@winberry.net>. All rights reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
 */

import { ErrorCodes } from './errors'
import type { ElementNode, Position } from './ast'

/**
 * 注意：`entities` 只应进入非浏览器构建。浏览器编译器借助原生 HTML 元素解码实体，
 * 因此下面导入的所有 API 都必须只出现在 `!__BROWSER__` 分支，构建工具才能完整 tree-shake。
 */
import {
  DecodingMode,
  EntityDecoder,
  fromCodePoint,
  htmlDecodeTree,
} from 'entities/decode'

/** tokenizer 的顶层语法模式，决定特殊标签内容如何扫描。 */
export enum ParseMode {
  /** 平台无关模式，所有标签内容均按普通模板文本解析。 */
  BASE,
  /** HTML 模式，启用 script/style RAWTEXT 与 title/textarea RCDATA 规则。 */
  HTML,
  /** SFC 模式，根级非 template 块按原始文本读取。 */
  SFC,
}

/** 热路径中使用的 ASCII 字符码，避免循环内反复创建单字符字符串。 */
export enum CharCodes {
  /** 水平制表符 `\t`，属于 HTML 空白。 */
  Tab = 0x9,
  /** 换行符 `\n`，同时用于建立源码行号索引。 */
  NewLine = 0xa,
  /** 换页符 `\f`，属于 HTML 空白。 */
  FormFeed = 0xc,
  /** 回车符 `\r`，属于 HTML 空白。 */
  CarriageReturn = 0xd,
  /** 普通空格。 */
  Space = 0x20,
  /** 感叹号 `!`，用于识别注释和声明。 */
  ExclamationMark = 0x21,
  /** 井号 `#`，用于十进制/十六进制数字实体。 */
  Number = 0x23,
  /** 与号 `&`，表示 HTML 实体开始。 */
  Amp = 0x26,
  /** 单引号，包围属性值。 */
  SingleQuote = 0x27,
  /** 双引号，包围属性值。 */
  DoubleQuote = 0x22,
  /** 反引号；在未加引号的属性值中属于非法字符。 */
  GraveAccent = 96,
  /** 连字符 `-`，用于注释定界符及 `v-` 指令前缀。 */
  Dash = 0x2d,
  /** 斜杠 `/`，用于结束标签和自闭合标签。 */
  Slash = 0x2f,
  /** 数字字符范围的下界 `0`。 */
  Zero = 0x30,
  /** 数字字符范围的上界 `9`。 */
  Nine = 0x39,
  /** 分号 `;`，通常结束 HTML 实体。 */
  Semi = 0x3b,
  /** 小于号 `<`，表示标签或声明开始。 */
  Lt = 0x3c,
  /** 等号 `=`，分隔属性名和值。 */
  Eq = 0x3d,
  /** 大于号 `>`，结束标签。 */
  Gt = 0x3e,
  /** 问号 `?`，用于识别 XML processing instruction。 */
  Questionmark = 0x3f,
  /** ASCII 大写字母范围下界 `A`。 */
  UpperA = 0x41,
  /** ASCII 小写字母范围下界 `a`。 */
  LowerA = 0x61,
  /** 十六进制大写字母范围上界 `F`。 */
  UpperF = 0x46,
  /** 十六进制小写字母范围上界 `f`。 */
  LowerF = 0x66,
  /** ASCII 大写字母范围上界 `Z`。 */
  UpperZ = 0x5a,
  /** ASCII 小写字母范围上界 `z`。 */
  LowerZ = 0x7a,
  /** 小写 `x`，用于数字实体的十六进制前缀。 */
  LowerX = 0x78,
  /** 小写 `v`，用于识别 `v-` 指令。 */
  LowerV = 0x76,
  /** 点号 `.`，分隔指令修饰符。 */
  Dot = 0x2e,
  /** 冒号 `:`，是 `v-bind` 的简写前缀。 */
  Colon = 0x3a,
  /** `@`，是 `v-on` 的简写前缀。 */
  At = 0x40,
  /** 左方括号 `[`，开始动态指令参数。 */
  LeftSquare = 91,
  /** 右方括号 `]`，结束动态指令参数。 */
  RightSquare = 93,
}

/** 默认插值开始分隔符 `{{` 的字符码。 */
const defaultDelimitersOpen = new Uint8Array([123, 123])
/** 默认插值结束分隔符 `}}` 的字符码。 */
const defaultDelimitersClose = new Uint8Array([125, 125])

/** tokenizer 有限状态机的全部状态。 */
export enum State {
  /** 扫描普通文本，也是初始状态。 */
  Text = 1,

  /** 正在匹配插值开始分隔符。 */
  InterpolationOpen,
  /** 扫描插值表达式内容。 */
  Interpolation,
  /** 正在匹配插值结束分隔符。 */
  InterpolationClose,

  /** 刚读过 `<`，等待标签名、结束标签、注释或声明。 */
  BeforeTagName,
  /** 扫描开始标签名称。 */
  InTagName,
  /** 已读到 `/`，确认开始标签是否以 `/>` 自闭合。 */
  InSelfClosingTag,
  /** 已读到 `</`，等待结束标签名。 */
  BeforeClosingTagName,
  /** 扫描结束标签名称。 */
  InClosingTagName,
  /** 结束标签名之后等待 `>`，并诊断多余属性或 `/`。 */
  AfterClosingTagName,

  /** 标签名或上一属性结束后，等待下一个属性名。 */
  BeforeAttrName,
  /** 扫描普通属性名。 */
  InAttrName,
  /** 扫描 `v-` 后的指令规范名。 */
  InDirName,
  /** 扫描静态指令参数。 */
  InDirArg,
  /** 扫描方括号内的动态指令参数。 */
  InDirDynamicArg,
  /** 扫描点号后的指令修饰符。 */
  InDirModifier,
  /** 属性名结束后等待等号、下个属性或标签结束。 */
  AfterAttrName,
  /** 等号后等待属性值或引号。 */
  BeforeAttrValue,
  /** 扫描双引号包围的属性值。 */
  InAttrValueDq,
  /** 扫描单引号包围的属性值。 */
  InAttrValueSq,
  /** 扫描未加引号的属性值。 */
  InAttrValueNq,

  /** 已读到 `<!`，判断是注释、CDATA 还是其他声明。 */
  BeforeDeclaration,
  /** 扫描普通 `<!...>` 声明内容。 */
  InDeclaration,

  /** 扫描 `<?...>` XML processing instruction。 */
  InProcessingInstruction,

  /** 正在确认 `<!--` 注释开始序列。 */
  BeforeComment,
  /** 正在匹配 `CDATA[` 固定序列。 */
  CDATASequence,
  /** 扫描错误开启但仍需容错消费的特殊注释。 */
  InSpecialComment,
  /** 扫描普通注释或 CDATA，直到匹配对应结束序列。 */
  InCommentLike,

  /** 识别以 `s` 开头的 script/style 特殊标签。 */
  BeforeSpecialS,
  /** 识别以 `t` 开头的 title/textarea 特殊标签。 */
  BeforeSpecialT,
  /** 匹配特殊标签名的剩余固定字符。 */
  SpecialStartSequence,
  /** 在 RCDATA/RAWTEXT 中寻找对应结束标签。 */
  InRCDATA,

  /** 交给实体解码器消费 `&...`。 */
  InEntity,

  /** SFC 根层扫描自定义块标签名，以决定是否进入原始文本模式。 */
  InSFCRootTagName,
}

/** HTML 标签名首字符只能是 ASCII 字母 `a-z` / `A-Z`。 */
function isTagStartChar(c: number): boolean {
  return (
    (c >= CharCodes.LowerA && c <= CharCodes.LowerZ) ||
    (c >= CharCodes.UpperA && c <= CharCodes.UpperZ)
  )
}

/** 是否为 HTML 语法认可的五种空白字符。 */
export function isWhitespace(c: number): boolean {
  return (
    c === CharCodes.Space ||
    c === CharCodes.NewLine ||
    c === CharCodes.Tab ||
    c === CharCodes.FormFeed ||
    c === CharCodes.CarriageReturn
  )
}

/** 字符是否结束标签名/属性名片段。 */
function isEndOfTagSection(c: number): boolean {
  return c === CharCodes.Slash || c === CharCodes.Gt || isWhitespace(c)
}

/** 把短 ASCII 匹配串转换为 Uint8Array，供状态机逐字符比较。 */
export function toCharCodes(str: string): Uint8Array {
  const ret = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    ret[i] = str.charCodeAt(i)
  }
  return ret
}

/** 属性值的书写形式；parser 据此还原精确源码范围并校验空值。 */
export enum QuoteType {
  /** 属性没有值，例如 `<input disabled>`。 */
  NoValue = 0,
  /** 属性值未加引号。 */
  Unquoted = 1,
  /** 属性值由单引号包围。 */
  Single = 2,
  /** 属性值由双引号包围。 */
  Double = 3,
}

/**
 * tokenizer 事件回调。
 *
 * 所有 start/end 都是源码偏移；tokenizer 不创建 AST，只把识别出的范围交给 parser。
 * 实体单独回调，使 parser 能拼接解码文本同时保留原实体的 location。
 */
export interface Callbacks {
  /** 报告一段无需实体解码的普通文本源码范围。 */
  ontext(start: number, endIndex: number): void
  /** 报告一个已解码文本实体及其原始源码范围。 */
  ontextentity(char: string, start: number, endIndex: number): void

  /** 包含起止分隔符的插值范围。 */
  oninterpolation(start: number, endIndex: number): void

  /** 报告开始标签名范围，使 parser 创建并压入元素节点。 */
  onopentagname(start: number, endIndex: number): void
  /** 报告普通 `>`，使 parser 完成当前开始标签。 */
  onopentagend(endIndex: number): void
  /** 报告 `/>`，完成当前标签但不把元素留在开放栈中。 */
  onselfclosingtag(endIndex: number): void
  /** 报告结束标签名，parser 据此关闭元素栈。 */
  onclosetag(start: number, endIndex: number): void

  /** 报告一段普通属性值文本。 */
  onattribdata(start: number, endIndex: number): void
  /** 报告属性值中的一个已解码实体。 */
  onattribentity(char: string, start: number, end: number): void
  /** 报告属性值结束，并说明采用何种引号形式。 */
  onattribend(quote: QuoteType, endIndex: number): void
  /** 报告普通属性名范围。 */
  onattribname(start: number, endIndex: number): void
  /** 报告属性名完整结束位置，用于补齐精确 location。 */
  onattribnameend(endIndex: number): void

  /** 报告 `v-` 后的指令规范名。 */
  ondirname(start: number, endIndex: number): void
  /** 报告静态或动态指令参数。 */
  ondirarg(start: number, endIndex: number): void
  /** 报告一个指令修饰符。 */
  ondirmodifier(start: number, endIndex: number): void

  /** 报告不含定界符的注释内容范围。 */
  oncomment(start: number, endIndex: number): void
  /** 报告不含定界符的 CDATA 内容范围。 */
  oncdata(start: number, endIndex: number): void

  /** XML processing instruction；Vue 只用于诊断，不生成运行时节点。 */
  onprocessinginstruction(start: number, endIndex: number): void
  /** 通知 parser 输入已经全部消费。 */
  onend(): void
  /** 报告可恢复的词法错误码和发生偏移，扫描通常仍会继续。 */
  onerr(code: ErrorCodes, index: number): void
}

/**
 * 需要跨多个字符匹配的固定序列。
 *
 * 不另建 Script/Style/Title 起始串；进入特殊标签时复用对应 `*End` 序列，
 * 只把匹配 offset 调到标签名部分。这能减少常量，也让起止标签大小写匹配逻辑一致。
 */
export const Sequences: {
  /** `<![CDATA[` 中紧随 `<![` 的 `CDATA[`。 */
  Cdata: Uint8Array
  /** CDATA 结束序列 `]]>`。 */
  CdataEnd: Uint8Array
  /** HTML 注释结束序列 `-->`。 */
  CommentEnd: Uint8Array
  /** script 结束标签前缀 `</script`。 */
  ScriptEnd: Uint8Array
  /** style 结束标签前缀 `</style`。 */
  StyleEnd: Uint8Array
  /** title 结束标签前缀 `</title`。 */
  TitleEnd: Uint8Array
  /** textarea 结束标签前缀 `</textarea`。 */
  TextareaEnd: Uint8Array
} = {
  Cdata: new Uint8Array([0x43, 0x44, 0x41, 0x54, 0x41, 0x5b]), // CDATA[
  CdataEnd: new Uint8Array([0x5d, 0x5d, 0x3e]), // ]]>
  CommentEnd: new Uint8Array([0x2d, 0x2d, 0x3e]), // `-->`
  ScriptEnd: new Uint8Array([0x3c, 0x2f, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74]), // `</script`
  StyleEnd: new Uint8Array([0x3c, 0x2f, 0x73, 0x74, 0x79, 0x6c, 0x65]), // `</style`
  TitleEnd: new Uint8Array([0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65]), // `</title`
  TextareaEnd: new Uint8Array([
    0x3c, 0x2f, 116, 101, 120, 116, 97, 114, 101, 97,
  ]), // `</textarea
}

/**
 * 面向 Vue 模板的单遍字符 tokenizer。
 *
 * 状态机源自 htmlparser2，并加入插值、指令、SFC 根块和容错编辑态规则。
 * 性能关键路径只比较字符码；位置对象、AST 节点和字符串切片均由 parser 按事件创建。
 */
export default class Tokenizer {
  /** 当前有限状态机状态。 */
  public state: State = State.Text
  /** 当前完整输入缓冲区。 */
  private buffer = ''
  /** 尚未发送回调的当前片段起始偏移。 */
  public sectionStart = 0
  /** 正在检查的字符偏移。 */
  private index = 0
  /** 当前 HTML 实体 `&` 的偏移。 */
  private entityStart = 0
  /** 进入实体子状态前的状态；实体结束后回到这里。 */
  private baseState = State.Text
  /** 是否正在按特殊标签的 RCDATA/RAWTEXT 规则寻找结束标签。 */
  public inRCDATA = false
  /** 是否位于 XML 命名空间；XML 中禁用 HTML 特殊标签规则。 */
  public inXML = false
  /** 是否位于 `v-pre`；开启时不识别插值分隔符。 */
  public inVPre = false
  /** 已扫描换行的偏移表，用于快速计算行列。 */
  private newlines: number[] = []

  /** 非浏览器构建使用的流式 HTML 实体解码器。 */
  private readonly entityDecoder?: EntityDecoder

  /** 当前顶层解析模式。 */
  public mode: ParseMode = ParseMode.BASE
  /** 是否位于 SFC 根层级。 */
  public get inSFCRoot(): boolean {
    return this.mode === ParseMode.SFC && this.stack.length === 0
  }

  /**
   * 创建 tokenizer，并共享 parser 的开放元素栈与事件回调；Node 构建额外初始化实体解码器。
   */
  constructor(
    private readonly stack: ElementNode[],
    private readonly cbs: Callbacks,
  ) {
    if (!__BROWSER__) {
      this.entityDecoder = new EntityDecoder(htmlDecodeTree, (cp, consumed) =>
        this.emitCodePoint(cp, consumed),
      )
    }
  }

  /** 复用 tokenizer 前清空全部扫描状态与自定义分隔符。 */
  public reset(): void {
    this.state = State.Text
    this.mode = ParseMode.BASE
    this.buffer = ''
    this.sectionStart = 0
    this.index = 0
    this.baseState = State.Text
    this.inRCDATA = false
    this.currentSequence = undefined!
    this.newlines.length = 0
    this.delimiterOpen = defaultDelimitersOpen
    this.delimiterClose = defaultDelimitersClose
  }

  /**
   * 根据已记录的换行偏移生成 Position。
   *
   * 调用只会查询已经扫描过的位置，故换行表必然完整。短模板从尾部线性查找更快；
   * 超过 100 个换行后改用二分，避免大文件位置计算退化为 O(n²)。
   */
  public getPos(index: number): Position {
    let line = 1
    let column = index + 1
    const length = this.newlines.length
    let j = -1
    if (length > 100) {
      let l = -1
      let r = length
      while (l + 1 < r) {
        const m = (l + r) >>> 1
        this.newlines[m] < index ? (l = m) : (r = m)
      }
      j = l
    } else {
      for (let i = length - 1; i >= 0; i--) {
        if (index > this.newlines[i]) {
          j = i
          break
        }
      }
    }

    if (j >= 0) {
      line = j + 2
      column = index - this.newlines[j]
    }

    return {
      column,
      line,
      offset: index,
    }
  }

  /** 查看下一个字符码，不移动扫描位置。 */
  private peek() {
    return this.buffer.charCodeAt(this.index + 1)
  }

  /** 扫描普通文本，并在 `<`、实体或插值开始符处切换状态。 */
  private stateText(c: number): void {
    if (c === CharCodes.Lt) {
      if (this.index > this.sectionStart) {
        this.cbs.ontext(this.sectionStart, this.index)
      }
      this.state = State.BeforeTagName
      this.sectionStart = this.index
    } else if (!__BROWSER__ && c === CharCodes.Amp) {
      this.startEntity()
    } else if (!this.inVPre && c === this.delimiterOpen[0]) {
      this.state = State.InterpolationOpen
      this.delimiterIndex = 0
      this.stateInterpolationOpen(c)
    }
  }

  /** 当前插值开始分隔符的字符码，可由 parser options 覆盖。 */
  public delimiterOpen: Uint8Array = defaultDelimitersOpen
  /** 当前插值结束分隔符的字符码，与 `delimiterOpen` 在每轮解析前成对重置。 */
  public delimiterClose: Uint8Array = defaultDelimitersClose
  /** 已匹配到分隔符的字符索引。 */
  private delimiterIndex = -1

  /** 逐字符匹配插值开始分隔符；失败时把当前字符重新交给 Text/RCDATA 状态。 */
  private stateInterpolationOpen(c: number): void {
    if (c === this.delimiterOpen[this.delimiterIndex]) {
      if (this.delimiterIndex === this.delimiterOpen.length - 1) {
        const start = this.index + 1 - this.delimiterOpen.length
        if (start > this.sectionStart) {
          this.cbs.ontext(this.sectionStart, start)
        }
        this.state = State.Interpolation
        this.sectionStart = start
      } else {
        this.delimiterIndex++
      }
    } else if (this.inRCDATA) {
      this.state = State.InRCDATA
      this.stateInRCDATA(c)
    } else {
      this.state = State.Text
      this.stateText(c)
    }
  }

  /** 扫描插值正文，直到遇到结束分隔符首字符。 */
  private stateInterpolation(c: number): void {
    if (c === this.delimiterClose[0]) {
      this.state = State.InterpolationClose
      this.delimiterIndex = 0
      this.stateInterpolationClose(c)
    }
  }

  /** 完整匹配插值结束分隔符并发送回调；部分匹配失败则回到插值正文。 */
  private stateInterpolationClose(c: number) {
    if (c === this.delimiterClose[this.delimiterIndex]) {
      if (this.delimiterIndex === this.delimiterClose.length - 1) {
        this.cbs.oninterpolation(this.sectionStart, this.index + 1)
        if (this.inRCDATA) {
          this.state = State.InRCDATA
        } else {
          this.state = State.Text
        }
        this.sectionStart = this.index + 1
      } else {
        this.delimiterIndex++
      }
    } else {
      this.state = State.Interpolation
      this.stateInterpolation(c)
    }
  }

  /** 当前特殊标签、注释或 CDATA 正在匹配的固定序列。 */
  public currentSequence: Uint8Array = undefined!
  /** 固定序列已匹配字符数。 */
  private sequenceIndex = 0
  /** 确认 `<script>` / `<style>` 等特殊标签名，并转入正常标签名结束处理。 */
  private stateSpecialStartSequence(c: number): void {
    const isEnd = this.sequenceIndex === this.currentSequence.length
    const isMatch = isEnd
      ? // 标签名完整匹配后仍要确认名字确实结束，避免把 `<scriptx>` 误判为 script。
        isEndOfTagSection(c)
      : // HTML 标签名大小写不敏感，按 ASCII 小写位比较。
        (c | 0x20) === this.currentSequence[this.sequenceIndex]

    if (!isMatch) {
      this.inRCDATA = false
    } else if (!isEnd) {
      this.sequenceIndex++
      return
    }

    this.sequenceIndex = 0
    this.state = State.InTagName
    this.stateInTagName(c)
  }

  /**
   * 在特殊标签内容中寻找对应结束标签。
   *
   * `<script>` / `<style>` 内容按 RAWTEXT 快进，只识别闭标签；`<title>` / `<textarea>`
   * 属于 RCDATA，还需识别实体和 Vue 插值。SFC 根级自定义块同样使用此扫描器。
   */
  private stateInRCDATA(c: number): void {
    if (this.sequenceIndex === this.currentSequence.length) {
      if (c === CharCodes.Gt || isWhitespace(c)) {
        const endOfText = this.index - this.currentSequence.length

        if (this.sectionStart < endOfText) {
          // 回调期间临时移到正文终点，使 parser 读取的位置与真实文本范围一致。
          const actualIndex = this.index
          this.index = endOfText
          this.cbs.ontext(this.sectionStart, endOfText)
          this.index = actualIndex
        }

        this.sectionStart = endOfText + 2 // Skip over the `</`
        this.stateInClosingTagName(c)
        this.inRCDATA = false
        return
      }

      this.sequenceIndex = 0
    }

    if ((c | 0x20) === this.currentSequence[this.sequenceIndex]) {
      this.sequenceIndex += 1
    } else if (this.sequenceIndex === 0) {
      if (
        this.currentSequence === Sequences.TitleEnd ||
        (this.currentSequence === Sequences.TextareaEnd && !this.inSFCRoot)
      ) {
        // title/textarea 内容允许 HTML 实体。
        if (!__BROWSER__ && c === CharCodes.Amp) {
          this.startEntity()
        } else if (!this.inVPre && c === this.delimiterOpen[0]) {
          // Vue 仍允许在 RCDATA 中写插值，除非位于 v-pre。
          this.state = State.InterpolationOpen
          this.delimiterIndex = 0
          this.stateInterpolationOpen(c)
        }
      } else if (this.fastForwardTo(CharCodes.Lt)) {
        // RAWTEXT 中只有 `<` 可能开始闭标签，可跳过中间所有字符。
        this.sequenceIndex = 1
      }
    } else {
      // 部分匹配失败时若当前字符又是 `<`，立即作为新候选开头，例如 `<</script>`。
      this.sequenceIndex = Number(c === CharCodes.Lt)
    }
  }

  /** 匹配 `CDATA[` 声明前缀；失败则退回普通 declaration。 */
  private stateCDATASequence(c: number): void {
    if (c === Sequences.Cdata[this.sequenceIndex]) {
      if (++this.sequenceIndex === Sequences.Cdata.length) {
        this.state = State.InCommentLike
        this.currentSequence = Sequences.CdataEnd
        this.sequenceIndex = 0
        this.sectionStart = this.index + 1
      }
    } else {
      this.sequenceIndex = 0
      this.state = State.InDeclaration
      this.stateInDeclaration(c) // 当前字符尚未按 declaration 处理，需要重消费。
    }
  }

  /**
   * 当状态只等待某一个字符时，直接跳到下一次出现位置，同时补记跨过的换行。
   *
   * @returns 是否在缓冲区中找到目标字符
   */
  private fastForwardTo(c: number): boolean {
    while (++this.index < this.buffer.length) {
      const cc = this.buffer.charCodeAt(this.index)
      if (cc === CharCodes.NewLine) {
        this.newlines.push(this.index)
      }
      if (cc === c) {
        return true
      }
    }

    // parse 主循环结尾还会自增 index，因此未找到时停在 length - 1。
    // TODO：若未来改为调用状态前自增，可去掉此补偿。
    this.index = this.buffer.length - 1

    return false
  }

  /**
   * 扫描注释与 CDATA 共用的结束序列。
   *
   * 两者结束串分别为 `-->` 和 `]]>`：首字符独特且可能连续出现，所以先快进到首字符，
   * 再允许多个 `-` / `]` 后继续匹配，兼容 `--->`、`]]]>` 等较长序列。
   */
  private stateInCommentLike(c: number): void {
    if (c === this.currentSequence[this.sequenceIndex]) {
      if (++this.sequenceIndex === this.currentSequence.length) {
        if (this.currentSequence === Sequences.CdataEnd) {
          this.cbs.oncdata(this.sectionStart, this.index - 2)
        } else {
          this.cbs.oncomment(this.sectionStart, this.index - 2)
        }

        this.sequenceIndex = 0
        this.sectionStart = this.index + 1
        this.state = State.Text
      }
    } else if (this.sequenceIndex === 0) {
      // 中间内容无需逐字符分派，直接寻找结束串首字符。
      if (this.fastForwardTo(this.currentSequence[0])) {
        this.sequenceIndex = 1
      }
    } else if (c !== this.currentSequence[this.sequenceIndex - 1]) {
      // 当前字符不是重复的首字符，候选失败，重新开始。
      this.sequenceIndex = 0
    }
  }

  /** 从标签名匹配阶段进入特殊内容扫描。 */
  private startSpecial(sequence: Uint8Array, offset: number) {
    this.enterRCDATA(sequence, offset)
    this.state = State.SpecialStartSequence
  }

  /** 强制进入 RCDATA/RAWTEXT 扫描，供 SFC 非 HTML template 等场景调用。 */
  public enterRCDATA(sequence: Uint8Array, offset: number): void {
    this.inRCDATA = true
    this.currentSequence = sequence
    this.sequenceIndex = offset
  }

  /** 处理 `<` 后首字符，区分声明、processing instruction、开标签、闭标签或普通文本。 */
  private stateBeforeTagName(c: number): void {
    if (c === CharCodes.ExclamationMark) {
      this.state = State.BeforeDeclaration
      this.sectionStart = this.index + 1
    } else if (c === CharCodes.Questionmark) {
      this.state = State.InProcessingInstruction
      this.sectionStart = this.index + 1
    } else if (isTagStartChar(c)) {
      this.sectionStart = this.index
      if (this.mode === ParseMode.BASE) {
        // base 模式不赋予任何标签 RAWTEXT/RCDATA 特权。
        this.state = State.InTagName
      } else if (this.inSFCRoot) {
        // SFC 根层除 template 外均为 RAWTEXT；非 HTML template 由 parser 稍后切换。
        this.state = State.InSFCRootTagName
      } else if (!this.inXML) {
        // HTML 模式：script/style 为 RAWTEXT，title/textarea 为 RCDATA。
        if (c === 116 /* t */) {
          this.state = State.BeforeSpecialT
        } else {
          this.state =
            c === 115 /* s */ ? State.BeforeSpecialS : State.InTagName
        }
      } else {
        this.state = State.InTagName
      }
    } else if (c === CharCodes.Slash) {
      this.state = State.BeforeClosingTagName
    } else {
      this.state = State.Text
      this.stateText(c)
    }
  }

  /** 扫描普通开标签名，直到空白、`/` 或 `>`。 */
  private stateInTagName(c: number): void {
    if (isEndOfTagSection(c)) {
      this.handleTagName(c)
    }
  }

  /** 扫描 SFC 根标签名；非 template 根块立即登记自身闭标签序列。 */
  private stateInSFCRootTagName(c: number): void {
    if (isEndOfTagSection(c)) {
      const tag = this.buffer.slice(this.sectionStart, this.index)
      if (tag !== 'template') {
        this.enterRCDATA(toCharCodes(`</` + tag), 0)
      }
      this.handleTagName(c)
    }
  }

  /** 发送开标签名事件，并用当前终止字符继续处理属性区。 */
  private handleTagName(c: number) {
    this.cbs.onopentagname(this.sectionStart, this.index)
    this.sectionStart = -1
    this.state = State.BeforeAttrName
    this.stateBeforeAttrName(c)
  }

  /** 处理 `</` 后内容；缺少标签名时报错，非法名字按特殊注释容错。 */
  private stateBeforeClosingTagName(c: number): void {
    if (isWhitespace(c)) {
      // 忽略标签名前空白。
    } else if (c === CharCodes.Gt) {
      if (__DEV__ || !__BROWSER__) {
        this.cbs.onerr(ErrorCodes.MISSING_END_TAG_NAME, this.index)
      }
      this.state = State.Text
      this.sectionStart = this.index + 1
    } else {
      this.state = isTagStartChar(c)
        ? State.InClosingTagName
        : State.InSpecialComment
      this.sectionStart = this.index
    }
  }

  /** 扫描闭标签名并发送事件。 */
  private stateInClosingTagName(c: number): void {
    if (c === CharCodes.Gt || isWhitespace(c)) {
      this.cbs.onclosetag(this.sectionStart, this.index)
      this.sectionStart = -1
      this.state = State.AfterClosingTagName
      this.stateAfterClosingTagName(c)
    }
  }

  /** 闭标签名后忽略所有内容直到 `>`；非法属性由 parser 的闭标签规则诊断。 */
  private stateAfterClosingTagName(c: number): void {
    if (c === CharCodes.Gt) {
      this.state = State.Text
      this.sectionStart = this.index + 1
    }
  }

  /**
   * 处理开标签名后的属性区、自闭合符和标签结束。
   *
   * 特别容忍尚未完成的 `<div </div>`：把 `</` 当作新闭标签开始。这偏离标准 HTML，
   * 但 IDE 每次按键都会编译中间态，容错可避免临时缺少 `>` 时整棵后续 AST 丢失。
   */
  private stateBeforeAttrName(c: number): void {
    if (c === CharCodes.Gt) {
      this.cbs.onopentagend(this.index)
      if (this.inRCDATA) {
        this.state = State.InRCDATA
      } else {
        this.state = State.Text
      }
      this.sectionStart = this.index + 1
    } else if (c === CharCodes.Slash) {
      this.state = State.InSelfClosingTag
      if ((__DEV__ || !__BROWSER__) && this.peek() !== CharCodes.Gt) {
        this.cbs.onerr(ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG, this.index)
      }
    } else if (c === CharCodes.Lt && this.peek() === CharCodes.Slash) {
      this.cbs.onopentagend(this.index)
      this.state = State.BeforeTagName
      this.sectionStart = this.index
    } else if (!isWhitespace(c)) {
      if ((__DEV__ || !__BROWSER__) && c === CharCodes.Eq) {
        this.cbs.onerr(
          ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME,
          this.index,
        )
      }
      this.handleAttrStart(c)
    }
  }

  /** 根据首字符选择 `v-` 指令、简写指令或普通属性扫描状态。 */
  private handleAttrStart(c: number) {
    if (c === CharCodes.LowerV && this.peek() === CharCodes.Dash) {
      this.state = State.InDirName
      this.sectionStart = this.index
    } else if (
      c === CharCodes.Dot ||
      c === CharCodes.Colon ||
      c === CharCodes.At ||
      c === CharCodes.Number
    ) {
      this.cbs.ondirname(this.index, this.index + 1)
      this.state = State.InDirArg
      this.sectionStart = this.index + 1
    } else {
      this.state = State.InAttrName
      this.sectionStart = this.index
    }
  }

  /** 处理 `/>`；若 `/` 后不是 `>`，回到属性区继续容错扫描。 */
  private stateInSelfClosingTag(c: number): void {
    if (c === CharCodes.Gt) {
      this.cbs.onselfclosingtag(this.index)
      this.state = State.Text
      this.sectionStart = this.index + 1
      // 特殊标签自闭合时不能继续寻找不存在的结束标签。
      this.inRCDATA = false
    } else if (!isWhitespace(c)) {
      this.state = State.BeforeAttrName
      this.stateBeforeAttrName(c)
    }
  }

  /** 扫描普通属性名并校验 HTML 禁止字符。 */
  private stateInAttrName(c: number): void {
    if (c === CharCodes.Eq || isEndOfTagSection(c)) {
      this.cbs.onattribname(this.sectionStart, this.index)
      this.handleAttrNameEnd(c)
    } else if (
      (__DEV__ || !__BROWSER__) &&
      (c === CharCodes.DoubleQuote ||
        c === CharCodes.SingleQuote ||
        c === CharCodes.Lt)
    ) {
      this.cbs.onerr(
        ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
        this.index,
      )
    }
  }

  /** 扫描完整 `v-name`，在 `:` / `.` 处分派到参数或修饰符状态。 */
  private stateInDirName(c: number): void {
    if (c === CharCodes.Eq || isEndOfTagSection(c)) {
      this.cbs.ondirname(this.sectionStart, this.index)
      this.handleAttrNameEnd(c)
    } else if (c === CharCodes.Colon) {
      this.cbs.ondirname(this.sectionStart, this.index)
      this.state = State.InDirArg
      this.sectionStart = this.index + 1
    } else if (c === CharCodes.Dot) {
      this.cbs.ondirname(this.sectionStart, this.index)
      this.state = State.InDirModifier
      this.sectionStart = this.index + 1
    }
  }

  /** 扫描静态指令参数或简写参数。 */
  private stateInDirArg(c: number): void {
    if (c === CharCodes.Eq || isEndOfTagSection(c)) {
      this.cbs.ondirarg(this.sectionStart, this.index)
      this.handleAttrNameEnd(c)
    } else if (c === CharCodes.LeftSquare) {
      this.state = State.InDirDynamicArg
    } else if (c === CharCodes.Dot) {
      this.cbs.ondirarg(this.sectionStart, this.index)
      this.state = State.InDirModifier
      this.sectionStart = this.index + 1
    }
  }

  /** 扫描 `[dynamicArg]`，缺少右方括号时报告 Vue 专用语法错误。 */
  private stateInDynamicDirArg(c: number): void {
    if (c === CharCodes.RightSquare) {
      this.state = State.InDirArg
    } else if (c === CharCodes.Eq || isEndOfTagSection(c)) {
      this.cbs.ondirarg(this.sectionStart, this.index + 1)
      this.handleAttrNameEnd(c)
      if (__DEV__ || !__BROWSER__) {
        this.cbs.onerr(
          ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END,
          this.index,
        )
      }
    }
  }

  /** 扫描一个或多个以点分隔的指令修饰符。 */
  private stateInDirModifier(c: number): void {
    if (c === CharCodes.Eq || isEndOfTagSection(c)) {
      this.cbs.ondirmodifier(this.sectionStart, this.index)
      this.handleAttrNameEnd(c)
    } else if (c === CharCodes.Dot) {
      this.cbs.ondirmodifier(this.sectionStart, this.index)
      this.sectionStart = this.index + 1
    }
  }

  /** 完成属性名回调，并重新消费终止字符以决定是否存在值。 */
  private handleAttrNameEnd(c: number): void {
    this.sectionStart = this.index
    this.state = State.AfterAttrName
    this.cbs.onattribnameend(this.index)
    this.stateAfterAttrName(c)
  }

  /** 处理属性名之后的 `=`、下一个属性或标签结束；无 `=` 时生成布尔属性。 */
  private stateAfterAttrName(c: number): void {
    if (c === CharCodes.Eq) {
      this.state = State.BeforeAttrValue
    } else if (c === CharCodes.Slash || c === CharCodes.Gt) {
      this.cbs.onattribend(QuoteType.NoValue, this.sectionStart)
      this.sectionStart = -1
      this.state = State.BeforeAttrName
      this.stateBeforeAttrName(c)
    } else if (!isWhitespace(c)) {
      this.cbs.onattribend(QuoteType.NoValue, this.sectionStart)
      this.handleAttrStart(c)
    }
  }

  /** 跳过 `=` 后空白，并按首字符选择双引号、单引号或无引号值。 */
  private stateBeforeAttrValue(c: number): void {
    if (c === CharCodes.DoubleQuote) {
      this.state = State.InAttrValueDq
      this.sectionStart = this.index + 1
    } else if (c === CharCodes.SingleQuote) {
      this.state = State.InAttrValueSq
      this.sectionStart = this.index + 1
    } else if (!isWhitespace(c)) {
      this.sectionStart = this.index
      this.state = State.InAttrValueNq
      this.stateInAttrValueNoQuotes(c) // 首字符也是值内容，需要重消费。
    }
  }

  /** 扫描带引号属性值；浏览器版可直接快进，Node 版还需逐个识别实体。 */
  private handleInAttrValue(c: number, quote: number) {
    if (c === quote || (__BROWSER__ && this.fastForwardTo(quote))) {
      this.cbs.onattribdata(this.sectionStart, this.index)
      this.sectionStart = -1
      this.cbs.onattribend(
        quote === CharCodes.DoubleQuote ? QuoteType.Double : QuoteType.Single,
        this.index + 1,
      )
      this.state = State.BeforeAttrName
    } else if (!__BROWSER__ && c === CharCodes.Amp) {
      this.startEntity()
    }
  }

  /** 扫描双引号属性值。 */
  private stateInAttrValueDoubleQuotes(c: number): void {
    this.handleInAttrValue(c, CharCodes.DoubleQuote)
  }

  /** 扫描单引号属性值。 */
  private stateInAttrValueSingleQuotes(c: number): void {
    this.handleInAttrValue(c, CharCodes.SingleQuote)
  }

  /** 扫描无引号属性值，并报告 HTML 禁止出现在其中的字符。 */
  private stateInAttrValueNoQuotes(c: number): void {
    if (isWhitespace(c) || c === CharCodes.Gt) {
      this.cbs.onattribdata(this.sectionStart, this.index)
      this.sectionStart = -1
      this.cbs.onattribend(QuoteType.Unquoted, this.index)
      this.state = State.BeforeAttrName
      this.stateBeforeAttrName(c)
    } else if (
      ((__DEV__ || !__BROWSER__) && c === CharCodes.DoubleQuote) ||
      c === CharCodes.SingleQuote ||
      c === CharCodes.Lt ||
      c === CharCodes.Eq ||
      c === CharCodes.GraveAccent
    ) {
      this.cbs.onerr(
        ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
        this.index,
      )
    } else if (!__BROWSER__ && c === CharCodes.Amp) {
      this.startEntity()
    }
  }

  /** 区分 `<![CDATA[`、`<!--` 与普通 declaration。 */
  private stateBeforeDeclaration(c: number): void {
    if (c === CharCodes.LeftSquare) {
      this.state = State.CDATASequence
      this.sequenceIndex = 0
    } else {
      this.state =
        c === CharCodes.Dash ? State.BeforeComment : State.InDeclaration
    }
  }

  /** 普通 declaration 对 Vue 模板无运行时意义，快进到 `>` 后丢弃。 */
  private stateInDeclaration(c: number): void {
    if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
      this.state = State.Text
      this.sectionStart = this.index + 1
    }
  }

  /** 扫描 `<?...>` 到 `>` 并交给 parser 做命名空间诊断。 */
  private stateInProcessingInstruction(c: number): void {
    if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
      this.cbs.onprocessinginstruction(this.sectionStart, this.index)
      this.state = State.Text
      this.sectionStart = this.index + 1
    }
  }

  /** 确认第二个 `-` 后进入标准注释，否则按 declaration 容错。 */
  private stateBeforeComment(c: number): void {
    if (c === CharCodes.Dash) {
      this.state = State.InCommentLike
      this.currentSequence = Sequences.CommentEnd
      // 从序列索引 2 开始，允许 `<!-->` 这种短注释也尽快闭合。
      this.sequenceIndex = 2
      this.sectionStart = this.index + 1
    } else {
      this.state = State.InDeclaration
    }
  }

  /** 扫描 `</非法内容>` 一类特殊注释直到 `>`。 */
  private stateInSpecialComment(c: number): void {
    if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
      this.cbs.oncomment(this.sectionStart, this.index)
      this.state = State.Text
      this.sectionStart = this.index + 1
    }
  }

  /** 根据 `<s...` 的下一个字符区分 script、style 或普通标签。 */
  private stateBeforeSpecialS(c: number): void {
    if (c === Sequences.ScriptEnd[3]) {
      this.startSpecial(Sequences.ScriptEnd, 4)
    } else if (c === Sequences.StyleEnd[3]) {
      this.startSpecial(Sequences.StyleEnd, 4)
    } else {
      this.state = State.InTagName
      this.stateInTagName(c) // 普通标签仍需消费当前字符。
    }
  }

  /** 根据 `<t...` 的下一个字符区分 title、textarea 或普通标签。 */
  private stateBeforeSpecialT(c: number): void {
    if (c === Sequences.TitleEnd[3]) {
      this.startSpecial(Sequences.TitleEnd, 4)
    } else if (c === Sequences.TextareaEnd[3]) {
      this.startSpecial(Sequences.TextareaEnd, 4)
    } else {
      this.state = State.InTagName
      this.stateInTagName(c) // 普通标签仍需消费当前字符。
    }
  }

  /**
   * 进入 HTML 实体解码子状态。文本/RCDATA 使用允许无分号旧实体的 Legacy 模式，
   * 属性使用更严格的 Attribute 模式，防止 `&name=value` 被错误吞掉。
   */
  private startEntity() {
    if (!__BROWSER__) {
      this.baseState = this.state
      this.state = State.InEntity
      this.entityStart = this.index
      this.entityDecoder!.startEntity(
        this.baseState === State.Text || this.baseState === State.InRCDATA
          ? DecodingMode.Legacy
          : DecodingMode.Attribute,
      )
    }
  }

  /** 向流式实体解码器继续喂入缓冲区，并在完成后恢复进入前状态。 */
  private stateInEntity(): void {
    if (!__BROWSER__) {
      const length = this.entityDecoder!.write(this.buffer, this.index)

      // 非负值表示实体已结束；0 表示未形成有效实体，需要从 `&` 重新按普通文本处理。
      if (length >= 0) {
        this.state = this.baseState

        if (length === 0) {
          this.index = this.entityStart
        }
      } else {
        // 负值表示解码器需要更多输入；当前实现输入完整，因此先标记本缓冲已消费。
        this.index = this.buffer.length - 1
      }
    }
  }

  /**
   * 单遍扫描输入，并按当前状态调用对应处理函数。
   *
   * switch 分支按命中频率排列，Text、插值、RCDATA 等热状态靠前，减少大模板中的分支成本。
   * 扫描结束后先发送尚未提交的文本/属性片段，再完成实体和 EOF 处理。
   */
  public parse(input: string): void {
    this.buffer = input
    while (this.index < this.buffer.length) {
      const c = this.buffer.charCodeAt(this.index)
      if (c === CharCodes.NewLine && this.state !== State.InEntity) {
        this.newlines.push(this.index)
      }
      switch (this.state) {
        case State.Text: {
          this.stateText(c)
          break
        }
        case State.InterpolationOpen: {
          this.stateInterpolationOpen(c)
          break
        }
        case State.Interpolation: {
          this.stateInterpolation(c)
          break
        }
        case State.InterpolationClose: {
          this.stateInterpolationClose(c)
          break
        }
        case State.SpecialStartSequence: {
          this.stateSpecialStartSequence(c)
          break
        }
        case State.InRCDATA: {
          this.stateInRCDATA(c)
          break
        }
        case State.CDATASequence: {
          this.stateCDATASequence(c)
          break
        }
        case State.InAttrValueDq: {
          this.stateInAttrValueDoubleQuotes(c)
          break
        }
        case State.InAttrName: {
          this.stateInAttrName(c)
          break
        }
        case State.InDirName: {
          this.stateInDirName(c)
          break
        }
        case State.InDirArg: {
          this.stateInDirArg(c)
          break
        }
        case State.InDirDynamicArg: {
          this.stateInDynamicDirArg(c)
          break
        }
        case State.InDirModifier: {
          this.stateInDirModifier(c)
          break
        }
        case State.InCommentLike: {
          this.stateInCommentLike(c)
          break
        }
        case State.InSpecialComment: {
          this.stateInSpecialComment(c)
          break
        }
        case State.BeforeAttrName: {
          this.stateBeforeAttrName(c)
          break
        }
        case State.InTagName: {
          this.stateInTagName(c)
          break
        }
        case State.InSFCRootTagName: {
          this.stateInSFCRootTagName(c)
          break
        }
        case State.InClosingTagName: {
          this.stateInClosingTagName(c)
          break
        }
        case State.BeforeTagName: {
          this.stateBeforeTagName(c)
          break
        }
        case State.AfterAttrName: {
          this.stateAfterAttrName(c)
          break
        }
        case State.InAttrValueSq: {
          this.stateInAttrValueSingleQuotes(c)
          break
        }
        case State.BeforeAttrValue: {
          this.stateBeforeAttrValue(c)
          break
        }
        case State.BeforeClosingTagName: {
          this.stateBeforeClosingTagName(c)
          break
        }
        case State.AfterClosingTagName: {
          this.stateAfterClosingTagName(c)
          break
        }
        case State.BeforeSpecialS: {
          this.stateBeforeSpecialS(c)
          break
        }
        case State.BeforeSpecialT: {
          this.stateBeforeSpecialT(c)
          break
        }
        case State.InAttrValueNq: {
          this.stateInAttrValueNoQuotes(c)
          break
        }
        case State.InSelfClosingTag: {
          this.stateInSelfClosingTag(c)
          break
        }
        case State.InDeclaration: {
          this.stateInDeclaration(c)
          break
        }
        case State.BeforeDeclaration: {
          this.stateBeforeDeclaration(c)
          break
        }
        case State.BeforeComment: {
          this.stateBeforeComment(c)
          break
        }
        case State.InProcessingInstruction: {
          this.stateInProcessingInstruction(c)
          break
        }
        case State.InEntity: {
          this.stateInEntity()
          break
        }
      }
      this.index++
    }
    this.cleanup()
    this.finish()
  }

  /** 在输入结束前发送仍留在缓冲中的文本或属性值片段。 */
  private cleanup() {
    // 只有文本和属性值允许在 EOF 前提交部分数据；未完成标签应由 trailing 逻辑忽略。
    if (this.sectionStart !== this.index) {
      if (
        this.state === State.Text ||
        (this.state === State.InRCDATA && this.sequenceIndex === 0)
      ) {
        this.cbs.ontext(this.sectionStart, this.index)
        this.sectionStart = this.index
      } else if (
        this.state === State.InAttrValueDq ||
        this.state === State.InAttrValueSq ||
        this.state === State.InAttrValueNq
      ) {
        this.cbs.onattribdata(this.sectionStart, this.index)
        this.sectionStart = this.index
      }
    }
  }

  /** 结束未完成实体、处理尾部数据，并触发 parser 的 EOF 校验。 */
  private finish() {
    if (!__BROWSER__ && this.state === State.InEntity) {
      this.entityDecoder!.end()
      this.state = this.baseState
    }

    this.handleTrailingData()

    this.cbs.onend()
  }

  /**
   * 根据 EOF 时状态处理剩余源码。
   * 未闭合注释/CDATA 仍保留内容；未完成开闭标签不发送对应回调，从而整段被忽略并由 parser 报错。
   */
  private handleTrailingData() {
    const endIndex = this.buffer.length

    // 没有未提交片段即可结束。
    if (this.sectionStart >= endIndex) {
      return
    }

    if (this.state === State.InCommentLike) {
      if (this.currentSequence === Sequences.CdataEnd) {
        this.cbs.oncdata(this.sectionStart, endIndex)
      } else {
        this.cbs.oncomment(this.sectionStart, endIndex)
      }
    } else if (
      this.state === State.InTagName ||
      this.state === State.BeforeAttrName ||
      this.state === State.BeforeAttrValue ||
      this.state === State.AfterAttrName ||
      this.state === State.InAttrName ||
      this.state === State.InDirName ||
      this.state === State.InDirArg ||
      this.state === State.InDirDynamicArg ||
      this.state === State.InDirModifier ||
      this.state === State.InAttrValueSq ||
      this.state === State.InAttrValueDq ||
      this.state === State.InAttrValueNq ||
      this.state === State.InClosingTagName
    ) {
      // 不调用开/闭标签回调即表示忽略这个未完成标签，适合 IDE 中间输入态。
    } else {
      this.cbs.ontext(this.sectionStart, endIndex)
    }
  }

  /**
   * 接收实体解码结果，先提交实体前普通片段，再按进入前状态发送文本或属性实体事件。
   * 同步调整 index/sectionStart，防止主循环再次消费实体内部字符。
   */
  private emitCodePoint(cp: number, consumed: number): void {
    if (!__BROWSER__) {
      if (this.baseState !== State.Text && this.baseState !== State.InRCDATA) {
        if (this.sectionStart < this.entityStart) {
          this.cbs.onattribdata(this.sectionStart, this.entityStart)
        }
        this.sectionStart = this.entityStart + consumed
        this.index = this.sectionStart - 1

        this.cbs.onattribentity(
          fromCodePoint(cp),
          this.entityStart,
          this.sectionStart,
        )
      } else {
        if (this.sectionStart < this.entityStart) {
          this.cbs.ontext(this.sectionStart, this.entityStart)
        }
        this.sectionStart = this.entityStart + consumed
        this.index = this.sectionStart - 1

        this.cbs.ontextentity(
          fromCodePoint(cp),
          this.entityStart,
          this.sectionStart,
        )
      }
    }
  }
}
