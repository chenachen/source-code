/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */
let JSDOM;
let React;
let ReactDOMClient;
let clientAct;
let ReactDOMFizzServer;
let Stream;
let Suspense;
let useId;
let useState;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let waitForPaint;
let SuspenseList;

describe('useId', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    clientAct = require('internal-test-utils').act;
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');
    Suspense = React.Suspense;
    useId = React.useId;
    useState = React.useState;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }

    const InternalTestUtils = require('internal-test-utils');
    waitForPaint = InternalTestUtils.waitForPaint;

    // 测试环境
    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    document = jsdom.window.document;
    container = document.getElementById('container');

    buffer = '';
    hasErrored = false;

    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });
  });

  /** 执行服务器操作并等一个 setImmediate；检查 PassThrough 错误，再将当前 buffer 当完整 HTML 片段插入容器。重新创建顶层 script 只复制 textContent 以执行内联指令，不模拟逐字节 HTML parser。 */
  async function serverAct(callback) {
    await callback();
    // 等待一次事件循环的轮询。 这假设我们已经将所有东西都冲刷了。
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }
    // 由于 JSDOM 不支持流解析器，我们需要给它一个适当的片段。 我们还想执行嵌入式的任何脚本. 我们假
    // 设现在已经接收到一个适当的片段的 HTML。
    const bufferedContent = buffer;
    buffer = '';
    const fakeBody = document.createElement('body');
    fakeBody.innerHTML = bufferedContent;
    while (fakeBody.firstChild) {
      const node = fakeBody.firstChild;
      if (node.nodeName === 'SCRIPT') {
        const script = document.createElement('script');
        script.textContent = node.textContent;
        fakeBody.removeChild(node);
        container.appendChild(script);
      } else {
        container.appendChild(node);
      }
    }
  }

  /** 提取测试已知 ID 的 R/r 前缀、base32 树路径与 H 后缀；服务端路径转二进制，客户端去掉不稳定计数。正则失败实际返回 null，现有 undefined 检查不覆盖它，因此调用者必须传入合法 ID。 */
  function normalizeTreeIdForTesting(id) {
    const result = id.match(/_(R|r)_([a-z0-9]*)(H([0-9]*))?_/);
    if (result === undefined) {
      throw new Error('Invalid id format');
    }
    const [, serverClientPrefix, base32, hookIndex] = result;
    if (serverClientPrefix.endsWith('r')) {
  // 客户端 ID 不稳定；测试时去掉其中的计数器部分。
      return (
        'CLIENT_GENERATED_ID' +
        (hookIndex !== undefined ? ` (${hookIndex})` : '')
      );
    }
    // 格式化树 ID 为二进制序列。 这样更容易可视化结构。
    return (
      parseInt(base32, 32).toString(2) +
      (hookIndex !== undefined ? ` (${hookIndex})` : '')
    );
  }

  /** 调用 useId 并规范化为可读路径，写入 div.id；除 children 外的 label 等参数不会输出。 */
  function DivWithId({children}) {
    const id = normalizeTreeIdForTesting(useId());
    return <div id={id}>{children}</div>;
  }

  /** 服务端渲染两层兄弟 DivWithId 后 hydrateRoot 同树；规范化快照为 101/1001/10，验证两端使用相同树分叉路径。 */
  it('basic example', async () => {

    /** 构造两层兄弟槽位，比较分叉位置的 ID 路径。 */
    function App() {
      return (
        <div>
          <div>
            <DivWithId />
            <DivWithId />
          </div>
          <DivWithId />
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          <div>
            <div
              id="101"
            />
            <div
              id="1001"
            />
          </div>
          <div
            id="10"
          />
        </div>
      </div>
    `);
  });

  /** 外层带 ID 的节点经多层无 ID div 到内部带 ID 节点；水合后 ID 为 0/1，验证消费 useId 的父子即使无兄弟分支也不同。 */
  it('indirections', async () => {

    /** 在有 ID 的父子之间加无 ID 主机层，验证消费 useId 的层级仍推进路径。 */
    function App() {
      // 没有分支。 但是父组件和子组件应该有不同的 id。
      return (
        <DivWithId>
          <div>
            <div>
              <div>
                <DivWithId />
              </div>
            </div>
          </div>
        </DivWithId>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="0"
        >
          <div>
            <div>
              <div>
                <div
                  id="1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
  });

  /** 服务端 StrictMode 包住一个 DivWithId，再客户端水合；ID 仍为 0，验证开发重复执行不改变水合身份。 */
  it('StrictMode double rendering', async () => {
    const {StrictMode} = React;

    /** 把 ID 子置于 StrictMode，覆盖开发重复执行。 */
    function App() {
      return (
        <StrictMode>
          <DivWithId />
        </StrictMode>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="0"
        />
      </div>
    `);
  });

  /** Fragment 中 null 与带 ID 节点交替；服务端和客户端快照为 10/100，验证空数组槽仍参与路径编码而不创建 DOM。 */
  it('empty (null) children', async () => {
    // null 不创建 Fiber，但数组遍历仍保留其索引，并把总槽位数用于 hydration 的 tree fork。
    // 因此空槽会影响后续 useId 的路径编码；Fizz 与客户端必须使用同一规则。

    /** 在两 ID 子前各保留一个 null 槽，检验槽索引编码。 */
    function App() {
      return (
        <>
          {null}
          <DivWithId />
          {null}
          <DivWithId />
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="10"
        />
        <div
          id="100"
        />
      </div>
    `);
  });

  /** 嵌套 50 层二叉 Fragment 并逐层输出 useId；水合后所有原始 ID 匹配交替 a/l 的 base32 模式，验证超出 32 位的路径溢出编码。 */
  it('large ids', async () => {
    // 该组件会输出一棵带 id 的递归节点树；这些 id 的底层二进制位按 1、0 交替排列，形如 101010101。
    // 因为使用 base-32 编码，结果除 `_R_` 前缀和其后的首字符外，应交替出现 `a`（01010）与
    // `l`（10101），例如 `_R_clalalalalalalala..._`；首字符可能不足完整的 5 位。
    // 本例 50 层树用这个规律检验超过 32 位位运算范围的编码，不枚举任意深度。

    /** 用原始 useId 写 div.id，保留超长 base32 路径供正则检验。 */
    function Child({children}) {
      const id = useId();
      return <div id={id}>{children}</div>;
    }

    /** 循环 50 次构造递归 Fragment，每层旧树处于第二槽，制造超 32 位路径。 */
    function App() {
      let tree = <Child />;
      for (let i = 0; i < 50; i++) {
        tree = (
          <>
            <Child />
            {tree}
          </>
        );
      }
      return tree;
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    const divs = container.querySelectorAll('div');

    // 确认每个ID符合预期模式
    for (let i = 0; i < divs.length; i++) {
      // 示例：_R_clalalalalalalala..._
      expect(divs[i].id).toMatch(/^_R_.(((al)*a?)((la)*l?))*_$/);
    }
  });

  /** 一个组件顺序调用 useId 三次；服务端与水合输出 R_0、R_0H1、R_0H2，验证同组件内按 Hook 索引区分。 */
  it('multiple ids in a single component', async () => {

    /** 顺序获取三个 ID 并直接拼字符串，观察本组件 Hook 索引后缀。 */
    function App() {
      const id1 = useId();
      const id2 = useId();
      const id3 = useId();
      return `${id1}, ${id2}, ${id3}`;
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    // 我们为 id 添加后缀以区分它们。
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        _R_0_, _R_0H1_, _R_0H2_
      </div>
    `);
  });

  /** App 在 render 将 count 从 0 连续更新到 3，再返回 useId；SSR 与水合仍为 R_0，验证 render 阶段重跑不额外分配 ID。 */
  it('local render phase updates', async () => {

    /** 在 render 重跑三次后返回 useId，避免把本地更新次数当新的 ID 槽。 */
    function App({swap}) {
      const [count, setCount] = useState(0);
      if (count < 3) {
        setCount(count + 1);
      }
      return useId();
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        _R_0_
      </div>
    `);
  });

  // @gate enableSuspenseList

  /** SuspenseList independent 中两 Bar 调用 useId；SSR 与水合均为 R_1/R_2，验证独立揭示模式保留兄弟 ID 路径。 */
  it('Supports SuspenseList (reveal order independent)', async () => {

    /** 将 Bar 的 ID 与 children 放到 span，保持两端主机输出一致。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** 调用 useId，再通过 Baz 传到 span，验证组件间透传不重新分配 ID。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** 构造 independent SuspenseList，观察该模式下兄弟槽位与 ID。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="independent">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);
  });

  // @gate enableSuspenseList

  /** SuspenseList together 中两 Bar 调用 useId；两端快照均为 R_1/R_2，覆盖一起揭示的树 ID 编码。 */
  it('Supports SuspenseList (reveal order "together")', async () => {

    /** 将 Bar 的 ID 与 children 放到 span，保持两端主机输出一致。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** 调用 useId，再通过 Baz 传到 span，验证组件间透传不重新分配 ID。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** 构造 together SuspenseList，观察该模式下兄弟槽位与 ID。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);
  });

  // @gate enableSuspenseList

  /** SuspenseList forwards/visible 中两 Bar 调用 useId；SSR 与水合 ID 保持 R_1/R_2，覆盖正向揭示模式。 */
  it('Supports SuspenseList (reveal order "forwards")', async () => {

    /** 将 Bar 的 ID 与 children 放到 span，保持两端主机输出一致。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** 调用 useId，再通过 Baz 传到 span，验证组件间透传不重新分配 ID。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** 构造 forwards SuspenseList，观察该模式下兄弟槽位与 ID。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);
  });

  // @gate enableSuspenseList

  /** legacy-backwards 列表的三槽中仅中间 Bar 非 null；SSR 与水合均为 R_2 并保留尾部注释，验证单项时的空槽路径。 */
  it('Supports SuspenseList (reveal order "backwards") with a single child in a list of many', async () => {

    /** 将 Bar 的 ID 与 children 放到 span，保持两端主机输出一致。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** 调用 useId，再通过 Baz 传到 span，验证组件间透传不重新分配 ID。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** 构造 legacy-backwards 单非空槽 SuspenseList，观察该模式下兄弟槽位与 ID。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
          {null}
          <Bar>A</Bar>
          {null}
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_2_"
        >
          A
        </span>
        <!-- -->
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_2_"
        >
          A
        </span>
        <!-- -->
      </div>
    `);
  });

  // @gate enableSuspenseList

  /** legacy-backwards 列表有两个 Bar，SSR 为 R_1/R_2；当前逆向水合会抛 mismatch 并客户端重建为 r_1/r_0，记录已知缺陷而非成功水合。 */
  it('Supports SuspenseList (reveal order "backwards")', async () => {

    /** 将 Bar 的 ID 与 children 放到 span，保持两端主机输出一致。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** 调用 useId，再通过 Baz 传到 span，验证组件间透传不重新分配 ID。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** 构造 legacy-backwards 两项 SuspenseList，观察该模式下兄弟槽位与 ID。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    // TODO：这是 revealOrder="backwards" 的缺陷：它会以反向顺序执行 hydration。
    await expect(async () => {
      await clientAct(async () => {
        ReactDOMClient.hydrateRoot(container, <Foo />);
      });
    }).rejects.toThrowError(
      `Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client.`,
    );

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_r_1_"
        >
          A
        </span>
        <span
          id="_r_0_"
        >
          B
        </span>
      </div>
    `);
  });

  /** Suspense 内两个 ID 节点、外部一个节点，先 SSR 再水合；快照同时保持边界注释和 101/1001/10 路径，覆盖边界内外 ID。 */
  it('basic incremental hydration', async () => {

    /** 同时放置 Suspense 内两个与外部一个 ID 子，比较水合路径。 */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <DivWithId label="A" />
            <DivWithId label="B" />
          </Suspense>
          <DivWithId label="C" />
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          <!--$-->
          <div
            id="101"
          />
          <div
            id="1001"
          />
          <!--/$-->
          <div
            id="10"
          />
        </div>
      </div>
    `);
  });

  /** 先只水合 shell，使边界 span ref 仍为空，再在边界外数组将 key B 换成 C；新项用客户端 ID，边界 ID 不变且 span 复用原 DOM，验证更新不破坏待水合路径。 */
  it('inserting/deleting siblings outside a dehydrated Suspense boundary', async () => {
    const span = React.createRef(null);

    /** 在边界外有 key 的数组切换 B/C；数组占外层单个槽，边界位置保持稳定。 */
    function App({swap}) {
      // 动态数组占一个 Fragment 槽位。swap 时 key B 改为 C，故该行删除并插入；
      // 外层 Suspense 仍处于同一槽位，其 hydration ID 路径不应受数组内部替换影响。
      const children = [
        <DivWithId key="A" />,
        swap ? <DivWithId key="C" /> : <DivWithId key="B" />,
        <DivWithId key="D" />,
      ];
      return (
        <>
          {children}
          <Suspense key="boundary" fallback="Loading...">
            <DivWithId />
            <span ref={span} />
          </Suspense>
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    const dehydratedSpan = container.getElementsByTagName('span')[0];
    await clientAct(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App />);
      await waitForPaint([]);
      expect(container).toMatchInlineSnapshot(`
        <div
          id="container"
        >
          <div
            id="101"
          />
          <div
            id="1001"
          />
          <div
            id="1101"
          />
          <!--$-->
          <div
            id="110"
          />
          <span />
          <!--/$-->
        </div>
      `);

      // 内层边界尚未完成水合。
      expect(span.current).toBe(null);

      // 将 key B 替换为 key C，要求新实例使用客户端 ID。
      root.render(<App swap={true} />);
    });
    // 元素交换不应导致 hydration mismatch。
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="101"
        />
        <div
          id="CLIENT_GENERATED_ID"
        />
        <div
          id="1101"
        />
        <!--$-->
        <div
          id="110"
        />
        <span />
        <!--/$-->
      </div>
    `);
    // span ref 指向原服务端节点，证明该边界成功水合。
    expect(span.current).toBe(dehydratedSpan);
  });

  /** 边界内部数组先输出 A/B/D，shell 水合暂停时将 B 替换为 C；其余 ID 保持、C 用客户端 ID且 span 身份复用，验证先恢复边界再处理内部替换。 */
  it('inserting/deleting siblings inside a dehydrated Suspense boundary', async () => {
    const span = React.createRef(null);

    /** 在边界内部有 key 的数组切换 B/C，并保留后续 span ref；用主机身份检验边界恢复。 */
    function App({swap}) {
      // 动态数组占一个 Fragment 槽位。swap 时 key B 改为 C，故该行删除并插入；
      // 外层 Suspense 仍处于同一槽位，其 hydration ID 路径不应受数组内部替换影响。
      const children = [
        <DivWithId key="A" />,
        swap ? <DivWithId key="C" /> : <DivWithId key="B" />,
        <DivWithId key="D" />,
      ];
      return (
        <Suspense key="boundary" fallback="Loading...">
          {children}
          <span ref={span} />
        </Suspense>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    const dehydratedSpan = container.getElementsByTagName('span')[0];
    await clientAct(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App />);
      await waitForPaint([]);
      expect(container).toMatchInlineSnapshot(`
        <div
          id="container"
        >
          <!--$-->
          <div
            id="101"
          />
          <div
            id="1001"
          />
          <div
            id="1101"
          />
          <span />
          <!--/$-->
        </div>
      `);

      // 内层边界尚未完成水合。
      expect(span.current).toBe(null);

      // 将 key B 替换为 key C，要求新实例使用客户端 ID。
      root.render(<App swap={true} />);
    });
    // 元素交换不应导致 hydration mismatch。
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <!--$-->
        <div
          id="101"
        />
        <div
          id="CLIENT_GENERATED_ID"
        />
        <div
          id="1101"
        />
        <span />
        <!--/$-->
      </div>
    `);
    // span ref 指向原服务端节点，证明该边界成功水合。
    expect(span.current).toBe(dehydratedSpan);
  });

  /** SSR 与 hydrateRoot 同设 custom-prefix-，两初始子保留 R_1/R_2；客户端再增一子为 r_0，验证前缀跨服务端与客户端分配均生效。 */
  it('identifierPrefix option', async () => {

    /** 把原始 ID 输出为文本，观察自定义 prefix 及 R/r 区别。 */
    function Child() {
      const id = useId();
      return <div>{id}</div>;
    }

    /** 先渲染两个 Child，showMore 时增加只在客户端挂载的第三项。 */
    function App({showMore}) {
      return (
        <>
          <Child />
          <Child />
          {showMore && <Child />}
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        identifierPrefix: 'custom-prefix-',
      });
      pipe(writable);
    });
    let root;
    await clientAct(async () => {
      root = ReactDOMClient.hydrateRoot(container, <App />, {
        identifierPrefix: 'custom-prefix-',
      });
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _custom-prefix-R_1_
        </div>
        <div>
          _custom-prefix-R_2_
        </div>
      </div>
    `);

    // 挂载一个新的，仅客户端使用的 ID
    await clientAct(async () => {
      root.render(<App showMore={true} />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _custom-prefix-R_1_
        </div>
        <div>
          _custom-prefix-R_2_
        </div>
        <div>
          _custom-prefix-r_0_
        </div>
      </div>
    `);
  });

  // https://github.com/vercel/next.js/issues/43033：Strict Mode 重渲染曾重置 localIdCounter，
  // 但 rerender Hook 不会再次递增它；问题只会影响后续 useId 的子级与 sibling 计数器，而非首个 ID。

  /** StrictMode 下 Parent 与 Child 各调用 useId；水合前后快照均为 R_0/R_7，回归检查开发 rerender 仍记住父已消费 ID，避免子路径计数重置。 */
  it('does not forget it mounted an id when re-rendering in dev', async () => {

    /** 自身消费 useId 后再输出 Child，让开发重复渲染必须保留父 ID 消费计数。 */
    function Parent() {
      const id = useId();
      return (
        <div>
          {id} <Child />
        </div>
      );
    }

    /** 输出子 useId 文本，回归检查父 rerender 后的派生路径。 */
    function Child() {
      const id = useId();
      return <div>{id}</div>;
    }

    /** 以 StrictMode 包住 Parent，制造开发重复执行条件。 */
    function App({showMore}) {
      return (
        <React.StrictMode>
          <Parent />
        </React.StrictMode>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _R_0_
          <!-- -->
           
          <div>
            _R_7_
          </div>
        </div>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _R_0_
          <!-- -->
           
          <div>
            _R_7_
          </div>
        </div>
      </div>
    `);
  });
});
