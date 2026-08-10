/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 */

import {REACT_MEMO_TYPE} from 'shared/ReactSymbols';

/**
 * 创建带可选 props 比较器的 memo 组件类型描述。
 *
 * @remarks 是否跳过渲染由 reconciler 决定；此处只封装类型、比较器和 DEV 名称。
 */
export function memo<Props>(
  type: React$ElementType,
  compare?: (oldProps: Props, newProps: Props) => boolean,
) {
  if (__DEV__) {
    if (type == null) {
      console.error(
        'memo: The first argument must be a component. Instead ' +
          'received: %s',
        type === null ? 'null' : typeof type,
      );
    }
  }
  const elementType = {
    $$typeof: REACT_MEMO_TYPE,
    type,
    compare: compare === undefined ? null : compare,
  };
  if (__DEV__) {
    let ownName;
    Object.defineProperty(elementType, 'displayName', {
      enumerable: false,
      configurable: true,
      /** 返回只存于包装类型上的调试名称。 */
      get: function () {
        return ownName;
      },
      /** 设置包装名称，并在内部组件匿名时同步名称以改善组件栈。 */
      set: function (name) {
        ownName = name;

        // 通常不应让内部组件继承名称，因为它还可能在别处复用；但匿名函数往往只服务于
        // 当前包装，让它继承名称能使组件栈显示有效帧。典型写法是：
        //   React.memo((props) => {...});
        // 这类匿名内部函数通常不会复用，因此该命名副作用可接受。
        if (!type.name && !type.displayName) {
          Object.defineProperty(type, 'name', {
            value: name,
          });
          type.displayName = name;
        }
      },
    });
  }
  return elementType;
}
