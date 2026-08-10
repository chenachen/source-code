/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {HydrationDiffNode} from 'react-reconciler/src/ReactFiberHydrationDiffs';

import {
  current,
  runWithFiberInDEV,
} from 'react-reconciler/src/ReactCurrentFiber';
import {
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
} from 'react-reconciler/src/ReactWorkTags';

import {describeDiff} from 'react-reconciler/src/ReactFiberHydrationDiffs';

/** `describeAncestors` 执行宿主属性处理步骤，并把副作用限制在当前 DOM 节点；用于依据 HTML 解析器规则维护祖先上下文并报告会改变解析树的非法嵌套。 */
function describeAncestors(
  ancestor: Fiber,
  child: Fiber,
  props: null | {
    /** hydration diff 使用的空 children 占位，防止把真实子树重复打印。 */
    children: null
  },
): string {
  let fiber: null | Fiber = child;
  let node: null | HydrationDiffNode = null;
  let distanceFromLeaf = 0;
  while (fiber) {
    if (fiber === ancestor) {
      distanceFromLeaf = 0;
    }
    node = {
      fiber: fiber,
      children: node !== null ? [node] : [],
      serverProps:
        fiber === child ? props : fiber === ancestor ? null : undefined,
      serverTail: [],
      distanceFromLeaf: distanceFromLeaf,
    };
    distanceFromLeaf++;
    fiber = fiber.return;
  }
  if (node !== null) {
    //使用水合差异逻辑描述节点。
    //用 - 替换 + 来标记祖先和子代。这有点随意。
    return describeDiff(node).replaceAll(/^[+-]/gm, '>');
  }
  return '';
}

/** `Info` 保存一个影响 HTML 解析规则的祖先标签。 */
type Info = {
  /** 祖先宿主标签名。 */
  tag: string
};
/** `AncestorInfoDev` 定义依据 HTML 解析器规则维护祖先上下文并报告会改变解析树的非法嵌套的数据契约；字段共同约束状态所有权与分支边界。 */
export type AncestorInfoDev = {
  /** `AncestorInfoDev.current` 表示跨校验或提交步骤传递的受限状态；只在所属契约的生命周期内有效。 */
  current: ?Info,

  /** `AncestorInfoDev.formTag` 表示当前或祖先 HTML 标签名；只在所属契约的生命周期内有效。 */
  formTag: ?Info,
  /** `AncestorInfoDev.aTagInScope` 表示当前或祖先 HTML 标签名；只在所属契约的生命周期内有效。 */
  aTagInScope: ?Info,
  /** `AncestorInfoDev.buttonTagInScope` 表示当前或祖先 HTML 标签名；只在所属契约的生命周期内有效。 */
  buttonTagInScope: ?Info,
  /** `AncestorInfoDev.nobrTagInScope` 表示当前或祖先 HTML 标签名；只在所属契约的生命周期内有效。 */
  nobrTagInScope: ?Info,
  /** `AncestorInfoDev.pTagInButtonScope` 表示当前或祖先 HTML 标签名；只在所属契约的生命周期内有效。 */
  pTagInButtonScope: ?Info,

  /** `AncestorInfoDev.listItemTagAutoclosing` 表示当前或祖先 HTML 标签名；只在所属契约的生命周期内有效。 */
  listItemTagAutoclosing: ?Info,
  /** `AncestorInfoDev.dlItemTagAutoclosing` 表示当前或祖先 HTML 标签名；只在所属契约的生命周期内有效。 */
  dlItemTagAutoclosing: ?Info,

  //<head> 或 <body>
  containerTagInScope: ?Info,
  /** `AncestorInfoDev.implicitRootScope` 表示影响解析模式的最近作用域标签；只在所属契约的生命周期内有效。 */
  implicitRootScope: boolean,
};

