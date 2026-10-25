# Tab 方向转场 whole-branch 独立代码审查

日期：2026-10-25。结论：**With fixes，暂不建议合并。Critical 0，Important 2，Minor 0。**

## 审查范围与证据

- 已读取指定 `requesting-code-review/code-reviewer.md`、完整 `/tmp/unraid-tab-transition-review-package.md`、任务 spec、实施计划和 progress ledger。
- 范围是材料中相对 `4e4e709f59c144744df8460f0d94c560b865fff1` 的全部 tracked diff，以及 `useTabTransition.ts`、`useTabTransition.test.tsx` 两个新文件全量；同时读取当前源码和相关 Router、Motion、认证实现核对调用契约。不是仅审查最后一次修改。
- 本次仅读取，没有修改源码、工作树、索引或分支，没有运行测试或构建，没有派子代理。唯一写入是本报告。
- 已读取 `/tmp/tab-transition-suite.log`：日志记录 22 个测试文件、354 项通过，其中 controller 30 项、App 84 项。这是主线程既有运行结果，不是本次重新验证。
- 生产/PWA 构建通过来自 ledger 和主线程说明。最小真实 Router spike 报告已读取，但它使用临时实现，不能替代当前完整控制器验收。

## Findings

### Important 1：短页的旧裁切底边被沿用到长页，新内容底部在动画结束时突然出现

位置：

