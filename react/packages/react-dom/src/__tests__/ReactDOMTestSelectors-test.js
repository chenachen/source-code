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
    // @gate www || experimental
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should support searching from the document root」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接表单宿主状态、ReactDOMSharedInternals 与提交后受控值恢复路径。
     */
    it('should support searching from the document root', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support searching from the container」描述的渲染、交互或错误处理结果。 */
    it('should support searching from the container', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support searching from a previous match if the match had a data-testname」描述的渲染、交互或错误处理结果。 */
    it('should support searching from a previous match if the match had a data-testname', async () => {
      /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Outer() {
        return (
          <div data-testname="outer" id="outer">
            <Inner />
          </div>
        );
      }

      /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should not support searching from a previous match if the match did not have a data-testname」描述的渲染、交互或错误处理结果。 */
    it('should not support searching from a previous match if the match did not have a data-testname', async () => {
      /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Outer() {
        return (
          <div id="outer">
            <Inner />
          </div>
        );
      }

      /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support an multiple component types in the selector array」描述的渲染、交互或错误处理结果。 */
    it('should support an multiple component types in the selector array', async () => {
      /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Outer() {
        return (
          <>
            <div data-testname="match" id="match1" />
            <Middle />
          </>
        );
      }
      /** `Middle`：封装当前用例复用的操作、回调或断言步骤。 */
      function Middle() {
        return (
          <>
            <div data-testname="match" id="match2" />
            <Inner />
          </>
        );
      }
      /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should find multiple matches」描述的渲染、交互或错误处理结果。 */
    it('should find multiple matches', async () => {
      /** `Example1`：封装当前用例复用的操作、回调或断言步骤。 */
      function Example1() {
        return (
          <div>
            <div data-testname="match" id="match1" />
          </div>
        );
      }

      /** `Example2`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should ignore nested matches」描述的渲染、交互或错误处理结果。 */
    it('should ignore nested matches', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should enforce the specific order of selectors」描述的渲染、交互或错误处理结果。 */
    it('should enforce the specific order of selectors', async () => {
      /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Outer() {
        return (
          <>
            <div data-testname="match" id="match1" />
            <Inner />
          </>
        );
      }
      /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should not search within hidden subtrees」描述的渲染、交互或错误处理结果。 */
    it('should not search within hidden subtrees', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support filtering by display text」描述的渲染、交互或错误处理结果。 */
    it('should support filtering by display text', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support filtering by explicit accessibiliy role」描述的渲染、交互或错误处理结果。 */
    it('should support filtering by explicit accessibiliy role', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support filtering by explicit secondary accessibiliy role」描述的渲染、交互或错误处理结果。 */
    it('should support filtering by explicit secondary accessibiliy role', async () => {
      const ref = React.createRef();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support filtering by implicit accessibiliy role」描述的渲染、交互或错误处理结果。 */
    it('should support filtering by implicit accessibiliy role', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support filtering by implicit accessibiliy role with attributes qualifications」描述的渲染、交互或错误处理结果。 */
    it('should support filtering by implicit accessibiliy role with attributes qualifications', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should support searching ahead with the has() selector」描述的渲染、交互或错误处理结果。 */
    it('should support searching ahead with the has() selector', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should throw if no container can be found」描述的渲染、交互或错误处理结果。 */
    it('should throw if no container can be found', () => {
      expect(() => findAllNodes(document.body, [])).toThrow(
        'Could not find React container within specified host subtree.',
      );
    });

    // @gate www || experimental
    /** 测试场景：验证「should throw if an invalid host root is specified」描述的渲染、交互或错误处理结果。 */
    it('should throw if an invalid host root is specified', async () => {
      const ref = React.createRef();
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // @gate www || experimental
    /** 测试场景：验证「should describe findAllNodes failures caused by the component type selector」描述的渲染、交互或错误处理结果。 */
    it('should describe findAllNodes failures caused by the component type selector', async () => {
      /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Outer() {
        return <Middle />;
      }
      /** `Middle`：封装当前用例复用的操作、回调或断言步骤。 */
      function Middle() {
        return <div />;
      }
      /** `NotRendered`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should return null if findAllNodes was able to find a match」描述的渲染、交互或错误处理结果。 */
    it('should return null if findAllNodes was able to find a match', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // @gate www || experimental
    /** 测试场景：验证「should return a single rect for a component that returns a single root host element」描述的渲染、交互或错误处理结果。 */
    it('should return a single rect for a component that returns a single root host element', async () => {
      const ref = React.createRef();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should return a multiple rects for multiple matches」描述的渲染、交互或错误处理结果。 */
    it('should return a multiple rects for multiple matches', async () => {
      const outerRef = React.createRef();
      const innerRef = React.createRef();

      /** `Outer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Outer() {
        return (
          <>
            <div ref={outerRef} />
            <Inner />
          </>
        );
      }
      /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should return a multiple rects for single match that returns a fragment」描述的渲染、交互或错误处理结果。 */
    it('should return a multiple rects for single match that returns a fragment', async () => {
      const refA = React.createRef();
      const refB = React.createRef();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should merge overlapping rects」描述的渲染、交互或错误处理结果。 */
    it('should merge overlapping rects', async () => {
      const refA = React.createRef();
      const refB = React.createRef();
      const refC = React.createRef();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should merge some types of adjacent rects (if they are the same in one dimension)」描述的渲染、交互或错误处理结果。 */
    it('should merge some types of adjacent rects (if they are the same in one dimension)', async () => {
      const refA = React.createRef();
      const refB = React.createRef();
      const refC = React.createRef();
      const refD = React.createRef();
      const refE = React.createRef();
      const refF = React.createRef();
      const refG = React.createRef();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should not search within hidden subtrees」描述的渲染、交互或错误处理结果。 */
    it('should not search within hidden subtrees', async () => {
      const refA = React.createRef();
      const refB = React.createRef();
      const refC = React.createRef();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // @gate www || experimental
    /** 测试场景：验证「should return false if the specified component path has no matches」描述的渲染、交互或错误处理结果。 */
    it('should return false if the specified component path has no matches', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
      function Example() {
        return <Child />;
      }
      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      function Child() {
        return null;
      }
      /** `NotUsed`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should return false if there are no focusable elements within the matched subtree」描述的渲染、交互或错误处理结果。 */
    it('should return false if there are no focusable elements within the matched subtree', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
      function Example() {
        return <Child />;
      }
      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should return false if the only focusable elements are disabled」描述的渲染、交互或错误处理结果。 */
    it('should return false if the only focusable elements are disabled', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should return false if the only focusable elements are hidden」描述的渲染、交互或错误处理结果。 */
    it('should return false if the only focusable elements are hidden', async () => {
      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should successfully focus the first focusable element within the tree」描述的渲染、交互或错误处理结果。 */
    it('should successfully focus the first focusable element within the tree', async () => {
      const secondRef = React.createRef(null);

      const handleFirstFocus = jest.fn();
      const handleSecondFocus = jest.fn();
      const handleThirdFocus = jest.fn();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
      function Example() {
        return (
          <>
            <FirstChild />
            <SecondChild />
            <ThirdChild />
          </>
        );
      }
      /** `FirstChild`：封装当前用例复用的操作、回调或断言步骤。 */
      function FirstChild() {
        return (
          <button hidden={true} onFocus={handleFirstFocus}>
            not clickable
          </button>
        );
      }
      /** `SecondChild`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `ThirdChild`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should successfully focus the first focusable element even if application logic interferes」描述的渲染、交互或错误处理结果。 */
    it('should successfully focus the first focusable element even if application logic interferes', async () => {
      const ref = React.createRef(null);

      const handleFocus = jest.fn(event => {
        event.target.blur();
      });

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should not focus within hidden subtrees」描述的渲染、交互或错误处理结果。 */
    it('should not focus within hidden subtrees', async () => {
      const secondRef = React.createRef(null);

      const handleFirstFocus = jest.fn();
      const handleSecondFocus = jest.fn();
      const handleThirdFocus = jest.fn();

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
      function Example() {
        return (
          <>
            <FirstChild />
            <SecondChild />
            <ThirdChild />
          </>
        );
      }
      /** `FirstChild`：封装当前用例复用的操作、回调或断言步骤。 */
      function FirstChild() {
        return (
          <div hidden={true}>
            <button style={{width: 10, height: 10}} onFocus={handleFirstFocus}>
              hidden
            </button>
          </div>
        );
      }
      /** `SecondChild`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `ThirdChild`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should notify a listener when the underlying instance intersection changes」描述的渲染、交互或错误处理结果。 */
    it('should notify a listener when the underlying instance intersection changes', async () => {
      const ref = React.createRef(null);

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should notify a listener of multiple targets when the underlying instance intersection changes」描述的渲染、交互或错误处理结果。 */
    it('should notify a listener of multiple targets when the underlying instance intersection changes', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate www || experimental
    /** 测试场景：验证「should stop listening when its disconnected」描述的渲染、交互或错误处理结果。 */
    it('should stop listening when its disconnected', async () => {
      const ref = React.createRef(null);

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // @gate www || experimental && __DEV__
    /** 测试场景：验证「should update which targets its listening to after a commit」描述的渲染、交互或错误处理结果。 */
    it('should update which targets its listening to after a commit', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      let increment;

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
      function Example() {
        const [count, setCount] = React.useState(0);
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

    // @gate www || experimental
    /** 测试场景：验证「should not observe components within hidden subtrees」描述的渲染、交互或错误处理结果。 */
    it('should not observe components within hidden subtrees', async () => {
      const ref1 = React.createRef(null);
      const ref2 = React.createRef(null);

      /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
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
