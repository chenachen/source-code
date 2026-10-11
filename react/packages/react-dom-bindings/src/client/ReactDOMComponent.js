/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {HostContext, HostContextDev} from './ReactFiberConfigDOM';

import {HostContextNamespaceNone} from './ReactFiberConfigDOM';

import {
  registrationNameDependencies,
  possibleRegistrationNames,
} from '../events/EventRegistry';

import {checkHtmlStringCoercion} from 'shared/CheckStringCoercion';
import {checkAttributeStringCoercion} from 'shared/CheckStringCoercion';
import {checkControlledValueProps} from '../shared/ReactControlledValuePropTypes';

import {
  getValueForAttribute,
  getValueForAttributeOnCustomComponent,
  setValueForPropertyOnCustomComponent,
  setValueForKnownAttribute,
  setValueForAttribute,
  setValueForNamespacedAttribute,
} from './DOMPropertyOperations';
import {
  validateInputProps,
  initInput,
  updateInput,
  restoreControlledInputState,
} from './ReactDOMInput';
import {validateOptionProps} from './ReactDOMOption';
import {
  validateSelectProps,
  initSelect,
  restoreControlledSelectState,
  updateSelect,
} from './ReactDOMSelect';
import {
  validateTextareaProps,
  initTextarea,
  updateTextarea,
  restoreControlledTextareaState,
} from './ReactDOMTextarea';
import {setSrcObject} from './ReactDOMSrcObject';
import {validateTextNesting} from './validateDOMNesting';
import setTextContent from './setTextContent';
import {
  createDangerousStringForStyles,
  setValueForStyles,
} from './CSSPropertyOperations';
import {SVG_NAMESPACE, MATH_NAMESPACE} from './DOMNamespaces';
import isCustomElement from '../shared/isCustomElement';
import getAttributeAlias from '../shared/getAttributeAlias';
import possibleStandardNames from '../shared/possibleStandardNames';
import {validateProperties as validateARIAProperties} from '../shared/ReactDOMInvalidARIAHook';
import {validateProperties as validateInputProperties} from '../shared/ReactDOMNullInputValuePropHook';
import {validateProperties as validateUnknownProperties} from '../shared/ReactDOMUnknownPropertyHook';
import sanitizeURL from '../shared/sanitizeURL';

import noop from 'shared/noop';

import {trackHostMutation} from 'react-reconciler/src/ReactFiberMutationTracking';

import {
  enableHydrationChangeEvent,
  enableScrollEndPolyfill,
  enableSrcObject,
  enableTrustedTypesIntegration,
  enableViewTransition,
  enableViewTransitionParentEnterExit,
} from 'shared/ReactFeatureFlags';
import {
  mediaEventTypes,
  listenToNonDelegatedEvent,
} from '../events/DOMPluginEventSystem';

let didWarnControlledToUncontrolled = false;
let didWarnUncontrolledToControlled = false;
let didWarnFormActionType = false;
let didWarnFormActionName = false;
let didWarnFormActionTarget = false;
let didWarnFormActionMethod = false;
let didWarnForNewBooleanPropsWithEmptyValue: {
  /** 任意 prop 名到“已警告”状态的索引；只在开发期去重同类诊断。 */
  [string]: boolean
};
let didWarnPopoverTargetObject = false;
if (__DEV__) {
  didWarnForNewBooleanPropsWithEmptyValue = {};
}

/** 开发期调用 ARIA、null value 和未知 prop 校验，并检查 contentEditable 与 children 等组合。 */
function validatePropertiesInDevelopment(type: string, props: any) {
  if (__DEV__) {
    validateARIAProperties(type, props);
    validateInputProperties(type, props);
    validateUnknownProperties(type, props, {
      registrationNameDependencies,
      possibleRegistrationNames,
    });
    if (
      props.contentEditable &&
      !props.suppressContentEditableWarning &&
      props.children != null
    ) {
      console.error(
        'A component is `contentEditable` and contains `children` managed by ' +
          'React. It is now your responsibility to guarantee that none of ' +
          'those nodes are unexpectedly modified or duplicated. This is ' +
          'probably not intentional.',
      );
    }
  }
}

/** 开发期检查 action/formAction 的标签与值类型，并报告函数 action 接管的 name/method/target/encType。 */
function validateFormActionInDevelopment(
  tag: string,
  key: string,
  value: mixed,
  props: any,
) {
  if (__DEV__) {
    if (value == null) {
      return;
    }
    if (tag === 'form') {
      if (key === 'formAction') {
        console.error(
          'You can only pass the formAction prop to <input> or <button>. Use the action prop on <form>.',
        );
      } else if (typeof value === 'function') {
        if (
          (props.encType != null || props.method != null) &&
          !didWarnFormActionMethod
        ) {
          didWarnFormActionMethod = true;
          console.error(
            'Cannot specify a encType or method for a form that specifies a ' +
              'function as the action. React provides those automatically. ' +
              'They will get overridden.',
          );
        }
        if (props.target != null && !didWarnFormActionTarget) {
          didWarnFormActionTarget = true;
          console.error(
            'Cannot specify a target for a form that specifies a function as the action. ' +
              'The function will always be executed in the same window.',
          );
        }
      }
    } else if (tag === 'input' || tag === 'button') {
      if (key === 'action') {
        console.error(
          'You can only pass the action prop to <form>. Use the formAction prop on <input> or <button>.',
        );
      } else if (
        tag === 'input' &&
        props.type !== 'submit' &&
        props.type !== 'image' &&
        !didWarnFormActionType
      ) {
        didWarnFormActionType = true;
        console.error(
          'An input can only specify a formAction along with type="submit" or type="image".',
        );
      } else if (
        tag === 'button' &&
        props.type != null &&
        props.type !== 'submit' &&
        !didWarnFormActionType
      ) {
        didWarnFormActionType = true;
        console.error(
          'A button can only specify a formAction along with type="submit" or no type.',
        );
      } else if (typeof value === 'function') {
        //函数表单操作无法控制表单属性
        if (props.name != null && !didWarnFormActionName) {
          didWarnFormActionName = true;
          console.error(
            'Cannot specify a "name" prop for a button that specifies a function as a formAction. ' +
              'React needs it to encode which action should be invoked. It will get overridden.',
          );
        }
        if (
          (props.formEncType != null || props.formMethod != null) &&
          !didWarnFormActionMethod
        ) {
          didWarnFormActionMethod = true;
          console.error(
            'Cannot specify a formEncType or formMethod for a button that specifies a ' +
              'function as a formAction. React provides those automatically. They will get overridden.',
          );
        }
        if (props.formTarget != null && !didWarnFormActionTarget) {
          didWarnFormActionTarget = true;
          console.error(
            'Cannot specify a formTarget for a button that specifies a function as a formAction. ' +
              'The function will always be executed in the same window.',
          );
        }
      }
    } else {
      if (key === 'action') {
        console.error('You can only pass the action prop to <form>.');
      } else {
        console.error(
          'You can only pass the formAction prop to <input> or <button>.',
        );
      }
    }
  }
}

/** 规范化后仍不同的服务端值写入 hydration 差异表；相同值不记录。 */
function warnForPropDifference(
  propName: string,
  serverValue: mixed,
  clientValue: mixed,
  serverDifferences: {
    /** prop 名到服务端值的差异表；仅用于生成 hydration 诊断。 */
    [propName: string]: mixed
  },
): void {
  if (__DEV__) {
    if (serverValue === clientValue) {
      return;
    }
    const normalizedClientValue =
      normalizeMarkupForTextOrAttribute(clientValue);
    const normalizedServerValue =
      normalizeMarkupForTextOrAttribute(serverValue);
    if (normalizedServerValue === normalizedClientValue) {
      return;
    }

    serverDifferences[propName] = serverValue;
  }
}

/** 检查 Fizz 生成的 vt-share/exit/enter/update 等标记，判断元素是否参与服务端 View Transition。 */
function hasViewTransition(htmlElement: HTMLElement): boolean {
  return !!(
    htmlElement.getAttribute('vt-share') ||
    htmlElement.getAttribute('vt-exit') ||
    htmlElement.getAttribute('vt-enter') ||
    htmlElement.getAttribute('vt-update') ||
    (enableViewTransitionParentEnterExit &&
      (htmlElement.getAttribute('vt-parent-enter') ||
        htmlElement.getAttribute('vt-parent-exit')))
  );
}

/** 识别当前过渡或 Fizz 生成的自动名称，供 hydration 忽略运行时添加的样式。 */
function isExpectedViewTransitionName(htmlElement: HTMLElement): boolean {
  if (!hasViewTransition(htmlElement)) {
    //我们没想到会看到应用了视图转换名称。
    return false;
  }
  const expectedVtName = htmlElement.getAttribute('vt-name');
  const actualVtName: string = (htmlElement.style as any)[
    'view-transition-name'
  ];
  if (expectedVtName) {
    return expectedVtName === actualVtName;
  } else {
    //自动生成的名称。
    //待办事项：如果Fizz开始在这个名字前加前缀，我们需要考虑这一点。
    return actualVtName.startsWith('_T_');
  }
}

/** 把未被客户端 props 消费的服务端属性记入差异表；忽略预期的 View Transition 样式。 */
function warnForExtraAttributes(
  domElement: Element,
  attributeNames: Set<string>,
  serverDifferences: {
    /** prop 名到额外服务端属性值的差异表；仅用于 hydration 警告。 */
    [propName: string]: mixed
  },
) {
  if (__DEV__) {
    attributeNames.forEach(function (attributeName) {
      if (attributeName === 'style') {
        if (domElement.getAttribute(attributeName) === '') {
          //跳过空样式。没关系。
          return;
        }
        const htmlElement = domElement as any as HTMLElement;
        const style = htmlElement.style;
        const isOnlyVTStyles =
          (style.length === 1 && style[0] === 'view-transition-name') ||
          (style.length === 2 &&
            style[0] === 'view-transition-class' &&
            style[1] === 'view-transition-name');
        if (isOnlyVTStyles && isExpectedViewTransitionName(htmlElement)) {
          //如果唯一额外的样式是我们从 Fizz 应用的 view-transition-name
          //运行时，那么我们应该忽略它。
        } else {
          serverDifferences.style = getStylesObjectFromElement(domElement);
        }
      } else {
        serverDifferences[getPropNameFromAttributeName(attributeName)] =
          domElement.getAttribute(attributeName);
      }
    });
  }
}

/** 开发期报告非函数 handler，区分 false 的常见条件渲染误用。 */
function warnForInvalidEventListener(registrationName: string, listener: any) {
  if (__DEV__) {
    if (listener === false) {
      console.error(
        'Expected `%s` listener to be a function, instead got `false`.\n\n' +
          'If you used to conditionally omit it with %s={condition && value}, ' +
          'pass %s={condition ? value : undefined} instead.',
        registrationName,
        registrationName,
        registrationName,
      );
    } else {
      console.error(
        'Expected `%s` listener to be a function, instead got a value of `%s` type.',
        registrationName,
        typeof listener,
      );
    }
  }
}

//解析 HTML 并将其读回，以规范 HTML 字符串，使其
//可以用于比较。
/** 用同一 document 的临时同类元素解析 HTML，返回浏览器规范化后的 innerHTML 供 hydration 比较。 */
function normalizeHTML(parent: Element, html: string) {
  if (__DEV__) {
    //我们本可以在这里创建一个单独的文档以避免
    //如果自定义元素存在，则重新初始化它们。但这会中断
    //如何处理 <noscript>。因此我们使用同一份文档。
    //请参见 https://github.com/facebook/react/pull/11157. 中的讨论
    const testElement =
      parent.namespaceURI === MATH_NAMESPACE ||
      parent.namespaceURI === SVG_NAMESPACE
        ? parent.ownerDocument.createElementNS(
            parent.namespaceURI as any,
            parent.tagName,
          )
        : parent.ownerDocument.createElement(parent.tagName);
    testElement.innerHTML = html;
    return testElement.innerHTML;
  }
}

