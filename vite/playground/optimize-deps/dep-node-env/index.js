/** 根据 process.env.NODE_ENV 生成 prod/dev 标记，检验优化器的环境替换。 */
export const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
