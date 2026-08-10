/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 单个 Hook effect 在组件环形 effect 链表中的阶段与执行位。 */
export type HookFlags = number;

/** 该 effect 当前不属于任何阶段，也无需在本次 commit 执行。 */
export const NoFlags = /*   */ 0b0000;

/** 标记依赖已变化，本次对应 commit 阶段需要执行 effect 或 cleanup。 */
export const HasEffect = /* */ 0b0001;

// 以下位描述 effect 创建函数执行的阶段；cleanup 会在该阶段对应的卸载路径运行。
/** useInsertionEffect 所属阶段，早于 layout 读取，用于样式注入等操作。 */
export const Insertion = /* */ 0b0010;
/** useLayoutEffect 所属阶段，在 DOM mutation 后、浏览器绘制前同步执行。 */
export const Layout = /*    */ 0b0100;
/** useEffect 所属被动阶段，在 commit 主体之后异步 flush。 */
export const Passive = /*   */ 0b1000;
