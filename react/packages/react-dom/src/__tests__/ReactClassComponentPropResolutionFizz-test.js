/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {insertNodesAndExecuteScripts} from '../test-utils/FizzTestUtils';
import {patchMessageChannel} from '../../../../scripts/jest/patchMessageChannel';

// 测试环境的补丁
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;

let React;
let ReactDOMServer;
let Scheduler;
let assertLog;
let container;
let serverAct;

describe('ReactClassComponentPropResolutionFizz', () => {
  beforeEach(() => {
    jest.resetModules();
    Scheduler = require('scheduler');
    patchMessageChannel();

    React = require('react');
    ReactDOMServer = require('react-dom/server.browser');
    assertLog = require('internal-test-utils').assertLog;
    serverAct = require('internal-test-utils').serverAct;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `readIntoContainer`：封装当前用例复用的操作、回调或断言步骤。 */
  async function readIntoContainer(stream) {
    const reader = stream.getReader();
    let result = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      result += Buffer.from(value).toString('utf8');
    }
    const temp = document.createElement('div');
    temp.innerHTML = result;
    insertNodesAndExecuteScripts(temp, container, null);
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「resolves ref and default props before calling lifecycle methods」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('resolves ref and default props before calling lifecycle methods', async () => {
    /** `getPropKeys`：封装当前用例复用的操作、回调或断言步骤。 */
    function getPropKeys(props) {
      return Object.keys(props).join(', ');
    }

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        Scheduler.log('constructor: ' + getPropKeys(props));
      }
      /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount: ' + getPropKeys(this.props));
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Text text={'render: ' + getPropKeys(this.props)} />;
      }
    }

    Component.defaultProps = {
      default: 'yo',
    };

    // `shouldNeverAppearAsAProp` 应该不作为属性传递。 `default` 总是应该。

    const ref = React.createRef();
    const stream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<Component text="Yay" ref={ref} />),
    );
    await readIntoContainer(stream);

    assertLog([
      'constructor: text, default',
      'componentWillMount: text, default',
      'render: text, default',
    ]);
  });
});
