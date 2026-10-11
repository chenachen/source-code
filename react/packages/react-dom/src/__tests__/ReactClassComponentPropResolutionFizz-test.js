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

  /** 逐块读取 Web Stream 字节到完成，再解析临时 DOM 并执行 Fizz 脚本，将服务器输出安装到测试容器。 */
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

  /** 记录收到的文本后原样返回，使 render 阶段 props 键集合可按执行顺序比较。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 带 ref 和缺省 default prop 的类组件通过浏览器 Fizz 流 SSR；读完整流并执行注入脚本后，constructor/willMount/render 日志都只含 text, default，验证调用生命周期之前已补默认值并移除特殊 ref。 */
  it('resolves ref and default props before calling lifecycle methods', async () => {

    /** 保留 Object.keys 的顺序并用逗号连接，将特殊 ref 是否泄露和 default 是否补齐变成生命周期日志。 */
    function getPropKeys(props) {
      return Object.keys(props).join(', ');
    }

    /** 同时记录构造、willMount 与 render 的 props，检查 Fizz 在进入各生命周期前完成默认值和特殊 ref 处理。 */
    class Component extends React.Component {

      /** 接收处理后的 props 并初始化父类，再记录键集合，覆盖最早的用户生命周期观察点。 */
      constructor(props) {
        super(props);
        Scheduler.log('constructor: ' + getPropKeys(props));
      }

      /** 读取实例 props 的键集合，与 constructor 日志比较，检测生命周期之间是否改变参数形状。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount: ' + getPropKeys(this.props));
      }

      /** 把当前 props 键集合交给 Text 记录并输出，覆盖服务器渲染入口的最终用户观察点。 */
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
