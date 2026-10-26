# FolderView2 线上挂载修正

日期：2026-10-26，时区 Asia/Shanghai。目标为用户指定的 `http://10.0.0.66:18080`。本次发现并修正了部署挂载路径，未修改业务代码、未发布新镜像。

## 原因

线上 Docker API 已正常返回容器和本地图标，但没有 `folders` 字段，诊断数组为空。Unraid 容器配置中的 Folder View 2 Path 实际为：

| 配置 | 修正前 | 修正后 |
| --- | --- | --- |
| Host Path | `/boot/config/plugins/folder.view2` | `/boot/config/plugins/folder.view2` |
| Container Path | `/boot/config/plugins/folder.view2` | `/host/boot/config/plugins/folder.view2` |
| Access Mode | Read Only | Read Only |

程序固定读取 `/host/boot/config/plugins/folder.view2/docker.json`，错误的容器路径导致配置不可见。可选挂载缺失时程序保留单容器展示，因此此前 API 仍为 `available=true`，也没有错误诊断。拉取镜像不会自动修改已有 Unraid 用户模板的路径配置。

## 处理

在用户已登录的 Unraid WebGUI 中，仅修改这一条映射的 Container Path，保留源目录和只读权限，随后应用配置，Unraid 短暂重建 `unraid-mobile` 容器。没有改动其他容器、VM、阵列或应用权限，也没有修改插件配置、令牌和业务代码。README 已补充 Host Path、Container Path、Read Only 和更新既有模板的说明。

## 真实主机验证

- 修正前 API 采样时间为 `2026-10-26T00:36:41.159570387Z`，`available=true`，没有文件夹数据。
- 修正后 API 采样时间为 `2026-10-26T00:39:29.799048002Z`，返回一个 `Immich` 文件夹、4 个成员 ID，以及配置中的 Immich HTTPS 图标地址，诊断数组为空。
- Home 实际显示 `Immich, folder, 4 of 4 containers running`，没有重复展示 `immich_*` 成员，文件夹图标已加载且图片自然宽度大于 0。
- 13 个运行容器合并为 10 个概览项，默认展示 8 项，展开按钮显示剩余 2 项；展开和收起均正常。

证据：[线上截图](home-fixed.png)、[浏览器断言](browser-results.json)、[修正前后摘要](before-after.json)。截图和断言均来自实际线上应用，未使用合成数据。记录只保留分组和挂载诊断所需字段，没有保存令牌、完整 inspect 或宿主机敏感配置。

本次仅调整线上映射并补充文档，没有行为代码改动，因此未重复运行 Go／前端测试和镜像构建；`git diff --check` 通过。未进行 Android／iOS 安装态 PWA 验收。中文说明机械检查的半角标点和破折号命中均为 0。
