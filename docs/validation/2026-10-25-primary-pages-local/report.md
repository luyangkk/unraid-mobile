# 四个一级页面：本地验证记录

2026-10-25。四个页面、底部导航和 Go 深链回退已实现，前端测试、Go 检查及浏览器本地检查通过。镜像检查未完成：本机没有 Docker。此次没有访问真实 Unraid 主机，所有写能力继续关闭。

## 实现范围

- `/` 为 Home，保留完整 System 面板及 CPU 趋势；Docker、VM 显示运行中资源，Storage 显示 Array、Parity 和 Pool 摘要。
- `/docker`、`/vm`、`/storage` 按路由懒加载，保留各面板的完整只读展示。未知客户端路径提供返回 Home 的入口。
- QueryClient 全局共享，SessionGate 位于路由外。App Shell 持有单一 System SSE 和内存中的 CPU 趋势。
- Home 轮询三个概览，详情页只轮询对应模块；Docker/Storage 两秒，VM 三秒。切页复用缓存，取消不再使用的请求；后台暂停，返回前台先刷新。
- 离线、Query paused、刷新失败和等待恢复快照时保留旧数据、褪色样式及采样时间。成功刷新后撤下旧样本标记。
- Go 先分流 API，再校验静态路径。合法无扩展名 GET/HEAD 客户端路径回退首页；缺失 asset、目录、非法路径返回真实 404，其他方法不返回前端 HTML。

## 自动检查

| 检查 | 结果 |
|---|---|
| `npm install @tanstack/react-router` | 通过；只新增 Router 及其传递依赖，原依赖版本未升级 |
| `npm ci` | 通过 |
| `npm test` | 159 项通过，15 个测试文件 |
| `npm run build` | 通过；产物包含 DockerPage、VMPage、StoragePage 独立 chunk |
| `gofmt` | 修改的 Go 文件已格式化 |
| `go test -race ./...` | 通过 |
| `go build ./cmd/server` | 通过 |
| Unraid 模板 XML 解析 | 通过 |
| `git diff --check` | 通过 |
| `docker build -t unraid-mobile:local .` | 未完成，命令退出 127：找不到 docker |
| `sh scripts/verify-image.sh unraid-mobile:local` | 未完成，命令退出 127：找不到 docker |
| `docker compose config` | 未完成，命令退出 127：找不到 docker |

路由集成测试覆盖四个 URL、Not Found、导航及前进后退、当前导航项、概览裁剪、缓存和趋势保留、单一 SSE、轮询次数、后台恢复、offline/paused、刷新失败与 token 失效退出。另有测试确认：切页后取消未完成请求；延迟响应返回前，恢复中的旧数据继续标为旧样本。

Go 测试覆盖深链、HEAD、已有与缺失资源、目录和非法路径、请求方法、API JSON 错误、health、APP_TOKEN，以及通过生产前端 Handler 查询 Operation 和读取 SSE。

## 浏览器检查

在本机 Chrome 中运行 Vite 生产构建。临时 Go 测试进程使用实际 `newFrontendHandler` 和 API Handler，宿主数据来自仓库合成 fixture，Docker/VM 来自临时只读合成 Reader；未连接真实 socket，也未修改 fixture 文件。

浏览器检查共 19 项通过，详情见 [browser-results.json](browser-results.json)：

- 320×740、390×844、844×390 下分别检查四个页面，共 12 个组合。无横向溢出，导航项高 64px，展开详情并滚到底部后，最后一段内容仍在导航上方。
- 直接打开 `/docker`，完成 APP_TOKEN 首次认证；Stopped 默认折叠，展开后可见完整资源。
- Home 不含 Stopped、Other 和磁盘完整列表；CPU 趋势可见。连续切页未新增 System SSE。
- 浏览器后退和前进正常；在 `/storage` 刷新返回 200，已有认证会话继续有效。
- 使用 Chrome safe-area override 模拟顶部 47px、底部 34px：导航底部 padding 为 34px，Shell 底部为 130px，顶部为 71px；四个导航项均完整显示。
- Clear token 返回认证表单；没有页面 JavaScript 异常。

截图：[320×740](home-320x740.png)、[390×844](home-390x844.png)、[844×390](home-844x390.png)、[Storage safe area](storage-safe-area.png)。

safe area 为 Chrome 模拟结果，未在真实 iPhone/Safari 上检查；本地 Go Handler 检查也不能替代最终容器镜像验证。

## 审查与交付状态

独立代码审查发现恢复期间提前撤下旧样本标记的问题。补充延迟响应测试后观察到失败，再修复并通过全量测试。导航选中样式的类名冲突也已修正，浏览器确认选中边框可见。

README 和 AGENTS 已同步当前页面结构。已有真实主机验证记录保持原样，`writeVerified: false` 未改变。