/** 匹配CR或CRLF并在水合比较时统一为LF，消除HTML解析造成的换行差异；NUL/替换字符由紧随的另一正则处理。 */
const NORMALIZE_NEWLINES_REGEX = /\r\n?/g;
/** 移除 NUL 与替换字符，使 hydration 比较与 HTML 解析后的文本一致。 */
const NORMALIZE_NULL_AND_REPLACEMENT_REGEX = /\u0000|\uFFFD/g;

/** 把值转为字符串并统一换行、NUL 与替换字符，用于比较解析前后的标记。 */
function normalizeMarkupForTextOrAttribute(markup: mixed): string {
  if (__DEV__) {
    checkHtmlStringCoercion(markup);
  }
  const markupString =
    typeof markup === 'string' ? markup : '' + (markup as any);
  return markupString
    .replace(NORMALIZE_NEWLINES_REGEX, '\n')
    .replace(NORMALIZE_NULL_AND_REPLACEMENT_REGEX, '');
}

/** 文本按 HTML 解析规则规范化后是否相同；返回值用于决定 hydration 是否失败。 */
function checkForUnmatchedText(
  serverText: string,
  clientText: string | number | bigint,
) {
  const normalizedClientText = normalizeMarkupForTextOrAttribute(clientText);
  const normalizedServerText = normalizeMarkupForTextOrAttribute(serverText);
  if (normalizedServerText === normalizedClientText) {
    return true;
  }
  return false;
}

/** 安装空 onclick，使移动 Safari 的非交互元素 click 能到达委托 listener。 */
export function trapClickOnNonInteractiveElement(node: HTMLElement) {
  //Mobile Safari 无法正确触发冒泡点击事件
  //非交互元素，这意味着委托的点击监听器不会
  //火。解决此错误的变通方法涉及附加一个空的点击
  //目标节点上的监听器。
  //https://www.quirksmode.org/blog/archives/2010/09/click_event_del.html
  //只需使用 onclick 属性设置它，这样我们就不必管理任何东西
  //为它进行簿记。HostSingleton 释放仅在它时清除该属性
  //仍然指向这个空操作。
  //待办：也许只对相关的 Safari 做这个？
  node.onclick = noop;
}

/** 仅在 onclick 仍为 React 的空回调时清除，保留用户替换的回调。 */
export function clearClickListener(node: HTMLElement) {
  if (node.onclick === noop) {
    node.onclick = null;
  }
}

/** 写入 xlink:* SVG 属性使用的 XML 命名空间 URI。 */
const xlinkNamespace = 'http://www.w3.org/1999/xlink';
/** 写入 xml:* 属性使用的 XML 命名空间 URI。 */
const xmlNamespace = 'http://www.w3.org/XML/1998/namespace';

/**
 * 初次设置与后续 diff 共用的单 prop 写入器，按标准标签语义选择文本、样式、property 或 attribute 路径。
 * URL 属性先过滤不支持的值并清洗 javascript:；函数 action 安装拦截提交的错误 URL，切回字符串时恢复 Fizz 接管的表单属性。
 * 已知事件 handler 通过 props 缓存供委托派发读取；这里仅安装 scroll 等目标监听与 Safari click 兼容回调。
 *
 * @param prevValue - 前次提交值，供 style diff、innerHTML 比较和函数 action 转换判断使用。
 */
function setProp(
  domElement: Element,
  tag: string,
  key: string,
  value: mixed,
  props: any,
  prevValue: mixed,
): void {
  switch (key) {
    case 'children': {
      if (typeof value === 'string') {
        if (__DEV__) {
          validateTextNesting(value, tag, false);
        }
        //当文本为空时，请避免设置初始 textContent。在 IE11 中设置
        //在 <textarea> 上的 textContent 会导致占位符不显示
        //在 <textarea> 内显示，直到它再次获得和失去焦点。
        //https://github.com/facebook/react/issues/6731#issuecomment-254874553
        const canSetTextContent =
          tag !== 'body' && (tag !== 'textarea' || value !== '');
        if (canSetTextContent) {
          setTextContent(domElement, value);
        }
      } else if (typeof value === 'number' || typeof value === 'bigint') {
        if (__DEV__) {
          // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
          validateTextNesting('' + value, tag, false);
        }
        const canSetTextContent = tag !== 'body';
        if (canSetTextContent) {
          // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
          setTextContent(domElement, '' + value);
        }
      } else {
        return;
      }
      break;
    }
    // 常见 props 放在 switch 前部处理。
    //TODO: aria-label 是一个非常常见的属性，但它允许布尔值，所以不像其他属性一样
    //但理想情况下也应该列在这个列表中。
    case 'className':
      setValueForKnownAttribute(domElement, 'class', value);
      break;
    case 'tabIndex':
      //在 SVG 中，这必须区分大小写。
      setValueForKnownAttribute(domElement, 'tabindex', value);
      break;
    case 'dir':
    case 'role':
    case 'viewBox':
    case 'width':
    case 'height': {
      setValueForKnownAttribute(domElement, key, value);
      break;
    }
    case 'style': {
      setValueForStyles(domElement, value, prevValue);
      return;
    }
    //这些属性接受 URL。这些 URL 不应允许 javascript:。
    case 'data':
      if (tag !== 'object') {
        setValueForKnownAttribute(domElement, 'data', value);
        break;
      }
    //穿透
    case 'src': {
      if (enableSrcObject && typeof value === 'object' && value !== null) {
        //一些标签支持像 Blob、File、MediaSource 和 MediaStream 这样的对象源。
        if (tag === 'img' || tag === 'video' || tag === 'audio') {
          try {
            setSrcObject(domElement, tag, value);
            break;
          } catch (x) {
            //如果 URL.createObjectURL() 出错，可能是其他类型的对象
            //那应该改为使用 toString，所以我们就直接继续执行正常的流程
            //路径。
          }
        } else {
          if (__DEV__) {
            try {
              // 探测对象是否能生成 URL；成功说明对象类型受支持，但当前标签不支持这种 src 用法，需要警告。
              URL.revokeObjectURL(URL.createObjectURL(value as any));
              if (tag === 'source') {
                console.error(
                  'Passing Blob, MediaSource or MediaStream to <source src> is not supported. ' +
                    'Pass it directly to <img src>, <video src> or <audio src> instead.',
                );
              } else {
                console.error(
                  'Passing Blob, MediaSource or MediaStream to <%s src> is not supported.',
                  tag,
                );
              }
            } catch (x) {}
          }
        }
      }
      //穿透
    }
    case 'href': {
      if (
        value === '' &&
        //<a href=""> 对于“重新加载”链接来说是可以的。
        !(tag === 'a' && key === 'href')
      ) {
        if (__DEV__) {
          if (key === 'src') {
            console.error(
              'An empty string ("") was passed to the %s attribute. ' +
                'This may cause the browser to download the whole page again over the network. ' +
                'To fix this, either do not render the element at all ' +
                'or pass null to %s instead of an empty string.',
              key,
              key,
            );
          } else {
            console.error(
              'An empty string ("") was passed to the %s attribute. ' +
                'To fix this, either do not render the element at all ' +
                'or pass null to %s instead of an empty string.',
              key,
              key,
            );
          }
        }
        domElement.removeAttribute(key);
        break;
      }
      if (
        value == null ||
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        typeof value === 'boolean'
      ) {
        domElement.removeAttribute(key);
        break;
      }
      // 在 IE8/9 中，对对象调用 `setAttribute` 只会得到 `[object]`，
      //('' + value) 使它输出正确的 toString() 值。
      if (__DEV__) {
        checkAttributeStringCoercion(value, key);
      }
      const sanitizedValue = sanitizeURL(
        enableTrustedTypesIntegration ? value : '' + (value as any),
      ) as any;
      domElement.setAttribute(key, sanitizedValue);
      break;
    }
    case 'action':
    case 'formAction': {
      //待办：考虑将这些特殊情况移动到 form、input 和 button 标签中。
      if (__DEV__) {
        validateFormActionInDevelopment(tag, key, value, props);
      }
      if (typeof value === 'function') {
        // 正常 submit 由 FormActionEventPlugin preventDefault 后执行函数。
        // 绕过 submit listener 的 form.submit() 或提前 stopPropagation 会落到这个抛错 URL，
        // 提示改用 requestSubmit()/preventDefault；CSP 阻止 URL 时不会执行错误文本。
        domElement.setAttribute(
          key,
          // eslint-disable-next-line no-script-url
          "javascript:throw new Error('" +
            'A React form was unexpectedly submitted. If you called form.submit() manually, ' +
            "consider using form.requestSubmit() instead. If you\\'re trying to use " +
            'event.stopPropagation() in a submit event handler, consider also calling ' +
            'event.preventDefault().' +
            "')",
        );
        break;
      } else if (typeof prevValue === 'function') {
        //当我们关闭一个最初被水合的服务器操作时。
        //服务器在 SSR 期间控制这些现在滞后的字段。
        //常规的差异比较不适用，因为我们是与之前的属性进行比较。
        //相反，我们需要强制它们被设置为它们现在应该的值。
        //如果我们采用每标签的方法来进行整个分叉，这将会清理得多。
        if (key === 'formAction') {
          if (tag !== 'input') {
            //如果这是切换， 在这里设置名称对于输入来说并不是完全安全的
            //变成单选按钮。在这种情况下，我们允许基于标签的覆盖生效
            //控制。
            setProp(domElement, tag, 'name', props.name, props, null);
          }
          setProp(
            domElement,
            tag,
            'formEncType',
            props.formEncType,
            props,
            null,
          );
          setProp(domElement, tag, 'formMethod', props.formMethod, props, null);
          setProp(domElement, tag, 'formTarget', props.formTarget, props, null);
        } else {
          setProp(domElement, tag, 'encType', props.encType, props, null);
          setProp(domElement, tag, 'method', props.method, props, null);
          setProp(domElement, tag, 'target', props.target, props, null);
        }
      }
      if (
        value == null ||
        typeof value === 'symbol' ||
        typeof value === 'boolean'
      ) {
        domElement.removeAttribute(key);
        break;
      }
      // 在 IE8/9 中，对对象调用 `setAttribute` 只会得到 `[object]`，
      //('' + value) 使其输出正确的 toString() 值。
      if (__DEV__) {
        checkAttributeStringCoercion(value, key);
      }
      const sanitizedValue = sanitizeURL(
        enableTrustedTypesIntegration ? value : '' + (value as any),
      ) as any;
      domElement.setAttribute(key, sanitizedValue);
      break;
    }
    case 'onClick': {
      //待办：此类型转换可能不适用于 SVG、MathML 或自定义元素。
      if (value != null) {
        if (__DEV__ && typeof value !== 'function') {
          warnForInvalidEventListener(key, value);
        }
        trapClickOnNonInteractiveElement(domElement as any as HTMLElement);
      }
      return;
    }
    case 'onScroll': {
      if (value != null) {
        if (__DEV__ && typeof value !== 'function') {
          warnForInvalidEventListener(key, value);
        }
        listenToNonDelegatedEvent('scroll', domElement);
      }
      return;
    }
    case 'onScrollEnd': {
      if (value != null) {
        if (__DEV__ && typeof value !== 'function') {
          warnForInvalidEventListener(key, value);
        }
        listenToNonDelegatedEvent('scrollend', domElement);
        if (enableScrollEndPolyfill) {
          //供补丁使用。
          listenToNonDelegatedEvent('scroll', domElement);
        }
      }
      return;
    }
    case 'dangerouslySetInnerHTML': {
      if (value != null) {
        if (typeof value !== 'object' || !('__html' in value)) {
          throw new Error(
            '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
              'Please visit https://react.dev/link/dangerously-set-inner-html ' +
              'for more information.',
          );
        }
        const nextHtml: any = value.__html;
        if (nextHtml != null) {
          if (props.children != null) {
            throw new Error(
              'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
            );
          }
          const lastHtml: any =
            prevValue != null ? (prevValue as any).__html : undefined;
          if (lastHtml !== nextHtml) {
            domElement.innerHTML = nextHtml;
          }
        }
      }
      break;
    }
    // multiple 直接写 property；option.selected 的同步由 select 专用初始化/更新路径完成。
    case 'multiple': {
      (domElement as any).multiple =
        value && typeof value !== 'function' && typeof value !== 'symbol';
      break;
    }
    case 'muted': {
      (domElement as any).muted =
        value && typeof value !== 'function' && typeof value !== 'symbol';
      break;
    }
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'defaultValue': //保留
    case 'defaultChecked':
    case 'innerHTML':
    case 'ref': {
      //待办事项：`ref` 很常见，我们应该把它往上移吗？
      //无操作
      break;
    }
    case 'autoFocus': {
      //我们在提交时会在客户端单独进行填充。
      //我们本可以在财产列表中将其排除，而不是
      //在这里添加一个特殊情况，但随后它就不会被发出
      //在服务器渲染时（但我们*确实*想在 SSR 中输出它）。
      break;
    }
    case 'xlinkHref': {
      if (
        value == null ||
        typeof value === 'function' ||
        typeof value === 'boolean' ||
        typeof value === 'symbol'
      ) {
        domElement.removeAttribute('xlink:href');
        break;
      }
      // 在 IE8/9 中，对对象调用 `setAttribute` 只会得到 `[object]`，
      //('' + value) 使它输出正确的 toString() 值。
      if (__DEV__) {
        checkAttributeStringCoercion(value, key);
      }
      const sanitizedValue = sanitizeURL(
        enableTrustedTypesIntegration ? value : '' + (value as any),
      ) as any;
      domElement.setAttributeNS(xlinkNamespace, 'xlink:href', sanitizedValue);
      break;
    }
    case 'contentEditable':
    case 'spellCheck':
    case 'draggable':
    case 'value':
    case 'autoReverse':
    case 'externalResourcesRequired':
    case 'focusable':
    case 'preserveAlpha': {
      //布尔字符串
      //这些是接受“true”和“false”的“枚举”属性。
      //在 React 中，我们允许用户传递 `true` 和 `false`，即使从技术上讲
      //这些不是布尔属性（它们会被强制转换为字符串）。
      //SVG 属性是区分大小写的。由于 HTML 属性是
      //不敏感，即使我们按照规范使用小写字母，它们也能工作。
      if (
        value != null &&
        typeof value !== 'function' &&
        typeof value !== 'symbol'
      ) {
        if (__DEV__) {
          checkAttributeStringCoercion(value, key);
        }
        domElement.setAttribute(
          key,
          enableTrustedTypesIntegration ? (value as any) : '' + (value as any),
        );
      } else {
        domElement.removeAttribute(key);
      }
      break;
    }
    //布尔
    case 'inert': {
      if (__DEV__) {
        if (value === '' && !didWarnForNewBooleanPropsWithEmptyValue[key]) {
          didWarnForNewBooleanPropsWithEmptyValue[key] = true;
          console.error(
            'Received an empty string for a boolean attribute `%s`. ' +
              'This will treat the attribute as if it were false. ' +
              'Either pass `false` to silence this warning, or ' +
              'pass `true` if you used an empty string in earlier versions of React to indicate this attribute is true.',
            key,
          );
        }
      }
    }
    //对于没有空字符串警告的布尔属性的回退处理。
    case 'allowFullScreen':
    case 'async':
    case 'autoPlay':
    case 'controls':
    case 'credentialless':
    case 'default':
    case 'defer':
    case 'disabled':
    case 'disablePictureInPicture':
    case 'disableRemotePlayback':
    case 'formNoValidate':
    case 'hidden':
    case 'loop':
    case 'noModule':
    case 'noValidate':
    case 'open':
    case 'playsInline':
    case 'readOnly':
    case 'required':
    case 'reversed':
    case 'scoped':
    case 'seamless':
    case 'itemScope': {
      if (value && typeof value !== 'function' && typeof value !== 'symbol') {
        domElement.setAttribute(key, '');
      } else {
        domElement.removeAttribute(key);
      }
      break;
    }
    //重载布尔值
    case 'capture':
    case 'download': {
      //一个既可以用作标志也可以带有值的属性。
      //当为真时，它应该存在（设置为空字符串或其名称）。
      //当为假时，应省略。
      //对于任何其他值，应显示该值。
      if (value === true) {
        domElement.setAttribute(key, '');
      } else if (
        value !== false &&
        value != null &&
        typeof value !== 'function' &&
        typeof value !== 'symbol'
      ) {
        if (__DEV__) {
          checkAttributeStringCoercion(value, key);
        }
        domElement.setAttribute(key, value as any);
      } else {
        domElement.removeAttribute(key);
      }
      break;
    }
    case 'cols':
    case 'rows':
    case 'size':
    case 'span': {
      //这些是必须为正数的 HTML 属性。
      if (
        value != null &&
        typeof value !== 'function' &&
        typeof value !== 'symbol' &&
        !isNaN(value) &&
        (value as any) >= 1
      ) {
        if (__DEV__) {
          checkAttributeStringCoercion(value, key);
        }
        domElement.setAttribute(key, value as any);
      } else {
        domElement.removeAttribute(key);
      }
      break;
    }
    case 'rowSpan':
    case 'start': {
      //这些是必须为数字的 HTML 属性。
      if (
        value != null &&
        typeof value !== 'function' &&
        typeof value !== 'symbol' &&
        !isNaN(value)
      ) {
        if (__DEV__) {
          checkAttributeStringCoercion(value, key);
        }
        domElement.setAttribute(key, value as any);
      } else {
        domElement.removeAttribute(key);
      }
      break;
    }
    case 'popover':
      listenToNonDelegatedEvent('beforetoggle', domElement);
      listenToNonDelegatedEvent('toggle', domElement);
      setValueForAttribute(domElement, 'popover', value);
      break;
    case 'xlinkActuate':
      setValueForNamespacedAttribute(
        domElement,
        xlinkNamespace,
        'xlink:actuate',
        value,
      );
      break;
    case 'xlinkArcrole':
      setValueForNamespacedAttribute(
        domElement,
        xlinkNamespace,
        'xlink:arcrole',
        value,
      );
      break;
    case 'xlinkRole':
      setValueForNamespacedAttribute(
        domElement,
        xlinkNamespace,
        'xlink:role',
        value,
      );
      break;
    case 'xlinkShow':
      setValueForNamespacedAttribute(
        domElement,
        xlinkNamespace,
        'xlink:show',
        value,
      );
      break;
    case 'xlinkTitle':
      setValueForNamespacedAttribute(
        domElement,
        xlinkNamespace,
        'xlink:title',
        value,
      );
      break;
    case 'xlinkType':
      setValueForNamespacedAttribute(
        domElement,
        xlinkNamespace,
        'xlink:type',
        value,
      );
      break;
    case 'xmlBase':
      setValueForNamespacedAttribute(
        domElement,
        xmlNamespace,
        'xml:base',
        value,
      );
      break;
    case 'xmlLang':
      setValueForNamespacedAttribute(
        domElement,
        xmlNamespace,
        'xml:lang',
        value,
      );
      break;
    case 'xmlSpace':
      setValueForNamespacedAttribute(
        domElement,
        xmlNamespace,
        'xml:space',
        value,
      );
      break;
    //不应允许在自定义元素上使用的属性。
    case 'is': {
      if (__DEV__) {
        if (prevValue != null) {
          console.error(
            'Cannot update the "is" prop after it has been initialized.',
          );
        }
      }
      //待办：我们实际上不应该设置此属性，因为我们已经...
      //将它传递给 createElement。我们也不需要这个属性。
      //然而，我们的测试目前会查询它，所以有人这样做是有可能的
      //其他人也这样，所以它就中断了。
      setValueForAttribute(domElement, 'is', value);
      break;
    }
    case 'innerText':
    case 'textContent':
      return;
    case 'popoverTarget':
      if (__DEV__) {
        if (
          !didWarnPopoverTargetObject &&
          value != null &&
          typeof value === 'object'
        ) {
          didWarnPopoverTargetObject = true;
          console.error(
            'The `popoverTarget` prop expects the ID of an Element as a string. Received %s instead.',
            value,
          );
        }
      }
    // 未命中专用 prop 时走下面的普通 attribute/事件处理。
    default: {
      if (
        key.length > 2 &&
        (key[0] === 'o' || key[0] === 'O') &&
        (key[1] === 'n' || key[1] === 'N')
      ) {
        if (
          __DEV__ &&
          registrationNameDependencies.hasOwnProperty(key) &&
          value != null &&
          typeof value !== 'function'
        ) {
          warnForInvalidEventListener(key, value);
        }
        //更新事件不会影响视觉效果。
        return;
      } else {
        const attributeName = getAttributeAlias(key);
        setValueForAttribute(domElement, attributeName, value);
      }
    }
  }
  //为了避免将某些东西标记为宿主突变，我们在上面进行了早期返回。
  trackHostMutation();
}