//此验证代码是基于 HTML5 解析规范编写的：
//https://html.spec.whatwg.org/multipage/syntax.html#has-an-element-in-scope
//
//注意：这并不能捕捉所有无效的嵌套，也没有尝试去捕捉（因为它是
//不清楚这样做能提供什么实际好处；相反，我们只警告
//对于解析器给出的解析树与 React 不同的情况
//预期的。例如，<b><div></div></b> 是无效的，但我们不发出警告
//因为它仍然能够正确解析；我们会对其他情况如嵌套发出警告
//<p> 标签，其中第二个元素的开头隐式地关闭了
//首先，造成了混乱的局面。

//https://html.spec.whatwg.org/multipage/syntax.html#special
const specialTags = [
  'address',
  'applet',
  'area',
  'article',
  'aside',
  'base',
  'basefont',
  'bgsound',
  'blockquote',
  'body',
  'br',
  'button',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'img',
  'input',
  'isindex',
  'li',
  'link',
  'listing',
  'main',
  'marquee',
  'menu',
  'menuitem',
  'meta',
  'nav',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'ol',
  'p',
  'param',
  'plaintext',
  'pre',
  'script',
  'section',
  'select',
  'source',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
  'wbr',
  'xmp',
];

//https://html.spec.whatwg.org/multipage/syntax.html#has-an-element-in-scope
const inScopeTags = [
  'applet',
  'caption',
  'html',
  'table',
  'td',
  'th',
  'marquee',
  'object',
  'template',

  //https://html.spec.whatwg.org/multipage/syntax.html#html-integration-point
  //待办事项：在此按命名空间区分 —— 对于 <title>，包括在此
  //偏向于更少的警告
  'foreignObject',
  'desc',
  'title',
];

//https://html.spec.whatwg.org/multipage/syntax.html#has-an-element-in-button-scope
const buttonScopeTags = __DEV__ ? inScopeTags.concat(['button']) : [];

//https://html.spec.whatwg.org/multipage/syntax.html#generate-implied-end-tags
const impliedEndTags = [
  'dd',
  'dt',
  'li',
  'option',
  'optgroup',
  'p',
  'rp',
  'rt',
];

/** `emptyAncestorInfoDev` 保存依据 HTML 解析器规则维护祖先上下文并报告会改变解析树的非法嵌套所需的共享映射、集合或模块级状态；生命周期覆盖当前 renderer。 */
const emptyAncestorInfoDev: AncestorInfoDev = {
  current: null,

  formTag: null,
  aTagInScope: null,
  buttonTagInScope: null,
  nobrTagInScope: null,
  pTagInButtonScope: null,

  listItemTagAutoclosing: null,
  dlItemTagAutoclosing: null,

  containerTagInScope: null,
  implicitRootScope: false,
};

/** `updatedAncestorInfoDev` 同步 DOM/Fiber 状态，并维持提交前后快照一致；用于依据 HTML 解析器规则维护祖先上下文并报告会改变解析树的非法嵌套。 */
function updatedAncestorInfoDev(
  oldInfo: null | AncestorInfoDev,
  tag: string,
): AncestorInfoDev {
  if (__DEV__) {
    const ancestorInfo = {...(oldInfo || emptyAncestorInfoDev)};
    const info = {tag};

    if (inScopeTags.indexOf(tag) !== -1) {
      ancestorInfo.aTagInScope = null;
      ancestorInfo.buttonTagInScope = null;
      ancestorInfo.nobrTagInScope = null;
    }
    if (buttonScopeTags.indexOf(tag) !== -1) {
      ancestorInfo.pTagInButtonScope = null;
    }

    if (
      specialTags.indexOf(tag) !== -1 &&
      tag !== 'address' &&
      tag !== 'div' &&
      tag !== 'p'
    ) {
      //查看 'li'、'dd'、'dt' 起始标签的规则
      //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-inbody
      ancestorInfo.listItemTagAutoclosing = null;
      ancestorInfo.dlItemTagAutoclosing = null;
    }

    ancestorInfo.current = info;

    if (tag === 'form') {
      ancestorInfo.formTag = info;
    }
    if (tag === 'a') {
      ancestorInfo.aTagInScope = info;
    }
    if (tag === 'button') {
      ancestorInfo.buttonTagInScope = info;
    }
    if (tag === 'nobr') {
      ancestorInfo.nobrTagInScope = info;
    }
    if (tag === 'p') {
      ancestorInfo.pTagInButtonScope = info;
    }
    if (tag === 'li') {
      ancestorInfo.listItemTagAutoclosing = info;
    }
    if (tag === 'dd' || tag === 'dt') {
      ancestorInfo.dlItemTagAutoclosing = info;
    }
    if (tag === '#document' || tag === 'html') {
      ancestorInfo.containerTagInScope = null;
    } else if (!ancestorInfo.containerTagInScope) {
      ancestorInfo.containerTagInScope = info;
    }

    if (
      oldInfo === null &&
      (tag === '#document' || tag === 'html' || tag === 'body')
    ) {
      //虽然 <head> 也是单例，但我们不想支持这样的语义
      //你可以通过将主体渲染为单例来避免头部，这样我们就像对待普通作用域一样对待它
      ancestorInfo.implicitRootScope = true;
    } else if (ancestorInfo.implicitRootScope === true) {
      ancestorInfo.implicitRootScope = false;
    }

    return ancestorInfo;
  } else {
    return null as any;
  }
}

