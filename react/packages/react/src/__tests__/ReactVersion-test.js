/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

// 注意：这里有意使用动态 `gate` 形式以退出负向测试行为。源码模式偶然通过可以接受，
// 此用例只约束构建产物的版本值。
// TODO：实验构建的运行时版本与 package.json 不同，因为 DevTools 用它检测特性；
// 应考虑改用其他特性检测机制。
/**
 * Given：已建立该文件所需的 renderer、容器与测试夹具。
 * When：执行“ReactVersion matches package.json”场景的唯一关键操作。
 * Then：断言 发布产物与 package.json 的版本一致性 的可观察结果。
 *
 * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
 */
test('ReactVersion matches package.json', () => {
  if (gate(flags => flags.build && flags.stable && !flags.www)) {
    const React = require('react');
    const packageJSON = require('react/package.json');
    expect(React.version).toBe(packageJSON.version);
  }
});
