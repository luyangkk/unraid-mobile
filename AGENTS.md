# Unraid Mobile 工程指南

适用于整个仓库；子目录有 `AGENTS.md` 时，以更具体的说明为准。

## 范围与现状

- 单台 Unraid、受控局域网、只读 System / Storage / Docker / VM；VM 的 libvirt 读取尚未经过真实主机验证。所有写能力关闭，Operation Store 和 Docker 动作路由没有真实执行器。
- Go 1.24 + `net/http`；React 19、TypeScript、Vite、Tailwind CSS v4、TanStack Router / Query、shadcn/ui。当前为默认深色 SPA，支持 Dark / Light / System 外观、Home / Docker / VM / Storage 四个一级路由、固定底部导航、可选 `APP_TOKEN` 认证，以及生产构建的可安装 PWA 和离线静态应用壳；磁盘详情和外观选择使用 Radix Dialog 和 Motion 封装的 AppSheet，未接入 Sonner。PWA 和 AppSheet 尚未经过真实 Android / iOS 设备验证。
- [技术方案](docs/spec-20260921-mvp.md)和[产品计划](docs/plan-20260921-mvp.md)包含后续目标，当前能力以代码、测试和 [README](README.md) 为准。未经真实主机验证的能力不得启用或宣称可用。
- 不扩展多主机、历史监控、通用 Shell、Docker 编辑、Share 或系统设置管理，不缓存离线业务数据。

## 结构与部署

