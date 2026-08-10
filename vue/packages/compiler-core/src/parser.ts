import {
  type AttributeNode,
  ConstantTypes,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type ForParseResult,
  Namespaces,
  NodeTypes,
  type RootNode,
  type SimpleExpressionNode,
  type SourceLocation,
  type TemplateChildNode,
  createRoot,
  createSimpleExpression,
} from './ast'
import type { ParserOptions } from './options'
import Tokenizer, {
  CharCodes,
  ParseMode,
  QuoteType,
  Sequences,
  State,
  isWhitespace,
  toCharCodes,
} from './tokenizer'
import {
  type CompilerCompatOptions,
  CompilerDeprecationTypes,
  checkCompatEnabled,
  isCompatEnabled,
  warnDeprecation,
} from './compat/compatConfig'
import { NO, extend } from '@vue/shared'
import {
  ErrorCodes,
  createCompilerError,
  defaultOnError,
  defaultOnWarn,
} from './errors'
import {
  forAliasRE,
  isAllWhitespace,
  isCoreComponent,
  isSimpleIdentifier,
  isStaticArgOf,
  isVPre,
} from './utils'
import { decodeHTML } from 'entities/decode'
import {
  type ParserOptions as BabelOptions,
  parse,
  parseExpression,
} from '@babel/parser'

/** 合并选项时仍允许缺省、由调用环境提供的字段。 */
type OptionalOptions =
  | 'decodeEntities'
  | 'whitespace'
  | 'isNativeTag'
  | 'isBuiltInComponent'
  | 'expressionPlugins'
  | keyof CompilerCompatOptions

/**
 * parser 内部实际读取的选项类型：有默认值的字段全部必填，平台相关回调保持可选。
 */
export type MergedParserOptions = Omit<
  Required<ParserOptions>,
  OptionalOptions
> &
  Pick<ParserOptions, OptionalOptions>

/** 平台无关解析器默认值；compiler-dom / compiler-sfc 会覆盖标签和模式规则。 */
export const defaultParserOptions: MergedParserOptions = {
  parseMode: 'base',
  ns: Namespaces.HTML,
  delimiters: [`{{`, `}}`],
  getNamespace: () => Namespaces.HTML,
  isVoidTag: NO,
  isPreTag: NO,
  isIgnoreNewlineTag: NO,
  isCustomElement: NO,
  onError: defaultOnError,
  onWarn: defaultOnWarn,
  comments: __DEV__,
  prefixIdentifiers: false,
}

// 解析器与 tokenizer 共享一组模块级可变状态，避免为每个字符回调闭包分配上下文对象。
// `baseParse()` 开始时必须 reset，且同一 JS 线程中不能嵌套调用 baseParse。
/** 本轮解析合并默认值后的平台配置。 */
let currentOptions: MergedParserOptions = defaultParserOptions
/** 本轮正在构造的根节点，tokenizer 回调通过它追加顶层 children。 */
let currentRoot: RootNode | null = null

/** 当前正在解析的完整模板源码。 */
let currentInput = ''
/** tokenizer 已读到名字、但尚未遇到 `>` 的开标签。 */
let currentOpenTag: ElementNode | null = null
/** 当前正在组装的普通属性或指令。 */
let currentProp: AttributeNode | DirectiveNode | null = null
/** 分段属性值（含实体解码结果）的累加缓冲。 */
let currentAttrValue = ''
/** 属性值在源码中的首尾偏移，用于构造精确 loc。 */
let currentAttrStartIndex = -1
/** 当前属性值最后一个源码字符之后的偏移。 */
let currentAttrEndIndex = -1
/** 当前 `<pre>` 类保留空白元素的嵌套深度。 */
let inPre = 0
/** 是否位于 `v-pre` 子树；此时指令和插值都按普通文本/属性处理。 */
let inVPre = false
/** 开启本轮 `v-pre` 的元素，关闭它时恢复正常解析。 */
let currentVPreBoundary: ElementNode | null = null
/** 未闭合元素栈；索引 0 始终是当前直接父元素。 */
const stack: ElementNode[] = []

/**
 * 字符级 tokenizer 的回调适配层：把 token 逐步组装成模板 AST。
 * tokenizer 只负责识别边界，元素分类、指令语义、空白处理均留在 parser。
 */
