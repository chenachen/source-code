/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import typeof * as ReconcilerAPI from './src/ReactFiberReconciler';
import typeof * as HostConfig from './src/ReactFiberConfig';

export * from './src/ReactFiberReconciler';

// 构建时，本模块会被包装成工厂函数（$$$reconciler）。第三方 renderer 传入 HostConfig
// 对象后获得一套绑定该宿主能力的 reconciler API；源码中的直接重导出服务于 Flow 与仓库构建。
/**
 * 用目标 renderer 的 HostConfig 创建 reconciler API。
 *
 * @remarks 该声明描述构建产物的默认导出；源码模块本身不会在运行时直接执行此函数体。
 */
declare export default (hostConfig: HostConfig) => ReconcilerAPI;