/**
 * 返回是否
 */
function isTagValidWithParent(
  tag: string,
  parentTag: ?string,
  implicitRootScope: boolean,
): boolean {
  //首先，让我们检查一下我们是否处于异常解析模式...
  switch (parentTag) {
    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-inselect
    case 'select':
      return (
        tag === 'hr' ||
        tag === 'option' ||
        tag === 'optgroup' ||
        tag === 'script' ||
        tag === 'template' ||
        tag === '#text'
      );
    case 'optgroup':
      return tag === 'option' || tag === '#text';
    //严格来说，看到 <option> 并不意味着我们处于 <select>
    //但是
    case 'option':
      return tag === '#text';
    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-intd
    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-incaption
    //没有特殊行为，因为这些规则会回退到“正文中”模式
    //除了特殊的表节点外，因为它们本来就会导致解析行为异常。

    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-intr
    case 'tr':
      return (
        tag === 'th' ||
        tag === 'td' ||
        tag === 'style' ||
        tag === 'script' ||
        tag === 'template'
      );
    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-intbody
    case 'tbody':
    case 'thead':
    case 'tfoot':
      return (
        tag === 'tr' ||
        tag === 'style' ||
        tag === 'script' ||
        tag === 'template'
      );
    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-incolgroup
    case 'colgroup':
      return tag === 'col' || tag === 'template';
    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-intable
    case 'table':
      return (
        tag === 'caption' ||
        tag === 'colgroup' ||
        tag === 'tbody' ||
        tag === 'tfoot' ||
        tag === 'thead' ||
        tag === 'style' ||
        tag === 'script' ||
        tag === 'template'
      );
    //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-inhead
    case 'head':
      return (
        tag === 'base' ||
        tag === 'basefont' ||
        tag === 'bgsound' ||
        tag === 'link' ||
        tag === 'meta' ||
        tag === 'title' ||
        tag === 'noscript' ||
        tag === 'noframes' ||
        tag === 'style' ||
        tag === 'script' ||
        tag === 'template'
      );
    //https://html.spec.whatwg.org/multipage/semantics.html#the-html-element
    case 'html':
      if (implicitRootScope) {
        //当我们的父标签是 html 并且我们处于根作用域时，我们实际上会
        //将大多数标签插入到正文中，所以我们需要继续进行验证
        //下面使用“在正文中”解析模式的特定标签
        break;
      }
      return tag === 'head' || tag === 'body' || tag === 'frameset';
    case 'frameset':
      return tag === 'frame';
    case '#document':
      if (implicitRootScope) {
        //当我们的父对象是文档且我们处于根作用域时，我们实际上会
        //将大多数标签插入到正文中，所以我们需要继续进行验证
        //下面使用“在正文中”解析模式的特定标签
        break;
      }
      return tag === 'html';
  }

  //可能是在“体内”解析模式下，所以我们只禁止标签组合
  //解析规则导致隐式的打开或关闭被添加的地方。
  //https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-inbody
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return (
        parentTag !== 'h1' &&
        parentTag !== 'h2' &&
        parentTag !== 'h3' &&
        parentTag !== 'h4' &&
        parentTag !== 'h5' &&
        parentTag !== 'h6'
      );

    case 'rp':
    case 'rt':
      // $FlowFixMe[incompatible-type]
      return impliedEndTags.indexOf(parentTag) === -1;

    case 'caption':
    case 'col':
    case 'colgroup':
    case 'frameset':
    case 'frame':
    case 'tbody':
    case 'td':
    case 'tfoot':
    case 'th':
    case 'thead':
    case 'tr':
      //这些标签仅在具有特殊子元素的少数父元素中有效
      //解析规则——如果我们在这里，那么那些都不匹配，并且
      //所以我们只在不知道父对象是什么时才允许它，就像所有其他情况一样
      //案件无效。
      return parentTag == null;
    case 'head':
      //我们支持在容器为根时呈现 <head>
      //#文档, <html>, 或 <body>。
      return implicitRootScope || parentTag === null;
    case 'html':
      //当容器位于根部时，我们支持渲染 <html>
      //#文档
      return (
        (implicitRootScope && parentTag === '#document') || parentTag === null
      );
    case 'body':
      //当容器为时，我们支持在根部渲染 <body>
      //#文档 或 <html>
      return (
        (implicitRootScope &&
          (parentTag === '#document' || parentTag === 'html')) ||
        parentTag === null
      );
  }

  return true;
}

