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
let ReactFeatureFlags;
let ReactDOMServer;
let act;

/** 验证实验性 Scope API 在 DOM/TestRenderer 查询、边界包含、Context、SSR 与 Suspense hydration 中的行为。 */
describe('ReactScope', () => {
  /** 重置模块、强制开启 enableScopeAPI，并绑定 act。 */
  beforeEach(() => {
    jest.resetModules();
    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.enableScopeAPI = true;
    React = require('react');

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
  });

  /** 在真实 DOM 实例上覆盖 Scope 查询、SSR/hydration 与 Suspense 恢复。 */
  describe('ReactDOM', () => {
    let ReactDOMClient;
    let container;

    /** 创建并挂载独立 DOM container，同时绑定 client/server renderer。 */
    beforeEach(() => {
      ReactDOMClient = require('react-dom/client');
      ReactDOMServer = require('react-dom/server');
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    /** 从 document 移除 container 并清空引用，避免 DOM 跨用例泄漏。 */
    afterEach(() => {
      document.body.removeChild(container);
      container = null;
    });

    /** Given–When–Then：Given Scope 含 div/span/a；When在两种兄弟顺序间更新；Then queryAllNodes 按当前宿主遍历顺序返回全部 真实 DOM 根 实例。通过 ref 数组验证重排后查询不缓存旧顺序。 */
    // @gate enableScopeAPI
    it('DO_NOT_USE_queryAllNodes() works as intended', async () => {
      /** 匹配所有宿主节点，用于验证 Scope 的遍历顺序或 hydration 可见性。 */
      const testScopeQuery = (type, props) => true;
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();

      /** 按 toggle 重排 div/span/a，同时保持 scopeRef 与各宿主 ref 稳定。 */
      function Test({toggle}) {
        return toggle ? (
          <TestScope ref={scopeRef}>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
            <a ref={aRef}>A</a>
          </TestScope>
        ) : (
          <TestScope ref={scopeRef}>
            <a ref={aRef}>A</a>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
          </TestScope>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test toggle={true} />);
      });

      let nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(testScopeQuery);
      expect(nodes).toEqual([divRef.current, spanRef.current, aRef.current]);
      await act(() => {
        root.render(<Test toggle={false} />);
      });

      nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(testScopeQuery);
      expect(nodes).toEqual([aRef.current, divRef.current, spanRef.current]);
      await act(() => {
        root.render(null);
      });

      expect(scopeRef.current).toBe(null);
    });

    /** Given–When–Then：Given查询条件先按 type 选 div，再按 instance 扩展 span/a；When重排 Scope 子树；Then回调收到正确宿主实例并按树序返回匹配项。通过组合 filterQuery 验证 type/props/instance 三参数协议。 */
    // @gate enableScopeAPI
    it('DO_NOT_USE_queryAllNodes() provides the correct host instance', async () => {
      /** 仅匹配 div type，后续与 instance 条件组合验证查询回调参数。 */
      const testScopeQuery = (type, props) => type === 'div';
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();

      /** 按 toggle 重排 div/span/a，同时保持 scopeRef 与各宿主 ref 稳定。 */
      function Test({toggle}) {
        return toggle ? (
          <TestScope ref={scopeRef}>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
            <a ref={aRef}>A</a>
          </TestScope>
        ) : (
          <TestScope ref={scopeRef}>
            <a ref={aRef}>A</a>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
          </TestScope>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test toggle={true} />);
      });

      let nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(testScopeQuery);
      expect(nodes).toEqual([divRef.current]);
      /** 组合宿主 instance 身份与 div type 条件，逐步扩大匹配集合。 */
      let filterQuery = (type, props, instance) =>
        instance === spanRef.current || testScopeQuery(type, props);
      nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(filterQuery);
      expect(nodes).toEqual([divRef.current, spanRef.current]);
      /** 组合宿主 instance 身份与 div type 条件，逐步扩大匹配集合。 */
      filterQuery = (type, props, instance) =>
        [spanRef.current, aRef.current].includes(instance) ||
        testScopeQuery(type, props);
      nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(filterQuery);
      expect(nodes).toEqual([divRef.current, spanRef.current, aRef.current]);
      await act(() => {
        root.render(<Test toggle={false} />);
      });

      /** 组合宿主 instance 身份与 div type 条件，逐步扩大匹配集合。 */
      filterQuery = (type, props, instance) =>
        [spanRef.current, aRef.current].includes(instance) ||
        testScopeQuery(type, props);
      nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(filterQuery);
      expect(nodes).toEqual([aRef.current, divRef.current, spanRef.current]);
      await act(() => {
        root.render(null);
      });

      expect(scopeRef.current).toBe(null);
    });

    /** Given–When–Then：Given Scope 子节点从 div-first 切为 a-first；When每次调用 queryFirstNode；Then返回当前顺序第一个匹配的 真实 DOM 根 实例。通过 ref 身份验证提前终止遍历。 */
    // @gate enableScopeAPI
    it('DO_NOT_USE_queryFirstNode() works as intended', async () => {
      /** 匹配所有宿主节点，用于验证 Scope 的遍历顺序或 hydration 可见性。 */
      const testScopeQuery = (type, props) => true;
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();

      /** 按 toggle 重排 div/span/a，同时保持 scopeRef 与各宿主 ref 稳定。 */
      function Test({toggle}) {
        return toggle ? (
          <TestScope ref={scopeRef}>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
            <a ref={aRef}>A</a>
          </TestScope>
        ) : (
          <TestScope ref={scopeRef}>
            <a ref={aRef}>A</a>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
          </TestScope>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test toggle={true} />);
      });

      let node = scopeRef.current.DO_NOT_USE_queryFirstNode(testScopeQuery);
      expect(node).toEqual(divRef.current);
      await act(() => {
        root.render(<Test toggle={false} />);
      });

      node = scopeRef.current.DO_NOT_USE_queryFirstNode(testScopeQuery);
      expect(node).toEqual(aRef.current);
      await act(() => {
        root.render(null);
      });

      expect(scopeRef.current).toBe(null);
    });

    /** Given–When–Then：Given div/span/a 位于 Scope 内，outerSpan/em 在更新前后跨边界移动；When切换 toggle；Then containsNode 只随当前 Fiber 归属变化。通过 真实 DOM 根 ref 的 true/false 矩阵验证边界。 */
    // @gate enableScopeAPI
    it('containsNode() works as intended', async () => {
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();
      const outerSpan = React.createRef();
      const emRef = React.createRef();

      /** 按 toggle 在 Scope 内外移动 em，并重排其余宿主节点以检查动态归属。 */
      function Test({toggle}) {
        return toggle ? (
          <div>
            <span ref={outerSpan}>SPAN</span>
            <TestScope ref={scopeRef}>
              <div ref={divRef}>DIV</div>
              <span ref={spanRef}>SPAN</span>
              <a ref={aRef}>A</a>
            </TestScope>
            <em ref={emRef}>EM</em>
          </div>
        ) : (
          <div>
            <TestScope ref={scopeRef}>
              <a ref={aRef}>A</a>
              <div ref={divRef}>DIV</div>
              <span ref={spanRef}>SPAN</span>
              <em ref={emRef}>EM</em>
            </TestScope>
            <span ref={outerSpan}>SPAN</span>
          </div>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test toggle={true} />);
      });

      expect(scopeRef.current.containsNode(divRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(spanRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(aRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(outerSpan.current)).toBe(false);
      expect(scopeRef.current.containsNode(emRef.current)).toBe(false);
      await act(() => {
        root.render(<Test toggle={false} />);
      });

      expect(scopeRef.current.containsNode(divRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(spanRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(aRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(outerSpan.current)).toBe(false);
      expect(scopeRef.current.containsNode(emRef.current)).toBe(true);
      await act(() => {
        root.render(<Test toggle={true} />);
      });

      expect(scopeRef.current.containsNode(emRef.current)).toBe(false);
    });

    /** Given–When–Then：Given服务端 Scope 不产生额外标记且输出完整 HTML；When客户端 hydrate 同一树；Then scopeRef 恢复并查询到既有 div/span/a。通过 HTML 字符串和 ref 实例验证 Scope 的无宿主 hydration。 */
    // @gate enableScopeAPI
    it('scopes support server-side rendering and hydration', async () => {
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();

      /** 渲染不产生宿主包装的 Scope，并并列一个 Scope 外节点用于 SSR 字符串对照。 */
      function Test({toggle}) {
        return (
          <div>
            <TestScope ref={scopeRef}>
              <div ref={divRef}>DIV</div>
              <span ref={spanRef}>SPAN</span>
              <a ref={aRef}>A</a>
            </TestScope>
            <div>Outside content!</div>
          </div>
        );
      }
      const html = ReactDOMServer.renderToString(<Test />);
      expect(html).toBe(
        '<div><div>DIV</div><span>SPAN</span><a>A</a><div>Outside content!</div></div>',
      );
      container.innerHTML = html;
      await act(() => {
        ReactDOMClient.hydrateRoot(container, <Test />);
      });
      /** 匹配所有宿主节点，用于验证 Scope 的遍历顺序或 hydration 可见性。 */
      const testScopeQuery = (type, props) => true;
      const nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(testScopeQuery);
      expect(nodes).toEqual([divRef.current, spanRef.current, aRef.current]);
    });

    /** Given–When–Then：Given Scope 内从一个 Provider 更新为两个同 Context Provider；When调用 getChildContextValues；Then按树序返回 [1] 再 [1,2]，卸载后 ref 清空。通过值数组验证 context provider 收集。 */
    // @gate enableScopeAPI
    it('getChildContextValues() works as intended', async () => {
      const TestContext = React.createContext();
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();

      /** 按 toggle 改变 Scope 内同类型 Provider 数量，驱动 context 值收集。 */
      function Test({toggle}) {
        return toggle ? (
          <TestScope ref={scopeRef}>
            <TestContext.Provider value={1} />
          </TestScope>
        ) : (
          <TestScope ref={scopeRef}>
            <TestContext.Provider value={1} />
            <TestContext.Provider value={2} />
          </TestScope>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Test toggle={true} />);
      });

      let nodes = scopeRef.current.getChildContextValues(TestContext);
      expect(nodes).toEqual([1]);
      await act(() => {
        root.render(<Test toggle={false} />);
      });

      nodes = scopeRef.current.getChildContextValues(TestContext);
      expect(nodes).toEqual([1, 2]);
      await act(() => {
        root.render(null);
      });

      expect(scopeRef.current).toBe(null);
    });

    /** Given–When–Then：Given服务端完成 span，客户端 hydration 时 Child 挂起；When先在 dehydrated 边界查询 Scope，再解决 promise；Then查询不抛错且 ref 最终指向原 span。通过对象身份验证 Suspense hydration 与 Scope 查询兼容。 */
    // @gate enableScopeAPI
    it('correctly works with suspended boundaries that are hydrated', async () => {
      let suspend = false;
      let resolve;
      const promise = new Promise(resolvePromise => (resolve = resolvePromise));
      const ref = React.createRef();
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      /** 匹配所有宿主节点，用于验证 Scope 的遍历顺序或 hydration 可见性。 */
      const testScopeQuery = (type, props) => true;

      /** 客户端 suspend 为 true 时抛 promise，服务端和解决后返回 Hello。 */
      function Child() {
        if (suspend) {
          throw promise;
        } else {
          return 'Hello';
        }
      }

      /** 用 Scope 包裹 Suspense/span/Child，建立 dehydrated 边界内的可查询宿主节点。 */
      function App() {
        return (
          <div>
            <TestScope ref={scopeRef}>
              <React.Suspense fallback="Loading...">
                <span ref={ref}>
                  <Child />
                </span>
              </React.Suspense>
            </TestScope>
          </div>
        );
      }

      // 先渲染最终 HTML；流式 renderer 在服务端可能产生 Suspense 点，
      // 但本用例专注完整 HTML 的 hydration，
      // 因此服务端阶段不挂起。
      suspend = false;
      const finalHTML = ReactDOMServer.renderToString(<App />);

      const container2 = document.createElement('div');
      container2.innerHTML = finalHTML;

      const span = container2.getElementsByTagName('span')[0];

      // 客户端数据尚未齐全，但仍立即开始
      // 水合（hydration）。
      suspend = true;
      await act(() => ReactDOMClient.hydrateRoot(container2, <App />));

      // dehydrated 边界内查询不应导致运行时异常，参见：
      // https://github.com/facebook/react/pull/18184
      scopeRef.current.DO_NOT_USE_queryAllNodes(testScopeQuery);
      expect(ref.current).toBe(null);

      // 解决 promise 后应继续 hydration。
      suspend = false;
      await act(async () => {
        resolve();
        await promise;
      });

      // hydration 完成后，ref 必须复用现有 span。
      expect(ref.current).toBe(span);
    });
  });

  /** 用 createNodeMock 返回元素对象，验证 Scope 算法不依赖浏览器 DOM。 */
  describe('ReactTestRenderer', () => {
    let ReactTestRenderer;

    /** 加载 ReactTestRenderer，复用外层已开启的 Scope feature flag。 */
    beforeEach(() => {
      ReactTestRenderer = require('react-test-renderer');
    });

    /** Given–When–Then：Given Scope 含 div/span/a；When在两种兄弟顺序间更新；Then queryAllNodes 按当前宿主遍历顺序返回全部 ReactTestRenderer 节点 mock 实例。通过 ref 数组验证重排后查询不缓存旧顺序。 */
    // @gate enableScopeAPI
    it('DO_NOT_USE_queryAllNodes() works as intended', async () => {
      /** 匹配所有宿主节点，用于验证 Scope 的遍历顺序或 hydration 可见性。 */
      const testScopeQuery = (type, props) => true;
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();

      /** 按 toggle 重排 div/span/a，同时保持 scopeRef 与各宿主 ref 稳定。 */
      function Test({toggle}) {
        return toggle ? (
          <TestScope ref={scopeRef}>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
            <a ref={aRef}>A</a>
          </TestScope>
        ) : (
          <TestScope ref={scopeRef}>
            <a ref={aRef}>A</a>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
          </TestScope>
        );
      }

      let renderer;
      await act(
        () =>
          (renderer = ReactTestRenderer.create(<Test toggle={true} />, {
            /** 直接把测试元素作为宿主实例返回，使 ref 与 Scope 查询结果可按对象身份比较。 */
            createNodeMock: element => {
              return element;
            },
            unstable_isConcurrent: true,
          })),
      );
      let nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(testScopeQuery);
      expect(nodes).toEqual([divRef.current, spanRef.current, aRef.current]);
      await act(() => renderer.update(<Test toggle={false} />));
      nodes = scopeRef.current.DO_NOT_USE_queryAllNodes(testScopeQuery);
      expect(nodes).toEqual([aRef.current, divRef.current, spanRef.current]);
    });

    /** Given–When–Then：Given Scope 子节点从 div-first 切为 a-first；When每次调用 queryFirstNode；Then返回当前顺序第一个匹配的 ReactTestRenderer 节点 mock 实例。通过 ref 身份验证提前终止遍历。 */
    // @gate enableScopeAPI
    it('DO_NOT_USE_queryFirstNode() works as intended', async () => {
      /** 匹配所有宿主节点，用于验证 Scope 的遍历顺序或 hydration 可见性。 */
      const testScopeQuery = (type, props) => true;
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();

      /** 按 toggle 重排 div/span/a，同时保持 scopeRef 与各宿主 ref 稳定。 */
      function Test({toggle}) {
        return toggle ? (
          <TestScope ref={scopeRef}>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
            <a ref={aRef}>A</a>
          </TestScope>
        ) : (
          <TestScope ref={scopeRef}>
            <a ref={aRef}>A</a>
            <div ref={divRef}>DIV</div>
            <span ref={spanRef}>SPAN</span>
          </TestScope>
        );
      }

      let renderer;
      await act(
        () =>
          (renderer = ReactTestRenderer.create(<Test toggle={true} />, {
            /** 直接把测试元素作为宿主实例返回，使 ref 与 Scope 查询结果可按对象身份比较。 */
            createNodeMock: element => {
              return element;
            },
            unstable_isConcurrent: true,
          })),
      );
      let node = scopeRef.current.DO_NOT_USE_queryFirstNode(testScopeQuery);
      expect(node).toEqual(divRef.current);
      await act(() => renderer.update(<Test toggle={false} />));

      node = scopeRef.current.DO_NOT_USE_queryFirstNode(testScopeQuery);
      expect(node).toEqual(aRef.current);
    });

    /** Given–When–Then：Given div/span/a 位于 Scope 内，outerSpan/em 在更新前后跨边界移动；When切换 toggle；Then containsNode 只随当前 Fiber 归属变化。通过 ReactTestRenderer 节点 mock ref 的 true/false 矩阵验证边界。 */
    // @gate enableScopeAPI
    it('containsNode() works as intended', async () => {
      const TestScope = React.unstable_Scope;
      const scopeRef = React.createRef();
      const divRef = React.createRef();
      const spanRef = React.createRef();
      const aRef = React.createRef();
      const outerSpan = React.createRef();
      const emRef = React.createRef();

      /** 按 toggle 在 Scope 内外移动 em，并重排其余宿主节点以检查动态归属。 */
      function Test({toggle}) {
        return toggle ? (
          <div>
            <span ref={outerSpan}>SPAN</span>
            <TestScope ref={scopeRef}>
              <div ref={divRef}>DIV</div>
              <span ref={spanRef}>SPAN</span>
              <a ref={aRef}>A</a>
            </TestScope>
            <em ref={emRef}>EM</em>
          </div>
        ) : (
          <div>
            <TestScope ref={scopeRef}>
              <a ref={aRef}>A</a>
              <div ref={divRef}>DIV</div>
              <span ref={spanRef}>SPAN</span>
              <em ref={emRef}>EM</em>
            </TestScope>
            <span ref={outerSpan}>SPAN</span>
          </div>
        );
      }

      let renderer;
      await act(
        () =>
          (renderer = ReactTestRenderer.create(<Test toggle={true} />, {
            /** 直接把测试元素作为宿主实例返回，使 ref 与 Scope 查询结果可按对象身份比较。 */
            createNodeMock: element => {
              return element;
            },
            unstable_isConcurrent: true,
          })),
      );
      expect(scopeRef.current.containsNode(divRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(spanRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(aRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(outerSpan.current)).toBe(false);
      expect(scopeRef.current.containsNode(emRef.current)).toBe(false);
      await act(() => renderer.update(<Test toggle={false} />));
      expect(scopeRef.current.containsNode(divRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(spanRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(aRef.current)).toBe(true);
      expect(scopeRef.current.containsNode(outerSpan.current)).toBe(false);
      expect(scopeRef.current.containsNode(emRef.current)).toBe(true);
      await act(() => renderer.update(<Test toggle={true} />));
      expect(scopeRef.current.containsNode(emRef.current)).toBe(false);
    });
  });
});
