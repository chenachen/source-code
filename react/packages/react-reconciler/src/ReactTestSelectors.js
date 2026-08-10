/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {Instance} from './ReactFiberConfig';

import {
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
} from 'react-reconciler/src/ReactWorkTags';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import {
  findFiberRoot,
  getBoundingRect,
  getInstanceFromNode,
  getTextContent,
  isHiddenSubtree,
  matchAccessibilityRole,
  setFocusIfFocusable,
  setupIntersectionObserver,
  supportsTestSelectors,
} from './ReactFiberConfig';

let COMPONENT_TYPE: symbol | number = 0b000;
let HAS_PSEUDO_CLASS_TYPE: symbol | number = 0b001;
let ROLE_TYPE: symbol | number = 0b010;
let TEST_NAME_TYPE: symbol | number = 0b011;
let TEXT_TYPE: symbol | number = 0b100;

if (typeof Symbol === 'function' && Symbol.for) {
  const symbolFor = Symbol.for;
  COMPONENT_TYPE = symbolFor('selector.component');
  HAS_PSEUDO_CLASS_TYPE = symbolFor('selector.has_pseudo_class');
  ROLE_TYPE = symbolFor('selector.role');
  TEST_NAME_TYPE = symbolFor('selector.test_id');
  TEXT_TYPE = symbolFor('selector.text');
}

/** Selector 的运行时判别值；现代环境用全局 Symbol，旧环境退化为数字常量。 */
type Type = symbol | number;

/** 按 React 组件类型匹配 Fiber 的 selector。 */
type ComponentSelector = {
  /** COMPONENT_TYPE 判别值。 */
  $$typeof: Type,
  /** 必须与 fiber.type 全等的组件构造/类型。 */
  value: component(),
};

/** `:has(...)` selector：要求当前 Fiber 后代存在完整 selector 路径。 */
type HasPseudoClassSelector = {
  /** HAS_PSEUDO_CLASS_TYPE 判别值。 */
  $$typeof: Type,
  /** 在当前 Fiber 子树继续匹配的嵌套路径。 */
  value: Array<Selector>,
};

/** 按宿主可访问性 role 匹配的 selector。 */
type RoleSelector = {
  /** ROLE_TYPE 判别值。 */
  $$typeof: Type,
  /** 交由 HostConfig accessibility matcher 的 role 名。 */
  value: string,
};

/** 按宿主文本包含关系匹配的 selector。 */
type TextSelector = {
  /** TEXT_TYPE 判别值。 */
  $$typeof: Type,
  /** 必须包含在宿主文本内容中的片段。 */
  value: string,
};

/** 按 `data-testname`（忽略大小写）匹配的 selector。 */
type TestNameSelector = {
  /** TEST_NAME_TYPE 判别值。 */
  $$typeof: Type,
  /** 目标 testname。 */
  value: string,
};

/** Test Selector API 支持的 selector 判别联合。 */
type Selector =
  | ComponentSelector
  | HasPseudoClassSelector
  | RoleSelector
  | TextSelector
  | TestNameSelector;

/** 创建按组件类型匹配的 selector。 */
export function createComponentSelector(
  component: component(),
): ComponentSelector {
  return {
    $$typeof: COMPONENT_TYPE,
    value: component,
  };
}

/** 创建要求后代存在嵌套匹配路径的 `:has` selector。 */
export function createHasPseudoClassSelector(
  selectors: Array<Selector>,
): HasPseudoClassSelector {
  return {
    $$typeof: HAS_PSEUDO_CLASS_TYPE,
    value: selectors,
  };
}

/** 创建按宿主可访问性 role 匹配的 selector。 */
export function createRoleSelector(role: string): RoleSelector {
  return {
    $$typeof: ROLE_TYPE,
    value: role,
  };
}

/** 创建按宿主文本包含关系匹配的 selector。 */
export function createTextSelector(text: string): TextSelector {
  return {
    $$typeof: TEXT_TYPE,
    value: text,
  };
}

