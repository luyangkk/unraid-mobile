# Home Docker 概览与图标验证

日期：2026-10-25。实现了两列图标加名称、名称单行省略、忽略大小写的自然排序、默认 8 个和展开／收起。容器项没有点击行为。展开状态由 AppShell 内存保存，切页、轮询和外观切换保留，页面重载后恢复默认。Docker 独立页继续显示完整指标，保留其 Running 折叠偏好。

## 图标来源已在主机核实

目标主机为用户指定的 `10.0.0.66`，WebGUI 显示 Unraid 7.1.0。用户明确授权了只读图标验证。SSH 的 22 端口拒绝连接，随后通过用户已登录的 WebGUI 终端完成同一范围的只读检查，没有修改配置、模板或容器，没有执行启动、停止或更新操作。

- Docker 页实际加载 `/state/plugins/dynamix.docker.manager/images/<name>-icon.png`，观察到的容器图片均已加载。
- `readlink -f /usr/local/emhttp/state` 返回 `/var/local/emhttp`。
- `plugins/dynamix.docker.manager/docker.json` 为普通文件，观察时大小为 16171 字节。仅过滤读取三个容器的 `icon` 字段，没有保存完整元数据。
- `AdGuard-Home`、`immich_server` 和 `unraid-mobile` 的 `icon` 均指向上述固定目录的本地 PNG。
- `AdGuard-Home-icon.png` 为普通文件，大小为 30044 字节；`file` 识别为 1024 × 1024 的 PNG。

这些结果与 [Unraid 7.1.0 官方源码](https://github.com/unraid/webgui/blob/7.1.0/emhttp/plugins/dynamix.docker.manager/include/DockerClient.php#L389-L412) 一致。现有 `/var/local/emhttp → /host/var/local/emhttp` 只读挂载已经覆盖所需文件，无需新增挂载。证据见 [终端截图](source-verification.png)。主机上没有安装或运行本次修改后的服务；上述结论只验证来源和挂载映射。

## 接口与读取边界

后台 Docker 采样通过独立 Adapter 读取固定位置的 `docker.json`，只解析 `icon` 字段，只接受固定目录内的普通 PNG 文件。根目录使用 `os.Root` 限制路径，不读取外部 URL、模板或任意客户端路径。元数据最多 1 MiB，单图最多 512 KiB，宽高各不超过 4096px，每次采样读取图片最多 8 MiB。图标可选，缺失或无效不会让 Docker 采集失败。

快照增加可选 `iconVersion`，不包含图片字节、原始路径、URL 或 labels。`GET /api/v1/docker/{id}/icon?v={iconVersion}` 仅返回当前采样的内存图片；旧版本、消失的容器和采集不可用时返回 404。请求不会读取宿主机。接口复用 Bearer Header 认证，返回 `image/png`、`nosniff` 和 `no-store`。

Home 只加载可见项目的图标，通过带认证 Header 的 fetch 创建临时对象 URL。版本变化、切页或会话变化会取消旧请求，释放图片时撤销对象 URL。后台和离线期间不发起新图标请求，已加载图片随旧样本保留。失败时显示通用图标，不下载远端 Logo，不增加离线业务缓存。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 通过，未升级依赖 |
| `npm test` | 28 个文件、408 项测试通过 |
| `npm run build` | 通过，包含生产 PWA 校验；仍有主包大于 500 kB 的构建提示 |
| `go test -race ./...` | 通过 |
| `go build ./cmd/server` | 通过，二进制输出到临时目录 |
| `git diff --check` | 通过 |
| Unraid XML 解析 | 通过，模板未修改 |
| `CGO_ENABLED=0 GOOS=linux go build` | server 通过，输出到临时目录 |

上述 Go 检查使用本机 Go 1.26.2；Dockerfile 中 Go 1.24 的容器构建未运行。

测试日志：[前端](frontend-tests.log)、[生产构建](production-build.log)。历史 Go race 混合日志已移除，上表保留当日生产测试总结，未生成替代日志或作为当前测试结果。

测试覆盖 Home 排序和八项限制、不修改共享快照、切页保留与重载重置、列表缩短后恢复、外观切换保留状态、加载与空／不可用／旧样本，以及图标认证、路径和软链接限制、大小预算、版本替换和移除、Blob 释放、旧请求取消和 401 通知。

浏览器使用生产构建和合成数据，验证实际 CSS 视口为 320px 和 448px。两种宽度均保持两列且没有页面横向溢出；长名称使用省略号，容器项没有按钮或链接。浏览器也验证了展开 12 项后切到 Docker 再回 Home 仍保持展开，重载后恢复 8 项。截图中的图片使用本地测试资源，不能作为真实容器图标展示的端到端验收。

- [320px Dark](home-dark-320.png)
- [448px Light](home-light-448.png)

## 尚未验证

本机没有 Docker 命令，未运行镜像构建、镜像烟雾检查和 Compose 校验。生产挂载未变。没有部署或推送本次修改，也没有验收新图片接口在真实主机上的完整链路。Android／iOS 真机、安装态 PWA、其他 Unraid 版本和宿主机目录变更仍需部署后验证。

中文检查只扫描本次新增和修改的说明文字；半角标点和破折号命中均为 0，未改变既有技术术语、路径或限制。没有代用户作出部署或发布承诺。
