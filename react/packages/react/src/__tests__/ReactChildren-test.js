/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactChildren', () => {
  let React;
  let ReactDOMClient;
  let act;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should support identity for simple”场景的唯一关键操作。
   * Then：断言 Children 遍历、扁平化、索引与 key 组合契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should support identity for simple', () => {
    const context = {};
    const callback = jest.fn().mockImplementation(function (kid, index) {
      expect(this).toBe(context);
      return kid;
    });

    const simpleKid = <span key="simple" />;

  // 先让 children 经过组件传递，完整模拟转换工具产出的结构进入 React 后的真实路径。

    const instance = <div>{simpleKid}</div>;
    React.Children.forEach(instance.props.children, callback, context);
    expect(callback).toHaveBeenCalledWith(simpleKid, 0);
    callback.mockClear();
    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    expect(callback).toHaveBeenCalledWith(simpleKid, 0);
    expect(mappedChildren[0]).toEqual(<span key=".$simple" />);
  });

  /**
   * 场景：“should support Portal components”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should support Portal components', () => {
    const context = {};
    const callback = jest.fn().mockImplementation(function (kid, index) {
      expect(this).toBe(context);
      return kid;
    });
    const ReactDOM = require('react-dom');
    const portalContainer = document.createElement('div');

    const simpleChild = <span key="simple" />;
    const reactPortal = ReactDOM.createPortal(simpleChild, portalContainer);

    const parentInstance = <div>{reactPortal}</div>;
    React.Children.forEach(parentInstance.props.children, callback, context);
    expect(callback).toHaveBeenCalledWith(reactPortal, 0);
    callback.mockClear();
    const mappedChildren = React.Children.map(
      parentInstance.props.children,
      callback,
      context,
    );
    expect(callback).toHaveBeenCalledWith(reactPortal, 0);
    expect(mappedChildren[0]).toEqual(reactPortal);
  });

  /**
   * 场景：“should treat single arrayless child as being in array”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should treat single arrayless child as being in array', () => {
    const context = {};
    const callback = jest.fn().mockImplementation(function (kid, index) {
      expect(this).toBe(context);
      return kid;
    });

    const simpleKid = <span />;
    const instance = <div>{simpleKid}</div>;
    React.Children.forEach(instance.props.children, callback, context);
    expect(callback).toHaveBeenCalledWith(simpleKid, 0);
    callback.mockClear();
    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    expect(callback).toHaveBeenCalledWith(simpleKid, 0);
    expect(mappedChildren[0]).toEqual(<span key=".0" />);
  });

  /**
   * 场景：“should treat single child in array as expected”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should treat single child in array as expected', () => {
    const context = {};
    const callback = jest.fn().mockImplementation(function (kid, index) {
      expect(this).toBe(context);
      return kid;
    });

    const simpleKid = <span key="simple" />;
    const instance = <div>{[simpleKid]}</div>;
    React.Children.forEach(instance.props.children, callback, context);
    expect(callback).toHaveBeenCalledWith(simpleKid, 0);
    callback.mockClear();
    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    expect(callback).toHaveBeenCalledWith(simpleKid, 0);
    expect(mappedChildren[0]).toEqual(<span key=".$simple" />);
  });

  /**
   * 场景：“should be called for each child”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should be called for each child', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;
    const context = {};

    const callback = jest.fn().mockImplementation(function (kid) {
      expect(this).toBe(context);
      return kid;
    });

    const instance = (
      <div>
        {zero}
        {one}
        {two}
        {three}
        {four}
      </div>
    );

    /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
    function assertCalls() {
      expect(callback).toHaveBeenCalledWith(zero, 0);
      expect(callback).toHaveBeenCalledWith(one, 1);
      expect(callback).toHaveBeenCalledWith(two, 2);
      expect(callback).toHaveBeenCalledWith(three, 3);
      expect(callback).toHaveBeenCalledWith(four, 4);
      callback.mockClear();
    }

    React.Children.forEach(instance.props.children, callback, context);
    assertCalls();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    assertCalls();
    expect(mappedChildren).toEqual([
      <div key=".$keyZero" />,
      <div key=".$keyTwo" />,
      <div key=".$keyFour" />,
    ]);
  });

  /**
   * 场景：“should traverse children of different kinds”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should traverse children of different kinds', () => {
    const div = <div key="divNode" />;
    const span = <span key="spanNode" />;
    const a = <a key="aNode" />;

    const context = {};
    const callback = jest.fn().mockImplementation(function (kid) {
      expect(this).toBe(context);
      return kid;
    });

    const instance = (
      <div>
        {div}
        {[[span]]}
        {[a]}
        {'string'}
        {1234}
        {true}
        {false}
        {null}
        {undefined}
        {9n}
      </div>
    );

    /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
    function assertCalls() {
      expect(callback).toHaveBeenCalledTimes(10);
      expect(callback).toHaveBeenCalledWith(div, 0);
      expect(callback).toHaveBeenCalledWith(span, 1);
      expect(callback).toHaveBeenCalledWith(a, 2);
      expect(callback).toHaveBeenCalledWith('string', 3);
      expect(callback).toHaveBeenCalledWith(1234, 4);
      expect(callback).toHaveBeenCalledWith(null, 5);
      expect(callback).toHaveBeenCalledWith(null, 6);
      expect(callback).toHaveBeenCalledWith(null, 7);
      expect(callback).toHaveBeenCalledWith(null, 8);
      expect(callback).toHaveBeenCalledWith(9n, 9);
      callback.mockClear();
    }

    React.Children.forEach(instance.props.children, callback, context);
    assertCalls();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    assertCalls();
    expect(mappedChildren).toEqual([
      <div key=".$divNode" />,
      <span key=".1:0:$spanNode" />,
      <a key=".2:$aNode" />,
      'string',
      1234,
      9n,
    ]);
  });

  /**
   * 场景：“should be called for each child in nested structure”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should be called for each child in nested structure', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;
    const five = <div key="keyFive" />;

    const context = {};
    const callback = jest.fn().mockImplementation(function (kid) {
      return kid;
    });

    const instance = <div>{[[zero, one, two], [three, four], five]}</div>;

    /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
    function assertCalls() {
      expect(callback).toHaveBeenCalledTimes(6);
      expect(callback).toHaveBeenCalledWith(zero, 0);
      expect(callback).toHaveBeenCalledWith(one, 1);
      expect(callback).toHaveBeenCalledWith(two, 2);
      expect(callback).toHaveBeenCalledWith(three, 3);
      expect(callback).toHaveBeenCalledWith(four, 4);
      expect(callback).toHaveBeenCalledWith(five, 5);
      callback.mockClear();
    }

    React.Children.forEach(instance.props.children, callback, context);
    assertCalls();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    assertCalls();
    expect(mappedChildren).toEqual([
      <div key=".0:$keyZero" />,
      <div key=".0:$keyTwo" />,
      <div key=".1:$keyFour" />,
      <div key=".$keyFive" />,
    ]);
  });

  /**
   * 场景：“should retain key across two mappings”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should retain key across two mappings', () => {
    const zeroForceKey = <div key="keyZero" />;
    const oneForceKey = <div key="keyOne" />;
    const context = {};
    const callback = jest.fn().mockImplementation(function (kid) {
      expect(this).toBe(context);
      return kid;
    });

    const forcedKeys = (
      <div>
        {zeroForceKey}
        {oneForceKey}
      </div>
    );

    /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
    function assertCalls() {
      expect(callback).toHaveBeenCalledWith(zeroForceKey, 0);
      expect(callback).toHaveBeenCalledWith(oneForceKey, 1);
      callback.mockClear();
    }

    React.Children.forEach(forcedKeys.props.children, callback, context);
    assertCalls();

    const mappedChildren = React.Children.map(
      forcedKeys.props.children,
      callback,
      context,
    );
    assertCalls();
    expect(mappedChildren).toEqual([
      <div key=".$keyZero" />,
      <div key=".$keyOne" />,
    ]);
  });

  /**
   * 场景：“should be called for each child in an iterable without keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should be called for each child in an iterable without keys', async () => {
    const threeDivIterable = {
      /** 创建可重复消费的迭代器入口，供 Children API 验证 iterable 遍历契约。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 按顺序返回下一个子元素，并在耗尽后返回 done 终态。 */
          next: function () {
            if (i++ < 3) {
              return {value: <div />, done: false};
            } else {
              return {value: undefined, done: true};
            }
          },
        };
      },
    };

    const context = {};
    const callback = jest.fn().mockImplementation(function (kid) {
      expect(this).toBe(context);
      return kid;
    });

    /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
    function assertCalls() {
      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith(<div />, 0);
      expect(callback).toHaveBeenCalledWith(<div />, 1);
      expect(callback).toHaveBeenCalledWith(<div />, 2);
      callback.mockClear();
    }

    const instance = <div>{threeDivIterable}</div>;

    React.Children.forEach(instance.props.children, callback, context);

    assertCalls();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    assertCalls();
    expect(mappedChildren).toEqual([
      <div key=".0" />,
      <div key=".1" />,
      <div key=".2" />,
    ]);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(instance);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the top-level render call using <div>. It was passed a child from div.' +
        ' See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /**
   * 场景：“should be called for each child in an iterable with keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should be called for each child in an iterable with keys', () => {
    const threeDivIterable = {
      /** 创建可重复消费的迭代器入口，供 Children API 验证 iterable 遍历契约。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 按顺序返回下一个子元素，并在耗尽后返回 done 终态。 */
          next: function () {
            if (i++ < 3) {
              return {value: <div key={'#' + i} />, done: false};
            } else {
              return {value: undefined, done: true};
            }
          },
        };
      },
    };

    const context = {};
    const callback = jest.fn().mockImplementation(function (kid) {
      expect(this).toBe(context);
      return kid;
    });

    const instance = <div>{threeDivIterable}</div>;

    /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
    function assertCalls() {
      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith(<div key="#1" />, 0);
      expect(callback).toHaveBeenCalledWith(<div key="#2" />, 1);
      expect(callback).toHaveBeenCalledWith(<div key="#3" />, 2);
      callback.mockClear();
    }

    React.Children.forEach(instance.props.children, callback, context);
    assertCalls();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    assertCalls();
    expect(mappedChildren).toEqual([
      <div key=".$#1" />,
      <div key=".$#2" />,
      <div key=".$#3" />,
    ]);
  });

  /**
   * 场景：“should not enumerate enumerable numbers (#4776)”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should not enumerate enumerable numbers (#4776)', () => {
    /*eslint-disable no-extend-native */
    Number.prototype['@@iterator'] = function () {
      throw new Error('number iterator called');
    };
    /*eslint-enable no-extend-native */

    try {
      const instance = (
        <div>
          {5}
          {12}
          {13}
        </div>
      );

      const context = {};
      const callback = jest.fn().mockImplementation(function (kid) {
        expect(this).toBe(context);
        return kid;
      });

      /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
      const assertCalls = function () {
        expect(callback).toHaveBeenCalledTimes(3);
        expect(callback).toHaveBeenCalledWith(5, 0);
        expect(callback).toHaveBeenCalledWith(12, 1);
        expect(callback).toHaveBeenCalledWith(13, 2);
        callback.mockClear();
      };

      React.Children.forEach(instance.props.children, callback, context);
      assertCalls();

      const mappedChildren = React.Children.map(
        instance.props.children,
        callback,
        context,
      );
      assertCalls();
      expect(mappedChildren).toEqual([5, 12, 13]);
    } finally {
      delete Number.prototype['@@iterator'];
    }
  });

  /**
   * 场景：“should allow extension of native prototypes”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should allow extension of native prototypes', () => {
    /*eslint-disable no-extend-native */
    String.prototype.key = 'react';
    Number.prototype.key = 'rocks';
    /*eslint-enable no-extend-native */

    const instance = (
      <div>
        {'a'}
        {13}
      </div>
    );

    const context = {};
    const callback = jest.fn().mockImplementation(function (kid) {
      expect(this).toBe(context);
      return kid;
    });

    /** 核对 Children 回调的参数、顺序与次数，证明遍历契约。 */
    function assertCalls() {
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith('a', 0);
      expect(callback).toHaveBeenCalledWith(13, 1);
      callback.mockClear();
    }

    React.Children.forEach(instance.props.children, callback, context);
    assertCalls();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      context,
    );
    assertCalls();
    expect(mappedChildren).toEqual(['a', 13]);

    delete String.prototype.key;
    delete Number.prototype.key;
  });

  /**
   * 场景：“should pass key to returned component”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should pass key to returned component', () => {
    /** 接收遍历到的子节点与索引，记录 Children API 的回调契约。 */
    const mapFn = function (kid, index) {
      return <div>{kid}</div>;
    };

    const simpleKid = <span key="simple" />;

    const instance = <div>{simpleKid}</div>;
    const mappedChildren = React.Children.map(instance.props.children, mapFn);

    expect(React.Children.count(mappedChildren)).toBe(1);
    expect(mappedChildren[0]).not.toBe(simpleKid);
    expect(mappedChildren[0].props.children).toBe(simpleKid);
    expect(mappedChildren[0].key).toBe('.$simple');
  });

  /**
   * 场景：“should invoke callback with the right context”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should invoke callback with the right context', () => {
    let lastContext;
    /** 接收遍历到的子节点与索引，记录 Children API 的回调契约。 */
    const callback = function (kid, index) {
      lastContext = this;
      return this;
    };

    // TODO：待非对象 fragment 的语义稳定后，改用对象覆盖此场景。
    const scopeTester = 'scope tester';

    const simpleKid = <span key="simple" />;
    const instance = <div>{simpleKid}</div>;
    React.Children.forEach(instance.props.children, callback, scopeTester);
    expect(lastContext).toBe(scopeTester);

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
      scopeTester,
    );

    expect(React.Children.count(mappedChildren)).toBe(1);
    expect(mappedChildren[0]).toBe(scopeTester);
  });

  /**
   * 场景：“should be called for each child in array”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should be called for each child in array', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;

    const mapped = [
      <div key="giraffe" />, // 返回元素的 key 应与原子节点 key 组合。
      null, // 即使回调未提供 key，也应继承原子节点 key。
      <div />, // 无显式 key 的返回元素仍应获得原子节点 key。
      <span />, // 把空子节点映射为实际元素。
      <div key="keyFour" />,
    ];
    const callback = jest.fn().mockImplementation(function (kid, index) {
      return mapped[index];
    });

    const instance = (
      <div>
        {zero}
        {one}
        {two}
        {three}
        {four}
      </div>
    );

    React.Children.forEach(instance.props.children, callback);
    expect(callback).toHaveBeenCalledWith(zero, 0);
    expect(callback).toHaveBeenCalledWith(one, 1);
    expect(callback).toHaveBeenCalledWith(two, 2);
    expect(callback).toHaveBeenCalledWith(three, 3);
    expect(callback).toHaveBeenCalledWith(four, 4);
    callback.mockClear();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
    );
    expect(callback).toHaveBeenCalledTimes(5);
    expect(React.Children.count(mappedChildren)).toBe(4);
      // 未显式提供 key 时，遍历结果使用索引生成默认 key。
    expect([
      mappedChildren[0].key,
      mappedChildren[1].key,
      mappedChildren[2].key,
      mappedChildren[3].key,
    ]).toEqual(['giraffe/.$keyZero', '.$keyTwo', '.3', '.$keyFour']);

    expect(callback).toHaveBeenCalledWith(zero, 0);
    expect(callback).toHaveBeenCalledWith(one, 1);
    expect(callback).toHaveBeenCalledWith(two, 2);
    expect(callback).toHaveBeenCalledWith(three, 3);
    expect(callback).toHaveBeenCalledWith(four, 4);

    expect(mappedChildren[0]).toEqual(<div key="giraffe/.$keyZero" />);
    expect(mappedChildren[1]).toEqual(<div key=".$keyTwo" />);
    expect(mappedChildren[2]).toEqual(<span key=".3" />);
    expect(mappedChildren[3]).toEqual(<div key=".$keyFour" />);
  });

  /**
   * 场景：“should be called for each child in nested structure with mapping”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should be called for each child in nested structure with mapping', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;
    const five = <div key="keyFive" />;

    const zeroMapped = <div key="giraffe" />; // 回调显式提供的 key 应覆盖返回元素原 key。
    const twoMapped = <div />; // 未提供 key 时应补入原子节点 key。
    const fourMapped = <div key="keyFour" />;
    const fiveMapped = <div />;

    const callback = jest.fn().mockImplementation(function (kid) {
      switch (kid) {
        case zero:
          return zeroMapped;
        case two:
          return twoMapped;
        case four:
          return fourMapped;
        case five:
          return fiveMapped;
        default:
          return kid;
      }
    });

    const frag = [[zero, one, two], [three, four], five];
    const instance = <div>{[frag]}</div>;

    React.Children.forEach(instance.props.children, callback);
    expect(callback).toHaveBeenCalledTimes(6);
    expect(callback).toHaveBeenCalledWith(zero, 0);
    expect(callback).toHaveBeenCalledWith(one, 1);
    expect(callback).toHaveBeenCalledWith(two, 2);
    expect(callback).toHaveBeenCalledWith(three, 3);
    expect(callback).toHaveBeenCalledWith(four, 4);
    expect(callback).toHaveBeenCalledWith(five, 5);
    callback.mockClear();

    const mappedChildren = React.Children.map(
      instance.props.children,
      callback,
    );
    expect(callback).toHaveBeenCalledTimes(6);
    expect(callback).toHaveBeenCalledWith(zero, 0);
    expect(callback).toHaveBeenCalledWith(one, 1);
    expect(callback).toHaveBeenCalledWith(two, 2);
    expect(callback).toHaveBeenCalledWith(three, 3);
    expect(callback).toHaveBeenCalledWith(four, 4);
    expect(callback).toHaveBeenCalledWith(five, 5);

    expect(React.Children.count(mappedChildren)).toBe(4);
      // 未显式提供 key 时，遍历结果使用索引生成默认 key。
    expect([
      mappedChildren[0].key,
      mappedChildren[1].key,
      mappedChildren[2].key,
      mappedChildren[3].key,
    ]).toEqual([
      'giraffe/.0:0:$keyZero',
      '.0:0:$keyTwo',
      '.0:1:$keyFour',
      '.0:$keyFive',
    ]);

    expect(mappedChildren[0]).toEqual(<div key="giraffe/.0:0:$keyZero" />);
    expect(mappedChildren[1]).toEqual(<div key=".0:0:$keyTwo" />);
    expect(mappedChildren[2]).toEqual(<div key=".0:1:$keyFour" />);
    expect(mappedChildren[3]).toEqual(<div key=".0:$keyFive" />);
  });

  /**
   * 场景：“should retain key across two mappings with conditions”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should retain key across two mappings with conditions', () => {
    const zeroForceKey = <div key="keyZero" />;
    const oneForceKey = <div key="keyOne" />;

    // 返回元素的 key 必须与原子节点 key 组合，保留两层身份信息。
    const zeroForceKeyMapped = <div key="giraffe" />;
    // 即使回调未提供 key，React 也必须补入原子节点的 key。
    const oneForceKeyMapped = <div />;

    /** 接收遍历到的子节点与索引，记录 Children API 的回调契约。 */
    const mapFn = function (kid, index) {
      return index === 0 ? zeroForceKeyMapped : oneForceKeyMapped;
    };

    const forcedKeys = (
      <div>
        {zeroForceKey}
        {oneForceKey}
      </div>
    );

    const expectedForcedKeys = ['giraffe/.$keyZero', '.$keyOne'];
    const mappedChildrenForcedKeys = React.Children.map(
      forcedKeys.props.children,
      mapFn,
    );
    const mappedForcedKeys = mappedChildrenForcedKeys.map(c => c.key);
    expect(mappedForcedKeys).toEqual(expectedForcedKeys);

    const expectedRemappedForcedKeys = [
      'giraffe/.$giraffe/.$keyZero',
      '.$.$keyOne',
    ];
    const remappedChildrenForcedKeys = React.Children.map(
      mappedChildrenForcedKeys,
      mapFn,
    );
    expect(remappedChildrenForcedKeys.map(c => c.key)).toEqual(
      expectedRemappedForcedKeys,
    );
  });

  /**
   * 场景：“should not throw if key provided is a dupe with array key”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should not throw if key provided is a dupe with array key', () => {
    const zero = <div />;
    const one = <div key="0" />;

    /** 接收遍历到的子节点与索引，记录 Children API 的回调契约。 */
    const mapFn = function () {
      return null;
    };

    const instance = (
      <div>
        {zero}
        {one}
      </div>
    );

    expect(function () {
      React.Children.map(instance.props.children, mapFn);
    }).not.toThrow();
  });

  /**
   * 场景：“should use the same key for a cloned element”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should use the same key for a cloned element', () => {
    const instance = (
      <div>
        <div />
      </div>
    );

    const mapped = React.Children.map(
      instance.props.children,
      element => element,
    );

    const mappedWithClone = React.Children.map(
      instance.props.children,
      element => React.cloneElement(element),
    );

    expect(mapped[0].key).toBe(mappedWithClone[0].key);
  });

  /**
   * 场景：“should use the same key for a cloned element with key”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should use the same key for a cloned element with key', () => {
    const instance = (
      <div>
        <div key="unique" />
      </div>
    );

    const mapped = React.Children.map(
      instance.props.children,
      element => element,
    );

    const mappedWithClone = React.Children.map(
      instance.props.children,
      element => React.cloneElement(element, {key: 'unique'}),
    );

    expect(mapped[0].key).toBe(mappedWithClone[0].key);
  });

  /**
   * 场景：“should return 0 for null children”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should return 0 for null children', () => {
    const numberOfChildren = React.Children.count(null);
    expect(numberOfChildren).toBe(0);
  });

  /**
   * 场景：“should return 0 for undefined children”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should return 0 for undefined children', () => {
    const numberOfChildren = React.Children.count(undefined);
    expect(numberOfChildren).toBe(0);
  });

  /**
   * 场景：“should return 1 for single child”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should return 1 for single child', () => {
    const simpleKid = <span key="simple" />;
    const instance = <div>{simpleKid}</div>;
    const numberOfChildren = React.Children.count(instance.props.children);
    expect(numberOfChildren).toBe(1);
  });

  /**
   * 场景：“should count the number of children in flat structure”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should count the number of children in flat structure', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;

    const instance = (
      <div>
        {zero}
        {one}
        {two}
        {three}
        {four}
      </div>
    );
    const numberOfChildren = React.Children.count(instance.props.children);
    expect(numberOfChildren).toBe(5);
  });

  /**
   * 场景：“should count the number of children in nested structure”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should count the number of children in nested structure', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;
    const five = <div key="keyFive" />;

    const instance = (
      <div>{[[[zero, one, two], [three, four], five], null]}</div>
    );
    const numberOfChildren = React.Children.count(instance.props.children);
    expect(numberOfChildren).toBe(7);
  });

  /**
   * 场景：“should flatten children to an array”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should flatten children to an array', () => {
    expect(React.Children.toArray(undefined)).toEqual([]);
    expect(React.Children.toArray(null)).toEqual([]);

    expect(React.Children.toArray(<div />).length).toBe(1);
    expect(React.Children.toArray([<div />]).length).toBe(1);
    expect(React.Children.toArray(<div />)[0].key).toBe(
      React.Children.toArray([<div />])[0].key,
    );

    const flattened = React.Children.toArray([
      [<div key="apple" />, <div key="banana" />, <div key="camel" />],
      [<div key="banana" />, <div key="camel" />, <div key="deli" />],
    ]);
    expect(flattened.length).toBe(6);
    expect(flattened[1].key).toContain('banana');
    expect(flattened[3].key).toContain('banana');
    expect(flattened[1].key).not.toBe(flattened[3].key);

    const reversed = React.Children.toArray([
      [<div key="camel" />, <div key="banana" />, <div key="apple" />],
      [<div key="deli" />, <div key="camel" />, <div key="banana" />],
    ]);
    expect(flattened[0].key).toBe(reversed[2].key);
    expect(flattened[1].key).toBe(reversed[1].key);
    expect(flattened[2].key).toBe(reversed[0].key);
    expect(flattened[3].key).toBe(reversed[5].key);
    expect(flattened[4].key).toBe(reversed[4].key);
    expect(flattened[5].key).toBe(reversed[3].key);

        // `null`、`undefined` 与布尔值都不会进入最终渲染结果。
    expect(React.Children.toArray([1, 'two', null, undefined, true])).toEqual([
      1,
      'two',
    ]);
  });

  /**
   * 场景：“warns for mapped list children without keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('warns for mapped list children without keys', async () => {
    spyOnDev(console, 'error').mockImplementation(() => {});
    /** 作为“warns for mapped list children without keys”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentRenderingMappedChildren({children}) {
      return (
        <div>
          {React.Children.map(children, child => (
            <div />
          ))}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentRenderingMappedChildren>
          {[<div />]}
        </ComponentRenderingMappedChildren>,
      );
    });
    if (__DEV__) {
      const calls = console.error.mock.calls;
      console.error.mockRestore();
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toEqual(
        'Each child in a list should have a unique "key" prop.%s%s See https://react.dev/link/warning-keys for more information.',
      );
    }
  });

  /**
   * 场景：“does not warn for mapped static children without keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('does not warn for mapped static children without keys', async () => {
    /** 作为“does not warn for mapped static children without keys”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentRenderingMappedChildren({children}) {
      return (
        <div>
          {React.Children.map(children, child => (
            <div />
          ))}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentRenderingMappedChildren>
          <div />
          <div />
        </ComponentRenderingMappedChildren>,
      );
    });
  });

  /**
   * 场景：“warns for cloned list children without keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('warns for cloned list children without keys', async () => {
    /** 作为“warns for cloned list children without keys”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentRenderingClonedChildren({children}) {
      return (
        <div>
          {React.Children.map(children, child => React.cloneElement(child))}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentRenderingClonedChildren>
          {[<div />]}
        </ComponentRenderingClonedChildren>,
      );
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `ComponentRenderingClonedChildren`.' +
        ' See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /**
   * 场景：“does not warn for cloned static children without keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('does not warn for cloned static children without keys', async () => {
    /** 作为“does not warn for cloned static children without keys”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentRenderingClonedChildren({children}) {
      return (
        <div>
          {React.Children.map(children, child => React.cloneElement(child))}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentRenderingClonedChildren>
          <div />
          <div />
        </ComponentRenderingClonedChildren>,
      );
    });
  });

  /**
   * 场景：“warns for flattened list children without keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('warns for flattened list children without keys', async () => {
    /** 作为“warns for flattened list children without keys”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentRenderingFlattenedChildren({children}) {
      return <div>{React.Children.toArray(children)}</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentRenderingFlattenedChildren>
          {[<div />]}
        </ComponentRenderingFlattenedChildren>,
      );
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `ComponentRenderingFlattenedChildren`.' +
        ' See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /**
   * 场景：“does not warn for flattened static children without keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('does not warn for flattened static children without keys', async () => {
    /** 作为“does not warn for flattened static children without keys”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentRenderingFlattenedChildren({children}) {
      return <div>{React.Children.toArray(children)}</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentRenderingFlattenedChildren>
          <div />
          <div />
        </ComponentRenderingFlattenedChildren>,
      );
    });
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('does not throw on children without `_store`', async () => {
    /** 作为“does not warn for flattened static children without keys”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentRenderingFlattenedChildren({children}) {
      return <div>{React.Children.toArray(children)}</div>;
    }

    const source = <div />;
    const productionElement = {};
    Object.entries(source).forEach(([key, value]) => {
      if (key !== '_owner' && key !== '_store') {
        productionElement[key] = value;
      }
    });
    Object.freeze(productionElement);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentRenderingFlattenedChildren>
          {productionElement}
        </ComponentRenderingFlattenedChildren>,
      );
    });
  });

  /**
   * 场景：“should escape keys”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should escape keys', () => {
    const zero = <div key="1" />;
    const one = <div key="1=::=2" />;
    const instance = (
      <div>
        {zero}
        {one}
      </div>
    );
    const mappedChildren = React.Children.map(
      instance.props.children,
      kid => kid,
    );
    expect(mappedChildren).toEqual([
      <div key=".$1" />,
      <div key=".$1=0=2=2=02" />,
    ]);
  });

  /**
   * 场景：“should combine keys when map returns an array”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should combine keys when map returns an array', () => {
    const instance = (
      <div>
        <div key="a" />
        {false}
        <div key="b" />
        <p />
      </div>
    );
    const mappedChildren = React.Children.map(
      instance.props.children,
      // 同时覆盖有 key、无 key、数组空洞与克隆元素，验证扁平化不会混淆身份。
      kid => [
        <span key="x" />,
        null,
        <span key="y" />,
        kid,
        kid && React.cloneElement(kid, {key: 'z'}),
        <hr />,
      ],
    );
    expect(mappedChildren.length).toBe(18);

    // <div key="a">
    expect(mappedChildren[0].type).toBe('span');
    expect(mappedChildren[0].key).toBe('.$a/.$x');
    expect(mappedChildren[1].type).toBe('span');
    expect(mappedChildren[1].key).toBe('.$a/.$y');
    expect(mappedChildren[2].type).toBe('div');
    expect(mappedChildren[2].key).toBe('.$a/.$a');
    expect(mappedChildren[3].type).toBe('div');
    expect(mappedChildren[3].key).toBe('.$a/.$z');
    expect(mappedChildren[4].type).toBe('hr');
    expect(mappedChildren[4].key).toBe('.$a/.5');

    // false
    expect(mappedChildren[5].type).toBe('span');
    expect(mappedChildren[5].key).toBe('.1/.$x');
    expect(mappedChildren[6].type).toBe('span');
    expect(mappedChildren[6].key).toBe('.1/.$y');
    expect(mappedChildren[7].type).toBe('hr');
    expect(mappedChildren[7].key).toBe('.1/.5');

    // <div key="b">
    expect(mappedChildren[8].type).toBe('span');
    expect(mappedChildren[8].key).toBe('.$b/.$x');
    expect(mappedChildren[9].type).toBe('span');
    expect(mappedChildren[9].key).toBe('.$b/.$y');
    expect(mappedChildren[10].type).toBe('div');
    expect(mappedChildren[10].key).toBe('.$b/.$b');
    expect(mappedChildren[11].type).toBe('div');
    expect(mappedChildren[11].key).toBe('.$b/.$z');
    expect(mappedChildren[12].type).toBe('hr');
    expect(mappedChildren[12].key).toBe('.$b/.5');

    // <p>
    expect(mappedChildren[13].type).toBe('span');
    expect(mappedChildren[13].key).toBe('.3/.$x');
    expect(mappedChildren[14].type).toBe('span');
    expect(mappedChildren[14].key).toBe('.3/.$y');
    expect(mappedChildren[15].type).toBe('p');
    expect(mappedChildren[15].key).toBe('.3/.3');
    expect(mappedChildren[16].type).toBe('p');
    expect(mappedChildren[16].key).toBe('.3/.$z');
    expect(mappedChildren[17].type).toBe('hr');
    expect(mappedChildren[17].key).toBe('.3/.5');
  });

  /**
   * 场景：“should throw on object”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should throw on object', () => {
    expect(function () {
      React.Children.forEach({a: 1, b: 2}, function () {}, null);
    }).toThrowError(
      'Objects are not valid as a React child (found: object with keys ' +
        '{a, b}).' +
        (__DEV__
          ? ' If you meant to render a collection of children, use an ' +
            'array instead.'
          : ''),
    );
  });

  /**
   * 场景：“should render React.lazy after suspending”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should render React.lazy after suspending', async () => {
    const lazyElement = React.lazy(async () => ({default: <div key="hi" />}));
    /** 作为“should render React.lazy after suspending”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Component() {
      return React.Children.map([lazyElement], c =>
        React.cloneElement(c, {children: 'hi'}),
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(container.innerHTML).toBe('<div>hi</div>');
  });

  /**
   * 场景：“should render cached Promises after suspending”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should render cached Promises after suspending', async () => {
    const promise = Promise.resolve(<div key="hi" />);
    /** 作为“should render cached Promises after suspending”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Component() {
      return React.Children.map([promise], c =>
        React.cloneElement(c, {children: 'hi'}),
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(container.innerHTML).toBe('<div>hi</div>');
  });

  /**
   * 场景：“should throw on regex”。
   * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
   */
  it('should throw on regex', () => {
      // 真正关注的是 Date 对象（#4840），但其序列化受时区影响；改用 RegExp 获得确定性断言。
    expect(function () {
      React.Children.forEach(/abc/, function () {}, null);
    }).toThrowError(
      'Objects are not valid as a React child (found: /abc/).' +
        (__DEV__
          ? ' If you meant to render a collection of children, use an ' +
            'array instead.'
          : ''),
    );
  });

  describe('with fragments enabled', () => {
    /**
     * 场景：“warns for keys for arrays of elements in a fragment”。
     * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
     */
    it('warns for keys for arrays of elements in a fragment', async () => {
      /** 作为“warns for keys for arrays of elements in a fragment”场景的组件夹具，隔离待验证的 React 行为。 */
      class ComponentReturningArray extends React.Component {
        /** 渲染“warns for keys for arrays of elements in a fragment”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          return [<div />, <div />];
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ComponentReturningArray />);
      });
      assertConsoleErrorDev([
        'Each child in a list should have a unique "key" prop.' +
          '\n\nCheck the top-level render call using <ComponentReturningArray>. It was passed a child from ComponentReturningArray. ' +
          'See https://react.dev/link/warning-keys for more information.' +
          '\n    in div (at **)' +
          '\n    in ComponentReturningArray (at **)',
      ]);
    });

    /**
     * 场景：“does not warn when there are keys on elements in a fragment”。
     * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
     */
    it('does not warn when there are keys on elements in a fragment', async () => {
      /** 作为“does not warn when there are keys on elements in a fragment”场景的组件夹具，隔离待验证的 React 行为。 */
      class ComponentReturningArray extends React.Component {
        /** 渲染“does not warn when there are keys on elements in a fragment”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          return [<div key="foo" />, <div key="bar" />];
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ComponentReturningArray />);
      });
    });

    /**
     * 场景：“warns for keys for arrays at the top level”。
     * 机制：验证Children 遍历、扁平化、索引与 key 组合契约，锁定可观察结果与失败边界。
     */
    it('warns for keys for arrays at the top level', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render([<div />, <div />]);
      });
      assertConsoleErrorDev([
        'Each child in a list should have a unique "key" prop.' +
          '\n\nCheck the top-level render call using <Root>. ' +
          'See https://react.dev/link/warning-keys for more information.' +
          '\n    in div (at **)',
      ]);
    });
  });
});
