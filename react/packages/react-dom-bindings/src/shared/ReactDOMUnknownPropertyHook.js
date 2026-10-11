/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {ATTRIBUTE_NAME_CHAR} from './isAttributeNameSafe';
import isCustomElement from './isCustomElement';
import possibleStandardNames from './possibleStandardNames';
import hasOwnProperty from 'shared/hasOwnProperty';

/** 已报告过的 DOM prop 名，保证同一问题只警告一次。 */
const warnedProperties = {};
/** 识别任何以 on 开头的潜在事件 prop。 */
const EVENT_NAME_REGEX = /^on./;
/** 识别未按 React camelCase 约定书写的事件 prop。 */
const INVALID_EVENT_NAME_REGEX = /^on[^A-Z]/;
/** 开发环境识别连字符形式 aria-* 的正则；生产环境不分配。 */
const rARIA = __DEV__
  ? new RegExp('^(aria)-[' + ATTRIBUTE_NAME_CHAR + ']*$')
  : null;
/** 开发环境识别 ariaXxx 误写形式的正则；生产环境不分配。 */
const rARIACamel = __DEV__
  ? new RegExp('^(aria)[A-Z][' + ATTRIBUTE_NAME_CHAR + ']*$')
  : null;

/**
 * 校验单个标准 DOM prop 的名称、事件注册、保留字段及值类型。
 * 返回 false 仅表示值类型会被丢弃并需由调用方汇总；已即时给出专门诊断时返回 true。
 */
