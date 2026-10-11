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

/**
 * 从公开 class 实例读取 renderer 安装的内部 Fiber 引用。
 *
 * @param key - 用户持有的组件实例，不是 element 的 key，也不是 Map 键字符串。
 * @returns `_reactInternals` 原值；从未关联的实例返回 undefined。
 * @remarks 此引用可能指向 current 的 alternate；判断哪份 Fiber 当前已提交属于调用方。
 */
export function get(key) {
  return key._reactInternals;
}

/**
 * 在公开 class 实例上安装内部 Fiber，让 setState、实例查询等入口能回到 renderer。
 *
 * @param key - 保存映射的公开组件实例，其生命周期决定该字段的可达性。
 * @param value - renderer 提供的 Fiber；此处不验证挂载状态，也不选择 current 分支。
 * @remarks 直接写实例字段，不建立模块级强引用表；清理和卸载判断由 renderer 负责。
 */
export function set(key, value) {
  key._reactInternals = value;
}