/** 创建按 `data-testname` 忽略大小写匹配的 selector。 */
export function createTestNameSelector(id: string): TestNameSelector {
  return {
    $$typeof: TEST_NAME_TYPE,
    value: id,
  };
}

/**
 * 把用户传入的 React 容器或带 data-testname 的宿主节点解析为查询起始 Fiber。
 * 宿主节点直接反查实例；容器则经 HostConfig 找 FiberRoot.current，无匹配时抛出明确错误。
 */
function findFiberRootForHostRoot(hostRoot: Instance): Fiber {
  const maybeFiber = getInstanceFromNode(hostRoot as any);
  if (maybeFiber != null) {
    if (typeof maybeFiber.memoizedProps['data-testname'] !== 'string') {
      throw new Error(
        'Invalid host root specified. Should be either a React container or a node with a testname attribute.',
      );
    }

    return maybeFiber as any as Fiber;
  } else {
    const fiberRoot = findFiberRoot(hostRoot);

    // $FlowFixMe[invalid-compare]
    if (fiberRoot === null) {
      throw new Error(
        'Could not find React container within specified host subtree.',
      );
    }

    // FiberRoot 的 Flow 形状较特殊：createFiberRoot 以 any 建立 Root，再延迟添加 stateNode。
    return (fiberRoot as any).stateNode.current as Fiber;
  }
}

/**
 * 判断单个 Fiber 是否匹配 selector；组件比较 type，宿主 selector 委托 HostConfig，
 * `:has` 则从当前 Fiber 递归执行嵌套路径。
 */
function matchSelector(fiber: Fiber, selector: Selector): boolean {
  const tag = fiber.tag;
  switch (selector.$$typeof) {
    case COMPONENT_TYPE:
      if (fiber.type === selector.value) {
        return true;
      }
      break;
    case HAS_PSEUDO_CLASS_TYPE:
      return hasMatchingPaths(
        fiber,
        (selector as any as HasPseudoClassSelector).value,
      );
    case ROLE_TYPE:
      if (
        tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton
      ) {
        const node = fiber.stateNode;
        if (
          matchAccessibilityRole(node, (selector as any as RoleSelector).value)
        ) {
          return true;
        }
      }
      break;
    case TEXT_TYPE:
      if (
        tag === HostComponent ||
        tag === HostText ||
        tag === HostHoistable ||
        tag === HostSingleton
      ) {
        const textContent = getTextContent(fiber);
        // $FlowFixMe[invalid-compare]
        if (
          // $FlowFixMe[invalid-compare]
          textContent !== null &&
          textContent.indexOf((selector as any as TextSelector).value) >= 0
        ) {
          return true;
        }
      }
      break;
    case TEST_NAME_TYPE:
      if (
        tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton
      ) {
        const dataTestID = fiber.memoizedProps['data-testname'];
        if (
          typeof dataTestID === 'string' &&
          dataTestID.toLowerCase() ===
            (selector as any as TestNameSelector).value.toLowerCase()
        ) {
          return true;
        }
      }
      break;
    default:
      throw new Error('Invalid selector type specified.');
  }

  return false;
}

/** 把 selector 格式化为面向测试失败信息的类 CSS 文本。 */
function selectorToString(selector: Selector): string | null {
  switch (selector.$$typeof) {
    case COMPONENT_TYPE:
      const displayName = getComponentNameFromType(selector.value) || 'Unknown';
      return `<${displayName}>`;
    case HAS_PSEUDO_CLASS_TYPE:
      return `:has(${selectorToString(selector) || ''})`;
    case ROLE_TYPE:
      return `[role="${(selector as any as RoleSelector).value}"]`;
    case TEXT_TYPE:
      return `"${(selector as any as TextSelector).value}"`;
    case TEST_NAME_TYPE:
      return `[data-testname="${(selector as any as TestNameSelector).value}"]`;
    default:
      throw new Error('Invalid selector type specified.');
  }
}

/**
 * 迭代深度优先查找完整 selector 路径；栈中交替保存 Fiber 与已匹配 selector 下标。
 * selector 可跨越中间 Fiber，隐藏宿主子树整体跳过，完成路径的末端 Fiber 被收集。
 */
