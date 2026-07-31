export default {
  pages: [
    // 主包：首屏 + 核心鉴权流程（必须随主包加载，保证启动速度）
    // v2.0.0 首屏为模式选择页：首次启动选择单机/联机，已选模式后自动重定向到对应流程
    'pages/mode-select/index',
    'pages/index/index',
    'pages/note/edit',
    'pages/setup/index',
    'pages/unlock/index',
    // v2.0.0 单机模式鉴权流程
    'pages/standalone-setup/index',
    'pages/standalone-unlock/index',
    'pages/standalone-recover/index',
  ],
  // 分包：非首屏的管理/分享类页面按业务域拆分，减小主包体积、加快首屏启动
  subPackages: [
    // 设置与数据管理类分包
    { root: 'pages/settings', name: 'settings', pages: ['index'] },
    { root: 'pages/folders', name: 'folders', pages: ['index'] },
    { root: 'pages/tags', name: 'tags', pages: ['index'] },
    { root: 'pages/trash', name: 'trash', pages: ['index'] },
    // 分享相关分包
    { root: 'pages/share', name: 'share', pages: ['index'] },
    { root: 'pages/share-mgr', name: 'share-mgr', pages: ['index'] },
  ],
  // 预下载规则：用户进入主页后预下载管理类分包，提升后续跳转体验
  // 分享类分包按需加载（仅在用户触发分享时下载）
  preloadRule: {
    'pages/index/index': {
      network: 'all',
      packages: ['settings', 'folders', 'tags', 'trash'],
    },
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'DustNote',
    navigationBarTextStyle: 'black',
  },
  // 网络请求超时配置（ms）：避免无 serverUrl 或服务端不可达时 UI 长时间无响应
  networkTimeout: {
    request: 15000,
    connectSocket: 15000,
    uploadFile: 30000,
    downloadFile: 30000,
  },
};
