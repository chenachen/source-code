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
 * 空 digest 在其他路径会被当作“未提供”，这里利用该保留值区分主动恢复，同时不占用
 * 用户空间可选择的非空 digest。
 */
export const REACT_RECOVERABLE_DIGEST = '';
