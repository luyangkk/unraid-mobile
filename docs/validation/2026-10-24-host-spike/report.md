# Host Capability Spike 验证记录

结论：Spike 改造和本地验证已完成；更新后的 Spike 尚未在 `10.0.0.66` 执行，真实主机验收未完成。本次完成了已有部署 API 与已登录 Unraid WebGUI 的只读对照。观察期间一块数据盘从 Standby 变为 Active，原因未确定，不能签署“未唤醒磁盘、前后状态不变”的验收结论。

目标为 `http://10.0.0.66:18080`，原生界面为 `http://10.0.0.66`，Unraid 7.1.0。本次结构化 API 观察时间为 2026-10-24 13:56:19–14:02:55 UTC。既有同日 VM 和部署报告属于独立证据，不作为本次 Spike 输出。

## 执行边界与阻塞

- `/healthz` 实测返回 204，System、Storage、Docker、VM API 可读。
- `ssh -o BatchMode=yes -o ConnectTimeout=5 root@10.0.0.66 true` 被拒绝连接，未执行远端命令。
- 浏览器插件恢复后，能读取已登录的 Dashboard、Main、Docker、VMs。点击原生 Terminal 入口后，没有得到工具可访问的主机终端；没有通过终端执行命令。
- 本机没有 Docker CLI，不能构建/运行镜像或通过本机 Docker 向主机执行 Spike。本次没有发布镜像、替换已有容器、修改主机配置或创建宿主机文件。
- 本次改造尚未发布或送达目标容器，没有更新后二进制的执行证据。

因此本目录**没有真实主机 Spike 原始 JSON 或进程退出码**。下列 JSON 保留已有部署 API 的白名单字段观察，文件中已标注来源。完成剩余工作需要可执行更新后镜像或二进制的主机入口；取得结果后应原样保留 stdout JSON，并另存退出码。

## 模块结果

| 能力 | 数据源与固定读取 | 必需挂载、权限与开关 | 本次真实观察 | 失败表现与遗留项 |
|---|---|---|---|---|
| System | 生产 System adapter/service；`proc/stat`、`proc/meminfo`、`proc/uptime`、`proc/1/net/route`、`proc/1/net/dev`、受识别的 sysfs CPU 传感器 | `/proc → /host/proc:ro`、`/sys → /host/sys:ro`；procfs/sysfs 读取权限。运行 UID、实际权限与挂载模式待 Spike 核对 | API available；内存约 6.73–6.76 GiB / 15.35 GiB、43.84%，与 WebGUI 的 44% 一致；温度 API 49°C、原生早期观察 50°C | CPU 对照点原生 20%、API 5.05%，采样时间及窗口不同，未完成 CPU 校准。网络为 `shim-br0`，缺宿主机默认路由独立证据；可选指标缺失保留基本读取并给出诊断 |
| Storage / Array | 生产 Storage adapter/service；仅 `disks.ini`、`var.ini`、`proc/diskstats`，不扫描 `/mnt`、不运行 SMART | `/var/local/emhttp → /host/var/local/emhttp:ro`、`/proc → /host/proc:ro`；文件可读 | Array started，5 块 Data；总量 13,044,001,148,928 bytes、已用约 9.253 TB，与原生 13 TB / 9.25 TB 的显示一致 | `var.ini`、容量或 diskstats 局部失败独立标记。原生一块盘已有 2 个 errors，本任务不据此判断健康或修复。观察开始 5 块 Data 全 Standby，结束为 1 Active / 4 Standby；原因未确定 |
| Pools | 同一 Storage provider；按主成员计算一次，Btrfs 使用 used + free | 与 Storage 相同，无额外挂载 | 1 个 Btrfs Pool、1 个成员；原生 used 30.2 GB、free 208 GB。API 使用 used + free 的有效容量，原生 size 显示 240 GB，总量差异待原始元数据核对 | 当前没有镜像成员，**真实镜像 Pool 去重仍未验证**；合成覆盖不代替实机结果 |
| Parity 读取 | 同一 `disks.ini`、`var.ini` provider | 与 Storage 相同 | 原生未配置 Parity 盘，API `not_configured`、progress null | running/paused、真实进度及暂停恢复未验证。Spike 对 running/paused 缺失进度标记 partial；未配置/idle 的 null 不算失败 |
| Docker | 生产 Engine adapter/service；固定 GET `/version`、全部容器 list、inspect、`stats?stream=false&one-shot=true` | 可选 `/var/run/docker.sock → /var/run/docker.sock:ro`；Unix socket 连接权限；Spike 仅在 `SPIKE_DOCKER_READ_ENABLED=true` 时探测 | WebGUI 与 API 均为 25 个容器：13 Running、12 Stopped、0 Other。1 个容器缺网络计数器，其余模块保留 | 原生页面可见挂载路径，未验证 ro 模式或 UID。inspect/stats 协议失败不能通过；缺少可选网络计数器单列诊断。socket 的只读挂载不限制 API 方法权限 |
| VM | 生产 libvirt adapter/service；固定只读 socket、`qemu:///system`、list/state/XML 分配字段读取；不输出 XML | 可选 `/var/run/libvirt → /var/run/libvirt:ro`；仅 `/var/run/libvirt/libvirt-sock-ro`，需其连接权限；Spike 仅在 `SPIKE_VM_READ_ENABLED=true` 时探测；生产仍用独立 `VM_READ_ENABLED` | WebGUI 与 API 均为 1 台 Running，4 vCPU、1024M / 1,073,741,824 bytes 一致 | 当前只确认一台运行 VM。实际 socket 权限、Stopped/Paused/Crashed、daemon 恢复仍待验证；uptime 未验证，继续 null；没有可写 socket、CLI 或网络回退 |

