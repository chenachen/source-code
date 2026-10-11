/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactDebugInfo} from './ReactTypes';

/**
 * ReactElement 的跨包内部记录形状。
 *
 * @remarks
 * `react` 负责创建记录，reconciler 读取身份、类型与 props；开发字段只服务校验、
 * owner stack 和调试信息，不属于公开元素 API。
 */
export type ReactElement = {
  /** 区分 ReactElement 与普通对象的全局标记。 */
  $$typeof: any,
  /** intrinsic 标签、组件函数或 React 特殊类型描述对象。 */
  type: any,
  /** 同级 children 间维持身份的规范化 key。 */
  key: any,
  /** 兼容元素字段；React19 的权威输入是 props.ref，DEV 对非空 element.ref 的读取会发迁移诊断，生产保留兼容数据字段。 */
  ref: any,
  /** 传给组件或宿主节点的属性快照。 */
  props: any,
  /** 创建元素的 owner，供开发期归属诊断与旧元素形状兼容检查使用。 */
  _owner: any,

  /** 开发期可变校验容器；元素本体冻结后仍允许更新校验状态。 */
  _store: {
    /** `0` 未校验，`1` 已校验，`2` 表示服务端发现缺失 key，需在客户端补发警告。 */
    validated: 0 | 1 | 2,
    ...
  },
  /** 与 Server Component/异步诊断关联的开发信息。 */
  _debugInfo: null | ReactDebugInfo,
  /** 创建元素时捕获的开发期调用栈。 */
  _debugStack: Error,
  /** 创建元素时关联的 console task，用于恢复异步 owner 上下文。 */
  _debugTask: null | ConsoleTask,
};
