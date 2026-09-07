# OE Link

0.5.69 - Adds useful shared actions for multi-selected assets and original-link copying.

0.5.65 - Adds native range selection, compact source/status markers, and an independent trash filter.

0.5.64 - Simplifies attachment selection and limits multi-select menus to shared batch actions.

0.5.63 - Adds sidebar attachment selection and selected import actions, and compacts WebDAV fields.

0.5.62 - Compacts rebuild actions, clarifies link replacement, and updates plugin authorship.

0.5.61 - Compacts attachment settings and clarifies rebuild scope and folder-tree limitations.

0.5.60 - Groups attachment options, clarifies the default Eagle destination, and warns about folder-tree mirroring limitations.

0.5.58 - Adds cloud attachment download and desktop default-app actions.

0.5.48 - Renders imported non-image Eagle assets as file cards or native media controls, applies note tags during manual imports, and unifies attachment-import menu wording.

0.5.47 - Leaves every editor file drop to Obsidian when attachment AUTO import is disabled.

0.5.46 - Opens Eagle items immediately through the protocol when Helper navigation takes longer than 250 ms, while retaining Helper precision in the background.

0.5.45 - Moved external-library import below the media-service address and removed unused legacy code and styles.

## 0.5.44

- Unified context-menu icons and submenus, removed the redundant reference separator, and parallelized the first Obsidian library source scan.

## 0.5.43

- Made missing Helper detection fast and removed full-vault scanning from the rendered-image context-menu hot path.

## 0.5.42

- Fixed external-local thumbnails, attachment-only editor menus, nested reference navigation, menu icon alignment, and a full-library hashing slowdown during imports.

## 0.5.41

- 笔记和白板的身份日期首次确定后永久保持，重命名或同步文件时间变化不再生成重复标签和文件夹。
- OE Link Helper 自动避让被占用的控制端口，Obsidian 自动识别正确的 Helper 实例。
- 侧边栏右键菜单恢复当前笔记引用定位，并可打开素材所属的任意 Eagle 文件夹。

## 0.5.40

- OE Link 扫描 Obsidian 仓库时自动排除其中的 Eagle `.library` 素材库，避免其内部文件被统计、导入或清理。

## 0.5.39

- 当前笔记素材按正文引用顺序显示，并补全 Obsidian 库外图片的双向定位。
- “在 Eagle 中打开”改为直接定位素材，不再依赖其第一个所属文件夹。
- 本地连接模式新增一次性诊断日志导出，用于检查 6060 图片服务和 Eagle 素材定位。

## 0.5.37

- 加载 Eagle 原图时，放大层关闭后正文图片继续显示加载状态，完成后标记为“已加载 Eagle 原图”。
- 设置页版本号直接读取插件清单，避免显示版本与安装版本不一致。
- 移除已停用的云端图片加载诊断记录。

## 0.5.27

- 全新安装时默认关闭标签、文件夹、附件导入及刷新相关 AUTO 开关。
- 移动端将 WebDAV 地址、用户名和密码合并为一个设置卡片。

## 0.5.26

- 恢复移动端图片单击即放大的原生交互，并恢复放大界面的原图加载提示。
- 移除点击图片时额外出现的原图加载动画，不再拦截 Obsidian 图片查看器。

## 0.5.25

- 移动端按原图大小决定直载或预览，OneDrive 与 WebDAV 都优先使用 Eagle 自带缩略图。
- 已显示原图时标记“原图已加载”；加载原图时阻止点击关闭图片查看界面。
- 调整素材库选择窗口按钮布局，并为 WebDAV 增加目录浏览与手动路径回退。

## 0.5.24

- Eagle 目标文件夹支持粘贴完整链接或文件夹 ID，并精简素材库路径示例。
- 修复浅色主题下视图图标和 AUTO 轨道不清晰的问题。
- 两处图片右键菜单统一 OE Link 图标与原生对齐，并在正文菜单列出引用位置。