const tokenizer = new Tokenizer(stack, {
  onerr: emitError,

  /** 把普通文本 token 交给统一文本合并逻辑。 */
  ontext(start, end) {
    onText(getSlice(start, end), start, end)
  },

  /** 把已解码实体作为文本追加，同时保留实体源码范围。 */
  ontextentity(char, start, end) {
    onText(char, start, end)
  },

  /** 裁剪插值内容、解码兼容实体并创建 InterpolationNode。 */
  oninterpolation(start, end) {
    if (inVPre) {
      return onText(getSlice(start, end), start, end)
    }
    let innerStart = start + tokenizer.delimiterOpen.length
    let innerEnd = end - tokenizer.delimiterClose.length
    while (isWhitespace(currentInput.charCodeAt(innerStart))) {
      innerStart++
    }
    while (isWhitespace(currentInput.charCodeAt(innerEnd - 1))) {
      innerEnd--
    }
    let exp = getSlice(innerStart, innerEnd)
    // 为兼容旧行为，插值表达式中的 HTML 实体也会解码，例如 `{{ a &gt; b }}`。
    if (exp.includes('&')) {
      if (__BROWSER__) {
        exp = currentOptions.decodeEntities!(exp, false)
      } else {
        exp = decodeHTML(exp)
      }
    }
    addNode({
      type: NodeTypes.INTERPOLATION,
      content: createExp(exp, false, getLoc(innerStart, innerEnd)),
      loc: getLoc(start, end),
    })
  },

  /** 读取标签名并创建尚未分类、尚未入栈的元素半成品。 */
  onopentagname(start, end) {
    const name = getSlice(start, end)
    currentOpenTag = {
      type: NodeTypes.ELEMENT,
      tag: name,
      ns: currentOptions.getNamespace(name, stack[0], currentOptions.ns),
      // 先按原生元素创建；读完全部属性后才能依据 `is` / 自定义元素规则精确分类。
      tagType: ElementTypes.ELEMENT,
      props: [],
      children: [],
      loc: getLoc(start - 1, end),
      codegenNode: undefined,
    }
  },

  /** 普通 `>` 结束时完成元素分类并把非 void 标签压栈。 */
  onopentagend(end) {
    endOpenTag(end)
  },

  /** 在开放栈中匹配结束标签，并为跨过的未闭合元素补报错误。 */
  onclosetag(start, end) {
    const name = getSlice(start, end)
    if (!currentOptions.isVoidTag(name)) {
      let found = false
      for (let i = 0; i < stack.length; i++) {
        const e = stack[i]
        if (e.tag.toLowerCase() === name.toLowerCase()) {
          found = true
          if (i > 0) {
            emitError(ErrorCodes.X_MISSING_END_TAG, stack[0].loc.start.offset)
          }
          for (let j = 0; j <= i; j++) {
            const el = stack.shift()!
            onCloseTag(el, end, j < i)
          }
          break
        }
      }
      if (!found) {
        emitError(ErrorCodes.X_INVALID_END_TAG, backTrack(start, CharCodes.Lt))
      }
    }
  },

  /** 完成自闭合开始标签，并立即执行关闭标签的收尾逻辑。 */
  onselfclosingtag(end) {
    const name = currentOpenTag!.tag
    currentOpenTag!.isSelfClosing = true
    endOpenTag(end)
    if (stack[0] && stack[0].tag === name) {
      onCloseTag(stack.shift()!, end)
    }
  },

  /** 为普通属性创建半成品节点，值由后续回调填入。 */
  onattribname(start, end) {
    // 普通属性不需要表达式解析；值稍后在 onattribend 中补齐。
    currentProp = {
      type: NodeTypes.ATTRIBUTE,
      name: getSlice(start, end),
      nameLoc: getLoc(start, end),
      value: undefined,
      loc: getLoc(start),
    }
  },

  /** 规范化指令简写/全名，并处理进入 v-pre 的语法降级。 */
  ondirname(start, end) {
    const raw = getSlice(start, end)
    const name =
      raw === '.' || raw === ':'
        ? 'bind'
        : raw === '@'
          ? 'on'
          : raw === '#'
            ? 'slot'
            : raw.slice(2)

    if (!inVPre && name === '') {
      emitError(ErrorCodes.X_MISSING_DIRECTIVE_NAME, start)
    }

    if (inVPre || name === '') {
      currentProp = {
        type: NodeTypes.ATTRIBUTE,
        name: raw,
        nameLoc: getLoc(start, end),
        value: undefined,
        loc: getLoc(start),
      }
    } else {
      currentProp = {
        type: NodeTypes.DIRECTIVE,
        name,
        rawName: raw,
        exp: undefined,
        arg: undefined,
        modifiers: raw === '.' ? [createSimpleExpression('prop')] : [],
        loc: getLoc(start),
      }
      if (name === 'pre') {
        inVPre = tokenizer.inVPre = true
        currentVPreBoundary = currentOpenTag
        // `v-pre` 之前已经按指令读入的属性也必须还原为普通属性，保证整棵子树完全跳过编译。
        const props = currentOpenTag!.props
        for (let i = 0; i < props.length; i++) {
          if (props[i].type === NodeTypes.DIRECTIVE) {
            props[i] = dirToAttr(props[i] as DirectiveNode)
          }
        }
      }
    }
  },

  /** 把静态或方括号动态参数写入当前指令。 */
  ondirarg(start, end) {
    if (start === end) return
    const arg = getSlice(start, end)
    if (inVPre && !isVPre(currentProp!)) {
      ;(currentProp as AttributeNode).name += arg
      setLocEnd((currentProp as AttributeNode).nameLoc, end)
    } else {
      const isStatic = arg[0] !== `[`
      ;(currentProp as DirectiveNode).arg = createExp(
        isStatic ? arg : arg.slice(1, -1),
        isStatic,
        getLoc(start, end),
        isStatic ? ConstantTypes.CAN_STRINGIFY : ConstantTypes.NOT_CONSTANT,
      )
    }
  },

  /** 追加指令修饰符；slot 的点号名称按兼容规则并入参数。 */
  ondirmodifier(start, end) {
    const mod = getSlice(start, end)
    if (inVPre && !isVPre(currentProp!)) {
      ;(currentProp as AttributeNode).name += '.' + mod
      setLocEnd((currentProp as AttributeNode).nameLoc, end)
    } else if ((currentProp as DirectiveNode).name === 'slot') {
      // v-slot 本身没有修饰符，点号可能属于插槽名。例如 `#foo.bar` 应把 `foo.bar`
      // 作为完整名称，而不是生成 `bar` 修饰符。该特殊处理也修复了 language-tools #2710：
      // 带点插槽名此前在编译器与 IDE 中被拆解成不同 AST，导致类型提示和实际运行不一致。
      const arg = (currentProp as DirectiveNode).arg
      if (arg) {
        ;(arg as SimpleExpressionNode).content += '.' + mod
        setLocEnd(arg.loc, end)
      }
    } else {
      const exp = createSimpleExpression(mod, true, getLoc(start, end))
      ;(currentProp as DirectiveNode).modifiers.push(exp)
    }
  },

  /** 累加一段未解码的属性值文本，并更新首尾源码偏移。 */
  onattribdata(start, end) {
    currentAttrValue += getSlice(start, end)
    if (currentAttrStartIndex < 0) currentAttrStartIndex = start
    currentAttrEndIndex = end
  },

  /** 累加属性值中的已解码实体，并保留原实体边界。 */
  onattribentity(char, start, end) {
    currentAttrValue += char
    if (currentAttrStartIndex < 0) currentAttrStartIndex = start
    currentAttrEndIndex = end
  },

  /** 补全属性原名并在当前开始标签内检查重复属性。 */
  onattribnameend(end) {
    const start = currentProp!.loc.start.offset
    const name = getSlice(start, end)
    if (currentProp!.type === NodeTypes.DIRECTIVE) {
      currentProp!.rawName = name
    }
    // 同一个开标签内原始属性名不可重复；指令按保留简写的 rawName 比较。
    if (
      currentOpenTag!.props.some(
        p => (p.type === NodeTypes.DIRECTIVE ? p.rawName : p.name) === name,
      )
    ) {
      emitError(ErrorCodes.DUPLICATE_ATTRIBUTE, start)
    }
  },

  /**
   * 完成当前属性：建立值节点/表达式、选择解析模式、处理兼容语法并加入元素 props。
   */
  onattribend(quote, end) {
    if (currentOpenTag && currentProp) {
      // tokenizer 已读完引号/无引号值，此时补齐整个属性的结束位置。
      setLocEnd(currentProp.loc, end)

      if (quote !== QuoteType.NoValue) {
        if (__BROWSER__ && currentAttrValue.includes('&')) {
          currentAttrValue = currentOptions.decodeEntities!(
            currentAttrValue,
            true,
          )
        }

        if (currentProp.type === NodeTypes.ATTRIBUTE) {
          // class 属性的连续空白语义等价，编译期合并可减少生成字符串体积。
          if (currentProp!.name === 'class') {
            currentAttrValue = condense(currentAttrValue).trim()
          }

          if (quote === QuoteType.Unquoted && !currentAttrValue) {
            emitError(ErrorCodes.MISSING_ATTRIBUTE_VALUE, end)
          }

          currentProp!.value = {
            type: NodeTypes.TEXT,
            content: currentAttrValue,
            loc:
              quote === QuoteType.Unquoted
                ? getLoc(currentAttrStartIndex, currentAttrEndIndex)
                : getLoc(currentAttrStartIndex - 1, currentAttrEndIndex + 1),
          }
          if (
            tokenizer.inSFCRoot &&
            currentOpenTag.tag === 'template' &&
            currentProp.name === 'lang' &&
            currentAttrValue &&
            currentAttrValue !== 'html'
          ) {
            // `<template lang="pug">` 等预处理器语法不是 HTML。切到 RCDATA 后只寻找
            // `</template>`，避免其中的 `<`、指令样式文本污染外层 SFC AST。
            tokenizer.enterRCDATA(toCharCodes(`</template`), 0)
          }
        } else {
          // 根据指令语法选择 Babel 解析模式：v-for 延后专门拆分，v-slot 按参数模式，
          // 含分号的 v-on 按多语句程序解析，其余按普通表达式解析。
          let expParseMode = ExpParseMode.Normal
          if (!__BROWSER__) {
            if (currentProp.name === 'for') {
              expParseMode = ExpParseMode.Skip
            } else if (currentProp.name === 'slot') {
              expParseMode = ExpParseMode.Params
            } else if (
              currentProp.name === 'on' &&
              currentAttrValue.includes(';')
            ) {
              expParseMode = ExpParseMode.Statements
            }
          }
          currentProp.exp = createExp(
            currentAttrValue,
            false,
            getLoc(currentAttrStartIndex, currentAttrEndIndex),
            ConstantTypes.NOT_CONSTANT,
            expParseMode,
          )
          if (currentProp.name === 'for') {
            currentProp.forParseResult = parseForExpression(currentProp.exp)
          }
          // Vue 2 兼容：`:foo.sync="bar"` 等价迁移为 `v-model:foo="bar"`。
          let syncIndex = -1
          if (
            __COMPAT__ &&
            currentProp.name === 'bind' &&
            (syncIndex = currentProp.modifiers.findIndex(
              mod => mod.content === 'sync',
            )) > -1 &&
            checkCompatEnabled(
              CompilerDeprecationTypes.COMPILER_V_BIND_SYNC,
              currentOptions,
              currentProp.loc,
              currentProp.arg!.loc.source,
            )
          ) {
            currentProp.name = 'model'
            currentProp.modifiers.splice(syncIndex, 1)
          }
        }
      }
      if (
        currentProp.type !== NodeTypes.DIRECTIVE ||
        currentProp.name !== 'pre'
      ) {
        currentOpenTag.props.push(currentProp)
      }
    }
    currentAttrValue = ''
    currentAttrStartIndex = currentAttrEndIndex = -1
  },

  /** 根据 comments 选项把 tokenizer 的注释范围转为 CommentNode。 */
  oncomment(start, end) {
    if (currentOptions.comments) {
      addNode({
        type: NodeTypes.COMMENT,
        content: getSlice(start, end),
        loc: getLoc(start - 4, end + 3),
      })
    }
  },

  /** 输入耗尽时按状态报告精确 EOF 错误，并关闭仍留在栈中的元素。 */
  onend() {
    const end = currentInput.length
    // 根据 tokenizer 停留状态报告更准确的 EOF 错误，而非笼统提示模板未结束。
    if ((__DEV__ || !__BROWSER__) && tokenizer.state !== State.Text) {
      switch (tokenizer.state) {
        case State.BeforeTagName:
        case State.BeforeClosingTagName:
          emitError(ErrorCodes.EOF_BEFORE_TAG_NAME, end)
          break
        case State.Interpolation:
        case State.InterpolationClose:
          emitError(
            ErrorCodes.X_MISSING_INTERPOLATION_END,
            tokenizer.sectionStart,
          )
          break
        case State.InCommentLike:
          if (tokenizer.currentSequence === Sequences.CdataEnd) {
            emitError(ErrorCodes.EOF_IN_CDATA, end)
          } else {
            emitError(ErrorCodes.EOF_IN_COMMENT, end)
          }
          break
        case State.InTagName:
        case State.InSelfClosingTag:
        case State.InClosingTagName:
        case State.BeforeAttrName:
        case State.InAttrName:
        case State.InDirName:
        case State.InDirArg:
        case State.InDirDynamicArg:
        case State.InDirModifier:
        case State.AfterAttrName:
        case State.BeforeAttrValue:
        case State.InAttrValueDq: // "
        case State.InAttrValueSq: // '
        case State.InAttrValueNq:
          emitError(ErrorCodes.EOF_IN_TAG, end)
          break
        default:
          break
      }
    }
    for (let index = 0; index < stack.length; index++) {
      onCloseTag(stack[index], end - 1)
      emitError(ErrorCodes.X_MISSING_END_TAG, stack[index].loc.start.offset)
    }
  },

  /** XML 命名空间把 CDATA 当文本；HTML 命名空间按规范报告错误。 */
  oncdata(start, end) {
    if ((stack[0] ? stack[0].ns : currentOptions.ns) !== Namespaces.HTML) {
      onText(getSlice(start, end), start, end)
    } else {
      emitError(ErrorCodes.CDATA_IN_HTML_CONTENT, start - 9)
    }
  },

  /** HTML 中诊断 XML processing instruction，且不创建运行时节点。 */
  onprocessinginstruction(start) {
    // Vue 运行时没有 XML processing instruction 对应节点；HTML 中仅报错，不保留它。
    if ((stack[0] ? stack[0].ns : currentOptions.ns) === Namespaces.HTML) {
      emitError(
        ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
        start - 1,
      )
    }
  },
})