/** 处理自定义元素的文本/style 等保留 props；其余交给 property、attribute 或原生 on* listener 路径。 */
function setPropOnCustomElement(
  domElement: Element,
  tag: string,
  key: string,
  value: mixed,
  props: any,
  prevValue: mixed,
): void {
  switch (key) {
    case 'style': {
      setValueForStyles(domElement, value, prevValue);
      return;
    }
    case 'dangerouslySetInnerHTML': {
      if (value != null) {
        if (typeof value !== 'object' || !('__html' in value)) {
          throw new Error(
            '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
              'Please visit https://react.dev/link/dangerously-set-inner-html ' +
              'for more information.',
          );
        }
        const nextHtml: any = value.__html;
        if (nextHtml != null) {
          if (props.children != null) {
            throw new Error(
              'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
            );
          }
          const lastHtml: any =
            prevValue != null ? (prevValue as any).__html : undefined;
          if (lastHtml !== nextHtml) {
            domElement.innerHTML = nextHtml;
          }
        }
      }
      break;
    }
    case 'children': {
      if (typeof value === 'string') {
        setTextContent(domElement, value);
      } else if (typeof value === 'number' || typeof value === 'bigint') {
        // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
        setTextContent(domElement, '' + value);
      } else {
        return;
      }
      break;
    }
    case 'onScroll': {
      if (value != null) {
        if (__DEV__ && typeof value !== 'function') {
          warnForInvalidEventListener(key, value);
        }
        listenToNonDelegatedEvent('scroll', domElement);
      }
      return;
    }
    case 'onScrollEnd': {
      if (value != null) {
        if (__DEV__ && typeof value !== 'function') {
          warnForInvalidEventListener(key, value);
        }
        listenToNonDelegatedEvent('scrollend', domElement);
        if (enableScrollEndPolyfill) {
          //供补丁使用。
          listenToNonDelegatedEvent('scroll', domElement);
        }
      }
      return;
    }
    case 'onClick': {
      //待办：此类型转换可能对 SVG、MathML 或自定义元素不安全。
      if (value != null) {
        if (__DEV__ && typeof value !== 'function') {
          warnForInvalidEventListener(key, value);
        }
        trapClickOnNonInteractiveElement(domElement as any as HTMLElement);
      }
      return;
    }
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'innerHTML':
    case 'ref': {
      //无操作
      return;
    }
    case 'innerText': //属性
    case 'textContent':
      return;
    // 其余 prop 再区分 React 已知事件与自定义 property/attribute。
    default: {
      if (registrationNameDependencies.hasOwnProperty(key)) {
        if (__DEV__ && value != null && typeof value !== 'function') {
          warnForInvalidEventListener(key, value);
        }
        return;
      } else {
        setValueForPropertyOnCustomComponent(domElement, key, value);
        //我们追踪这个调用中的变更。
        return;
      }
    }
  }
  //为了避免将某些事物标记为宿主突变，我们在上面使用提前返回。
  trackHostMutation();
}

/**
 * 由 DOM HostConfig 创建实例时设置初始 props 和非委托目标监听，尚未把普通新实例插入根容器。
 * 表单值收集后交给 input/select/textarea 专用初始化；空元素拒绝 children/innerHTML。
 * img 先设置影响请求的 crossorigin/sizes 等属性，最后写 srcSet/src，避免浏览器用中间状态发起加载。
 */
