/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

// 此 fork 只向 eslint-plugin-react-hooks 提供 WWW 专用值，避免载入完整的
// ReactFeatureFlags.www.js。完整 fork 会通过 require('ReactFeatureFlags')
// 引入动态开关，但该 WWW Haste 模块不存在于 ESLint 插件运行的 Node.js 环境。
//
// ESLint 插件只需要 eprh_* 开关。

/** 是否让 Hooks 插件检查 useKeyedState 的编译器规则；true 执行该检查，false 跳过该检查；WWW Hooks 规则 fork 固定为 true：启用该行为。 */
export const eprh_enableUseKeyedStateCompilerLint: boolean = true;
/** 是否让 set-state-in-effect 编译器规则输出详细诊断；true 执行该检查，false 跳过该检查；WWW Hooks 规则 fork 固定为 true：启用该行为。 */
export const eprh_enableVerboseNoSetStateInEffectCompilerLint: boolean = true;
/** 选择 exhaustive-deps 编译器 lint 的报告范围；WWW Hooks 规则 fork 固定为 'extra-only'；'off' 不报告，'all' 报告全部，'extra-only' 只报多余依赖，'missing-only' 只报缺失依赖。 */
export const eprh_enableExhaustiveEffectDependenciesCompilerLint:
  | 'off'
  | 'all'
  | 'extra-only'
  | 'missing-only' = 'extra-only';
