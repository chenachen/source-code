/* eslint-disable dot-notation */

// 内联脚本与外部 runtime 指令集共用的实现及协议常量。

/** DOM 元素节点类型码。 */
const ELEMENT_NODE = 1;
/** DOM 注释节点类型码，Fizz 用注释编码边界。 */
const COMMENT_NODE = 8;
/** Activity 边界起始注释数据。 */
const ACTIVITY_START_DATA = '&';
/** Activity 边界结束注释数据。 */
const ACTIVITY_END_DATA = '/&';
/** 已完成 Suspense 边界起始注释数据。 */
const SUSPENSE_START_DATA = '$';
/** Suspense 边界结束注释数据。 */
const SUSPENSE_END_DATA = '/$';
/** 待决 Suspense 边界起始注释数据。 */
const SUSPENSE_PENDING_START_DATA = '$?';
/** 已排队等待揭示的 Suspense 边界起始注释数据。 */
const SUSPENSE_QUEUED_START_DATA = '$~';
/** 需要客户端渲染的 Suspense fallback 起始注释数据。 */
const SUSPENSE_FALLBACK_START_DATA = '$!';

/** 将相邻完成边界合并为一批的默认节流窗口。 */
const FALLBACK_THROTTLE_MS = 300;

/** ViewTransition 最多等待字体与可视图片的时间。 */
const SUSPENSEY_FONT_AND_IMAGE_TIMEOUT = 500;

/**
 * 揭示节流的目标指标（毫秒）。若取消节流即可赶上目标，就缩短等待；该值由
 * “LCP 2.5 秒并留出余量”的目标推导而来。
 */
const TARGET_VANITY_METRIC = 2300;

// TODO：模块外引用的符号使用动态下标而非点访问，防止 Closure 高级编译重命名。
// 理论上可用 extern 文件替代，但当前未配置成功；Closure 最终仍会转回点访问，优先级不高。

/**
 * 揭示一批已完成边界：删除 fallback、搬入流式内容并把起始标记改为已完成。
 * batch按[id template,隐藏内容容器]成对排列；先分离内容容器，再从template起删除fallback，
 * 按Suspense/Activity注释深度找到外层结束标记，搬入内容并将起点改为完成。
 * 目标template已无parent时跳过；内容容器无parent只省略分离，仍可搬其持有的子级。
 * _reactRetry通过rAF通知hydration重试，本批处理后length=0以复用数组。
 */
export function revealCompletedBoundaries(batch) {
  window['$RT'] = performance.now();
  for (let i = 0; i < batch.length; i += 2) {
    const suspenseIdNode = batch[i];
    const contentNode = batch[i + 1];
    if (contentNode.parentNode === null) {
      // 客户端水合失败可能已删除流 segment，服务端也可能在发出完成指令后取消它；
      // 两种情况都不需再次remove；后续若目标仍存在，仍会使用该容器持有的子级。
    } else {
      // 现在可分离内容；内部边界后续完成时会在目标位置找到对应标记。
      contentNode.parentNode.removeChild(contentNode);
    }
    // 清空已有 fallback 子节点时必须处理嵌套 Suspense，逻辑类似 ReactFiberConfigDOM 的
    // clearSuspenseBoundary。TODO：若 fallback 树永不输出边界即可省略，但当前仍支持渐进加载 fallback。
    const parentInstance = suspenseIdNode.parentNode;
    if (!parentInstance) {
      // 该边界可能已由客户端渲染，直接跳过。
      continue;
    }

    // fallback 的边界起点固定是 id 节点的前一个兄弟。
    const suspenseNode = suspenseIdNode.previousSibling;

    let node = suspenseIdNode;
    let depth = 0;
    do {
      if (node && node.nodeType === COMMENT_NODE) {
        const data = node.data;
        if (data === SUSPENSE_END_DATA || data === ACTIVITY_END_DATA) {
          if (depth === 0) {
            break;
          } else {
            depth--;
          }
        } else if (
          data === SUSPENSE_START_DATA ||
          data === SUSPENSE_PENDING_START_DATA ||
          data === SUSPENSE_QUEUED_START_DATA ||
          data === SUSPENSE_FALLBACK_START_DATA ||
          data === ACTIVITY_START_DATA
        ) {
          depth++;
        }
      }

      const nextNode = node.nextSibling;
      parentInstance.removeChild(node);
      node = nextNode;
    } while (node);

    const endOfBoundary = node;

    // 将 contentNode 的全部子节点插入 Suspense 起止标记之间。
    while (contentNode.firstChild) {
      parentInstance.insertBefore(contentNode.firstChild, endOfBoundary);
    }

    suspenseNode.data = SUSPENSE_START_DATA;
    if (suspenseNode['_reactRetry']) {
      requestAnimationFrame(suspenseNode['_reactRetry']);
    }
  }
  batch.length = 0;
}

