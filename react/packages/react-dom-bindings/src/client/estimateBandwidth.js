/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 按 initiatorType 筛选图片、脚本、样式等可用于带宽估算的静态资源。 */
function isLikelyStaticResource(initiatorType: string) {
  switch (initiatorType) {
    case 'css':
    case 'script':
    case 'font':
    case 'img':
    case 'image':
    case 'input':
    case 'link':
      return true;
    default:
      return false;
  }
}

/** 用 Performance 条目中的非缓存静态资源及重叠传输量估算 Mbps；不足时取 navigator.connection.downlink，再回退 5 Mbps。 */
export default function estimateBandwidth(): number {
  // 用已有资源下载记录估算吞吐量；不读取动态请求作为样本。
  // $FlowFixMe[method-unbinding]
  if (typeof performance.getEntriesByType === 'function') {
    let count = 0;
    let bits = 0;
    const resourceEntries = performance.getEntriesByType('resource');
    for (let i = 0; i < resourceEntries.length; i++) {
      const entry = resourceEntries[i];
      // $FlowFixMe[prop-missing]
      const transferSize: number = entry.transferSize;
      // $FlowFixMe[prop-missing]
      const initiatorType: string = entry.initiatorType;
      const duration = entry.duration;
      if (
        !transferSize ||
        !duration ||
        !isLikelyStaticResource(initiatorType)
      ) {
        // transferSize 为零（缓存命中或跨源未暴露大小）、耗时为零或类型不在静态资源名单时不取样。
        continue;
      }
      // 并行下载共享带宽，把时间窗口重叠的资源按覆盖比例计入字节总量。
      let overlappingBytes = 0;
      // $FlowFixMe[prop-missing]
      const parentEndTime: number = entry.responseEnd;
      let j;
      for (j = i + 1; j < resourceEntries.length; j++) {
        const overlapEntry = resourceEntries[j];
        const overlapStartTime = overlapEntry.startTime;
        if (overlapStartTime > parentEndTime) {
          break;
        }
        // $FlowFixMe[prop-missing]
        const overlapTransferSize: number = overlapEntry.transferSize;
        // $FlowFixMe[prop-missing]
        const overlapInitiatorType: string = overlapEntry.initiatorType;
        if (
          !overlapTransferSize ||
          !isLikelyStaticResource(overlapInitiatorType)
        ) {
          // 重叠资源仍须有可见传输字节且属于静态资源名单，才计入这一下载窗口。
          continue;
        }
        // $FlowFixMe[prop-missing]
        const overlapEndTime: number = overlapEntry.responseEnd;
        const overlapFactor =
          overlapEndTime < parentEndTime
            ? 1
            : (parentEndTime - overlapStartTime) /
              (overlapEndTime - overlapStartTime);
        overlappingBytes += overlapTransferSize * overlapFactor;
      }
      // 重叠条目已计入这一组，后续从下一组开始，避免重复计算。
      i = j - 1;

      const bps =
        ((transferSize + overlappingBytes) * 8) / (entry.duration / 1000);
      bits += bps;
      count++;
      if (count > 10) {
        // 最多采用 11 组窗口的平均值，避免遍历全部历史资源。
        break;
      }
    }
    if (count > 0) {
      return bits / count / 1e6;
    }
  }

  //如果可用，则回退到 navigator.connection 的估算
  // $FlowFixMe[prop-missing]
  if (navigator.connection) {
    // $FlowFixMe[incompatible-use]
    const downlink: ?number = navigator.connection.downlink;
    if (typeof downlink === 'number') {
      return downlink;
    }
  }

  // 没有可用条目或 Network Information 估算时，使用 5 Mbps 的启发式默认值。
  return 5;
}