## 0.5.23

- 设置页顺序调整为语言、Eagle 素材库路径、OE Link 辅助插件，再显示其余设置。
- 精简 Eagle 目标文件夹 ID 与辅助插件说明，并补充复制文件夹链接的简短示例。

## 0.5.22

- 移除 Eagle API 与 OE Link 素材服务设置项前的红色星号。
- 统一修正现有 OE Link 引用时套用当前替换模板，并保留原文件名与显示宽度。
- 正文及表格图片右键菜单加入 OE Link 操作；未导入图片显示导入，已导入图片显示复制附件、复制引用和在 Eagle 中打开。

## 0.5.21

- 设置界面及错误提示中的旧 `Companion` 名称统一改为 `OE Link` 或 `OE Link Helper`。

## 0.5.20

- 清理已导入附件前扫描全库引用，排除 Eagle `.library`，并校验本地文件与 Eagle 原文件内容一致，避免误删共享附件或素材库原件。
- 统一版本显示和构建流程；一次构建会重新生成桌面包、跨平台 `main.js` 与 `release/oe-link`。
- 发布包不再携带个人 `data.json`，安装或更新时不会覆盖用户设置。

## 0.5.19

- 更新 OE Link Logo，并继续适配 Obsidian 明暗主题。
- 明确替换模板会自动继承原图片宽度，统一修正不会套用该模板。

## 0.5.18

- 使用新的 OE Link 自适应主题图标。
- 素材库第一栏固定显示全库来源统计，第二栏随来源筛选动态统计状态。

## 0.5.17

- 修复笔记内容变化和切换笔记后，当前笔记素材侧栏不再自动刷新的问题。

- 恢复启动和切换笔记时的侧边栏自动刷新，并消除事件顺序导致的刷新丢失。
- 定位时优先滚动已渲染图片，避免源码滚动动画把页面拖到文末。

## 0.5.15

- 将旧表格链接修复移入设置中的一次性统一修正，不再在打开笔记时检查。
- 统一当前笔记统计文字和导入按钮圆角，并调整素材库批量按钮名称。

## 0.5.14

- 打开 Markdown 笔记时自动修复旧版本损坏的表格图片链接。

## 0.5.13

- 修复表格中的图片尺寸标记被误当成分列符的问题。
- 修复桌面端无法从 Eagle 回收站素材目录读取原图的问题。
- 统一统计条小分段的最小宽度。

## 0.5.12

- 修复桌面源码未进入最终发布包的问题，并增加发布产物验证。

## 0.5.11

- 小占比统计段改用固定宽度，两条统计条间距增加 2px。
- 移除刷新按钮及其空白占位，侧边栏始终自动刷新。

## 0.5.10

- 修复统计条选中状态数字不可见，并让未选中描边正确贴合胶囊圆角。

## 0.5.9

- 将手动刷新改为右侧原生图标按钮，并统一调整素材统计条的选中与未选中样式。

## 0.5.8

- 移动端加载动画固定显示在附件名称末尾。

## 0.5.7

- 移动端编辑模式也会加载 OE Link 图片。
- 图片按视口加载，失败后重新滚入视野会自动重试，并显示转圈状态。
- 非图片 OE Link 附件可点按下载。

## 0.5.6

- 移动端加载日志新增排队、文件大小、实际接收字节、加载策略、缩略图回退原因和估算吞吐量，便于定位慢加载阶段；加载行为不变。

## 0.5.5

- Added a mobile OneDrive preview threshold. Images up to the configured size load directly; larger images use OneDrive thumbnails. Set the threshold to `0` to always use thumbnails.

## 0.5.4

- Mobile reading can use either OneDrive or a read-only WebDAV Eagle library.
- Removed the built-in experimental Vault sync; use Remotely Save for Vault synchronization.
- Removed desktop/mobile settings-page switching. Each platform shows only its own settings.
- Added a mobile image-loading diagnostic log export. Exported logs contain timings and errors, never passwords or tokens.

