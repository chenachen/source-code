/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** `isLikelyStaticResource` 判断适用条件并返回布尔结果，不写入宿主状态；用于依据 PerformanceResourceTiming 估算当前网络吞吐量。 */
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

/** `estimateBandwidth` 查询并返回所需值；缺失或不适用时走显式回退；用于依据 PerformanceResourceTiming 估算当前网络吞吐量。 */
export default function estimateBandwidth(): number {
  //在已知资源的情况下，估算当前下载静态资源的带宽
  //已加载。
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
        //跳过缓存的、跨源的条目以及可能动态生成的资源。
        continue;
      }
      //查找任何同时正在传输的重叠条目，因为总数
      //当时的 bps 将包括那些字节。
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
          //跳过缓存的、跨源的条目以及可能动态生成的资源。
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
      //跳过我们已经认为重叠的任何条目。否则我们就得继续
      //回去考虑我们当时处理的先前条目。
      i = j - 1;

      const bps =
        ((transferSize + overlappingBytes) * 8) / (entry.duration / 1000);
      bits += bps;
      count++;
      if (count > 10) {
        //我们有足够的东西来得到一个平均值。
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

  //否则，使用默认的 5mbps 来计算启发式方法。
  //如果所有静态资源和图片都被加载，这种情况在 Safari 中很常见
  //跨源
  return 5;
}