// 从 `(value, key, index)` 尾部提取 key/index。key/index 使用解构没有实际语义，
// 因此正则有意不覆盖含逗号的嵌套解构；value 解构仍由前面的剩余部分支持。
const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
/** 去除 v-for 左值最外层括号。 */
const stripParensRE = /^\(|\)$/g

/**
 * 把 `v-for="(value, key, index) in source"` 拆成数据源和别名表达式。
 * 每个子表达式保留相对原模板的精确 loc，后续表达式转换报错能指向具体别名。
 */
function parseForExpression(
  input: SimpleExpressionNode,
): ForParseResult | undefined {
  const loc = input.loc
  const exp = input.content
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return

  const [, LHS, RHS] = inMatch

  /** 创建带精确原模板位置的循环 source/value/key/index 表达式。 */
  const createAliasExpression = (
    content: string,
    offset: number,
    asParam = false,
  ) => {
    const start = loc.start.offset + offset
    const end = start + content.length
    return createExp(
      content,
      false,
      getLoc(start, end),
      ConstantTypes.NOT_CONSTANT,
      asParam ? ExpParseMode.Params : ExpParseMode.Normal,
    )
  }

  const result: ForParseResult = {
    source: createAliasExpression(RHS.trim(), exp.indexOf(RHS, LHS.length)),
    value: undefined,
    key: undefined,
    index: undefined,
    finalized: false,
  }

  let valueContent = LHS.trim().replace(stripParensRE, '').trim()
  const trimmedOffset = LHS.indexOf(valueContent)

  const iteratorMatch = valueContent.match(forIteratorRE)
  if (iteratorMatch) {
    valueContent = valueContent.replace(forIteratorRE, '').trim()

    const keyContent = iteratorMatch[1].trim()
    let keyOffset: number | undefined
    if (keyContent) {
      keyOffset = exp.indexOf(keyContent, trimmedOffset + valueContent.length)
      result.key = createAliasExpression(keyContent, keyOffset, true)
    }

    if (iteratorMatch[2]) {
      const indexContent = iteratorMatch[2].trim()

      if (indexContent) {
        result.index = createAliasExpression(
          indexContent,
          exp.indexOf(
            indexContent,
            result.key
              ? keyOffset! + keyContent.length
              : trimmedOffset + valueContent.length,
          ),
          true,
        )
      }
    }
  }

  if (valueContent) {
    result.value = createAliasExpression(valueContent, trimmedOffset, true)
  }

  return result
}

