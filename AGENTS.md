# Unraid Mobile 工程指南

适用于整个仓库；子目录有 `AGENTS.md` 时，以更具体的说明为准。

## 范围与现状

- 单台 Unraid、受控局域网、只读 System / Storage / Docker / VM；VM 的 libvirt 读取尚未经过真实主机验证。所有写能力关闭，Operation Store 和 Docker 动作路由没有真实执行器。
- Go 1.24 + `net/http`；React 19、TypeScript、Vite、Tailwind CSS v4、TanStack Query、shadcn/ui。当前为深色单页，未接入认证、路由、Bottom Sheet、Motion、Sonner、主题切换或可安装 PWA。
- [技术方案](docs/spec-20260921-mvp.md)和[产品计划](docs/plan-20260921-mvp.md)包含后续目标，当前能力以代码、测试和 [README](README.md) 为准。未经真实主机验证的能力不得启用或宣称可用。
- 不扩展多主机、历史监控、通用 Shell、Docker 编辑、Share 或系统设置管理，不缓存离线业务数据。

## 结构与部署

- `cmd/server` 装配依赖；`internal/api` 提供 HTTP/SSE；`internal/app` 定义模型、接口和用例；`internal/adapter` 实现宿主机读取。API 调用 app，Adapter 实现 app 接口；app 不导入 Adapter、Unraid 路径或外部客户端。
- VM 每三秒后台采样，`GET /vms` 只读缓存；仅连接 `/var/run/libvirt/libvirt-sock-ro`，不回退到可写 socket 或 CLI。只解析 CPU 和内存分配字段，不导出 XML；无法可靠获取的 uptime 返回 `null`。`vmActions.start/stop/forceStop` 独立于读取能力，默认关闭。生产可选只读挂载 `/var/run/libvirt`，需真实主机验证；`VM_READ_ENABLED` 默认关闭，显式设为 `true` 才开始采集。
- 前端业务面板放在 `web/src/features`，通用组件放在 `web/src/components/ui`，API、订阅和格式化工具放在 `web/src/lib`。复用现有组件和相对导入，不新增状态层或顺手升级依赖。
- 一个生产容器、一个 Go 进程同时提供 API 与嵌入的静态资源。Dockerfile 将 Vite 产物复制到 `cmd/server/web` 后编译；不手改 `web/dist` 或嵌入产物，生产不运行 Vite。
- 生产以 `deploy/unraid/unraid-mobile.xml` 为准：`Privileged=false`，只读挂载 `/proc → /host/proc`、`/sys → /host/sys`、`/var/local/emhttp → /host/var/local/emhttp`，Docker 展示可选挂载 `/var/run/docker.sock → /var/run/docker.sock:ro`。只读 socket 挂载不限制 API 权限，应用只能发送固定读取请求。`compose.yaml` 的高权限和额外挂载用于开发/Spike，不能作为生产权限模板。
- `cmd/host-spike`、`internal/spike` 不属于生产请求链路。高权限 Spike 仅在用户明确授权的 Unraid 测试主机运行；`testdata/host` 保持合成数据，不替换为开发机或 CI 的真实数据。

## 数据与 API

- 宿主机读取仅使用挂载数据，不回退到容器 `/proc`、`/sys`。System 每秒、Storage 每两秒后台采样；请求只读最新缓存，不按请求或订阅重复采样。
- System 内存采用 `MemTotal - MemAvailable`；网络只统计 `/host/proc/1/net/route` 中有效且 metric 最低的默认 IPv4 接口，计数器来自 `/host/proc/1/net/dev`。CPU 温度按传感器标签/类型识别，不假定 `thermal_zone0`。
- CPU、网络、磁盘 I/O 使用有效相邻样本计算；首样本、计数器回退或采集恢复返回 `null`，网卡/磁盘身份变化后重建对应基线，不伪造零值。
- Storage 只读 `disks.ini`、`var.ini` 和 `/host/proc/diskstats`，不扫描 `/mnt` 或运行 SMART。Array 容量只汇总完整且已挂载的 Data 磁盘，排除 Parity、Flash、Pool；Pool 容量只计一次，Btrfs 按 used + free。阵列停止或容量不完整时返回 `null`。
- `spundown=0/1/其他` 对应 `active/standby/unknown`，UI 显示 `Active/Standby/Unknown`。休眠盘温度为 `null`，显示 `Temp —`，不得为取温度唤醒磁盘。
- API 前缀 `/api/v1`，JSON 使用 camelCase，容量/速率传字节数及字节每秒，时间为 RFC 3339 UTC。采集不可用仍返回 HTTP `200`，用 `available=false`、`reason` 表达；可选指标缺失用 `null` 和 diagnostics，不使整个 System 不可用。
- 请求错误统一为 `{ error: { code, message, retryable } }`，前端通过 `ApiError` 展示 message；details 为客户端支持的可选字段。`GET /healthz` 仅表示进程存活，返回 `204`，不检查外部依赖。
- 当前 SSE 仅发送 `system.metrics` 完整 System 快照；保留禁止缓存/代理缓冲、15 秒注释心跳及写超时。慢订阅只保留最新样本，退出时释放订阅，不阻塞采样。
- Docker 每两秒后台读取 Engine API 并缓存，`GET /docker` 不触发采样。列表获取全部容器，运行中的容器读取 inspect 和非流式 stats；局部统计失败保留容器行。CPU/网络使用相邻有效计数器，首次、重启、回退或恢复时速率为 `null`；内存从 usage 扣除 inactive_file（cgroup v1 回退 cache）。不返回完整 inspect、环境变量或 labels。

