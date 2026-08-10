/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React = require('react');
let ReactDOM = require('react-dom');

describe('root level refs with legacy APIs', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
  });

  // @gate !disableLegacyMode
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「attaches and detaches root refs」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('attaches and detaches root refs', () => {
    let inst = null;

    // 宿主节点
    let ref = jest.fn(value => (inst = value));
    const container = document.createElement('div');
    let result = ReactDOM.render(<div ref={ref} />, container);
    expect(ref).toHaveBeenCalledTimes(1);
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
    expect(result).toBe(ref.mock.calls[0][0]);
    ReactDOM.unmountComponentAtNode(container);
    expect(ref).toHaveBeenCalledTimes(2);
    expect(ref.mock.calls[1][0]).toBe(null);

    // composite 组件
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.method`：实现测试夹具的生命周期、渲染或交互步骤。 */
      method() {
        return true;
      }
      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>Comp</div>;
      }
    }

    inst = null;
    ref = jest.fn(value => (inst = value));
    result = ReactDOM.render(<Comp ref={ref} />, container);

    expect(ref).toHaveBeenCalledTimes(1);
    expect(inst).toBeInstanceOf(Comp);
    expect(result).toBe(inst);

    // 确保我们有一个正确的实例。
    expect(result.method()).toBe(true);
    expect(inst.method()).toBe(true);

    ReactDOM.unmountComponentAtNode(container);
    expect(ref).toHaveBeenCalledTimes(2);
    expect(ref.mock.calls[1][0]).toBe(null);

    // 片段
    inst = null;
    ref = jest.fn(value => (inst = value));
    let divInst = null;
    const ref2 = jest.fn(value => (divInst = value));
    result = ReactDOM.render(
      [
        <Comp ref={ref} key="a" />,
        5,
        <div ref={ref2} key="b">
          Hello
        </div>,
      ],
      container,
    );

    // 第一次调用应该为 `Comp`
    expect(ref).toHaveBeenCalledTimes(1);
    expect(ref.mock.calls[0][0]).toBeInstanceOf(Comp);
    expect(result).toBe(ref.mock.calls[0][0]);

    expect(ref2).toHaveBeenCalledTimes(1);
    expect(divInst).toBeInstanceOf(HTMLDivElement);
    expect(result).not.toBe(divInst);

    ReactDOM.unmountComponentAtNode(container);
    expect(ref).toHaveBeenCalledTimes(2);
    expect(ref.mock.calls[1][0]).toBe(null);
    expect(ref2).toHaveBeenCalledTimes(2);
    expect(ref2.mock.calls[1][0]).toBe(null);

    // null
    result = ReactDOM.render(null, container);
    expect(result).toBe(null);

    // 基本类型
    result = ReactDOM.render(5, container);
    expect(result).toBeInstanceOf(Text);
  });
});
