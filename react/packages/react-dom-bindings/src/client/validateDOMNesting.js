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

/** 构造 hydration diff 风格的祖先片段，用于非法嵌套警告。 */
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
/** 开发期沿宿主标签传递的 HTML 解析器作用域快照。 */
export type AncestorInfoDev = {
  /** 当前最内层宿主标签记录。 */
  current: ?Info,

  /** 当前作用域内尚未闭合的 form 标签。 */
  formTag: ?Info,
  /** 当前 in-scope 的 a，遇到作用域边界清空。 */
  aTagInScope: ?Info,
  /** 当前 in-scope 的 button，遇到作用域边界清空。 */
  buttonTagInScope: ?Info,
  /** 当前 in-scope 的 nobr。 */
  nobrTagInScope: ?Info,
  /** button scope 内可能被新标签隐式闭合的 p。 */
  pTagInButtonScope: ?Info,

  /** 会被新的 li 起始标签隐式关闭的祖先 li。 */
  listItemTagAutoclosing: ?Info,
  /** 会被新的 dd/dt 起始标签隐式关闭的祖先 dd/dt。 */
  dlItemTagAutoclosing: ?Info,

  /** 遇到Document/html清空，再记随后首个普通标签；用于判断当前是否有普通宿主容器，区别根级可提升标签与普通后代范围。 */
  containerTagInScope: ?Info,
  /** Document、html、body 的根作用域，允许解析器隐式插入 head/body；进入普通后代后关闭。 */
  implicitRootScope: boolean,
};

//此验证代码是基于 HTML5 解析规范编写的：
//https://html.spec.whatwg.org/multipage/syntax.html#has-an-element-in-scope
//
// 只警告会使浏览器解析树偏离 React 树的嵌套，例如第二个 <p> 会隐式闭合第一个。
// <b><div></div></b> 虽不符合内容模型，但解析后结构仍相同，因此此处不警告。

//https://html.spec.whatwg.org/multipage/syntax.html#special
/** HTML 解析器的特殊标签名单，用来截断 li/dd/dt 隐式闭合祖先的搜索作用域。 */
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
/** 遇到这些标签时清空 a/button/nobr 的 in-scope 祖先记录，按解析器作用域限制嵌套检查。 */
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
  // TODO：按命名空间区分；当前将 title 计入作用域边界，会减少嵌套警告。
  'foreignObject',
  'desc',
  'title',
];

//https://html.spec.whatwg.org/multipage/syntax.html#has-an-element-in-button-scope
/** button scope 比普通 scope 多一个 button 边界，决定 p 是否会被后代标签隐式闭合。 */
const buttonScopeTags = __DEV__ ? inScopeTags.concat(['button']) : [];

//https://html.spec.whatwg.org/multipage/syntax.html#generate-implied-end-tags
/** 可由解析器隐式结束的标签；rp/rt 出现于这些父标签下会产生与 React 子树不同的结构。 */
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

/** 新根使用的空祖先作用域快照。 */
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

/** 复制祖先快照，按新标签清理 HTML 解析作用域并登记可隐式闭合的祖先。 */
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
      // Document/html/body 可作为隐式根作用域；head 仍使用专门的内容规则，
      // 不允许把任意正文内容当成 head 下的隐式 body。
      ancestorInfo.implicitRootScope = true;
    } else if (ancestorInfo.implicitRootScope === true) {
      ancestorInfo.implicitRootScope = false;
    }

    return ancestorInfo;
  } else {
    return null as any;
  }
}

/** 判断直接父子标签是否符合此验证器的解析规则，包含隐式根作用域的例外。 */
function isTagValidWithParent(
  tag: string,
  parentTag: ?string,
  implicitRootScope: boolean,
): boolean {
  // 先处理 select、table、head 等具有专用解析规则的父标签。
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
    // 即使 option 不在 select 内，此验证器也只允许它直接包含文本。
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

  // 其余按“in body”规则检查会隐式打开或闭合标签的组合。
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
      // 上面的专用父标签规则均未命中；这些标签仅在未知父标签时放行。
      return parentTag == null;
    case 'head':
      // head 允许作为 Document/html/body 隐式根作用域下的节点。
      return implicitRootScope || parentTag === null;
    case 'html':
      // html 只在 Document 隐式根作用域或未知父标签下放行。
      return (
        (implicitRootScope && parentTag === '#document') || parentTag === null
      );
    case 'body':
      // body 允许在 Document/html 隐式根作用域或未知父标签下出现。
      return (
        (implicitRootScope &&
          (parentTag === '#document' || parentTag === 'html')) ||
        parentTag === null
      );
  }

  return true;
}

/** 从祖先作用域快照返回会导致当前标签隐式闭合或非法嵌套的祖先；无冲突时返回 null。 */
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

/** 沿 Fiber.return 找指定标签的最近 HostComponent/HostHoistable/HostSingleton，供开发警告定位。 */
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

/** 开发期检查会改变 HTML 解析树的父子/祖先关系，按组合去重警告，并返回是否合法。 */
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

/** 开发期检查父标签能否接受文本，区分非空白与纯空白文本的诊断。 */
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
