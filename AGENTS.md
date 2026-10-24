# Unraid Mobile 工程指南

本文件适用于仓库根目录及其子目录。更深层目录若有 `AGENTS.md`，以更具体的说明为准。

## 先了解工程

- 这是部署在单台 Unraid 主机上的手机端运维控制台：Go 服务提供 API 和静态资源，React PWA 只在构建阶段运行。
- 产品范围、技术约束和 API 契约以 [docs/spec-20260921-mvp.md](docs/spec-20260921-mvp.md) 为准；涉及页面信息架构或交互时，同时阅读 [docs/plan-20260921-mvp.md](docs/plan-20260921-mvp.md)。
- 当前后端入口在 `cmd/server`，HTTP 层在 `internal/api`，业务模型和用例在 `internal/app`，宿主机探测代码在 `internal/spike`；前端位于 `web`。
- `Dockerfile` 会先构建 `web/dist`，再将其复制到 `cmd/server/web`，最后通过 `go:embed` 编入单个 Go 二进制。不要把构建产物当作手写源码修改。

## 修改边界

- 保持依赖方向：`api → app → adapter/platform`。`internal/app` 只能依赖领域模型和接口，不能依赖 Unraid 专有路径、WebGUI 解析逻辑、Docker 或 libvirt 客户端。
- API 固定使用 `/api/v1`；JSON 字段使用 camelCase；容量和速率传原始字节数；时间使用 RFC 3339 UTC。`GET /healthz` 只反映进程存活，成功返回 `204`，不得探测 Docker、libvirt 或 Provider。
- 有副作用的请求只做校验和入队，必须创建异步 Operation；同一资源同时只能有一个运行中的 Operation。操作的真实结果由受控后端执行与观察，不由前端推断。
- 能力不可用时，API 和 UI 都要明确表达不可用原因。未在真实 Unraid 环境验证的写操作不得标成可用，也不得伪造进度或完成状态。
- 宿主机的 procfs 与 sysfs 只能通过 `/host/proc` 和 `/host/sys` 读取，不能混用容器自己的 `/proc`、`/sys`。
- 禁止添加任意命令执行、任意文件读写、任意 URL 代理或任意 shell API。若确实需要系统命令，命令、参数和工作目录必须在代码中静态定义，调用方不能注入。
- 调用 Docker 时使用 Docker Engine API，不解析 `docker ps`、`docker stats` 等 CLI 输出。敏感操作在服务端再次校验权限、能力和资源状态；日志不得记录 `APP_TOKEN`。

## 常用命令

在仓库根目录执行 Go 命令：

```sh
go test ./...
go build ./cmd/server
go build ./cmd/host-spike
docker build -t unraid-mobile:local .
docker compose config
```

在 `web` 目录执行前端命令：

```sh
npm ci
npm run dev
npm run test
npm run build
```

`scripts/run-host-spike.sh` 和 `docker compose --profile spike run --rm host-spike` 会以 privileged 容器访问 Docker socket、libvirt 与宿主机挂载，只能在获准的 Unraid 测试主机上运行，不能作为普通本机检查。

## 编码与测试

- 保持改动小且聚焦；不要顺手重构、升级依赖、移动文件或修改无关格式。
- 修改 Go 文件后运行 `gofmt -w`，并为新增或改变的逻辑补充同包 `_test.go` 测试。并发安全的测试可使用 `t.Parallel()`。
- 修改 API 行为时，覆盖成功路径与关键拒绝路径，尤其是能力缺失、未知资源、资源忙碌和非法状态迁移。
- 修改前端 API 客户端或 UI 行为时，在 `web/src` 增加或更新 Vitest 测试。前端只负责展示格式化；不得把 API 数据缓存为离线业务状态。
- 最少运行与改动匹配的测试：Go 改动运行 `go test ./...`；前端改动运行 `npm run test` 和 `npm run build`。跨前后端或镜像相关改动还要运行 `docker build`。

## 交付前检查

- 确认变更没有突破 MVP 范围：单主机、受控网络、无历史监控、无通用 Shell、无 Docker 编辑或 Share/系统设置管理。
- 确认 API 契约、Capability 结果、Operation 生命周期和 UI 提示一致。
- 说明实际运行过的验证命令及结果；没有运行的检查要明确说明原因。