- `cmd/server` 装配依赖；`internal/api` 提供 HTTP/SSE；`internal/app` 定义模型、接口和用例；`internal/adapter` 实现宿主机读取。API 调用 app，Adapter 实现 app 接口；app 不导入 Adapter、Unraid 路径或外部客户端。
- VM 每三秒后台采样，`GET /vms` 只读缓存；仅连接 `/var/run/libvirt/libvirt-sock-ro`，不回退到可写 socket 或 CLI。只解析 CPU 和内存分配字段，不导出 XML；无法可靠获取的 uptime 返回 `null`。`vmActions.start/stop/forceStop` 独立于读取能力，默认关闭。生产可选只读挂载 `/var/run/libvirt`，需真实主机验证；`VM_READ_ENABLED` 默认关闭，显式设为 `true` 才开始采集。
- 前端业务面板放在 `web/src/features`，通用组件放在 `web/src/components/ui`，API、订阅和格式化工具放在 `web/src/lib`。复用现有组件和相对导入，不新增状态层或顺手升级依赖。
- `web/src/app` 提供持久 App Shell 和路由，`routes` 提供页面，`components/app` 提供通用导航。QueryClient 全局共享，SessionGate 在路由外；System SSE、CPU／网络趋势及网络接口选择由 Shell 持有，切页不重建订阅或清空缓存。
- 一个生产容器、一个 Go 进程同时提供 API 与嵌入的静态资源。Dockerfile 将 Vite 产物复制到 `cmd/server/web` 后编译；不手改 `web/dist` 或嵌入产物，生产不运行 Vite。
- Go 仅对合法且无扩展名的 GET/HEAD 客户端路径回退到嵌入首页；`/assets` 下缺失文件、目录和非法路径返回真实 404。API 在静态路径校验前分流，health 保持 204。
- PWA 固定使用 `/manifest.webmanifest`、`/sw.js` 和 `/icons/*.png`，scope 和 start URL 均为 `/`；启用 `APP_TOKEN` 后仍公开。Go 显式返回 manifest 的 `application/manifest+json` 和 worker 的 JavaScript MIME，`/sw.js` 使用 `Cache-Control: no-cache`；不能改变 API 认证、SSE 或静态路径校验边界。
- 生产以 `deploy/unraid/unraid-mobile.xml` 为准：`Privileged=false`，只读挂载 `/proc → /host/proc`、`/sys → /host/sys`、`/var/local/emhttp → /host/var/local/emhttp`，Docker 展示可选挂载 `/var/run/docker.sock → /var/run/docker.sock:ro`。只读 socket 挂载不限制 API 权限，应用只能发送固定读取请求。`compose.yaml` 的高权限和额外挂载用于开发，不能作为生产权限模板。
- 宿主机兼容性通过主应用只读页面/API 与 Unraid WebGUI 人工对照验收，步骤见 [README](README.md#manual-host-acceptance)。记录镜像版本、采样时间、模块可用性、diagnostics 和未验证场景；`/healthz` 仅证明进程存活，HTTP `200` 或旧样本不代表采集正常。实际挂载和权限另行核对，不通过取温度唤醒休眠盘，不把读取验收当作写能力授权。`testdata/host` 保持合成数据，不替换为开发机或 CI 的真实数据。

## 数据与 API

- 宿主机读取仅使用挂载数据，不回退到容器 `/proc`、`/sys`。System 每秒、Storage 每两秒后台采样；请求只读最新缓存，不按请求或订阅重复采样。
- System 内存采用 `MemTotal - MemAvailable`；网络每秒一次读取 `/host/proc/1/net/dev` 的全部接口计数器，逐接口保存相邻采样基线并按实际时间差计算速率。Auto 依据 `/host/proc/1/net/route` 中有效且 metric 最低的默认 IPv4 路由选择接口；路由缺失不影响其他接口手动展示。CPU 温度按传感器标签/类型识别，不假定 `thermal_zone0`。
- System 的 `networkInterfaces` 返回稳定名称顺序的接口可用性、原因及 nullable RX／TX 字节每秒；旧 `networkInterface/networkRXRate/networkTXRate` 由同一计算结果投影，继续表达 Auto。局部计数器失败、移除、恢复或回退仅重建对应接口基线，真实无变化返回零；可读的挂载 sysfs ifindex 变化触发重建，但 ifindex 可重用、命名空间可能不同，不宣称可靠识别所有同名替换。数组、map 及可选指标指针均防御性复制。
- CPU、网络、磁盘 I/O 使用有效相邻样本计算；首样本、计数器回退或采集恢复返回 `null`，网卡/磁盘身份变化后重建对应基线，不伪造零值。
- Storage 只读 `disks.ini`、`var.ini` 和 `/host/proc/diskstats`，不扫描 `/mnt` 或运行 SMART。Array 容量只汇总完整且已挂载的 Data 磁盘，排除 Parity、Flash、Pool；Pool 容量只计一次，Btrfs 按 used + free。阵列停止或容量不完整时返回 `null`。
- `spundown=0/1/其他` 对应 `active/standby/unknown`，UI 显示 `Active/Standby/Unknown`。休眠盘温度为 `null`，显示 `Temp —`，不得为取温度唤醒磁盘。
- API 前缀 `/api/v1`，JSON 使用 camelCase，容量/速率传字节数及字节每秒，时间为 RFC 3339 UTC。采集不可用仍返回 HTTP `200`，用 `available=false`、`reason` 表达；可选指标缺失用 `null` 和 diagnostics，不使整个 System 不可用。
- 请求错误统一为 `{ error: { code, message, retryable } }`，前端通过 `ApiError` 展示 message；details 为客户端支持的可选字段。`GET /healthz` 仅表示进程存活，返回 `204`，不检查外部依赖。
- 当前 SSE 发送 `system.metrics` 和 `operation.updated` 完整快照；保留禁止缓存/代理缓冲、15 秒注释心跳及写超时。两类订阅各自只保留最新更新，退出时全部注销，不阻塞采样；Operation 不重放历史，重连后按 ID 查询。
- Docker 每两秒后台读取 Engine API 并缓存，`GET /docker` 不触发采样。列表获取全部容器，运行中的容器读取 inspect 和非流式 stats；局部统计失败保留容器行。CPU/网络使用相邻有效计数器，首次、重启、回退或恢复时速率为 `null`；内存从 usage 扣除 inactive_file（cgroup v1 回退 cache）。不返回完整 inspect、环境变量或 labels。

## 前端与交互

- Query Cache 管理快照，React 本地 state 管理连接与趋势。先验证 capabilities，再挂载业务请求；token 只保存在 `sessionStorage` 的 `unraid-mobile.app-token`，REST 和 fetch SSE 共用认证 Header。任意当前会话 401 或退出均中止请求、关闭 SSE、清空受保护缓存；不可重试的 `ApiError` 不自动重试。
- System 复用 `lib/stream.ts`，首次、重试和后台恢复均先取快照再开单一 fetch SSE；后台中止连接，卸载释放 reader 和 AbortController，避免旧结果回写。Storage / Docker 每两秒、VM 每三秒轮询，仅使用数据的当前路由挂载查询，后台暂停，前台恢复先刷新。
- 首次无数据显示加载占位；刷新/断线保留已有样本并注明旧数据和采样时间。区分连接失败、采集不可用和空配置，保留不可用模块及原因，不伪造健康分、进度或成功结果。
- 格式化复用 `lib/system.ts`，统一 1024 进制单位和 `/s`；未知值显示 `—` 或 unavailable。CPU／网络趋势仅保存在浏览器内存，用 SVG 绘制，不作为历史监控。网络当前接口最多保留 60 个去重样本及最近 60 秒窗口，使用服务端时间戳定位，拒绝重复和乱序；null 和超过 3 秒的采样间隔断线，不补点或补零。RX／TX 采用同一窗口共同上限、零起点，不用 CPU 百分比截断；有效点不足两个显示 `Collecting trend…`。
- 网络接口选择为 Auto 或实际采样名称，只影响展示且一次只显示一个接口，不汇总桥、bond 和成员，不标为互联网下载／上传。选择由 Shell 内存保存，切页保留、重载或会话退出恢复 Auto；接口消失保留手动选择并提示不可用。切换选择或 Auto 实际接口变化重置网络曲线；后台和断线保留旧曲线及时间。旧响应缺少数组时通过旧字段展示 Auto。原生 Dashboard 对照必须先选同一接口，再按 `B/s × 8 / 1000` 换算 Kbps，连续观察同一窗口，不能凭单截图判断精度。
- UI 遵循下文“UI 视觉与交互规范”，具体色值和交互参数以列出的源码为准。保持移动单列、`max-w-md`、320px 最小视口和上下安全区；复用系统字体、等宽数字，避免数值更新造成布局跳动。
- 外观默认 Dark，`localStorage` 的 `unraid-mobile.theme` 仅保存 `dark|light|system`；System 跟随设备，异常存储回退 Dark，跨标签页同步。head 脚本尽早应用外观，运行时由根元素属性和 CSS 变量更新，包括认证页、Portal 和 PWA 提示；不重建 Router、QueryClient、SessionGate、AppShell 或 SSE。实际颜色变化前取消 Tab 视觉转场，已提交导航继续。外观 AppSheet 选择后保持打开和焦点。
- System 指标集中在一个面板，Storage 按 Array/Parity/Pools/Disks 分组，Disks 与诊断用 `details/summary` 折叠；磁盘行显示摘要，点击后用 AppSheet 展示详情。Button 保留至少 44px 高度、焦点和禁用反馈；图标按钮有可读标签，状态含义不能只靠颜色。
- 业务组件只使用 `components/app/AppSheet`，不直接依赖 Radix Dialog；动画、手势阈值和减少动画偏好集中在 `lib/motion.ts`。AppSheet 处理模态焦点、关闭后的焦点返回、页面滚动锁定、内部滚动和底部安全区；纵向拖动仅由把手开始，面板支持以水平位移为主的右划关闭，忽略交互控件上的起始手势，保留内容纵向滚动和双指缩放；reduced-motion 禁用手势关闭和位移动画。
- 磁盘选择只在 StoragePanel 本地保存 `name`，每次从当前快照重新查找，不请求新数据；磁盘消失或采集不可用后停止展示旧详情，stale 提示与采样时间同步传入 Sheet。休眠盘始终显示 `Temp —`。Home Overview 不提供磁盘触发入口。
- Docker 按 Running / Stopped / Other 分组，Stopped 默认折叠；Running 折叠偏好可存 localStorage，不保存业务快照。Docker 独立页的 Running / Stopped / Other 与 Home 复用受认证的容器图标加载器，缺失时回退通用图标；折叠分组展开后才加载，后台和离线暂停新图片请求，已加载图片保留。容器图标读取已经在 Unraid 7.1.0 核实的 `plugins/dynamix.docker.manager/docker.json` 的 `icon` 字段和 `images/` 中的 PNG，复用现有 `/host/var/local/emhttp` 只读挂载；路径必须限制在固定目录内，不下载外部 URL，不返回原始 metadata。元数据最多 1 MiB、单图最多 512 KiB、尺寸最多 4096px、单次采样图片读取最多 8 MiB。图标随后台采样更新，API 仅返回可选 `iconVersion`；受认证保护的 `/api/v1/docker/{id}/icon?v={iconVersion}` 只读当前内存缓存，返回 `no-store`，不进入 PWA 缓存。缺失或无效时回退通用图标。读展示不增加动作按钮。
- FolderView2 为可选读取：只读挂载 `/boot/config/plugins/folder.view2 → /host/boot/config/plugins/folder.view2`，固定只解析 `docker.json`，最多 1 MiB、64 个文件夹；不执行插件脚本或动作。Home 合并显式成员、原生 JavaScript 正则匹配和 `folder.view2` 标签归属，文件夹存在运行中成员时显示为一项，全部停止时隐藏，默认 8 项在合并后计算；页头仍统计实际运行容器，Docker 独立页保留逐容器指标。成员重复归属时按配置顺序首次匹配，不导入插件自定义排序。FolderView2 的 PNG data URI 进入受认证图片缓存；HTTPS PNG 图标由浏览器直接请求，使用 CORS、`credentials: omit`、`no-referrer` 和 `no-store`，不附带 APP_TOKEN，图片最多 512 KiB，后端不代理或下载 URL。非 PNG、HTTP、带凭据或加载失败的图标回退通用文件夹图标。缺失配置时保留单容器展示，不增加点击行为。来源和范围见[FolderView2 验证](docs/validation/2026-10-25-folderview2/report.md)。
- Home 的 Running 容器采用两列图标加名称，名称单行超长省略，不显示资源指标，不增加点击行为；按名称自然排序并忽略大小写，默认展示 8 个，支持展开其余项目和收起。展开状态由 AppShell 内存保存，切页及采样刷新保留，页面重载后恢复默认，不写浏览器存储，也不受旧 Home Running 折叠偏好影响。Home 仅显示 Running 容器和 VM、Array/Parity 状态及 Pool 容量摘要；完整 Stopped / Other 与磁盘详情留在独立页面。离线、Query paused、刷新失败及恢复期间保留旧样本样式和采样时间，成功刷新后撤下旧样本标记。
- PWA 使用 Vite `injectManifest` 生成带版本的静态预缓存，包含全部路由 chunk；只缓存规范的同源静态资源和符合条件的页面导航。API、health、SSE、Operation、外部请求及携带凭据的请求只走网络；编码或非法路径不能命中缓存，缺失资源不能回退为缓存 HTML。不缓存业务数据或令牌，不接入 Background Sync、Push 或离线写入。
- PWA 注册和更新提示放在 SessionGate 外；开发环境默认不注册，注册失败不能阻断页面。新版本只有用户选择 Refresh 后才能激活并让当前页刷新一次，关闭提示或其他标签页接受更新都不能强制刷新当前页。离线冷启动不恢复业务数据；传输失败保留会话 token，恢复时先验证 capabilities，再恢复业务请求和单一 SSE。
- 安装和 Service Worker 需要可信 HTTPS 或 localhost 安全上下文；局域网 IP 的 HTTP 地址仅支持在线页面，即使经过 VPN 也不具备 PWA 安全上下文。部署可用 HTTPS、Tailscale HTTPS 或可信 HTTPS 反向代理；`APP_TOKEN` 不能替代 HTTPS。Android / iOS 安装、离线启动、更新确认、横屏和安全区仍须按 README 做真实设备验证，不能用自动化测试代替。

## UI 视觉与交互规范

依据 2026-10-25 用户要求，尽量复刻 `unraid.net` 官网源码风格，可参考 `10.0.0.66` 的 Unraid 7.1.0 WebGUI。官网 `onDark/onBright` 分区映射为本项目 Dark / Light，不宣称官网提供主题切换。官网色值与移动端适配在 `web/src/styles.css` 注释中区分；源码依据和验收见 [官网主题验收](docs/validation/2026-10-25-website-themes.md)。此前数值对比度门槛已取消，不为满足 4.5:1 或 3:1 改写官网色值；仍保留可读标签、键盘焦点和禁用反馈。

### 配色与组件

主题色集中在 `web/src/styles.css`，业务组件按用途使用语义 token，不覆盖 Tailwind 原始调色板，不在组件内另写一套主题色。下表记录当前实现；修改主题时同步更新本规范、`web/src/lib/palette.test.ts` 和相关组件测试。

| 用途 / token | Dark | Light |
| --- | --- | --- |
| 页面 `background` | `#171717` | `#F1ECE3` |
| 卡片 / Sheet `surface` | `#2B2A29` | `#FFFFFF` |
| 内层 `surface-muted` | `#333231` | `#EEE4D2` |
| 主文字 `foreground` | `#FFFFFF` | `#171717` |
| 次文字 `text-muted` | `#CCCCCC` | `#555554` |
| 分隔线 `border` | `#555554` | `#E0E0E0` |
| 控件边框 `control-border` | `#555554` | `#7B7B7B` |
| 品牌文字 `brand-text` | `#FF8C2F` | `#F15A2C` |
| 焦点 `focus-ring` | `#FF8C2F` | `#FF8C2F` |
| CPU／网络图表线 `chart-line`（映射 `brand-text`） | `#FF8C2F` | `#F15A2C` |
| 容量填充 / 轨道 `progress-fill/track` | `#B8B8B8 / #404040` | `#595959 / #D3D3D3` |

- 品牌渐变共用 `brand-gradient`：90°、`#E22828 → #FF8C2F`。页头品牌文字使用 `.brand-title` 渐变文字；底部 Tab 选中态使用 `surface` 背景、加粗 `brand-text`、2px 渐变顶线和 `aria-current="page"`，保留图标及文字标签。
- 按钮复用 `web/src/components/ui/button.tsx`。主按钮为 4px 圆角、渐变填充、默认白字、大写及加宽字距，hover / focus-visible 变 `#171717` 黑字。次按钮为胶囊、2px 渐变描边、透明底和主题主文字，hover / focus-visible 填满渐变并变黑字；填充淡入 300ms。页头图标按钮为 44px 方形尺寸及胶囊外形；Sheet 关闭按钮沿用中性底和边框。
- 连续渐变仅在 `(hover: hover) and (pointer: fine)` 的 hover 下启用：红 / 橙 / 红 / 橙四段，`background-size: 300% 100%`，`brand-flow 4s linear infinite`，位置由 `100% 100%` 移到 `0% 100%`。键盘焦点显示静态渐变与焦点环，触屏不启用连续流动；reduced-motion 关闭流动和填充过渡。禁用按钮使用中性底、边框和次文字，移除次按钮渐变装饰。
- `success/warning/danger/info` 独立表达状态，品牌选中态不代表警告，图表和容量颜色不代表健康状态。旧样本通过局部 `stale-foreground/stale-text-muted` 降低文字强调，保留提示和采样时间；不将整个业务面板透明化，不淡化 SVG、状态或容量指标。
- CPU、Receive、Transmit 趋势统一使用 `chart-line` 品牌色，以标题、箭头及独立区域区分方向；切主题立即变色，不清空样本或重订阅。折线不加循环渐变、闪动或平滑峰值，reduced-motion 保留数据更新。容量条仍使用独立 token。
- 外观选择复用 `AppearanceSheet` 的原生 radio group 和 `AppSheet`：选中项使用品牌文字、品牌边框及内层背景。选择后保持打开和焦点；主题更新覆盖认证页、Portal 和 PWA 提示，不重建会话、路由或数据订阅。默认值、存储和同步规则见上文。

### 导航与面板

- Tab 顺序为 Home / Docker / VM / Storage，支持点击和单指左右滑动，不循环越过首尾。手势参数集中在 `web/src/lib/motion.ts`，识别逻辑在 `web/src/app/useTabSwipe.ts`：方向判定距离 12px、横向比例 1.5，切页距离 60px，快速滑动至少 24px 且 600px/s，避让视口两侧各 24px；保留纵向滚动和双指缩放，排除正文中的交互控件、原生横向滚动区和模态区域；底部导航允许滑动，触发切页后抑制该次触摸产生的兼容点击。
- Tab 转场由 `web/src/app/useTabTransition.ts` 和 `styles.css` 共同实现，始终保持单一 `Outlet`。支持的浏览器在滑动切页时用 View Transition 捕获内容，旧页按方向退出、新页进入；页头和底部导航保持实时状态。位移 32px、退出 180ms、进入 240ms；普通链接导航或 API 不支持 / 捕获失败时，使用 220ms 定向入场；尺寸变化时可降级为淡入。原生捕获等待预算 350ms，超时只跳过视觉效果，已提交导航继续，不重复导航。
- Pending 或转场期间不接受新的滑动、不排队；底部链接可中断视觉转场并正常导航。切主题、进入后台或启用 reduced-motion 时清理视觉效果，已提交导航继续；数据刷新不重播入场动画。reduced-motion 保留 Tab 导航但关闭位移动画。
- Sheet 保持底部弹出、`max-w-md`、顶部大圆角、最高 `85dvh`、独立内部滚动及底部安全区。下拖只能从把手开始；右划关闭要求水平位移占优。关闭阈值和弹簧参数集中在 `sheetMotion`，不在业务面板另写手势。保留关闭按钮、模态焦点、焦点返回与滚动锁定；reduced-motion 禁用手势关闭和位移动画。

## 操作与安全

- `APP_TOKEN` 未设置或为空时为 LAN 模式；非空时在路径清理、路由、资源查询和 Operation 处理前验证 Bearer Token。公开 health 和静态资源，未知、重复斜杠、点路径与编码 API 路径同样受保护。摘要固定时间比较，不裁剪 token；401 统一返回 `UNAUTHORIZED`、`Authentication required`、`retryable=false`，禁止把凭据写入 URL、日志或错误。
- 禁止任意命令、文件读写和 URL 代理。系统命令及参数必须由服务端静态定义；后续 Docker 使用 Engine API、VM 使用受控 libvirt 客户端，不解析 CLI 或接受任意 XML。
- 后续写操作须在服务端校验资源、能力、状态与权限，再创建异步 Operation；执行前再次校验。同一资源的 `pending/running` 操作互斥，`202 accepted` 仅表示受理，结果必须由执行和观察确认。
- Operation 仅存内存，终态立即释放资源且不可再次转换；`running` 可更新 `0–100` 的有限进度，未知用 `null`。终态最多保留 100 条、最长 24 小时，按结束时间淘汰，活跃记录不淘汰；查询和变更时清理，生产通过 `Run(ctx)` 定时清理闲置记录。`GET /operations/{operationId}` 只查询单条，不提供列表或客户端修改/取消。重启后以资源快照恢复状态，不能将丢失的操作误报失败。
- `capabilities.docker` 只表达读取可用性；`dockerActions.start/stop/restart` 为显式写能力，默认全关闭。`Allows` 必须同时检查读取可用和对应动作权限，不能因为读取接通就返回 `202`。
- API 仅返回白名单字段；日志不记录令牌、CSRF、磁盘序列号等敏感元数据。

## 开发与验证

坚持 TDD，行为改动先补失败测试；保持改动聚焦，不顺手重构或修改无关格式。按改动运行：

| 范围 | 检查 |
|---|---|
| Go（仓库根目录） | `gofmt -w <修改文件>`；`go test -race ./...`；`go build ./cmd/server` |
| 前端（`web` 目录） | `npm ci`；`npm test`；`npm run build`；同步更新 API/UI 行为的 Vitest 测试 |
| 镜像/部署 | `docker build -t unraid-mobile:local .`；`sh scripts/verify-image.sh unraid-mobile:local`；`docker compose config`；下述 XML 校验 |

```sh
python3 -c 'import xml.etree.ElementTree as ET; ET.parse("deploy/unraid/unraid-mobile.xml")'
```

交付说明实际验证结果及未运行项，不能用合成测试冒充真实主机验证。推送 `main` 会触发 `.github/workflows/publish.yml`，通过测试、构建、模板和镜像烟雾检查后才发布 `ghcr.io/luyangkk/unraid-mobile:latest`。
