/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMTestSelectors', () => {
  let React;
  let createRoot;
  let act;
  let createComponentSelector;
  let createHasPseudoClassSelector;
  let createRoleSelector;
  let createTextSelector;
  let createTestNameSelector;
  let findAllNodes;
  let findBoundingRects;
  let focusWithin;
  let getFindAllNodesFailureDescription;
  let observeVisibleRects;
  let mockIntersectionObserver;
  let simulateIntersection;
  let setBoundingClientRect;

  let container;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');

    act = require('internal-test-utils').act;

    if (__EXPERIMENTAL__ || global.__WWW__) {
      const ReactDOM = require('react-dom/unstable_testing');
      createComponentSelector = ReactDOM.createComponentSelector;
      createHasPseudoClassSelector = ReactDOM.createHasPseudoClassSelector;
      createRoleSelector = ReactDOM.createRoleSelector;
      createTextSelector = ReactDOM.createTextSelector;
      createTestNameSelector = ReactDOM.createTestNameSelector;
      findAllNodes = ReactDOM.findAllNodes;
      findBoundingRects = ReactDOM.findBoundingRects;
      focusWithin = ReactDOM.focusWithin;
      getFindAllNodesFailureDescription =
        ReactDOM.getFindAllNodesFailureDescription;
      observeVisibleRects = ReactDOM.observeVisibleRects;
      createRoot = ReactDOM.createRoot;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    const IntersectionMocks = require('./utils/IntersectionMocks');
    mockIntersectionObserver = IntersectionMocks.mockIntersectionObserver;
    simulateIntersection = IntersectionMocks.simulateIntersection;
    setBoundingClientRect = IntersectionMocks.setBoundingClientRect;
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('findAllNodes', () => {
    /** 挂载 Example 后从 document.body 按组件类型→testname=match 搜索；断言唯一节点 id=match，验证从文档子树发现 React 根再匹配路径。 */
    // @gate www || experimental
    it('should support searching from the document root', async () => {
      /** 返回含 id/testname=match 的嵌套 div，供文档入口的组件→testname 路径查找。 */
      function Example() {
        return (
          <div>
            <div data-testname="match" id="match" />
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createTestNameSelector('match'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match');
    });

    /** 挂载 Example 后直接从其 createRoot 容器搜索组件→match；唯一结果 id=match，验证容器入口可定位 React 树。 */
    // @gate www || experimental
    it('should support searching from the container', async () => {
      /** 返回 match DOM，让容器入口查询与文档入口使用同样的组件路径。 */
      function Example() {
        return (
          <div>
            <div data-testname="match" id="match" />
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(container, [
        createComponentSelector(Example),
        createTestNameSelector('match'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match');
    });

    /** 先匹配有 testname 的 Outer DOM，再以该节点搜索 Inner→inner；两个阶段分别只得 outer/inner，验证带 testname 的匹配节点可作为新的搜索根。 */
    // @gate www || experimental
    it('should support searching from a previous match if the match had a data-testname', async () => {
      /** 返回带 outer testname/id 的 div 包裹 Inner，提供可复用的宿主查询根。 */
      function Outer() {
        return (
          <div data-testname="outer" id="outer">
            <Inner />
          </div>
        );
      }

      /** 返回带 inner testname/id 的 div，供从 outer 匹配节点继续搜索。 */
      function Inner() {
        return <div data-testname="inner" id="inner" />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Outer />);
      });

      let matches = findAllNodes(container, [
        createComponentSelector(Outer),
        createTestNameSelector('outer'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('outer');

      matches = findAllNodes(matches[0], [
        createComponentSelector(Inner),
        createTestNameSelector('inner'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('inner');
    });

    /** Outer/Inner DOM 只有 id 没有 testname；先由组件 selector 得 Outer 节点，再以它搜索 Inner 时抛非法 host root 错误，验证普通匹配 DOM 不能直接作为查询入口。 */
    // @gate www || experimental
    it('should not support searching from a previous match if the match did not have a data-testname', async () => {
      /** 返回只有 id=outer 的普通 div，作为不能复用为查询根的对照。 */
      function Outer() {
        return (
          <div id="outer">
            <Inner />
          </div>
        );
      }

      /** 返回只有 id=inner 的 div，供无 testname 外层查询入口校验。 */
      function Inner() {
        return <div id="inner" />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Outer />);
      });

      const matches = findAllNodes(container, [createComponentSelector(Outer)]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('outer');

      expect(() => {
        findAllNodes(matches[0], [
          createComponentSelector(Inner),
          createTestNameSelector('inner'),
        ]);
      }).toThrow(
        'Invalid host root specified. Should be either a React container or a node with a testname attribute.',
      );
    });

    /** Outer/Middle/Inner 各输出 match；按 Outer→Middle 得 match2/3，再加入或跳过中间组件筛到 match3，验证 selector 数组按祖先到后代顺序递进而可跨层。 */
    // @gate www || experimental
    it('should support an multiple component types in the selector array', async () => {
      /** 返回 match1 与 Middle，作为多组件 selector 路径的最外层。 */
      function Outer() {
        return (
          <>
            <div data-testname="match" id="match1" />
            <Middle />
          </>
        );
      }
      /** 返回 match2 与 Inner，作为可筛选或跳过的中间组件层。 */
      function Middle() {
        return (
          <>
            <div data-testname="match" id="match2" />
            <Inner />
          </>
        );
      }
      /** 返回 Fragment 内 match3，作为最长组件 selector 链的末端。 */
      function Inner() {
        return (
          <>
            <div data-testname="match" id="match3" />
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Outer />);
      });

      let matches = findAllNodes(document.body, [
        createComponentSelector(Outer),
        createComponentSelector(Middle),
        createTestNameSelector('match'),
      ]);
      expect(matches).toHaveLength(2);
      expect(matches.map(m => m.id).sort()).toEqual(['match2', 'match3']);

      matches = findAllNodes(document.body, [
        createComponentSelector(Outer),
        createComponentSelector(Middle),
        createComponentSelector(Inner),
        createTestNameSelector('match'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match3');

      matches = findAllNodes(document.body, [
        createComponentSelector(Outer),
        createComponentSelector(Inner),
        createTestNameSelector('match'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match3');
    });

    /** 两个兄弟组件合计输出三个 match 节点；testname 查询得到三个不同 id，验证搜索覆盖根内多个匹配分支。 */
    // @gate www || experimental
    it('should find multiple matches', async () => {
      /** 返回含 match1 的 div，为多分支查询提供一个候选。 */
      function Example1() {
        return (
          <div>
            <div data-testname="match" id="match1" />
          </div>
        );
      }

      /** 返回 match2/3 两个候选，与 Example1 组成同根多匹配树。 */
      function Example2() {
        return (
          <div>
            <div data-testname="match" id="match2" />
            <div data-testname="match" id="match3" />
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(
          <>
            <Example1 />
            <Example2 />
          </>,
        );
      });

      const matches = findAllNodes(document.body, [
        createTestNameSelector('match'),
      ]);
      expect(matches).toHaveLength(3);
      expect(matches.map(m => m.id).sort()).toEqual([
        'match1',
        'match2',
        'match3',
      ]);
    });

    /** 父子 DOM 都带 match；从 Example 搜索只返回外层 match1，验证匹配子树根后不重复返回其嵌套同条件节点。 */
    // @gate www || experimental
    it('should ignore nested matches', async () => {
      /** 返回父子都标 match 的 DOM，供查询不重复收集嵌套匹配的验证。 */
      function Example() {
        return (
          <div data-testname="match" id="match1">
            <div data-testname="match" id="match2" />
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createTestNameSelector('match'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toEqual('match1');
    });

    /** 实际组件链为 Outer→Inner，逆序传 Inner→Outer→match；返回空数组，验证组件 selector 顺序不能颠倒。 */
    // @gate www || experimental
    it('should enforce the specific order of selectors', async () => {
      /** 输出自身 match1 与 Inner，构造 Outer→Inner 的实际组件顺序。 */
      function Outer() {
        return (
          <>
            <div data-testname="match" id="match1" />
            <Inner />
          </>
        );
      }
      /** 返回 match DOM，供逆序组件 selector 的失败对照。 */
      function Inner() {
        return <div data-testname="match" id="match1" />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Outer />);
      });

      expect(
        findAllNodes(document.body, [
          createComponentSelector(Inner),
          createComponentSelector(Outer),
          createTestNameSelector('match'),
        ]),
      ).toHaveLength(0);
    });

    /** Outer 同时含 hidden div 内 match 与可见 Inner match；查询只返回 ref2，验证隐藏子树被剪枝。 */
    // @gate www || experimental
    it('should not search within hidden subtrees', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      /** 包含 hidden 分支的 ref1 与可见 Inner，供查询隐藏剪枝。 */
      function Outer() {
        return (
          <>
            <div hidden={true}>
              <div ref={ref1} data-testname="match" />
            </div>
            <Inner />
          </>
        );
      }
      /** 返回 ref2 标记的可见 match，作为 hidden 分支之外应留下的结果。 */
      function Inner() {
        return <div ref={ref2} data-testname="match" />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Outer />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Outer),
        createTestNameSelector('match'),
      ]);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toBe(ref2.current);
    });

    /** Example 有 foo 和嵌套 bar，按组件→文本 bar 查询；唯一结果 id=match，验证显示文本 selector 定位对应宿主。 */
    // @gate www || experimental
    it('should support filtering by display text', async () => {
      /** 返回 foo 与嵌套 bar 的宿主内容，bar 节点 id=match，供文本 selector 定位。 */
      function Example() {
        return (
          <div>
            <div>foo</div>
            <div>
              <div id="match">bar</div>
            </div>
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createTextSelector('bar'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match');
    });

    /** 普通 div 显式 role=button 且 id=match；按 button role 查询得唯一节点，验证显式 ARIA role 匹配。 */
    // @gate www || experimental
    it('should support filtering by explicit accessibiliy role', async () => {
      /** 返回显式 role=button 的 div 及无 role 对照，供角色 selector 筛选。 */
      function Example() {
        return (
          <div>
            <div>foo</div>
            <div>
              <div role="button" id="match">
                bar
              </div>
            </div>
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createRoleSelector('button'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match');
    });

    /** div 的 role 列表为 meter progressbar；查询第二个 role progressbar 得 ref 当前节点，验证显式多角色属性匹配。 */
    // @gate www || experimental
    it('should support filtering by explicit secondary accessibiliy role', async () => {
      const ref = React.createRef();

      /** 返回 role=meter progressbar 的 ref 节点，供多角色属性的第二项匹配。 */
      function Example() {
        return (
          <div>
            <div>foo</div>
            <div>
              <div ref={ref} role="meter progressbar" />
            </div>
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createRoleSelector('progressbar'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toBe(ref.current);
    });

    /** 树中有真正的 button 与普通 div；按 button role 得 id=match，验证 HTML 标签的隐式可访问角色。 */
    // @gate www || experimental
    it('should support filtering by implicit accessibiliy role', async () => {
      /** 返回真正 button(id=match)，供标签隐式 role 查询。 */
      function Example() {
        return (
          <div>
            <div>foo</div>
            <div>
              <button id="match">bar</button>
            </div>
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createRoleSelector('button'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match');
    });

    /** 树中 input(type=checkbox) 与普通 div；按 checkbox role 得唯一 input，验证隐式角色受 type 属性限定。 */
    // @gate www || experimental
    it('should support filtering by implicit accessibiliy role with attributes qualifications', async () => {
      /** 返回 type=checkbox 的 input(id=match)，供属性限定的隐式角色匹配。 */
      function Example() {
        return (
          <div>
            <div>foo</div>
            <div>
              <input type="checkbox" id="match" value="bar" />
            </div>
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createRoleSelector('checkbox'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match');
    });

    /** 两个 article 内 heading 文本不同、各有 Like button；用 has(heading→Should match) 先筛 article 再查 button，只得 match，验证向前探查子路径约束当前候选。 */
    // @gate www || experimental
    it('should support searching ahead with the has() selector', async () => {
      /** 返回两个 article，heading 文本区分条件、button 区分最终结果，供 has 子路径筛选。 */
      function Example() {
        return (
          <div>
            <article>
              <h1>Should match</h1>
              <p>
                <button id="match">Like</button>
              </p>
            </article>
            <article>
              <h1>Should not match</h1>
              <p>
                <button>Like</button>
              </p>
            </article>
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const matches = findAllNodes(document.body, [
        createComponentSelector(Example),
        createRoleSelector('article'),
        createHasPseudoClassSelector([
          createRoleSelector('heading'),
          createTextSelector('Should match'),
        ]),
        createRoleSelector('button'),
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('match');
    });

    /** 当前 document.body 内未建 React 根；调用 findAllNodes(body,[]) 抛找不到容器错误，验证搜索入口的根发现失败。 */
    // @gate www || experimental
    it('should throw if no container can be found', () => {
      expect(() => findAllNodes(document.body, [])).toThrow(
        'Could not find React container within specified host subtree.',
      );
    });

    /** 已挂载的普通 div 无 testname；把 ref.current 当查询根时抛 host root 错误，验证入口必须是容器或带 testname 的节点。 */
    // @gate www || experimental
    it('should throw if an invalid host root is specified', async () => {
      const ref = React.createRef();
      /** 返回未带 testname 的 ref div，作为非法宿主查询根输入。 */
      function Example() {
        return <div ref={ref} />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      expect(() => findAllNodes(ref.current, [])).toThrow(
        'Invalid host root specified. Should be either a React container or a node with a testname attribute.',
      );
    });
  });

  describe('getFindAllNodesFailureDescription', () => {
    /** 实际链为 Outer→Middle，目标 selector 还要求未挂载 NotRendered→match；失败说明精确列出已匹配前缀和未匹配后缀，验证诊断的路径分割。 */
    // @gate www || experimental
    it('should describe findAllNodes failures caused by the component type selector', async () => {
      /** 返回 Middle 建立实际已匹配的组件路径前缀。 */
      function Outer() {
        return <Middle />;
      }
      /** 返回 div 终止实际组件链，不包含目标 NotRendered。 */
      function Middle() {
        return <div />;
      }
      /** 未被挂载的组件类型，返回 match div；只作为失败 selector 的类型输入。 */
      function NotRendered() {
        return <div data-testname="match" />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Outer />);
      });

      const description = getFindAllNodesFailureDescription(document.body, [
        createComponentSelector(Outer),
        createComponentSelector(Middle),
        createComponentSelector(NotRendered),
        createTestNameSelector('match'),
      ]);

      expect(description).toEqual(
        `findAllNodes was able to match part of the selector:
  <Outer> > <Middle>

No matching component was found for:
  <NotRendered> > [data-testname="match"]`,
      );
    });

    /** Example 已挂载且组件 selector 有结果；失败说明返回 null，验证成功查询不生成失败描述。 */
    // @gate www || experimental
    it('should return null if findAllNodes was able to find a match', async () => {
      /** 返回含 match 的 div，供成功查询时失败说明为 null 的对照。 */
      function Example() {
        return (
          <div>
            <div data-testname="match" id="match" />
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const description = getFindAllNodesFailureDescription(document.body, [
        createComponentSelector(Example),
      ]);

      expect(description).toBe(null);
    });
  });

  describe('findBoundingRects', () => {
    /** Example 只有一个根 div，尺寸替身设为(10,20,200,100)；findBoundingRects 只返回该矩形，验证单宿主根的测量映射。 */
    // @gate www || experimental
    it('should return a single rect for a component that returns a single root host element', async () => {
      const ref = React.createRef();

      /** 返回 ref 标记的单根 div，其内部 div 不形成额外根矩形。 */
      function Example() {
        return (
          <div ref={ref}>
            <div />
            <div />
          </div>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      setBoundingClientRect(ref.current, {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      });

      const rects = findBoundingRects(document.body, [
        createComponentSelector(Example),
      ]);
      expect(rects).toHaveLength(1);
      expect(rects).toContainEqual({
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      });
    });

    /** Outer 返回自身 div 与 Inner div，替身矩形部分重叠但互不包含；得到两个原矩形，验证多个顶层宿主候选不被任意合成外包框。 */
    // @gate www || experimental
    it('should return a multiple rects for multiple matches', async () => {
      const outerRef = React.createRef();
      const innerRef = React.createRef();

      /** 返回自身 ref div 与 Inner，提供两个独立顶层宿主测量目标。 */
      function Outer() {
        return (
          <>
            <div ref={outerRef} />
            <Inner />
          </>
        );
      }
      /** 返回 innerRef div，作为 Outer 组件匹配内的第二顶层宿主。 */
      function Inner() {
        return <div ref={innerRef} />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Outer />);
      });

      setBoundingClientRect(outerRef.current, {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      });
      setBoundingClientRect(innerRef.current, {
        x: 110,
        y: 120,
        width: 250,
        height: 150,
      });

      const rects = findBoundingRects(document.body, [
        createComponentSelector(Outer),
      ]);
      expect(rects).toHaveLength(2);
      expect(rects).toContainEqual({
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      });
      expect(rects).toContainEqual({
        x: 110,
        y: 120,
        width: 250,
        height: 150,
      });
    });

    /** 一个 Example 返回两个 Fragment 顶层 div；替身赋不同尺寸后得到两矩形，验证组件单匹配可展开多个宿主根而忽略各根内部子节点。 */
    // @gate www || experimental
    it('should return a multiple rects for single match that returns a fragment', async () => {
      const refA = React.createRef();
      const refB = React.createRef();

      /** 返回含内部子 div 的 refA 与独立 refB 两个 Fragment 根，供宿主根展开。 */
      function Example() {
        return (
          <>
            <div ref={refA}>
              <div />
              <div />
            </div>
            <div ref={refB} />
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      setBoundingClientRect(refA.current, {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      });
      setBoundingClientRect(refB.current, {
        x: 110,
        y: 120,
        width: 250,
        height: 150,
      });

      const rects = findBoundingRects(document.body, [
        createComponentSelector(Example),
      ]);
      expect(rects).toHaveLength(2);
      expect(rects).toContainEqual({
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      });
      expect(rects).toContainEqual({
        x: 110,
        y: 120,
        width: 250,
        height: 150,
      });
    });

    /** 三个宿主矩形中 B 完全包含于 A，C 与 A 分离；查询只保留 A/C 两个矩形，验证冗余包含矩形消除。 */
    // @gate www || experimental
    it('should merge overlapping rects', async () => {
      const refA = React.createRef();
      const refB = React.createRef();
      const refC = React.createRef();

      /** 返回三个 ref div，对应大矩形、被包含小矩形和分离矩形。 */
      function Example() {
        return (
          <>
            <div ref={refA} />
            <div ref={refB} />
            <div ref={refC} />
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      setBoundingClientRect(refA.current, {
        x: 10,
        y: 10,
        width: 50,
        height: 25,
      });
      setBoundingClientRect(refB.current, {
        x: 10,
        y: 10,
        width: 20,
        height: 10,
      });
      setBoundingClientRect(refC.current, {
        x: 100,
        y: 10,
        width: 50,
        height: 25,
      });

      const rects = findBoundingRects(document.body, [
        createComponentSelector(Example),
      ]);
      expect(rects).toHaveLength(2);
      expect(rects).toContainEqual({
        x: 10,
        y: 10,
        width: 50,
        height: 25,
      });
      expect(rects).toContainEqual({
        x: 100,
        y: 10,
        width: 50,
        height: 25,
      });
    });

    /** A/B/C 同高且相接或重叠，E/F/G 同宽纵向相接，D高度不同；断言合成横向90×25、纵向25×85及独立D三个矩形，验证只合并符合维度条件的相邻区间。 */
    // @gate www || experimental
    it('should merge some types of adjacent rects (if they are the same in one dimension)', async () => {
      const refA = React.createRef();
      const refB = React.createRef();
      const refC = React.createRef();
      const refD = React.createRef();
      const refE = React.createRef();
      const refF = React.createRef();
      const refG = React.createRef();

      /** 返回 A到G 七个带debug标记的 ref div，供横向/纵向合并及高度不匹配对照。 */
      function Example() {
        return (
          <>
            <div ref={refA} data-debug="A" />
            <div ref={refB} data-debug="B" />
            <div ref={refC} data-debug="C" />
            <div ref={refD} data-debug="D" />
            <div ref={refE} data-debug="E" />
            <div ref={refF} data-debug="F" />
            <div ref={refG} data-debug="G" />
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      // A、B、C 彼此相邻或重叠，并且高度相同。
      setBoundingClientRect(refA.current, {
        x: 30,
        y: 0,
        width: 40,
        height: 25,
      });
      setBoundingClientRect(refB.current, {
        x: 0,
        y: 0,
        width: 50,
        height: 25,
      });
      setBoundingClientRect(refC.current, {
        x: 70,
        y: 0,
        width: 20,
        height: 25,
      });

      // 部分 D 与 A 和 B 重叠, 但太高了不能合并.
      setBoundingClientRect(refD.current, {
        x: 20,
        y: 0,
        width: 20,
        height: 30,
      });

      // 竖直组的情况也一样。其中一些本可与水平组相交，只是它们的位置过于靠右。
      setBoundingClientRect(refE.current, {
        x: 100,
        y: 25,
        width: 25,
        height: 50,
      });
      setBoundingClientRect(refF.current, {
        x: 100,
        y: 0,
        width: 25,
        height: 25,
      });
      setBoundingClientRect(refG.current, {
        x: 100,
        y: 75,
        width: 25,
        height: 10,
      });

      const rects = findBoundingRects(document.body, [
        createComponentSelector(Example),
      ]);
      expect(rects).toHaveLength(3);
      expect(rects).toContainEqual({
        x: 0,
        y: 0,
        width: 90,
        height: 25,
      });
      expect(rects).toContainEqual({
        x: 20,
        y: 0,
        width: 20,
        height: 30,
      });
      expect(rects).toContainEqual({
        x: 100,
        y: 0,
        width: 25,
        height: 85,
      });
    });

    /** 三个兄弟 div 中中间 hidden；替身提供全部尺寸后仅返回两个可见矩形，验证测量查询先过滤隐藏子树。 */
    // @gate www || experimental
    it('should not search within hidden subtrees', async () => {
      const refA = React.createRef();
      const refB = React.createRef();
      const refC = React.createRef();

      /** 返回可见A、hiddenB、可见C，供 findBoundingRects 隐藏过滤。 */
      function Example() {
        return (
          <>
            <div ref={refA} />
            <div hidden={true} ref={refB} />
            <div ref={refC} />
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      setBoundingClientRect(refA.current, {
        x: 10,
        y: 10,
        width: 50,
        height: 25,
      });
      setBoundingClientRect(refB.current, {
        x: 100,
        y: 10,
        width: 20,
        height: 10,
      });
      setBoundingClientRect(refC.current, {
        x: 200,
        y: 10,
        width: 50,
        height: 25,
      });

      const rects = findBoundingRects(document.body, [
        createComponentSelector(Example),
      ]);
      expect(rects).toHaveLength(2);
      expect(rects).toContainEqual({
        x: 10,
        y: 10,
        width: 50,
        height: 25,
      });
      expect(rects).toContainEqual({
        x: 200,
        y: 10,
        width: 50,
        height: 25,
      });
    });
  });

  describe('focusWithin', () => {
    /** Example 实际只渲染 Child，却查询未使用 NotUsed；focusWithin 返回 false，验证不存在的组件路径不能发起聚焦。 */
    // @gate www || experimental
    it('should return false if the specified component path has no matches', async () => {
      /** 只返回 Child，未包含 NotUsed，供 focusWithin 路径不存在的对照。 */
      function Example() {
        return <Child />;
      }
      /** 返回 null，不产生可聚焦 DOM；路径失败用例中作为实际后代。 */
      function Child() {
        return null;
      }
      /** 返回 null且不被渲染，只作为 focusWithin 未匹配组件类型。 */
      function NotUsed() {
        return null;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const didFocus = focusWithin(document.body, [
        createComponentSelector(Example),
        createComponentSelector(NotUsed),
      ]);
      expect(didFocus).toBe(false);
    });

    /** 匹配的 Child 只返回纯文本；focusWithin 返回 false，验证找到组件也须存在可聚焦宿主。 */
    // @gate www || experimental
    it('should return false if there are no focusable elements within the matched subtree', async () => {
      /** 返回 Child，提供确实匹配但没有可聚焦宿主的组件路径。 */
      function Example() {
        return <Child />;
      }
      /** 返回纯文本 not focusable，不创建可接收焦点的元素。 */
      function Child() {
        return 'not focusable';
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const didFocus = focusWithin(document.body, [
        createComponentSelector(Example),
        createComponentSelector(Child),
      ]);
      expect(didFocus).toBe(false);
    });

    /** 唯一 button 被 disabled，查询 Example 的 focusWithin 返回 false，验证禁用元素不被选中。 */
    // @gate www || experimental
    it('should return false if the only focusable elements are disabled', async () => {
      /** 返回带 disabled 的 button，提供有标签但不可聚焦的对照目标。 */
      function Example() {
        return (
          <button disabled={true} style={{width: 10, height: 10}}>
            not clickable
          </button>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const didFocus = focusWithin(document.body, [
        createComponentSelector(Example),
      ]);
      expect(didFocus).toBe(false);
    });

    /** 唯一 button 设置 hidden，focusWithin 返回 false，验证隐藏目标不参与聚焦。 */
    // @gate www || experimental
    it('should return false if the only focusable elements are hidden', async () => {
      /** 返回 hidden button，供 focusWithin 隐藏过滤。 */
      function Example() {
        return <button hidden={true}>not clickable</button>;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const didFocus = focusWithin(document.body, [
        createComponentSelector(Example),
      ]);
      expect(didFocus).toBe(false);
    });

    /** 依次为 hidden button、可见 second/third button；focusWithin 返回 true且 activeElement 为 second、只有 second onFocus 一次，验证按树顺序选择首个可聚焦目标。 */
    // @gate www || experimental
    it('should successfully focus the first focusable element within the tree', async () => {
      const secondRef = React.createRef(null);

      const handleFirstFocus = jest.fn();
      const handleSecondFocus = jest.fn();
      const handleThirdFocus = jest.fn();

      /** 依序返回 First/Second/ThirdChild，供首个可聚焦目标选择。 */
      function Example() {
        return (
          <>
            <FirstChild />
            <SecondChild />
            <ThirdChild />
          </>
        );
      }
      /** 返回 hidden button 并注册首回调，用于证明该候选被跳过。 */
      function FirstChild() {
        return (
          <button hidden={true} onFocus={handleFirstFocus}>
            not clickable
          </button>
        );
      }
      /** 返回可见 secondRef button 与焦点回调，作为预期首个可聚焦目标。 */
      function SecondChild() {
        return (
          <button
            ref={secondRef}
            style={{width: 10, height: 10}}
            onFocus={handleSecondFocus}>
            clickable
          </button>
        );
      }
      /** 返回另一个可见 button，作为成功聚焦后不继续搜索的对照。 */
      function ThirdChild() {
        return (
          <button style={{width: 10, height: 10}} onFocus={handleThirdFocus}>
            clickable
          </button>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const didFocus = focusWithin(document.body, [
        createComponentSelector(Example),
      ]);
      expect(didFocus).toBe(true);
      expect(document.activeElement).not.toBeNull();
      expect(document.activeElement).toBe(secondRef.current);
      expect(handleFirstFocus).not.toHaveBeenCalled();
      expect(handleSecondFocus).toHaveBeenCalledTimes(1);
      expect(handleThirdFocus).not.toHaveBeenCalled();
    });

    /** 唯一 button 的 onFocus 立即 blur；focusWithin 仍返回 true而目标不是最终 activeElement，回调一次，验证返回值表示成功触发 focus 而非应用回调后的焦点持久状态。 */
    // @gate www || experimental
    it('should successfully focus the first focusable element even if application logic interferes', async () => {
      const ref = React.createRef(null);

      const handleFocus = jest.fn(event => {
        event.target.blur();
      });

      /** 返回可见 ref button，其共享 onFocus 会立即 blur，用于区别成功发起焦点与最终 activeElement。 */
      function Example() {
        return (
          <button
            ref={ref}
            style={{width: 10, height: 10}}
            onFocus={handleFocus}>
            clickable
          </button>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const didFocus = focusWithin(document.body, [
        createComponentSelector(Example),
      ]);
      expect(didFocus).toBe(true);
      expect(ref.current).not.toBeNull();
      expect(ref.current).not.toBe(document.activeElement);
      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    /** 首分支 button 的祖先 div hidden，second/third 可见；focusWithin 选 second 且仅其 onFocus 一次，验证隐藏祖先剪枝后继续查后续分支。 */
    // @gate www || experimental
    it('should not focus within hidden subtrees', async () => {
      const secondRef = React.createRef(null);

      const handleFirstFocus = jest.fn();
      const handleSecondFocus = jest.fn();
      const handleThirdFocus = jest.fn();

      /** 依序返回隐藏祖先分支及两个可见按钮分支，供子树剪枝后继续搜索。 */
      function Example() {
        return (
          <>
            <FirstChild />
            <SecondChild />
            <ThirdChild />
          </>
        );
      }
      /** 在 hidden div 中返回 button，验证隐藏祖先让该后代不参与聚焦。 */
      function FirstChild() {
        return (
          <div hidden={true}>
            <button style={{width: 10, height: 10}} onFocus={handleFirstFocus}>
              hidden
            </button>
          </div>
        );
      }
      /** 返回 secondRef 的可见 button，作为剪掉前分支后的预期结果。 */
      function SecondChild() {
        return (
          <button
            ref={secondRef}
            style={{width: 10, height: 10}}
            onFocus={handleSecondFocus}>
            clickable
          </button>
        );
      }
      /** 返回第三可见 button，供只触发首个成功候选的对照。 */
      function ThirdChild() {
        return (
          <button style={{width: 10, height: 10}} onFocus={handleThirdFocus}>
            clickable
          </button>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      const didFocus = focusWithin(document.body, [
        createComponentSelector(Example),
      ]);
      expect(didFocus).toBe(true);
      expect(document.activeElement).not.toBeNull();
      expect(document.activeElement).toBe(secondRef.current);
      expect(handleFirstFocus).not.toHaveBeenCalled();
      expect(handleSecondFocus).toHaveBeenCalledTimes(1);
      expect(handleThirdFocus).not.toHaveBeenCalled();
    });
  });

  describe('observeVisibleRects', () => {
    let observerMock;

    beforeEach(() => {
      observerMock = mockIntersectionObserver();
    });

    /** 给单 div 设置测量矩形并订阅 observeVisibleRects；初始只注册目标、无回调，模拟 ratio=.5 后回调一次且包含该 rect/ratio，验证 IntersectionObserver 通知转成 selector 观测结果。 */
    // @gate www || experimental
    it('should notify a listener when the underlying instance intersection changes', async () => {
      const ref = React.createRef(null);

      /** 返回单个 ref div，供可见性 observer 记录测量目标。 */
      function Example() {
        return <div ref={ref} />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      // 模拟本测试所观察元素的尺寸。
      const rect = {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      };
      setBoundingClientRect(ref.current, rect);

      const handleVisibilityChange = jest.fn();
      observeVisibleRects(
        document.body,
        [createComponentSelector(Example)],
        handleVisibilityChange,
      );

      expect(observerMock.callback).not.toBeNull();
      expect(observerMock.observedTargets).toHaveLength(1);
      expect(handleVisibilityChange).not.toHaveBeenCalled();

      // 模拟 IntersectionObserver 通知。
      simulateIntersection([ref.current, rect, 0.5]);

      expect(handleVisibilityChange).toHaveBeenCalledTimes(1);
      expect(handleVisibilityChange).toHaveBeenCalledWith([{rect, ratio: 0.5}]);
    });

    /** 订阅两个目标，先只通知第一个 ratio=.5、第二个仍为0，再同时通知两者并改第二个尺寸；每轮返回全部当前目标状态，验证部分通知保留其他快照并更新改变的矩形。 */
    // @gate www || experimental
    it('should notify a listener of multiple targets when the underlying instance intersection changes', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      /** 返回 ref1/ref2 两个 Fragment 根，让观察回调一次包含全部目标快照。 */
      function Example() {
        return (
          <>
            <div ref={ref1} />
            <div ref={ref2} />
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      // 模拟本测试所观察元素的尺寸。
      const rect1 = {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      };
      let rect2 = {
        x: 210,
        y: 20,
        width: 200,
        height: 100,
      };
      setBoundingClientRect(ref1.current, rect1);
      setBoundingClientRect(ref2.current, rect2);

      const handleVisibilityChange = jest.fn();
      observeVisibleRects(
        document.body,
        [createComponentSelector(Example)],
        handleVisibilityChange,
      );

      expect(observerMock.callback).not.toBeNull();
      expect(observerMock.observedTargets).toHaveLength(2);
      expect(handleVisibilityChange).not.toHaveBeenCalled();

      // 模拟 IntersectionObserver 通知。
      simulateIntersection([ref1.current, rect1, 0.5]);

      // 尽管只有一个矩形的交集发生变化，测试选择器仍应描述两者的当前状态。
      expect(handleVisibilityChange).toHaveBeenCalledTimes(1);
      expect(handleVisibilityChange).toHaveBeenCalledWith([
        {rect: rect1, ratio: 0.5},
        {rect: rect2, ratio: 0},
      ]);

      handleVisibilityChange.mockClear();

      rect2 = {
        x: 210,
        y: 20,
        width: 200,
        height: 200,
      };

      // 模拟另一个 IntersectionObserver 通知。
      simulateIntersection(
        [ref1.current, rect1, 1],
        [ref2.current, rect2, 0.25],
      );

      // 还应为第二个目标提供刚发生变化的 display rect。
      expect(handleVisibilityChange).toHaveBeenCalledTimes(1);
      expect(handleVisibilityChange).toHaveBeenCalledWith([
        {rect: rect1, ratio: 1},
        {rect: rect2, ratio: 0.25},
      ]);
    });

    /** 单目标可见性订阅后 observerMock 有 callback；调用返回的 disconnect 后 callback 为 null，验证断开释放观察器注册；没有再次发送通知的断言。 */
    // @gate www || experimental
    it('should stop listening when its disconnected', async () => {
      const ref = React.createRef(null);

      /** 返回单 ref div，供 disconnect 清理观察器 callback。 */
      function Example() {
        return <div ref={ref} />;
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      // 模拟本测试所观察元素的尺寸。
      const rect = {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      };
      setBoundingClientRect(ref.current, rect);

      const handleVisibilityChange = jest.fn();
      const {disconnect} = observeVisibleRects(
        document.body,
        [createComponentSelector(Example)],
        handleVisibilityChange,
      );

      expect(observerMock.callback).not.toBeNull();
      expect(observerMock.observedTargets).toHaveLength(1);
      expect(handleVisibilityChange).not.toHaveBeenCalled();

      disconnect();
      expect(observerMock.callback).toBeNull();
    });

    // 该测试依赖仅在 __DEV__ 中存在的 commit hook，因此必须通过 gate 限定运行条件。
    /** DEV commit hook 下 count=0 只有 ref1，递增到1加入ref2、到2删除ref1；模拟通知后回调集合分别为一个、两个、只ref2，验证提交后观测目标集合随匹配宿主更新。 */
    // @gate www || experimental && __DEV__
    it('should update which targets its listening to after a commit', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      let increment;

      /** count 初始0，逐次增加后先加入ref2再删除ref1；外露 increment 供用例驱动 commit 后观察目标集合刷新。 */
      function Example() {
        const [count, setCount] = React.useState(0);
        /** 基于当前 render 的 count 提交下一数值，使后续树按0/1/2切换测量目标。 */
        increment = () => setCount(count + 1);
        return (
          <>
            {count < 2 && <div ref={ref1} />}
            {count > 0 && <div ref={ref2} />}
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      // 模拟本测试所观察元素的尺寸。
      const rect1 = {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      };
      setBoundingClientRect(ref1.current, rect1);

      const handleVisibilityChange = jest.fn();
      observeVisibleRects(
        document.body,
        [createComponentSelector(Example)],
        handleVisibilityChange,
      );

      // 模拟 IntersectionObserver 通知。
      simulateIntersection([ref1.current, rect1, 1]);

      expect(handleVisibilityChange).toHaveBeenCalledTimes(1);
      expect(handleVisibilityChange).toHaveBeenCalledWith([
        {rect: rect1, ratio: 1},
      ]);

      await act(() => increment());

      const rect2 = {
        x: 110,
        y: 20,
        width: 200,
        height: 100,
      };
      setBoundingClientRect(ref2.current, rect2);

      handleVisibilityChange.mockClear();

      simulateIntersection(
        [ref1.current, rect1, 0.5],
        [ref2.current, rect2, 0.25],
      );

      expect(handleVisibilityChange).toHaveBeenCalledTimes(1);
      expect(handleVisibilityChange).toHaveBeenCalledWith([
        {rect: rect1, ratio: 0.5},
        {rect: rect2, ratio: 0.25},
      ]);

      await act(() => increment());

      handleVisibilityChange.mockClear();

      simulateIntersection([ref2.current, rect2, 0.75]);

      expect(handleVisibilityChange).toHaveBeenCalledTimes(1);
      expect(handleVisibilityChange).toHaveBeenCalledWith([
        {rect: rect2, ratio: 0.75},
      ]);
    });

    /** 两个兄弟目标中 ref2 hidden；observeVisibleRects 只登记 ref1 一个目标，验证隐藏分支不进入 IntersectionObserver。 */
    // @gate www || experimental
    it('should not observe components within hidden subtrees', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      /** 返回可见ref1与hiddenref2，供观察器只注册可见宿主的断言。 */
      function Example() {
        return (
          <>
            <div ref={ref1} />
            <div hidden={true} ref={ref2} />
          </>
        );
      }

      const root = createRoot(container);
      await act(() => {
        root.render(<Example />);
      });

      // 模拟本测试所观察元素的尺寸。
      const rect1 = {
        x: 10,
        y: 20,
        width: 200,
        height: 100,
      };
      const rect2 = {
        x: 210,
        y: 20,
        width: 200,
        height: 100,
      };
      setBoundingClientRect(ref1.current, rect1);
      setBoundingClientRect(ref2.current, rect2);

      const handleVisibilityChange = jest.fn();
      observeVisibleRects(
        document.body,
        [createComponentSelector(Example)],
        handleVisibilityChange,
      );

      expect(observerMock.callback).not.toBeNull();
      expect(observerMock.observedTargets).toHaveLength(1);
      expect(observerMock.observedTargets[0]).toBe(ref1.current);
    });
  });
});
