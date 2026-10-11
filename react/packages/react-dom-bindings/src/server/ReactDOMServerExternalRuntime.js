/**
 * 本文件由 Rollup 编译为 Fizz 客户端加载的独立浏览器脚本，因此必须快速且尽量少依赖外部模块。
 * @flow
 */
/* eslint-disable dot-notation */

// 发布包由 Closure Compiler 静态解析导入，Jest 单元测试则由 Rollup 解析。
import './fizz-instruction-set/ReactDOMFizzInstructionSetExternalRuntime';

if (document.body != null) {
  if (document.readyState === 'loading') {
    installFizzInstrObserver(document.body);
  }
  // $FlowFixMe[incompatible-type]
  handleExistingNodes(document.body as HTMLElement);
} else {
  // 此时文档必然仍在加载：若 Fizz 外部 runtime 由 <head> 提前发送（如 preinit 资源），
  // body 可能尚未创建。
  // $FlowFixMe[recursive-definition]
  /** 等待 body 首次插入后安装指令观察器，并立即消费已有节点。 */
  const domBodyObserver = new MutationObserver(() => {
    // body 一旦完成解析/创建，身份应保持稳定。
    if (document.body != null) {
      if (document.readyState === 'loading') {
        installFizzInstrObserver(document.body);
      }
      // $FlowFixMe[incompatible-type]
      handleExistingNodes(document.body as HTMLElement);

      // 只会出现一个 document.body，因此可直接 disconnect，无需 takeRecords。
      domBodyObserver.disconnect();
    }
  });
  // 这一阶段 documentElement 必然已经存在。
  domBodyObserver.observe(document.documentElement, {childList: true});
}

/** 查询目标后代的template并按DOM顺序消费已有指令；用于runtime加载晚于shell/片段输出的情况。 */
function handleExistingNodes(target: HTMLElement) {
  const existingNodes = target.querySelectorAll('template');
  for (let i = 0; i < existingNodes.length; i++) {
    handleNode(existingNodes[i]);
  }
}

/** 只观察body直接新增的childList节点，不启用subtree；Fizz指令追加于body。DOMContentLoaded先takeRecords消费最后一批，再disconnect停止接收。 */
function installFizzInstrObserver(target: Node) {
  /** 遍历每批新增节点，只处理仍连接到父节点的候选指令。 */
  const handleMutations = (mutations: Array<MutationRecord>) => {
    for (let i = 0; i < mutations.length; i++) {
      const addedNodes = mutations[i].addedNodes;
      for (let j = 0; j < addedNodes.length; j++) {
        if (addedNodes[j].parentNode) {
          handleNode(addedNodes[j]);
        }
      }
    }
  };

  /** 监听流式追加 Fizz 指令的 MutationObserver。 */
  const fizzInstrObserver = new MutationObserver(handleMutations);
  // 即使 Fizz 正在向 shell/子树流式输出，指令数据节点最终也会追加到 body。
  fizzInstrObserver.observe(target, {
    childList: true,
  });
  window.addEventListener('DOMContentLoaded', () => {
    handleMutations(fizzInstrObserver.takeRecords());
    fizzInstrObserver.disconnect();
  });
}

/**
 * 按rxi/rri/rci/rsi优先顺序识别元素dataset里的Fizz指令码，传边界/片段id及错误或样式载荷
 * 给对应全局处理器，成功后移除指令节点；没有指令码的元素保持原状。
 * JSON解析或全局处理器异常原样传播，尚未执行的remove不会清理该指令。
 * 非元素或无 dataset 的节点直接忽略。
 */
function handleNode(node_: Node) {
  // $FlowFixMe[incompatible-type]
  if (node_.nodeType !== 1 || !(node_ as HTMLElement).dataset) {
    return;
  }
  // $FlowFixMe[incompatible-type]
  const node = node_ as HTMLElement;
  const dataset = node.dataset;
  if (dataset['rxi'] != null) {
    window['$RX'](
      dataset['bid'],
      dataset['dgst'],
      dataset['msg'],
      dataset['stck'],
      dataset['cstck'],
    );
    node.remove();
  } else if (dataset['rri'] != null) {
    // 样式描述符类型为 Array<Array<string>>，在协议边界处从 JSON 转回数组。
    window['$RR'](dataset['bid'], dataset['sid'], JSON.parse(dataset['sty']));
    node.remove();
  } else if (dataset['rci'] != null) {
    window['$RC'](dataset['bid'], dataset['sid']);
    node.remove();
  } else if (dataset['rsi'] != null) {
    window['$RS'](dataset['sid'], dataset['pid']);
    node.remove();
  }
}
