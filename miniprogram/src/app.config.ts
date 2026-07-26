export default {
  pages: [
    // v2.0.0 首屏为模式选择页：首次启动选择单机/联机，已选模式后自动重定向到对应流程
    'pages/mode-select/index',
    'pages/index/index',
    'pages/note/edit',
    'pages/settings/index',
    'pages/share/index',
    'pages/share-mgr/index',
    'pages/setup/index',
    'pages/unlock/index',
    'pages/folders/index',
    'pages/tags/index',
    'pages/trash/index',
    // v2.0.0 单机模式鉴权流程
    'pages/standalone-setup/index',
    'pages/standalone-unlock/index',
    'pages/standalone-recover/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'DustNote',
    navigationBarTextStyle: 'black',
  },
};
