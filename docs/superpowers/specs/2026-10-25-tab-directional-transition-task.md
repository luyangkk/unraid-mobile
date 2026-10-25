# 底部 Tab 松手后方向过渡实现任务

日期：2026-10-25。源码基线：`5ff6f97`。本文是后续编码任务说明，尚未实现。

用户已确认本轮效果：松手后平滑切页，旧页退出，新页按方向进入。手指拖动时页面跟随、拖动取消回弹不在本轮范围。

## 当前缺少旧页退出和方向提示

`web/src/app/AppShell.tsx` 在 Router 的 `onRendered` 后，将同一个 `motion.main` 的透明度从 0.92 动画到 1，时长 220ms。旧路由此时已经替换，没有旧页退出画面，也没有左右方向。

`useTabSwipe.ts` 已负责方向锁定、松手判定、Safari 横滑滚动拦截和兼容点击抑制。AppShell 的纵向 flex 布局与 `main` 的 `flex-1 pb-8` 已让短页面空白区域参与手势。这些修复必须保留。

每个业务路由挂载后会启动相应 Query 订阅。动画如果同时保留两份真实路由树，就可能让旧页面继续轮询。新方案继续保持一个真实 `<Outlet />`，AppShell、SessionGate 和 QueryClient 不重新挂载。

本任务更新原 `2026-10-25-tab-swipe-design.md` 中“仅透明度入场”的视觉约定。手势、安全与数据生命周期约束继续有效。

## 采用旧页视觉快照与单个真实路由

推荐使用浏览器同文档 View Transitions 完成旧画面退出和新画面进入，不支持或转场失败时使用现有 Motion 降级。这是结合当前代码约束的工程选择，并非所有移动应用通用的唯一方案。

WebKit 从 Safari 18.0 开始提供 View Transitions Level 1。它捕获切换前的画面，在 DOM 更新后生成用于过渡的伪元素；旧画面不需要保留为第二份 React 组件。[WebKit 官方说明](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/)

| 路径 | 适用性 | 本任务选择 |
| --- | --- | --- |
| View Transitions 与单个 Outlet | 可同时呈现旧画面和新画面，不额外挂载旧业务页 | 主方案 |
| AnimatePresence 保留离场路由 | 需要正确保留旧路由上下文，并处理离场页的轮询与副作用 | 不采用 |
| 单个 Outlet 与 Motion 入场 | 改动小、兼容性好，但没有真实的旧画面同时退出 | 明确作为降级效果 |

