/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** WAI-ARIA 允许的属性名查找表；值仅作集合占位，键决定合法性。 */
const ariaProperties = {
  'aria-current': 0, // 状态属性。
  'aria-description': 0,
  'aria-details': 0,
  'aria-disabled': 0, // 状态属性。
  'aria-hidden': 0, // 状态属性。
  'aria-invalid': 0, // 状态属性。
  'aria-keyshortcuts': 0,
  'aria-label': 0,
  'aria-roledescription': 0,
  // Widget 属性。
  'aria-autocomplete': 0,
  'aria-checked': 0,
  'aria-expanded': 0,
  'aria-haspopup': 0,
  'aria-level': 0,
  'aria-modal': 0,
  'aria-multiline': 0,
  'aria-multiselectable': 0,
  'aria-orientation': 0,
  'aria-placeholder': 0,
  'aria-pressed': 0,
  'aria-readonly': 0,
  'aria-required': 0,
  'aria-selected': 0,
  'aria-sort': 0,
  'aria-valuemax': 0,
  'aria-valuemin': 0,
  'aria-valuenow': 0,
  'aria-valuetext': 0,
  // 实时区域属性。
  'aria-atomic': 0,
  'aria-busy': 0,
  'aria-live': 0,
  'aria-relevant': 0,
  // 拖放属性。
  'aria-dropeffect': 0,
  'aria-grabbed': 0,
  // 关系属性。
  'aria-activedescendant': 0,
  'aria-colcount': 0,
  'aria-colindex': 0,
  'aria-colspan': 0,
  'aria-controls': 0,
  'aria-describedby': 0,
  'aria-errormessage': 0,
  'aria-flowto': 0,
  'aria-labelledby': 0,
  'aria-owns': 0,
  'aria-posinset': 0,
  'aria-rowcount': 0,
  'aria-rowindex': 0,
  'aria-rowspan': 0,
  'aria-setsize': 0,
  // ARIA 1.3 属性。
  'aria-braillelabel': 0,
  'aria-brailleroledescription': 0,
  'aria-colindextext': 0,
  'aria-rowindextext': 0,
};

export default ariaProperties;