export function setInitialProperties(
  domElement: Element,
  tag: string,
  props: Object,
): void {
  if (__DEV__) {
    validatePropertiesInDevelopment(tag, props);
  }

  //待办：在触发任何这些事件之前，确保我们检查了 isMounted。

  switch (tag) {
    case 'div':
    case 'span':
    case 'svg':
    case 'path':
    case 'a':
    case 'g':
    case 'p':
    case 'li': {
      //快速跟踪最常见的标签类型
      break;
    }
    //img 标签以前被实现为具有非委托事件的空元素，但 Safari（以及可能的 Firefox）
    //一旦设置了 `src` 或 `srcSet` 属性，并且如果我们在设置其他属性之前设置这些属性，就开始获取图像
    //可以修改请求（例如 crossorigin）或资源获取（例如 sizes）的，然后浏览器将加载
    //错误的事情或加载多于一件的东西。此实现确保 src 和 srcSet 最后设置在实例上
    case 'img': {
      listenToNonDelegatedEvent('error', domElement);
      listenToNonDelegatedEvent('load', domElement);
      //主要是 Void Element 逻辑的移植，并有特殊处理以确保最后设置 srcset 和 src
      let hasSrc = false;
      let hasSrcSet = false;
      for (const propKey in props) {
        if (!props.hasOwnProperty(propKey)) {
          continue;
        }
        const propValue = props[propKey];
        if (propValue == null) {
          continue;
        }
        switch (propKey) {
          case 'src':
            hasSrc = true;
            break;
          case 'srcSet':
            hasSrcSet = true;
            break;
          case 'children':
          case 'dangerouslySetInnerHTML': {
            //待办：我们能否将其设为开发警告以避免这个拒绝列表？
            throw new Error(
              `${tag} is a void element tag and must neither have \`children\` nor ` +
                'use `dangerouslySetInnerHTML`.',
            );
          }
          //setProp 会忽略 defaultChecked 和 defaultValue
          default: {
            setProp(domElement, tag, propKey, propValue, props, null);
          }
        }
      }
      if (hasSrcSet) {
        setProp(domElement, tag, 'srcSet', props.srcSet, props, null);
      }
      if (hasSrc) {
        setProp(domElement, tag, 'src', props.src, props, null);
      }
      return;
    }
    case 'input': {
      if (__DEV__) {
        checkControlledValueProps('input', props);
      }
      //我们收听此事件以确保模拟气泡
      //监听器仍然会为无效事件触发。
      listenToNonDelegatedEvent('invalid', domElement);

      let name = null;
      let type = null;
      let value = null;
      let defaultValue = null;
      let checked = null;
      let defaultChecked = null;
      for (const propKey in props) {
        if (!props.hasOwnProperty(propKey)) {
          continue;
        }
        const propValue = props[propKey];
        if (propValue == null) {
          continue;
        }
        switch (propKey) {
          case 'name': {
            name = propValue;
            break;
          }
          case 'type': {
            type = propValue;
            break;
          }
          case 'checked': {
            checked = propValue;
            break;
          }
          case 'defaultChecked': {
            defaultChecked = propValue;
            break;
          }
          case 'value': {
            value = propValue;
            break;
          }
          case 'defaultValue': {
            defaultValue = propValue;
            break;
          }
          case 'children':
          case 'dangerouslySetInnerHTML': {
            if (propValue != null) {
              throw new Error(
                `${tag} is a void element tag and must neither have \`children\` nor ` +
                  'use `dangerouslySetInnerHTML`.',
              );
            }
            break;
          }
          default: {
            setProp(domElement, tag, propKey, propValue, props, null);
          }
        }
      }
      //待办：确保我们检查这个是否仍未挂载，或者进行任何清理
      //必须继续，因为我们再也不会停止跟踪了。
      validateInputProps(domElement, props);
      initInput(
        domElement,
        value,
        defaultValue,
        checked,
        defaultChecked,
        type,
        name,
        false,
      );
      return;
    }
    case 'select': {
      if (__DEV__) {
        checkControlledValueProps('select', props);
      }
      //我们收听此事件以确保模拟气泡
      //监听器仍然会为无效事件触发。
      listenToNonDelegatedEvent('invalid', domElement);
      let value = null;
      let defaultValue = null;
      let multiple = null;
      for (const propKey in props) {
        if (!props.hasOwnProperty(propKey)) {
          continue;
        }
        const propValue = props[propKey];
        if (propValue == null) {
          continue;
        }
        switch (propKey) {
          case 'value': {
            value = propValue;
            //这是由下面的 initSelect 处理的。
            break;
          }
          case 'defaultValue': {
            defaultValue = propValue;
            //这是由下面的 initSelect 处理的。
            break;
          }
          case 'multiple': {
            multiple = propValue;
            //待办：我们实际上不必在这里继续执行，因为我们已经设置了它
            //无论如何都在 initSelect 中。我们可以在 setProp 中去掉特殊情况。
          }
          //穿透
          default: {
            setProp(domElement, tag, propKey, propValue, props, null);
          }
        }
      }
      validateSelectProps(domElement, props);
      initSelect(domElement, value, defaultValue, multiple);
      return;
    }
    case 'textarea': {
      if (__DEV__) {
        checkControlledValueProps('textarea', props);
      }
      //我们收听此事件以确保模拟气泡
      //监听器仍然会为无效事件触发。
      listenToNonDelegatedEvent('invalid', domElement);
      let value = null;
      let defaultValue = null;
      let children = null;
      for (const propKey in props) {
        if (!props.hasOwnProperty(propKey)) {
          continue;
        }
        const propValue = props[propKey];
        if (propValue == null) {
          continue;
        }
        switch (propKey) {
          case 'value': {
            value = propValue;
            //这是由下面的 initTextarea 处理的。
            break;
          }
          case 'defaultValue': {
            defaultValue = propValue;
            break;
          }
          case 'children': {
            children = propValue;
            // 由下面的 initTextarea 处理，不创建独立文本子 Fiber。
            break;
          }
          case 'dangerouslySetInnerHTML': {
            if (propValue != null) {
              //待办：我们真的需要为此设置一个特殊的错误消息吗？它也相当直白。
              throw new Error(
                '`dangerouslySetInnerHTML` does not make sense on <textarea>.',
              );
            }
            break;
          }
          default: {
            setProp(domElement, tag, propKey, propValue, props, null);
          }
        }
      }
      //待办：确保我们检查这个是否仍未挂载，或者进行任何清理
      //必须继续，因为我们再也不会停止跟踪了。
      validateTextareaProps(domElement, props);
      initTextarea(domElement, value, defaultValue, children);
      return;
    }
    case 'option': {
      validateOptionProps(domElement, props);
      for (const propKey in props) {
        if (!props.hasOwnProperty(propKey)) {
          continue;
        }
        const propValue = props[propKey];
        if (propValue == null) {
          continue;
        }
        switch (propKey) {
          case 'selected': {
            //待办事项：移除对选中选项的支持。
            (domElement as any).selected =
              propValue &&
              typeof propValue !== 'function' &&
              typeof propValue !== 'symbol';
            break;
          }
          default: {
            setProp(domElement, tag, propKey, propValue, props, null);
          }
        }
      }
      return;
    }
    case 'dialog': {
      listenToNonDelegatedEvent('beforetoggle', domElement);
      listenToNonDelegatedEvent('toggle', domElement);
      listenToNonDelegatedEvent('cancel', domElement);
      listenToNonDelegatedEvent('close', domElement);
      break;
    }
    case 'iframe':
    case 'object': {
      //我们收听此事件以确保模拟气泡
      //监听器仍然会触发 load 事件。
      listenToNonDelegatedEvent('load', domElement);
      break;
    }
    case 'video':
    case 'audio': {
      //我们监听这些事件，以确保模拟气泡
      //监听器仍会响应所有媒体事件。
      for (let i = 0; i < mediaEventTypes.length; i++) {
        listenToNonDelegatedEvent(mediaEventTypes[i], domElement);
      }
      break;
    }
    case 'image': {
      //我们监听这些事件，以确保模拟气泡
      //监听器仍会触发错误和加载事件。
      listenToNonDelegatedEvent('error', domElement);
      listenToNonDelegatedEvent('load', domElement);
      break;
    }
    case 'details': {
      //我们收听此事件以确保模拟气泡
      //监听器仍然会触发切换事件。
      listenToNonDelegatedEvent('toggle', domElement);
      break;
    }
    case 'embed':
    case 'source':
    case 'link': {
      // 这些空元素需要目标上的非委托 load/error 监听，React 再模拟合成事件传播。
      listenToNonDelegatedEvent('error', domElement);
      listenToNonDelegatedEvent('load', domElement);
      //我们落入空元素的返回
    }
    case 'area':
    case 'base':
    case 'br':
    case 'col':
    case 'hr':
    case 'keygen':
    case 'meta':
    case 'param':
    case 'track':
    case 'wbr':
    case 'menuitem': {
      //空元素
      for (const propKey in props) {
        if (!props.hasOwnProperty(propKey)) {
          continue;
        }
        const propValue = props[propKey];
        if (propValue == null) {
          continue;
        }
        switch (propKey) {
          case 'children':
          case 'dangerouslySetInnerHTML': {
            //待办：我们能否将其设为开发警告以避免这个拒绝列表？
            throw new Error(
              `${tag} is a void element tag and must neither have \`children\` nor ` +
                'use `dangerouslySetInnerHTML`.',
            );
          }
          //setProp 会忽略 defaultChecked 和 defaultValue
          default: {
            setProp(domElement, tag, propKey, propValue, props, null);
          }
        }
      }
      return;
    }
    default: {
      if (isCustomElement(tag, props)) {
        for (const propKey in props) {
          if (!props.hasOwnProperty(propKey)) {
            continue;
          }
          const propValue = props[propKey];
          if (propValue === undefined) {
            continue;
          }
          setPropOnCustomElement(
            domElement,
            tag,
            propKey,
            propValue,
            props,
            undefined,
          );
        }
        return;
      }
    }
  }

  for (const propKey in props) {
    if (!props.hasOwnProperty(propKey)) {
      continue;
    }
    const propValue = props[propKey];
    if (propValue == null) {
      continue;
    }
    setProp(domElement, tag, propKey, propValue, props, null);
  }
}

/** React 可复用的 document 单例标签：html、head、body。 */
export type SingletonType = 'html' | 'head' | 'body';

/** 清除 singleton 属性时传给 setProp 的空 props。 */
const emptyProps = {};

/** 把 singleton 原 props 逐项设为 null；跳过表单、媒体等普通标签专用更新分支。 */
export function clearSingletonProperties(
  domElement: Element,
  tag: SingletonType,
  props: Object,
): void {
  // html/head/body 都走通用 prop 路径，可逐项清除而不触发表单控件逻辑。
  for (const propKey in props) {
    const propValue = props[propKey];
    if (props.hasOwnProperty(propKey) && propValue != null) {
      setProp(domElement, tag, propKey, null, emptyProps, propValue);
    }
  }
}

/**
 * mutation 提交按前后 props 清除已删除键并写变化值；自定义元素用 undefined 清除，标准属性用 null。
 * input 的值、类型与 name 收集后最后调用 updateInput；select 在 option 子树 mutation 完成后重应用选择。
 * 事件函数本身由 HostConfig 随后更新 DOM props 缓存，本函数不把委托 handler 逐个安装到元素。
 */
