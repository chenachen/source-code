/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let normalizeConsoleFormat;

describe('normalizeConsoleFormat', () => {
  // 从 shared 入口取得本次构建的 formatter；每例仅比较返回文本，无控制台副作用。
  beforeEach(() => {
    normalizeConsoleFormat = require('shared/normalizeConsoleFormat').default;
  });

  /** 空 format 配三个参数时调用归一化，快照要求 `%o %o %s`，验证无格式文本也保留全部参数。 */
  it('normalize empty string', async () => {
    expect(normalizeConsoleFormat('', [1, {}, 'foo'], 0)).toMatchInlineSnapshot(
      `"%o %o %s"`,
    );
  });

  /** `%f` 配数字、对象、字符串时归一化，保留已有占位并补 `%o %s`，验证多余参数按类型追加。 */
  it('normalize extra args', async () => {
    expect(
      normalizeConsoleFormat('%f', [1, {}, 'foo'], 0),
    ).toMatchInlineSnapshot(`"%f %o %s"`);
  });

  /** 四个占位符配三个参数时归一化，末尾 `%f` 变为 `%%f`，验证缺失参数不会误消费后续日志内容。 */
  it('normalize fewer than args', async () => {
    expect(
      normalizeConsoleFormat('%s %O %o %f', [1, {}, 'foo'], 0),
    ).toMatchInlineSnapshot(`"%s %O %o %%f"`);
  });

  /** 输入非法 `%l` 和已有 `%%` 后扫描，仅 `%s` 消费参数且末尾补 `%s`，验证转义与非法符号保持原样。 */
  it('normalize escape sequences', async () => {
    expect(
      normalizeConsoleFormat('hel%lo %s %%s world', [1, 'foo'], 0),
    ).toMatchInlineSnapshot(`"hel%lo %s %%s world %s"`);
  });

  /** format 以孤立 `%` 结尾，分别带三个与零个参数归一化；快照要求保留尾字符并正确补位/转义，覆盖扫描终止边界。 */
  it('normalize ending with escape', async () => {
    expect(
      normalizeConsoleFormat('hello %s world %', [1, {}, 'foo'], 0),
    ).toMatchInlineSnapshot(`"hello %s world % %o %s"`);
    expect(
      normalizeConsoleFormat('hello %s world %', [], 0),
    ).toMatchInlineSnapshot(`"hello %%s world %"`);
  });
});
