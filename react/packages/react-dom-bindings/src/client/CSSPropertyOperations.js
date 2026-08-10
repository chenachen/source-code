/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {shorthandToLonghand} from './CSSShorthandProperty';

import hyphenateStyleName from '../shared/hyphenateStyleName';
import warnValidStyle from '../shared/warnValidStyle';
import isUnitlessNumber from '../shared/isUnitlessNumber';
import {checkCSSPropertyStringCoercion} from 'shared/CheckStringCoercion';
import {trackHostMutation} from 'react-reconciler/src/ReactFiberMutationTracking';

/**
 * 处理 CSS 属性的宿主操作。
 */

/**
 * 创建与服务端渲染生成的 `style` attribute 等价的字符串。
 *
 * WHY：此路径会绕过警告和安全检查，因此结果只能用于开发期 SSR
 * 一致性比较，禁止作为可写入 DOM 的已验证样式值。
 */
export function createDangerousStringForStyles(styles) {
  if (__DEV__) {
    let serialized = '';
    let delimiter = '';
    for (const styleName in styles) {
      if (!styles.hasOwnProperty(styleName)) {
        continue;
      }
      const value = styles[styleName];
      if (value != null && typeof value !== 'boolean' && value !== '') {
        const isCustomProperty = styleName.indexOf('--') === 0;
        if (isCustomProperty) {
          if (__DEV__) {
            checkCSSPropertyStringCoercion(value, styleName);
          }
          serialized += delimiter + styleName + ':' + ('' + value).trim();
        } else {
          if (
            typeof value === 'number' &&
            value !== 0 &&
            !isUnitlessNumber(styleName)
          ) {
            serialized +=
              delimiter + hyphenateStyleName(styleName) + ':' + value + 'px';
          } else {
            if (__DEV__) {
              checkCSSPropertyStringCoercion(value, styleName);
            }
            serialized +=
              delimiter +
              hyphenateStyleName(styleName) +
              ':' +
              ('' + value).trim();
          }
        }
        delimiter = ';';
      }
    }
    return serialized || null;
  }
}

/** `setValueForStyle` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于把 React style 对象序列化并同步到 DOMStyleDeclaration。 */
function setValueForStyle(style, styleName, value) {
  const isCustomProperty = styleName.indexOf('--') === 0;
  if (__DEV__) {
    if (!isCustomProperty) {
      warnValidStyle(styleName, value);
    }
  }

  if (value == null || typeof value === 'boolean' || value === '') {
    if (isCustomProperty) {
      style.setProperty(styleName, '');
    } else if (styleName === 'float') {
      style.cssFloat = '';
    } else {
      style[styleName] = '';
    }
  } else if (isCustomProperty) {
    style.setProperty(styleName, value);
  } else if (
    typeof value === 'number' &&
    value !== 0 &&
    !isUnitlessNumber(styleName)
  ) {
    style[styleName] = value + 'px'; // 非零且需要单位的数字默认补 `px`。
  } else {
    if (styleName === 'float') {
      style.cssFloat = value;
    } else {
      if (__DEV__) {
        checkCSSPropertyStringCoercion(value, styleName);
      }
      style[styleName] = ('' + value).trim();
    }
  }
}

/**
 * 把一组样式同步到节点；值为 `''` 时移除对应样式属性。
 *
 * @param {DOMElement} node
 * @param {object} styles
 */
export function setValueForStyles(node, styles, prevStyles) {
  if (styles != null && typeof styles !== 'object') {
    throw new Error(
      'The `style` prop expects a mapping from style properties to values, ' +
        "not a string. For example, style={{marginRight: spacing + 'em'}} when " +
        'using JSX.',
    );
  }
  if (__DEV__) {
    if (styles) {
      // 冻结下一份样式对象，使后续 diff 可以依赖其不可变性；
      // 对原地修改样式对象的情况，历史路径已经负责告警。
      Object.freeze(styles);
    }
  }

  const style = node.style;

  if (prevStyles != null) {
    if (__DEV__) {
      validateShorthandPropertyCollisionInDev(prevStyles, styles);
    }

    for (const styleName in prevStyles) {
      if (
        prevStyles.hasOwnProperty(styleName) &&
        (styles == null || !styles.hasOwnProperty(styleName))
      ) {
        // 清除新 props 中已经不存在的样式。
        const isCustomProperty = styleName.indexOf('--') === 0;
        if (isCustomProperty) {
          style.setProperty(styleName, '');
        } else if (styleName === 'float') {
          style.cssFloat = '';
        } else {
          style[styleName] = '';
        }
        trackHostMutation();
      }
    }
    for (const styleName in styles) {
      const value = styles[styleName];
      if (styles.hasOwnProperty(styleName) && prevStyles[styleName] !== value) {
        setValueForStyle(style, styleName, value);
        trackHostMutation();
      }
    }
  } else {
    for (const styleName in styles) {
      if (styles.hasOwnProperty(styleName)) {
        const value = styles[styleName];
        setValueForStyle(style, styleName, value);
      }
    }
  }
}

