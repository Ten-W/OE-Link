# OE Link

> 让 Obsidian 只保留文字，把附件交给 Eagle。

## 1. 基本介绍

OE Link 在 Obsidian 与 Eagle 之间建立稳定的素材引用、导入和管理流程。

`原来的大型 Obsidian 库` -> `OE Link 导入与转换` -> `轻量 Obsidian 文字库` + `独立 Eagle 素材库`

通过 OE Link，可以**将附件从 Obsidian 仓库中逐步剥离并导入 Eagle**，同时在笔记中保留可预览、可定位、可管理的引用。这样既能**减少大量附件对 Obsidian 仓库和同步流程的负担**，也能继续利用 Eagle 的缩略图、标签、文件夹和素材管理能力。

除了桌面端的本地连接，OE Link 还提供**云端读取模式**，让手机、平板或没有运行 Eagle 的电脑，通过 OneDrive 或 WebDAV 查看笔记中引用的 Eagle 素材。

> [!IMPORTANT]
> OE Link 是独立维护的第三方社区插件，与 Obsidian 官方及 Eagle 官方无隶属、授权或背书关系。Eagle、Obsidian、OneDrive 和 WebDAV 等名称及商标归各自权利人所有。

## 2. 安装与使用说明

### 2.1 使用条件与平台支持

- 本地连接模式需要桌面版 Obsidian、Eagle 和 OE Link Helper。
- 云端连接模式支持 OneDrive 或用户自行配置的 WebDAV；移动端固定使用云端连接模式。
- Eagle 是独立的第三方软件，需由用户自行安装并遵守其许可条款。
- OE Link 不负责同步 Obsidian 仓库；可继续使用 Obsidian Sync、Remotely Save 或其他同步工具。
- OE Link 主要在 Windows和Android 开发和测试。桌面端支持本地及云端连接。macOS、Linux 和 iOS 尚未完整测试。

### 2.2 安装 OE Link

在插件正式上架 Obsidian 社区插件市场前，可使用以下方式安装：

1. 从项目的 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 Obsidian 仓库的 `.obsidian/plugins/` 下创建 `oe-link` 文件夹，并把三个文件放入其中。
3. 重启 Obsidian，在“设置 -> 第三方插件”中启用 OE Link。

也可以通过 BRAT 添加本项目的 GitHub 仓库地址进行测试安装。

### 2.3 安装 OE Link Helper

本地连接模式需要 Eagle 端的 OE Link Helper：

1. 打开“设置 -> OE Link”。
2. 检查或自动检测 Eagle 插件目录。
3. 点击“安装/更新 OE Link 辅助插件”。
4. 如未立即生效，请重启 Eagle，或在 Eagle 插件面板中重新加载该插件。

如果安装过使用相同端口的旧版 EagleBridge 或其他 Eagle 插件，请先停用冲突的服务。

### 2.4 首次连接

本地模式下，先打开 Eagle，再在 OE Link 设置中检查连接状态，并确认 Eagle 素材库路径正确。云端模式下，选择 OneDrive 或 WebDAV，完成授权或填写连接信息，再指定已经同步到云端的 Eagle `.library` 路径。

### 2.5 网络、权限与隐私

OE Link 会根据用户选择访问以下位置：

- Obsidian 仓库中的笔记和附件。
- 本机 Eagle API、OE Link Helper 和 Eagle `.library` 素材库。
- 用户授权的 Microsoft OneDrive 或自行配置的 WebDAV 服务。
- 用户主动打开的网络素材原始链接。

云端账号和服务仍由对应提供方管理。分享诊断日志前应先检查内容；日志不应包含密码或访问令牌。

### 2.6 已知限制与安全提示

- **<mark style="background:#ff4d4f">导入后原附件引用会被替换，不能自动恢复！！！</mark>**
- <mark style="background:#ff4d4f">启用“导入后自动清理”会在成功导入后将原附件移入 Obsidian 回收站。建议先备份仓库并手动测试，确认无误后再开启自动功能。</mark>
- 云端模式只读取素材，不远程修改 Eagle 标签、文件夹或素材内容。
- 删除、清理和批量移动前，请确认筛选范围并保留备份。
- 端口、云端权限、素材库路径或原始文件发生变化时，部分素材可能暂时无法显示。
- 分享包导出遇到缺失素材时会提示问题文件；请在分享前检查导出结果。

