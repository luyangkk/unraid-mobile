# 主应用只读对照历史记录

日期：2026-10-24。结论：已有部署的主应用 API 与已登录 Unraid WebGUI 完成了有限的只读对照，**不代表真实主机完整验收通过**。观察期间一块数据盘从 Standby 变为 Active，原因未确定，不能签署“未唤醒磁盘、前后状态不变”的验收结论。

目标为 `http://10.0.0.66:18080`，原生界面为 `http://10.0.0.66`，Unraid 7.1.0。结构化 API 观察时间为 2026-10-24 13:56:19–14:02:55 UTC，WebGUI 各模块另有独立观察时间。本文保留当日事实，不把文档整理或本地测试当成新的人工验收。同日 VM 和部署报告仍是独立证据。

## 观察范围

- `/healthz` 实测返回 204，仅说明进程存活。System、Storage、Docker、VM API 可读是另行观察的结果，不由 health 推导。
- 读取了已登录的 Dashboard、Main、Docker、VMs。SSH 连接被拒绝，原生 Terminal 入口没有提供可执行命令的会话，没有执行远端命令。
- 当日本机没有 Docker CLI，未构建或运行镜像；没有发布镜像、替换容器、修改主机配置或创建宿主机文件。
- 原生 Docker 页面可见主应用挂载目标，但**没有核实实际只读模式、运行 UID、Privileged 或 socket 权限**。路径可读不能证明挂载只读，socket 的只读挂载也不限制 API 方法权限。
- JSON 是已有部署 API 的白名单字段及 WebGUI 指定字段观察，不是原始宿主机文件或完整协议响应；未保存序列号、VM 设备路径或认证信息。

## 模块对照

| 能力 | 2026-10-24 真实观察 | 限制与未验证项 |
| --- | --- | --- |
| System | API available；内存约 6.73–6.76 GiB / 15.35 GiB、43.84%，与 WebGUI 的 44% 接近；温度 API 49°C，原生早期观察 50°C | CPU 文字记录另有原生 20%、API 5.05% 的非同步对照；结构化记录为原生 24%、前后 API 3.553299492385787% / 6.582278481012659%。采样时间与窗口不同，未完成 CPU 校准或传感器映射验证 |
| Network | API 接口为 `shim-br0`，前后 RX/TX 速率保留在 JSON | 缺宿主机默认路由独立证据，未确认接口流量含义，也未完成同接口、同窗口的 WebGUI 对照；不能认定为互联网下载或上传 |
| Storage / Array | Array started，5 块 Data；总量 13,044,001,148,928 bytes，已用约 9.253 TB，与原生 13 TB / 9.25 TB 显示对应 | 原生一块盘已有 2 个 errors，不据此判断健康或修复。开始 5 块 Data 全 Standby，结束为 1 Active / 4 Standby；原因未确定。真实缺挂载、权限拒绝、diskstats 或容量失败及恢复均未验证 |
| Pools | 1 个 Btrfs Pool、1 个成员；原生 used 30.2 GB、free 208 GB、size 240 GB；API 有效容量按 used + free 计算 | 总量差异仍待原始元数据核对；没有镜像成员，真实镜像 Pool 去重未验证，合成覆盖不代替实机结果 |
| Parity | 原生未配置 Parity 盘；API `not_configured`、progress null | running/paused、真实进度及暂停恢复未验证，不能用未配置样本证明活动校验可用 |
| Docker | WebGUI 与 API 均为 25 个容器：13 Running、12 Stopped、0 Other；1 个容器缺网络计数器，其余结果保留 | 未独立核实 Engine 原始 inspect/stats、实际 socket 权限或挂载只读模式。缺少可选网络计数器不等于整体读取失败，也不证明其原因 |
| VM | WebGUI 与 API 均为 1 台 Running，4 vCPU、1024M / 1,073,741,824 bytes 一致 | 只确认一台运行 VM；Stopped/Paused/Crashed、daemon 恢复及实际 socket 权限未验证。uptime 未验证，继续 null；此历史样本不构成生产 libvirt 兼容性验收 |

## 前后观察与写能力

[前后比较](observation-comparison.json) 保留实际差异：Docker 数量和状态汇总、VM 数量和状态及资源、Array 状态和盘数、Parity 状态一致；Data 电源状态不一致，5 Standby 变为 1 Active / 4 Standby。仍在 Standby 的盘温度保持 null。

这只是两个观察点的比较，不能排除中间发生过状态转换。最初“所有状态均不变”的断言失败，失败事实保留，没有用重采样覆盖。磁盘变为 Active 的原因未知，没有将其归因于某个读取协议，也没有声称与观察无关。

两个 API 观察点的 Docker start/stop/restart、VM start/stop/forceStop、Array start/stop、Parity start/cancel 均为 false。没有发送写请求、运行 SMART、扫描 `/mnt`、触发启停或改变阵列配置。

**Array / Parity 控制入口仍未确定，全部写能力未验证，`writeVerified: false`。这些观察不能用于批准生产写执行器。**

## 当日本地生产检查

下表仅保留 2026-10-24 已记录的生产检查总结，不是此次文档整理重新执行的结果。

| 检查 | 历史结果 |
| --- | --- |
| `gofmt -w` 修改的 Go 文件 | 已执行 |
| `go test -race ./...` | 通过，包含生产模块 |
| `go build ./cmd/server` | 通过 |
| Unraid XML parse；`git diff --check` | 通过 |
| Docker build、镜像 smoke、`docker compose config` | 未运行：当日本机没有 Docker CLI |

真实缺挂载、权限拒绝、协议中断和恢复没有注入目标主机；本地合成测试不能作为这些实机场景通过的证据。

## 证据与后续人工验收

- [API 前观察](api-observations-before.json)、[API 后观察](api-observations-after.json)：已有部署 API 的白名单字段，保留原时间、数值、状态和诊断。
- [WebGUI 观察](webgui-observations.json)：原生界面指定字段及各模块观察时间，挂载只读和 Privileged 未验证标记仍为 false。
- [前后比较](observation-comparison.json)：保留全部比较结果，包括磁盘电源变化和 `writeVerified: false`。

后续通过主应用只读页面和 API，按 README 的人工验收步骤补齐：同接口、同采样窗口的 CPU／网络对照；实际部署挂载与 UID/socket 权限核对；磁盘电源变化的原因调查及新的前后状态记录；镜像 Pool、活动 Parity、其他 VM 状态和故障恢复的授权只读观察。不能为测温唤醒休眠盘，也不能为补齐证据触发写操作。未取得真实样本的场景继续标记未验证，VM 的 `VM_READ_ENABLED` 默认关闭，仅读取 `/var/run/libvirt/libvirt-sock-ro`，不回退可写 socket、CLI 或网络连接。
