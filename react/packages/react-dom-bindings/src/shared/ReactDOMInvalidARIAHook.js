/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {ATTRIBUTE_NAME_CHAR} from './isAttributeNameSafe';
import validAriaProperties from './validAriaProperties';
import hasOwnProperty from 'shared/hasOwnProperty';

/** 已报告过的 ARIA 属性名，保证每个问题只警告一次。 */
const warnedProperties = {};
/** 匹配带连字符的 aria-* 候选属性。 */
const rARIA = new RegExp('^(aria)-[' + ATTRIBUTE_NAME_CHAR + ']*$');
/** 匹配误用 camelCase 的 ariaXxx 候选属性。 */
const rARIACamel = new RegExp('^(aria)[A-Z][' + ATTRIBUTE_NAME_CHAR + ']*$');

/**
 * 校验单个 ARIA 属性名并在可修正时建议规范小写名称。
 * 返回 false 仅表示应汇总为未知 aria prop；已即时警告的情况返回 true 防止重复消息。
 */
function validateProperty(tagName, name) {
  if (__DEV__) {
    if (hasOwnProperty.call(warnedProperties, name) && warnedProperties[name]) {
      return true;
    }

    if (rARIACamel.test(name)) {
      const ariaName = 'aria-' + name.slice(4).toLowerCase();
      const correctName = validAriaProperties.hasOwnProperty(ariaName)
        ? ariaName
        : null;

      // 若候选 aria-* 未列入已知 DOM 属性，则它是无效 ARIA 属性。
      if (correctName == null) {
        console.error(
          'Invalid ARIA attribute `%s`. ARIA attributes follow the pattern aria-* and must be lowercase.',
          name,
        );
        warnedProperties[name] = true;
        return true;
      }
      // aria-* 必须小写；为大小写错误建议规范名称。
      if (name !== correctName) {
        console.error(
          'Invalid ARIA attribute `%s`. Did you mean `%s`?',
          name,
          correctName,
        );
        warnedProperties[name] = true;
        return true;
      }
    }

    if (rARIA.test(name)) {
      const lowerCasedName = name.toLowerCase();
      const standardName = validAriaProperties.hasOwnProperty(lowerCasedName)
        ? lowerCasedName
        : null;

      // 带连字符但不在标准表中的 aria-* 交给调用方汇总警告。
      if (standardName == null) {
        warnedProperties[name] = true;
        return false;
      }
      // aria-* 必须小写；为混合大小写输入建议标准名称。
      if (name !== standardName) {
        console.error(
          'Unknown ARIA attribute `%s`. Did you mean `%s`?',
          name,
          standardName,
        );
        warnedProperties[name] = true;
        return true;
      }
    }
  }

  return true;
}

/** 遍历元素 props，汇总并报告一个或多个无效 ARIA 属性。 */
export function validateProperties(type, props) {
  if (__DEV__) {
    const invalidProps = [];

    for (const key in props) {
      const isValid = validateProperty(type, key);
      if (!isValid) {
        invalidProps.push(key);
      }
    }

    const unknownPropString = invalidProps
      .map(prop => '`' + prop + '`')
      .join(', ');

    if (invalidProps.length === 1) {
      console.error(
        'Invalid aria prop %s on <%s> tag. ' +
          'For details, see https://react.dev/link/invalid-aria-props',
        unknownPropString,
        type,
      );
    } else if (invalidProps.length > 1) {
      console.error(
        'Invalid aria props %s on <%s> tag. ' +
          'For details, see https://react.dev/link/invalid-aria-props',
        unknownPropString,
        type,
      );
    }
  }
}
