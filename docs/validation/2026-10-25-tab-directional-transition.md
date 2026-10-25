# Tab 方向转场验收记录

日期：2026-10-25。分支：`feat/tab-directional-transition`。

已实现有效横滑松手后的方向转场。原生路径显示旧页退出和新页进入，降级路径使用单页方向入场。始终保留一个真实 Outlet，手势阈值、业务轮询和 System SSE 的职责未变。iPhone Safari 和安装后的 PWA 尚未经过真机验收。

## 实现范围

- `useTabTransition.ts` 管理事务、原生句柄、单次导航、公开 `onRendered` 提交确认及中断清理。普通 Link、键盘激活和 History 导航沿用 Router 语义。
- `useTabSwipe.ts` 只提交横滑请求并查询 busy 状态，保留既有方向识别、距离、速度、边缘保护和兼容点击抑制。
- AppShell 保留稳定的 main、单个 Outlet、短页空白和底部间距。独立内容层负责动画，顶栏与底栏不横移。
- 原生旧页为 32px、180ms，新页为 32px、240ms；Motion 降级为 220ms。缓动与 350ms 捕获预算统一放在 `lib/motion.ts`。
- 四个页面通过布局阶段的 `useTabPageEntry` 设置降级起点，避免先显示完整新页、再跳回起点。此 Hook 不增加数据请求或观察者。
- 内容快照保持各自比例，裁切范围包含新旧内容的可见并集，并限制在底部导航上方。几何变化只淡入，超时或后台中断后不补播。

任务文稿标注的源码基线为 `5ff6f97`；实际开发分支起点为 `4e4e709f59c144744df8460f0d94c560b865fff1`，相关转场源码一致。本轮未修改 Go、部署配置或依赖清单。

## 自动化结果

| 检查 | 实际结果 |
| --- | --- |
| `npm ci` | 成功；未升级依赖 |
| `npm test` | 22 个测试文件、359 项通过，其中新控制器 35 项 |
| `npm run build` | TypeScript、Vite 生产构建及 PWA 构建检查通过 |
| `git diff --check` | 通过 |
| 生产构建浏览器验收 | 19 项检查、102 条断言通过；浏览器错误为零 |

测试覆盖六个相邻方向、端点、同路由、忙时忽略、单次导航、原生 API／CSS 缺失、同步抛错、ready 提前或延后失败、350ms 超时、真实懒加载、重定向、替代导航、路由错误，以及 Sheet、401、退出、卸载、后台、动态 reduced-motion 和几何变化后的清理。

既有 App 测试继续检查单一 SSE、当前页面观察者、两秒／三秒轮询、后台恢复、旧样本、空白区域手势与底部点击。这些结果使用合成数据，不能作为真实 Unraid 主机验证。

## 生产浏览器证据

主线程最终复跑成功，运行时间为 `2026-10-25T08:22:50.439Z` 至 `2026-10-25T08:23:11.933Z`。环境为 Chrome `155.0.8059.86`、Node `v24.2.0`、Playwright `1.64.1`，预览地址为 `http://127.0.0.1:18183`。浏览器使用生产 Vite 产物，REST 与单一长连接 SSE 来自合成数据。

本轮构建首页的 SHA-256 为 `820623bc924cbe186ca2723436cd79eb0d4c530a79bee1187a77f78470c1c5d9`，与浏览器报告记录一致。

| 实测范围 | 证据与结论 |
| --- | --- |
| 六个相邻方向 | 真实 old/new 伪元素同时存在，中间帧位移符号正确；各方向只有一个 main 和一个真实内容层 |
| 原生与 Motion 互斥 | 原生中间帧的真实内容层保持 `x=0`、`opacity=1` |
| 新旧画面不同 | 隔离 old/new 后保存真实截图；结合导航前后页面文本核对，而非仅凭像素哈希判断内容 |
| 长短页与底栏裁切 | 快照按自身高度显示，group 不做尺寸动画；裁切包含新旧可见并集，底栏保持可点击 |
| 慢 chunk | 从捕获至跳过实测约 `352.9ms`；pending 可见，chunk 恢复后只有一次导航，不补播过期动画 |
| 降级首帧 | 前进与后退均有真实 transform／opacity 中间帧；首次目标画面已设置入场起点 |
| 中断与数据更新 | 忙时滑动不排队，底栏点击可打断；SSE、REST 刷新和展开 details 不重播 |
| 视口与手势区域 | 320px 无横向溢出；短 VM 空白、Storage 底部间距可滑动；连续旋转与滚动恢复只淡入，超时后旋转仍不补播 |
| 减少动画与端点 | 动态 reduced-motion 立即清理且仍可横滑；端点和同 Tab 激活不增加 History 或播放动画 |

