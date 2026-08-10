/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 外部 RSC/Fizz 运行时入口只暴露 DOM 指令集适配；不包含 `react-server` 的完整渲染管线。
export * from 'react-dom-bindings/src/server/ReactDOMServerExternalRuntime';