/** `isValueEmpty` 判断适用条件并返回布尔结果，不写入宿主状态；用于把 React style 对象序列化并同步到 DOMStyleDeclaration。 */
function isValueEmpty(value) {
  return value == null || typeof value === 'boolean' || value === '';
}

/**
 * 输入 `{color: 'red', overflow: 'hidden'}` 时返回：
 * `{color: 'color', overflowX: 'overflow', overflowY: 'overflow'}`。
 *
 * 映射值记录每个展开属性源自哪个简写属性，例如 `overflowY`
 * 由 `overflow` 设置；更新冲突检测据此还原来源。
 */
function expandShorthandMap(styles) {
  const expanded = {};
  for (const key in styles) {
    const longhands = shorthandToLonghand[key] || [key];
    for (let i = 0; i < longhands.length; i++) {
      expanded[longhands[i]] = key;
    }
  }
  return expanded;
}

/**
 * 混用简写和展开属性时，如果更新顺序可能产生错误结果则告警。
 * 重点覆盖：
 *
 * 更新简写属性（展开属性会被覆盖）：
 *   {font: 'foo', fontVariant: 'bar'} -> {font: 'baz', fontVariant: 'bar'}
 * 最终执行 `.style.font = 'baz'`
 * 删除简写属性（展开属性也会丢失）：
 *   {font: 'foo', fontVariant: 'bar'} -> {fontVariant: 'bar'}
 * 最终执行 `.style.font = ''`
 * 删除展开属性（本应回退到简写值，但实际不会）：
 *   {font: 'foo', fontVariant: 'bar'} -> {font: 'foo'}
 * 最终执行 `.style.fontVariant = ''`
 */
function validateShorthandPropertyCollisionInDev(prevStyles, nextStyles) {
  if (__DEV__) {
    if (!nextStyles) {
      return;
    }

    // 按实际 DOM 更新路径计算同一份 diff，确保警告对应真实写入顺序。
    const expandedUpdates = {};
    if (prevStyles) {
      for (const key in prevStyles) {
        if (prevStyles.hasOwnProperty(key) && !nextStyles.hasOwnProperty(key)) {
          const longhands = shorthandToLonghand[key] || [key];
          for (let i = 0; i < longhands.length; i++) {
            expandedUpdates[longhands[i]] = key;
          }
        }
      }
    }
    for (const key in nextStyles) {
      if (
        nextStyles.hasOwnProperty(key) &&
        (!prevStyles || prevStyles[key] !== nextStyles[key])
      ) {
        const longhands = shorthandToLonghand[key] || [key];
        for (let i = 0; i < longhands.length; i++) {
          expandedUpdates[longhands[i]] = key;
        }
      }
    }

    const expandedStyles = expandShorthandMap(nextStyles);
    const warnedAbout = {};
    for (const key in expandedUpdates) {
      const originalKey = expandedUpdates[key];
      const correctOriginalKey = expandedStyles[key];
      if (correctOriginalKey && originalKey !== correctOriginalKey) {
        const warningKey = originalKey + ',' + correctOriginalKey;
        if (warnedAbout[warningKey]) {
          continue;
        }
        warnedAbout[warningKey] = true;
        console.error(
          '%s a style property during rerender (%s) when a ' +
            'conflicting property is set (%s) can lead to styling bugs. To ' +
            "avoid this, don't mix shorthand and non-shorthand properties " +
            'for the same value; instead, replace the shorthand with ' +
            'separate values.',
          isValueEmpty(nextStyles[originalKey]) ? 'Removing' : 'Updating',
          originalKey,
          correctOriginalKey,
        );
      }
    }
  }
}
