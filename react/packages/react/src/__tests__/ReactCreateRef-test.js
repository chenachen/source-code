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
let ReactDOM;
let ReactDOMClient;
let assertConsoleErrorDev;

describe('ReactCreateRef', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ({assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should warn in dev if an invalid ref object is provided”场景的唯一关键操作。
   * Then：断言 createRef 的对象形状、可变槽与实例绑定契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should warn in dev if an invalid ref object is provided', () => {
    /** 作为“should warn in dev if an invalid ref object is provided”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper({children}) {
      return children;
    }

    /** 作为“should warn in dev if an invalid ref object is provided”场景的组件夹具，隔离待验证的 React 行为。 */
    class ExampleComponent extends React.Component {
      /** 渲染“should warn in dev if an invalid ref object is provided”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    ReactDOM.flushSync(() => {
      root.render(
        <Wrapper>
          <div ref={{}} />
        </Wrapper>,
      );
    });
    assertConsoleErrorDev([
      'Unexpected ref object provided for div. ' +
        'Use either a ref-setter function or React.createRef().\n' +
        '    in div (at **)',
    ]);

    ReactDOM.flushSync(() => {
      root.render(
        <Wrapper>
          <ExampleComponent ref={{}} />
        </Wrapper>,
      );
    });
    assertConsoleErrorDev([
      'Unexpected ref object provided for ExampleComponent. ' +
        'Use either a ref-setter function or React.createRef().\n' +
        '    in ExampleComponent (at **)',
    ]);
  });
});
