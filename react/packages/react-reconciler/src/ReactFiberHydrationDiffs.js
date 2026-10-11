/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

import {
  HostComponent,
  HostHoistable,
  HostSingleton,
  LazyComponent,
  ActivityComponent,
  SuspenseComponent,
  SuspenseListComponent,
  FunctionComponent,
  ForwardRef,
  SimpleMemoComponent,
  ClassComponent,
  HostText,
} from './ReactWorkTags';

import {enableSrcObject} from 'shared/ReactFeatureFlags';

import {REACT_ELEMENT_TYPE} from 'shared/ReactSymbols';
import assign from 'shared/assign';
import getComponentNameFromType from 'shared/getComponentNameFromType';

import isArray from 'shared/isArray';

/** 一处 hydration 不匹配及其相关客户端/服务端上下文组成的诊断树节点。 */
export type HydrationDiffNode = {
  /** 发生不匹配或仅作为上下文展示的客户端 Fiber。 */
  fiber: Fiber,
  /** 此 Fiber 下实际记录到不匹配的后代节点。 */
  children: Array<HydrationDiffNode>,
  /**
   * 宿主差异检测返回的服务端不匹配属性子集或文本；不是服务端全部 props。
   * `null` 表示没有对应服务端节点，`undefined` 表示本节点
   * 只用于提供路径上下文。
   */
  serverProps:
    void
    | null
    | $ReadOnly<{
        /** 服务端宿主节点序列化出的属性名和值。 */
        [propName: string]: mixed
      }>
    | string,
  /** 当前客户端 children 之后仍残留、应显示为删除项的服务端尾节点。 */
  serverTail: Array<
    | $ReadOnly<{
        /** 残留服务端宿主元素类型。 */
        type: string,
        /** 残留服务端宿主元素属性。 */
        props: $ReadOnly<{
          /** 服务端属性名和值。 */
          [propName: string]: mixed
        }>
      }>
    | string,
  >,
  /** 到最近真实 mismatch 叶子的距离，用于折叠冗长上下文链。 */
  distanceFromLeaf: number,
};

/** 单行 hydration diff 的目标最大字符数。 */
const maxRowLength = 120;
/** 在深链中保留的理想上下文深度。 */
const idealDepth = 15;

/** 跳过没有自身差异且只有单 child 的冗长中间节点，找到值得展示的上下文。 */
function findNotableNode(
  node: HydrationDiffNode,
  indent: number,
): HydrationDiffNode {
  if (
    node.serverProps === undefined &&
    node.serverTail.length === 0 &&
    node.children.length === 1 &&
    node.distanceFromLeaf > 3 &&
    node.distanceFromLeaf > idealDepth - indent
  ) {
    // 该节点对理解上下文没有额外价值，可直接跳过。
    const child = node.children[0];
    return findNotableNode(child, indent);
  }
  return node;
}

/** 生成普通上下文行的缩进前缀。 */
function indentation(indent: number): string {
  return '  ' + '  '.repeat(indent);
}

/** 生成客户端新增行的 `+` 前缀与缩进。 */
function added(indent: number): string {
  return '+ ' + '  '.repeat(indent);
}

/** 生成服务端删除行的 `-` 前缀与缩进。 */
function removed(indent: number): string {
  return '- ' + '  '.repeat(indent);
}

/** 把 Fiber tag/type 转为 hydration diff 中可读的元素名；透明类型返回空。 */
function describeFiberType(fiber: Fiber): null | string {
  switch (fiber.tag) {
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      return fiber.type;
    case LazyComponent:
      return 'Lazy';
    case ActivityComponent:
      return 'Activity';
    case SuspenseComponent:
      return 'Suspense';
    case SuspenseListComponent:
      return 'SuspenseList';
    case FunctionComponent:
    case SimpleMemoComponent:
      const fn = fiber.type;
      return fn.displayName || fn.name || null;
    case ForwardRef:
      const render = fiber.type.render;
      return render.displayName || render.name || null;
    case ClassComponent:
      const ctr = fiber.type;
      return ctr.displayName || ctr.name || null;
    default:
      // 跳过不需要独立展示的 Fiber 类型。
      return null;
  }
}

