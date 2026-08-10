/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/*
 * 性能敏感路径使用的 `'' + value` 会在 Symbol、Temporal.* 等类型上抛错，参见
 * https://github.com/facebook/react/pull/22064。
 *
 * 本模块先输出清楚的类型与使用场景，再有意触发同一次 coercion，让调用栈指向 React
 * 的具体入口；这比从 `value` 自身实现内部抛出的晦涩异常更容易定位。
 */

/** 返回不安全字符串 coercion 值的可读运行时类型名。 */
// $FlowFixMe[incompatible-type] only called in DEV, so void return is not possible.
function typeName(value: mixed): string {
  if (__DEV__) {
    // Temporal.Instant 等命名空间类型需要通过 toStringTag 才能保留完整名称。
    const hasToStringTag = typeof Symbol === 'function' && Symbol.toStringTag;
    const type =
      (hasToStringTag && (value as any)[Symbol.toStringTag]) ||
      (value as any).constructor.name ||
      'Object';
    // $FlowFixMe[incompatible-type]
    return type;
  }
}

/** 以真实的 `'' + value` 探测 coercion 是否会抛错。 */
// $FlowFixMe[incompatible-type] only called in DEV, so void return is not possible.
function willCoercionThrow(value: mixed): boolean {
  if (__DEV__) {
    try {
      testStringCoercion(value);
      return false;
    } catch (e) {
      return true;
    }
  }
}

/**
 * 执行生产路径使用的字符串 coercion；失败时把异常抛回调用方以保留排障调用栈。
 */
/** @noinline */
function testStringCoercion(value: mixed) {
  // 如果异常调用栈进入这里，说明传给 React 的 prop、key、DOM attribute、CSS property、
  // string ref 等值是对象或 Symbol，而 React 用 `'' + value` 转为字符串时抛错。
  //
  // 常见触发值是 Symbol 和 Temporal.Instant 等 Temporal 对象；任何会在 `valueOf` 或
  // `[Symbol.toPrimitive]` 中抛错的对象也会触发。库作者常用这种做法阻止内建 `+`、
  // `>=` 等操作符绕过其精确算术或比较 API。
  //
  // 修复方式是在传给 React 前显式转成字符串，通常应使用 `String(value)`。
  //
  // 要找出具体值，请检查浏览器或调试器 console。本异常前的 `console.error` 会列出
  // Symbol、Temporal.PlainDate 等类型及它被用作 key、attribute、input value prop 等
  // 场景，通常还会附带出错组件及 ancestor stack。
  //
  // eslint-disable-next-line react-internal/safe-string-coercion
  return '' + (value as any);
}

/** 校验 DOM attribute 值能否使用生产路径的字符串 coercion。 */
export function checkAttributeStringCoercion(
  value: mixed,
  attributeName: string,
): void | string {
  if (__DEV__) {
    if (willCoercionThrow(value)) {
      console.error(
        'The provided `%s` attribute is an unsupported type %s.' +
          ' This value must be coerced to a string before using it here.',
        attributeName,
        typeName(value),
      );
      return testStringCoercion(value); // 有意抛错，让调用方从栈回溯到上面的排障说明。
    }
  }
}

/** 校验元素 key 能否安全转为内部字符串 key。 */
export function checkKeyStringCoercion(value: mixed): void | string {
  if (__DEV__) {
    if (willCoercionThrow(value)) {
      console.error(
        'The provided key is an unsupported type %s.' +
          ' This value must be coerced to a string before using it here.',
        typeName(value),
      );
      return testStringCoercion(value); // 有意抛错，让调用方定位错误 key 的来源。
    }
  }
}

/** 校验普通 React prop 值能否安全转为字符串。 */
export function checkPropStringCoercion(
  value: mixed,
  propName: string,
): void | string {
  if (__DEV__) {
    if (willCoercionThrow(value)) {
      console.error(
        'The provided `%s` prop is an unsupported type %s.' +
          ' This value must be coerced to a string before using it here.',
        propName,
        typeName(value),
      );
      return testStringCoercion(value); // 有意抛错，让调用方定位错误 prop 的来源。
    }
  }
}

/** 校验 `<option>` 等选项值能否安全转为字符串。 */
export function checkOptionStringCoercion(
  value: mixed,
  propName: string,
): void | string {
  if (__DEV__) {
    if (willCoercionThrow(value)) {
      console.error(
        'The provided `%s` option is an unsupported type %s.' +
          ' This value must be coerced to a string before using it here.',
        propName,
        typeName(value),
      );
      return testStringCoercion(value); // 有意抛错，让调用方定位错误 option 的来源。
    }
  }
}

/** 校验 CSS property 值能否使用生产路径的字符串 coercion。 */
export function checkCSSPropertyStringCoercion(
  value: mixed,
  propName: string,
): void | string {
  if (__DEV__) {
    if (willCoercionThrow(value)) {
      console.error(
        'The provided `%s` CSS property is an unsupported type %s.' +
          ' This value must be coerced to a string before using it here.',
        propName,
        typeName(value),
      );
      return testStringCoercion(value); // 有意抛错，让调用方定位错误 CSS 值的来源。
    }
  }
}

/** 校验注入 HTML markup 的值能否安全转为字符串。 */
export function checkHtmlStringCoercion(value: mixed): void | string {
  if (__DEV__) {
    if (willCoercionThrow(value)) {
      console.error(
        'The provided HTML markup uses a value of unsupported type %s.' +
          ' This value must be coerced to a string before using it here.',
        typeName(value),
      );
      return testStringCoercion(value); // 有意抛错，让调用方定位错误 markup 值。
    }
  }
}

/** 校验表单 value/checked/default 值能否安全转为字符串。 */
export function checkFormFieldValueStringCoercion(value: mixed): void | string {
  if (__DEV__) {
    if (willCoercionThrow(value)) {
      console.error(
        'Form field values (value, checked, defaultValue, or defaultChecked props)' +
          ' must be strings, not %s.' +
          ' This value must be coerced to a string before using it here.',
        typeName(value),
      );
      return testStringCoercion(value); // 有意抛错，让调用方定位错误表单值。
    }
  }
}