/** 从当前模板源码截取左闭右开区间。 */
function getSlice(start: number, end: number) {
  return currentInput.slice(start, end)
}

/**
 * 完成开标签：加入父级 children，切换 pre/XML 状态，并把非 void 元素压入父元素栈。
 */
function endOpenTag(end: number) {
  if (tokenizer.inSFCRoot) {
    // SFC 各根块的消费者只需内部内容，因此从 `>` 后先建立空范围，闭标签时补终点。
    currentOpenTag!.innerLoc = getLoc(end + 1, end + 1)
  }
  addNode(currentOpenTag!)
  const { tag, ns } = currentOpenTag!
  if (ns === Namespaces.HTML && currentOptions.isPreTag(tag)) {
    inPre++
  }
  if (currentOptions.isVoidTag(tag)) {
    onCloseTag(currentOpenTag!, end)
  } else {
    stack.unshift(currentOpenTag!)
    if (ns === Namespaces.SVG || ns === Namespaces.MATH_ML) {
      tokenizer.inXML = true
    }
  }
  currentOpenTag = null
}

/** 接收一段文本；与紧邻 TextNode 合并，避免实体/分块回调制造碎片节点。 */
function onText(content: string, start: number, end: number) {
  if (__BROWSER__) {
    const tag = stack[0] && stack[0].tag
    if (tag !== 'script' && tag !== 'style' && content.includes('&')) {
      content = currentOptions.decodeEntities!(content, false)
    }
  }
  const parent = stack[0] || currentRoot
  const lastNode = parent.children[parent.children.length - 1]
  if (lastNode && lastNode.type === NodeTypes.TEXT) {
    // tokenizer 可能因实体等原因分段回调，语义连续文本应合成一个节点。
    lastNode.content += content
    setLocEnd(lastNode.loc, end)
  } else {
    parent.children.push({
      type: NodeTypes.TEXT,
      content,
      loc: getLoc(start, end),
    })
  }
}