## 3. 连接模式

```text
本地连接模式：
Obsidian <-> OE Link <-> OE Link Helper <-> Eagle 素材库

云端连接模式：
Obsidian <-> OE Link <-> OneDrive / WebDAV <-> Eagle 素材库
Obsidian Vault <-> Remotely Save 等同步工具 <-> 其他设备
```

**OE Link 负责附件和 Eagle 素材的连接；Obsidian Vault 本身的同步由 Obsidian Sync、Remotely Save 等同步软件负责。**

### 3.1 本地连接模式

本地连接模式适用于安装了 Eagle 的电脑。在此模式下，OE Link 通过 Eagle 本地 API 和 OE Link Helper 完成以下操作：

- 查询、导入和定位 Eagle 素材。
- 写入或清理 Eagle 标签。
- 建立和维护 Eagle 文件夹关系。
- 为笔记中的 OE Link 地址提供图片及附件内容。
- 从 Obsidian 直接在 Eagle 中打开素材或素材所在文件夹。

<img src="./docs/images/local-connection.png" width="467" alt="本地连接设置">

OE Link Helper 是安装在 Eagle 中的辅助插件，负责提供本地素材服务，并帮助 OE Link 找到正确的 Eagle 素材库。

本地素材地址默认使用：

```text
http://localhost:6060
```

Eagle 本地 API 通常默认使用：

```text
http://localhost:41595
```

### 3.2 云端连接模式

云端连接模式适用于手机、平板，或没有运行 Eagle 的电脑。目前支持 Microsoft OneDrive 和用户自行配置的 WebDAV 服务。

云端模式会直接读取已经同步到云端的 Eagle `.library` 素材库，不需要在设备上运行 Eagle。支持：

- 在阅读模式和实时预览中显示 OE Link 图片。
- 根据文件大小选择 Eagle 缩略图或原图。
- 只加载接近当前视口的图片，并限制同时下载数量。
- 手动加载、下载 Eagle 原图或附件。
- 使用本地默认应用打开文档及其他附件。
- 使用 Obsidian 原生音频和视频播放器预览兼容媒体。
- 使用文件卡片显示不能直接预览的附件。

移动端固定使用云端连接模式。云端模式是只读素材访问模式，不会远程修改 Eagle 标签、文件夹或素材内容，也不负责同步 Obsidian 仓库。

| OneDrive                                  | WebDAV                                    |
| ----------------------------------------- | ----------------------------------------- |
| <img src="./docs/images/onedrive-settings.png" width="404" alt="OneDrive 设置"> | <img src="./docs/images/webdav-settings.png" width="266" alt="WebDAV 设置"> |

## 4. 功能介绍

### 4.1 管理功能
以下写入和管理功能仅在本地连接模式可用。

| 附件管理                                      | 标签管理                                      | 文件夹管理                                     |
| ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 把本地图片和其他附件导入 Eagle，笔记中的引用关系继续保留。          | 把 Obsidian 笔记身份、标签同步给 Eagle，便于从笔记反查素材。    | 按照 Obsidian 笔记或文件夹结构，在 Eagle 中整理对应素材。     |
| <img src="./docs/images/attachment-management.png" width="259" alt="附件管理"> | <img src="./docs/images/tag-management.png" width="225" alt="标签管理"> | <img src="./docs/images/folder-management.png" width="215" alt="文件夹管理"> |

