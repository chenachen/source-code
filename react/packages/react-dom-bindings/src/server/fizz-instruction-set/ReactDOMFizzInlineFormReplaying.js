import {listenToFormSubmissionsForReplaying} from './ReactDOMFizzInstructionSetShared';

// TODO：改为导出一个从 javascript URL 抛错的辅助函数。这里本就会修改全局且可保证
// 已加载，因此适合这样做；外部 runtime 异步加载又不暴露全局，可能仍需保留两种 URL。

listenToFormSubmissionsForReplaying();
