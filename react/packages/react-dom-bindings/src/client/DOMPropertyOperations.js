/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import isAttributeNameSafe from '../shared/isAttributeNameSafe';
import {enableTrustedTypesIntegration} from 'shared/ReactFeatureFlags';
import {checkAttributeStringCoercion} from 'shared/CheckStringCoercion';
import {getFiberCurrentPropsFromNode} from './ReactDOMComponentTree';
import {trackHostMutation} from 'react-reconciler/src/ReactFiberMutationTracking';

/**
 * 获取节点上某个属性的值。仅在开发环境中用于 SSR 验证。第三个参数用作预期值的提示。一些属性有多个等效值。
 */
export function getValueForAttribute(
  node: Element,
  name: string,
  expected: mixed,
): mixed {
  if (__DEV__) {
    if (!isAttributeNameSafe(name)) {
      return;
    }
    if (!node.hasAttribute(name)) {
      //应该移除属性
      switch (typeof expected) {
        case 'function':
        case 'symbol':
          return expected;
        case 'boolean': {
          const prefix = name.toLowerCase().slice(0, 5);
          if (prefix !== 'data-' && prefix !== 'aria-') {
            return expected;
          }
        }
      }
      return expected === undefined ? undefined : null;
    }
    //启用 CSP 时，浏览器会隐藏 nonce 属性
    //所以我们需要直接访问 nonce 属性
    //https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cryptographicnonce
    const isNonce = name.toLowerCase() === 'nonce';
    const value = isNonce ? (node as any).nonce : node.getAttribute(name);
    if (__DEV__) {
      checkAttributeStringCoercion(expected, name);
    }
    if (value === '' + (expected as any)) {
      return expected;
    }
    return value;
  }
}

/** `getValueForAttributeOnCustomComponent` 查询所需宿主值；无匹配时走显式回退；用于安全读取、写入和移除 DOM 属性及自定义组件属性。 */
export function getValueForAttributeOnCustomComponent(
  node: Element,
  name: string,
  expected: mixed,
): mixed {
  if (__DEV__) {
    if (!isAttributeNameSafe(name)) {
      return;
    }
    if (!node.hasAttribute(name)) {
      //应该移除属性
      switch (typeof expected) {
        case 'symbol':
        case 'object':
          //符号和对象在被发射时会被忽略，所以
          //预期他们最终不会有某个属性。
          return expected;
        case 'function':
          return expected;
        case 'boolean':
          if (expected === false) {
            return expected;
          }
      }
      return expected === undefined ? undefined : null;
    }
    //启用 CSP 时，浏览器会隐藏 nonce 属性
    //所以我们需要直接访问 nonce 属性
    //https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cryptographicnonce
    const isNonce = name.toLowerCase() === 'nonce';
    const value = isNonce ? (node as any).nonce : node.getAttribute(name);

    if (value === '' && expected === true) {
      return true;
    }

    if (__DEV__) {
      checkAttributeStringCoercion(expected, name);
    }
    if (value === '' + (expected as any)) {
      return expected;
    }
    return value;
  }
}

/** `setValueForAttribute` 更新关联或宿主状态，使后续读取看到一致快照；用于安全读取、写入和移除 DOM 属性及自定义组件属性。 */
export function setValueForAttribute(
  node: Element,
  name: string,
  value: mixed,
) {
  if (isAttributeNameSafe(name)) {
    //如果属性不在特殊列表中，则将其视为普通属性。
    //应该移除属性
    if (value === null) {
      node.removeAttribute(name);
      return;
    }
    switch (typeof value) {
      case 'undefined':
      case 'function':
      case 'symbol':
        node.removeAttribute(name);
        return;
      case 'boolean': {
        const prefix = name.toLowerCase().slice(0, 5);
        if (prefix !== 'data-' && prefix !== 'aria-') {
          node.removeAttribute(name);
          return;
        }
      }
    }
    if (__DEV__) {
      checkAttributeStringCoercion(value, name);
    }
    node.setAttribute(
      name,
      enableTrustedTypesIntegration ? (value as any) : '' + (value as any),
    );
  }
}

/** `setValueForKnownAttribute` 更新关联或宿主状态，使后续读取看到一致快照；用于安全读取、写入和移除 DOM 属性及自定义组件属性。 */
export function setValueForKnownAttribute(
  node: Element,
  name: string,
  value: mixed,
) {
  if (value === null) {
    node.removeAttribute(name);
    return;
  }
  switch (typeof value) {
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'boolean': {
      node.removeAttribute(name);
      return;
    }
  }
  if (__DEV__) {
    checkAttributeStringCoercion(value, name);
  }
  node.setAttribute(
    name,
    enableTrustedTypesIntegration ? (value as any) : '' + (value as any),
  );
}

/** `setValueForNamespacedAttribute` 更新关联或宿主状态，使后续读取看到一致快照；用于安全读取、写入和移除 DOM 属性及自定义组件属性。 */
export function setValueForNamespacedAttribute(
  node: Element,
  namespace: string,
  name: string,
  value: mixed,
) {
  if (value === null) {
    node.removeAttribute(name);
    return;
  }
  switch (typeof value) {
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'boolean': {
      node.removeAttribute(name);
      return;
    }
  }
  if (__DEV__) {
    checkAttributeStringCoercion(value, name);
  }
  node.setAttributeNS(
    namespace,
    name,
    enableTrustedTypesIntegration ? (value as any) : '' + (value as any),
  );
}

/** `setValueForPropertyOnCustomComponent` 更新关联或宿主状态，使后续读取看到一致快照；用于安全读取、写入和移除 DOM 属性及自定义组件属性。 */
export function setValueForPropertyOnCustomComponent(
  node: Element,
  name: string,
  value: mixed,
) {
  if (name[0] === 'o' && name[1] === 'n') {
    const useCapture = name.endsWith('Capture');
    const eventName = name.slice(2, useCapture ? name.length - 7 : undefined);

    const prevProps = getFiberCurrentPropsFromNode(node);
    // $FlowFixMe[invalid-computed-prop]
    const prevValue = prevProps != null ? prevProps[name] : null;
    if (typeof prevValue === 'function') {
      node.removeEventListener(eventName, prevValue, useCapture);
    }
    if (typeof value === 'function') {
      if (typeof prevValue !== 'function' && prevValue !== null) {
        //如果我们之前将一个非函数类型分配给这个节点，那么
        //在切换到事件监听模式时将其移除。
        if (name in (node as any)) {
          (node as any)[name] = null;
        } else if (node.hasAttribute(name)) {
          node.removeAttribute(name);
        }
      }
      // $FlowFixMe[incompatible-type] value can't be casted to EventListener.
      node.addEventListener(eventName, value as EventListener, useCapture);
      return;
    }
  }

  trackHostMutation();

  if (name in (node as any)) {
    (node as any)[name] = value;
    return;
  }

  if (value === true) {
    node.setAttribute(name, '');
    return;
  }

  //从这里开始，它和任何属性一样
  setValueForAttribute(node, name, value);
}
