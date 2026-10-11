/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// ID 是 base-32 字符串，其二进制表示对应节点在树中的位置。

// 每当树分叉出多个 children，就在位序列左侧增加若干位，表示节点在本层 children
// 中的位置。
//
//      00101       00010001011010101
//      ╰─┬─╯       ╰───────┬───────╯
//  20 个分叉中的第 5 个    父 ID
//
// 前导 0 不可丢失。上例的槽位 5 本身只需 3 位，但表示本层全部 20 个分叉需要 5 位，
// 所以必须保留末尾空位。
//
// 同理，槽位从 1 而非 0 开始；否则每层第 0 个 ID 无法与父 ID 区分。
//
// 节点只有一个 child 且不物化 ID（即不含 useId Hook）时，无需在序列中分配空间，
// 可把它视为透明间接层。下列两棵树会生成相同 ID：
//
// <>                          <>
//   <Indirection>               <A />
//     <A />                     <B />
//   </Indirection>            </>
//   <B />
// </>
//
// 但物化 ID 的节点不能跳过，否则没有分叉的父 ID 会与 child ID 相同。下例虽未分叉，
// Parent 与 Child 仍必须拥有不同 ID：
//
// <Parent>
//   <Child />
// </Parent>
//
// 因此每次物化 ID 都分配一个仅含单槽的新层，可视为只有一条分支的 fork，或长度 1
// 的 children 数组。
//
// 序列可能超过位运算安全的 32 位。此时把 ID 右侧转成字符串存入 overflow 腾出空间。
// 使用 base-32 是因为 32 是 toString 支持的最大 2 的幂：进制大可让 ID 紧凑，且每
// log2(32)=5 位恰好对应一个字符，所以能每次截走末尾 5 位而不改变最终结果。

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';

import {getIsHydrating} from './ReactFiberHydrationContext';
import {clz32} from './clz32';
import {Forked, NoFlags} from './ReactFiberFlags';

/** hydration 期间决定 `useId` 稳定树位置的可恢复上下文。 */
export type TreeContext = {
  /** 含前导哨兵位、仍保存在 32 位整数中的 ID 高位片段。 */
  id: number,
  /** 从整数右端溢出后转换成 base-32 的低位片段。 */
  overflow: string,
};

/**
 * 按对保存父级 treeForkCount 与 treeForkProvider，popTreeContext 据此恢复 useId 的树分叉上下文。
 * 使用独立本地栈承载此 push/pop 协议；TODO：以后改用统一 Fiber 栈模块。
 */
const forkStack: Array<any> = [];
let forkStackIndex: number = 0;
let treeForkProvider: Fiber | null = null;
let treeForkCount: number = 0;

/** 保存父级整数 ID、overflow 与提供者的本地恢复栈。 */
const idStack: Array<any> = [];
let idStackIndex: number = 0;
let treeContextProvider: Fiber | null = null;
let treeContextId: number = 1;
let treeContextOverflow: string = '';

/** 判断 hydration 中当前 Fiber 是否是由多 child 分叉产生的节点。 */
export function isForkedChild(workInProgress: Fiber): boolean {
  warnIfNotHydrating();
  return (workInProgress.flags & Forked) !== NoFlags;
}

/** 返回当前树层级的 child 总分叉数。 */
export function getForksAtLevel(workInProgress: Fiber): number {
  warnIfNotHydrating();
  return treeForkCount;
}

/** 去掉内部前导哨兵位，并把整数段与 overflow 拼成公开 base-32 树 ID。 */
export function getTreeId(): string {
  const overflow = treeContextOverflow;
  const idWithLeadingBit = treeContextId;
  const id = idWithLeadingBit & ~getLeadingBit(idWithLeadingBit);
  return id.toString(32) + overflow;
}

/**
 * 在协调完一组数组或迭代器 children 后记录本层分叉总数。
 *
 * 只有父 Fiber 渲染阶段知道完整 child 数量，因此该操作与在 child 阶段执行的
 * `pushTreeId` 分离；Fizz 父子同栈渲染则不需要这种拆分。
 */
export function pushTreeFork(
  workInProgress: Fiber,
  totalChildren: number,
): void {
  // 数组或迭代器 child 协调完后立即调用；只有此时无需额外遍历或 Fiber 字段便知道总数。
  //
  // 因此它独立于 pushTreeId：前者在分叉父节点阶段调用，其他 Context 值则在 child
  // 渲染阶段压入。
  //
  // Fizz 中 child 与父节点在同一调用栈渲染，实现会简单得多。
  //
  // 也可考虑直接给 Fiber 增加 `forks` 字段，简化本模块。

  warnIfNotHydrating();

  forkStack[forkStackIndex++] = treeForkCount;
  forkStack[forkStackIndex++] = treeForkProvider;

  treeForkProvider = workInProgress;
  treeForkCount = totalChildren;
}

/**
 * 为当前 child 把“父 ID + 本层 1-based 槽位”压成新的树 ID。
 *
 * 30 位以内走整数位运算；超出后每 5 位编码为一个 base-32 overflow 字符，剩余位
 * 留在整数中。最高位 1 是长度哨兵，不属于最终 ID。
 */
