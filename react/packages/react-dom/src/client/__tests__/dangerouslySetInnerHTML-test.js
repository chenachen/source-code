/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `React`：保存当前测试场景复用的夹具、状态或回调。 */
const React = require('react');
/** `ReactDOMClient`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMClient = require('react-dom/client');

/** `act`：保存当前测试场景复用的夹具、状态或回调。 */
const act = require('internal-test-utils').act;

describe('dangerouslySetInnerHTML', () => {
  describe('when the node has innerHTML property', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「sets innerHTML on it」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 DOM host 属性写入与提交路径。
     */
    it('sets innerHTML on it', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div dangerouslySetInnerHTML={{__html: '<h1>Hello</h1>'}} />,
        );
      });
      expect(container.firstChild.innerHTML).toBe('<h1>Hello</h1>');
    });
  });
});