## 0.5.3

- 补全跨平台设置镜像：可同步字段可直接编辑，设备专属操作明确标注并保留安全边界。

## 0.5.2 Cross-platform settings editor (superseded by 0.5.4)

## 0.5.1 OE Link Helper identity

The bundled Eagle plugin is now named `OE Link Helper`, with plugin ID and folder name `oe-link-helper` and version `0.2.10`.

## 0.5.0 OE Link identity

The Obsidian plugin is now named `OE Link` and uses the plugin ID and folder name `oe-link`.
Existing EagleBridge media URLs remain supported so current notes do not need migration.

## 0.4.221 mobile authentication fix

The Microsoft public-client Application ID is now built in, so users no longer need to enter it. Device-code request failures are also shown as an Obsidian notice instead of silently ending the connection attempt.

## 0.4.223 mobile loading and folder picker

Mobile images now start loading only when they enter or approach the viewport, so the visible part of a long note is served before distant images. The OneDrive folder picker uses compact top actions for returning and selecting the current folder; tapping a folder row opens it.

## 0.4.220 mobile OneDrive reader and experimental sync (sync removed in 0.5.4)

The Android/iOS branch loads EagleBridge image links directly from a user-selected OneDrive `.library` folder through Microsoft Graph. The former experimental Vault sync was removed in `0.5.4`; use Remotely Save or another dedicated Vault synchronization tool.

Version `0.4.218`.

The package now builds the desktop implementation and mobile shell into one `main.js`. This avoids
mobile runtime dependency on sibling-module loading while keeping the two platform sources separate.

This OE Link plugin supports these workflows:

1. Show Eagle assets related to the current note by `uid`/`id` tag.
2. Import local Obsidian attachments into Eagle and replace the note embed with an EagleBridge URL.
3. Import all local attachments in the current note from the Eagle side panel button.
4. Sync current note `uid`/`id` tags onto EagleBridge links already used in the current note.
5. Deduplicate repeated local attachment references during batch import.
6. Toggle the Eagle side panel from the left ribbon without automatically opening Eagle.
7. Auto-sync current note `uid`/`id` tags when EagleBridge links are added to the active note.
8. Mark EagleBridge images whose Eagle asset appears to be in Eagle trash.
9. Serve existing `http://localhost:6060/images/ITEM_ID.info` links through the bundled Eagle helper, without requiring EagleBridge's media server.

## OE Link Media Service

This release keeps the established `localhost:6060/images/ITEM_ID.info` link format, but the bundled
`OE Link Helper` now owns the service. Configure the port and one or more Eagle
`.library` paths in OE Link settings, then install or update the bundled helper in Eagle and restart Eagle.

Only one plugin can listen on port `6060`. Disable any other Eagle plugin using this port before enabling OE Link Media Service.

## Install

Copy this whole folder to:

```text
YourVault/.obsidian/plugins/oe-link/
```

Then reload Obsidian community plugins and enable:

```text
OE Link
```

## Current Note Eagle View

Open a note with frontmatter/properties like:

```yaml
---
id: 24159cf5-28cc-42cb-84df-04e65f2e27cc
---
```

Click the Eagle icon in the left ribbon.

Clicking the same Eagle icon again while the panel is showing the same note closes the side panel. The icon no longer opens Eagle automatically; use the `Open Eagle` button inside the side panel instead.

Default searched tags:

```text
obsidian-uid-24159cf5-28cc-42cb-84df-04e65f2e27cc
```

When this panel opens or refreshes, the plugin scans the current note for EagleBridge links like:

```text
http://localhost:6060/images/ITEM_ID.info
```

It then adds the current note's `obsidian-uid-{uid/id}` tag to those existing Eagle assets. This allows the same Eagle image to carry tags for multiple Obsidian notes.