/**
 * 在揭示完成边界前收集 enter/exit/share/update 元素，并用浏览器 ViewTransition 包装提交。
 * 已有transition时等finished.finally再把原batch交全局$RV，避免两批并行快照。
 * restoreQueue以[element,旧name,旧class]三元组保存临时样式；share先配名再设exit/enter，
 * update只处理未加入队列的元素。update回调先reveal再强制布局并等待字体/可视未完成图片，
 * 等待Promise与500ms/指标剩余预算竞速；图片load/error均视为等待结束，不决定边界错误。
 * 同步准备异常/无动画元素走普通揭示；异步ready/finished在各自finally中处理恢复/释放，
 * 本实现不在catch里逆序回滚已经设置的名称，也未取消竞速余下timer或移除图片监听。
 */
export function revealCompletedBoundariesWithViewTransitions(
  revealBoundaries,
  batch,
) {
  let shouldStartViewTransition = false;
  let autoNameIdx = 0;
  const restoreQueue = [];
  /** 为参与动画的元素设置临时 transition 名称/类别，并记录原值供逆序恢复。 */
  function applyViewTransitionName(element, classAttributeName) {
    const className = element.getAttribute(classAttributeName);
    if (!className) {
      return;
    }
    // 所有被设置名称的元素都加入恢复队列，以便动画开始后还原。
    const elementStyle = element.style;
    restoreQueue.push(
      element,
      elementStyle['viewTransitionName'],
      elementStyle['viewTransitionClass'],
    );
    if (className !== 'auto') {
      elementStyle['viewTransitionClass'] = className;
    }
    let name = element.getAttribute('vt-name');
    if (!name) {
      // 自动生成仅在本次动画期间使用的名称；TODO：当前没有可选前缀，或许也无需前缀。
      const idPrefix = '';
      name = '_' + idPrefix + 'T_' + autoNameIdx++ + '_';
    }
    // 名称不是合法 CSS 标识符时改用 base64；这样无法用自定义 CSS 选择器引用，
    // 但当前浏览器仍可执行 transition。
    const escapedName =
      CSS.escape(name) !== name ? 'r-' + btoa(name).replace(/=/g, '') : name;
    elementStyle['viewTransitionName'] = escapedName;
    shouldStartViewTransition = true;
  }
  try {
    const existingTransition = document['__reactViewTransition'];
    if (existingTransition) {
      // 等前一个 ViewTransition 完成后重试本批次。
      existingTransition.finished.finally(window['$RV'].bind(null, batch));
      return;
    }
    // 先收集可能与退出元素配对的进入名称。
    const appearingViewTransitions = new Map();
    for (let i = 1; i < batch.length; i += 2) {
      const contentNode = batch[i];
      const appearingElements = contentNode.querySelectorAll('[vt-share]');
      for (let j = 0; j < appearingElements.length; j++) {
        const appearingElement = appearingElements[j];
        appearingViewTransitions.set(
          appearingElement.getAttribute('vt-name'),
          appearingElement,
        );
      }
    }
    const suspenseyImages = [];
    // 再定位要动画的节点并应用临时名称。
    for (let i = 0; i < batch.length; i += 2) {
      const suspenseIdNode = batch[i];
      const parentInstance = suspenseIdNode.parentNode;
      if (!parentInstance) {
        // 该边界可能已经客户端渲染，跳过。
        continue;
      }
      const parentRect = parentInstance.getBoundingClientRect();
      if (
        !parentRect.left &&
        !parentRect.top &&
        !parentRect.width &&
        !parentRect.height
      ) {
        // display:none 的父节点不参与动画。它可能属于另一个尚未/即将揭示的边界，
        // 应由外层执行 exit/enter；这也自然跳过普通隐藏树。
        // TODO：视口外节点是否也应跳过？尺寸变化仍可能把它带入视口。
        // TODO：内层边界若位于即将删除的 fallback，也不应执行自身 exit 动画。
        continue;
      }

      // 为 fallback 内的直接元素应用退出动画。
      let node = suspenseIdNode;
      let depth = 0;
      while (node) {
        if (node.nodeType === COMMENT_NODE) {
          const data = node.data;
          if (data === SUSPENSE_END_DATA) {
            if (depth === 0) {
              break;
            } else {
              depth--;
            }
          } else if (
            data === SUSPENSE_START_DATA ||
            data === SUSPENSE_PENDING_START_DATA ||
            data === SUSPENSE_QUEUED_START_DATA ||
            data === SUSPENSE_FALLBACK_START_DATA
          ) {
            depth++;
          }
        } else if (node.nodeType === ELEMENT_NODE) {
          const exitElement = node;
          const exitName = exitElement.getAttribute('vt-name');
          const pairedElement = appearingViewTransitions.get(exitName);
          applyViewTransitionName(
            exitElement,
            pairedElement ? 'vt-share' : 'vt-exit',
          );
          if (pairedElement) {
            // 同时激活配对的进入元素。
            applyViewTransitionName(pairedElement, 'vt-share');
            appearingViewTransitions.set(exitName, null); // 标记已配对。
          }
          // 再在该元素内部寻找可触发 share 的配对。
          const disappearingElements =
            exitElement.querySelectorAll('[vt-share]');
          for (let j = 0; j < disappearingElements.length; j++) {
            const disappearingElement = disappearingElements[j];
            const name = disappearingElement.getAttribute('vt-name');
            const appearingElement = appearingViewTransitions.get(name);
            if (appearingElement) {
              applyViewTransitionName(disappearingElement, 'vt-share');
              applyViewTransitionName(appearingElement, 'vt-share');
              appearingViewTransitions.set(name, null); // 标记已配对。
            }
          }
          // 把 exit 传递给显式选择继承的嵌套 ViewTransition。
          const relayExitElements =
            exitElement.querySelectorAll('[vt-parent-exit]');
          for (let j = 0; j < relayExitElements.length; j++) {
            applyViewTransitionName(relayExitElements[j], 'vt-parent-exit');
          }
        }
        node = node.nextSibling;
      }

      // 为即将插入的新节点应用进入动画。
      const contentNode = batch[i + 1];
      let enterElement = contentNode.firstElementChild;
      while (enterElement) {
        const paired =
          appearingViewTransitions.get(enterElement.getAttribute('vt-name')) ===
          null;
        if (!paired) {
          applyViewTransitionName(enterElement, 'vt-enter');
        }
        // 把 enter 传递给显式选择继承的嵌套 ViewTransition。
        const relayEnterElements =
          enterElement.querySelectorAll('[vt-parent-enter]');
        for (let j = 0; j < relayEnterElements.length; j++) {
          applyViewTransitionName(relayEnterElements[j], 'vt-parent-enter');
        }
        enterElement = enterElement.nextElementSibling;
      }

      // 为可能受布局变化影响的祖先及兄弟应用 update 动画。
      let ancestorElement = parentInstance;
      do {
        let childElement = ancestorElement.firstElementChild;
        while (childElement) {
          // TODO：条件允许时提前退出扫描。
          const updateClassName = childElement.getAttribute('vt-update');
          if (
            updateClassName &&
            updateClassName !== 'none' &&
            !restoreQueue.includes(childElement)
          ) {
            // 已参与 exit/enter/share 的元素不再覆盖其 transition 配置。
            applyViewTransitionName(childElement, 'vt-update');
          }
          childElement = childElement.nextElementSibling;
        }
      } while (
        (ancestorElement = ancestorElement.parentNode) &&
        ancestorElement.nodeType === ELEMENT_NODE &&
        ancestorElement.getAttribute('vt-update') !== 'none'
      );

      // 收集新内容中即将出现、可能阻塞显示的图片。
      const appearingImages = contentNode.querySelectorAll(
        'img[src]:not([loading="lazy"])',
      );
      // TODO：若能为该场景禁用根动画，可考虑仅因找到图片就启动 ViewTransition。
      suspenseyImages.push.apply(suspenseyImages, appearingImages);
    }
    if (shouldStartViewTransition) {
      const transition = (document['__reactViewTransition'] = document[
        'startViewTransition'
      ]({
        /** 在 ViewTransition 更新阶段揭示边界，并等待字体/可视图片或超时。 */
        update: () => {
          revealBoundaries(batch);
          const blockingPromises = [
            // 强制布局以触发字体加载；保留实际值以防压缩器删除读取。
            document.documentElement.clientHeight,
            // 已搬入内容并触发布局；等待字体就绪后才允许 ViewTransition 拍摄新状态。
            document.fonts.ready,
          ];
          for (let i = 0; i < suspenseyImages.length; i++) {
            const suspenseyImage = suspenseyImages[i];
            if (!suspenseyImage.complete) {
              const rect = suspenseyImage.getBoundingClientRect();
              const inViewport =
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < window.innerHeight &&
                rect.left < window.innerWidth;
              if (inViewport) {
                // TODO：待 https://issues.chromium.org/issues/420748301 的修复充分普及后，
                // 改用 decode() 而不是 load 事件。
                const loadingImage = new Promise(resolve => {
                  suspenseyImage.addEventListener('load', resolve);
                  suspenseyImage.addEventListener('error', resolve);
                });
                blockingPromises.push(loadingImage);
              }
            }
          }
          return Promise.race([
            Promise.all(blockingPromises),
            new Promise(resolve => {
              const currentTime = performance.now();
              const msUntilTimeout =
                // 若节流会错过目标指标则缩短等待；performance.now() 的零点视为指标起点。
                currentTime < TARGET_VANITY_METRIC &&
                currentTime > TARGET_VANITY_METRIC - FALLBACK_THROTTLE_MS
                  ? TARGET_VANITY_METRIC - currentTime
                  : // 否则使用固定字体/图片等待上限。
                    SUSPENSEY_FONT_AND_IMAGE_TIMEOUT;
              setTimeout(resolve, msUntilTimeout);
            }),
          ]);
        },
        types: [], // TODO：为 Suspense 揭示增加固定类型。
      }));
      transition.ready.finally(() => {
        // 逆序回写临时名称/类别；当前类别回写读取的是名称槽（i + 1），并非记录类别的 i + 2 槽。
        for (let i = restoreQueue.length - 3; i >= 0; i -= 3) {
          const element = restoreQueue[i];
          const elementStyle = element.style;
          const previousName = restoreQueue[i + 1];
          elementStyle['viewTransitionName'] = previousName;
          const previousClassName = restoreQueue[i + 1];
          elementStyle['viewTransitionClass'] = previousClassName;
          if (element.getAttribute('style') === '') {
            element.removeAttribute('style');
          }
        }
      });
      transition.finished.finally(() => {
        if (document['__reactViewTransition'] === transition) {
          document['__reactViewTransition'] = null;
        }
      });
      // 后续完成项不在本次快照中，必须进入新的独立批次。
      window['$RB'] = [];
      return;
    }
    // 没有可动画元素时继续普通揭示。
  } catch (x) {
    // ViewTransition 准备失败时继续普通揭示。
  }
  // 不支持 ViewTransitions v2 或没有匹配动画时立即揭示。
  revealBoundaries(batch);
}