/**
 * 完成元素节点：确定源码范围、元素语义类型、空白规则和兼容模式行为。
 * `isImplied` 表示因祖先闭合而被隐式关闭，例如 `<div><span></div>` 中的 span。
 */
function onCloseTag(el: ElementNode, end: number, isImplied = false) {
  // 隐式闭合不能把祖先结束标签算进当前元素范围，需要回退到 `<`。
  if (isImplied) {
    setLocEnd(el.loc, backTrack(end, CharCodes.Lt))
  } else {
    setLocEnd(el.loc, lookAhead(end, CharCodes.Gt) + 1)
  }

  if (tokenizer.inSFCRoot) {
    // 根块 innerLoc 只覆盖第一个到最后一个 child；空块则保持零长度范围。
    if (el.children.length) {
      el.innerLoc!.end = extend({}, el.children[el.children.length - 1].loc.end)
    } else {
      el.innerLoc!.end = extend({}, el.innerLoc!.start)
    }
    el.innerLoc!.source = getSlice(
      el.innerLoc!.start.offset,
      el.innerLoc!.end.offset,
    )
  }

  // 看完属性后才能判断 `<component>`、`<slot>`、结构 template 和普通/组件标签。
  const { tag, ns, children } = el
  if (!inVPre) {
    if (tag === 'slot') {
      el.tagType = ElementTypes.SLOT
    } else if (isFragmentTemplate(el)) {
      el.tagType = ElementTypes.TEMPLATE
    } else if (isComponent(el)) {
      el.tagType = ElementTypes.COMPONENT
    }
  }

  // RCDATA 属于原始内容，不能按模板节点间空白规则压缩。
  if (!tokenizer.inRCDATA) {
    el.children = condenseWhitespace(children)
  }

  if (ns === Namespaces.HTML && currentOptions.isIgnoreNewlineTag(tag)) {
    // HTML 规范规定 `<textarea>` / `<pre>` 开标签后的首个换行不属于实际内容。
    // https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody
    const first = children[0]
    if (first && first.type === NodeTypes.TEXT) {
      first.content = first.content.replace(/^\r?\n/, '')
    }
  }

  if (ns === Namespaces.HTML && currentOptions.isPreTag(tag)) {
    inPre--
  }
  if (currentVPreBoundary === el) {
    inVPre = tokenizer.inVPre = false
    currentVPreBoundary = null
  }
  if (
    tokenizer.inXML &&
    (stack[0] ? stack[0].ns : currentOptions.ns) === Namespaces.HTML
  ) {
    tokenizer.inXML = false
  }

  // Vue 2 兼容与废弃语法检查集中在元素完整后执行，因为需要同时查看所有 props/children。
  if (__COMPAT__) {
    const props = el.props
    if (
      __DEV__ &&
      isCompatEnabled(
        CompilerDeprecationTypes.COMPILER_V_IF_V_FOR_PRECEDENCE,
        currentOptions,
      )
    ) {
      let hasIf = false
      let hasFor = false
      for (let i = 0; i < props.length; i++) {
        const p = props[i]
        if (p.type === NodeTypes.DIRECTIVE) {
          if (p.name === 'if') {
            hasIf = true
          } else if (p.name === 'for') {
            hasFor = true
          }
        }
        if (hasIf && hasFor) {
          warnDeprecation(
            CompilerDeprecationTypes.COMPILER_V_IF_V_FOR_PRECEDENCE,
            currentOptions,
            el.loc,
          )
          break
        }
      }
    }

    if (
      !tokenizer.inSFCRoot &&
      isCompatEnabled(
        CompilerDeprecationTypes.COMPILER_NATIVE_TEMPLATE,
        currentOptions,
      ) &&
      el.tag === 'template' &&
      !isFragmentTemplate(el)
    ) {
      __DEV__ &&
        warnDeprecation(
          CompilerDeprecationTypes.COMPILER_NATIVE_TEMPLATE,
          currentOptions,
          el.loc,
        )
      // Vue 2 的无结构指令 `<template>` 是透明容器：用其 children 原地替换自身。
      const parent = stack[0] || currentRoot
      const index = parent.children.indexOf(el)
      parent.children.splice(index, 1, ...el.children)
    }

    const inlineTemplateProp = props.find(
      p => p.type === NodeTypes.ATTRIBUTE && p.name === 'inline-template',
    ) as AttributeNode
    if (
      inlineTemplateProp &&
      checkCompatEnabled(
        CompilerDeprecationTypes.COMPILER_INLINE_TEMPLATE,
        currentOptions,
        inlineTemplateProp.loc,
      ) &&
      el.children.length
    ) {
      inlineTemplateProp.value = {
        type: NodeTypes.TEXT,
        content: getSlice(
          el.children[0].loc.start.offset,
          el.children[el.children.length - 1].loc.end.offset,
        ),
        loc: inlineTemplateProp.loc,
      }
    }
  }
}

