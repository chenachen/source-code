/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
'use strict';

/**
 * 把流式服务端测试产生的节点移入目标容器，并按浏览器插入语义执行其中脚本。
 * CSP nonce 不匹配的内联脚本会暂时清空，完成搬移后再恢复文本，既验证“不可执行”
 * 行为又不破坏最终 DOM 快照。该工具模拟适配器消费结果，不是 Fizz 实现本身。
 */
async function insertNodesAndExecuteScripts(
  source: Document | Element,
  target: Node,
  CSPnonce: string | null,
) {
  const ownerDocument = target.ownerDocument || target;

  // 先清空 CSP 会阻止的脚本文本，避免测试环境错误执行；节点搬移结束后再恢复原内容。
  const badNonceScriptNodes: Map<Element, string> = new Map();
  if (CSPnonce) {
    const scripts = source.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      if (
        !script.hasAttribute('src') &&
        script.getAttribute('nonce') !== CSPnonce
      ) {
        badNonceScriptNodes.set(script, script.textContent);
        script.textContent = '';
      }
    }
  }
  let lastChild = null;
  while (source.firstChild) {
    const node = source.firstChild;
    if (lastChild === node) {
      throw new Error('Infinite loop.');
    }
    lastChild = node;

    if (node.nodeType === 1) {
      const element: Element = node as any;
      if (
        // $FlowFixMe[prop-missing]
        element.dataset != null &&
        (element.dataset.rxi != null ||
          element.dataset.rri != null ||
          element.dataset.rci != null ||
          element.dataset.rsi != null)
      ) {
        // 外部 runtime 指令约定置于 body；在 renderIntoContainer/renderDocument 尚未
        // 强制该约束前，测试工具把误落在文档深处的指令纠正到 body 后再执行。
        (ownerDocument.body as any).appendChild(element);
      } else {
        target.appendChild(element);

        if (element.nodeName === 'SCRIPT') {
          await executeScript(element);
        } else {
          const scripts = element.querySelectorAll('script');
          for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            await executeScript(script);
          }
        }
      }
    } else {
      target.appendChild(node);
    }
  }

  // 所有可执行脚本均已尝试执行，现在恢复被 CSP 拦截脚本的原始文本。
  badNonceScriptNodes.forEach((scriptContent, script) => {
    script.textContent = scriptContent;
  });
}

/**
 * 在测试 DOM 中执行一个已挂载 script。
 * 外链脚本通过模块加载模拟浏览器请求；内联脚本通过创建新节点触发 jsdom 执行语义。
 */
async function executeScript(script: Element) {
  const ownerDocument = script.ownerDocument;
  if (script.parentNode == null) {
    throw new Error(
      'executeScript expects to be called on script nodes that are currently in a document',
    );
  }
  const parent = script.parentNode;
  const scriptSrc = script.getAttribute('src');
  if (scriptSrc) {
    if (document !== ownerDocument) {
      throw new Error(
        'You must set the current document to the global document to use script src in tests',
      );
    }

    try {
      // $FlowFixMe[unsupported-syntax]
      require(scriptSrc);
    } catch (x) {
      const event = new window.ErrorEvent('error', {error: x});
      window.dispatchEvent(event);
    }
  } else {
    const newScript = ownerDocument.createElement('script');
    newScript.textContent = script.textContent;
    // 复制全部属性，特别是 nonce，确保替换节点仍遵守原 CSP 条件。
    for (let i = 0; i < script.attributes.length; i++) {
      const attribute = script.attributes[i];
      newScript.setAttribute(attribute.name, attribute.value);
    }

    parent.insertBefore(newScript, script);
    parent.removeChild(script);
  }
}

/** 以调用方选项覆盖测试默认值，生成新的渲染选项对象。 */
function mergeOptions(options: Object, defaultOptions: Object): Object {
  return {
    ...defaultOptions,
    ...options,
  };
}

/** 从节点集合中过滤指定 external runtime 脚本，便于断言用户可见输出。 */
function stripExternalRuntimeInNodes(
  nodes: HTMLElement[] | HTMLCollection<HTMLElement>,
  externalRuntimeSrc: string | null,
): HTMLElement[] {
  if (!Array.isArray(nodes)) {
    nodes = Array.from(nodes);
  }
  if (externalRuntimeSrc == null) {
    return nodes;
  }
  return nodes.filter(
    n =>
      (n.tagName !== 'SCRIPT' && n.tagName !== 'script') ||
      n.getAttribute('src') !== externalRuntimeSrc,
  );
}

/**
 * 把 DOM 中用户可见的子树归一化为 React 节点，供流式输出断言比较。
 * 脚本、模板、隐藏节点、阻塞 expect 与 React 自动 ID 等实现细节会被剔除。
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
        !node.hasAttribute('aria-hidden') &&
        // 渲染阻塞用的 expect link 是协议指令，不属于用户可见内容。
        (node.getAttribute('rel') !== 'expect' ||
          node.getAttribute('blocking') !== 'render')
      ) {
        const props: any = {};
        const attributes = node.attributes;
        for (let i = 0; i < attributes.length; i++) {
          if (
            attributes[i].name === 'id' &&
            attributes[i].value.includes(':')
          ) {
            // 含冒号的 id 视为 React 自动生成标识，是非视觉实现细节。
            continue;
          }
          props[attributes[i].name] = attributes[i].value;
        }
        const nestedChildren = getVisibleChildren(node);
        if (nestedChildren !== undefined) {
          props.children = nestedChildren;
        }
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

export {
  insertNodesAndExecuteScripts,
  mergeOptions,
  stripExternalRuntimeInNodes,
  getVisibleChildren,
};
