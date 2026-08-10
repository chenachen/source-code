/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

/**
 * 以数组保存的二叉最小堆。
 *
 * 堆顶始终是 `compare` 排序最小的节点；调用者负责保证节点入堆后不直接修改排序键。
 */
type Heap<T: Node> = Array<T>;

/** Scheduler 两个任务队列都可复用的最小排序契约。 */
type Node = {
  // 单调递增的任务编号；当排序键相同时用于维持插入顺序。
  id: number,
  // 当前队列的主排序键：timer queue 使用开始时间，task queue 使用过期时间。
  sortIndex: number,
  ...
};

/**
 * 将节点插入堆尾，再向上修复最小堆不变量。
 *
 * @param heap - 由调用者持有并原地修改的任务堆。
 * @param node - 尚未位于该堆中的节点。
 */
export function push<T: Node>(heap: Heap<T>, node: T): void {
  const index = heap.length;
  heap.push(node);
  siftUp(heap, node, index);
}

/** 返回堆顶节点但不改变堆；空堆返回 `null`。 */
export function peek<T: Node>(heap: Heap<T>): T | null {
  return heap.length === 0 ? null : heap[0];
}

/**
 * 移除并返回堆顶节点。
 *
 * WHY：用末尾节点填补根节点后向下修复，可在 O(log n) 内完成，无需移动整段数组。
 */
export function pop<T: Node>(heap: Heap<T>): T | null {
  if (heap.length === 0) {
    return null;
  }
  const first = heap[0];
  const last = heap.pop();
  if (last !== first) {
    // $FlowFixMe[incompatible-type]
    heap[0] = last;
    // $FlowFixMe[incompatible-type]
    siftDown(heap, last, 0);
  }
  return first;
}

/** 把新插入节点向父级移动，直到父节点排序不晚于它。 */
function siftUp<T: Node>(heap: Heap<T>, node: T, i: number): void {
  let index = i;
  while (index > 0) {
    const parentIndex = (index - 1) >>> 1;
    const parent = heap[parentIndex];
    if (compare(parent, node) > 0) {
      // 父节点更晚：交换两者并继续检查更高一层。
      heap[parentIndex] = node;
      heap[index] = parent;
      index = parentIndex;
    } else {
      // 父节点已经更早或相等，堆不变量恢复。
      return;
    }
  }
}

/** 把替换根节点的末尾节点向子级移动，直到两个子节点都不早于它。 */
function siftDown<T: Node>(heap: Heap<T>, node: T, i: number): void {
  let index = i;
  const length = heap.length;
  const halfLength = length >>> 1;
  while (index < halfLength) {
    const leftIndex = (index + 1) * 2 - 1;
    const left = heap[leftIndex];
    const rightIndex = leftIndex + 1;
    const right = heap[rightIndex];

    // 必须与两个子节点中更早者交换，否则下一层仍可能违反最小堆不变量。
    if (compare(left, node) < 0) {
      if (rightIndex < length && compare(right, left) < 0) {
        heap[index] = right;
        heap[rightIndex] = node;
        index = rightIndex;
      } else {
        heap[index] = left;
        heap[leftIndex] = node;
        index = leftIndex;
      }
    } else if (rightIndex < length && compare(right, node) < 0) {
      heap[index] = right;
      heap[rightIndex] = node;
      index = rightIndex;
    } else {
      // 两个子节点都不更早，修复完成。
      return;
    }
  }
}

/**
 * 比较两个节点的调度顺序。
 *
 * 先比较 `sortIndex`，再比较单调递增的 `id`，确保相同开始/过期时间的任务按插入顺序执行。
 */
function compare(a: Node, b: Node) {
  const diff = a.sortIndex - b.sortIndex;
  return diff !== 0 ? diff : a.id - b.id;
}
