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
/** 仅 build/stable/非 WWW 条件成立时 require React 与 package.json，断言公开版本与包版本相同；其余配置测试体跳过断言，验证稳定构建元数据一致性。 */
test('ReactVersion matches package.json', () => {
  if (gate(flags => flags.build && flags.stable && !flags.www)) {
    const React = require('react');
    const packageJSON = require('react/package.json');
    expect(React.version).toBe(packageJSON.version);
  }
});
