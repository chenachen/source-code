/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 所有绑定都在 `beforeEach` 从全新 `scheduler/unstable_mock` 实例提取，隔离虚拟队列、时钟和日志。
let Scheduler;
let runWithPriority;
let ImmediatePriority;
let UserBlockingPriority;
let NormalPriority;
let LowPriority;
let IdlePriority;
let scheduleCallback;
let cancelCallback;
let wrapCallback;
let getCurrentPriorityLevel;
let shouldYield;
let waitForAll;
let assertLog;
let waitFor;
let waitForPaint;

// Mock Scheduler 让测试按 yield 边界推进工作，而不是依赖真实 host event；因此可直接证明队列不变量。
describe('Scheduler', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('scheduler', () => require('scheduler/unstable_mock'));

    Scheduler = require('scheduler');

    runWithPriority = Scheduler.unstable_runWithPriority;
    ImmediatePriority = Scheduler.unstable_ImmediatePriority;
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
    NormalPriority = Scheduler.unstable_NormalPriority;
    LowPriority = Scheduler.unstable_LowPriority;
    IdlePriority = Scheduler.unstable_IdlePriority;
    scheduleCallback = Scheduler.unstable_scheduleCallback;
    cancelCallback = Scheduler.unstable_cancelCallback;
    wrapCallback = Scheduler.unstable_wrapCallback;
    getCurrentPriorityLevel = Scheduler.unstable_getCurrentPriorityLevel;
    shouldYield = Scheduler.unstable_shouldYield;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
  });

  /**
   * Given：四个同优先级 callback 依次入队。
   * When：先后按 2、1、剩余全部三个观察边界排空。
   * Then：每次只产生请求数量的日志，未执行任务留在 ready queue 并保持 FIFO。
   *
   * 验证机制：连续三次断言共同证明 incremental flush 不会提前消费后续 callback。
   * 对应源码：`SchedulerMock` 的 flush/yield 控制与 `workLoop()` 堆顶推进。
   */
  it('flushes work incrementally', async () => {
    scheduleCallback(NormalPriority, () => Scheduler.log('A'));
    scheduleCallback(NormalPriority, () => Scheduler.log('B'));
    scheduleCallback(NormalPriority, () => Scheduler.log('C'));
    scheduleCallback(NormalPriority, () => Scheduler.log('D'));

    await waitFor(['A', 'B']);
    await waitFor(['C']);
    await waitForAll(['D']);
  });

  /**
   * Given：A、B、C 同优先级入队，B 的 handle 随后被取消。
   * When：排空全部工作。
   * Then：只执行 A、C，且 C 仍保持原相对顺序。
   *
   * 验证机制：日志缺少 B 同时保留两侧任务，证明取消是精确的惰性 callback 清空而非截断队列。
   * 对应源码：`unstable_cancelCallback()` 与 `workLoop()` 对 null callback 的移除分支。
   */
  it('cancels work', async () => {
    scheduleCallback(NormalPriority, () => Scheduler.log('A'));
    const callbackHandleB = scheduleCallback(NormalPriority, () =>
      Scheduler.log('B'),
    );
    scheduleCallback(NormalPriority, () => Scheduler.log('C'));

    cancelCallback(callbackHandleB);

    await waitForAll([
      'A',
      // B 已取消，不应留下任何 callback 日志。
      'C',
    ]);
  });

  /**
   * Given：Normal 队列执行 A 后 yield，随后加入两个 UserBlocking callback。
   * When：继续排空所有 ready work。
   * Then：C、D 抢在剩余 Normal callback B 前执行。
   *
   * 验证机制：日志 `C → D → B` 证明 heap 按 expirationTime 重排，而非固守首次入队顺序。
   * 对应源码：`unstable_scheduleCallback()` 的 timeout 映射与 `SchedulerMinHeap.compare()`。
   */
  it('executes the highest priority callbacks first', async () => {
    scheduleCallback(NormalPriority, () => Scheduler.log('A'));
    scheduleCallback(NormalPriority, () => Scheduler.log('B'));

    // 在 B 执行前主动形成观察边界，使后加入的高优先级工作有机会重排堆顶。
    await waitFor(['A']);

    scheduleCallback(UserBlockingPriority, () => Scheduler.log('C'));
    scheduleCallback(UserBlockingPriority, () => Scheduler.log('D'));

    // C、D 的过期时间更早，必须先于仍在 ready queue 的 B。
    await waitForAll(['C', 'D', 'B']);
  });

  /**
   * Given：Normal 与 UserBlocking callback 在不同虚拟时刻入队，callback 本身还会推进时间。
   * When：依次推进到 250ms 和 5000ms 过期阈值，并分别 flush。
   * Then：过期任务收到 `didTimeout: true` 且突破时间片连续执行，未过期任务仍可正常 yield。
   *
   * 验证机制：每阶段同时断言执行顺序和 `didTimeout` 参数，覆盖 timer/ready queue 的时间迁移。
   * 对应源码：`advanceTimers()`、priority timeout 常量与 `workLoop()` 的 `expirationTime <= currentTime` 分支。
   */
  it('expires work', async () => {
    scheduleCallback(NormalPriority, didTimeout => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log(`A (did timeout: ${didTimeout})`);
    });
    scheduleCallback(UserBlockingPriority, didTimeout => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log(`B (did timeout: ${didTimeout})`);
    });
    scheduleCallback(UserBlockingPriority, didTimeout => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log(`C (did timeout: ${didTimeout})`);
    });

    // 推进到任何任务都尚未过期的位置，确认仅时间流逝不会自动执行 callback。
    Scheduler.unstable_advanceTime(249);
    assertLog([]);

    // 在较晚起点追加 Normal callback，使它们拥有不同的绝对过期时间。
    scheduleCallback(NormalPriority, didTimeout => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log(`D (did timeout: ${didTimeout})`);
    });
    scheduleCallback(NormalPriority, didTimeout => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log(`E (did timeout: ${didTimeout})`);
    });

    // 再推进 1ms，恰好使最早的 UserBlocking callback 过期。
    Scheduler.unstable_advanceTime(1);
    await waitFor(['B (did timeout: true)', 'C (did timeout: true)']);

    // 推进到 A 的 Normal 过期阈值。
    Scheduler.unstable_advanceTime(4600);
    await waitFor(['A (did timeout: true)']);

    // 排空剩余工作；E 会因前一个 callback 内推进时间而在执行前跨过自身过期点。
    await waitForAll(['D (did timeout: false)', 'E (did timeout: true)']);
  });

  /** 场景：Normal callback 的默认 timeout 为 5000ms；4999ms 不执行，恰到阈值后可被 `flushExpired()` 取出。 */
  it('has a default expiration of ~5 seconds', () => {
    scheduleCallback(NormalPriority, () => Scheduler.log('A'));

    Scheduler.unstable_advanceTime(4999);
    assertLog([]);

    Scheduler.unstable_advanceTime(1);
    Scheduler.unstable_flushExpired();
    assertLog(['A']);
  });

  /**
   * Given：A、B、分段任务 C、D、E 同优先级入队，C 在 `shouldYield()` 时返回自身。
   * When：首轮 flush 在 C1 后 yield，再排空剩余工作。
   * Then：恢复时先继续同一 task 的 C2、C3，之后才轮到 D、E。
   *
   * 验证机制：`didYield` 与日志顺序共同证明 continuation 复用当前 task，而非作为新 task 排到队尾。
   * 对应源码：`workLoop()` 将返回函数写回 `currentTask.callback` 并保留 heap 节点。
   */
  it('continues working on same task after yielding', async () => {
    scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log('A');
    });
    scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log('B');
    });

    let didYield = false;
    const tasks = [
      ['C1', 100],
      ['C2', 100],
      ['C3', 100],
    ];
    /** 每次执行一段 C 工作；达到 yield 条件时返回自身作为同一 task 的 continuation。 */
    const C = () => {
      while (tasks.length > 0) {
        const [label, ms] = tasks.shift();
        Scheduler.unstable_advanceTime(ms);
        Scheduler.log(label);
        if (shouldYield()) {
          didYield = true;
          return C;
        }
      }
    };

    scheduleCallback(NormalPriority, C);

    scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log('D');
    });
    scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log('E');
    });

    // 首次 flush 在 C 中段形成 yield 边界。
    expect(didYield).toBe(false);
    await waitFor(['A', 'B', 'C1']);
    expect(didYield).toBe(true);

    // 恢复后先续跑 C，再访问排在其后的 D、E。
    await waitForAll(['C2', 'C3', 'D', 'E']);
  });

  /**
   * Given：一个 UserBlocking callback 分段返回 continuation，原 task 距 250ms 过期点只差 1ms。
   * When：推进最后 1ms 后调用 `flushExpired()`。
   * Then：剩余 C、D 作为原 task 的 continuation 一次执行完，而不是获得新的 250ms timeout。
   *
   * 验证机制：若 continuation 被当作新 task，其 expiration 会后移且 `flushExpired()` 不会输出 C、D。
   * 对应源码：`workLoop()` 只替换 `currentTask.callback`，保留原 `expirationTime`。
   */
  it('continuation callbacks inherit the expiration of the previous callback', async () => {
    const tasks = [
      ['A', 125],
      ['B', 124],
      ['C', 100],
      ['D', 100],
    ];
    /** 分段推进时间；到达 host yield 条件时返回自身，但不创建新的调度节点。 */
    const work = () => {
      while (tasks.length > 0) {
        const [label, ms] = tasks.shift();
        Scheduler.unstable_advanceTime(ms);
        Scheduler.log(label);
        if (shouldYield()) {
          return work;
        }
      }
    };

    // UserBlocking task 的绝对过期时间由首次入队时刻决定。
    scheduleCallback(UserBlockingPriority, work);

    // 执行到原过期时间前 1ms，并保存 continuation。
    await waitFor(['A', 'B']);

    // 跨过原 task 的过期点后，所有剩余 continuation 都属于已过期工作。
    Scheduler.unstable_advanceTime(1);
    Scheduler.unstable_flushExpired();
    assertLog(['C', 'D']);
  });

  /**
   * Given：Normal task 在 A 后留下 continuation，随后加入 UserBlocking task。
   * When：继续排空 ready queue。
   * Then：高优先级 callback 先执行，再恢复 Normal continuation 的 B、C、D。
   * 对应源码：ready heap 仍以 task expirationTime 决定下一堆顶，continuation 不享有不可中断特权。
   */
  it('continuations are interrupted by higher priority work', async () => {
    const tasks = [
      ['A', 100],
      ['B', 100],
      ['C', 100],
      ['D', 100],
    ];
    /** 在 host 要求 yield 时保存剩余分段为 continuation。 */
    const work = () => {
      while (tasks.length > 0) {
        const [label, ms] = tasks.shift();
        Scheduler.unstable_advanceTime(ms);
        Scheduler.log(label);
        if (tasks.length > 0 && shouldYield()) {
          return work;
        }
      }
    };
    scheduleCallback(NormalPriority, work);
    await waitFor(['A']);

    scheduleCallback(UserBlockingPriority, () => {
      Scheduler.unstable_advanceTime(100);
      Scheduler.log('High pri');
    });

    await waitForAll(['High pri', 'B', 'C', 'D']);
  });

  /**
   * Given：Normal continuation 在执行 B 时从 callback 内安排 UserBlocking work。
   * When：B 返回下一段 continuation。
   * Then：新高优先级 callback 抢在 C、D 前执行。
   *
   * 验证机制：日志严格要求 `Schedule high pri → High pri → C → D`，证明 callback 返回 continuation 后
   * `workLoop()` 会重新查看 heap 堆顶，而非立即递归调用 continuation。
   */
  it(
    'continuations do not block higher priority work scheduled ' +
      'inside an executing callback',
    async () => {
      const tasks = [
        ['A', 100],
        ['B', 100],
        ['C', 100],
        ['D', 100],
      ];
      /** 每轮只执行一段，并在 B 内插入高优先级 task 后返回自身。 */
      const work = () => {
        while (tasks.length > 0) {
          const task = tasks.shift();
          const [label, ms] = task;
          Scheduler.unstable_advanceTime(ms);
          Scheduler.log(label);
          if (label === 'B') {
            // 从正在执行的低优先级 callback 内加入高优先级工作。
            Scheduler.log('Schedule high pri');
            scheduleCallback(UserBlockingPriority, () => {
              Scheduler.unstable_advanceTime(100);
              Scheduler.log('High pri');
            });
          }
          if (tasks.length > 0) {
            // 返回 continuation，让调度循环重新比较 ready heap。
            return work;
          }
        }
      };
      scheduleCallback(NormalPriority, work);
      await waitForAll([
        'A',
        'B',
        'Schedule high pri',
        // 高优先级 callback 必须先于低优先级 continuation。
        'High pri',
        // 高优先级工作完成后再恢复低优先级分段。
        'C',
        'D',
      ]);
    },
  );

  /** 场景：callback 已 yield 并保存 continuation 后取消原 handle；续段不得执行。 */
  it('cancelling a continuation', async () => {
    const task = scheduleCallback(NormalPriority, () => {
      Scheduler.log('Yield');
      return () => {
        Scheduler.log('Continuation');
      };
    });

    await waitFor(['Yield']);
    cancelCallback(task);
    await waitForAll([]);
  });

  /**
   * 场景：顶层 Immediate callback 只在后续 flush task 中执行，但到期队列一旦开始排空会连续完成全部四个。
   * 对应源码：Immediate timeout 为 -1，入队不等于同步调用；`flushExpired()` 才驱动 work loop。
   */
  it('top-level immediate callbacks fire in a subsequent task', () => {
    scheduleCallback(ImmediatePriority, () => Scheduler.log('A'));
    scheduleCallback(ImmediatePriority, () => Scheduler.log('B'));
    scheduleCallback(ImmediatePriority, () => Scheduler.log('C'));
    scheduleCallback(ImmediatePriority, () => Scheduler.log('D'));
    // Immediate 仅表示已过期优先级，不表示在 `scheduleCallback()` 调用栈内同步执行。
    assertLog([]);
    // 后续 flush task 开始后，全部已过期 callback 连续排空。
    Scheduler.unstable_flushExpired();
    assertLog(['A', 'B', 'C', 'D']);
  });

  /** 场景：Immediate callback B 执行中安排 C；C 使用更大的 task id，故排在既有 D 后面。 */
  it('nested immediate callbacks are added to the queue of immediate callbacks', () => {
    scheduleCallback(ImmediatePriority, () => Scheduler.log('A'));
    scheduleCallback(ImmediatePriority, () => {
      Scheduler.log('B');
      // C 与现有 Immediate task 同过期时间，但 id 更大，因此追加到该优先级队尾。
      scheduleCallback(ImmediatePriority, () => Scheduler.log('C'));
    });
    scheduleCallback(ImmediatePriority, () => Scheduler.log('D'));
    assertLog([]);
    // 同过期时间由 task id 保持 FIFO，所以新加入的 C 最后执行。
    Scheduler.unstable_flushExpired();
    assertLog(['A', 'B', 'D', 'C']);
  });

  /** 场景：`wrapCallback()` 必须原样转发可变参数和返回值，不能只保存 priority 而改变函数签名。 */
  it('wrapped callbacks have same signature as original callback', () => {
    const wrappedCallback = wrapCallback((...args) => ({args}));
    expect(wrappedCallback('a', 'b')).toEqual({args: ['a', 'b']});
  });

  /**
   * Given：分别在 Normal 和 UserBlocking scope 中创建 wrapped callback。
   * When：离开 scope 后调用包装函数。
   * Then：每个函数临时恢复创建时 priority，而不是继承调用点 priority。
   * 对应源码：`unstable_wrapCallback()` 捕获 `currentPriorityLevel`，调用时用 try/finally 恢复前值。
   */
  it('wrapped callbacks inherit the current priority', () => {
    const wrappedCallback = runWithPriority(NormalPriority, () =>
      wrapCallback(() => {
        Scheduler.log(getCurrentPriorityLevel());
      }),
    );

    const wrappedUserBlockingCallback = runWithPriority(
      UserBlockingPriority,
      () =>
        wrapCallback(() => {
          Scheduler.log(getCurrentPriorityLevel());
        }),
    );

    wrappedCallback();
    assertLog([NormalPriority]);

    wrappedUserBlockingCallback();
    assertLog([UserBlockingPriority]);
  });

  /** 场景：嵌套 priority scope 中创建的两个 wrapped callback 各自捕获最内层有效 priority。 */
  it('wrapped callbacks inherit the current priority even when nested', () => {
    let wrappedCallback;
    let wrappedUserBlockingCallback;

    runWithPriority(NormalPriority, () => {
      wrappedCallback = wrapCallback(() => {
        Scheduler.log(getCurrentPriorityLevel());
      });
      wrappedUserBlockingCallback = runWithPriority(UserBlockingPriority, () =>
        wrapCallback(() => {
          Scheduler.log(getCurrentPriorityLevel());
        }),
      );
    });

    wrappedCallback();
    assertLog([NormalPriority]);

    wrappedUserBlockingCallback();
    assertLog([UserBlockingPriority]);
  });

  /**
   * Given：三个 Immediate callback 中首个和末个抛错。
   * When：分两次调用 `flushExpired()`。
   * Then：首错误中止当前 host 事件；B、C 在后续事件继续，C 的错误仍向外传播。
   *
   * 验证机制：两次独立 `toThrow` 与阶段日志证明异常既不会吞掉队列，也不会吞掉后续错误。
   * 对应源码：Scheduler work loop 的异常退出、host callback 重调度及状态 `finally` 清理。
   */
  it("immediate callbacks fire even if there's an error", () => {
    scheduleCallback(ImmediatePriority, () => {
      Scheduler.log('A');
      throw new Error('Oops A');
    });
    scheduleCallback(ImmediatePriority, () => {
      Scheduler.log('B');
    });
    scheduleCallback(ImmediatePriority, () => {
      Scheduler.log('C');
      throw new Error('Oops C');
    });

    expect(() => Scheduler.unstable_flushExpired()).toThrow('Oops A');
    assertLog(['A']);

    // B、C 在后续 host 事件继续排空，使第二个错误拥有独立传播机会。
    expect(() => Scheduler.unstable_flushExpired()).toThrow('Oops C');
    assertLog(['B', 'C']);
  });

  /** 场景：两个 Immediate callback 依次抛错；每个 host flush 传播一个错误，第二个不能被首个覆盖。 */
  it('multiple immediate callbacks can throw and there will be an error for each one', () => {
    scheduleCallback(ImmediatePriority, () => {
      throw new Error('First error');
    });
    scheduleCallback(ImmediatePriority, () => {
      throw new Error('Second error');
    });
    expect(() => Scheduler.unstable_flushAll()).toThrow('First error');
    // 第二个错误保留到后续 flush 事件再传播。
    expect(() => Scheduler.unstable_flushAll()).toThrow('Second error');
  });

  /**
   * 场景：`runWithPriority()` 多层嵌套时暴露当前最内层 priority，并在退出后逐层恢复前值。
   * 对应源码：`unstable_runWithPriority()` 保存 previousPriorityLevel 并在 `finally` 恢复。
   */
  it('exposes the current priority level', () => {
    Scheduler.log(getCurrentPriorityLevel());
    runWithPriority(ImmediatePriority, () => {
      Scheduler.log(getCurrentPriorityLevel());
      runWithPriority(NormalPriority, () => {
        Scheduler.log(getCurrentPriorityLevel());
        runWithPriority(UserBlockingPriority, () => {
          Scheduler.log(getCurrentPriorityLevel());
        });
      });
      Scheduler.log(getCurrentPriorityLevel());
    });

    assertLog([
      NormalPriority,
      ImmediatePriority,
      NormalPriority,
      UserBlockingPriority,
      ImmediatePriority,
    ]);
  });

  if (__DEV__) {
    // 生产构建会压缩函数名；虽然 sourcemap 仍可能推断 priority，本断言只适用于 DEV 栈。
    // TODO：调查某个压缩器缺陷期间暂时禁用该能力测试。
    // eslint-disable-next-line jest/no-disabled-tests
    /**
     * 场景：DEV 调度帧函数名应编码当前 priority，便于从错误调用栈诊断任务级别。
     * 状态：该测试因压缩器问题暂时 skip；注释不把未执行断言当作当前保证。
     */
    it.skip('adds extra function to the JS stack whose name includes the priority level', async () => {
      /**
       * 从当前 Error stack 反向扫描 Scheduler 注入的 priority frame，并映射回数值级别。
       *
       * @returns 找到的 Scheduler priority；栈不含约定 frame 时返回 null。
       */
      function inferPriorityFromCallstack() {
        try {
          throw Error();
        } catch (e) {
          const stack = e.stack;
          const lines = stack.split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const found = line.match(
              /scheduler_flushTaskAtPriority_([A-Za-z]+)/,
            );
            if (found !== null) {
              const priorityStr = found[1];
              switch (priorityStr) {
                case 'Immediate':
                  return ImmediatePriority;
                case 'UserBlocking':
                  return UserBlockingPriority;
                case 'Normal':
                  return NormalPriority;
                case 'Low':
                  return LowPriority;
                case 'Idle':
                  return IdlePriority;
              }
            }
          }
          return null;
        }
      }

      scheduleCallback(ImmediatePriority, () =>
        Scheduler.log('Immediate: ' + inferPriorityFromCallstack()),
      );
      scheduleCallback(UserBlockingPriority, () =>
        Scheduler.log('UserBlocking: ' + inferPriorityFromCallstack()),
      );
      scheduleCallback(NormalPriority, () =>
        Scheduler.log('Normal: ' + inferPriorityFromCallstack()),
      );
      scheduleCallback(LowPriority, () =>
        Scheduler.log('Low: ' + inferPriorityFromCallstack()),
      );
      scheduleCallback(IdlePriority, () =>
        Scheduler.log('Idle: ' + inferPriorityFromCallstack()),
      );

      await waitForAll([
        'Immediate: ' + ImmediatePriority,
        'UserBlocking: ' + UserBlockingPriority,
        'Normal: ' + NormalPriority,
        'Low: ' + LowPriority,
        'Idle: ' + IdlePriority,
      ]);
    });
  }

  // delayed task 先按 `startTime` 留在 timer queue，到期后才迁入按 `expirationTime` 排序的 ready queue。
  describe('delayed tasks', () => {
    /**
     * Given：一个 Normal callback 带 1000ms delay 入队。
     * When：先推进 999ms，再推进到 1000ms 并 flush。
     * Then：阈值前没有日志，恰到 startTime 后像普通 ready task 一样执行。
     * 对应源码：`unstable_scheduleCallback()` 的 timerQueue 分支与 `advanceTimers()`。
     */
    it('schedules a delayed task', async () => {
      scheduleCallback(NormalPriority, () => Scheduler.log('A'), {
        delay: 1000,
      });

      // delay 尚未流逝，任务只存在于 timer queue。
      await waitForAll([]);

      // 推进到 startTime 前 1ms。
      Scheduler.unstable_advanceTime(999);
      // 仍未到期，不能迁入 ready queue。
      await waitForAll([]);

      // 到达 delay 阈值，任务具备运行资格。
      Scheduler.unstable_advanceTime(1);

      // `advanceTimers()` 搬入后按普通 ready task 排空。
      await waitForAll(['A']);
    });

    /**
     * 场景：四个不同 delay 的 task 乱序入队；它们必须按 startTime 到期，且同批到期后可增量 flush。
     * 验证机制：200ms 时只出现 A、B，400ms 时再出现 C、D，证明 timer heap 不依赖入队顺序。
     */
    it('schedules multiple delayed tasks', async () => {
      scheduleCallback(NormalPriority, () => Scheduler.log('C'), {
        delay: 300,
      });

      scheduleCallback(NormalPriority, () => Scheduler.log('B'), {
        delay: 200,
      });

      scheduleCallback(NormalPriority, () => Scheduler.log('D'), {
        delay: 400,
      });

      scheduleCallback(NormalPriority, () => Scheduler.log('A'), {
        delay: 100,
      });

      // 所有任务仍在 timer queue，首次 flush 不产生输出。
      await waitForAll([]);

      // 推进到 A、B 的 startTime。
      Scheduler.unstable_advanceTime(200);
      // A、B 已迁入 ready queue，可按观察边界增量排空。
      await waitFor(['A']);
      await waitForAll(['B']);

      // 再推进 200ms，使 C、D 也到期。
      Scheduler.unstable_advanceTime(200);
      await waitForAll(['C', 'D']);
    });

    /**
     * Given：两个延迟 UserBlocking timer 与四个会推进时间的 Normal task 并存。
     * When：一次排空所有工作。
     * Then：timer 到达 startTime 后立即凭更早 expirationTime 插入 Normal 队列之间。
     *
     * 验证机制：`A → Timer 1 → B → C → Timer 2 → D` 同时证明时间迁移和跨优先级重排。
     * 对应源码：每轮 `workLoop()` 前后的 `advanceTimers()` 与 ready heap 排序。
     */
    it('interleaves normal tasks and delayed tasks', async () => {
      // 延迟的 UserBlocking callback 到达 startTime 后会成为 ready heap 中最紧急的工作。
      scheduleCallback(UserBlockingPriority, () => Scheduler.log('Timer 2'), {
        delay: 300,
      });
      scheduleCallback(UserBlockingPriority, () => Scheduler.log('Timer 1'), {
        delay: 100,
      });

      // Normal callback 通过推进虚拟时间，让两个 timer 在 work loop 运行期间依次到期。
      scheduleCallback(NormalPriority, () => {
        Scheduler.log('A');
        Scheduler.unstable_advanceTime(100);
      });
      scheduleCallback(NormalPriority, () => {
        Scheduler.log('B');
        Scheduler.unstable_advanceTime(100);
      });
      scheduleCallback(NormalPriority, () => {
        Scheduler.log('C');
        Scheduler.unstable_advanceTime(100);
      });
      scheduleCallback(NormalPriority, () => {
        Scheduler.log('D');
        Scheduler.unstable_advanceTime(100);
      });

      // timer 到期后穿插到普通任务之间，而非等 Normal 队列整体结束。
      await waitForAll(['A', 'Timer 1', 'B', 'C', 'Timer 2', 'D']);
    });

    /**
     * Given：Normal task 通过 continuation 分成 A、B、C、D，另有两个延迟 UserBlocking timer。
     * When：每段 Normal work 推进 100ms 并返回自身。
     * Then：到期 timer 会在 continuation 之间抢占，结果与多个独立 Normal task 一致。
     * 对应源码：continuation 保留原节点，但每轮回到 work loop 时仍重新迁移 timer 并比较堆顶。
     */
    it('interleaves delayed tasks with time-sliced tasks', async () => {
      // 延迟 UserBlocking callback 到期后应抢占 Normal continuation。
      scheduleCallback(UserBlockingPriority, () => Scheduler.log('Timer 2'), {
        delay: 300,
      });
      scheduleCallback(UserBlockingPriority, () => Scheduler.log('Timer 1'), {
        delay: 100,
      });

      // 单个 Normal task 每次只完成一段，并返回自身作为 continuation。
      const tasks = [
        ['A', 100],
        ['B', 100],
        ['C', 100],
        ['D', 100],
      ];
      /** 每轮执行一段 Normal 工作，返回自身以形成可被到期 timer 抢占的 continuation。 */
      const work = () => {
        while (tasks.length > 0) {
          const task = tasks.shift();
          const [label, ms] = task;
          Scheduler.unstable_advanceTime(ms);
          Scheduler.log(label);
          if (tasks.length > 0) {
            return work;
          }
        }
      };
      scheduleCallback(NormalPriority, work);

      // timer 应穿插到 continuation 之间，而不是延迟到整个 task 链完成。
      await waitForAll(['A', 'Timer 1', 'B', 'C', 'Timer 2', 'D']);
    });

    /**
     * 场景：三个同 delay task 中，B 在 timer queue 阶段取消，C 在到期迁入 ready queue 后取消；只执行 A。
     * 对应源码：取消统一置空 callback，两个 heap 各自在访问堆顶时惰性清理。
     */
    it('cancels a delayed task', async () => {
      // 三个 task 共享 startTime，用于分别覆盖到期前和到期后取消。
      const options = {delay: 100};

      scheduleCallback(NormalPriority, () => Scheduler.log('A'), options);
      const taskB = scheduleCallback(
        NormalPriority,
        () => Scheduler.log('B'),
        options,
      );
      const taskC = scheduleCallback(
        NormalPriority,
        () => Scheduler.log('C'),
        options,
      );

      // B 仍在 timer queue 时取消。
      await waitForAll([]);
      cancelCallback(taskB);

      // 推进越过 startTime 后取消 C；此时它可能已迁入 ready queue。
      Scheduler.unstable_advanceTime(500);
      cancelCallback(taskC);

      // 两种取消时机都不执行 callback，只剩 A。
      await waitForAll(['A']);
    });

    /** 场景：callback 不是函数时 Scheduler 应把节点当作已取消工作跳过，不调用也不抛错。 */
    it('gracefully handles scheduled tasks that are not a function', async () => {
      scheduleCallback(ImmediatePriority, null);
      await waitForAll([]);

      scheduleCallback(ImmediatePriority, undefined);
      await waitForAll([]);

      scheduleCallback(ImmediatePriority, {});
      await waitForAll([]);

      scheduleCallback(ImmediatePriority, 42);
      await waitForAll([]);
    });

    /**
     * Given：task 在 `shouldYield()` 为 false 时主动返回 continuation。
     * When：使用 paint 边界 `waitForPaint()` 排空。
     * Then：原 callback 结束后立即停止本轮，continuation 留到随后 `waitForAll()`。
     *
     * 验证机制：时间仍为 0 且首阶段日志没有 continuation，证明停止来自 continuation/paint 规则而非 deadline。
     * 对应源码：`SchedulerMock.unstable_flushUntilNextPaint()` 的 yield 控制。
     */
    it('toFlushUntilNextPaint stops if a continuation is returned', async () => {
      scheduleCallback(NormalPriority, () => {
        Scheduler.log('Original Task');
        Scheduler.log('shouldYield: ' + shouldYield());
        Scheduler.log('Return a continuation');
        return () => {
          Scheduler.log('Continuation Task');
        };
      });

      await waitForPaint([
        'Original Task',
        // 返回 continuation 前仍有时间片余额。
        'shouldYield: false',
        'Return a continuation',

        // paint 边界应在 continuation 执行前停止。
      ]);

      // 虚拟时间未推进，排除 deadline 到期导致停止。
      expect(Scheduler.unstable_now()).toBe(0);

      // 下一次普通排空才恢复 continuation。
      await waitForAll(['Continuation Task']);
    });

    /**
     * Given：与上一用例相同的主动 continuation。
     * When：改用 `waitForAll()` 排空全部工作。
     * Then：helper 忽略 paint 观察边界，在同次测试操作中继续执行 continuation。
     * 对应源码：Mock flush 模式对 `yieldedValues` 与 continuation 的不同停止条件。
     */
    it("toFlushAndYield keeps flushing even if there's a continuation", async () => {
      scheduleCallback(NormalPriority, () => {
        Scheduler.log('Original Task');
        Scheduler.log('shouldYield: ' + shouldYield());
        Scheduler.log('Return a continuation');
        return () => {
          Scheduler.log('Continuation Task');
        };
      });

      await waitForAll([
        'Original Task',
        // 返回 continuation 前仍有时间片余额。
        'shouldYield: false',
        'Return a continuation',

        // `waitForAll` 继续排空 continuation，不把返回函数视为最终观察边界。
        'Continuation Task',
      ]);
    });
  });
});
