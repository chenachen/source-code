/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */
'use strict';

describe('ReactSymbols', () => {
  beforeEach(() => jest.resetModules());

  /** 遍历导出键值，发现两个名称共享同一 Symbol 时立即报告冲突。 */
  const expectToBeUnique = keyValuePairs => {
    const map = new Map();
    keyValuePairs.forEach(([key, value]) => {
      if (map.has(value)) {
        throw Error(
          `${key} value ${value.toString()} is the same as ${map.get(value)}.`,
        );
      }
      map.set(value, key);
    });
  };

  /**
   * Given：`shared/ReactSymbols` 当前全部导出。
   * When：按 Symbol 值建立反向 Map。
   * Then：任意两个标记都不能相等。
   *
   * 验证机制：碰撞时错误同时报告新旧导出名，证明 renderer 可用标记唯一分派类型。
   */
  it('Symbol values should be unique', () => {
    expectToBeUnique(Object.entries(require('shared/ReactSymbols')));
  });
});
