/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 */

import {REACT_FORWARD_REF_TYPE, REACT_MEMO_TYPE} from 'shared/ReactSymbols';

/**
 * 把 `(props, ref)` render 函数封装为 reconciler 可识别的 forward-ref 类型。
 *
 * @remarks 此处验证形状并维护调试名称；ref 的解析与提交由 renderer 完成。
 * @param render - 接收组件 props 与 renderer 转交 ref 的渲染函数，此处只保存而不调用。
 * @returns 带 REACT_FORWARD_REF_TYPE 和 render 的新描述对象，不是已创建的 element。
 * @remarks DEV 校验只 console.error，不拒绝构造或修正入参；无效 render 留给后续使用
 * 路径处理。生产跳过这些诊断。DEV displayName setter 会改写匿名 render 的 name 与
 * displayName，已命名 render 保持原名；它不改变 ref 的 attach/cleanup 生命周期。
 */
export function forwardRef<Props, ElementType: React$ElementType>(
  render: (
    props: Props,
    ref: React$RefSetter<React$ElementRef<ElementType>>,
  ) => React$Node,
) {
  if (__DEV__) {
    if (render != null && render.$$typeof === REACT_MEMO_TYPE) {
      console.error(
        'forwardRef requires a render function but received a `memo` ' +
          'component. Instead of forwardRef(memo(...)), use ' +
          'memo(forwardRef(...)).',
      );
    } else if (typeof render !== 'function') {
      console.error(
        'forwardRef requires a render function but was given %s.',
        render === null ? 'null' : typeof render,
      );
    } else {
      if (render.length !== 0 && render.length !== 2) {
        console.error(
          'forwardRef render functions accept exactly two parameters: props and ref. %s',
          render.length === 1
            ? 'Did you forget to use the ref parameter?'
            : 'Any additional parameter will be undefined.',
        );
      }
    }

    if (render != null) {
      if (render.defaultProps != null) {
        console.error(
          'forwardRef render functions do not support defaultProps. ' +
            'Did you accidentally pass a React component?',
        );
      }
    }
  }

  const elementType = {
    $$typeof: REACT_FORWARD_REF_TYPE,
    render,
  };
  if (__DEV__) {
    let ownName;
    Object.defineProperty(elementType, 'displayName', {
      enumerable: false,
      configurable: true,
      /** 返回包装类型自身的调试名称。 */
      get: function () {
        return ownName;
      },
      /** 设置包装名称，并仅在 render 匿名时同步名称以改善组件栈。 */
      set: function (name) {
        ownName = name;

        // 通常不应让内部 render 继承名称，因为它还可能在别处复用；匿名函数则往往只服务
        // 于当前包装，同步名称能让组件栈显示有效帧。典型写法是：
        //   React.forwardRef((props, ref) => {...});
        // 这类匿名内部函数通常不会复用，因此该命名副作用可接受。
        if (!render.name && !render.displayName) {
          Object.defineProperty(render, 'name', {
            value: name,
          });
          render.displayName = name;
        }
      },
    });
  }
  return elementType;
}