### 4.2 界面介绍
| 界面   | 当前笔记界面                                                                                                                                                                                                                                                                                                                                          | Obsidian 素材库界面                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
|      | <img src="./docs/images/current-note-view.png" width="285" alt="当前笔记界面"> | <img src="./docs/images/obsidian-library-view.png" width="287" alt="Obsidian 素材库界面"> |
| 按钮功能 | **添加标签**：为引用素材添加当前笔记标签。<br>**清除标签**：清除当前笔记或全部附件的 Obsidian 管理标签。<br>**复制标签**：复制当前笔记对应的标签。<br>**加入文件夹**：将引用素材加入当前笔记对应的 Eagle 文件夹。<br>**清除文件夹**：移除当前笔记或全部附件的 Obsidian 文件夹归属。<br>**导入附件**：将当前笔记中的附件导入 Eagle。<br>**清理已导入附件**：清理已经导入 Eagle 的本地附件副本。<br>**AUTO 开关**：控制标签、文件夹、附件导入及导入后清理的自动执行。<br>**界面切换按钮**：进入 Obsidian 素材库。<br>**视图按钮**：切换平铺、列表和瀑布模式。 | **界面切换按钮**：返回当前笔记界面。<br>**视图按钮**：切换平铺、列表和瀑布模式。<br>**来源统计条**：筛选 Eagle 库内、Obsidian 库内、Obsidian 库外和网络素材。<br>**引用统计条**：筛选已引用、未引用和回收站素材。 |
| 展示筛选 | 显示当前笔记或白板引用的全部附件。<br>显示素材总数、当前显示数量和已选数量。<br>可按 Eagle 库内、Obsidian 库内、Obsidian 库外和网络来源筛选。<br>按住 `Ctrl` 滚动鼠标滚轮，可调整卡片或列表大小。<br>白板中的笔记卡片可以继续进入，查看该笔记引用的附件。                                                                                                                                                                                           | 汇总显示与 Obsidian 相关的全部素材。<br>显示素材总数、当前显示数量和已选数量。<br>两行统计条可以组合筛选素材来源与引用状态。<br>向下滚动时分批加载更多素材。<br>按住 `Ctrl` 滚动鼠标滚轮，可调整卡片或列表大小。           |
| 素材操作 | **单击素材**：选中素材并定位到正文中的引用位置，或反过来。<br>**Ctrl + 单击**：逐个增加或取消选择。<br>**Shift + 单击**：连续选择一段素材。<br>**双击图片**：打开大图预览。<br>**单击空白区域**：取消全部选择。<br>**右键素材**：打开素材操作菜单。                                                                                                                                                                                         | <                                                                                                                                   |
| 悬停提示 | 悬停素材时显示文件名、素材来源、引用状态和 Eagle 素材 ID。<br>平铺和瀑布模式下，悬停时显示素材信息层。<br>悬停彩色圆点时，分别显示素材来源、已引用、未引用或回收站状态。                                                                                                                                                                                                                                                   | <                                                                                                                                   |

### 4.3 右键菜单

**侧边栏素材右键菜单**

- 复制附件
- 复制附件引用链接
- 导入所选到 Eagle
- 尝试修复
- 移入 Obsidian 回收站
- 移入 Eagle 回收站
- 用默认应用打开
- 打开文件所在位置
- 在浏览器中打开原始链接
- 复制原始链接
- 在 Eagle 中打开
- 打开 Eagle 文件夹
- 定位到引用位置

**笔记内附件右键菜单**

- 导入该附件到 Eagle
- 复制附件
- 复制附件引用链接
- 在 Eagle 中打开
- 定位到引用位置

**笔记文件菜单**

- 导出笔记分享包
- 导出 ZIP
- 导出文件夹

## 5. 项目信息

### 5.1 致谢与灵感来源

OE Link 的部分工作流和界面设计受到以下社区项目及介绍视频启发：

- [Obsidian-EagleBridge](https://github.com/zyjGraphein/Obsidian-EagleBridge)
- [Obsidian EagleBridge 插件介绍](https://www.bilibili.com/video/BV1voQsYaE5W/)
- [Imagine](https://github.com/AlbusGuo/albus-imagine)
- [Imagine 插件介绍](https://www.bilibili.com/video/BV1QfrWBsE9s/)

感谢这些项目为 Obsidian 附件管理提供的思路。OE Link 由本项目独立维护，与上述项目不存在隶属关系。

### 5.2 问题反馈

反馈问题时，请说明 Obsidian、OE Link、Eagle 和 OE Link Helper 的版本，使用的连接模式、操作步骤及实际结果。必要时可附上经过检查的普通诊断或深度诊断日志；请勿公开密码、访问令牌或其他敏感信息。

### 5.3 许可证

OE Link 使用 MIT License。正式发布、下载地址和更新记录以 GitHub 仓库为准。
