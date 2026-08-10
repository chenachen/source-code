/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import {REACT_FRAGMENT_TYPE} from 'shared/ReactSymbols';
import {
  jsxProd,
  jsxProdSignatureRunningInDevWithDynamicChildren,
  jsxProdSignatureRunningInDevWithStaticChildren,
  jsxDEV as _jsxDEV,
} from './ReactJSXElement';

/** 自动 JSX 运行时的单子节点入口；开发构建转发到带校验与 owner 栈的兼容签名。 */
const jsx: any = __DEV__
  ? jsxProdSignatureRunningInDevWithDynamicChildren
  : jsxProd;
/**
 * 自动 JSX 运行时的静态多子节点入口。开发构建用静态标记冻结并逐项校验 children；
 * 生产构建暂与 `jsx` 共用实现，未来可利用静态结构做专门优化。
 */
const jsxs: any = __DEV__
  ? jsxProdSignatureRunningInDevWithStaticChildren
  : jsxProd;

/** 仅开发构建提供的编译器入口，负责 key 校验和调试栈采集。 */
const jsxDEV: any = __DEV__ ? _jsxDEV : undefined;

export {REACT_FRAGMENT_TYPE as Fragment, jsx, jsxs, jsxDEV};
