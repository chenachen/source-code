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
let act;
let root;

/** 生成有两个叶div的子树，各宿主监听capture/bubble/enter/leave并把currentTarget.id传给共享mock；id前缀区分跨组件祖先。 */
const ChildComponent = ({id, eventHandler}) => (
  <div
    id={id + '__DIV'}
    onClickCapture={e => eventHandler(e.currentTarget.id, 'captured', e.type)}
    onClick={e => eventHandler(e.currentTarget.id, 'bubbled', e.type)}
    onMouseEnter={e => eventHandler(e.currentTarget.id, e.type)}
    onMouseLeave={e => eventHandler(e.currentTarget.id, e.type)}>
    <div
      id={id + '__DIV_1'}
      onClickCapture={e => eventHandler(e.currentTarget.id, 'captured', e.type)}
      onClick={e => eventHandler(e.currentTarget.id, 'bubbled', e.type)}
      onMouseEnter={e => eventHandler(e.currentTarget.id, e.type)}
      onMouseLeave={e => eventHandler(e.currentTarget.id, e.type)}
    />
    <div
      id={id + '__DIV_2'}
      onClickCapture={e => eventHandler(e.currentTarget.id, 'captured', e.type)}
      onClick={e => eventHandler(e.currentTarget.id, 'bubbled', e.type)}
      onMouseEnter={e => eventHandler(e.currentTarget.id, e.type)}
      onMouseLeave={e => eventHandler(e.currentTarget.id, e.type)}
    />
  </div>
);

/** 生成P、P_P1、两个Child与P_OneOff，所有宿主使用同一记录器，供比较事件传播路径与共同祖先差集。 */
const ParentComponent = ({eventHandler}) => (
  <div
    id="P"
    onClickCapture={e => eventHandler(e.currentTarget.id, 'captured', e.type)}
    onClick={e => eventHandler(e.currentTarget.id, 'bubbled', e.type)}
    onMouseEnter={e => eventHandler(e.currentTarget.id, e.type)}
    onMouseLeave={e => eventHandler(e.currentTarget.id, e.type)}>
    <div
      id="P_P1"
      onClickCapture={e => eventHandler(e.currentTarget.id, 'captured', e.type)}
      onClick={e => eventHandler(e.currentTarget.id, 'bubbled', e.type)}
      onMouseEnter={e => eventHandler(e.currentTarget.id, e.type)}
      onMouseLeave={e => eventHandler(e.currentTarget.id, e.type)}>
      <ChildComponent id="P_P1_C1" eventHandler={eventHandler} />
      <ChildComponent id="P_P1_C2" eventHandler={eventHandler} />
    </div>
    <div
      id="P_OneOff"
      onClickCapture={e => eventHandler(e.currentTarget.id, 'captured', e.type)}
      onClick={e => eventHandler(e.currentTarget.id, 'bubbled', e.type)}
      onMouseEnter={e => eventHandler(e.currentTarget.id, e.type)}
      onMouseLeave={e => eventHandler(e.currentTarget.id, e.type)}
    />
  </div>
);

