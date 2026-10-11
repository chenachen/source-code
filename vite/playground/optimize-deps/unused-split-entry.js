import msg from '@vitejs/test-added-in-entries'

// 此入口由 optimizeDeps.entries 显式追加，冷启动扫描即发现其中依赖。
// 它模拟首屏未访问的常用拆分入口，让后续访问不必再发现缺失依赖。

console.log(msg)
