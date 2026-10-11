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
  /** 依次 legacy 渲染宿主 div、带方法的类组件、混合数组、null 和数字，再逐树卸载；ref 挂载收到对应实例、卸载收到 null，render 返回首个可公开实例且数字返回 Text，验证根返回值与 ref 身份及清理语义。 */
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
    /** 可公开类实例 fixture；method 用于证明 legacy render 与 ref 返回的是可调用的同一实例。 */
    class Comp extends React.Component {
      /** 返回 true 作为实例身份探针，排除 legacy render 返回宿主 div 的可能。 */
      method() {
        return true;
      }
      /** 输出固定 div 文本，为类实例提供真实宿主子节点而不改变公开 ref 目标。 */
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
