# Unraid 官方深浅主题验收记录

日期：2026-10-25。分支：`feat/unraid-official-themes`。改动尚未提交、合并或发布。

已实现 Dark / Light / System 外观及全应用语义配色迁移。399 项前端测试、生产构建、两套主题的浏览器回归和真实 Service Worker 更新／离线应用壳检查通过。生产镜像验证受本机缺少 Docker 阻挡；iPhone、Android 和真实 Unraid 主机未验收。

## 配色依据

固定使用官方 `unraid/webgui` 提交 `26eb1b5c1d547ddbf44a38e63956ba24f659098b`：

- [基础色板](https://github.com/unraid/webgui/blob/26eb1b5c1d547ddbf44a38e63956ba24f659098b/emhttp/plugins/dynamix/styles/default-color-palette.css)
- [Black 主题](https://github.com/unraid/webgui/blob/26eb1b5c1d547ddbf44a38e63956ba24f659098b/emhttp/plugins/dynamix/styles/themes/black.css)
- [White 主题](https://github.com/unraid/webgui/blob/26eb1b5c1d547ddbf44a38e63956ba24f659098b/emhttp/plugins/dynamix/styles/themes/white.css)

页面、表面、主文字和品牌基础色保留用户要求的官方原值。浅色品牌文字 `#B83D14` 及其余语义角色为本项目的可读性适配，CSS 注释明确区分；用途映射不代表官方完整组件规范。未覆盖 Tailwind 的原始 Slate / Cyan 色板。

## 最终 token

| Token | Dark | Light |
| --- | --- | --- |
| `background` | `#1D1B1B` | `#F2F2F2` |
| `foreground` | `#F2F2F2` | `#1D1B1B` |
| `surface` | `#262626` | `#FFFFFF` |
| `surface-muted` | `#303030` | `#F7F9F9` |
| `border` | `#505050` | `#D3D3D3` |
| `text-muted` | `#B8B8B8` | `#595959` |
| `brand` | `#FF8C2F` | `#FF8C2F` |
| `brand-hover` / `deeporange` | `#F15A2C` | `#F15A2C` |
| `brand-foreground` | `#1D1B1B` | `#1D1B1B` |
| `brand-text` | `#FF8C2F` | `#B83D14` |
| `focus-ring` | `#FF8C2F` | `#B83D14` |
| `success` | `#83D66B` | `#2E6417` |
| `warning` | `#FFCC66` | `#805000` |
| `danger` | `#FF9E9E` | `#B42318` |
| `info` | `#93C5FD` | `#275DA8` |
| `chart-line` | `#D3D3D3` | `#404040` |
| `progress-fill` | `#B8B8B8` | `#595959` |
| `progress-track` | `#404040` | `#D3D3D3` |
| `control-border` | `#909090` | `#737373` |
| `surface-hover` | `#383838` | `#E8E8E8` |
| `brand-selected` | `#35271D` | `#FCE9DE` |
| `status-tint` | `#FFCC66` | `#805000` |
| `overlay` | `#000000` | `#000000` |
| `stale-foreground` | `#C8C8C8` | `#4D4D4D` |
| `stale-text-muted` | `#ACACAC` | `#595959` |

主按钮为品牌橙底、深色字，选中 Tab、链接和焦点使用品牌语义。成功、警告、错误、信息有独立 token，并保留文字／图标含义。CPU 趋势和容量条使用中性指标色，不表示健康状态。

`border` 用于装饰性分隔；输入框、按钮和外观单选项的必要边界使用 `control-border` 或具有足够对比度的品牌边界。旧样本保留既有 `.opacity-60` 标记，但仅在页面／Sheet 内容范围内取消整体淡化，改用 `stale-*` 文字色；状态、SVG、容量条保持不透明。

## 对比度

测试读取实际 CSS token，按 WCAG sRGB 相对亮度计算。下表取页面、卡片、内层、悬停、选中表面及实际 60% 内层背景、5% 状态背景合成后的最小值；不是仅对纯白／纯黑计算。

| 用途 | Dark 最低值 | Light 最低值 | 标准 |
| --- | --- | --- | --- |
| 主文字 | 10.47:1 | 13.99:1 | ≥4.5:1 |
| 次要文字 | 5.91:1 | 5.72:1 | ≥4.5:1 |
| 品牌文字 | 5.05:1 | 4.61:1 | ≥4.5:1 |
| 成功 | 6.59:1 | 5.81:1 | ≥4.5:1 |
| 警告 | 7.86:1 | 5.59:1 | ≥4.5:1 |
| 错误 | 5.94:1 | 5.37:1 | ≥4.5:1 |
| 信息 | 6.50:1 | 5.33:1 | ≥4.5:1 |
| 旧样本主文字 | 7.01:1 | 6.90:1 | ≥4.5:1 |
| 旧样本次要文字 | 5.16:1 | 5.72:1 | ≥4.5:1 |
| 必要控件边界 | 3.67:1 | 3.87:1 | ≥3:1 |
| 焦点指示 | 5.05:1 | 4.61:1 | ≥3:1 |
| 趋势线 | 7.83:1 | 8.46:1 | ≥3:1 |
| 容量填充与轨道 | 5.23:1 | 4.68:1 | ≥3:1 |

两主题的按钮文字对品牌橙为 7.38:1，对悬停深橙为 5.09:1。浅色派生品牌字在白底为约 5.65:1；品牌橙和深橙不直接用于浅色普通小字。

颜色切换会同步结束颜色相关 CSS Transition，避免前景／背景同时插值时出现短暂低对比。普通悬停与 Tab 活跃反馈继续沿用原有时长，Motion 和原生转场由各自控制器管理。

## 外观与生命周期

- 默认 Dark，仅保存 `unraid-mobile.theme=dark|light|system`；无效值回退 Dark，读取或写入失败仍可在本页选择。
- System 独立监听 `prefers-color-scheme`，显式 Dark / Light 不受系统变化影响；监听跨标签页 storage 更新和清空。
- head 脚本在 CSS／React 加载前应用根属性、`color-scheme` 和 `theme-color`；运行时常驻订阅覆盖认证、连接失败和 PWA 提示。
- 首次订阅重新核对存储和系统状态，覆盖 render 到订阅建立之间的变化；持久化失败不覆盖本页选择。
- AppHeader 使用 44px 外观、退出和刷新按钮，320px 下保留身份区域。原生单选组支持键盘切换、焦点和可读标签。
- 主题切换保持当前路由、main、Sheet Portal、单选焦点、折叠偏好、Query Cache、CPU 趋势及同一条 System SSE；不额外发业务请求。
- 主题实际变化前取消旧主题 Tab 快照和 Motion 视觉，已提交导航继续；System 与 reduced-motion 使用独立媒体查询。
- Sheet 保留滚动、焦点返回和原有手势；从 label 文字开始的右划不再被识别为关闭。
- 页面 theme-color 使用实际深浅背景。Manifest 静态启动色为 `#1D1B1B`；本地图标、静态预缓存和更新确认机制保持原有实现。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 通过，未升级依赖 |
| `npm test` | 26 个测试文件、399 项通过 |
| `npm run build` | TypeScript、Vite、PWA 构建及 12 个静态预缓存项校验通过 |
| 深色完整浏览器回归 | 21 项检查、126 条断言通过，浏览器错误为零 |
| 浅色完整浏览器回归 | 22 项检查、129 条断言通过，包含 OS 换色中断原生快照 |
| 最终外观专项复跑 | 3 项检查、27 条断言通过 |
| 真实 Service Worker 专项 | 深浅主题合计 8 条断言通过 |
| 独立代码复审 | 已处理初次发现的问题；最终复审无明确 Critical / Important 问题 |
| `git diff --check` | 通过 |
| `docker build -t unraid-mobile:local .` | 未通过，exit 127：`docker: command not found` |
| `sh scripts/verify-image.sh unraid-mobile:local` | 未通过，exit 127：`docker: command not found` |

前端测试新增 40 项，覆盖首屏、偏好恢复、存储异常、系统变化、跨标签页、初始化竞态、Portal／焦点、认证／离线、单一 SSE／缓存、原生和 Motion 转场中断、label 手势及 token 对比度。相关行为先观察失败再修复。

最终测试有既有 hidden-policy 用例的 React `act` 提示；构建仍有既有主 chunk 大于 500KB 的提示。`npm ci` 报告 5 项既有依赖审计问题，本次未扩大范围升级依赖。

浏览器环境：Chrome `155.0.8059.86`、Playwright `1.64.1`、Node `v24.2.0`。使用当前生产构建，首页 SHA-256 为 `468cdba7a24e67d5619a8c51fa192de79cf8332416478a68dc554036191d73fe`。

本地 `127.0.0.1:18189` 验收服务返回真实静态产物和合成 API／SSE。主页面回归阻止 Service Worker 干扰，以 CDP 发送真实触摸输入；PWA 专项允许真实 worker、Cache Storage 和离线网络。更新仅追加临时 worker 注释，不改生产 worker。

PWA 实测确认等待更新提示的两套表面／控件尺寸；Dismiss 保留 waiting worker 且不导航；Refresh 激活后只刷新一次并恢复主题；离线新页面 `/storage` 加载应用壳和连接失败提示，缓存中没有 API 或 health。最初临时服务器与等待条件导致验收失败，调整验收服务和等待逻辑后通过；此过程未修改生产缓存策略。

## 可复查证据

- [深色完整结果](2026-10-25-official-themes/theme-dark-results.json)、[浅色完整结果](2026-10-25-official-themes/theme-light-results.json)、[最终外观结果](2026-10-25-official-themes/theme-final-appearance-results.json)。
- [真实 PWA 结果](2026-10-25-official-themes/theme-pwa-results.json)、[测试输出](2026-10-25-official-themes/unraid-official-themes-tests.log)、[构建输出](2026-10-25-official-themes/unraid-official-themes-build.log)。
- 深色四页：[Home](2026-10-25-official-themes/appearance-dark-home-page.png)、[Docker](2026-10-25-official-themes/appearance-dark-docker-page.png)、[VM](2026-10-25-official-themes/appearance-dark-vm-page.png)、[Storage](2026-10-25-official-themes/appearance-dark-storage-page.png)。
- 浅色四页：[Home](2026-10-25-official-themes/appearance-light-home-page.png)、[Docker](2026-10-25-official-themes/appearance-light-docker-page.png)、[VM](2026-10-25-official-themes/appearance-light-vm-page.png)、[Storage](2026-10-25-official-themes/appearance-light-storage-page.png)。
- 外观面板：[深色](2026-10-25-official-themes/appearance-dark-appearance-sheet.png)、[浅色](2026-10-25-official-themes/appearance-light-appearance-sheet.png)；磁盘详情：[深色](2026-10-25-official-themes/appearance-dark-disk-detail.png)、[浅色](2026-10-25-official-themes/appearance-light-disk-detail.png)。
- 认证：[深色](2026-10-25-official-themes/appearance-session-dark-auth.png)、[浅色](2026-10-25-official-themes/appearance-session-light-auth.png)；更新：[深色](2026-10-25-official-themes/appearance-pwa-dark-waiting-update.png)、[浅色](2026-10-25-official-themes/appearance-pwa-light-waiting-update.png)。
- 离线冷启动：[深色](2026-10-25-official-themes/appearance-pwa-dark-offline-cold-storage.png)、[浅色](2026-10-25-official-themes/appearance-pwa-light-offline-cold-storage.png)。

浏览器脚本可通过 `CHECK_THEME=dark|light` 选择回归主题，`CHECK_ONLY=appearance,appearance-session,appearance-transition` 执行外观专项；真实 worker 检查使用 `CHECK_ONLY=appearance-pwa CHECK_PWA=1`，需要本地服务提供仅供测试的 `/__test/new-worker`。不得在真实 Unraid 服务上调用该测试接口。

## 未完成的外部验收

生产镜像构建和烟雾检查必须在具备 Docker 的环境补跑，本次不宣称镜像已验证。

已实测 320px 与 844×390 横屏无横向溢出、头部三个按钮均为 44px、Sheet 在视口内滚动。桌面 Chrome 不提供真实 iPhone／Android 安全区、安装状态和后台生命周期；仍需真机检查安装、首屏、系统换色、横屏、安全区、离线冷启动、更新确认和后台恢复。未连接、部署或操作真实 Unraid 主机。
