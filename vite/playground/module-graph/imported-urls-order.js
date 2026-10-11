import { msg } from 'virtual:slow-module'
import './empty.js'

export default msg

// 两个导入可并行处理，虚拟模块加载故意较慢；importedModules 仍须保持源码导入顺序。