function findPaths(root: Fiber, selectors: Array<Selector>): Array<Fiber> {
  const matchingFibers: Array<Fiber> = [];

  const stack = [root, 0];
  let index = 0;
  while (index < stack.length) {
    const fiber = stack[index++] as any as Fiber;
    const tag = fiber.tag;
    let selectorIndex = stack[index++] as any as number;
    let selector = selectors[selectorIndex];

    if (
      (tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton) &&
      isHiddenSubtree(fiber)
    ) {
      continue;
    } else {
      while (selector != null && matchSelector(fiber, selector)) {
        selectorIndex++;
        selector = selectors[selectorIndex];
      }
    }

    if (selectorIndex === selectors.length) {
      matchingFibers.push(fiber);
    } else {
      let child = fiber.child;
      while (child !== null) {
        stack.push(child, selectorIndex);
        child = child.sibling;
      }
    }
  }

  return matchingFibers;
}

/** findPaths 的布尔快速版本；发现首条完整路径即退出，供 `:has` 使用。 */
function hasMatchingPaths(root: Fiber, selectors: Array<Selector>): boolean {
  const stack = [root, 0];
  let index = 0;
  while (index < stack.length) {
    const fiber = stack[index++] as any as Fiber;
    const tag = fiber.tag;
    let selectorIndex = stack[index++] as any as number;
    let selector = selectors[selectorIndex];

    if (
      (tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton) &&
      isHiddenSubtree(fiber)
    ) {
      continue;
    } else {
      while (selector != null && matchSelector(fiber, selector)) {
        selectorIndex++;
        selector = selectors[selectorIndex];
      }
    }

    if (selectorIndex === selectors.length) {
      return true;
    } else {
      let child = fiber.child;
      while (child !== null) {
        stack.push(child, selectorIndex);
        child = child.sibling;
      }
    }
  }

  return false;
}

/**
 * 返回匹配 selector 路径下首层可见宿主实例。
 * 路径末端若是复合组件则继续向下展开，遇到宿主实例后停止该分支，避免重复返回后代。
 */
export function findAllNodes(
  hostRoot: Instance,
  selectors: Array<Selector>,
): Array<Instance> {
  // $FlowFixMe[constant-condition]
  if (!supportsTestSelectors) {
    throw new Error('Test selector API is not supported by this renderer.');
  }

  const root = findFiberRootForHostRoot(hostRoot);
  const matchingFibers = findPaths(root, selectors);

  const instanceRoots: Array<Instance> = [];

  const stack = Array.from(matchingFibers);
  let index = 0;
  while (index < stack.length) {
    const node = stack[index++] as any as Fiber;
    const tag = node.tag;
    if (
      tag === HostComponent ||
      tag === HostHoistable ||
      tag === HostSingleton
    ) {
      if (isHiddenSubtree(node)) {
        continue;
      }
      instanceRoots.push(node.stateNode);
    } else {
      let child = node.child;
      while (child !== null) {
        stack.push(child);
        child = child.sibling;
      }
    }
  }

  return instanceRoots;
}

/**
 * 重走 findPaths 的前缀匹配逻辑，生成“已匹配部分 / 首个未匹配部分”的诊断字符串。
 * 完整路径可达时返回 null；循环逻辑必须与 findPaths 保持同步。
 */
