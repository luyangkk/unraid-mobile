# FolderView2 的 Home 分组与图标

日期：2026-10-25。本次为 Home Docker 概览增加可选的 FolderView2 适配。文件夹使用配置名称和图标，相关成员只在 Home 合并为一项。原有两列、名称省略、按名称自然排序、默认 8 项、会话内展开状态和无点击行为保持一致；8 项限制在合并后计算。Docker 独立页继续逐容器显示完整指标。

## 主机来源核实

目标为用户指定的 `10.0.0.66`，Unraid 7.1.0，插件列表显示 FolderView2 2025.04.13。通过已经登录的 WebGUI 查看实际分组，并在终端中只读过滤配置字段和安装脚本，没有修改插件、容器或主机设置。

配置文件为 `/boot/config/plugins/folder.view2/docker.json`。`Immich` 文件夹的显式成员为 `immich_server`、`immich_machine_learning`、`immich_redis` 和 `immich_postgres`，其 `regex` 为空。`icon` 为 `https://raw.githubusercontent.com/immich-app/immich/main/design/immich-logo.png`。WebGUI 中的文件夹图标和成员与配置一致，证据见[配置截图](source-config.png)。未保存完整插件配置、动作或自定义脚本。

安装脚本的成员逻辑包括 `new RegExp(folder.regex)`、显式 `containers`，以及 `folder.view2` 标签匹配文件夹名称。也核对了 [FolderView2 项目源码](https://github.com/VladoPortos/folder.view2)。适配器只提取必要字段；JavaScript 正则在前端使用原生 `RegExp`，支持与插件一致的 lookahead 等语义，不用 Go 正则替代。

## 实现和边界

新增 Adapter 随后台 Docker 采样读取固定的插件配置文件。源文件需要普通文件、不能为软链接，最多 1 MiB，最多接受 64 个文件夹。标识符、名称、成员数和正则长度均有上限，不读取或执行插件脚本、动作、Shell、WebUI 命令。Engine 只额外解析 `folder.view2` 这一条分组标签，不保留或导出完整 labels。

快照增加可选 `folders`，字段为 `id`、`name`、`containerIds`、可选 `matchPattern`、`iconUrl` 和 `iconVersion`。显式成员及标签匹配在后端转为当前容器 ID，正则在前端参与匹配；缺失成员被忽略。文件夹至少有一个 Running 成员才出现在 Home。部分运行时，辅助技术标签包含实际运行数和现存成员总数，不推断健康状态。全部停止时隐藏该文件夹。页头仍统计实际运行容器数，不把文件夹当成容器计数。

PNG data URI 经格式、大小与尺寸验证后进入已有受认证内存图片缓存。HTTPS PNG 图标由浏览器使用 CORS 直接请求配置中的源，使用 `credentials: omit`、`no-referrer`、`no-store`，不附带 APP_TOKEN；读取超过 512 KiB 会取消请求。不允许带用户名或密码的 URL、HTTP 或其他协议。非 PNG、CORS 不允许或加载失败时使用通用文件夹图标。后端不代理或下载远程 URL，图标不进入离线缓存。对象 URL 和旧请求继续遵循原有释放、取消和会话清理规则。

不导入插件自定义排序、文件夹动作或自定义脚本。跨文件夹重复归属时按配置顺序首次匹配，防止重复展示；不复刻插件 UI 排序改变后对重复归属的优先级。当前主机只有一个 Immich 文件夹，其成员与插件一致。无插件挂载时保持单容器展示；配置损坏时保留原始 Docker 数据并提示分组配置不可用。

## 部署要求

生产模板新增空值的可选只读路径，默认不挂载。安装了 FolderView2 的主机需配置：

```text
/boot/config/plugins/folder.view2 → /host/boot/config/plugins/folder.view2:ro
```

只读挂载整个插件配置目录是为了支持配置文件被替换后的继续读取；程序固定只读 `docker.json`。不需要挂载整个 `/boot`，也不增加 privileged 权限。开发 Compose 原有的 `/boot` 只读挂载已覆盖该路径，不能将其作为生产模板。本次没有修改运行中的容器挂载，也没有部署或推送。

## 验证

| 检查 | 结果 |
| --- | --- |
| 前端全量测试 | 30 个文件、418 项通过 |
| Go race 全量测试 | 通过，包括文件夹源、标签提取、PNG 和快照生命周期测试 |
| 前端生产构建 | 通过，包含 PWA 网络与缓存边界校验 |
| Go server 构建 | 通过，输出到临时目录，未在主机执行 |
| Linux server 交叉编译 | 通过，使用 `CGO_ENABLED=0 GOOS=linux` |
| XML 解析与 `git diff --check` | 通过 |

前端测试覆盖显式成员、标签归属、原生 JS 正则、无效正则、缺失成员、重复归属、部分和全部停止、合并后八项限制、无点击行为、图标认证隔离、流式大小限制和安全回退。后端测试使用合成数据，覆盖源文件缺失／损坏／软链接、字段白名单、配置顺序、内嵌 PNG、快照防御性复制和移除后的图片清理。

浏览器检查使用本地生产构建和合成容器数据，但使用主机中已确认的同一 Immich Logo URL。实际 CSS 视口为 320px，页面无横向溢出，4 个成员显示为一个 Immich 项，Logo 经 CORS fetch 和对象 URL 成功加载。12 个运行容器合并成 9 项，默认显示 8 项，展开后显示 9 项。截图见 [Home 分组预览](home-folder-320.png)。这验证了浏览器链路，不能代替新后端在真实容器中的部署验收。

测试日志：[前端](frontend-tests.log)、[生产构建](production-build.log)；浏览器断言见 [JSON 结果](browser-results.json)。历史 Go race 混合日志已移除，上表保留当日生产测试总结，未生成替代日志或作为当前测试结果。

本机没有 Docker 命令，未运行镜像构建、镜像烟雾检查或 Compose 校验。Go 检查使用本机 Go 1.26.2；Dockerfile 的 Go 1.24 容器构建未运行。真实 Android／iOS、其他插件版本、插件自定义排序下的重复归属，以及新只读挂载的完整生产链路仍未验证。

中文检查只针对本次新增和修改的说明文字，半角标点、破折号和元话语命中均为 0；技术路径、字段和限制保持原义。