/**
 * 把指定 Suspense fallback 标记为客户端渲染，附加服务端错误元数据并触发已水合父级重试。
 */
export function clientRenderBoundary(
  suspenseBoundaryID,
  errorDigest,
  errorMsg,
  errorStack,
  errorComponentStack,
) {
  // 定位待定边界起始注释后的 ID template。
  const suspenseIdNode = document.getElementById(suspenseBoundaryID);
  if (!suspenseIdNode) {
    // 用户已离开这棵树，例如父级已完成水合。
    return;
  }
  // fallback 边界起点固定是 id 节点的前一个兄弟。
  const suspenseNode = suspenseIdNode.previousSibling;
  // 标记为需要客户端渲染。
  suspenseNode.data = SUSPENSE_FALLBACK_START_DATA;
  // 把错误元数据写入该 template 的 dataset，供客户端诊断。
  const dataset = suspenseIdNode.dataset;
  if (errorDigest != null) dataset['dgst'] = errorDigest;
  if (errorMsg) dataset['msg'] = errorMsg;
  if (errorStack) dataset['stck'] = errorStack;
  if (errorComponentStack) dataset['cstck'] = errorComponentStack;
  // 父级若已水合，通知 React 立即重试该边界。
  if (suspenseNode['_reactRetry']) {
    suspenseNode['_reactRetry']();
  }
}