## 已落实的 Spike 边界

- 独立 JSON 结构使用 `version`、UTC `generatedAt`、`checks`、`mounts`、`unverifiedCapabilities`、`system`、`storage`、`docker`、`vm`、`readOnly`、`writeVerified`。已移除 `allAvailable`。
- 每个模块记录 enabled、available、status、protocolPassed、diagnostics。status 可为 passed、partial、failed、skipped；partial 的可选指标缺失不必等同协议失败。
- 两轮采样复用同一生产 service，采样间隔 1 秒。默认整体上限 15 秒、每模块 6 秒，生产 adapter 原有请求上限继续生效。context 取消后仍尽可能输出各模块已完成的结果。
- 必选检查为 CPU、内存、diskstats、`disks.ini`、`var.ini`。uptime、网络与传感器属于可选指标，缺失不能覆盖 System 基本结果。
- 仅环境变量精确等于 `true` 才启用 Docker/VM；未启用不访问 socket、状态为 skipped。启用但 socket 缺失或类型错误时，保留其他模块结果。
- 只投影数值、固定状态和诊断码。Docker 不输出容器名称、ID、环境变量、labels 或 inspect；VM 不输出名称、UUID、XML、设备或 metadata；Storage 不输出序列号或文件原文。
- stdout 仅用于 JSON，构建日志走 stderr。退出码为 0：必选及已启用协议通过；1：内部或编码/输出错误；2：必选或显式启用探测失败。内部错误优先于并存的能力失败。
- 启动器的所有实际挂载均声明只读，缺失源留给二进制诊断，不因 Docker mount 错误提前丢失 JSON。没有 privileged 或 `/boot`。
- Compose Spike 入口关闭 privileged 和可选探测，使用 `read_only: true` 与 `create_host_path: false`，不会创建缺失宿主机目录；源不存在时快速失败，需要完整失败 JSON 时使用启动器。
- 报告只根据 `/proc/self/mountinfo` 精确挂载点证据标记 readOnlyVerified。路径可读不能证明挂载只读；文件 mode 不能单独证明 UID、组或 privileged 配置。真实权限仍待取得 Spike 结果。

## 前后观察与写能力

`observation-comparison.json` 保留实际差异：Docker 数量/状态汇总、VM 数量/状态/资源、Array 状态/盘数、Parity 状态一致；Data 电源状态不一致，5 Standby 变为 1 Active / 4 Standby。仍在 Standby 的盘温度保持 null。

这些是两个观察点的比较，不能排除中间发生的状态转换，更不能替代更新后的 Spike 运行前后检查。最初“所有状态均不变”的观察断言因此失败；已保留失败事实，没有重采样覆盖它。未确定磁盘变为 Active 的原因，没有将它归因于某个读取协议，也没有声称其与验证无关。

两个 API 观察点的 Docker start/stop/restart、VM start/stop/forceStop、Array start/stop、Parity start/cancel 均为 false。源码没有修改生产能力开关或增加执行器。本次没有发送写请求、调用 SMART、扫描 `/mnt`、触发启停或改变阵列配置。

**Array / Parity 控制入口仍为未决；全部写能力未验证，`writeVerified: false`。不能据此开始实现生产执行器。**

## 本地验证

| 检查 | 结果 |
|---|---|
| TDD | 缺失路径/可选 socket、独立失败、Docker/VM/Storage 部分失败、固定读取协议、超时/取消、JSON 白名单、敏感输出、退出码及挂载证据均有覆盖；审查修正先观察到失败测试 |
| `gofmt -w` 修改的 Go 文件 | 已执行 |
| `go test -race ./...` | 通过，含 Spike 和所有生产模块 |
| `go build ./cmd/server` | 通过 |
| `go build ./cmd/host-spike` | 通过 |
| `sh -n` 两个 Spike 脚本；`sh scripts/run-host-spike_test.sh` | 通过，使用假 Docker 和受控 metadata 检查，不连接真实 daemon |
| Compose YAML 断言 | 通过：Spike 无 privileged、三处只读绑定、禁止自动创建源目录、可选开关为 false |
| Unraid XML parse；`git diff --check` | 通过 |
| Docker build、镜像 smoke、`docker compose config` | 未运行：本机没有 Docker CLI；YAML 断言不代替 Compose 的实际校验 |
| 更新后的真实 Host Spike、原始 stdout JSON、进程退出码 | **未取得** |

未改动现有前端工作。真实缺挂载、权限拒绝、协议中断和恢复没有注入到目标主机；本地合成测试只验证合同，不能作为这些实机场景通过的证据。

## 证据与剩余验收

- `api-observations-before.json`、`api-observations-after.json`：已有部署 API 的白名单字段观察。
- `webgui-observations.json`：原生界面指定字段，无磁盘序列号、VM 设备路径或认证信息。
- `observation-comparison.json`：两个 API 观察点的比较，包含电源状态变化。

剩余事项：执行更新后的 Spike 并保留原始 JSON/退出码；核对实际只读挂载、UID/socket 权限；独立确认 `shim-br0` 默认路由及流量含义；完成同采样窗口的 CPU 对照；解释磁盘电源变化并重新检查 Spike 前后状态；在有镜像 Pool、活动 Parity 和其他 VM 状态的授权条件下补齐兼容性验证。未具备真实样本的场景继续标记实验性，VM 默认开关保持关闭。