[完整结果](2026-10-25-tab-directional-transition/results.json)保存逐帧记录、断言、版本和构建指纹。另附[浏览器报告](2026-10-25-tab-directional-transition/report.md)、[Home → Docker 中间帧](2026-10-25-tab-directional-transition/native-home-docker-mid-90ms.png)、[旧页隔离截图](2026-10-25-tab-directional-transition/native-home-docker-old-only.png)、[新页隔离截图](2026-10-25-tab-directional-transition/native-home-docker-new-only.png)和[超时后的 pending](2026-10-25-tab-directional-transition/slow-chunk-pending-after-budget.png)。其余五个方向的中间帧也保存在同一目录。

原生中间帧先按正常时间线采样，再暂停既有伪元素动画用于截图；没有创建第二份业务路由。首轮脚本的序列化、手势命中和等待错误已修正；本节仅引用最终通过的运行。

## 独立审查与修复

独立审查发现两项 Important 问题，均先补测试复现，再修复：

| 问题 | 失败证据 | 修复 |
| --- | --- | --- |
| 短页裁切底边沿用到长页 | 目标提交后仍为 `208px`，应为 `88px` | 目标提交时重算新旧内容的裁切并集 |
| pending 中连续尺寸事件或中断丢失动画策略 | geometry、deadline、hidden、Sheet 四个用例出现残余 `translateX` | 尺寸事件处理保持幂等；中断后的禁止入场决定保留至原导航完成或被替代 |

新增五项回归测试在修复前全部失败，修复后通过。[原始审查报告](2026-10-25-tab-directional-transition/independent-review.md)来自独立代理；上述修复由主线程完成并测试。修复后的独立复核任务被终止，没有复核结论，不能写成“独立复审通过”。两项修复另经最终浏览器的裁切、连续旋转、超时后旋转检查验证。

生产浏览器还复现了 Motion 首帧闪回。原先在 `onRendered` 后设置起点，真实目标页可能已经绘制一帧。现改为页面布局阶段同步设置 DOM 起点，Motion 继续驱动后续帧；公开 Router 事件仍用于确认提交，不用延时或 URL 推测完成。

## 复跑方法

在 `web` 目录构建并启动静态预览：

```sh
npm ci
npm test
npm run build
npm exec vite preview -- --host 127.0.0.1 --port 18183 --strictPort
```

另一个终端从仓库根目录运行：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHECK_BASE_URL=http://127.0.0.1:18183 \
node web/scripts/verify-tab-transition.mjs
```

脚本使用桌面 Chrome 和合成 REST／SSE 数据，证据写入 `/tmp/unraid-tab-transition-browser`。Playwright 未加入项目依赖；需提供本机可用模块路径。脚本采样真实浏览器伪元素和 Motion 中间帧，不以 `animate()` 调用次数作为视觉通过条件。

## 未验证项

- iPhone Safari，优先验证任务指定的 iOS 27.0.1，记录设备、首次或重复加载、网络状态。
- 安装后的 iOS／Android PWA，分别检查左右切页、慢加载、更新后重启、旋转和底部安全区。
- Chrome 真实切后台再恢复的逐帧验收未完成；自动化环境始终报告 visible。对应状态清理与 pending 后恢复由 jsdom 回归覆盖，真机仍需验证。
- 本轮未连接或修改 Unraid 主机，未运行 Go 测试、Go 构建、镜像构建或镜像烟雾检查。
- 未提交、推送、合并或发布；实现保留在本地开发分支。