/**
 * contentID找不到直接返回；边界template已移除则删除孤立内容容器。两者存在时
 * 将起点从pending改为queued，再把[template,content]追加到全局$RB。
 * 只有数组长度变2的首对安排刷新：无$RT用rAF，有$RT用timer；后续条目合并入同一数组。
 * 延迟按上次reveal时间300ms或接近目标指标时的剩余预算计算，非正值仍交timer。
 */
export function completeBoundary(suspenseBoundaryID, contentID) {
  const contentNodeOuter = document.getElementById(contentID);
  if (!contentNodeOuter) {
    // 水合失败可能已删除流 segment，服务端也可能发出完成指令后又取消它；均可忽略。
    return;
  }

  // 定位待定边界起始注释后的 ID template。
  const suspenseIdNodeOuter = document.getElementById(suspenseBoundaryID);
  if (!suspenseIdNodeOuter) {
    // 此边界永不会揭示，可立即删除内容；正常路径则保留到揭示，以便其中嵌套边界先完成。
    contentNodeOuter.parentNode.removeChild(contentNodeOuter);

    // 用户已离开此树（例如父级已水合）；确认容器删除后无需其他处理。
    return;
  }

  // 标记边界已排队，避免文档加载结束时误切到客户端渲染。
  const suspenseNodeOuter = suspenseIdNodeOuter.previousSibling;
  suspenseNodeOuter.data = SUSPENSE_QUEUED_START_DATA;
  // 把边界与内容成对加入下一批。
  window['$RB'].push(suspenseIdNodeOuter, contentNodeOuter);

  if (window['$RB'].length === 2) {
    // 这是该批首对条目，需要按节流启发式安排一次刷新。
    if (typeof window['$RT'] !== 'number') {
      // 尚未收到 rAF 时间戳时，把整批安排到首帧。
      requestAnimationFrame(window['$RV'].bind(null, window['$RB']));
    } else {
      const currentTime = performance.now();
      const msUntilTimeout =
        // 若节流会错过目标指标则缩短等待；performance.now() 的零点视为指标起点。
        currentTime < TARGET_VANITY_METRIC &&
        currentTime > TARGET_VANITY_METRIC - FALLBACK_THROTTLE_MS
          ? TARGET_VANITY_METRIC - currentTime
          : // 否则从上次提交时刻起应用固定节流窗口。
            window['$RT'] + FALLBACK_THROTTLE_MS - currentTime;
      // 即使延迟很小或为负仍通过 timer 刷新，让同一任务中已排队的 completeBoundary
      // 调用有机会合并进本批。
      setTimeout(window['$RV'].bind(null, window['$RB']), msUntilTimeout);
    }
  }
}

