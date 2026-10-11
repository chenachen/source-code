self.postMessage({
  type: 'deeplyNestedSecondWorker',
  data: [
    'Hello from second level nested worker',
    import.meta.env.BASE_URL,
    self.location.url,
    import.meta.url,
  ].join(' '),
})

/** 第二层创建的第三层 module worker，监听其消息并继续向上一层转发。 */
const deeplyNestedThirdWorker = new Worker(
  new URL('deeply-nested-third-worker.js', import.meta.url),
  { type: 'module' },
)
deeplyNestedThirdWorker.addEventListener('message', (ev) => {
  self.postMessage(ev.data)
})

console.log('deeply-nested-second-worker.js')
