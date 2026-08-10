/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ReactInstanceMap` 在公开有状态实例与内部 Fiber 表示之间建立映射，让公共方法接收
 * 用户持有的实例后能回到内部实现。
 *
 * 当前映射直接存放在实例的 `_reactInternals` 字段，因此模块本身无状态并可跨 renderer
 * 共享；改成真实全局 Map 会破坏该假设与生命周期所有权。
 */

/** 从公开 class 实例读取其当前内部 Fiber。 */
export function get(key) {
  return key._reactInternals;
}

/** 在公开 class 实例上安装或更新内部 Fiber 引用。 */
export function set(key, value) {
  key._reactInternals = value;
}
