/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import {requestPostPaintCallback} from './ReactFiberConfig';

/** 是否已有一次 HostConfig post-paint 回调在途，用于合并同帧请求。 */
let postPaintCallbackScheduled = false;
/** 等待下一次 paint 完成时间的回调队列。 */
let callbacks: Array<any | ((endTime: number) => void)> = [];

/**
 * 将性能记录等消费者合并到一个 HostConfig post-paint 请求。
 *
 * callback 接收宿主报告的 endTime；在请求完成前重复调用只追加到 callbacks，不再次请求宿主。
 * 遍历直接读取数组长度，回调中新加入的项也会在同一次 flush 执行；正常结束才清除在途标记和队列。
 * 此处没有 try/finally 或逐项异常隔离，某个回调抛错会中断后续调用与这次清理。
 */
export function schedulePostPaintCallback(callback: (endTime: number) => void) {
  callbacks.push(callback);
  if (!postPaintCallbackScheduled) {
    postPaintCallbackScheduled = true;
    requestPostPaintCallback(endTime => {
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i](endTime);
      }
      postPaintCallbackScheduled = false;
      callbacks = [];
    });
  }
}
