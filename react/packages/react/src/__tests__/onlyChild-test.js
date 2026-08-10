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

  beforeEach(() => {
    React = require('react');
    WrapComponent = class extends React.Component {
      /** 渲染“onlyChild”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <div>
            {React.Children.only(this.props.children, this.props.mapFn, this)}
          </div>
        );
      }
    };
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should fail when passed two children”场景的唯一关键操作。
   * Then：断言 Children.only 的单元素输入约束 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
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

  /**
   * 场景：“should fail when passed nully values”。
   * 机制：验证Children.only 的单元素输入约束，锁定可观察结果与失败边界。
   */
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

  /**
   * 场景：“should fail when key/value objects”。
   * 机制：验证Children.only 的单元素输入约束，锁定可观察结果与失败边界。
   */
  it('should fail when key/value objects', () => {
    expect(function () {
      const instance = <WrapComponent>{[<span key="abc" />]}</WrapComponent>;
      React.Children.only(instance.props.children);
    }).toThrow();
  });

  /**
   * 场景：“should not fail when passed interpolated single child”。
   * 机制：验证Children.only 的单元素输入约束，锁定可观察结果与失败边界。
   */
  it('should not fail when passed interpolated single child', () => {
    expect(function () {
      const instance = <WrapComponent>{<span />}</WrapComponent>;
      React.Children.only(instance.props.children);
    }).not.toThrow();
  });

  /**
   * 场景：“should return the only child”。
   * 机制：验证Children.only 的单元素输入约束，锁定可观察结果与失败边界。
   */
  it('should return the only child', () => {
    const instance = (
      <WrapComponent>
        <span />
      </WrapComponent>
    );
    expect(React.Children.only(instance.props.children)).toEqual(<span />);
  });
});
