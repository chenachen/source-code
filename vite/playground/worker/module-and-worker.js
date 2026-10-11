import constant from './modules/module0'

self.postMessage(constant)

/** 作为普通模块角色消费的导出标记；同文件在worker角色还会直接postMessage基础常量。 */
export const module = 'module and worker'

// 为 source map 检查保留可定位的日志语句。
console.log('module-and-worker.js')
