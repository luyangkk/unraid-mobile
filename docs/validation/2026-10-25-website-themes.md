# 官网主题与按钮渐变验收

本轮按用户最新要求复刻 `unraid.net` 风格：深色黑灰、浅色暖米色，红橙渐变品牌文字与 Tab 标记，主按钮渐变填充，次按钮胶囊描边及 hover 流动填充。本验收阶段改动留在 `feat/unraid-official-themes` 工作区；用户随后另行授权提交、推送并手动发布开发分支，发布结果另行记录，不部署 Unraid 主机。

## 源码依据

官网 CSS：

https://cdn.craft.cloud/481d40bf-939a-4dc1-918d-b4d4b48b7c04/builds/a3092966-547f-4c09-b480-f53e45c711b7/artifacts/dist/main-2hqxuWge.css

官网将内容分为 `onDark`、`onBright`、`onColor`，没有用户深浅主题开关。本项目将这些分区映射到现有 Dark / Light / System 外观，不宣称是官网完整组件规范。

| 用途 | Dark | Light |
| --- | --- | --- |
| 页面 | `#171717` | `#F1ECE3` |
| 卡片和 Sheet | `#2B2A29` | `#FFFFFF` |
| 内层 | `#333231`，移动端适配 | `#EEE4D2` |
| 主文字 | `#FFFFFF` | `#171717` |
| 品牌文字 | `#FF8C2F` | `#F15A2C` |
| 渐变 | `#E22828 → #FF8C2F` | 同左 |

官网 `.btn-gradient` 默认白字、4px 圆角，hover/focus 变黑字并流动；`.btn-pill-*` 默认 2px 渐变描边，hover 后渐变填充以 300ms 淡入。流动使用四段红／橙／红／橙，`background-size: 300% 100%`，4 秒线性无限循环，位置从 `100% 100%` 移至 `0% 100%`。

项目保持 44px 触摸高度和已有图标尺寸。连续流动仅由精细指针 hover 触发；键盘焦点显示静态渐变及焦点环，触屏和 reduced-motion 不连续流动，禁用控件保持中性反馈。

Chrome 实际打开了用户已登录的 `http://10.0.0.66/Main`，标题为 `Tower/Main`。直接读取当前 `white.css?v=1743784653`、`default-color-palette.css?v=1743784653` 和 `default-base.css?v=1743784653`：White 页面为 `#F2F2F2`，品牌红／橙也为 `#E22828`／`#FF8C2F`，按钮使用渐变描边、4px 圆角及 hover 渐变填充。只读样式，没有触发主机按钮、操作或设置变更。7.1.0 版本为用户提供信息，本轮未额外读取版本接口。

## 对比度限制的位置与取消方式

此前门槛来自用户上一轮明确要求，并非工具或平台限制。

- `web/src/lib/palette.test.ts` 原先计算 WCAG 相对亮度，断言正文至少 4.5:1、控件／焦点／指标至少 3:1。已删除这些数值门槛与计算辅助函数，改为官网色值、渐变与组件语义测试。
- `web/src/styles.css` 原先使用 `#B83D14` 等对比度派生色，第一版草稿又将主按钮字色固定为黑色。已改为官网字色，浅色品牌文字为 `#F15A2C`，主按钮默认白字、hover/focus 黑字。
- `AGENTS.md` 已写明用户取消数值对比度限制，配色以官网风格为准，仍保留可读标签、键盘焦点和禁用反馈。
- `docs/superpowers/specs/2026-10-25-official-themes-design.md` 和对应旧计划保留历史需求，已在开头标注被新方案取代，不再约束配色。当前官网方案和计划也已同步。

## 实际验证

- `npm ci` 完成，锁文件和依赖版本未修改。
- TDD：更新官网字色和按钮形状预期后，观察到 3 项预期失败，再修改实现使其通过。
- 完整前端测试：27 个测试文件、399 项测试通过。
- `npm run build` 通过，含 TypeScript、Vite 和 PWA 检查；12 项静态预缓存、离线路由、API 只走网络、旧 chunk 迁移及用户确认更新检查通过。
- Chrome 155 / Playwright 1.64.1：两种主题按钮专项 26 条断言通过，验证实际背景位置变化、4 秒线性循环、字色、描边／填充、焦点、禁用、触屏和减少动画。
- 两种主题的四个页面、320px 头部、横屏 Sheet、磁盘详情、认证／连接失败页面、主题切换时单一 SSE 和已提交导航均通过浏览器检查。
- 最终生产 Chrome 回归：10 项检查、73 条断言全部通过，无浏览器错误；额外覆盖底部导航中断、双方向降级转场、动态减少动画及刷新数据不重播入场动画。详细证据见 [浏览器记录](2026-10-25-website-themes/browser-results.json)。
- 独立只读代码审查未发现实质问题；`git diff --check` 和部署 XML 解析通过。

截图：[深色](2026-10-25-website-themes/dark-secondary-flow.png)、[浅色](2026-10-25-website-themes/light-secondary-flow.png)、[主按钮](2026-10-25-website-themes/dark-primary-flow.png)。

## 验证边界

Chrome 中真实 Service Worker 安装专项停留在 `installing`，没有获得 controller，不能宣称本轮真实 worker 更新和离线冷启动通过。诊断看到 worker 请求 12 项静态资源，其中部分返回 200，其余未完成；独立测试端口和连接关闭策略未解决。本轮没有修改 worker 源码，不把构建内的模拟缓存检查当作这项浏览器实测。

未运行 Go 测试（未修改 Go）、Docker 镜像构建／烟雾检查（本机无 Docker）、Android／iOS 真机安装与手势验收。Chrome 使用合成 API 数据，不能替代真实 Unraid 数据采集验证。