- [useTabTransition.ts:157-169](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/app/useTabTransition.ts#L157-L169)
- [useTabTransition.ts:199-205](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/app/useTabTransition.ts#L199-L205)
- [styles.css:32-34](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/styles.css#L32-L34)
- [AppShell.tsx:34-48](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/app/AppShell.tsx#L34-L48)

触发：页面顶部、视口不变，从内容较短的 VM 横滑到较长的 Storage；新页内容延伸至底部导航上方。

`mark()` 仅在旧页捕获前运行，裁切底边取 `min(旧 content.bottom, nav.top, viewport.bottom)`。短页的 content 填充 main，但不包含 main 的 `pb-8`，因此旧底边会比导航顶边高 32 CSS px。目标提交后只比较 top、left、width、scroll、viewport，允许高度不同，却没有重新计算裁切范围。长页新快照于是继续被旧短页底边裁掉。

用户影响：导航上方本应可见的一段新内容，在最多 240ms 的转场期间缺失，移除转场标记后突然出现。不是快照比例被压缩，也不是底栏被覆盖，而是长短页切换的裁切范围错误；不符合新旧图像按自身尺寸显示、内容自然结束的要求。

最小修正：稳定的外层裁切边界不要使用旧图像的自然底边作为新图像上限；或者在确认目标几何后，将新旧内容的可见范围共同纳入计算，再限制到视口和导航上方。保留各图像自身比例和现有页面滚动模型即可。

证据性质：源码和现有 flex/padding 布局可直接推出；本次未采样浏览器画面。当前 jsdom 桩给所有页面相同 `bottom`，不能覆盖这个场景。

### Important 2：视觉中断丢失尚未提交导航的策略，重复尺寸事件恢复位移，后台恢复后补播

位置：

- [useTabTransition.ts:102-112](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/app/useTabTransition.ts#L102-L112)
- [useTabTransition.ts:144-154](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/app/useTabTransition.ts#L144-L154)
- [useTabTransition.ts:270-290](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/app/useTabTransition.ts#L270-L290)
- [useTabTransition.ts:302-306](file:///Users/bytedance/Work/feWorkspace/unraid-mobile/web/src/app/useTabTransition.ts#L302-L306)

触发 A：Docker → VM 的 loader/chunk 尚未完成，先后收到 `window.resize` 和 `visualViewport.resize`，或者一次旋转中的多个尺寸事件。

第一次 `resized()` 调用 `skip(..., true, "geometry")`，将事务改为 `kind="motion"`、`fallbackDirection=0`。第二次事件因 kind 已非 native 而进入 `cancel()`，删除 current、解绑目标 render waiter。原 Router 导航继续；目标提交时，全局 `onRendered` 因 current 为空，将它当普通导航，用 `Math.sign(to-from)` 播放 32px 位移。第一次正确保存的淡入降级决定已经丢失。

触发 B：同一慢导航已按 350ms 预算跳过，随后在提交前发生 resize。deadline 将 kind 改成 none，resize 再次进入 cancel；最终提交被全局监听补播方向入场。

触发 C：已提交 Router 请求但目标未渲染时切后台，hidden 同步 cancel；在 chunk/loader 完成前回前台。最终 `onRendered` 时 document 已可见且 current 为空，同样补播被中断的滑动效果。

用户影响：旋转/连续尺寸事件后的页面仍横移，违背“几何变化只淡入”；超时或后台恢复后又播放过期的入场，违背“不补播”。这些路径没有第二次 navigate，也没有改变 Router 最终目标，问题在视觉策略的生命周期。

最小修正：将释放原生/Motion 资源与尚未结束导航的入场决定分开。对同一 pending 导航的 geometry 处理保持幂等，保留淡入或禁止补播的决定直到该导航提交、失败或被外部导航替代；仍须同步释放快照，并让真正的新 Link/History 导航正常入场。无需增加新的全局状态层。

证据性质：上述事件序列可由源码逐步确定。本次不新增、不运行复现测试。现有 resize 清理测试在目标已经提交后触发；几何测试直接修改 rect/scroll，没有连续派发尺寸事件；hidden 测试也未覆盖“恢复可见后 pending 才完成”。

## 已核对且未发现额外 material bug

- `commitOnce` 缓存提交 Promise；ready 拒绝、超时 skip 不再次调用 navigate。外部导航和 held callback 中断有 ownership 检查，不恢复已放弃的目的地。
- 目标 `onRendered` 订阅早于 navigate，要求目标 pathname 且 Router 不再 pending。安装版本的 `load-client.ts` 在框架渲染确认、status idle 后发出最终事件，再解决提交 Promise；这里没有把 URL 或 pending 占位直接当最终画面。
- 重定向、supersession、拒绝及同步 navigate 抛错都有等待解绑路径。`viewTransition:false` 避免 Router 再开启一套原生转场。
- 旧原生回调使用 owns，旧 Motion 完成回调比较动画实例，清理标记比较事务 id；未发现旧回调清除新事务标记或解锁的问题。
- 原生和 Motion 在正常路径互斥。ready 早失败后在目标 render 启动降级，晚失败后有 entry 和最终 reset；未发现永久隐藏内容的确定性路径，但真实首次可见帧仍需浏览器检查。
- logout/401 经 `clearAppToken()` 同步通知控制器 skip、清标记和停止 Motion；卸载、hidden 也直接清理。Sheet 插入由 MutationObserver 在绘制前检查，并保留 added-node 证据；没有为其保留第二份业务树。
- 窗口 capture 的兼容点击抑制先于 nav capture 的中断监听。被消费的 swipe click 不会先取消转场；普通点击和键盘激活仍正常进入 Link，修饰键点击不被中断监听劫持。
- 保持单 Outlet、稳定 main 和独立动画 wrapper；未新增查询、业务预取或 refetch。动画参数集中，CSS 的 group 禁止尺寸插值、图像 `height:auto` 和非阻塞 overlay 方向正确。

## Strengths

改动集中于控制器、手势接线和内容样式，没有扩展业务范围。generation ownership、单次导航、公开 render 协作和同步认证清理处理得较完整；新测试使用真实 App/Router，覆盖了六个方向、懒加载、失败、重定向和中断，不只是验证 animate 被调用。

## Spec Compliance

**部分符合，尚不能判定完成。** 单真实路由、方向与参数、pending 不作最终画面、认证清理和点击语义符合要求。上面两项分别违反长短页裁切与几何/超时/后台后的降级约定。Task 3 当前完整实现的生产浏览器证据尚未纳入本次材料，不能以 spike 或 354 项 jsdom/单元测试替代。

## Code Quality Verdict

**With fixes。** 没有发现 Critical，也不建议过度重构。需修正内容裁切的几何依据，以及原生资源生命周期和 pending 导航视觉决定之间的边界；补对应小范围回归即可。其余重点异步分支未发现需要额外改写的确定性问题。

## Declined To Judge

- 未修改的 Go、镜像、宿主机读取和 VM 真机能力：不在此分支评审材料及转场任务范围。
- 项目既有 dependency audit 警告：本次未更改依赖，不将既有问题归因于本分支。

没有将本任务中的导航、几何、安全清理或事件顺序行为以“spec 未写明”为由排除。

## 未验证事项

- 浏览器验收代理仍在独立工作，其最终反馈和新脚本不在本次冻结的评审包内；本次未接管浏览器、运行浏览器脚本或新增测试。
- 当前实现真实原生中间帧、old/new 独立高度、裁切实际画面，以及 ready 晚失败和 Motion 降级首次可见帧是否闪回。
- 连续 window/visualViewport 尺寸事件、350ms 后 resize、后台恢复早于 pending 完成的真实帧表现。
- iPhone Safari，尤其需求指定的 iOS 27.0.1、安装后的 PWA、旋转、320px 和底部安全区；桌面 Chrome spike 不能代表真机通过。
- 本次未独立运行 npm ci、npm test、build、diff --check、Go 或镜像检查；既有测试结果与构建说明已明确标注来源。

中文交付前已按“好好说话”复核，保留代码、术语、条件和严重级别，不将静态推导写成浏览器实测。