export function updateProperties(
  domElement: Element,
  tag: string,
  lastProps: Object,
  nextProps: Object,
): void {
  if (__DEV__) {
    validatePropertiesInDevelopment(tag, nextProps);
  }

  switch (tag) {
    case 'div':
    case 'span':
    case 'svg':
    case 'path':
    case 'a':
    case 'g':
    case 'p':
    case 'li': {
      //快速跟踪最常见的标签类型
      break;
    }
    case 'input': {
      let name = null;
      let type = null;
      let value = null;
      let defaultValue = null;
      let lastDefaultValue = null;
      let checked = null;
      let defaultChecked = null;
      for (const propKey in lastProps) {
        const lastProp = lastProps[propKey];
        if (lastProps.hasOwnProperty(propKey) && lastProp != null) {
          switch (propKey) {
            case 'checked': {
              break;
            }
            case 'value': {
              // 由下面的 updateInput 处理，不能走普通 value attribute 写入。
              break;
            }
            case 'defaultValue': {
              lastDefaultValue = lastProp;
            }
            //setProp 会忽略 defaultChecked 和 defaultValue
            //穿透
            default: {
              if (!nextProps.hasOwnProperty(propKey))
                setProp(domElement, tag, propKey, null, nextProps, lastProp);
            }
          }
        }
      }
      for (const propKey in nextProps) {
        const nextProp = nextProps[propKey];
        const lastProp = lastProps[propKey];
        if (
          nextProps.hasOwnProperty(propKey) &&
          (nextProp != null || lastProp != null)
        ) {
          switch (propKey) {
            case 'type': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              type = nextProp;
              break;
            }
            case 'name': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              name = nextProp;
              break;
            }
            case 'checked': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              checked = nextProp;
              break;
            }
            case 'defaultChecked': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              defaultChecked = nextProp;
              break;
            }
            case 'value': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              value = nextProp;
              break;
            }
            case 'defaultValue': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              defaultValue = nextProp;
              break;
            }
            case 'children':
            case 'dangerouslySetInnerHTML': {
              if (nextProp != null) {
                throw new Error(
                  `${tag} is a void element tag and must neither have \`children\` nor ` +
                    'use `dangerouslySetInnerHTML`.',
                );
              }
              break;
            }
            default: {
              if (nextProp !== lastProp)
                setProp(
                  domElement,
                  tag,
                  propKey,
                  nextProp,
                  nextProps,
                  lastProp,
                );
            }
          }
        }
      }

      if (__DEV__) {
        const wasControlled =
          lastProps.type === 'checkbox' || lastProps.type === 'radio'
            ? lastProps.checked != null
            : lastProps.value != null;
        const isControlled =
          nextProps.type === 'checkbox' || nextProps.type === 'radio'
            ? nextProps.checked != null
            : nextProps.value != null;

        if (
          !wasControlled &&
          isControlled &&
          !didWarnUncontrolledToControlled
        ) {
          console.error(
            'A component is changing an uncontrolled input to be controlled. ' +
              'This is likely caused by the value changing from undefined to ' +
              'a defined value, which should not happen. ' +
              'Decide between using a controlled or uncontrolled input ' +
              'element for the lifetime of the component. More info: https://react.dev/link/controlled-components',
          );
          didWarnUncontrolledToControlled = true;
        }
        if (
          wasControlled &&
          !isControlled &&
          !didWarnControlledToUncontrolled
        ) {
          console.error(
            'A component is changing a controlled input to be uncontrolled. ' +
              'This is likely caused by the value changing from a defined to ' +
              'undefined, which should not happen. ' +
              'Decide between using a controlled or uncontrolled input ' +
              'element for the lifetime of the component. More info: https://react.dev/link/controlled-components',
          );
          didWarnControlledToUncontrolled = true;
        }
      }

      //在更新属性 *之后* 更新输入的包装器。这是必须的
      //在更新其余属性后发生。否则 HTML5 输入验证
      //发出警告并阻止新值被分配。
      updateInput(
        domElement,
        value,
        defaultValue,
        lastDefaultValue,
        checked,
        defaultChecked,
        type,
        name,
      );
      return;
    }
    case 'select': {
      let value = null;
      let defaultValue = null;
      let multiple = null;
      let wasMultiple = null;
      for (const propKey in lastProps) {
        const lastProp = lastProps[propKey];
        if (lastProps.hasOwnProperty(propKey) && lastProp != null) {
          switch (propKey) {
            case 'value': {
              // 由下面的 updateSelect 按 option 子树最终状态处理。
              break;
            }
            //defaultValue 会被 setProp 忽略
            case 'multiple': {
              wasMultiple = lastProp;
              //待办：将 setProp 中的特殊情况移到这里。
            }
            //穿透
            default: {
              if (!nextProps.hasOwnProperty(propKey)) {
                setProp(domElement, tag, propKey, null, nextProps, lastProp);
              }
            }
          }
        }
      }
      for (const propKey in nextProps) {
        const nextProp = nextProps[propKey];
        const lastProp = lastProps[propKey];
        if (
          nextProps.hasOwnProperty(propKey) &&
          (nextProp != null || lastProp != null)
        ) {
          switch (propKey) {
            case 'value': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              value = nextProp;
              //这是由下面的 updateSelect 处理的。
              break;
            }
            case 'defaultValue': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              defaultValue = nextProp;
              break;
            }
            case 'multiple': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              multiple = nextProp;
              //待办：只是将 setProp 中的特殊情况移到这里。
            }
            //穿透
            default: {
              if (nextProp !== lastProp)
                setProp(
                  domElement,
                  tag,
                  propKey,
                  nextProp,
                  nextProps,
                  lastProp,
                );
            }
          }
        }
      }
      // option 子树先提交，再按新的 value 选择选项。
      updateSelect(domElement, value, defaultValue, multiple, wasMultiple);
      return;
    }
    case 'textarea': {
      let value = null;
      let defaultValue = null;
      for (const propKey in lastProps) {
        const lastProp = lastProps[propKey];
        if (
          lastProps.hasOwnProperty(propKey) &&
          lastProp != null &&
          !nextProps.hasOwnProperty(propKey)
        ) {
          switch (propKey) {
            case 'value': {
              //这是由下面的 updateTextarea 处理的。
              break;
            }
            case 'children': {
              //待办：如果它更新的话，这实际上不会做任何事情。
              break;
            }
            //defaultValue 会被 setProp 忽略
            default: {
              setProp(domElement, tag, propKey, null, nextProps, lastProp);
            }
          }
        }
      }
      for (const propKey in nextProps) {
        const nextProp = nextProps[propKey];
        const lastProp = lastProps[propKey];
        if (
          nextProps.hasOwnProperty(propKey) &&
          (nextProp != null || lastProp != null)
        ) {
          switch (propKey) {
            case 'value': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              value = nextProp;
              //这是由下面的 updateTextarea 处理的。
              break;
            }
            case 'defaultValue': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              defaultValue = nextProp;
              break;
            }
            case 'children': {
              //待办：如果它更新的话，这实际上不会做任何事情。
              break;
            }
            case 'dangerouslySetInnerHTML': {
              if (nextProp != null) {
                //待办：我们真的需要为此设置一个特殊的错误信息吗？它也相当直白。
                throw new Error(
                  '`dangerouslySetInnerHTML` does not make sense on <textarea>.',
                );
              }
              break;
            }
            default: {
              if (nextProp !== lastProp)
                setProp(
                  domElement,
                  tag,
                  propKey,
                  nextProp,
                  nextProps,
                  lastProp,
                );
            }
          }
        }
      }
      updateTextarea(domElement, value, defaultValue);
      return;
    }
    case 'option': {
      for (const propKey in lastProps) {
        const lastProp = lastProps[propKey];
        if (
          lastProps.hasOwnProperty(propKey) &&
          lastProp != null &&
          !nextProps.hasOwnProperty(propKey)
        ) {
          switch (propKey) {
            case 'selected': {
              //待办事项：移除对选中选项的支持。
              (domElement as any).selected = false;
              break;
            }
            default: {
              setProp(domElement, tag, propKey, null, nextProps, lastProp);
            }
          }
        }
      }
      for (const propKey in nextProps) {
        const nextProp = nextProps[propKey];
        const lastProp = lastProps[propKey];
        if (
          nextProps.hasOwnProperty(propKey) &&
          nextProp !== lastProp &&
          (nextProp != null || lastProp != null)
        ) {
          switch (propKey) {
            case 'selected': {
              if (nextProp !== lastProp) {
                trackHostMutation();
              }
              //待办事项：移除对选中选项的支持。
              (domElement as any).selected =
                nextProp &&
                typeof nextProp !== 'function' &&
                typeof nextProp !== 'symbol';
              break;
            }
            default: {
              setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
            }
          }
        }
      }
      return;
    }
    case 'img':
    case 'link':
    case 'area':
    case 'base':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'keygen':
    case 'meta':
    case 'param':
    case 'source':
    case 'track':
    case 'wbr':
    case 'menuitem': {
      //空元素
      for (const propKey in lastProps) {
        const lastProp = lastProps[propKey];
        if (
          lastProps.hasOwnProperty(propKey) &&
          lastProp != null &&
          !nextProps.hasOwnProperty(propKey)
        ) {
          setProp(domElement, tag, propKey, null, nextProps, lastProp);
        }
      }
      for (const propKey in nextProps) {
        const nextProp = nextProps[propKey];
        const lastProp = lastProps[propKey];
        if (
          nextProps.hasOwnProperty(propKey) &&
          nextProp !== lastProp &&
          (nextProp != null || lastProp != null)
        ) {
          switch (propKey) {
            case 'children':
            case 'dangerouslySetInnerHTML': {
              if (nextProp != null) {
                //待办：我们能否将其设为开发警告以避免这个拒绝列表？
                throw new Error(
                  `${tag} is a void element tag and must neither have \`children\` nor ` +
                    'use `dangerouslySetInnerHTML`.',
                );
              }
              break;
            }
            //setProp 会忽略 defaultChecked 和 defaultValue
            default: {
              setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
            }
          }
        }
      }
      return;
    }
    default: {
      if (isCustomElement(tag, nextProps)) {
        for (const propKey in lastProps) {
          const lastProp = lastProps[propKey];
          if (
            lastProps.hasOwnProperty(propKey) &&
            lastProp !== undefined &&
            !nextProps.hasOwnProperty(propKey)
          ) {
            setPropOnCustomElement(
              domElement,
              tag,
              propKey,
              undefined,
              nextProps,
              lastProp,
            );
          }
        }
        for (const propKey in nextProps) {
          const nextProp = nextProps[propKey];
          const lastProp = lastProps[propKey];
          if (
            nextProps.hasOwnProperty(propKey) &&
            nextProp !== lastProp &&
            (nextProp !== undefined || lastProp !== undefined)
          ) {
            setPropOnCustomElement(
              domElement,
              tag,
              propKey,
              nextProp,
              nextProps,
              lastProp,
            );
          }
        }
        return;
      }
    }
  }

  for (const propKey in lastProps) {
    const lastProp = lastProps[propKey];
    if (
      lastProps.hasOwnProperty(propKey) &&
      lastProp != null &&
      !nextProps.hasOwnProperty(propKey)
    ) {
      setProp(domElement, tag, propKey, null, nextProps, lastProp);
    }
  }
  for (const propKey in nextProps) {
    const nextProp = nextProps[propKey];
    const lastProp = lastProps[propKey];
    if (
      nextProps.hasOwnProperty(propKey) &&
      nextProp !== lastProp &&
      (nextProp != null || lastProp != null)
    ) {
      setProp(domElement, tag, propKey, nextProp, nextProps, lastProp);
    }
  }
}

/** 开发期从标准名称表查询 prop 的正确大小写；生产环境返回 null。 */
function getPossibleStandardName(propName: string): string | null {
  if (__DEV__) {
    const lowerCasedName = propName.toLowerCase();
    if (!possibleStandardNames.hasOwnProperty(lowerCasedName)) {
      return null;
    }
    return possibleStandardNames[lowerCasedName] || null;
  }
  return null;
}

/** 把 class/for 的 DOM 名转换为 React 的 className/htmlFor，其他名称保持原值。 */
function getPropNameFromAttributeName(attrName: string): string {
  switch (attrName) {
    case 'class':
      return 'className';
    case 'for':
      return 'htmlFor';
    //待办：其余别名。
    default:
      return attrName;
  }
}

/** 读取 DOM attribute 和 style，生成 hydration 诊断用的服务端 props 快照。 */
export function getPropsFromElement(domElement: Element): Object {
  const serverDifferences: {
    /** prop 名到当前 DOM 值的映射，用于反向构造开发期 props 快照。 */
    [propName: string]: mixed
  } = {};
  const attributes = domElement.attributes;
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    serverDifferences[getPropNameFromAttributeName(attr.name)] =
      attr.name.toLowerCase() === 'style'
        ? getStylesObjectFromElement(domElement)
        : attr.value;
  }
  return serverDifferences;
}

