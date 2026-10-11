/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 构造 dangerouslySetInnerHTML 测试使用的 JSX 元素。 */
const React = require('react');

/** 提供空容器并发根，用其提交结果检查原生 innerHTML。 */
const ReactDOMClient = require('react-dom/client');

/** 等待根渲染与提交完成后再读取 DOM，避免把尚未提交误判为属性未写入。 */
const act = require('internal-test-utils').act;

describe('dangerouslySetInnerHTML', () => {
  describe('when the node has innerHTML property', () => {

    /** 创建空并发根并把 __html 设为 <h1>Hello</h1>；act 提交后首个 div 的 innerHTML 必须等于原字符串，验证该 prop 写入原生 HTML 而非转成文本子节点。 */
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