/**
 * stylesheetDescriptors按[href,precedence,属性名,属性值,...]描述外部样式；$RM按href
 * 缓存已插入link，precedences保存每组最后节点，使同precedence追加、首组按遇到顺序排布。
 * 已有link只在其_p仍为Promise且media当前匹配时等待；新link先安装load/error再插入，
 * 两种结果都清空_p，后续复用不再等待且不重新请求；本实现不保存失败状态或重试。
 * 第二遍提升现有media="not all"的匹配link/style并移除media。依赖全成功交$RC排揭示，
 * 任一拒绝交$RX标为客户端恢复；这些动作不在此函数卸载已插入的资源。
 */
export function completeBoundaryWithStyles(
  suspenseBoundaryID,
  contentID,
  stylesheetDescriptors,
) {
  const precedences = new Map();
  const thisDocument = document;
  let lastResource, node;

  // 用现有资源初始化precedence链；media=not all的匹配link/style另收集待提升。
  const nodes = thisDocument.querySelectorAll(
    'link[data-precedence],style[data-precedence]',
  );
  const styleTagsToHoist = [];
  for (let i = 0; (node = nodes[i++]); ) {
    if (node.getAttribute('media') === 'not all') {
      styleTagsToHoist.push(node);
    } else {
      if (node.tagName === 'LINK') {
        window['$RM'].set(node.getAttribute('href'), node);
      }
      precedences.set(node.dataset['precedence'], (lastResource = node));
    }
  }

  let i = 0;
  const dependencies = [];
  let href, precedence, attr, loadingState, resourceEl, media;

  /** 清除资源加载 Promise 标记，再调用完成或失败回调。 */
  function cleanupWith(cb) {
    this['_p'] = null;
    cb();
  }

  // 首先处理外部样式表模式。
  let sheetMode = true;
  while (true) {
    if (sheetMode) {
      // 遍历样式表描述符：新资源负责构造，已存在资源只检查是否仍是依赖。
      const stylesheetDescriptor = stylesheetDescriptors[i++];
      if (!stylesheetDescriptor) {
        // 描述符耗尽后进入先前收集的media=not all资源提升模式。
        sheetMode = false;
        i = 0;
        continue;
      }

      let avoidInsert = false;
      let j = 0;
      href = stylesheetDescriptor[j++];

      if ((resourceEl = window['$RM'].get(href))) {
        // 复用已经插入的样式表。
        loadingState = resourceEl['_p'];
        avoidInsert = true;
      } else {
        // 首次遇到该 href：构造并提升 link、附加加载状态，再按 media 是否匹配决定是否等待。
        resourceEl = thisDocument.createElement('link');
        resourceEl.href = href;
        resourceEl.rel = 'stylesheet';
        resourceEl.dataset['precedence'] = precedence =
          stylesheetDescriptor[j++];
        while ((attr = stylesheetDescriptor[j++])) {
          resourceEl.setAttribute(attr, stylesheetDescriptor[j++]);
        }
        loadingState = resourceEl['_p'] = new Promise((resolve, reject) => {
          resourceEl.onload = cleanupWith.bind(resourceEl, resolve);
          resourceEl.onerror = cleanupWith.bind(resourceEl, reject);
        });
        // 缓存资源元素，后续同 href 可直接复用。
        window['$RM'].set(href, resourceEl);
      }
      media = resourceEl.getAttribute('media');
      if (loadingState && (!media || window['matchMedia'](media).matches)) {
        dependencies.push(loadingState);
      }
      if (avoidInsert) {
        // 已在文档中的 link 不再进入插入路径。
        continue;
      }
    } else {
      // 提升尚未处理的data-precedence资源；此前查询同时包括link/style。
      resourceEl = styleTagsToHoist[i++];
      if (!resourceEl) {
        // 全部 style 标签处理完毕。
        break;
      }

      precedence = resourceEl.getAttribute('data-precedence');
      resourceEl.removeAttribute('media');
    }

    // resourceEl为新建stylesheet link或第二遍待提升的既有link/style。
    const prior = precedences.get(precedence) || lastResource;
    if (prior === lastResource) {
      lastResource = resourceEl;
    }
    precedences.set(precedence, resourceEl);

    // 最后按 precedence 链把新资源插入文档中的正确位置。
    if (prior) {
      prior.parentNode.insertBefore(resourceEl, prior.nextSibling);
    } else {
      const head = thisDocument.head;
      head.insertBefore(resourceEl, head.firstChild);
    }
  }

  const suspenseIdNodeOuter = document.getElementById(suspenseBoundaryID);
  if (suspenseIdNodeOuter) {
    // 标记边界已排队，避免文档加载结束时误切到客户端渲染。
    const suspenseNodeOuter = suspenseIdNodeOuter.previousSibling;
    suspenseNodeOuter.data = SUSPENSE_QUEUED_START_DATA;
  }

  Promise.all(dependencies).then(
    window['$RC'].bind(null, suspenseBoundaryID, contentID),
    window['$RX'].bind(null, suspenseBoundaryID, 'CSS failed to load'),
  );
}