/** 从 index 向后寻找指定字符，常用于把 token 末尾扩到 `>`。 */
function lookAhead(index: number, c: number) {
  let i = index
  while (currentInput.charCodeAt(i) !== c && i < currentInput.length - 1) i++
  return i
}

/** 从 index 向前寻找指定字符，常用于隐式闭合时回退到结束标签 `<`。 */
function backTrack(index: number, c: number) {
  let i = index
  while (currentInput.charCodeAt(i) !== c && i >= 0) i--
  return i
}

/** 会让 `<template>` 成为编译期结构容器的指令名。 */
const specialTemplateDir = new Set(['if', 'else', 'else-if', 'for', 'slot'])
/** 判断 template 是否承载结构/插槽语义，因而必须保留为 TemplateNode 交给转换阶段。 */
function isFragmentTemplate({ tag, props }: ElementNode): boolean {
  if (tag === 'template') {
    for (let i = 0; i < props.length; i++) {
      if (
        props[i].type === NodeTypes.DIRECTIVE &&
        specialTemplateDir.has((props[i] as DirectiveNode).name)
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * 按平台标签表、命名约定、内置组件和 `is` 语义判断元素是否应生成组件 VNode。
 */
function isComponent({ tag, props }: ElementNode): boolean {
  if (currentOptions.isCustomElement(tag)) {
    return false
  }
  if (
    tag === 'component' ||
    isUpperCase(tag.charCodeAt(0)) ||
    isCoreComponent(tag) ||
    (currentOptions.isBuiltInComponent &&
      currentOptions.isBuiltInComponent(tag)) ||
    (currentOptions.isNativeTag && !currentOptions.isNativeTag(tag))
  ) {
    return true
  }
  // 到这里通常已是原生标签，仍需检查 `is="vue:Comp"` 以及 Vue 2 兼容的 is 转换。
  for (let i = 0; i < props.length; i++) {
    const p = props[i]
    if (p.type === NodeTypes.ATTRIBUTE) {
      if (p.name === 'is' && p.value) {
        if (p.value.content.startsWith('vue:')) {
          return true
        } else if (
          __COMPAT__ &&
          checkCompatEnabled(
            CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
            currentOptions,
            p.loc,
          )
        ) {
          return true
        }
      }
    } else if (
      __COMPAT__ &&
      // 普通元素上的动态 `:is` 仅在 Vue 2 兼容模式中转换为组件。
      p.name === 'bind' &&
      isStaticArgOf(p.arg, 'is') &&
      checkCompatEnabled(
        CompilerDeprecationTypes.COMPILER_IS_ON_ELEMENT,
        currentOptions,
        p.loc,
      )
    ) {
      return true
    }
  }
  return false
}

/** ASCII 首字符是否大写；PascalCase 标签默认视为组件。 */
function isUpperCase(c: number) {
  return c > 64 && c < 91
}

/** Windows 换行序列，用于 pre 内容归一化。 */
const windowsNewlineRE = /\r\n/g
/**
 * 按 `whitespace` 选项整理同一父节点下的文本空白。
 *
 * 只删除不会影响浏览器行内布局的边界/节点间空白；可能分隔两段行内内容的空白保留为
 * 单个空格。`<pre>` 不压缩内容，但仍把 CRLF 统一为 LF，保证 SSR 服务端字符串与浏览器
 * 解析后的 DOM 文本一致。
 */
function condenseWhitespace(nodes: TemplateChildNode[]): TemplateChildNode[] {
  const shouldCondense = currentOptions.whitespace !== 'preserve'
  let removedWhitespace = false
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type === NodeTypes.TEXT) {
      if (!inPre) {
        if (isAllWhitespace(node.content)) {
          const prev = nodes[i - 1] && nodes[i - 1].type
          const next = nodes[i + 1] && nodes[i + 1].type
          // 以下空白可安全删除：首尾空白；压缩模式下两个注释之间、注释与元素之间，
          // 或两个元素之间且源码含换行的纯空白。
          if (
            !prev ||
            !next ||
            (shouldCondense &&
              ((prev === NodeTypes.COMMENT &&
                (next === NodeTypes.COMMENT || next === NodeTypes.ELEMENT)) ||
                (prev === NodeTypes.ELEMENT &&
                  (next === NodeTypes.COMMENT ||
                    (next === NodeTypes.ELEMENT &&
                      hasNewlineChar(node.content))))))
          ) {
            removedWhitespace = true
            nodes[i] = null as any
          } else {
            // 其余纯空白可能影响行内布局，只合并成单个空格。
            node.content = ' '
          }
        } else if (shouldCondense) {
          // 非纯空白文本中的连续空白也合并成一个空格。
          node.content = condense(node.content)
        }
      } else {
        // 修复 #6410：浏览器会把 SSR HTML 中的 CRLF 解析为单个 LF；编译期同步归一化，
        // 防止 `<pre>` 客户端 hydration 时文本节点与服务端 DOM 不一致。
        node.content = node.content.replace(windowsNewlineRE, '\n')
      }
    }
  }
  return removedWhitespace ? nodes.filter(Boolean) : nodes
}

/** 检查字符串是否含 LF 或 CR。 */
function hasNewlineChar(str: string) {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c === CharCodes.NewLine || c === CharCodes.CarriageReturn) {
      return true
    }
  }
  return false
}

