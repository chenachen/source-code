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

  /** div内span之后有foo/bar两个独立文本子级，更新为baz/qux；两个Text对象身份不变且data分别改变，验证HostText原位nodeValue更新。 */
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

  /** div中foo/中间div/bar更新为null/div/null再恢复文本；中间DIV身份始终保留，节点数按3→1→3，验证空值切换移除/新建文本而保留元素。 */
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
   * Node.normalize() 会合并或删除 React 跟踪的文本节点。下列用例以 TODO gate 记录
   * 尚未支持的外部 DOM 改动场景：https://github.com/facebook/react/issues/9836。
   */
  // @gate TODO

  /** 此定义受 TODO gate 控制，当前未作为已支持行为执行；先挂载三段文本、span及尾文本，外部normalize合并后更新字符串；预期barbazquxfoo，记录外部合并与元素混排的待支持恢复路径。 */
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

  /** 此定义受 TODO gate 控制，当前未执行；三段Text外部normalize后改为bar/baz/qux，预期barbazqux，记录Fiber跟踪节点被浏览器合并后的待支持更新。 */
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

  /** 先SSR三段foo/bar/baz并hydrate，文本应foobarbaz；卸载后SSR三段空字符串再hydrate，文本空，验证服务器文本分隔与空文本认领。 */
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

  /** 此定义受 TODO gate 控制，当前未执行；把span后的单Text外部改为foo并插入bar/baz节点，再更新为barbazqux；预期无外部残留文本，记录任意拆分的待支持修复。 */
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

  /** 此定义受 TODO gate 控制，当前未执行；元素间多个Text里只拆分部分节点，再更新各文本；预期bazbarbazquxbarbazbar，记录部分外部拆分与其它正常节点并存的待支持恢复。 */
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

  /** 此定义受 TODO gate 控制，当前未执行；相邻foo/bar经normalize后渲染空div；预期仅<div></div>，记录已合并Text卸载的待支持清理。 */
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

  /** TemporalLike提供抛错valueOf及成功toString，直接作为React child；act应拒绝对象不是合法child的Error，验证它先被child类型校验拒绝，本例不是属性转换TypeError路径。 */
  it('throws for Temporal-like text nodes', async () => {
    const container = document.createElement('div');

    /** 模拟有Temporal转换方法的普通对象；作为child应被对象类型检查拒绝，不进入文本转换。 */
    class TemporalLike {

      /** 若发生默认原始值转换则抛prod message；本场景期望在转换前拒绝对象child。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }

      /** 显式文本转换可返回日期，说明并非所有toString对象都可成为合法React child。 */
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
