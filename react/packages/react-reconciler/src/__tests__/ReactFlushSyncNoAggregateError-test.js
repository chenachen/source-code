let React;
let ReactDOM;
let ReactDOMClient;
let Scheduler;
let act;
let assertLog;

let overrideQueueMicrotask;
let flushFakeMicrotasks;

// TODO：把相关测试统一迁移到 React DOM，不再依赖 React Noop。

/** 验证缺少 AggregateError 时 flushSync 仍耗尽所有同步根，并把剩余错误延迟到 microtask 重抛。 */
describe('ReactFlushSync (AggregateError not available)', () => {
  /**
   * 每例移除 AggregateError、安装可控 queueMicrotask，并重建 DOM roots 依赖。
   * 清理边界由 Jest 环境负责；fake queue 仅在 overrideQueueMicrotask 为 true 时接管任务。
   */
  beforeEach(() => {
    jest.resetModules();

    global.AggregateError = undefined;

    // AggregateError 不可用时，React 会在 microtask 中重抛其余错误。
    // 这是实现细节，但本例需要精确观察，因此替换全局 queueMicrotask。
    const originalQueueMicrotask = queueMicrotask;
    overrideQueueMicrotask = false;
    const fakeMicrotaskQueue = [];
    global.queueMicrotask = cb => {
      if (overrideQueueMicrotask) {
        fakeMicrotaskQueue.push(cb);
      } else {
        originalQueueMicrotask(cb);
      }
    };
    // 顺序耗尽 fake queue；回调可继续排入任务，因此每轮重新检查长度。
    flushFakeMicrotasks = () => {
      while (fakeMicrotaskQueue.length > 0) {
        const cb = fakeMicrotaskQueue.shift();
        cb();
      }
    };

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
  });

  /** 记录 DOM root 的同步提交顺序，并输出相同文本供可见树检查。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /**
   * 把真实 DOM 递归投影为只含可见节点的 ReactNode；忽略脚本、模板、hidden 与 aria-hidden。
   * React 自动生成的带冒号 id 也被剔除，避免实现细节干扰结构断言。
   */
  function getVisibleChildren(element: Element): React$Node {
    const children = [];
    let node: any = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        if (
          ((node.tagName !== 'SCRIPT' && node.tagName !== 'script') ||
            node.hasAttribute('data-meaningful')) &&
          node.tagName !== 'TEMPLATE' &&
          node.tagName !== 'template' &&
          !node.hasAttribute('hidden') &&
          !node.hasAttribute('aria-hidden')
        ) {
          const props: any = {};
          const attributes = node.attributes;
          for (let i = 0; i < attributes.length; i++) {
            if (
              attributes[i].name === 'id' &&
              attributes[i].value.includes(':')
            ) {
              // 带冒号的 id 视为 React 自动添加且不可见的实现细节，不纳入预期树。
              continue;
            }
            props[attributes[i].name] = attributes[i].value;
          }
          props.children = getVisibleChildren(node);
          children.push(
            require('react').createElement(node.tagName.toLowerCase(), props),
          );
        }
      } else if (node.nodeType === 3) {
        children.push(node.data);
      }
      node = node.nextSibling;
    }
    return children.length === 0
      ? undefined
      : children.length === 1
        ? children[0]
        : children;
  }

  /**
   * Given 三个已提交 DOM roots 且环境没有 AggregateError；When 同一次 flushSync 中前两根抛错、第三根更新成功；
   * Then 同步队列仍提交第三根、卸载失败根，并先抛首个错误，再通过 microtask 处理剩余错误。
   * 验证机制：Scheduler 日志、可见 DOM 投影与捕获错误身份；对应 ReactFiberWorkLoop 的同步根队列和错误聚合降级路径。
   */
  it('completely exhausts synchronous work queue even if something throws', async () => {
    /** 在 render 阶段抛出调用方提供的错误，用不同实例标记多根失败顺序。 */
    function Throws({error}) {
      throw error;
    }

    const container1 = document.createElement('div');
    const root1 = ReactDOMClient.createRoot(container1);
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    const container3 = document.createElement('div');
    const root3 = ReactDOMClient.createRoot(container3);

    await act(async () => {
      root1.render(<Text text="Hi" />);
      root2.render(<Text text="Andrew" />);
      root3.render(<Text text="!" />);
    });
    assertLog(['Hi', 'Andrew', '!']);

    const aahh = new Error('AAHH!');
    const nooo = new Error('Noooooooooo!');

    // 开始接管全局 queueMicrotask，以观察剩余错误的延迟重抛行为。
    overrideQueueMicrotask = true;
    let error;
    try {
      await act(() => {
        ReactDOM.flushSync(() => {
          root1.render(<Throws error={aahh} />);
          root2.render(<Throws error={nooo} />);
          root3.render(<Text text="aww" />);
        });
      });
    } catch (e) {
      error = e;
    }

    // 即使前两根出错，第三根更新仍应在同一同步队列中完成。
    assertLog(['aww']);
    // 失败的 root1 与 root2 应被卸载。
    expect(getVisibleChildren(container1)).toEqual(undefined);
    expect(getVisibleChildren(container2)).toEqual(undefined);
    expect(getVisibleChildren(container3)).toEqual('aww');

    // 现代环境会抛 AggregateError；当前环境缺少它，因此 React 先抛首个错误，
    // 再在独立任务中重抛其余错误。
    expect(error).toBe(aahh);
    await flushFakeMicrotasks();
  });
});