/** 检测文本是否必须用 JSON 字符串形式转义。 */
const needsEscaping = /["'&<>\n\t]|^\s|\s$/;

/** 在长度预算内格式化文本节点，必要时 JSON 转义并用省略号截断。 */
function describeTextNode(content: string, maxLength: number): string {
  if (needsEscaping.test(content)) {
    const encoded = JSON.stringify(content);
    if (encoded.length > maxLength - 2) {
      if (maxLength < 8) {
        return '{"..."}';
      }
      return '{' + encoded.slice(0, maxLength - 7) + '..."}';
    }
    return '{' + encoded + '}';
  } else {
    if (content.length > maxLength) {
      if (maxLength < 5) {
        return '{"..."}';
      }
      return content.slice(0, maxLength - 3) + '...';
    }
    return content;
  }
}

/**
 * 描述客户端文本与服务端文本的 hydration 差异。
 * 首个差异过远时从差异附近截取，保证新增/删除两行能显示真正分叉位置。
 */
function describeTextDiff(
  clientText: string,
  serverProps: mixed,
  indent: number,
): string {
  const maxLength = maxRowLength - indent * 2;
  if (serverProps === null) {
    return added(indent) + describeTextNode(clientText, maxLength) + '\n';
  } else if (typeof serverProps === 'string') {
    let serverText: string = serverProps;
    let firstDiff = 0;
    for (
      ;
      firstDiff < serverText.length && firstDiff < clientText.length;
      firstDiff++
    ) {
      if (
        serverText.charCodeAt(firstDiff) !== clientText.charCodeAt(firstDiff)
      ) {
        break;
      }
    }
    if (firstDiff > maxLength - 8 && firstDiff > 10) {
      // 首个差异会被行尾截掉，改为裁掉开头并从差异附近展示。
      clientText = '...' + clientText.slice(firstDiff - 8);
      serverText = '...' + serverText.slice(firstDiff - 8);
    }
    return (
      added(indent) +
      describeTextNode(clientText, maxLength) +
      '\n' +
      removed(indent) +
      describeTextNode(serverText, maxLength) +
      '\n'
    );
  } else {
    return indentation(indent) + describeTextNode(clientText, maxLength) + '\n';
  }
}

/** 通过 Object.prototype.toString 取得跨 realm 对象类别名。 */
function objectName(object: mixed): string {
  // $FlowFixMe[method-unbinding]
  const name = Object.prototype.toString.call(object);
  return name.replace(/^\[object (.*)\]$/, function (m, p0) {
    return p0;
  });
}

/**
 * 在字符预算内把任意 prop 值压缩成诊断文本。
 * ReactElement 显示组件名，普通对象递归展示少量键，复杂宿主对象只显示类别名。
 */
function describeValue(value: mixed, maxLength: number): string {
  switch (typeof value) {
    case 'string': {
      const encoded = JSON.stringify(value);
      if (encoded.length > maxLength) {
        if (maxLength < 5) {
          return '"..."';
        }
        return encoded.slice(0, maxLength - 4) + '..."';
      }
      return encoded;
    }
    case 'object': {
      if (value === null) {
        return 'null';
      }
      if (isArray(value)) {
        return '[...]';
      }
      if ((value as any).$$typeof === REACT_ELEMENT_TYPE) {
        const type = getComponentNameFromType((value as any).type);
        return type ? '<' + type + '>' : '<...>';
      }
      const name = objectName(value);
      if (name === 'Object') {
        let properties = '';
        maxLength -= 2;
        for (let propName in value) {
          if (!value.hasOwnProperty(propName)) {
            continue;
          }
          const jsonPropName = JSON.stringify(propName);
          if (jsonPropName !== '"' + propName + '"') {
            propName = jsonPropName;
          }
          maxLength -= propName.length - 2;
          const propValue = describeValue(
            value[propName],
            maxLength < 15 ? maxLength : 15,
          );
          maxLength -= propValue.length;
          if (maxLength < 0) {
            properties += properties === '' ? '...' : ', ...';
            break;
          }
          properties +=
            (properties === '' ? '' : ',') + propName + ':' + propValue;
        }
        return '{' + properties + '}';
      } else if (enableSrcObject && (name === 'Blob' || name === 'File')) {
        return name + ':' + (value as any).type;
      }
      return name;
    }
    case 'function': {
      const name = (value as any).displayName || value.name;
      return name ? 'function ' + name : 'function';
    }
    default:
      // eslint-disable-next-line react-internal/safe-string-coercion
      return String(value);
  }
}

/** 把值格式化成 JSX prop 表达式；简单字符串用引号，其余包在花括号中。 */
function describePropValue(value: mixed, maxLength: number): string {
  if (typeof value === 'string' && !needsEscaping.test(value)) {
    if (value.length > maxLength - 2) {
      if (maxLength < 5) {
        return '"..."';
      }
      return '"' + value.slice(0, maxLength - 5) + '..."';
    }
    return '"' + value + '"';
  }
  return '{' + describeValue(value, maxLength - 2) + '}';
}

/** 把仅作路径上下文的元素压成一行，并忽略不会继续展开的 children。 */
function describeCollapsedElement(
  type: string,
  props: {
    /** 客户端元素属性名和值。 */
    [propName: string]: mixed
  },
  indent: number,
): string {
  // 非核心上下文元素尽量单行容纳 props；不会向下展开，所以忽略 children。

  let maxLength = maxRowLength - indent * 2 - type.length - 2;

  let content = '';

  for (const propName in props) {
    if (!props.hasOwnProperty(propName)) {
      continue;
    }
    if (propName === 'children') {
      // children 不参与折叠属性行。
      continue;
    }
    const propValue = describePropValue(props[propName], 15);
    maxLength -= propName.length + propValue.length + 2;
    if (maxLength < 0) {
      content += ' ...';
      break;
    }
    content += ' ' + propName + '=' + propValue;
  }

  return indentation(indent) + '<' + type + content + '>\n';
}

/**
 * 把差异元素完整展开；属性能放下一行时内联，否则每个属性独占一行。
 */
function describeExpandedElement(
  type: string,
  props: {
    /** 客户端或服务端元素的只读属性名和值。 */
    +[propName: string]: mixed
  },
  rowPrefix: string,
): string {
  // 尽量把 props 放在同一行；children 由树遍历另行处理。

  let remainingRowLength = maxRowLength - rowPrefix.length - type.length;

  // 先收集属性，随后根据总长度决定单行或多行。

  const properties = [];

  for (const propName in props) {
    if (!props.hasOwnProperty(propName)) {
      continue;
    }
    if (propName === 'children') {
      // children 不作为普通属性展示。
      continue;
    }
    const maxLength = maxRowLength - rowPrefix.length - propName.length - 1;
    const propValue = describePropValue(props[propName], maxLength);
    remainingRowLength -= propName.length + propValue.length + 2;
    properties.push(propName + '=' + propValue);
  }

  if (properties.length === 0) {
    return rowPrefix + '<' + type + '>\n';
  } else if (remainingRowLength > 0) {
    // 全部属性可放在一行。
    return rowPrefix + '<' + type + ' ' + properties.join(' ') + '>\n';
  } else {
    // 拆成每个属性一行。
    return (
      rowPrefix +
      '<' +
      type +
      '\n' +
      rowPrefix +
      '  ' +
      properties.join('\n' + rowPrefix + '  ') +
      '\n' +
      rowPrefix +
      '>\n'
    );
  }
}

/**
 * 展开已经被判定不匹配的普通对象属性：客户端自有键逐一显示，双方都有的键输出
 * 两行，服务端剩余键输出删除行。这里不再比较每个键的值是否相等，保留完整对象上下文。
 */
function describePropertiesDiff(
  clientObject: {
    /** 客户端嵌套对象属性名和值。 */
    +[propName: string]: mixed
  },
  serverObject: {
    /** 服务端嵌套对象属性名和值。 */
    +[propName: string]: mixed
  },
  indent: number,
): string {
  let properties = '';
  const remainingServerProperties = assign({}, serverObject);
  for (const propName in clientObject) {
    if (!clientObject.hasOwnProperty(propName)) {
      continue;
    }
    delete remainingServerProperties[propName];
    const maxLength = maxRowLength - indent * 2 - propName.length - 2;
    const clientValue = clientObject[propName];
    const clientPropValue = describeValue(clientValue, maxLength);
    if (serverObject.hasOwnProperty(propName)) {
      const serverValue = serverObject[propName];
      const serverPropValue = describeValue(serverValue, maxLength);
      properties += added(indent) + propName + ': ' + clientPropValue + '\n';
      properties += removed(indent) + propName + ': ' + serverPropValue + '\n';
    } else {
      properties += added(indent) + propName + ': ' + clientPropValue + '\n';
    }
  }
  for (const propName in remainingServerProperties) {
    if (!remainingServerProperties.hasOwnProperty(propName)) {
      continue;
    }
    const maxLength = maxRowLength - indent * 2 - propName.length - 2;
    const serverValue = remainingServerProperties[propName];
    const serverPropValue = describeValue(serverValue, maxLength);
    properties += removed(indent) + propName + ': ' + serverPropValue + '\n';
  }
  return properties;
}

/**
 * 对同类型宿主元素的客户端/服务端属性生成 JSX 风格差异。
 * 属性名按小写匹配以容忍宿主大小写正规化；大型普通对象会进一步逐键 diff。
 * @param clientProps Fiber 的完整 pendingProps，含供诊断展示的相等属性。
 * @param serverProps HostConfig 已筛出的服务端不匹配属性；没有对应项的客户端属性
 * 在这里按相等上下文显示，不等同于客户端新增属性。
 * @param indent 逻辑层级，每级两字符；maxRowLength 是展示预算，极小预算仍会输出省略标记。
 */
function describeElementDiff(
  type: string,
  clientProps: {
    /** 客户端期望的属性名和值。 */
    +[propName: string]: mixed
  },
  serverProps: {
    /** 服务端已有的属性名和值。 */
    +[propName: string]: mixed
  },
  indent: number,
): string {
  let content = '';

  // 把尚未匹配的服务端小写属性名映射回原始名称。
  const serverPropNames: Map<string, string> = new Map();

  for (const propName in serverProps) {
    if (!serverProps.hasOwnProperty(propName)) {
      continue;
    }
    serverPropNames.set(propName.toLowerCase(), propName);
  }

  if (serverPropNames.size === 1 && serverPropNames.has('children')) {
    content += describeExpandedElement(type, clientProps, indentation(indent));
  } else {
    for (const propName in clientProps) {
      if (!clientProps.hasOwnProperty(propName)) {
        continue;
      }
      if (propName === 'children') {
        // children 在属性循环后单独处理。
        continue;
      }
      const maxLength = maxRowLength - (indent + 1) * 2 - propName.length - 1;
      const serverPropName = serverPropNames.get(propName.toLowerCase());
      if (serverPropName !== undefined) {
        serverPropNames.delete(propName.toLowerCase());
        // 此属性在客户端与服务端存在差异。
        const clientValue = clientProps[propName];
        const serverValue = serverProps[serverPropName];
        const clientPropValue = describePropValue(clientValue, maxLength);
        const serverPropValue = describePropValue(serverValue, maxLength);
        if (
          typeof clientValue === 'object' &&
          clientValue !== null &&
          typeof serverValue === 'object' &&
          serverValue !== null &&
          objectName(clientValue) === 'Object' &&
          objectName(serverValue) === 'Object' &&
          // 只有键较多或摘要被截断时，才值得进一步展示嵌套 diff。
          (Object.keys(clientValue).length > 2 ||
            Object.keys(serverValue).length > 2 ||
            clientPropValue.indexOf('...') > -1 ||
            serverPropValue.indexOf('...') > -1)
        ) {
          // 两侧都是普通对象，改为比较内部属性。
          content +=
            indentation(indent + 1) +
            propName +
            '={{\n' +
            describePropertiesDiff(clientValue, serverValue, indent + 2) +
            indentation(indent + 1) +
            '}}\n';
        } else {
          content +=
            added(indent + 1) + propName + '=' + clientPropValue + '\n';
          content +=
            removed(indent + 1) + propName + '=' + serverPropValue + '\n';
        }
      } else {
        // 没有对应服务端差异项，按相等上下文展示。
        content +=
          indentation(indent + 1) +
          propName +
          '=' +
          describePropValue(clientProps[propName], maxLength) +
          '\n';
      }
    }

    serverPropNames.forEach(propName => {
      if (propName === 'children') {
        // children 在后面单独处理。
        return;
      }
      const maxLength = maxRowLength - (indent + 1) * 2 - propName.length - 1;
      content +=
        removed(indent + 1) +
        propName +
        '=' +
        describePropValue(serverProps[propName], maxLength) +
        '\n';
    });

    if (content === '') {
      // 没有属性差异。
      content = indentation(indent) + '<' + type + '>\n';
    } else {
      // 有属性差异，展开元素体。
      content =
        indentation(indent) +
        '<' +
        type +
        '\n' +
        content +
        indentation(indent) +
        '>\n';
    }
  }

  const serverChildren = serverProps.children;
  const clientChildren = clientProps.children;
  if (
    typeof serverChildren === 'string' ||
    typeof serverChildren === 'number' ||
    typeof serverChildren === 'bigint'
  ) {
    // 服务端 children 是文本，比较两侧文本。
    // $FlowFixMe[unsafe-addition]
    const serverText = '' + serverChildren;
    let clientText = '';
    if (
      typeof clientChildren === 'string' ||
      typeof clientChildren === 'number' ||
      typeof clientChildren === 'bigint'
    ) {
      // $FlowFixMe[unsafe-addition]
      clientText = '' + clientChildren;
    }
    content += describeTextDiff(clientText, serverText, indent + 1);
  } else if (
    typeof clientChildren === 'string' ||
    typeof clientChildren === 'number' ||
    typeof clientChildren === 'bigint'
  ) {
    if (serverChildren == null) {
      // 客户端新增字符串 child。
      // $FlowFixMe[unsafe-addition]
      content += describeTextDiff('' + clientChildren, null, indent + 1);
    } else {
      // 客户端有文本 child，但服务端值不被视为可比较差异。
      // $FlowFixMe[unsafe-addition]
      content += describeTextDiff('' + clientChildren, undefined, indent + 1);
    }
  }
  return content;
}

/** 描述不在 diff 树中的客户端 sibling；透明 Fiber 会递归摊平其 children。 */
function describeSiblingFiber(fiber: Fiber, indent: number): string {
  const type = describeFiberType(fiber);
  if (type === null) {
    // 跳过该 Fiber 类型，把它当作 Fragment 摊平到父节点 children。
    let flatContent = '';
    let childFiber = fiber.child;
    while (childFiber) {
      flatContent += describeSiblingFiber(childFiber, indent);
      childFiber = childFiber.sibling;
    }
    return flatContent;
  }
  return indentation(indent) + '<' + type + '>' + '\n';
}

/**
 * 递归把 HydrationDiffNode 格式化为带缩进的 `+/-` 树。
 * 输出会合并 Server Component 调试路径、当前 Fiber、匹配子节点、客户端 sibling 与
 * 服务端残留 tail，并折叠过长的无差异祖先链。
 * node.children 按同层客户端 sibling 顺序排列，用引用相等对齐；最后一个差异后的
 * 未记录 sibling 用省略号截断。pendingProps 允许尚未 complete 的失败工作也生成诊断。
 */
function describeNode(node: HydrationDiffNode, indent: number): string {
  const skipToNode = findNotableNode(node, indent);
  if (
    skipToNode !== node &&
    (node.children.length !== 1 || node.children[0] !== skipToNode)
  ) {
    return indentation(indent) + '...\n' + describeNode(skipToNode, indent + 1);
  }

  // 先输出 Server Component 调试路径作为上下文前缀。
  let parentContent = '';
  const debugInfo = node.fiber._debugInfo;
  if (debugInfo) {
    for (let i = 0; i < debugInfo.length; i++) {
      const serverComponentName = debugInfo[i].name;
      if (typeof serverComponentName === 'string') {
        parentContent +=
          indentation(indent) + '<' + serverComponentName + '>' + '\n';
        indent++;
      }
    }
  }

  // 输出当前节点本身。
  let selfContent = '';

  // 抛错时可能在 complete 前生成 diff，必须读取 pendingProps。
  const clientProps = node.fiber.pendingProps;

  if (node.fiber.tag === HostText) {
    // 文本节点。
    selfContent = describeTextDiff(clientProps, node.serverProps, indent);
    indent++;
  } else {
    const type = describeFiberType(node.fiber);
    if (type !== null) {
      // 元素节点。
      if (node.serverProps === undefined) {
        // 只作为路径上下文引用，不包含自身差异。
        selfContent = describeCollapsedElement(type, clientProps, indent);
        indent++;
      } else if (node.serverProps === null) {
        selfContent = describeExpandedElement(type, clientProps, added(indent));
        indent++;
      } else if (typeof node.serverProps === 'string') {
        if (__DEV__) {
          console.error(
            'Should not have matched a non HostText fiber to a Text node. This is a bug in React.',
          );
        }
      } else {
        selfContent = describeElementDiff(
          type,
          clientProps,
          node.serverProps,
          indent,
        );
        indent++;
      }
    }
  }

  // 计算 children 输出。
  let childContent = '';
  let childFiber = node.fiber.child;
  let diffIdx = 0;
  while (childFiber && diffIdx < node.children.length) {
    const childNode = node.children[diffIdx];
    if (childNode.fiber === childFiber) {
      // 该 child 在 diff 树中匹配。
      childContent += describeNode(childNode, indent);
      diffIdx++;
    } else {
      // 这是 mismatch 之前无关的客户端 sibling。
      childContent += describeSiblingFiber(childFiber, indent);
    }
    childFiber = childFiber.sibling;
  }

  if (childFiber && node.children.length > 0) {
    // 最后一个 mismatch 后仍有 sibling 时，无法确定它们是否有效匹配；用省略号截断，
    // 避免误导。
    childContent += indentation(indent) + '...' + '\n';
  }

  // 输出服务端存在、客户端删除的尾节点。
  const serverTail = node.serverTail;
  if (node.serverProps === null) {
    indent--;
  }
  for (let i = 0; i < serverTail.length; i++) {
    const tailNode = serverTail[i];
    if (typeof tailNode === 'string') {
      // 删除的文本节点。
      childContent +=
        removed(indent) +
        describeTextNode(tailNode, maxRowLength - indent * 2) +
        '\n';
    } else {
      // 删除的宿主元素。
      childContent += describeExpandedElement(
        tailNode.type,
        tailNode.props,
        removed(indent),
      );
    }
  }

  return parentContent + selfContent + childContent;
}

/**
 * 安全生成完整 hydration mismatch 文本；格式化诊断自身若抛错则返回空串，绝不影响
 * React 原本的 hydration 恢复控制流。
 */
export function describeDiff(rootNode: HydrationDiffNode): string {
  try {
    return '\n\n' + describeNode(rootNode, 0);
  } catch (x) {
    return '';
  }
}