export function getFindAllNodesFailureDescription(
  hostRoot: Instance,
  selectors: Array<Selector>,
): string | null {
  // $FlowFixMe[constant-condition]
  if (!supportsTestSelectors) {
    throw new Error('Test selector API is not supported by this renderer.');
  }

  const root = findFiberRootForHostRoot(hostRoot);

  let maxSelectorIndex: number = 0;
  const matchedNames = [];

  // 此循环逻辑必须与 findPaths 保持同步。
  const stack = [root, 0];
  let index = 0;
  while (index < stack.length) {
    const fiber = stack[index++] as any as Fiber;
    const tag = fiber.tag;
    let selectorIndex = stack[index++] as any as number;
    const selector = selectors[selectorIndex];

    if (
      (tag === HostComponent ||
        tag === HostHoistable ||
        tag === HostSingleton) &&
      isHiddenSubtree(fiber)
    ) {
      continue;
    } else if (matchSelector(fiber, selector)) {
      matchedNames.push(selectorToString(selector));
      selectorIndex++;

      if (selectorIndex > maxSelectorIndex) {
        maxSelectorIndex = selectorIndex;
      }
    }

    if (selectorIndex < selectors.length) {
      let child = fiber.child;
      while (child !== null) {
        stack.push(child, selectorIndex);
        child = child.sibling;
      }
    }
  }

  if (maxSelectorIndex < selectors.length) {
    const unmatchedNames = [];
    for (let i = maxSelectorIndex; i < selectors.length; i++) {
      unmatchedNames.push(selectorToString(selectors[i]));
    }

    return (
      'findAllNodes was able to match part of the selector:\n' +
      `  ${matchedNames.join(' > ')}\n\n` +
      'No matching component was found for:\n' +
      `  ${unmatchedNames.join(' > ')}`
    );
  }

  return null;
}

/** HostConfig 返回的轴对齐宿主边界矩形。 */
export type BoundingRect = {
  /** 左边界坐标。 */
  x: number,
  /** 上边界坐标。 */
  y: number,
  /** 矩形宽度。 */
  width: number,
  /** 矩形高度。 */
  height: number,
};

/**
 * 查询匹配节点的宿主矩形，并合并完全包含或同宽/同高且相邻重叠的常见布局区间。
 * 单遍启发式不保证全局最少矩形，但足以为测试可见区域提供稳定近似。
 */
export function findBoundingRects(
  hostRoot: Instance,
  selectors: Array<Selector>,
): Array<BoundingRect> {
  // $FlowFixMe[constant-condition]
  if (!supportsTestSelectors) {
    throw new Error('Test selector API is not supported by this renderer.');
  }

  const instanceRoots = findAllNodes(hostRoot, selectors);

  const boundingRects: Array<BoundingRect> = [];
  for (let i = 0; i < instanceRoots.length; i++) {
    boundingRects.push(getBoundingRect(instanceRoots[i]));
  }

  for (let i = boundingRects.length - 1; i > 0; i--) {
    const targetRect = boundingRects[i];
    const targetLeft = targetRect.x;
    const targetRight = targetLeft + targetRect.width;
    const targetTop = targetRect.y;
    const targetBottom = targetTop + targetRect.height;

    for (let j = i - 1; j >= 0; j--) {
      if (i !== j) {
        const otherRect = boundingRects[j];
        const otherLeft = otherRect.x;
        const otherRight = otherLeft + otherRect.width;
        const otherTop = otherRect.y;
        const otherBottom = otherTop + otherRect.height;

        // 求全局最小矩形集合较复杂；这里只处理完全包含，以及同宽/同高且相邻重叠的常见
        // 列表布局。单遍仍不保证最少数量，但满足测试定位用途。

        if (
          targetLeft >= otherLeft &&
          targetTop >= otherTop &&
          targetRight <= otherRight &&
          targetBottom <= otherBottom
        ) {
          // 完全包含：移除内部矩形。
          boundingRects.splice(i, 1);
          break;
        } else if (
          targetLeft === otherLeft &&
          targetRect.width === otherRect.width &&
          !(otherBottom < targetTop) &&
          !(otherTop > targetBottom)
        ) {
          // 同宽且垂直相邻/重叠：合并。
          if (otherTop > targetTop) {
            otherRect.height += otherTop - targetTop;
            otherRect.y = targetTop;
          }
          if (otherBottom < targetBottom) {
            otherRect.height = targetBottom - otherTop;
          }

          boundingRects.splice(i, 1);
          break;
        } else if (
          targetTop === otherTop &&
          targetRect.height === otherRect.height &&
          !(otherRight < targetLeft) &&
          !(otherLeft > targetRight)
        ) {
          // 同高且水平相邻/重叠：合并。
          if (otherLeft > targetLeft) {
            otherRect.width += otherLeft - targetLeft;
            otherRect.x = targetLeft;
          }
          if (otherRight < targetRight) {
            otherRect.width = targetRight - otherLeft;
          }

          boundingRects.splice(i, 1);
          break;
        }
      }
    }
  }

  return boundingRects;
}