describe('ReactTreeTraversal', () => {
  const mockFn = jest.fn();
  let container;
  let outerNode1;
  let outerNode2;

  beforeEach(async () => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    mockFn.mockReset();

    container = document.createElement('div');
    outerNode1 = document.createElement('div');
    outerNode2 = document.createElement('div');
    document.body.appendChild(container);
    document.body.appendChild(outerNode1);
    document.body.appendChild(outerNode2);

    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ParentComponent eventHandler={mockFn} />);
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    document.body.removeChild(outerNode1);
    document.body.removeChild(outerNode2);
    container = null;
    outerNode1 = null;
    outerNode2 = null;
  });

  describe('Two phase traversal', () => {
    /** 已挂根树之外outerNode1派冒泡click；共享监听mock零次，验证根容器监听不遍历外部目标。 */
    it('should not traverse when target is outside component boundary', () => {
      outerNode1.dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true}),
      );

      expect(mockFn).not.toHaveBeenCalled();
    });

    /** 最深P_P1_C1__DIV_1派click；顺序应P→P_P1→C1→目标capture，再目标→C1→P_P1→P bubble，验证跨函数组件的宿主祖先两阶段收集。 */
    it('should traverse two phase across component boundary', () => {
      const expectedCalls = [
        ['P', 'captured', 'click'],
        ['P_P1', 'captured', 'click'],
        ['P_P1_C1__DIV', 'captured', 'click'],
        ['P_P1_C1__DIV_1', 'captured', 'click'],

        ['P_P1_C1__DIV_1', 'bubbled', 'click'],
        ['P_P1_C1__DIV', 'bubbled', 'click'],
        ['P_P1', 'bubbled', 'click'],
        ['P', 'bubbled', 'click'],
      ];

      const node = document.getElementById('P_P1_C1__DIV_1');
      node.dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true}),
      );

      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });

    /** 最浅P自身派click；仅P capture随后P bubble，验证目标同时参与两阶段而无虚构祖先。 */
    it('should traverse two phase at shallowest node', () => {
      const node = document.getElementById('P');
      node.dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true}),
      );

      const expectedCalls = [
        ['P', 'captured', 'click'],
        ['P', 'bubbled', 'click'],
      ];
      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });
  });

  describe('Enter leave traversal', () => {
    /** 两个非React外部节点间mouseout；mock零次，验证根外移动不生成树内enter/leave。 */
    it('should not traverse when enter/leaving outside DOM', () => {
      outerNode1.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: outerNode2,
        }),
      );

      expect(mockFn).not.toHaveBeenCalled();
    });

    /** 同一React节点mouseout且relatedTarget指向自身；mock零次，验证from/to相同直接无差集。 */
    it('should not traverse if enter/leave the same node', () => {
      const leaveNode = document.getElementById('P_P1_C1__DIV_1');
      const enterNode = document.getElementById('P_P1_C1__DIV_1');

      leaveNode.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: enterNode,
        }),
      );

      expect(mockFn).not.toHaveBeenCalled();
    });

    /** C1的DIV_1移到兄弟DIV_2；仅旧节点leave、新节点enter，公共父级不触发，验证最小共同祖先排除。 */
    it('should traverse enter/leave to sibling - avoids parent', () => {
      const leaveNode = document.getElementById('P_P1_C1__DIV_1');
      const enterNode = document.getElementById('P_P1_C1__DIV_2');

      const expectedCalls = [
        ['P_P1_C1__DIV_1', 'mouseleave'],
        // enter/leave 不应在父节点上触发任何监听器。
        ['P_P1_C1__DIV_2', 'mouseenter'],
      ];

      leaveNode.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: enterNode,
        }),
      );

      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });

    /** C1的DIV_1移到自身父DIV；仅子leave，父无enter，验证向共同祖先移动的差集。 */
    it('should traverse enter/leave to parent - avoids parent', () => {
      const leaveNode = document.getElementById('P_P1_C1__DIV_1');
      const enterNode = document.getElementById('P_P1_C1__DIV');

      const expectedCalls = [['P_P1_C1__DIV_1', 'mouseleave']];

      leaveNode.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: enterNode,
        }),
      );

      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });

    // 外部节点不在根监听范围；用进入目标的mouseover承载事件，relatedTarget仍指向外部节点。
    /** 从外部节点进入C1父DIV，以目标mouseover承载原生事件；合成enter为P→P_P1→C1，验证从窗口侧进入按外到内遍历。 */
    it('should enter from the window', () => {
      const enterNode = document.getElementById('P_P1_C1__DIV');

      const expectedCalls = [
        ['P', 'mouseenter'],
        ['P_P1', 'mouseenter'],
        ['P_P1_C1__DIV', 'mouseenter'],
      ];

      enterNode.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: outerNode1,
        }),
      );

      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });

    /** 外部进入最浅P，派mouseover；仅P enter，验证浅根进入。 */
    it('should enter from the window to the shallowest', () => {
      const enterNode = document.getElementById('P');

      const expectedCalls = [['P', 'mouseenter']];

      enterNode.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: outerNode1,
        }),
      );

      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });

    /** C1父DIV移到外部节点，派mouseout；leave为C1→P_P1→P，验证离开树按内到外遍历。 */
    it('should leave to the window', () => {
      const leaveNode = document.getElementById('P_P1_C1__DIV');

      const expectedCalls = [
        ['P_P1_C1__DIV', 'mouseleave'],
        ['P_P1', 'mouseleave'],
        ['P', 'mouseleave'],
      ];

      leaveNode.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: outerNode1,
        }),
      );

      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });

    /** 最浅P移到外部节点；仅P leave，验证浅根离开。 */
    it('should leave to the window from the shallowest', () => {
      const leaveNode = document.getElementById('P');

      const expectedCalls = [['P', 'mouseleave']];

      leaveNode.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: outerNode1,
        }),
      );

      expect(mockFn.mock.calls).toEqual(expectedCalls);
    });
  });
});
