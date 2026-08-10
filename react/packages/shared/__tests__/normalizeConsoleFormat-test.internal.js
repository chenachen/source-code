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
  beforeEach(() => {
    normalizeConsoleFormat = require('shared/normalizeConsoleFormat').default;
  });

  /** Given 空 format 和三个参数，When 归一化，Then 按值类型补 `%o %o %s`。 */
  it('normalize empty string', async () => {
    expect(normalizeConsoleFormat('', [1, {}, 'foo'], 0)).toMatchInlineSnapshot(
      `"%o %o %s"`,
    );
  });

  /** Given 一个占位符但三个参数，When 归一化，Then 为剩余对象和字符串补占位符。 */
  it('normalize extra args', async () => {
    expect(
      normalizeConsoleFormat('%f', [1, {}, 'foo'], 0),
    ).toMatchInlineSnapshot(`"%f %o %s"`);
  });

  /** Given 占位符多于参数，When 归一化，Then 无参数的 `%f` 被转义为字面量。 */
  it('normalize fewer than args', async () => {
    expect(
      normalizeConsoleFormat('%s %O %o %f', [1, {}, 'foo'], 0),
    ).toMatchInlineSnapshot(`"%s %O %o %%f"`);
  });

  /** Given 非法 `%l` 与已有 `%%`，When 扫描，Then 仅消费支持的 specifier。 */
  it('normalize escape sequences', async () => {
    expect(
      normalizeConsoleFormat('hel%lo %s %%s world', [1, 'foo'], 0),
    ).toMatchInlineSnapshot(`"hel%lo %s %%s world %s"`);
  });

  /** Given format 以孤立 `%` 结尾，When 归一化，Then 末尾转义与参数补位互不干扰。 */
  it('normalize ending with escape', async () => {
    expect(
      normalizeConsoleFormat('hello %s world %', [1, {}, 'foo'], 0),
    ).toMatchInlineSnapshot(`"hello %s world % %o %s"`);
    expect(
      normalizeConsoleFormat('hello %s world %', [], 0),
    ).toMatchInlineSnapshot(`"hello %%s world %"`);
  });
});