/**
 * 在匹配路径的可见子树中按深度优先顺序聚焦首个可聚焦宿主节点。
 * HostConfig 决定具体 focusability；成功立即返回 true。
 */
export function focusWithin(
  hostRoot: Instance,
  selectors: Array<Selector>,
): boolean {
  // $FlowFixMe[constant-condition]
  if (!supportsTestSelectors) {
    throw new Error('Test selector API is not supported by this renderer.');
  }

  const root = findFiberRootForHostRoot(hostRoot);
  const matchingFibers = findPaths(root, selectors);

  const stack = Array.from(matchingFibers);
  let index = 0;
  while (index < stack.length) {
    const fiber = stack[index++] as any as Fiber;
    const tag = fiber.tag;
    if (isHiddenSubtree(fiber)) {
      continue;
    }
    if (
      tag === HostComponent ||
      tag === HostHoistable ||
      tag === HostSingleton
    ) {
      const node = fiber.stateNode;
      if (setFocusIfFocusable(node)) {
        return true;
      }
    }
    let child = fiber.child;
    while (child !== null) {
      stack.push(child);
      child = child.sibling;
    }
  }

  return false;
}

/** 宿主每次 React 提交后需重算观察目标的 Test Selector 订阅。 */
const commitHooks: Array<Function> = [];

/** Root 提交后通知所有 selector 观察订阅更新宿主目标集合。 */
export function onCommitRoot(): void {
  // $FlowFixMe[constant-condition]
  if (supportsTestSelectors) {
    commitHooks.forEach(commitHook => commitHook());
  }
}

/** 原样传给 HostConfig setupIntersectionObserver 的宿主选项。 */
export type IntersectionObserverOptions = Object;

/** 可见矩形变化回调；每项包含交叉比例与对应边界矩形。 */
export type ObserveVisibleRectsCallback = (
  intersections: Array<{
    /** 目标当前可见比例。 */
    ratio: number,
    /** 目标当前宿主边界。 */
    rect: BoundingRect
  }>,
) => void;

/**
 * 观察匹配节点的可见矩形，并在每次 React commit 后增量 observe/unobserve 变化目标。
 * disconnect 同时移除 commit hook 与宿主 observer，防止后续提交继续持有订阅。
 */
export function observeVisibleRects(
  hostRoot: Instance,
  selectors: Array<Selector>,
  callback: (
    intersections: Array<{
      /** 目标当前可见比例。 */
      ratio: number,
      /** 目标当前宿主边界。 */
      rect: BoundingRect
    }>
  ) => void,
  options?: IntersectionObserverOptions,
): {
  /** 停止宿主观察并解除 React commit 订阅。 */
  disconnect: () => void
} {
  // $FlowFixMe[constant-condition]
  if (!supportsTestSelectors) {
    throw new Error('Test selector API is not supported by this renderer.');
  }

  const instanceRoots = findAllNodes(hostRoot, selectors);

  const {disconnect, observe, unobserve} = setupIntersectionObserver(
    instanceRoots,
    callback,
    options,
  );

  /** React 改变宿主树后，重新查询并增量同步观察目标。 */
  const commitHook = () => {
    const nextInstanceRoots = findAllNodes(hostRoot, selectors);

    instanceRoots.forEach(target => {
      if (nextInstanceRoots.indexOf(target) < 0) {
        unobserve(target);
      }
    });

    nextInstanceRoots.forEach(target => {
      if (instanceRoots.indexOf(target) < 0) {
        observe(target);
      }
    });
  };

  commitHooks.push(commitHook);

  return {
    /** 移除提交监听，并断开 HostConfig observer。 */
    disconnect: () => {
      // 停止监听 React mutation。
      const index = commitHooks.indexOf(commitHook);
      if (index >= 0) {
        commitHooks.splice(index, 1);
      }

      // 断开宿主 observer。
      disconnect();
    },
  };
}
