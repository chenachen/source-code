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

  // 每例重载 React/DOM 与 act 工具，隔离 key 告警去重和 renderer 状态。
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /** 单个 key=simple 的 span 作为 props.children，依次 forEach/map；回调以指定 this 收到原节点和索引 0，映射输出 key=.$simple，验证单叶身份与根路径编码。 */
  it('should support identity for simple', () => {
    const context = {};
    const callback = jest.fn().mockImplementation(function (kid, index) {
      expect(this).toBe(context);
      return kid;
    });

    const simpleKid = <span key="simple" />;

    // 从 element.props.children 取单个 span，核对 Children API 接收的原叶身份。

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

  /** 把 span 放入 Portal 后作为单个 child，forEach/map 回调收到整个 Portal；结果与原 Portal 相等，验证 Portal 是叶且不会按普通 element 重写 key 或展开其内容。 */
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

  /** 无 key span 不包数组传入 Children，forEach/map 都只回调索引 0，结果 key=.0；验证单 child 与数组插槽采用同一隐式路径规则。 */
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

  /** key=simple 的 span 放在单项数组后 forEach/map，回调收到原节点与索引 0，输出 .$simple；验证数组包装不添加额外根层级。 */
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

  /** 三元素与两个 null 交替组成五个 children，forEach/map 均核对全部五次回调；map 只输出三元素及原 key 路径，验证空叶参与遍历却从结果中过滤。 */
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

    /** 核对五个输入位置（含两个 null）的回调参数，再清空 mock，供 forEach 与 map 分别检查；空叶也占连续索引。 */
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

  /** 输入嵌套 span/a、元素、字符串、数字、布尔、null、undefined 和 bigint；回调按深度优先收到十叶，四空值统一 null，输出保留六个非空值，验证类型归一化与层级 key。 */
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

    /** 核对十个深度优先叶的全局索引；布尔、null、undefined 均以 null 入回调，随后清空 mock 复用检查。 */
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

  /** 两层数组含六叶与两个 null，forEach/map 按全局连续索引回调六次；输出四元素且 key 保留 .0/.1 子路径，验证嵌套展平不丢原层级身份。 */
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

    /** 核对嵌套两数组和末尾元素共六叶的连续索引（含 null）；清空 mock 后再验证第二次遍历。 */
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

  /** 两个显式 key 元素先 forEach 再 map 身份映射；两次回调都收到原节点，输出 .$keyZero/.$keyOne，验证 forEach 不改输入及 map 保留显式身份。标题中的两次映射在本体实际是一遍 forEach、一遍 map。 */
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

    /** 核对两个 keyed 元素仍以原引用及索引 0/1 入回调；清空 mock，分开验证 forEach 与 map。 */
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

  /** 可重复 @@iterator 每次产出三个无 key div，forEach/map 连续索引及 .0/.1/.2 均断言；act 渲染原 iterable 还要求缺 key 告警，验证合成映射 key 不替代输入列表校验。 */
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

    /** 核对无 key iterable 每次产出的三个 div 及索引 0/1/2，再清空 mock；迭代器每次重新创建元素，使用结构相等断言。 */
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

  /** 可重复 @@iterator 产出 #1/#2/#3 三个 keyed div，forEach/map 各三次并保留上下文；结果 key=.$#1 等，验证迭代序号与显式 key 路径分别处理。 */
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

    /** 核对 iterable 产出的 #1/#2/#3 keyed div 及索引 0/1/2，再清空 mock，区分两次遍历。 */
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

  /** 给 Number.prototype 安装一调用就抛错的 @@iterator 后遍历 5/12/13；回调三次且 map 原数值不变，finally 删除原型扩展，验证数字先作为叶处理而不会访问装箱 iterator。 */
  it('should not enumerate enumerable numbers (#4776)', () => {
    /*eslint-disable no-extend-native */
    /** 若数字误走 iterable 分支就抛错；配合 finally 清理原型扩展，验证数字叶优先于装箱后的 iterator。 */
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

      /** 核对数字 5/12/13 直接作为三个叶传入，再清空 mock；原型 iterator 不应参与遍历。 */
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

  /** String/Number 原型添加 key 后遍历 'a'/13，回调与映射仍为两原始值；末尾删除扩展，验证原型 key 不把原始值误当 element 身份。 */
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

    /** 核对原型挂 key 后的字符串 a 与数字 13 仍以原始值和索引 0/1 入回调，再清空 mock。 */
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

  /** 将 key=simple 的 span 映射成包它的 div；结果不是原 span、children 仍引用 span 且 wrapper key=.$simple，验证原叶 key 传给新返回元素。 */
  it('should pass key to returned component', () => {
    /** 将输入 kid 包入无 key div；index 未使用，供测试证明新返回元素继承输入叶路径。 */
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

  /** 以字符串 scope tester 作为 callback this，forEach 记录 this、map 返回 this；断言上下文与结果完全一致，验证显式 context 绑定和回调返回值传递。 */
  it('should invoke callback with the right context', () => {
    let lastContext;
    /** 把绑定的 this 存入 lastContext 并原样返回；kid/index 未使用，供 forEach/map 检查 context 绑定与输出。 */
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

  /** 五叶含 null，按索引返回不同 key、无 key、null 及 span；map 回调五次但输出四项，逐项断言组合 key，验证返回新元素身份与空叶索引保留。 */
  it('should be called for each child in array', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;

    const mapped = [
      <div key="giraffe" />, // 返回元素的 key 应与原子节点 key 组合。
      null, // 返回 null 会过滤输出，但该输入叶仍触发回调并占索引。
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
    // 分别核对新旧显式 key 的组合、继承输入 key，以及空输入映射所得的索引路径。
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

  /** 六叶嵌套结构外再包一层数组，按原节点引用替换四元素；map 输出四项并核对 giraffe/.0:0:$keyZero 等路径，验证返回 key 与输入多层路径组合。 */
  it('should be called for each child in nested structure with mapping', () => {
    const zero = <div key="keyZero" />;
    const one = null;
    const two = <div key="keyTwo" />;
    const three = null;
    const four = <div key="keyFour" />;
    const five = <div key="keyFive" />;

    const zeroMapped = <div key="giraffe" />; // 返回 key=giraffe 与输入叶路径组合，保留两层身份。
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
    // 输出展平后仍保留原数组层级路径；新返回的 giraffe key 加在原叶路径前。
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

  /** 两个显式 keyed child 连续 map 两遍，每遍按索引替换成 giraffe keyed 或无 key 元素；断言第二遍完整组合路径，验证已合成 key 仍被当作下一遍显式输入 key 编码。 */
  it('should retain key across two mappings with conditions', () => {
    const zeroForceKey = <div key="keyZero" />;
    const oneForceKey = <div key="keyOne" />;

    // 返回元素的 key 必须与原子节点 key 组合，保留两层身份信息。
    const zeroForceKeyMapped = <div key="giraffe" />;
    // 即使回调未提供 key，React 也必须补入原子节点的 key。
    const oneForceKeyMapped = <div />;

    /** 按遍历 index 选择第一项 giraffe keyed 元素或无 key 元素；kid 未使用，同一映射器复用两遍以检查组合路径。 */
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

  /** 并列无 key 元素与显式 key='0' 元素，map 回调全返回 null；断言不抛错，验证隐式索引 0 与带 $ 的显式键分属不同路径命名空间。 */
  it('should not throw if key provided is a dupe with array key', () => {
    const zero = <div />;
    const one = <div key="0" />;

    /** 总返回 null，过滤所有映射输出；供重复显式 key 与隐式索引路径的无异常检查。 */
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

  /** 无 key 单元素分别身份 map 与 cloneElement map，断言输出 key 相等；验证克隆未改 key 时不额外叠加返回 key。 */
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

  /** key=unique 的单元素分别身份 map 与显式同 key 克隆 map，断言路径相等；验证相同返回 key 只编码一次。 */
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

  /** 顶层传 null 给 Children.count，断言 0；验证 mapChildren 的空输入短路，而非把顶层 null 计成一个数组空叶。 */
  it('should return 0 for null children', () => {
    const numberOfChildren = React.Children.count(null);
    expect(numberOfChildren).toBe(0);
  });

  /** 顶层传 undefined 给 Children.count，断言 0；验证未提供 children 的计数短路。 */
  it('should return 0 for undefined children', () => {
    const numberOfChildren = React.Children.count(undefined);
    expect(numberOfChildren).toBe(0);
  });

  /** 单个 keyed span 从 div.props.children 传给 count，断言 1；验证 element 本身是叶，不递归统计它的宿主子树。 */
  it('should return 1 for single child', () => {
    const simpleKid = <span key="simple" />;
    const instance = <div>{simpleKid}</div>;
    const numberOfChildren = React.Children.count(instance.props.children);
    expect(numberOfChildren).toBe(1);
  });

  /** 三元素和两个 null 共五插槽传给 count，断言 5；验证 count 包含列表中的空叶，区别于 map 输出过滤。 */
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

  /** 多层数组含四元素、两个内层 null 和一个外层 null，count 为 7；验证递归累计输入叶而不是可见元素数。 */
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

  /** 对空输入、单元素、两组各三 keyed 元素及重排序调用 toArray；断言长度、跨组同 key 不碰撞、组内重排 key 稳定，最后空叶被过滤，验证展平与层级身份一起保留。 */
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

  /** 无 key 单项动态列表经组件 Children.map 返回 div 后 act 渲染；DEV spy 要求恰好一条缺 key 告警，验证输入校验失败信息穿过映射合成 key。 */
  it('warns for mapped list children without keys', async () => {
    spyOnDev(console, 'error').mockImplementation(() => {});
    /** 把传入动态 children 映射成无 key div，供测试观察合成 key 后仍应保留的输入校验失败。 */
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

  /** 两个无 key JSX 静态插槽经 Children.map 返回新 div 后 act 渲染；本例无显式日志断言，依测试环境无意外告警要求验证静态 children 的已校验状态保留。 */
  it('does not warn for mapped static children without keys', async () => {
    /** 把静态 JSX 插槽映射为 div，供测试观察原静态校验状态是否穿过 Children.map。 */
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

  /** 无 key 动态列表经 Children.map/cloneElement 后 act 渲染，断言缺 key 告警归属组件；验证克隆与重写 key 不清除原输入的未校验标记。 */
  it('warns for cloned list children without keys', async () => {
    /** 映射并克隆动态列表 child，不改原 key，供测试校验未验证标记随克隆传播。 */
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

  /** 两个无 key JSX 静态插槽经 map/cloneElement 后 act 渲染；无显式 DOM 断言，依无意外告警检查验证静态校验状态保留。 */
  it('does not warn for cloned static children without keys', async () => {
    /** 映射并克隆静态 child，供测试确认静态 JSX 无 key 不被重新当动态列表告警。 */
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

  /** 无 key 动态数组经 Children.toArray 后 act 渲染，断言组件归属的缺 key 告警；验证展平合成路径仍传递输入列表未校验状态。 */
  it('warns for flattened list children without keys', async () => {
    /** 用 toArray 展平动态 children，供测试观察原缺 key 标记能否传递到 renderer。 */
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

  /** 两个无 key JSX 静态插槽经 toArray 后 act 渲染；依测试环境无意外告警检查，验证静态插槽不会因展平被误判动态列表。 */
  it('does not warn for flattened static children without keys', async () => {
    /** 用 toArray 展平静态 children，供测试确认静态校验状态不会丢失。 */
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

  /** 复制 element 自有字段但排除 _owner/_store，再冻结成生产形状并经 toArray 渲染；act 正常完成且无显式 DOM 断言，验证 DEV key 校验兼容缺少私有 store 的元素。 */
  it('does not throw on children without `_store`', async () => {
    /** 展平缺少 _store 的生产形状 element，供测试覆盖 DEV 兼容分支而非访问不存在的 store。 */
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

  /** 显式 key='1' 与 '1=::=2' 元素身份 map，结果逐项断言 .$1 与 .$1=0=2=2=02，验证保留字符 =/: 的编码不与内部路径分隔冲突。 */
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

  /** 四输入叶含 keyed a/b、false 和无 key p，每叶返回含 x/y、null、原叶、改 key 克隆及 hr 的数组；断言 18 输出及每项组合路径，验证空值过滤、嵌套返回数组与两侧 key 组合。 */
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

  /** 把普通 {a:1,b:2} 传给 forEach，断言报错列出字段 a/b 并按 DEV 添加数组建议；验证普通对象不能作为 children 集合。 */
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

  /** lazy 工厂异步解析为 keyed div element，组件 Children.map 后克隆加入 hi；act 冲刷后 innerHTML=<div>hi</div>，验证 Children 可解包 lazy child、挂起重试后继续映射。 */
  it('should render React.lazy after suspending', async () => {
    const lazyElement = React.lazy(async () => ({default: <div key="hi" />}));
    /** 在 render 中解析稳定 lazy child，克隆解析后的 element 为 hi；首次未完成时由 Children 抛挂起对象。 */
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

  /** 稳定 Promise.resolve(keyed div) 在 render 外创建，组件 map 后克隆 hi；act 后断言 <div>hi</div>，验证同一 thenable 状态插桩与重试解包，不在每轮新建 Promise。 */
  it('should render cached Promises after suspending', async () => {
    const promise = Promise.resolve(<div key="hi" />);
    /** 在 render 中解包外部稳定 Promise child 后克隆为 hi，避免重试期间不断创建新的 thenable。 */
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

  /** 把 /abc/ 传 forEach，断言错误用 /abc/ 描述且 DEV 带数组建议；验证非普通对象也被拒绝，采用 RegExp 避免 Date 时区影响。 */
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
    /** 类组件 render 返回两个无 key div 数组，act 挂载后断言组件与 div 栈的缺 key 告警；验证组件返回数组同样属于动态列表校验。 */
    it('warns for keys for arrays of elements in a fragment', async () => {
      /** 返回无 key 宿主元素数组的 fixture，建立组件返回动态列表的告警归属。 */
      class ComponentReturningArray extends React.Component {
        /** 创建两个无 key div 作为返回数组，触发同级元素的 DEV key 校验。 */
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

    /** 类组件 render 返回 foo/bar 两个 keyed div 数组后 act 挂载；依无意外告警检查，验证显式同级 key 满足组件返回数组的身份要求。 */
    it('does not warn when there are keys on elements in a fragment', async () => {
      /** 返回两个显式 keyed 宿主元素的 fixture，与无 key 数组场景比较校验条件。 */
      class ComponentReturningArray extends React.Component {
        /** 返回 key=foo/bar 的两个 div，确保同级身份明确且无需缺 key 告警。 */
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

    /** 直接 root.render 两个无 key div 的数组并 act 冲刷，断言 Root 归属的缺 key 告警；验证顶层数组校验无需外层组件。 */
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
