# Unraid 官方配色深浅主题

以本轮用户提供的完整需求为实施依据：对齐官方 WebGUI Black / White 色值，沿用现有移动端布局、AppSheet、路由及数据生命周期。默认 Dark，支持 Light / System，不扩展业务能力。

## 实现选择

采用根元素 `data-theme="dark|light"`、CSS 变量和 Tailwind v4 语义工具类；用 `useSyncExternalStore` 管理 `dark|light|system` 偏好。相比全局替换 Slate / Cyan 调色板，逐项按用途迁移可以保留品牌、状态、指标之间的区别；相比在 React 树内重建主题容器，根属性更新不会改变路由和订阅生命周期。

首屏脚本放在 head 内，在样式及 React 加载前读取 `unraid-mobile.theme`；仅接受三个合法值，异常回退 Dark。运行时统一更新根属性、`color-scheme`、theme-color；监听系统和 storage 事件。存储失效不影响本页切换。

AppHeader 外观按钮打开现有 AppSheet，以原生 radio 实现三个选项；选择后保持 Sheet 和焦点。头部操作在 320px 下采用紧凑的 44px 图标按钮，身份区域允许换行。

主题实际变化前通知 Tab 转场取消视觉效果，复用 `cancelVisual`，已提交导航继续。颜色直接更新，不新增主题动画，减少动画偏好下同样即时。

## 色彩与可读性

用户给定的七项基础映射保持原值。官方色值和派生色在 CSS 注释中区分。品牌文字浅色用 `#B83D14`；主按钮用 `#FF8C2F` 和 `#1D1B1B`。状态使用独立 token；图表和容量条使用指标 token。中性色边界、次要文字、状态 tint 及 stale 内容均按最终合成颜色计算对比度；不能用降低整体透明度牺牲正文可读性。

官方来源：

- https://github.com/unraid/webgui/blob/master/emhttp/plugins/dynamix/styles/default-color-palette.css
- https://github.com/unraid/webgui/blob/master/emhttp/plugins/dynamix/styles/themes/black.css
- https://github.com/unraid/webgui/blob/master/emhttp/plugins/dynamix/styles/themes/white.css

用途映射为本项目移动端适配，不代表官方完整组件规范。

## 验证

先补失败行为测试，覆盖默认/恢复/异常存储、System 跟随、显式选择隔离、跨标签同步、首屏脚本、认证/离线页面、Portal、焦点保留、缓存与 SSE 连续，以及原生和降级转场取消。迁移全部页面和状态；同步 Manifest、构建和镜像校验，保持现有图标。

执行 npm ci、npm test、npm run build、生产镜像构建与烟雾检查；浏览器检查两主题、320px、横屏、安全区。记录实际执行结果及未执行的 iPhone / Android 真机项目。