/** 读取现有 CSSStyleDeclaration 的序列化值；忽略 Fizz 运行时的预期 View Transition 名称。 */
function getStylesObjectFromElement(domElement: Element): {
  /** CSS 属性名到服务端序列化样式值的映射。 */
  [styleName: string]: string,
} {
  const serverValueInObjectForm: {
    /** CSS prop 名到当前序列化值的映射。 */
    [prop: string]: string
  } = {};
  const htmlElement: HTMLElement = domElement as any;
  const style = htmlElement.style;
  for (let i = 0; i < style.length; i++) {
    const styleName: string = style[i];
    //待办：如果原始属性值等效，我们应该在这里使用它。
    //待办：如果有相应的，我们可以使用原始客户端的大写形式
    //DOM 中存在其他大写方式。
    if (
      styleName === 'view-transition-name' &&
      isExpectedViewTransitionName(htmlElement)
    ) {
      //这是由 Fizz 运行时添加的视图过渡名称，而不是用户的属性。
    } else {
      serverValueInObjectForm[styleName] = style.getPropertyValue(styleName);
    }
  }
  return serverValueInObjectForm;
}

/** 比较 style 字符串及其规范化结果；不匹配时把服务端样式快照记入差异表。 */
function diffHydratedStyles(
  domElement: Element,
  value: mixed,
  serverDifferences: {
    /** prop 名到服务端样式值的差异表；只记录可观察的不一致。 */
    [propName: string]: mixed
  },
): void {
  if (value != null && typeof value !== 'object') {
    if (__DEV__) {
      console.error(
        'The `style` prop expects a mapping from style properties to values, ' +
          "not a string. For example, style={{marginRight: spacing + 'em'}} when " +
          'using JSX.',
      );
    }
    return;
  }
  //首先我们比较字符串形式，看看它是否相等。
  //这让我们可以放弃任何以前能够以这种形式通过的东西。
  //它还让我们能够比较此浏览器未解析的任何内容。
  const clientValue = createDangerousStringForStyles(value);
  const serverValue = domElement.getAttribute('style');

  if (serverValue === clientValue) {
    return;
  }
  const normalizedClientValue = normalizeMarkupForTextOrAttribute(clientValue);
  const normalizedServerValue = normalizeMarkupForTextOrAttribute(serverValue);
  if (normalizedServerValue === normalizedClientValue) {
    return;
  }

  if (
    //尾随分号表示这是重新生成的。
    normalizedServerValue[normalizedServerValue.length - 1] === ';' &&
    //待办事项：如果样式被修改了，我们是否应该直接忽略任何样式？
    hasViewTransition(domElement as any)
  ) {
    //如果这有视图转换，我们可能已经应用了视图转换
    //名称/类并将其移除。如果发生这种情况，样式属性将会
    //从样式对象重新生成。这意味着我们丢失了格式
    //我们从服务器发送的，并且无法对其进行差异比较。我们只是将其视为
    //即使在这个边缘情况下本应不匹配，也将其视为通过。
    return;
  }

  //否则，我们从 DOM 为差异视图创建对象。
  serverDifferences.style = getStylesObjectFromElement(domElement);
}

/** 按普通 attribute 规则比较服务端值与客户端 prop，把差异记入表，不改写 DOM。 */
function hydrateAttribute(
  domElement: Element,
  propKey: string,
  attributeName: string,
  value: any,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端 attribute 值的差异表。 */
    [propName: string]: mixed
  },
): void {
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue === null) {
    switch (typeof value) {
      case 'undefined':
      case 'function':
      case 'symbol':
      case 'boolean':
        return;
    }
  } else {
    if (value == null) {
      //我们本来有一个属性，但不应该有，所以读取它
      //针对错误消息。
    } else {
      switch (typeof value) {
        case 'function':
        case 'symbol':
        case 'boolean':
          break;
        default: {
          if (__DEV__) {
            checkAttributeStringCoercion(value, propKey);
          }
          // $FlowFixMe[invalid-compare]
          if (serverValue === '' + value) {
            return;
          }
        }
      }
    }
  }
  warnForPropDifference(propKey, serverValue, value, serverDifferences);
}

/** 按 attribute 存在性比较布尔 prop；差异只记入 hydration 诊断表。 */
function hydrateBooleanAttribute(
  domElement: Element,
  propKey: string,
  attributeName: string,
  value: any,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端布尔 attribute 值的差异表。 */
    [propName: string]: mixed
  },
): void {
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue === null) {
    switch (typeof value) {
      case 'function':
      case 'symbol':
        return;
    }
    if (!value) {
      return;
    }
  } else {
    switch (typeof value) {
      case 'function':
      case 'symbol':
        break;
      default: {
        if (value) {
          //如果这是一个布尔值，值是什么并不重要
          //我们拥有它的事实与预期相同。
          //只要它是积极的。
          return;
        }
      }
    }
  }
  warnForPropDifference(propKey, serverValue, value, serverDifferences);
}

/** 按 true 的存在性、false 的缺失性或其他字符串值比较服务端 attribute。 */
function hydrateOverloadedBooleanAttribute(
  domElement: Element,
  propKey: string,
  attributeName: string,
  value: any,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端重载布尔 attribute 值的差异表。 */
    [propName: string]: mixed
  },
): void {
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue === null) {
    switch (typeof value) {
      case 'undefined':
      case 'function':
      case 'symbol':
        return;
      default:
        // $FlowFixMe[invalid-compare]
        if (value === false) {
          return;
        }
    }
  } else {
    if (value == null) {
      //我们本来有一个属性，但不应该有，所以读取它
      //针对错误消息。
    } else {
      switch (typeof value) {
        case 'function':
        case 'symbol':
          break;
        case 'boolean':
          // $FlowFixMe[invalid-compare]
          if (value === true && serverValue === '') {
            return;
          }
          break;
        default: {
          if (__DEV__) {
            checkAttributeStringCoercion(value, propKey);
          }
          // $FlowFixMe[invalid-compare]
          if (serverValue === '' + value) {
            return;
          }
        }
      }
    }
  }
  warnForPropDifference(propKey, serverValue, value, serverDifferences);
}

/** 把允许的 boolean/字符串值与服务端 attribute 比较，不修补属性。 */
function hydrateBooleanishAttribute(
  domElement: Element,
  propKey: string,
  attributeName: string,
  value: any,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端 booleanish attribute 值的差异表。 */
    [propName: string]: mixed
  },
): void {
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue === null) {
    switch (typeof value) {
      case 'undefined':
      case 'function':
      case 'symbol':
        return;
    }
  } else {
    if (value == null) {
      //我们本来有一个属性，但不应该有，所以读取它
      //针对错误消息。
    } else {
      switch (typeof value) {
        case 'function':
        case 'symbol':
          break;
        default: {
          if (__DEV__) {
            checkAttributeStringCoercion(value, attributeName);
          }
          if (serverValue === '' + (value as any)) {
            return;
          }
        }
      }
    }
  }
  warnForPropDifference(propKey, serverValue, value, serverDifferences);
}

/** 按可序列化数值规则比较服务端 attribute，NaN 与不支持的类型视为应缺失。 */
function hydrateNumericAttribute(
  domElement: Element,
  propKey: string,
  attributeName: string,
  value: any,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端数值 attribute 值的差异表。 */
    [propName: string]: mixed
  },
): void {
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue === null) {
    switch (typeof value) {
      case 'undefined':
      case 'function':
      case 'symbol':
      case 'boolean':
        return;
      default:
        if (isNaN(value)) {
          return;
        }
    }
  } else {
    if (value == null) {
      //我们本来有一个属性，但不应该有，所以读取它
      //针对错误消息。
    } else {
      switch (typeof value) {
        case 'function':
        case 'symbol':
        case 'boolean':
          break;
        default: {
          if (isNaN(value)) {
            //我们本来有一个属性，但不应该有，所以读取它
            //针对错误消息。
            break;
          }
          if (__DEV__) {
            checkAttributeStringCoercion(value, propKey);
          }
          // $FlowFixMe[invalid-compare]
          if (serverValue === '' + value) {
            return;
          }
        }
      }
    }
  }
  warnForPropDifference(propKey, serverValue, value, serverDifferences);
}

/** 按大于等于 1 的数值规则比较服务端 attribute，并记录差异。 */
function hydratePositiveNumericAttribute(
  domElement: Element,
  propKey: string,
  attributeName: string,
  value: any,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端正数 attribute 值的差异表。 */
    [propName: string]: mixed
  },
): void {
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue === null) {
    switch (typeof value) {
      case 'undefined':
      case 'function':
      case 'symbol':
      case 'boolean':
        return;
      default:
        if (isNaN(value) || value < 1) {
          return;
        }
    }
  } else {
    if (value == null) {
      //我们本来有一个属性，但不应该有，所以读取它
      //针对错误消息。
    } else {
      switch (typeof value) {
        case 'function':
        case 'symbol':
        case 'boolean':
          break;
        default: {
          if (isNaN(value) || value < 1) {
            //我们本来有一个属性，但不应该有，所以读取它
            //针对错误消息。
            break;
          }
          if (__DEV__) {
            checkAttributeStringCoercion(value, propKey);
          }
          // $FlowFixMe[invalid-compare]
          if (serverValue === '' + value) {
            return;
          }
        }
      }
    }
  }
  warnForPropDifference(propKey, serverValue, value, serverDifferences);
}

/** 把客户端 URL 经 sanitizeURL 后与服务端 attribute 比较，记录差异。 */
function hydrateSanitizedAttribute(
  domElement: Element,
  propKey: string,
  attributeName: string,
  value: any,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端 URL attribute 值的差异表；比较前执行同一清洗规则。 */
    [propName: string]: mixed
  },
): void {
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue === null) {
    switch (typeof value) {
      case 'undefined':
      case 'function':
      case 'symbol':
      case 'boolean':
        return;
    }
  } else {
    if (value == null) {
      //我们本来有一个属性，但不应该有，所以读取它
      //针对错误消息。
    } else {
      switch (typeof value) {
        case 'function':
        case 'symbol':
        case 'boolean':
          break;
        default: {
          if (__DEV__) {
            checkAttributeStringCoercion(value, propKey);
          }
          const sanitizedValue = sanitizeURL('' + value);
          if (serverValue === sanitizedValue) {
            return;
          }
        }
      }
    }
  }
  warnForPropDifference(propKey, serverValue, value, serverDifferences);
}

/** 比较对象 src 的 SSR data URL 形态；Blob 仅按 MIME 与编码长度检查。 */
function hydrateSrcObjectAttribute(
  domElement: Element,
  value: Blob,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到服务端 srcObject 回退 attribute 值的差异表。 */
    [propName: string]: mixed
  },
): void {
  const attributeName = 'src';
  extraAttributes.delete(attributeName);
  const serverValue = domElement.getAttribute(attributeName);
  if (serverValue != null && value != null) {
    const size = value.size;
    const type = value.type;
    if (typeof size === 'number' && typeof type === 'string') {
      if (serverValue.indexOf('data:' + type + ';base64,') === 0) {
        //对于 Blob，我们不去读取实际数据，而只是通过检查是否来进行差异化
        //Blob 的字节长度与数据 URL 的长度相匹配。
        const prefixLength = 5 + type.length + 8;
        let byteLength = ((serverValue.length - prefixLength) / 4) * 3;
        if (serverValue[serverValue.length - 1] === '=') {
          byteLength--;
        }
        if (serverValue[serverValue.length - 2] === '=') {
          byteLength--;
        }
        if (byteLength === size) {
          return;
        }
      }
    }
  }
  warnForPropDifference('src', serverValue, value, serverDifferences);
}