/** containerID/placeholderID必须找到仍有parent的容器与占位符；先摘容器、再按首子级顺序逐个insertBefore到占位符前，最后摘占位符。此指令无边界完成路径的缺节点跳过门，协议节点缺失会抛DOM访问错误。 */
export function completeSegment(containerID, placeholderID) {
  const segmentContainer = document.getElementById(containerID);
  const placeholderNode = document.getElementById(placeholderID);
  // 即使用户已离开主树，分离树仍应存在，因此这里预期两个节点都可找到。
  segmentContainer.parentNode.removeChild(segmentContainer);
  while (segmentContainer.firstChild) {
    placeholderNode.parentNode.insertBefore(
      segmentContainer.firstChild,
      placeholderNode,
    );
  }
  placeholderNode.parentNode.removeChild(placeholderNode);
}

/**
 * Fizz 为函数 action 输出的精确占位 URL，用于水合识别；必须与服务端编码保持同步。
 */
const EXPECTED_FORM_ACTION_URL =
  // eslint-disable-next-line no-script-url
  "javascript:throw new Error('React form unexpectedly submitted.')";

/**
 * 在 window 冒泡阶段接收函数表单提交，快照化 FormData 并按文档内顺序排队供水合重放。
 * 普通 URL action、已被更早监听器阻止的提交直接放行。
 */
