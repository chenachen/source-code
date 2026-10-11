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
  // 隔离 React/DOM 模块，并取开发构建的 console 断言；本例同时覆盖宿主 Fiber 和 class Fiber 的 ref 校验。
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ({assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /** 给 div 和 class 实例分别传没有 current 字段的空对象 ref，再同步挂载；开发构建均应提示使用回调 ref 或 createRef，验证两类提交路径都检查 ref 形状。 */
  it('should warn in dev if an invalid ref object is provided', () => {
    /** 原样返回 children，使告警栈含 Wrapper 而不增加额外宿主节点。 */
    function Wrapper({children}) {
      return children;
    }

    /** 不输出 DOM 的 class 夹具，用实例 ref 路径与上面的 div 宿主 ref 路径对照。 */
    class ExampleComponent extends React.Component {
      /** 返回 null，使例子只观察实例 ref 的校验，而不引入后代 ref。 */
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
