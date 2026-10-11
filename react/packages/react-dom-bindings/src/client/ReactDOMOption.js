/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {Children} from 'react';

let didWarnSelectedSetOnOption = false;
let didWarnInvalidChild = false;
let didWarnInvalidInnerHTML = false;

/**
 * 实现了一个 <option> 主机组件，当设置 `selected` 时发出警告。
 */

/** 开发期检查无 value 的 option 子内容能否推导字符串值，并警告显式 selected。 */
export function validateOptionProps(element: Element, props: Object) {
  if (__DEV__) {
    //如果没有提供值，那么子项必须是简单的。
    if (props.value == null) {
      if (typeof props.children === 'object' && props.children !== null) {
        Children.forEach(props.children, function (child) {
          if (child == null) {
            return;
          }
          if (
            typeof child === 'string' ||
            typeof child === 'number' ||
            typeof child === 'bigint'
          ) {
            return;
          }
          if (!didWarnInvalidChild) {
            didWarnInvalidChild = true;
            console.error(
              'Cannot infer the option value of complex children. ' +
                'Pass a `value` prop or use a plain string as children to <option>.',
            );
          }
        });
      } else if (props.dangerouslySetInnerHTML != null) {
        if (!didWarnInvalidInnerHTML) {
          didWarnInvalidInnerHTML = true;
          console.error(
            'Pass a `value` prop if you set dangerouslyInnerHTML so React knows ' +
              'which value should be selected.',
          );
        }
      }
    }

    //待办：在 <option> 中移除对 `selected` 的支持。
    if (props.selected != null && !didWarnSelectedSetOnOption) {
      console.error(
        'Use the `defaultValue` or `value` props on <select> instead of ' +
          'setting `selected` on <option>.',
      );
      didWarnSelectedSetOnOption = true;
    }
  }
}
