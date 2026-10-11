/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 表示“有意切换到客户端渲染”的保留 digest。
 *
 * @remarks
 * Fizz 用空串标记主动交给客户端继续渲染的边界；hydrate 时仍转向客户端，但不为此
 * 生成普通服务端失败的 recoverable error。未提供 digest 的 null/undefined 不等于此标记。
 */
export const REACT_RECOVERABLE_DIGEST = '';