/** 把任意连续 HTML 空白字符压缩成一个普通空格。 */
function condense(str: string) {
  let ret = ''
  let prevCharIsWhitespace = false
  for (let i = 0; i < str.length; i++) {
    if (isWhitespace(str.charCodeAt(i))) {
      if (!prevCharIsWhitespace) {
        ret += ' '
        prevCharIsWhitespace = true
      }
    } else {
      ret += str[i]
      prevCharIsWhitespace = false
    }
  }
  return ret
}

/** 把节点追加到当前最近未闭合元素；没有父元素时追加到 RootNode。 */
function addNode(node: TemplateChildNode) {
  ;(stack[0] || currentRoot).children.push(node)
}

/** 根据 tokenizer 的行偏移信息构造源码范围；end 缺省时允许稍后补齐。 */
function getLoc(start: number, end?: number): SourceLocation {
  return {
    start: tokenizer.getPos(start),
    // @ts-expect-error 元素/属性开始时结束位置未知，完成 token 后再补。
    end: end == null ? end : tokenizer.getPos(end),
    // @ts-expect-error 同上，源码切片延迟到结束偏移已知时生成。
    source: end == null ? end : getSlice(start, end),
  }
}

/** 用当前输入重新构造 location，避免调用方共享并误改原位置对象。 */
export function cloneLoc(loc: SourceLocation): SourceLocation {
  return getLoc(loc.start.offset, loc.end.offset)
}

/** 补齐已创建 location 的结束位置和源码切片。 */
function setLocEnd(loc: SourceLocation, end: number) {
  loc.end = tokenizer.getPos(end)
  loc.source = getSlice(loc.start.offset, end)
}

/**
 * 在 `v-pre` 开启时，把先前识别为指令的节点还原成普通属性，并恢复引号范围。
 */
function dirToAttr(dir: DirectiveNode): AttributeNode {
  const attr: AttributeNode = {
    type: NodeTypes.ATTRIBUTE,
    name: dir.rawName!,
    nameLoc: getLoc(
      dir.loc.start.offset,
      dir.loc.start.offset + dir.rawName!.length,
    ),
    value: undefined,
    loc: dir.loc,
  }
  if (dir.exp) {
    // 指令 exp.loc 默认只含值内部；普通属性值 location 还应包含包裹引号。
    const loc = dir.exp.loc
    if (loc.end.offset < dir.loc.end.offset) {
      loc.start.offset--
      loc.start.column--
      loc.end.offset++
      loc.end.column++
    }
    attr.value = {
      type: NodeTypes.TEXT,
      content: (dir.exp as SimpleExpressionNode).content,
      loc,
    }
  }
  return attr
}

