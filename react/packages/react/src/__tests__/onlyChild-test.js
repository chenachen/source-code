/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('onlyChild', () => {
  let React;
  let WrapComponent;

  // 包装器把 props.children 交给公开 Children.only；各例检查的是元素形状，不执行该包装器的 DOM 挂载。
  beforeEach(() => {
    React = require('react');
    /** 共享包装类在 render 中调用 Children.only；mapFn/this 是本实现不消费的多余实参，返回唯一 element 放入 div。 */
    WrapComponent = class extends React.Component {
      /** 将唯一 React element 嵌入 div；Children.only 的校验不接受数组，即使数组只有一项。 */
      render() {
        return (
          <div>
            {React.Children.only(this.props.children, this.props.mapFn, this)}
          </div>
        );
      }
    };
  });

  /** JSX 中给包装器两个元素，children 因而为数组；调用 only 应抛错，验证该 API 要求单个 element，而非任意可渲染 children 集合。 */
  it('should fail when passed two children', () => {
    expect(function () {
      const instance = (
        <WrapComponent>
          <div />
          <span />
        </WrapComponent>
      );
      React.Children.only(instance.props.children);
    }).toThrow();
  });

  /** 分别传 null 与 undefined children 并调用 only，两个调用都应抛错；可作为空渲染输入的值不等同于一个 React element。 */
  it('should fail when passed nully values', () => {
    expect(function () {
      const instance = <WrapComponent>{null}</WrapComponent>;
      React.Children.only(instance.props.children);
    }).toThrow();

    expect(function () {
      const instance = <WrapComponent>{undefined}</WrapComponent>;
      React.Children.only(instance.props.children);
    }).toThrow();
  });

  /** 传只含一个带 key 元素的数组，only 仍应抛错；验证限制依据输入本身是否为 element，不依据数组长度或元素 key。 */
  it('should fail when key/value objects', () => {
    expect(function () {
      const instance = <WrapComponent>{[<span key="abc" />]}</WrapComponent>;
      React.Children.only(instance.props.children);
    }).toThrow();
  });

  /** 用表达式插入单个 span，使 children 仍是 element；调用 only 不应抛错，验证插值写法不会把单子节点变成集合。 */
  it('should not fail when passed interpolated single child', () => {
    expect(function () {
      const instance = <WrapComponent>{<span />}</WrapComponent>;
      React.Children.only(instance.props.children);
    }).not.toThrow();
  });

  /** 给包装器单个 span，only 的返回值应等于该元素；检查合法输入被直接选出，而不是增添包装节点。 */
  it('should return the only child', () => {
    const instance = (
      <WrapComponent>
        <span />
      </WrapComponent>
    );
    expect(React.Children.only(instance.props.children)).toEqual(<span />);
  });
});