/** 按自定义元素规则消费服务端属性并记录差异；忽略 React 保留 props 与 suppressHydrationWarning 下的差异。 */
function diffHydratedCustomComponent(
  domElement: Element,
  tag: string,
  props: Object,
  hostContext: HostContext,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到自定义元素服务端值的差异表。 */
    [propName: string]: mixed
  },
) {
  for (const propKey in props) {
    if (!props.hasOwnProperty(propKey)) {
      continue;
    }
    const value = props[propKey];
    if (value == null) {
      continue;
    }
    if (registrationNameDependencies.hasOwnProperty(propKey)) {
      if (typeof value !== 'function') {
        warnForInvalidEventListener(propKey, value);
      }
      continue;
    }
    if (props.suppressHydrationWarning === true) {
      //别费心比较了。我们忽略所有这些警告。
      continue;
    }
    //验证属性是否与其预期值相对应。
    switch (propKey) {
      case 'children': {
        if (typeof value === 'string' || typeof value === 'number') {
          warnForPropDifference(
            'children',
            domElement.textContent,
            value,
            serverDifferences,
          );
        }
        continue;
      }
      //上面已经检查过了
      case 'suppressContentEditableWarning':
      case 'suppressHydrationWarning':
      case 'defaultValue':
      case 'defaultChecked':
      case 'innerHTML':
      case 'ref':
        //无操作
        continue;
      case 'dangerouslySetInnerHTML':
        const serverHTML = domElement.innerHTML;
        const nextHtml = value ? value.__html : undefined;
        if (nextHtml != null) {
          const expectedHTML = normalizeHTML(domElement, nextHtml);
          warnForPropDifference(
            propKey,
            serverHTML,
            expectedHTML,
            serverDifferences,
          );
        }
        continue;
      case 'style':
        extraAttributes.delete(propKey);
        diffHydratedStyles(domElement, value, serverDifferences);
        continue;
      case 'offsetParent':
      case 'offsetTop':
      case 'offsetLeft':
      case 'offsetWidth':
      case 'offsetHeight':
      case 'isContentEditable':
      case 'outerText':
      case 'outerHTML':
        extraAttributes.delete(propKey.toLowerCase());
        if (__DEV__) {
          console.error(
            'Assignment to read-only property will result in a no-op: `%s`',
            propKey,
          );
        }
        continue;
      // className 在 SSR 上序列化为 class，单独消费这个别名。
      case 'className':
        //className 是服务器上的一个特殊处理属性，用于呈现为一个属性。
        extraAttributes.delete('class');
        const serverValue = getValueForAttributeOnCustomComponent(
          domElement,
          'class',
          value,
        );
        warnForPropDifference(
          'className',
          serverValue,
          value,
          serverDifferences,
        );
        continue;
      default: {
        //这是一个仅限开发的路径
        const hostContextDev: HostContextDev = hostContext as any;
        const hostContextProd = hostContextDev.context;
        if (
          hostContextProd === HostContextNamespaceNone &&
          tag !== 'svg' &&
          tag !== 'math'
        ) {
          extraAttributes.delete(propKey.toLowerCase());
        } else {
          extraAttributes.delete(propKey);
        }
        const valueOnCustomComponent = getValueForAttributeOnCustomComponent(
          domElement,
          propKey,
          value,
        );
        warnForPropDifference(
          propKey,
          valueOnCustomComponent,
          value,
          serverDifferences,
        );
      }
    }
  }
}

/** 与Fizz函数表单action的默认占位URL保持一致；水合时客户端已改为非函数而服务端仍是该值，就按原值function报告差异。自定义渐进增强URL不使用这个哨兵。 */
const EXPECTED_FORM_ACTION_URL =
  // eslint-disable-next-line no-script-url
  "javascript:throw new Error('React form unexpectedly submitted.')";