/**
 * 返回是否
 */
function findInvalidAncestorForTag(
  tag: string,
  ancestorInfo: AncestorInfoDev,
): ?Info {
  switch (tag) {
    case 'address':
    case 'article':
    case 'aside':
    case 'blockquote':
    case 'center':
    case 'details':
    case 'dialog':
    case 'dir':
    case 'div':
    case 'dl':
    case 'fieldset':
    case 'figcaption':
    case 'figure':
    case 'footer':
    case 'header':
    case 'hgroup':
    case 'main':
    case 'menu':
    case 'nav':
    case 'ol':
    case 'p':
    case 'section':
    case 'summary':
    case 'ul':
    case 'pre':
    case 'listing':
    case 'table':
    case 'hr':
    case 'xmp':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return ancestorInfo.pTagInButtonScope;

    case 'form':
      return ancestorInfo.formTag || ancestorInfo.pTagInButtonScope;

    case 'li':
      return ancestorInfo.listItemTagAutoclosing;

    case 'dd':
    case 'dt':
      return ancestorInfo.dlItemTagAutoclosing;

    case 'button':
      return ancestorInfo.buttonTagInScope;

    case 'a':
      //规范中提到存储标记列表，但听起来
      //等同于此检查。
      return ancestorInfo.aTagInScope;

    case 'nobr':
      return ancestorInfo.nobrTagInScope;
  }

  return null;
}

/** `didWarn` 按父子标签组合去重开发期嵌套警告。 */
const didWarn: {
  /** 警告键到“已报告”状态的索引。 */
  [string]: boolean
} = {};

/** `findAncestor` 查询或比较当前宿主状态；无匹配时返回显式空结果；用于依据 HTML 解析器规则维护祖先上下文并报告会改变解析树的非法嵌套。 */
function findAncestor(parent: null | Fiber, tagName: string): null | Fiber {
  while (parent) {
    switch (parent.tag) {
      case HostComponent:
      case HostHoistable:
      case HostSingleton:
        if (parent.type === tagName) {
          return parent;
        }
    }
    parent = parent.return;
  }
  return null;
}

