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
let ReactDOMClient;
let ReactDOMServer;
let act;

describe('ReactDOMTextComponent', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「updates a mounted text component in place」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('updates a mounted text component in place', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <span />
          {'foo'}
          {'bar'}
        </div>,
      );
    });
    let inst = container.firstChild;
    let nodes = inst.childNodes;

    const foo = nodes[1];
    const bar = nodes[2];
    expect(foo.data).toBe('foo');
    expect(bar.data).toBe('bar');

    await act(() => {
      root.render(
        <div>
          <span />
          {'baz'}
          {'qux'}
        </div>,
      );
    });
    inst = container.firstChild;
    // 在更新后, 文本节点应该保持原位（而不是被卸载并重新挂载），而不是被移除并重新添加。
    nodes = inst.childNodes;
    expect(nodes[1]).toBe(foo);
    expect(nodes[2]).toBe(bar);
    expect(foo.data).toBe('baz');
    expect(bar.data).toBe('qux');
  });

  /** 测试场景：验证「can be toggled in and out of the markup」描述的渲染、交互或错误处理结果。 */
  it('can be toggled in and out of the markup', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          {'foo'}
          <div />
          {'bar'}
        </div>,
      );
    });
    let inst = container.firstChild;

    let childNodes = inst.childNodes;
    const childDiv = childNodes[1];

    await act(() => {
      root.render(
        <div>
          {null}
          <div />
          {null}
        </div>,
      );
    });
    inst = container.firstChild;
    childNodes = inst.childNodes;
    expect(childNodes.length).toBe(1);
    expect(childNodes[0]).toBe(childDiv);

    await act(() => {
      root.render(
        <div>
          {'foo'}
          <div />
          {'bar'}
        </div>,
      );
    });
    inst = container.firstChild;
    childNodes = inst.childNodes;
    expect(childNodes.length).toBe(3);
    expect(childNodes[0].data).toBe('foo');
    expect(childNodes[1]).toBe(childDiv);
    expect(childNodes[2].data).toBe('bar');
  });

  /**
   * 下列Node.normalize()测试故意失败. 查看https://github.com/facebook/react/issues/9836 追踪我们
   * 是否需要修复这个或如果它是不必要的.
   */
  // @gate TODO
  /** 测试场景：验证「can reconcile text merged by Node.normalize() alongside other elements」描述的渲染、交互或错误处理结果。 */
  it('can reconcile text merged by Node.normalize() alongside other elements', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          {'foo'}
          {'bar'}
          {'baz'}
          <span />
          {'qux'}
        </div>,
      );
    });

    const inst = container.firstChild;

    inst.normalize();

    await act(() => {
      root.render(
        <div>
          {'bar'}
          {'baz'}
          {'qux'}
          <span />
          {'foo'}
        </div>,
        container,
      );
    });
    expect(inst.textContent).toBe('barbazquxfoo');
  });

  // @gate TODO
  /** 测试场景：验证「can reconcile text merged by Node.normalize()」描述的渲染、交互或错误处理结果。 */
  it('can reconcile text merged by Node.normalize()', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          {'foo'}
          {'bar'}
          {'baz'}
        </div>,
      );
    });
    let inst = container.firstChild;

    inst.normalize();

    await act(() => {
      root.render(
        <div>
          {'bar'}
          {'baz'}
          {'qux'}
        </div>,
        container,
      );
    });
    inst = container.firstChild;
    expect(inst.textContent).toBe('barbazqux');
  });

  /** 测试场景：验证「can reconcile text from pre-rendered markup」描述的渲染、交互或错误处理结果。 */
  it('can reconcile text from pre-rendered markup', async () => {
    const container = document.createElement('div');
    let children = (
      <div>
        {'foo'}
        {'bar'}
        {'baz'}
      </div>
    );
    container.innerHTML = ReactDOMServer.renderToString(children);

    const root = await act(() => {
      return ReactDOMClient.hydrateRoot(container, children);
    });
    expect(container.textContent).toBe('foobarbaz');

    await act(() => {
      root.unmount();
    });

    children = (
      <div>
        {''}
        {''}
        {''}
      </div>
    );
    container.innerHTML = ReactDOMServer.renderToString(children);

    await act(() => {
      ReactDOMClient.hydrateRoot(container, children);
    });
    expect(container.textContent).toBe('');
  });

  // @gate TODO
  /** 测试场景：验证「can reconcile text arbitrarily split into multiple nodes」描述的渲染、交互或错误处理结果。 */
  it('can reconcile text arbitrarily split into multiple nodes', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div>
          <span />
          {'foobarbaz'}
        </div>,
      );
    });
    let inst = container.firstChild;

    const childNodes = inst.childNodes;
    const textNode = childNodes[1];
    textNode.textContent = 'foo';
    inst.insertBefore(
      document.createTextNode('bar'),
      childNodes[1].nextSibling,
    );
    inst.insertBefore(
      document.createTextNode('baz'),
      childNodes[1].nextSibling,
    );

    await act(() => {
      root.render(
        <div>
          <span />
          {'barbazqux'}
        </div>,
        container,
      );
    });
    inst = container.firstChild;
    expect(inst.textContent).toBe('barbazqux');
  });

  // @gate TODO
  /** 测试场景：验证「can reconcile text arbitrarily split into multiple nodes on some substitutions only」描述的渲染、交互或错误处理结果。 */
  it('can reconcile text arbitrarily split into multiple nodes on some substitutions only', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <span />
          {'bar'}
          <span />
          {'foobarbaz'}
          {'foo'}
          {'barfoo'}
          <span />
        </div>,
      );
    });

    let inst = container.firstChild;

    const childNodes = inst.childNodes;
    const textNode = childNodes[3];
    textNode.textContent = 'foo';
    inst.insertBefore(
      document.createTextNode('bar'),
      childNodes[3].nextSibling,
    );
    inst.insertBefore(
      document.createTextNode('baz'),
      childNodes[3].nextSibling,
    );
    const secondTextNode = childNodes[5];
    secondTextNode.textContent = 'bar';
    inst.insertBefore(
      document.createTextNode('foo'),
      childNodes[5].nextSibling,
    );

    await act(() => {
      root.render(
        <div>
          <span />
          {'baz'}
          <span />
          {'barbazqux'}
          {'bar'}
          {'bazbar'}
          <span />
        </div>,
        container,
      );
    });
    inst = container.firstChild;
    expect(inst.textContent).toBe('bazbarbazquxbarbazbar');
  });

  // @gate TODO
  /** 测试场景：验证「can unmount normalized text nodes」描述的渲染、交互或错误处理结果。 */
  it('can unmount normalized text nodes', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          {''}
          {'foo'}
          {'bar'}
        </div>,
      );
    });

    container.normalize();
    await act(() => {
      root.render(<div />);
    });

    expect(container.innerHTML).toBe('<div></div>');
  });

  /** 测试场景：验证「throws for Temporal-like text nodes」描述的渲染、交互或错误处理结果。 */
  it('throws for Temporal-like text nodes', async () => {
    const container = document.createElement('div');
    /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TemporalLike {
      /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return '2020-01-01';
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<div>{new TemporalLike()}</div>);
      }),
    ).rejects.toThrowError(
      new Error(
        'Objects are not valid as a React child (found: object with keys {}).' +
          ' If you meant to render a collection of children, use an array instead.',
      ),
    );
  });
});