export function pushTreeId(
  workInProgress: Fiber,
  totalChildren: number,
  index: number,
) {
  warnIfNotHydrating();

  idStack[idStackIndex++] = treeContextId;
  idStack[idStackIndex++] = treeContextOverflow;
  idStack[idStackIndex++] = treeContextProvider;

  treeContextProvider = workInProgress;

  const baseIdWithLeadingBit = treeContextId;
  const baseOverflow = treeContextOverflow;

  // 最左侧 1 是不计入 ID 的序列终止标志，用于保留前导 0。
  const baseLength = getBitLength(baseIdWithLeadingBit) - 1;
  const baseId = baseIdWithLeadingBit & ~(1 << baseLength);

  const slot = index + 1;
  const length = getBitLength(totalChildren) + baseLength;

  // 考虑终止哨兵 1 后，不溢出的最大有效长度为 30 位。
  if (length > 30) {
    // 超出位运算安全范围，走较慢算法。该分支假定 base ID 长于 5 位，因为每个字符
    // 必须消耗完整 5 位。
    //
    // 分步编码：先处理 base ID，再处理剩余数字。
    //
    // 每 5 位对应一个 base-32 字符。例如当前 ID 长 23 位，可把其中 20 位转成 4 个
    // 字符，保留 3 位继续参与整数编码。
    //
    // 先计算 base ID 中能构成完整字符序列的位数。
    const numberOfOverflowBits = baseLength - (baseLength % 5);

    // 构造只选择这些位的掩码。
    const newOverflowBits = (1 << numberOfOverflowBits) - 1;

    // 选出位并转换为 base-32 字符串。
    const newOverflow = (baseId & newOverflowBits).toString(32);

    // 从 base ID 移除已经转成字符串的位。
    const restOfBaseId = baseId >> numberOfOverflowBits;
    const restOfBaseLength = baseLength - numberOfOverflowBits;

    // 最后用普通算法编码剩余位；已腾出空间，不会再次溢出。
    const restOfLength = getBitLength(totalChildren) + restOfBaseLength;
    const restOfNewBits = slot << restOfBaseLength;
    const id = restOfNewBits | restOfBaseId;
    const overflow = newOverflow + baseOverflow;

    treeContextId = (1 << restOfLength) | id;
    treeContextOverflow = overflow;
  } else {
    // 普通整数位运算路径。
    const newBits = slot << baseLength;
    const id = newBits | baseId;
    const overflow = baseOverflow;

    treeContextId = (1 << length) | id;
    treeContextOverflow = overflow;
  }
}

/**
 * 当前组件实际调用 `useId` 时人为增加一个单槽层级，使父 ID 与 child ID 可区分。
 */
export function pushMaterializedTreeId(workInProgress: Fiber) {
  warnIfNotHydrating();

  // 当前组件物化了 ID，必须影响其后代生成的所有 ID。
  const returnFiber = workInProgress.return;
  if (returnFiber !== null) {
    const numberOfForks = 1;
    const slotIndex = 0;
    pushTreeFork(workInProgress, numberOfForks);
    pushTreeId(workInProgress, numberOfForks, slotIndex);
  }
}

/** 返回正整数二进制表示所需的位数。 */
function getBitLength(number: number): number {
  return 32 - clz32(number);
}

/** 返回内部树 ID 中用于标记序列长度的最高哨兵位。 */
function getLeadingBit(id: number) {
  return 1 << (getBitLength(id) - 1);
}

/**
 * 弹出当前 Fiber 可能多次压入的分叉与 ID 上下文，恢复父级状态。
 * 同一 Fiber 可因不同原因重复出现在栈顶，因此必须循环直到它不再是提供者。
 */
export function popTreeContext(workInProgress: Fiber) {
  // 恢复之前的值。

  // 相比其他 Fiber Context，这里同一 Fiber 可能因多个原因重复入栈，需要持续弹出。

  while (workInProgress === treeForkProvider) {
    treeForkProvider = forkStack[--forkStackIndex];
    forkStack[forkStackIndex] = null;
    treeForkCount = forkStack[--forkStackIndex];
    forkStack[forkStackIndex] = null;
  }

  while (workInProgress === treeContextProvider) {
    treeContextProvider = idStack[--idStackIndex];
    idStack[idStackIndex] = null;
    treeContextOverflow = idStack[--idStackIndex];
    idStack[idStackIndex] = null;
    treeContextId = idStack[--idStackIndex];
    idStack[idStackIndex] = null;
  }
}

/** 捕获挂起点的树 ID 上下文，以便 hydration 重试生成相同 `useId`。 */
export function getSuspendedTreeContext(): TreeContext | null {
  warnIfNotHydrating();
  if (treeContextProvider !== null) {
    return {
      id: treeContextId,
      overflow: treeContextOverflow,
    };
  } else {
    return null;
  }
}

/** 把挂起时捕获的树 ID 上下文压回栈顶，并由当前 Fiber 负责后续弹出。 */
export function restoreSuspendedTreeContext(
  workInProgress: Fiber,
  suspendedContext: TreeContext,
) {
  warnIfNotHydrating();

  idStack[idStackIndex++] = treeContextId;
  idStack[idStackIndex++] = treeContextOverflow;
  idStack[idStackIndex++] = treeContextProvider;

  treeContextId = suspendedContext.id;
  treeContextOverflow = suspendedContext.overflow;
  treeContextProvider = workInProgress;
}

/** 开发环境断言树 ID 协议只在 hydration 阶段使用。 */
function warnIfNotHydrating() {
  if (__DEV__) {
    if (!getIsHydrating()) {
      console.error(
        'Expected to be hydrating. This is a bug in React. Please file ' +
          'an issue.',
      );
    }
  }
}
