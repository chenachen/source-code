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

/** 服务端自动 JSX 运行时的单子节点入口；开发构建保留校验与 owner 栈。 */
const jsx: any = __DEV__
  ? jsxProdSignatureRunningInDevWithDynamicChildren
  : jsxProd;
/**
 * 服务端自动 JSX 运行时的静态多子节点入口。开发构建使用静态校验路径；生产构建暂与
 * `jsx` 共用实现，未来可利用静态 children 做专门优化。
 */
const jsxs: any = __DEV__
  ? jsxProdSignatureRunningInDevWithStaticChildren
  : jsxProd;

/** 仅服务端开发构建提供的 JSX 编译器入口。 */
const jsxDEV: any = __DEV__ ? _jsxDEV : undefined;

export {REACT_FRAGMENT_TYPE as Fragment, jsx, jsxs, jsxDEV};