/** Babel 解析模板表达式时使用的四种语法上下文。 */
enum ExpParseMode {
  /** 普通 JS 表达式，如插值、v-bind。 */
  Normal,
  /** 函数参数/解构模式，如 v-slot、v-for 别名。 */
  Params,
  /** 可含多条语句的事件处理器。 */
  Statements,
  /** 暂不解析，例如尚需拆分左右两侧的完整 v-for。 */
  Skip,
}

/**
 * 创建简单表达式，并在 Node 前缀模式下用 Babel 预解析语法树。
 * AST 缓存在节点上供 transformExpression 复用；简单标识符走快速路径，以 `null` 标记。
 */
function createExp(
  content: SimpleExpressionNode['content'],
  isStatic: SimpleExpressionNode['isStatic'] = false,
  loc: SourceLocation,
  constType: ConstantTypes = ConstantTypes.NOT_CONSTANT,
  parseMode = ExpParseMode.Normal,
) {
  const exp = createSimpleExpression(content, isStatic, loc, constType)
  if (
    !__BROWSER__ &&
    !isStatic &&
    currentOptions.prefixIdentifiers &&
    parseMode !== ExpParseMode.Skip &&
    content.trim()
  ) {
    if (isSimpleIdentifier(content)) {
      exp.ast = null // 简单标识符无需启动 Babel。
      return exp
    }
    try {
      const plugins = currentOptions.expressionPlugins
      const options: BabelOptions = {
        plugins: plugins ? [...plugins, 'typescript'] : ['typescript'],
      }
      if (parseMode === ExpParseMode.Statements) {
        // 两侧补一字符，保证 Babel 节点偏移与模板表达式内部偏移对齐。
        exp.ast = parse(` ${content} `, options).program
      } else if (parseMode === ExpParseMode.Params) {
        exp.ast = parseExpression(`(${content})=>{}`, options)
      } else {
        // 用括号强制按表达式解析，避免对象字面量被解释为语句块。
        exp.ast = parseExpression(`(${content})`, options)
      }
    } catch (e: any) {
      exp.ast = false // 缓存失败状态，后续转换不再重复报错。
      emitError(ErrorCodes.X_INVALID_EXPRESSION, loc.start.offset, e.message)
    }
  }
  return exp
}

/** 以零长度 location 上报指定源码偏移处的解析错误。 */
function emitError(code: ErrorCodes, index: number, message?: string) {
  currentOptions.onError(
    createCompilerError(code, getLoc(index, index), undefined, message),
  )
}

/** 清空上一次解析的 tokenizer 与节点组装状态。 */
function reset() {
  tokenizer.reset()
  currentOpenTag = null
  currentProp = null
  currentAttrValue = ''
  currentAttrStartIndex = -1
  currentAttrEndIndex = -1
  stack.length = 0
}

/**
 * 把模板源码解析为平台无关 AST。
 *
 * 此阶段只完成词法结构、元素/指令归一化、表达式预解析和空白整理，不生成 VNode 调用。
 * 平台编译器通过 ParserOptions 提供 namespace、void 标签、自定义元素等规则。
 *
 * @param input 完整模板源码
 * @param options 平台解析规则与错误处理选项
 * @returns 尚未执行 transform 的 RootNode
 */
export function baseParse(input: string, options?: ParserOptions): RootNode {
  reset()
  currentInput = input
  currentOptions = extend({}, defaultParserOptions)

  if (options) {
    let key: keyof ParserOptions
    for (key in options) {
      if (options[key] != null) {
        // @ts-expect-error
        currentOptions[key] = options[key]
      }
    }
  }

  if (__DEV__) {
    if (!__BROWSER__ && currentOptions.decodeEntities) {
      console.warn(
        `[@vue/compiler-core] decodeEntities option is passed but will be ` +
          `ignored in non-browser builds.`,
      )
    } else if (__BROWSER__ && !__TEST__ && !currentOptions.decodeEntities) {
      throw new Error(
        `[@vue/compiler-core] decodeEntities option is required in browser builds.`,
      )
    }
  }

  tokenizer.mode =
    currentOptions.parseMode === 'html'
      ? ParseMode.HTML
      : currentOptions.parseMode === 'sfc'
        ? ParseMode.SFC
        : ParseMode.BASE

  tokenizer.inXML =
    currentOptions.ns === Namespaces.SVG ||
    currentOptions.ns === Namespaces.MATH_ML

  const delimiters = options && options.delimiters
  if (delimiters) {
    tokenizer.delimiterOpen = toCharCodes(delimiters[0])
    tokenizer.delimiterClose = toCharCodes(delimiters[1])
  }

  const root = (currentRoot = createRoot([], input))
  tokenizer.parse(currentInput)
  root.loc = getLoc(0, input.length)
  root.children = condenseWhitespace(root.children)
  currentRoot = null
  return root
}
