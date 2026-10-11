let React;
let Suspense;
let ReactNoop;
let Scheduler;
let act;
let Random;
let ReactFeatureFlags;

/** 为可复现的模糊测试选择随机种子；未注入环境变量时固定为默认序列。 */
const SEED = process.env.FUZZ_TEST_SEED || 'default';
/** 提供 React 元素插件的格式化器，失败时用于输出可直接复现的随机树。 */
const prettyFormatPkg = require('pretty-format');

/**
 * 将失败的 React 测试树格式化为可读文本。
 *
 * 边界：这里只负责诊断展示，不参与随机树生成或渲染结果比较。
 */
function prettyFormat(thing) {
  return prettyFormatPkg.format(thing, {
    plugins: [
      prettyFormatPkg.plugins.ReactElement,
      prettyFormatPkg.plugins.ReactTestComponent,
    ],
  });
}

/** 覆盖随机 Suspense 树在预加载、并发挂起和旧模式下的最终一致性。 */
describe('ReactSuspenseFuzz', () => {
  /** 每个场景都重载 React 运行时，隔离缓存、功能开关和虚拟渲染器状态。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Suspense = React.Suspense;
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    Random = require('random-seed');
    ReactFeatureFlags = require('shared/ReactFeatureFlags');
  });

  jest.setTimeout(20000);

  /**
   * 创建一套彼此隔离的随机树生成器和可控异步渲染基元。
   *
   * 状态：`pendingTasks` 跟踪计时器任务，`cache` 保存文本对应的值或 thenable；
   * 每种渲染模式开始前重建二者；任务结束依赖测试 act 冲刷计时器，pendingTasks 仅登记任务，没有独立的清空断言。
   */
  function createFuzzer() {
    const {useState, useContext, useLayoutEffect} = React;

    const ShouldSuspendContext = React.createContext(true);

    let pendingTasks = new Set();
    let cache = new Map();

    /** 重建任务集合与资源缓存，为下一种渲染模式建立相同的初始状态。 */
    function resetCache() {
      pendingTasks = new Set();
      cache = new Map();
    }

    /**
     * 按 `remountAfter` 时间表递增 key，从而强制整棵子树卸载并重新挂载。
     *
     * 清理边界：卸载或更新计划改变时，同时从任务集合移除并取消所有计时器。
     */
    function Container({children, updates}) {
      const [step, setStep] = useState(0);

      useLayoutEffect(() => {
        if (updates !== undefined) {
          const cleanUps = new Set();
          updates.forEach(({remountAfter}, i) => {
            const task = {
              label: `Remount children after ${remountAfter}ms`,
            };
            const timeoutID = setTimeout(() => {
              pendingTasks.delete(task);
              setStep(i + 1);
            }, remountAfter);
            pendingTasks.add(task);
            cleanUps.add(() => {
              pendingTasks.delete(task);
              clearTimeout(timeoutID);
            });
          });
          return () => {
            cleanUps.forEach(cleanUp => cleanUp());
          };
        }
      }, [updates]);

      return <React.Fragment key={step}>{children}</React.Fragment>;
    }

    /**
     * 模拟会在初次读取或后续更新中挂起的文本资源。
     *
     * 状态：`step` 标识当前版本，`delay` 决定该版本是否通过 thenable 挂起；
     * 完成后把缓存从 thenable 替换为最终字符串，React 重试即可读取稳定值。
     */
    function Text({text, initialDelay = 0, updates}) {
      const [[step, delay], setStep] = useState([0, initialDelay]);

      useLayoutEffect(() => {
        if (updates !== undefined) {
          const cleanUps = new Set();
          updates.forEach(({beginAfter, suspendFor}, i) => {
            const task = {
              label: `Update ${beginAfter}ms after mount and suspend for ${suspendFor}ms [${text}]`,
            };
            const timeoutID = setTimeout(() => {
              pendingTasks.delete(task);
              setStep([i + 1, suspendFor]);
            }, beginAfter);
            pendingTasks.add(task);
            cleanUps.add(() => {
              pendingTasks.delete(task);
              clearTimeout(timeoutID);
            });
          });
          return () => {
            cleanUps.forEach(cleanUp => cleanUp());
          };
        }
      }, [updates]);

      const fullText = `[${text}:${step}]`;

      const shouldSuspend = useContext(ShouldSuspendContext);

      let resolvedText;
      if (shouldSuspend && delay > 0) {
        resolvedText = cache.get(fullText);
        if (resolvedText === undefined) {
          const thenable = {
            /**
             * 订阅当前文本版本的完成通知，并在延迟到期后唤醒 React。
             * 同一个 `fullText` 只缓存一个 thenable，重复读取会抛出同一对象。
             */
            then(resolve) {
              const task = {label: `Promise resolved [${fullText}]`};
              pendingTasks.add(task);
              setTimeout(() => {
                cache.set(fullText, fullText);
                pendingTasks.delete(task);
                resolve();
              }, delay);
            },
          };
          cache.set(fullText, thenable);
          throw thenable;
        } else if (typeof resolvedText.then === 'function') {
          throw resolvedText;
        }
      } else {
        resolvedText = fullText;
      }

      return resolvedText;
    }

    /**
     * 用三种数据/渲染模式执行同一棵树，并比较全部任务完成后的宿主输出。
     *
     * 验证机制：不挂起的预加载渲染生成基准；并发挂起渲染以及启用时的旧模式
     * 渲染都必须与该基准深度相等，证明中间回退和重试不会改变最终结果。
     */
    async function testResolvedOutput(unwrappedChildren) {
      const children = (
        <Suspense fallback="Loading...">{unwrappedChildren}</Suspense>
      );

      // 先以“数据已经全部预加载”的方式禁用挂起，再以真实会挂起的数据重复渲染。
      resetCache();
      const expectedRoot = ReactNoop.createRoot();
      await act(() => {
        expectedRoot.render(
          <ShouldSuspendContext.Provider value={false}>
            {children}
          </ShouldSuspendContext.Provider>,
        );
      });

      const expectedOutput = expectedRoot.getChildrenAsJSX();

      resetCache();

      const concurrentRootThatSuspends = ReactNoop.createRoot();
      await act(() => {
        concurrentRootThatSuspends.render(children);
      });

      resetCache();

      // 功能开关允许时，再用旧模式覆盖同一输入，守住两种根实现的最终一致性。
      if (!ReactFeatureFlags.disableLegacyMode) {
        const legacyRootThatSuspends = ReactNoop.createLegacyRoot();
        await act(() => {
          legacyRootThatSuspends.render(children);
        });

        expect(legacyRootThatSuspends.getChildrenAsJSX()).toEqual(
          expectedOutput,
        );
      }

      // 所有计时任务完成后，并发根也必须收敛到预加载基准输出。
      expect(concurrentRootThatSuspends.getChildrenAsJSX()).toEqual(
        expectedOutput,
      );

      // TODO：这些 Scheduler 日志只服务于失败调试，当前没有断言消费；保留清理以免泄漏到后续用例。
      Scheduler.unstable_clearLog();
    }

    /**
     * 按权重从候选项中抽样，权重越大命中区间越长。
     *
     * WHY：使用连续区间减法而非展开数组，避免权重大时额外分配；调用者保证
     * 候选非空且总权重大于零，因此正常路径一定在循环内返回。
     */
    function pickRandomWeighted(rand, options) {
      let totalWeight = 0;
      for (let i = 0; i < options.length; i++) {
        totalWeight += options[i].weight;
      }
      let remainingWeight = rand.floatBetween(0, totalWeight);
      for (let i = 0; i < options.length; i++) {
        const {value, weight} = options[i];
        remainingWeight -= weight;
        if (remainingWeight <= 0) {
          return value;
        }
      }
    }

    /**
     * 在元素预算内递归生成文本、重挂载容器和 Suspense 边界的随机组合。
     *
     * 边界：每创建一个真实节点都递减 `remainingElements`；单层最多三个子节点，
     * 根层不限制兄弟数；容器/文本/边界消耗全局预算。return 分支可加入 null 而不消耗预算，生成停止依赖随机序列最终选择耗预算节点。
     */
    function generateTestCase(rand, numberOfElements) {
      let remainingElements = numberOfElements;

      /**
       * 为当前位置选择一个随机子节点。
       * 首个子节点不允许立刻创建递归容器或边界，避免在没有兄弟时持续向深处偏斜。
       */
      function createRandomChild(hasSibling) {
        const possibleActions = [
          {value: 'return', weight: 1},
          {value: 'text', weight: 1},
        ];

        if (hasSibling) {
          possibleActions.push({value: 'container', weight: 1});
          possibleActions.push({value: 'suspense', weight: 1});
        }

        const action = pickRandomWeighted(rand, possibleActions);

        switch (action) {
          case 'text': {
            remainingElements--;

            const numberOfUpdates = pickRandomWeighted(rand, [
              {value: 0, weight: 8},
              {value: 1, weight: 4},
              {value: 2, weight: 1},
            ]);

            const updates = [];
            for (let i = 0; i < numberOfUpdates; i++) {
              updates.push({
                beginAfter: rand.intBetween(0, 10000),
                suspendFor: rand.intBetween(0, 10000),
              });
            }

            return (
              <Text
                text={(remainingElements + 9).toString(36).toUpperCase()}
                initialDelay={rand.intBetween(0, 10000)}
                updates={updates}
              />
            );
          }
          case 'container': {
            const numberOfUpdates = pickRandomWeighted(rand, [
              {value: 0, weight: 8},
              {value: 1, weight: 4},
              {value: 2, weight: 1},
            ]);

            const updates = [];
            for (let i = 0; i < numberOfUpdates; i++) {
              updates.push({
                remountAfter: rand.intBetween(0, 10000),
              });
            }

            remainingElements--;
            const children = createRandomChildren(3);
            return React.createElement(Container, {updates}, ...children);
          }
          case 'suspense': {
            remainingElements--;
            const children = createRandomChildren(3);

            const fallbackType = pickRandomWeighted(rand, [
              {value: 'none', weight: 1},
              {value: 'normal', weight: 1},
              {value: 'nested suspense', weight: 1},
            ]);

            let fallback;
            if (fallbackType === 'normal') {
              fallback = 'Loading...';
            } else if (fallbackType === 'nested suspense') {
              fallback = React.createElement(
                React.Fragment,
                null,
                ...createRandomChildren(3),
              );
            }

            return React.createElement(Suspense, {fallback}, ...children);
          }
          case 'return':
          default:
            return null;
        }
      }

      /** 在剩余元素预算和当前兄弟上限共同约束下生成子节点数组。 */
      function createRandomChildren(limit) {
        const children = [];
        while (remainingElements > 0 && children.length < limit) {
          children.push(createRandomChild(children.length > 0));
        }
        return children;
      }

      const children = createRandomChildren(Infinity);
      return React.createElement(React.Fragment, null, ...children);
    }

    return {Container, Text, testResolvedOutput, generateTestCase};
  }

  /**
   * 场景（Given–When–Then）：给定 150ms 后重挂载的容器、初次延迟 2000ms 且挂载后 100ms 更新并延迟 200ms 的 Hi 文本；当分别执行
   * 预加载、并发挂起及可用的旧模式渲染；那么三者最终宿主树必须完全一致。
   * 对应机制：`Container` 的 key 重置、`Text` 的 thenable 缓存与 `testResolvedOutput`。
   */
  it('basic cases', async () => {
    // 这个最小组合先证明模糊测试所依赖的计时、重挂载和挂起基元能够协同工作。
    const {Container, Text, testResolvedOutput} = createFuzzer();
    await testResolvedOutput(
      <Container updates={[{remountAfter: 150}]}>
        <Text
          text="Hi"
          initialDelay={2000}
          updates={[{beginAfter: 100, suspendFor: 200}]}
        />
      </Container>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定由`SEED`（环境覆盖或默认 default）生成的 250 棵、每棵预算 12 个元素的
   * 随机树；当每棵树依次经过基准与挂起渲染；那么所有最终输出相等，失败时打印种子
   * 和树结构以便精确复现。对应机制：`generateTestCase` 与 `testResolvedOutput`。
   */
  it(`generative tests (random seed: ${SEED})`, async () => {
    const {generateTestCase, testResolvedOutput} = createFuzzer();

    const rand = Random.create(SEED);

    // 数量过大会触发本文件的超时；计划任务会另行使用随机种子扩大探索范围。
    const NUMBER_OF_TEST_CASES = 250;
    const ELEMENTS_PER_CASE = 12;

    for (let i = 0; i < NUMBER_OF_TEST_CASES; i++) {
      const randomTestCase = generateTestCase(rand, ELEMENTS_PER_CASE);
      try {
        await testResolvedOutput(randomTestCase);
      } catch (e) {
        console.log(`
Failed fuzzy test case:

${prettyFormat(randomTestCase)}

Random seed is ${SEED}
`);

        throw e;
      }
    }
  });

  /** 固化模糊测试曾覆盖到的代表性组合，防止随机序列变化掩盖已知边界。 */
  describe('hard-coded cases', () => {
    /**
     * 场景（Given–When–Then）：给定边界外 A 更新挂起、边界内 B 初次与更新挂起以及稳定 C；
     * 当计时交错触发重试；那么并发与旧模式最终仍等于预加载结果。
     * 对应机制：同一 Suspense 边界中的 thenable 合并与 `testResolvedOutput` 深度比较。
     */
    it('1', async () => {
      const {Text, testResolvedOutput} = createFuzzer();
      await testResolvedOutput(
        <>
          <Text
            initialDelay={20}
            text="A"
            updates={[{beginAfter: 10, suspendFor: 20}]}
          />
          <Suspense fallback="Loading... (B)">
            <Text
              initialDelay={10}
              text="B"
              updates={[{beginAfter: 30, suspendFor: 50}]}
            />
            <Text text="C" />
          </Suspense>
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定两个独立边界，其中第二个容器含 B/C/D 三种延迟；
     * 当资源按不同顺序就绪；那么边界隔离不改变最终兄弟顺序和文本。
     * 对应机制：`Text` 资源缓存及两个 Suspense 边界的独立重试。
     */
    it('2', async () => {
      const {Text, Container, testResolvedOutput} = createFuzzer();
      await testResolvedOutput(
        <>
          <Suspense fallback="Loading...">
            <Text initialDelay={7200} text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Container>
              <Text initialDelay={1000} text="B" />
              <Text initialDelay={7200} text="C" />
              <Text initialDelay={9000} text="D" />
            </Container>
          </Suspense>
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定 A/C 在初次挂起后再次更新挂起，且 C 位于普通容器；
     * 当跨边界更新与 B/D 的初次完成交错；那么最终树与无挂起基准相等。
     * 对应机制：版本化 `fullText` 缓存、布局阶段更新计时和 Suspense 重试。
     */
    it('3', async () => {
      const {Text, Container, testResolvedOutput} = createFuzzer();
      await testResolvedOutput(
        <>
          <Suspense fallback="Loading...">
            <Text
              initialDelay={3183}
              text="A"
              updates={[
                {
                  beginAfter: 2256,
                  suspendFor: 6696,
                },
              ]}
            />
            <Text initialDelay={3251} text="B" />
          </Suspense>
          <Container>
            <Text
              initialDelay={2700}
              text="C"
              updates={[
                {
                  beginAfter: 3266,
                  suspendFor: 9139,
                },
              ]}
            />
            <Text initialDelay={6732} text="D" />
          </Container>
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定多层无显式 fallback 的嵌套边界、慢文本 E 与两次更新的 C；
     * 当内层 thenable 依次解决；那么未定义回退也不会破坏最终文本树。
     * 对应机制：嵌套 Suspense 冒泡与 `testResolvedOutput` 的最终输出比较。
     */
    it('4', async () => {
      const {Text, testResolvedOutput} = createFuzzer();
      await testResolvedOutput(
        <React.Suspense fallback="Loading...">
          <React.Suspense>
            <React.Suspense>
              <Text initialDelay={9683} text="E" updates={[]} />
            </React.Suspense>
            <Text
              initialDelay={4053}
              text="C"
              updates={[
                {
                  beginAfter: 1566,
                  suspendFor: 4142,
                },
                {
                  beginAfter: 9572,
                  suspendFor: 4832,
                },
              ]}
            />
          </React.Suspense>
        </React.Suspense>,
      );
    });
  });
});