export function listenToFormSubmissionsForReplaying() {
  // 队列按提交顺序保存记录。window 冒泡监听器晚于 React 在根容器/document 的处理；
  // React 已 preventDefault 时直接返回，尚未接管的占位 action 才进入重放队列。
  // eslint-disable-next-line no-restricted-globals
  addEventListener('submit', event => {
    if (event.defaultPrevented) {
      // 尊重更早监听器对提交的阻止。
      return;
    }
    const form = event.target;
    const submitter = event['submitter'];
    let action = form.action;
    let formDataSubmitter = submitter;
    if (submitter) {
      const submitterAction = submitter.getAttribute('formAction');
      if (submitterAction != null) {
        // submitter 的 formAction 覆盖表单 action。
        action = submitterAction;
        // 若覆盖值随后通过占位 URL 检查，它就是概念上无名称的函数 action，
        // 因而生成 FormData 时排除 submitter。
        formDataSubmitter = null;
      }
    }
    if (action !== EXPECTED_FORM_ACTION_URL) {
      // 普通表单 action 不参与 React 重放协议。
      return;
    }

    // 阻止原生导航，也避免页面上其他 React 实例重复接收。
    event.preventDefault();

    // 在事件发生时快照 FormData。
    const formData = new FormData(form, formDataSubmitter);

    // 排队供稍后重放。页面上多个 React 可共享此字段，因为前一个实例会对后一个实例
    // preventDefault；凡使用相同 javascript: 占位值的 React 版本都共享该协议，故数组
    // 可能已存在。队列挂在表单根节点这一共享环境上下文，以保存顺序并在水合时取回；
    // 没有ownerDocument时以表单自身承载共享队列字段。
    const root = form.ownerDocument || form;
    (root['$$reactFormReplay'] = root['$$reactFormReplay'] || []).push(
      form,
      submitter,
      formData,
    );
  });
}