function validateProperty(tagName, name, value, eventRegistry) {
  if (__DEV__) {
    if (hasOwnProperty.call(warnedProperties, name) && warnedProperties[name]) {
      return true;
    }

    const lowerCasedName = name.toLowerCase();
    if (lowerCasedName === 'onfocusin' || lowerCasedName === 'onfocusout') {
      console.error(
        'React uses onFocus and onBlur instead of onFocusIn and onFocusOut. ' +
          'All React events are normalized to bubble, so onFocusIn and onFocusOut ' +
          'are not needed/supported by React.',
      );
      warnedProperties[name] = true;
      return true;
    }

    // action 与事件不同，可合法接收函数等其他值类型，因此先行放过支持它的标签。
    if (typeof value === 'function') {
      if (tagName === 'form' && name === 'action') {
        return true;
      }
      if (tagName === 'input' && name === 'formAction') {
        return true;
      }
      if (tagName === 'button' && name === 'formAction') {
        return true;
      }
    }
    // 服务端不保证注入事件系统；仅在 registry 存在时才能精确校验事件名。
    if (eventRegistry != null) {
      const {registrationNameDependencies, possibleRegistrationNames} =
        eventRegistry;
      if (registrationNameDependencies.hasOwnProperty(name)) {
        return true;
      }
      const registrationName = possibleRegistrationNames.hasOwnProperty(
        lowerCasedName,
      )
        ? possibleRegistrationNames[lowerCasedName]
        : null;
      if (registrationName != null) {
        console.error(
          'Invalid event handler property `%s`. Did you mean `%s`?',
          name,
          registrationName,
        );
        warnedProperties[name] = true;
        return true;
      }
      if (EVENT_NAME_REGEX.test(name)) {
        console.error(
          'Unknown event handler property `%s`. It will be ignored.',
          name,
        );
        warnedProperties[name] = true;
        return true;
      }
    } else if (EVENT_NAME_REGEX.test(name)) {
      // 未注入插件意味着当前在服务端，无法确认完整事件集合；仍可过滤 `onclick`
      // 这类确定错误的形式，但无法建议精确替代名。
      if (INVALID_EVENT_NAME_REGEX.test(name)) {
        console.error(
          'Invalid event handler property `%s`. ' +
            'React events use the camelCase naming convention, for example `onClick`.',
          name,
        );
      }
      warnedProperties[name] = true;
      return true;
    }

    // ARIA 属性交给专用 Hook 校验，避免重复或冲突诊断。
    if (rARIA.test(name) || rARIACamel.test(name)) {
      return true;
    }

    if (lowerCasedName === 'innerhtml') {
      console.error(
        'Directly setting property `innerHTML` is not permitted. ' +
          'For more information, lookup documentation on `dangerouslySetInnerHTML`.',
      );
      warnedProperties[name] = true;
      return true;
    }

    if (lowerCasedName === 'aria') {
      console.error(
        'The `aria` attribute is reserved for future use in React. ' +
          'Pass individual `aria-` attributes instead.',
      );
      warnedProperties[name] = true;
      return true;
    }

    if (
      lowerCasedName === 'is' &&
      value !== null &&
      value !== undefined &&
      typeof value !== 'string'
    ) {
      console.error(
        'Received a `%s` for a string attribute `is`. If this is expected, cast ' +
          'the value to a string.',
        typeof value,
      );
      warnedProperties[name] = true;
      return true;
    }

    if (typeof value === 'number' && isNaN(value)) {
      console.error(
        'Received NaN for the `%s` attribute. If this is expected, cast ' +
          'the value to a string.',
        name,
      );
      warnedProperties[name] = true;
      return true;
    }

    // 已知属性必须匹配属性配置表规定的大小写。
    if (possibleStandardNames.hasOwnProperty(lowerCasedName)) {
      const standardName = possibleStandardNames[lowerCasedName];
      if (standardName !== name) {
        console.error(
          'Invalid DOM property `%s`. Did you mean `%s`?',
          name,
          standardName,
        );
        warnedProperties[name] = true;
        return true;
      }
    } else if (name !== lowerCasedName) {
      // 未知 prop 带大写时给出自定义属性的小写拼写建议。
      console.error(
        'React does not recognize the `%s` prop on a DOM element. If you ' +
          'intentionally want it to appear in the DOM as a custom ' +
          'attribute, spell it as lowercase `%s` instead. ' +
          'If you accidentally passed it from a parent component, remove ' +
          'it from the DOM element.',
        name,
        lowerCasedName,
      );
      warnedProperties[name] = true;
      return true;
    }

    // 大小写通过后，保留 props 不再进入通用数据类型校验。
    switch (name) {
      case 'dangerouslySetInnerHTML':
      case 'children':
      case 'style':
      case 'suppressContentEditableWarning':
      case 'suppressHydrationWarning':
      case 'defaultValue': // React 保留字段。
      case 'defaultChecked':
      case 'innerHTML':
      case 'ref': {
        return true;
      }
      case 'innerText': // DOM 属性。
      case 'textContent':
        return true;
    }

    switch (typeof value) {
      case 'boolean': {
        switch (name) {
          case 'autoFocus':
          case 'checked':
          case 'multiple':
          case 'muted':
          case 'selected':
          case 'contentEditable':
          case 'spellCheck':
          case 'draggable':
          case 'value':
          case 'autoReverse':
          case 'externalResourcesRequired':
          case 'focusable':
          case 'preserveAlpha':
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
          case 'itemScope':
          case 'capture':
          case 'download':
          case 'inert': {
            // 这些布尔属性允许直接接收 boolean。
            return true;
          }
          // 未列入允许 boolean 的属性，继续走通用警告分支。
          default: {
            const prefix = name.toLowerCase().slice(0, 5);
            if (prefix === 'data-' || prefix === 'aria-') {
              return true;
            }
            if (value) {
              console.error(
                'Received `%s` for a non-boolean attribute `%s`.\n\n' +
                  'If you want to write it to the DOM, pass a string instead: ' +
                  '%s="%s" or %s={value.toString()}.',
                value,
                name,
                name,
                value,
                name,
              );
            } else {
              console.error(
                'Received `%s` for a non-boolean attribute `%s`.\n\n' +
                  'If you want to write it to the DOM, pass a string instead: ' +
                  '%s="%s" or %s={value.toString()}.\n\n' +
                  'If you used to conditionally omit it with %s={condition && value}, ' +
                  'pass %s={condition ? value : undefined} instead.',
                value,
                name,
                name,
                value,
                name,
                name,
                name,
              );
            }
            warnedProperties[name] = true;
            return true;
          }
        }
      }
      case 'function':
      case 'symbol':
        // 已知属性收到不可序列化类型时由调用方汇总警告。
        warnedProperties[name] = true;
        return false;
      case 'string': {
        // 布尔 prop 收到字符串 'false'/'true' 时提醒浏览器仍会把字符串视为 truthy。
        if (value === 'false' || value === 'true') {
          switch (name) {
            case 'checked':
            case 'selected':
            case 'multiple':
            case 'muted':
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
            case 'itemScope':
            case 'inert': {
              break;
            }
            default: {
              return true;
            }
          }
          console.error(
            'Received the string `%s` for the boolean attribute `%s`. ' +
              '%s ' +
              'Did you mean %s={%s}?',
            value,
            name,
            value === 'false'
              ? 'The browser will interpret it as a truthy value.'
              : 'Although this works, it will not work as expected if you pass the string "false".',
            name,
            value,
          );
          warnedProperties[name] = true;
          return true;
        }
      }
    }
    return true;
  }
}

/** 遍历 props，汇总所有因值类型而无法写入 DOM 的未知属性。 */
function warnUnknownProperties(type, props, eventRegistry) {
  if (__DEV__) {
    const unknownProps = [];
    for (const key in props) {
      const isValid = validateProperty(type, key, props[key], eventRegistry);
      if (!isValid) {
        unknownProps.push(key);
      }
    }

    const unknownPropString = unknownProps
      .map(prop => '`' + prop + '`')
      .join(', ');
    if (unknownProps.length === 1) {
      console.error(
        'Invalid value for prop %s on <%s> tag. Either remove it from the element, ' +
          'or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior ',
        unknownPropString,
        type,
      );
    } else if (unknownProps.length > 1) {
      console.error(
        'Invalid values for props %s on <%s> tag. Either remove them from the element, ' +
          'or pass a string or number value to keep them in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior ',
        unknownPropString,
        type,
      );
    }
  }
}

/**
 * 校验普通内建元素的 DOM props；自定义元素及带字符串 `is` 的定制内建元素跳过。
 */
export function validateProperties(type, props, eventRegistry) {
  if (isCustomElement(type, props) || typeof props.is === 'string') {
    return;
  }
  warnUnknownProperties(type, props, eventRegistry);
}
