/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** Fiber 继承的运行模式位集合；子 Fiber 创建时从父级合并传播。 */
export type TypeOfMode = number;

/** 不启用任何额外运行模式。 */
export const NoMode = /*                         */ 0b0000000;
// TODO：改为直接读取 root tag 后移除此冗余位。
/** 该 Fiber 位于可并发工作的根中。 */
export const ConcurrentMode = /*                 */ 0b0000001;
/** 该 Fiber 子树需要收集 Profiler render/commit 计时。 */
export const ProfileMode = /*                    */ 0b0000010;
// export const DebugTracingMode = /*            */ 0b0000100; // 已移除，保留空位避免误复用历史编码。
/** 启用 StrictMode 的旧生命周期与 render 纯度检查。 */
export const StrictLegacyMode = /*               */ 0b0001000;
/** 开发构建中对 effects 执行额外的卸载/重挂检查。 */
export const StrictEffectsMode = /*              */ 0b0010000;
// 追踪当前是否位于允许 suspensey image 的子树。
// TODO：enableSuspenseyImages 全量开启后移除此条件模式位。
/** 标记图片加载可参与 commit 挂起的子树。 */
export const SuspenseyImagesMode = /*            */ 0b0100000;
