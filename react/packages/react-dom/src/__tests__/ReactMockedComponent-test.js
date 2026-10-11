/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;
let act;

let MockedComponent;
let ReactDOMServer;

describe('ReactMockedComponent', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;

    /** 构造待模拟的类组件；其 render 随后改成无返回值的 Jest mock，以覆盖允许 mock 空输出的客户端和 SSR 分支。 */
    MockedComponent = class extends React.Component {

      /** 原实现必抛错；setup 会用 Jest mock 覆盖此槽，测试正常完成即证明没有进入原实现。 */
      render() {
        throw new Error('Should not get here.');
      }
    };
    // 这已经足够接近于 Jest 模拟提供的结果了。
    MockedComponent.prototype.render = jest.fn();
  });

  /** 把类组件 render 替换为返回 undefined 的 Jest mock，再在并发根首次渲染；act 应正常完成，验证 mock 组件允许空返回而不会执行原先必抛错的 render。 */
  it('should allow a mocked component to be rendered', async () => {
    const container = document.createElement('container');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<MockedComponent />);
    });
  });

  /** 首次提交 mock 类组件后在同一根再次渲染同类型；两轮 act 都应完成，验证开发环境更新也允许 Jest render mock 的 undefined 返回。 */
  it('should allow a mocked component to be updated in dev', async () => {
    const container = document.createElement('container');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<MockedComponent />);
    });
    await act(() => {
      root.render(<MockedComponent />);
    });
  });

  /** 对 render 已被 Jest mock 替换的类组件执行 renderToString；调用应正常返回，验证 SSR 接受 mock 的空结果，与客户端路径一致。 */
  it('should allow a mocked component to be rendered in dev (SSR)', () => {
    ReactDOMServer.renderToString(<MockedComponent />);
  });
});