/** `validateDOMNesting` 校验输入并仅在开发环境报告违反的宿主不变量；用于依据 HTML 解析器规则维护祖先上下文并报告会改变解析树的非法嵌套。 */
function validateDOMNesting(
  childTag: string,
  ancestorInfo: AncestorInfoDev,
): boolean {
  if (__DEV__) {
    ancestorInfo = ancestorInfo || emptyAncestorInfoDev;
    const parentInfo = ancestorInfo.current;
    const parentTag = parentInfo && parentInfo.tag;

    const invalidParent = isTagValidWithParent(
      childTag,
      parentTag,
      ancestorInfo.implicitRootScope,
    )
      ? null
      : parentInfo;
    const invalidAncestor = invalidParent
      ? null
      : findInvalidAncestorForTag(childTag, ancestorInfo);
    const invalidParentOrAncestor = invalidParent || invalidAncestor;
    if (!invalidParentOrAncestor) {
      return true;
    }

    const ancestorTag = invalidParentOrAncestor.tag;

    const warnKey =
      // eslint-disable-next-line react-internal/safe-string-coercion
      String(!!invalidParent) + '|' + childTag + '|' + ancestorTag;
    if (didWarn[warnKey]) {
      return false;
    }
    didWarn[warnKey] = true;

    const child = current;
    const ancestor = child ? findAncestor(child.return, ancestorTag) : null;

    const ancestorDescription =
      child !== null && ancestor !== null
        ? describeAncestors(ancestor, child, null)
        : '';

    const tagDisplayName = '<' + childTag + '>';
    if (invalidParent) {
      let info = '';
      if (ancestorTag === 'table' && childTag === 'tr') {
        info +=
          ' Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by ' +
          'the browser.';
      }
      console.error(
        'In HTML, %s cannot be a child of <%s>.%s\n' +
          'This will cause a hydration error.%s',
        tagDisplayName,
        ancestorTag,
        info,
        ancestorDescription,
      );
    } else {
      console.error(
        'In HTML, %s cannot be a descendant of <%s>.\n' +
          'This will cause a hydration error.%s',
        tagDisplayName,
        ancestorTag,
        ancestorDescription,
      );
    }
    if (child) {
      //出于调试目的，找到导致问题的最近的祖先。
      //这个祖先的堆栈跟踪可能有助于找到原因。
      //如果父项是在相同所有者下的直接父项，我们就不管它。
      const parent = child.return;
      if (
        ancestor !== null &&
        parent !== null &&
        (ancestor !== parent || parent._debugOwner !== child._debugOwner)
      ) {
        runWithFiberInDEV(ancestor, () => {
          console.error(
            //我们重复一些上下文，因为这条日志可能会被断章取义
            //例如在 React 开发者工具或分组的服务器日志中。
            '<%s> cannot contain a nested %s.\n' +
              'See this log for the ancestor stack trace.',
            ancestorTag,
            tagDisplayName,
          );
        });
      }
    }
    return false;
  }
  return true;
}

/** `validateTextNesting` 校验输入并仅在开发环境报告违反的宿主不变量；用于依据 HTML 解析器规则维护祖先上下文并报告会改变解析树的非法嵌套。 */
function validateTextNesting(
  childText: string,
  parentTag: string,
  implicitRootScope: boolean,
): boolean {
  if (__DEV__) {
    if (implicitRootScope || isTagValidWithParent('#text', parentTag, false)) {
      return true;
    }

    const warnKey = '#text|' + parentTag;
    if (didWarn[warnKey]) {
      return false;
    }
    didWarn[warnKey] = true;

    const child = current;
    const ancestor = child ? findAncestor(child, parentTag) : null;

    const ancestorDescription =
      child !== null && ancestor !== null
        ? describeAncestors(
            ancestor,
            child,
            child.tag !== HostText ? {children: null} : null,
          )
        : '';

    if (/\S/.test(childText)) {
      console.error(
        'In HTML, text nodes cannot be a child of <%s>.\n' +
          'This will cause a hydration error.%s',
        parentTag,
        ancestorDescription,
      );
    } else {
      console.error(
        'In HTML, whitespace text nodes cannot be a child of <%s>. ' +
          "Make sure you don't have any extra whitespace between tags on " +
          'each line of your source code.\n' +
          'This will cause a hydration error.%s',
        parentTag,
        ancestorDescription,
      );
    }
    return false;
  }
  return true;
}

export {updatedAncestorInfoDev, validateDOMNesting, validateTextNesting};
