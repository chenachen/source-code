import { publish } from '@vitejs/release-scripts'

// CI 发布入口交给公共发布脚本；默认选中 vite，并使用 pnpm 作为包管理器。
publish({ defaultPackage: 'vite', packageManager: 'pnpm' })