/** 按标准标签各类 prop 规则比较服务端 DOM，并消费已识别 attribute；此路径只生成诊断。 */
function diffHydratedGenericElement(
  domElement: Element,
  tag: string,
  props: Object,
  hostContext: HostContext,
  extraAttributes: Set<string>,
  serverDifferences: {
    /** prop 名到普通元素服务端值的差异表。 */
    [propName: string]: mixed
  },
) {
  for (const propKey in props) {
    if (!props.hasOwnProperty(propKey)) {
      continue;
    }
    const value = props[propKey];
    if (value == null) {
      continue;
    }
    if (registrationNameDependencies.hasOwnProperty(propKey)) {
      if (typeof value !== 'function') {
        warnForInvalidEventListener(propKey, value);
      }
      continue;
    }
    if (props.suppressHydrationWarning === true) {
      //别费心比较了。我们忽略所有这些警告。
      continue;
    }
    //验证属性是否与其预期值相对应。
    switch (propKey) {
      case 'children': {
        if (typeof value === 'string' || typeof value === 'number') {
          warnForPropDifference(
            'children',
            domElement.textContent,
            value,
            serverDifferences,
          );
        }
        continue;
      }
      //上面已经检查过了
      case 'suppressContentEditableWarning':
      case 'suppressHydrationWarning':
      case 'value': //受控属性未经过验证
      case 'checked': //待办事项：仅在受控标签上忽略它们。
      case 'selected':
      case 'defaultValue':
      case 'defaultChecked':
      case 'innerHTML':
      case 'ref':
        //无操作
        continue;
      case 'dangerouslySetInnerHTML':
        const serverHTML = domElement.innerHTML;
        const nextHtml = value ? value.__html : undefined;
        if (nextHtml != null) {
          const expectedHTML = normalizeHTML(domElement, nextHtml);
          if (serverHTML !== expectedHTML) {
            serverDifferences[propKey] = {
              __html: serverHTML,
            };
          }
        }
        continue;
      case 'className':
        hydrateAttribute(
          domElement,
          propKey,
          'class',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'tabIndex':
        hydrateAttribute(
          domElement,
          propKey,
          'tabindex',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'style':
        extraAttributes.delete(propKey);
        diffHydratedStyles(domElement, value, serverDifferences);
        continue;
      case 'multiple': {
        extraAttributes.delete(propKey);
        const serverValue = (domElement as any).multiple;
        warnForPropDifference(propKey, serverValue, value, serverDifferences);
        continue;
      }
      case 'muted': {
        extraAttributes.delete(propKey);
        const serverValue = (domElement as any).muted;
        warnForPropDifference(propKey, serverValue, value, serverDifferences);
        continue;
      }
      case 'autoFocus': {
        extraAttributes.delete('autofocus');
        const serverValue = (domElement as any).autofocus;
        warnForPropDifference(propKey, serverValue, value, serverDifferences);
        continue;
      }
      case 'data':
        if (tag !== 'object') {
          extraAttributes.delete(propKey);
          const serverValue = (domElement as any).getAttribute('data');
          warnForPropDifference(propKey, serverValue, value, serverDifferences);
          continue;
        }
      //穿透
      case 'src': {
        if (enableSrcObject && typeof value === 'object' && value !== null) {
          //一些标签支持像 Blob、File、MediaSource 和 MediaStream 这样的对象源。
          if (tag === 'img' || tag === 'video' || tag === 'audio') {
            try {
              //测试这是否是兼容对象
              URL.revokeObjectURL(URL.createObjectURL(value as any));
              hydrateSrcObjectAttribute(
                domElement,
                value,
                extraAttributes,
                serverDifferences,
              );
              continue;
            } catch (x) {
              //如果不是，就直接继续正常的 toString 流程。
            }
          } else {
            if (__DEV__) {
              try {
                // 能创建 URL 则说明是可支持的源对象，当前标签不支持它，因而报告标签用法错误。
                URL.revokeObjectURL(URL.createObjectURL(value as any));
                if (tag === 'source') {
                  console.error(
                    'Passing Blob, MediaSource or MediaStream to <source src> is not supported. ' +
                      'Pass it directly to <img src>, <video src> or <audio src> instead.',
                  );
                } else {
                  console.error(
                    'Passing Blob, MediaSource or MediaStream to <%s src> is not supported.',
                    tag,
                  );
                }
              } catch (x) {}
            }
          }
        }
        //穿透
      }
      case 'href':
        if (
          value === '' &&
          //<a href=""> 对于“重新加载”链接来说是可以的。
          !(tag === 'a' && propKey === 'href') &&
          !(tag === 'object' && propKey === 'data')
        ) {
          if (__DEV__) {
            if (propKey === 'src') {
              console.error(
                'An empty string ("") was passed to the %s attribute. ' +
                  'This may cause the browser to download the whole page again over the network. ' +
                  'To fix this, either do not render the element at all ' +
                  'or pass null to %s instead of an empty string.',
                propKey,
                propKey,
              );
            } else {
              console.error(
                'An empty string ("") was passed to the %s attribute. ' +
                  'To fix this, either do not render the element at all ' +
                  'or pass null to %s instead of an empty string.',
                propKey,
                propKey,
              );
            }
          }
          continue;
        }
        hydrateSanitizedAttribute(
          domElement,
          propKey,
          propKey,
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'action':
      case 'formAction': {
        const serverValue = domElement.getAttribute(propKey);
        if (typeof value === 'function') {
          extraAttributes.delete(propKey.toLowerCase());
          //服务器可以设置这些额外属性来实现操作。
          //所以我们将它们从额外属性警告中移除。
          if (propKey === 'formAction') {
            extraAttributes.delete('name');
            extraAttributes.delete('formenctype');
            extraAttributes.delete('formmethod');
            extraAttributes.delete('formtarget');
          } else {
            extraAttributes.delete('enctype');
            extraAttributes.delete('method');
            extraAttributes.delete('target');
          }
          //理想情况下，如果服务器值不是一个函数，我们应该能够发出警告
          //然而，由于该函数可以以任何方式返回这些属性中的任意一个
          //作为一种定制的渐进增强，没有什么可以相比。
          //我们可以在客户端检查函数是否具有 $FORM_ACTION 属性
          //如果不是，则发出警告，但那是他们不必要的限制
          //必须有那个在客户端什么都不做的额外扩展。
          continue;
        } else if (serverValue === EXPECTED_FORM_ACTION_URL) {
          extraAttributes.delete(propKey.toLowerCase());
          warnForPropDifference(propKey, 'function', value, serverDifferences);
          continue;
        }
        hydrateSanitizedAttribute(
          domElement,
          propKey,
          propKey.toLowerCase(),
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'xlinkHref':
        hydrateSanitizedAttribute(
          domElement,
          propKey,
          'xlink:href',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'contentEditable': {
        //小写布尔字符串
        hydrateBooleanishAttribute(
          domElement,
          propKey,
          'contenteditable',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'spellCheck': {
        //小写布尔字符串
        hydrateBooleanishAttribute(
          domElement,
          propKey,
          'spellcheck',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'draggable':
      case 'autoReverse':
      case 'externalResourcesRequired':
      case 'focusable':
      case 'preserveAlpha': {
        //区分大小写的布尔字符串
        hydrateBooleanishAttribute(
          domElement,
          propKey,
          propKey,
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'allowFullScreen':
      case 'async':
      case 'autoPlay':
      case 'controls':
      case 'credentialless':
      case 'default':
      case 'defer':
      case 'disabled':
      case 'disablePictureInPicture':
      case 'disableRemotePlayback':
      case 'formNoValidate':
      case 'hidden':
      case 'loop':
      case 'noModule':
      case 'noValidate':
      case 'open':
      case 'playsInline':
      case 'readOnly':
      case 'required':
      case 'reversed':
      case 'scoped':
      case 'seamless':
      case 'itemScope': {
        //其中一些需要小写，以便将它们从 extraAttributes 列表中移除。
        hydrateBooleanAttribute(
          domElement,
          propKey,
          propKey.toLowerCase(),
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'capture':
      case 'download': {
        hydrateOverloadedBooleanAttribute(
          domElement,
          propKey,
          propKey,
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'cols':
      case 'rows':
      case 'size':
      case 'span': {
        hydratePositiveNumericAttribute(
          domElement,
          propKey,
          propKey,
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'rowSpan': {
        hydrateNumericAttribute(
          domElement,
          propKey,
          'rowspan',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'start': {
        hydrateNumericAttribute(
          domElement,
          propKey,
          propKey,
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      }
      case 'xHeight':
        hydrateAttribute(
          domElement,
          propKey,
          'x-height',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xlinkActuate':
        hydrateAttribute(
          domElement,
          propKey,
          'xlink:actuate',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xlinkArcrole':
        hydrateAttribute(
          domElement,
          propKey,
          'xlink:arcrole',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xlinkRole':
        hydrateAttribute(
          domElement,
          propKey,
          'xlink:role',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xlinkShow':
        hydrateAttribute(
          domElement,
          propKey,
          'xlink:show',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xlinkTitle':
        hydrateAttribute(
          domElement,
          propKey,
          'xlink:title',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xlinkType':
        hydrateAttribute(
          domElement,
          propKey,
          'xlink:type',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xmlBase':
        hydrateAttribute(
          domElement,
          propKey,
          'xml:base',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xmlLang':
        hydrateAttribute(
          domElement,
          propKey,
          'xml:lang',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'xmlSpace':
        hydrateAttribute(
          domElement,
          propKey,
          'xml:space',
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      case 'inert':
        if (__DEV__) {
          if (
            value === '' &&
            !didWarnForNewBooleanPropsWithEmptyValue[propKey]
          ) {
            didWarnForNewBooleanPropsWithEmptyValue[propKey] = true;
            console.error(
              'Received an empty string for a boolean attribute `%s`. ' +
                'This will treat the attribute as if it were false. ' +
                'Either pass `false` to silence this warning, or ' +
                'pass `true` if you used an empty string in earlier versions of React to indicate this attribute is true.',
              propKey,
            );
          }
        }
        hydrateBooleanAttribute(
          domElement,
          propKey,
          propKey,
          value,
          extraAttributes,
          serverDifferences,
        );
        continue;
      default: {
        if (
          //应该忽略属性
          //我们已经过滤掉了 null/undefined 和保留字。
          propKey.length > 2 &&
          (propKey[0] === 'o' || propKey[0] === 'O') &&
          (propKey[1] === 'n' || propKey[1] === 'N')
        ) {
          continue;
        }
        const attributeName = getAttributeAlias(propKey);
        let isMismatchDueToBadCasing = false;

        //这是一个仅限开发的路径
        const hostContextDev: HostContextDev = hostContext as any;
        const hostContextProd = hostContextDev.context;

        if (
          hostContextProd === HostContextNamespaceNone &&
          tag !== 'svg' &&
          tag !== 'math'
        ) {
          extraAttributes.delete(attributeName.toLowerCase());
        } else {
          const standardName = getPossibleStandardName(propKey);
          if (standardName !== null && standardName !== propKey) {
            //如果提供了大小写错误的 SVG 属性，它将
            //可以从 HTML 中成功解析，但会产生不匹配
            //（并且会在客户端被错误显示）。
            //然而，我们已经在其他地方警告过关于错误大小写的问题。
            //所以在这种情况下，我们将跳过误导性的额外不匹配警告。
            isMismatchDueToBadCasing = true;
            extraAttributes.delete(standardName);
          }
          extraAttributes.delete(attributeName);
        }
        const serverValue = getValueForAttribute(
          domElement,
          attributeName,
          value,
        );
        if (!isMismatchDueToBadCasing) {
          warnForPropDifference(propKey, serverValue, value, serverDifferences);
        }
      }
    }
  }
}

/**
 * hydration 认领已有元素时连接非委托事件、click 兼容回调与表单状态，保留可复用的服务端 DOM 身份。
 * 直接文本 children 与 textContent 不同，且未抑制、规范化后仍不同，返回 false 让 reconciler 处理 mismatch。
 * 普通 attribute 差异由 diffHydratedProperties 另做开发期诊断；此函数不批量按客户端 props 修补它们。
 * hydration-change 特性开启时，表单跟踪留给 commitHydratedInstance 处理。
 */
export function hydrateProperties(
  domElement: Element,
  tag: string,
  props: Object,
  hostContext: HostContext,
): boolean {
  if (__DEV__) {
    validatePropertiesInDevelopment(tag, props);
  }

  //待办：在触发任何这些事件之前，确保我们检查了 isMounted。
  switch (tag) {
    case 'dialog':
      listenToNonDelegatedEvent('cancel', domElement);
      listenToNonDelegatedEvent('close', domElement);
      break;
    case 'iframe':
    case 'object':
    case 'embed':
      //我们收听此事件以确保模拟气泡
      //监听器仍然会触发 load 事件。
      listenToNonDelegatedEvent('load', domElement);
      break;
    case 'video':
    case 'audio':
      //我们监听这些事件，以确保模拟气泡
      //监听器仍会响应所有媒体事件。
      for (let i = 0; i < mediaEventTypes.length; i++) {
        listenToNonDelegatedEvent(mediaEventTypes[i], domElement);
      }
      break;
    case 'source':
      //我们收听此事件以确保模拟气泡
      //监听器仍然会触发错误事件。
      listenToNonDelegatedEvent('error', domElement);
      break;
    case 'img':
    case 'image':
    case 'link':
      //我们监听这些事件，以确保模拟气泡
      //监听器仍会触发错误和加载事件。
      listenToNonDelegatedEvent('error', domElement);
      listenToNonDelegatedEvent('load', domElement);
      break;
    case 'details':
      //我们收听此事件以确保模拟气泡
      //监听器仍然会触发切换事件。
      listenToNonDelegatedEvent('toggle', domElement);
      break;
    case 'input':
      if (__DEV__) {
        checkControlledValueProps('input', props);
      }
      //我们收听此事件以确保模拟气泡
      //监听器仍然会为无效事件触发。
      listenToNonDelegatedEvent('invalid', domElement);
      //待办：确保我们检查这个是否仍未卸载，或者进行任何清理
      //必须继续，因为我们再也不会停止跟踪了。
      validateInputProps(domElement, props);
      // 默认路径初始化 input 的默认状态和 tracker，但 isHydrating=true 保留用户的当前值。
      // hydration-change 路径在提交时再以初始 props 建立 tracker，检测 hydration 前的编辑。
      if (!enableHydrationChangeEvent) {
        initInput(
          domElement,
          props.value,
          props.defaultValue,
          props.checked,
          props.defaultChecked,
          props.type,
          props.name,
          true,
        );
      }
      break;
    case 'option':
      validateOptionProps(domElement, props);
      break;
    case 'select':
      if (__DEV__) {
        checkControlledValueProps('select', props);
      }
      //我们收听此事件以确保模拟气泡
      //监听器仍然会为无效事件触发。
      listenToNonDelegatedEvent('invalid', domElement);
      validateSelectProps(domElement, props);
      break;
    case 'textarea':
      if (__DEV__) {
        checkControlledValueProps('textarea', props);
      }
      //我们收听此事件以确保模拟气泡
      //监听器仍然会为无效事件触发。
      listenToNonDelegatedEvent('invalid', domElement);
      //待办：确保我们检查这个是否仍未挂载，或者进行任何清理
      //必须继续，因为我们再也不会停止跟踪了。
      validateTextareaProps(domElement, props);
      if (!enableHydrationChangeEvent) {
        initTextarea(
          domElement,
          props.value,
          props.defaultValue,
          props.children,
        );
      }
      break;
  }

  const children = props.children;
  // 直接文本 children 按总 textContent 比较，"foo" 也会接受 "f<span>oo</span>"。
  // 这条检查判断可复用文本内容，不验证已有子节点的逐个结构或额外监听。
  //待办：如果有多个 textNode 作为子节点，则发出警告。
  //待办：我们是否应该使用 domElement.firstChild.nodeValue 来比较？
  if (
    typeof children === 'string' ||
    typeof children === 'number' ||
    typeof children === 'bigint'
  ) {
    if (
      // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
      domElement.textContent !== '' + children &&
      props.suppressHydrationWarning !== true &&
      !checkForUnmatchedText(domElement.textContent, children)
    ) {
      return false;
    }
  }

  if (props.popover != null) {
    //我们收听此事件以确保模拟气泡
    //监听器仍然会触发切换事件。
    listenToNonDelegatedEvent('beforetoggle', domElement);
    listenToNonDelegatedEvent('toggle', domElement);
  }

  if (props.onScroll != null) {
    listenToNonDelegatedEvent('scroll', domElement);
  }

  if (props.onScrollEnd != null) {
    listenToNonDelegatedEvent('scrollend', domElement);
    if (enableScrollEndPolyfill) {
      //供补丁使用。
      listenToNonDelegatedEvent('scroll', domElement);
    }
  }

  if (props.onClick != null) {
    //待办：此类型转换可能对 SVG、MathML 或自定义元素不安全。
    trapClickOnNonInteractiveElement(domElement as any as HTMLElement);
  }

  return true;
}

/** 开发期生成服务端 props 差异表；空表返回 null，不修补普通属性。 */
export function diffHydratedProperties(
  domElement: Element,
  tag: string,
  props: Object,
  hostContext: HostContext,
): null | Object {
  const serverDifferences: {
    /** prop 名到服务端 DOM 值的总差异表；空表表示无需开发期报告。 */
    [propName: string]: mixed
  } = {};
  if (__DEV__) {
    const extraAttributes: Set<string> = new Set();
    const attributes = domElement.attributes;
    for (let i = 0; i < attributes.length; i++) {
      const name = attributes[i].name.toLowerCase();
      switch (name) {
        //受控属性未经过验证
        //待办事项：仅在受控标签上忽略它们。
        case 'value':
          break;
        case 'checked':
          break;
        case 'selected':
          break;
        case 'vt-name':
        case 'vt-update':
        case 'vt-enter':
        case 'vt-exit':
        case 'vt-share':
        case 'vt-parent-enter':
        case 'vt-parent-exit':
          if (enableViewTransition) {
            //视图转换注释预期来自服务器运行时。
            //然而，如果它们也在客户端上指定并且不匹配
            //那是一个错误。
            break;
          }
        //穿透
        default:
          //故意使用原始名称。
          //请参阅 https://github.com/facebook/react/pull/10676. 中的讨论
          extraAttributes.add(attributes[i].name);
      }
    }
    if (isCustomElement(tag, props)) {
      diffHydratedCustomComponent(
        domElement,
        tag,
        props,
        hostContext,
        extraAttributes,
        serverDifferences,
      );
    } else {
      diffHydratedGenericElement(
        domElement,
        tag,
        props,
        hostContext,
        extraAttributes,
        serverDifferences,
      );
    }
    if (extraAttributes.size > 0 && props.suppressHydrationWarning !== true) {
      warnForExtraAttributes(domElement, extraAttributes, serverDifferences);
    }
  }
  if (Object.keys(serverDifferences).length === 0) {
    return null;
  }
  return serverDifferences;
}

/** 检查现有 Text 与期望文本；允许抑制警告或解析规范化后相等，否则返回 false。 */
export function hydrateText(
  textNode: Text,
  text: string,
  parentProps: null | Object,
): boolean {
  const isDifferent = textNode.nodeValue !== text;
  if (
    isDifferent &&
    (parentProps === null || parentProps.suppressHydrationWarning !== true) &&
    !checkForUnmatchedText(textNode.nodeValue, text)
  ) {
    return false;
  }
  return true;
}

/** 开发期返回不匹配的服务端文本；原文或规范化后相等均返回 null。 */
export function diffHydratedText(textNode: Text, text: string): null | string {
  if (textNode.nodeValue === text) {
    return null;
  }
  const normalizedClientText = normalizeMarkupForTextOrAttribute(text);
  const normalizedServerText = normalizeMarkupForTextOrAttribute(
    textNode.nodeValue,
  );
  if (normalizedServerText === normalizedClientText) {
    return null;
  }
  return textNode.nodeValue;
}

/** 按 input、textarea、select 标签转发受控值恢复，使用事件批次结束后的最新 props。 */
export function restoreControlledState(
  domElement: Element,
  tag: string,
  props: Object,
): void {
  switch (tag) {
    case 'input':
      restoreControlledInputState(domElement, props);
      return;
    case 'textarea':
      restoreControlledTextareaState(domElement, props);
      return;
    case 'select':
      restoreControlledSelectState(domElement, props);
      return;
  }
}