## 前端与交互

- Query Cache 管理快照，React 本地 state 管理连接与趋势。System 复用 `lib/stream.ts`，首次、重试和后台恢复均先取快照再开单一 SSE；后台关闭连接，卸载取消请求和订阅，避免旧结果回写。Storage / Docker 每两秒、VM 每三秒轮询，后台暂停。
- 首次无数据显示加载占位；刷新/断线保留已有样本并注明旧数据和采样时间。区分连接失败、采集不可用和空配置，保留不可用模块及原因，不伪造健康分、进度或成功结果。
- 格式化复用 `lib/system.ts`，统一 1024 进制单位和 `/s`；未知值显示 `—` 或 unavailable。CPU 趋势仅在浏览器内存保留最多 60 个去重样本，用 SVG 绘制，不作为历史监控。
- 延续 Slate 深色表面、Cyan 强调、Emerald 活跃、Amber 提示；保持移动单列、`max-w-md`、320px 最小视口和上下安全区。复用系统字体、等宽数字及现有圆角，避免数值更新造成布局跳动。
- System 指标集中在一个面板，Storage 按 Array/Parity/Pools/Disks 分组，磁盘与诊断用 `details/summary` 折叠。Button 保留至少 44px 高度、焦点和禁用反馈；图标按钮有可读标签，状态含义不能只靠颜色。
- Docker 按 Running / Stopped / Other 分组，Stopped 默认折叠；Running 折叠偏好可存 localStorage，不保存业务快照。使用通用本地图标，未验证 metadata 前不猜测图标字段或路径。读展示不增加动作按钮。

## 操作与安全

- 禁止任意命令、文件读写和 URL 代理。系统命令及参数必须由服务端静态定义；后续 Docker 使用 Engine API、VM 使用受控 libvirt 客户端，不解析 CLI 或接受任意 XML。
- 后续写操作须在服务端校验资源、能力、状态与权限，再创建异步 Operation；执行前再次校验。同一资源的 `pending/running` 操作互斥，`202 accepted` 仅表示受理，结果必须由执行和观察确认。
- Operation 仅存内存，终态释放资源；重启后以资源快照恢复状态，不能将丢失的操作误报失败。当前没有操作查询/事件接口或保留条数、时长的淘汰机制。
- `capabilities.docker` 只表达读取可用性；`dockerActions.start/stop/restart` 为显式写能力，默认全关闭。`Allows` 必须同时检查读取可用和对应动作权限，不能因为读取接通就返回 `202`。
- API 仅返回白名单字段；日志不记录令牌、CSRF、磁盘序列号等敏感元数据。

## 开发与验证

坚持 TDD，行为改动先补失败测试；保持改动聚焦，不顺手重构或修改无关格式。按改动运行：

| 范围 | 检查 |
|---|---|
| Go（仓库根目录） | `gofmt -w <修改文件>`；`go test -race ./...`；`go build ./cmd/server`；`go build ./cmd/host-spike` |
| 前端（`web` 目录） | `npm ci`；`npm test`；`npm run build`；同步更新 API/UI 行为的 Vitest 测试 |
| 镜像/部署 | `docker build -t unraid-mobile:local .`；`sh scripts/verify-image.sh unraid-mobile:local`；`docker compose config`；下述 XML 校验 |

```sh
python3 -c 'import xml.etree.ElementTree as ET; ET.parse("deploy/unraid/unraid-mobile.xml")'
```

交付说明实际验证结果及未运行项，不能用合成测试冒充真实主机验证。推送 `main` 会触发 `.github/workflows/publish.yml`，通过测试、构建、模板和镜像烟雾检查后才发布 `ghcr.io/luyangkk/unraid-mobile:latest`。
