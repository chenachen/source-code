import type { Config } from 'tailwindcss'

export default {
  content: [
    // components/views glob 与 main.js 单文件项保持不重叠，分别覆盖两种内容监听方式。
    // https://github.com/vitejs/vite/pull/6959
    import.meta.dirname + '/src/{components,views}/**/*.js',
    import.meta.dirname + '/src/main.js',
    import.meta.dirname + '/index.html',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