`AnimatePresence` 会保留离场元素直到退出完成；`mode="wait"` 则让新元素等待旧元素退出。直接给 `<Outlet>` 加 pathname key，并不能自动冻结旧路由上下文。[Motion 文档](https://motion.dev/docs/react-animate-presence)

浏览器能力检测以 `document.startViewTransition` 和所需 CSS 能力为准，不按 iPhone 型号或 UA 字符串分支。不要求升级 React、Motion 或 Router，不依赖实验性 React ViewTransition、Motion 付费组件或新的状态管理库。

## 交互约定与动画参数

路由顺序只从 `primaryNavigation` 读取：Home → Docker → VM → Storage。

```ts
direction = Math.sign(indexOf(to) - indexOf(from));
// +1: old moves left, new enters from right
// -1: old moves right, new enters from left
```

方向依据目标 Tab 的位置，不能依据“浏览器后退”等操作名称猜测。同一路由、非法路由或端点外滑动不播放转场、不增加 History。

本轮使用短距离水平滑动加淡入淡出，表达页面顺序。无需把整张长页面平移一屏，也不呈现拖动中的相邻页预览。下表是项目初始调参值，需用真机调整，不能写成平台规定。

| 参数 | 初始值与用途 |
| --- | --- |
| 水平位移 | 32 CSS px，正负号由 direction 决定 |
| 旧页 | `x: 0 → -direction * 32`；`opacity: 1 → 0`；180ms |
| 新页 | `x: direction * 32 → 0`；`opacity: 0 → 1`；240ms |
| 时序 | 新旧同时开始，有重叠；不先退到全空白再等待新页 |
| 缓动 | 初始用 `cubic-bezier(0.22, 1, 0.36, 1)`，不弹跳、不超调 |
| Motion 降级 | 新页方向入场，220ms；旧页直接由 Router 替换 |
| 原生捕获等待预算 | 350ms；超时只跳过动画，继续原导航并显示 Router pending UI |
| reduced-motion | 立即切页，不做位置或透明度动画；仍允许 Tab 手势 |

上述参数统一由 `lib/motion.ts` 定义。原生 CSS 所需参数由控制器写入 CSS 自定义属性，避免在 TS 和 CSS 各维护一套时长。沿用现有 12px 方向识别、1.5 倍方向比、60px 距离、24px 快划距离、600px/s 快划速度及 24px 视口边缘保护，不顺手调整灵敏度。

动画只作用于页面内容。底部导航保留原来的颜色过渡，顶栏不随内容横移。底部选中态以真实 Router 提交结果为准，失败时不能假装切换成功。

本轮左右滑动使用完整双画面转场。普通底部点击、键盘激活、History 前进后退继续由 Router 正常导航，并使用单页入场降级；它们可以立即中断正在播放的滑动转场。这样保留现有 Link 语义，不劫持修饰键点击、新标签打开或浏览器原生边缘导航。

## 控制器管理转场，手势 Hook 只提交请求

新增 `web/src/app/useTabTransition.ts`，由 AppShell 持有。职责包括方向、转场事务、原生句柄、Motion 降级及清理。转场状态只存在当前 Shell 内，不写 Query Cache、History state、sessionStorage 或 localStorage。

建议接口：

```ts
type TabPath = "/" | "/docker" | "/vm" | "/storage";
type TabTransitionRequest = { from: TabPath; to: TabPath };

type TabTransitionController = {
  requestSwipe: (request: TabTransitionRequest) => Promise<void>;
  isBusy: () => boolean;
  cancelVisual: () => void;
};
```

控制器保留递增 `generation`，以及当前事务的 `from`、`to`、阶段、原生句柄、计时器和清理函数。低频 UI 状态可以用 state，异步控制用 ref，不在每帧触发 React 渲染。Motion 降级用 `useMotionValue` 更新样式。[Motion values 文档](https://motion.dev/docs/react-motion-value)

状态流转如下：

```text
idle → capturing/updating → animating → idle
                       ↘ skipped → 等待原导航完成或被替代 → idle
任意阶段 → 被外部导航、退出或页面隐藏中断 → 清理本事务
```

`useTabSwipe` 保留现有事件监听及兼容点击抑制，仅把最终 `router.navigate()` 替换为 `requestSwipe({ from, to })`。控制器再次核对当前路由、模态层、会话和目标，避免 Hook 判断后状态已经改变。原 Hook 的 `cancel()` 只丢弃手势，不应把本次受控导航自己的转场也取消。

忙碌期间忽略新的滑动，不排队。底部点击和 History 导航不受这个锁限制，它们终止旧转场并让 Router 决定最终页面。新的事务到来后，旧事务的 Promise 回调不得删除新事务的 CSS 属性或重置新动画。

## 用原生句柄区分 DOM 提交与动画完成

TanStack Router 已有 `viewTransition` 导航选项。[官方导航文档](https://tanstack.com/router/latest/docs/guide/navigation)

但本仓库安装版本的 `router-core/src/router.ts` 内部只等待原生对象的 `updateCallbackDone`，没有通过 `navigate()` 向业务层暴露原生句柄。导航完成不能当作动画完成。为处理隐藏、退出和中断，本任务建议由控制器直接持有 `document.startViewTransition()` 的返回值，并在内部导航时显式传 `viewTransition: false`，避免嵌套两套转场。不修改 Router 私有字段，不覆盖浏览器全局方法。

核心流程必须遵守以下顺序。

- 在旧页面仍可见时确定方向和事务编号，设置转场标记，再调用 `startViewTransition`。
- 在其更新回调中提交一次 `router.navigate({ to, viewTransition: false })`，并等待目标路由实际完成 DOM 提交。订阅目标 `onRendered` 必须早于导航；不能只等 URL 改变，也不能用固定延迟猜测提交完成。
- 本地 `load-client.ts` 在渲染确认后发出 `onRendered` 并解决提交 Promise。实施时仍须对懒加载、重定向与被替代导航补测试；不得依赖私有 `_commitPromise`。
- `ready` 代表动画可以开始，`updateCallbackDone` 代表更新回调结束，`finished` 代表视觉结束。这三个阶段分别处理。
- 原生伪元素动画与现有 `onRendered` 透明度动画互斥，同一次导航只能选一种。降级入场必须在目标提交后的首次可见帧前设好起点，不能先露出完整页面再跳回动画起点。

下列伪代码展示职责关系，辅助函数需按下面的异常规则实现，不能直接复制作为完整实现。

```ts
async function requestSwipe(request: TabTransitionRequest) {
  if (!canStart(request)) return;
  const tx = beginTransaction(request);
  let commitPromise: Promise<void> | undefined;

  const commitOnce = () => {
    if (!commitPromise) {
      if (!isCurrent(tx)) return Promise.resolve();
      // Subscribe first; resolve/reject on commit, failure or supersession.
      commitPromise = navigateAndConfirmRender(request.to, {
        viewTransition: false,
        transaction: tx,
      });
    }
    return commitPromise;
  };

  try {
    if (reducedMotion()) {
      await commitOnce();
      return;
    }
    if (!supportsViewTransitions()) {
      armMotionEntry(tx);
      await commitOnce();
      await waitForMotionEntry(tx);
      return;
    }

    setTransitionAttributes(tx);
    try {
      tx.native = document.startViewTransition(commitOnce);
    } catch (error) {
      armMotionEntry(tx);
      await commitOnce();
      await waitForMotionEntry(tx);
      return;
    }

    watchReadyDeadline(tx, 350); // skipTransition only; never navigate again
    observeReady(tx);           // handle rejection immediately
    await tx.native.updateCallbackDone;
    await tx.native.finished;
  } finally {
    disposeTransactionResources(tx);
    if (isCurrent(tx)) resetVisualStateAndUnlock(tx);
  }
}
```

必须保证 `commitOnce` 每个事务最多调用一次 Router。`ready` 失败不能再导航一次；`skipTransition()` 也不会取消更新回调。导航错误交给现有路由错误处理，动画不支持或被跳过则不应显示成业务错误。所有原生 Promise、Motion 控制器和渲染等待都需要拒绝处理及解绑路径。[View Transitions 生命周期说明](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)

## CSS 只控制内容快照，不改变页面滚动模型

真实 `main` 保持目前的 flex 填充和底部间距，继续作为完整手势区域。若为 Motion 降级增加内部 wrapper，必须让 wrapper 也能填充剩余空间。不要 transform 手势区域本身，把动画层与命中区域分开。

本轮给内容动画层使用唯一的 `view-transition-name: tab-content`。不要对每张卡片分配名称，也不要使用必须依赖新版本浏览器的 `view-transition-name: auto` 或 transition types；方向可以由临时 `data-tab-direction` 表达。

新旧内容的核心关键帧如下，完整实现还需补齐捕获尺寸与裁切处理。

```css
@keyframes tab-old {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(var(--tab-exit-x)); }
}
@keyframes tab-new {
  from { opacity: 0; transform: translateX(var(--tab-enter-x)); }
  to { opacity: 1; transform: translateX(0); }
}

::view-transition-old(tab-content) {
  animation: tab-old var(--tab-exit-duration) var(--tab-ease) both;
  mix-blend-mode: normal;
}
::view-transition-new(tab-content) {
  animation: tab-new var(--tab-enter-duration) var(--tab-ease) both;
  mix-blend-mode: normal;
}
```

原生默认会对 group 的尺寸和位置做插值，不能认为上面几个关键帧就完成了整个转场。实现时要处理以下条件。[CSS View Transitions Level 1 规范](https://www.w3.org/TR/css-view-transitions-1/)

- 禁用 root 的默认交叉淡入淡出，未命名的页头和导航直接显示新状态。不要让整页一起闪动。只有转场期间启用相关 CSS，避免影响其他页面或 Sheet。
- 内容宽度不随动画变化，新旧图像保持自身比例；不能把长 Home 快照压缩到短 VM 的高度。
- 新旧内容的顶部或宽度不同、视口在捕获期间变化，或 Router 恢复滚动造成明显几何差异时，跳过原生双画面转场，待真实页面提交后做 Motion 淡入。首版不做跨滚动位置的几何补偿。
- 几何一致时，只使用约定的水平位移和透明度，关闭 group 的默认尺寸插值。完成时以新页面的自然高度为准，不人为锁住旧页面高度。
- 对内容伪元素设置视口与内容区域相交的裁切边界，禁止快照覆盖底部栏。不要仅依赖真实 DOM 的 `overflow`：原生转场伪元素位于单独的覆盖层。
- 如需防止降级 transform 产生横向溢出，在稳定的内容外层使用 `overflow-x: clip` 并实测。不能顺手改成新的 `overflow-y: auto` 页面滚动容器，否则会改变 Safari 手势和 Router 滚动恢复。
- 内容转场层不能挡住底部点击。动画期间的新滑动由控制器忽略，不能靠全屏透明遮罩吞掉所有输入。

上述几何降级应明确检测并记录到开发测试，不允许以“浏览器不稳定”为由吞掉所有动画。正常页面顶部、相同视口的六个相邻方向必须能播放双画面动画。

## 慢加载与中断不能留下旧画面

业务 API 不参与动画就绪判断。缓存快照或已有 LoadingPanel 可以作为新页内容，后续数据刷新不能再次触发整页入场。动画不得调用 `refetchQueries`、新增业务预取或提前挂载邻页。

懒加载 chunk 较慢时，原生捕获可能等待目标 DOM。自捕获开始 350ms 内尚未 ready，就调用 `skipTransition()`，释放视觉冻结并继续既有 Router pending UI。计时器只负责放弃动画，不能标记路由成功，也不能触发第二次导航。浏览器恢复后不补播过期转场。

| 场景 | 必须执行的处理 |
| --- | --- |
| 动画中再次滑动 | 忽略，不排队、不增加 History |
| 动画中点击其他 Tab | skip 当前动画，失效旧事务，立即允许 Link 正常导航 |
| 动画中 History 前进后退 | 清理当前事务，保持 Router 的实际目标及滚动恢复 |
| Sheet 出现或正在退出 | 禁止新转场，已有动画立即结束；不捕获 Sheet 内容 |
| 401、退出或 SessionGate 卸载 | 在卸载清理中同步 skip，停止 Motion，移除所有动画标记；不可继续展示受保护快照 |
| 页面进入后台 | skip 并清理视觉状态；不延迟触发导航，恢复后不重播 |
| reduced-motion 动态开启 | 立即结束位置与透明度动画，真实页面保持正常显示 |
| 原生 API 抛错或 ready 拒绝 | 保证原导航最多提交一次，清除快照，按提交阶段选择降级或直接显示 |
| 字体、旋转、视口变化导致几何不匹配 | 跳过双画面转场，使用不带位移的降级 |

reduced-motion 使用项目现有订阅方式，既在发起前检查，也处理播放中的偏好变化。WebKit 的无障碍说明强调让用户的减少动画偏好能够改变自定义动效。[WebKit reduced-motion 指南](https://webkit.org/blog/7551/responsive-design-for-motion/)

## 编码拆分与完成条件

| 文件 | 工作内容 |
| --- | --- |
| `web/src/app/useTabTransition.ts` | 新增控制器，处理原生句柄、提交确认、事务失效及降级 |
| `web/src/app/useTabSwipe.ts` | 注入控制器回调与 busy 查询，保留全部手势修复 |
| `web/src/app/AppShell.tsx` | 持有控制器，提供稳定手势区域和独立动画层，移除重复入场逻辑 |
| `web/src/lib/motion.ts` | 统一动画参数，保留现有手势常量及 reduced-motion 约定 |
| `web/src/styles.css` | 内容快照关键帧、方向变量、裁切和减少动画样式 |
| `web/src/app/router.tsx` | 仅在确有需要时补公开的提交事件协作；不全局开启第二套转场 |
| `web/src/App.test.tsx` 与浏览器验证脚本 | 事务和数据生命周期回归，生产构建下的原生动画验证 |

先完成一个最小技术验证：真实 Router 在相邻路由间提交后，旧伪元素显示旧页、新伪元素显示新页，且 `main` 和真实 Outlet 都只有一份；底部点击可以打断动画。验证延迟 chunk 时能按预算退出捕获，再继续实现完整控制器。若这一关未通过，应记录具体限制，不能以未经验证的双 Outlet 替换方案。

之后按 TDD 补控制器失败用例，再连接手势 Hook，最后添加 CSS。不要同时修改手势阈值、页面查询或业务面板。

自动化验收至少覆盖：

- 六个相邻方向的 old/new 位移符号正确，首末边界与同路由不动画。
- 正常成功、原生不支持、同步抛错、ready 失败、超时跳过等路径都只导航一次。
- 真正等到目标渲染才捕获新画面，不能把旧内容或中间 pending 占位当成最终新页。
- 旧事务的 finished 回调不能解除新事务的锁或擦除方向属性；连续滑动与点击中断后最终 URL、内容和选中态一致。
- 一直只有一个真实 Outlet、一个 System SSE。Docker／Storage 两秒轮询、VM 三秒轮询以及 Home 的原有观察者数量不变。
- 指标更新、轮询、断线重连、展开 details 不触发路由动画。卡片外空白、Storage 底部间距仍可触发手势。
- 原生路径不叠加现有 Motion 入场，降级路径不在首次可见帧闪回起点。
- 中途退出、401、后台、Sheet 和 reduced-motion 变化后没有悬空句柄、隐藏内容、残余 transform 或受保护旧快照。
- 长短页互切、恢复滚动、320px、旋转和底部安全区没有横向滚动条、内容压缩或导航遮挡。

jsdom 测试负责状态、导航次数和清理；浏览器检查必须采样真实伪元素动画或逐帧画面，证明中间帧存在，不能只断言调用过 `animate()`。需分别记录原生与降级路径，不以一个路径通过代表另一个通过。

执行 `npm ci`、`npm test`、`npm run build` 和 `git diff --check`。iPhone Safari 及安装后的 PWA 分别人工验证，优先使用用户当前报告的 iOS 27.0.1 环境。记录设备、版本、是否首次加载与网络状态；桌面 Chrome 自动化不能替代真机验收。若本次不涉及 Go 或镜像配置，交付时说明未运行相应检查。

完成后用户应看到：一次有效横滑松手，内容沿相应方向平滑过渡；失败、取消和慢加载仍能正常操作；页面空白处的手势修复没有回退。交付须附真实运行结果与未验证项，不提前宣称实现已兼容 iPhone。

## 文稿核对记录

本轮仅新增任务说明，没有修改业务代码或运行实现测试。已区分源码事实、官方机制与本项目建议参数；旧页快照不等于保留旧 React 路由。技术名称与代码保持原义。中文说明按“好好说话”复核，排除代码与链接后，中文半角标点、机械编号标题、元话语和翻案句式的机械扫描均为零命中。