In `0.4.1`, this sync also happens automatically after the active Markdown note changes. For example, dragging an existing EagleBridge image link into another note will add that note's UID tag to the Eagle asset after a short debounce.

In this local `0.4.2` build, the `Eagle trash` badge in the note is rendered as a small fixed badge below the image, so it no longer stretches or squeezes the image layout.

In `0.3.8`, side panel thumbnails prefer EagleBridge URLs, matching the links used in notes.

Also in `0.3.8`, the plugin no longer adds the raw UID tag by default. When syncing EagleBridge links for the current note, it removes that current note's raw UID tag if it exists.

## Import Attachments To Eagle

Side panel button:

```text
Import note attachments
```

Command palette:

```text
Import current note attachments to Eagle
```

Right-click in the editor on an attachment link:

```text
Import this attachment to Eagle
```

Right-click a rendered image:

```text
Import this image to Eagle
```

In `0.3.5`, the injected rendered-image menu item gets hover/selected styling so it behaves more like a native Obsidian menu item.

Supported local embeds include:

```markdown
![[image.png]]
![image](image.png)
![[file.pdf]]
```

Recognized attachment extensions include common images, PDF, video, audio, Office documents, spreadsheets, presentations, text files, and archives:

```text
jpg, jpeg, png, gif, webp, avif, bmp, svg, tif, tiff, heic, heif, ico, raw,
pdf,
mp4, mov, webm, mkv, avi, wmv, m4v, flv,
mp3, wav, m4a, aac, flac, ogg, opus, wma,
doc, docx, rtf, odt,
ppt, pptx, pps, ppsx, odp,
xls, xlsx, csv, ods,
txt, md,
zip, rar, 7z, tar, gz
```

Import support only means the plugin will try to send these files to Eagle. Preview/rendering still depends on Eagle, EagleBridge, and Obsidian.

The plugin imports the file into Eagle with the current note UID/id tags, then replaces the note link with the configured replacement template.

In `0.3.9`, if the same local attachment appears multiple times in one note, batch import sends it to Eagle only once and reuses the same EagleBridge link for every occurrence.

The default replacement now follows EagleBridge's standard Markdown embed style.

```text
![{filename}|undefined|200]({bridgeUrl})
```

For example:

```text
![image.png|undefined|200](http://localhost:6060/images/MQYOR1V3W2VH3.info)
```

If a note already contains double-rendering links like:

```text
![image|200](http://localhost:6060/images/MQYOR1V3W2VH3.info)
```

Run:

```text
Convert EagleBridge image embeds to links in current note
```

For the current version, prefer:

```text
Convert EagleBridge links to standard embeds in current note
```

In `0.2.2`, Eagle thumbnail API links are resolved to real local `file:///...` paths before replacing note embeds. This avoids showing Eagle API JSON text inside Obsidian.

If a note already contains bad links like:

```text
http://localhost:41595/api/item/thumbnail?id=...
```

Run this command:

```text
Fix Eagle thumbnail API links in current note
```

If a note already contains broken links with `%25E7%25...`, run:

```text
Fix double-encoded file links in current note
```

If a note already contains direct Eagle library file links like:

```text
file:///C:/.../Eagle...library/images/MQYOR1V3W2VH3.info/_thumbnail.png
```

Run:

```text
Convert Eagle file links to EagleBridge links in current note
```

For safety, local files are not cleaned up by default. Enable this setting only after testing:

```text
Auto cleanup imported attachments
```

## Settings

- `Eagle API URL`: usually `http://localhost:41595`
- `UID fields`: default `uid,id`
- `Eagle tag prefixes`: default `obsidian-uid-`
- `Add note name tag`: on by default. Adds an extra Markdown-note-only tag based on the note name.
- `Note name tag prefixes`: default `obsidian-`
- `EagleBridge URL`: default `http://localhost:6060`
- `Replacement template`: default `![{filename}|undefined|200]({bridgeUrl})`
- `Auto cleanup imported attachments`: off by default
