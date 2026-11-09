# Pentax Labs 使用说明书

在线版：<https://linda6177.github.io/PENTAX-LABS-WEB/>

桌面版：<https://github.com/linda6177/PENTAX-LABS-WEB/releases/latest>

本文对应 Pentax Labs 公共发行版。界面文字会随版本调整；如按钮名称与本文略有差异，以当前软件界面为准。

## 目录

1. 版本选择与首次启动
2. 自定义滤镜工作流
3. 矩阵与曲线编辑
4. LUT / CUBE 导入与拟合
5. 相机机型与脚本导出
6. 正负逆冲
7. 工程模式
8. 四季滤镜启用
9. *ist D 工具箱
10. 多语言、预览与文件管理
11. 常见问题与安全检查

## 1. 版本选择与首次启动

### Web

使用 Edge 或 Chrome 打开在线地址。Web 版无需安装，适合快速编辑、预览和导出。首次使用本地目录写入功能时，浏览器会弹出系统目录授权窗口；用户必须主动选择目标文件夹。浏览器不会在后台扫描磁盘，也不会未经授权访问 SD 卡。

### Windows 桌面版

从 GitHub Releases 下载最新桌面包，完整解压后运行包内主程序。必须保留 `_internal` 等配套运行目录，不能只拿走 EXE。桌面版适合长期本地使用、管理滤镜和直接向 SD 卡目录导出文件。

首次使用建议先建立一个普通电脑测试文件夹，确认导出内容和目录结构正确后，再选择 SD 卡根目录。

## 2. 自定义滤镜工作流

1. 打开「自定义滤镜」页面。
2. 在原厂滤镜库选择一个接近目标效果的风格，或从自然风格开始。
3. 选择预览照片；也可以先使用内置色卡观察中性色、肤色、饱和色和暗部变化。
4. 选择相机型号。型号会影响矩阵、Gamma 量化方式和最终脚本结构，必须与实际机身一致。
5. 调整矩阵、亮度曲线和 R/G/B 通道曲线；按需要调整其他可用影调参数。
6. 通过原图对比检查效果，保存到用户滤镜库。
7. 导出 LUT、图片或相机脚本。脚本导出前再次确认机型、槽位和输出目录。

用户滤镜支持重命名、排序、批量选择、导出和删除。长按滤镜可进入多选；桌面端可按界面提示使用右键等快捷操作。删除前确认选择的是用户滤镜，而非原厂滤镜。

## 3. 矩阵与曲线编辑

### 矩阵

3×3 RGB 矩阵用于调整通道混合关系。它可以改变颜色响应，但不能单独表达完整的三维色彩查找表。矩阵的可用数值范围、定点格式和导出精度由当前相机型号决定。

### 曲线

- 单击曲线可添加控制点，并在同一拖动过程中调整。
- 拖动已有控制点可对局部亮度或单个颜色通道进行调整。
- `Alt` + 拖动曲线主体可进行整体平滑形变。
- 右键单击中间控制点可删除该点；触屏设备按界面交互提示操作。
- 「线性」返回自然基准线；「恢复」返回当前滤镜预设曲线。
- 桌面端可使用 `Ctrl+Z` 撤销一次完整编辑手势。

曲线编辑器采用平滑意图模型显示和编辑曲线，最终仍会量化到对应机身可用的 Gamma 节点格式。曲线图显示的平滑程度不代表机内存储节点数量增加。

## 4. LUT / CUBE 导入与拟合

1. 在设置中的 LUT 工具或滤镜导入入口选择 `.cube` 文件。
2. 确认 LUT 的输入色彩空间、Gamma 和尺寸信息；不确定时先用默认 sRGB 设置，并与原始照片核对。
3. 执行拟合后查看预览和拟合误差。
4. 保存拟合结果为用户滤镜，必要时导出 LUT 或相机脚本。

LUT 拟合是将外部变换近似映射到相机可控参数，不是把完整 3D LUT 原样写进相机。局部色相变化、复杂色彩分离和高维变换可能出现拟合误差。软件拟合评分衡量的是拟合模型本身，不等同于机内 JPEG 与桌面预览的最终色差。

K-1 II 使用 R369 原生 Matrix/Gamma 模型和 12k Natural 相机校准样本；*ist D 仍使用 P317 路线；K-1 自定义滤镜网页导出自 Beta88 起取消。Web 端与桌面端共享 R369 校准数据、原生矩阵基底和暗部加权目标，但分别使用 JavaScript 分块优化器与 SciPy 优化器，因此 Q8 矩阵可以逐项一致，Gamma 量化值仍可能有小幅差异。旧版浏览器用户滤镜若保留了原始 CUBE，会在启动时自动重新拟合；没有原始 CUBE 的旧滤镜需要重新导入。

## 5. 相机机型与脚本导出

当前网页版自定义滤镜脚本导出器提供两种机型配置：

| 界面机型 | 运行时 / 色彩能力说明 |
|---|---|
| PENTAX *ist D | signed 3×3 Matrix 与共享 4096 点 Gamma；不支持三路独立 RGB Gamma |
| PENTAX K-1 II | P286 架构的 R367 稳定运行底座；LUT 导入使用 R369 原生 Matrix/Gamma 拟合；不可与原版 K-1 的 R29 文件混用 |

**原版 K-1 自定义滤镜网页导出自 Beta88 起取消。** 原因是 K-1 机内雷达图/Info 参数不跟随自定义矩阵，且 P317 路线在部分 LUT 上出现比 K-1 II R369 更明显的暗部阶跃；在这些问题闭环前网页端不再提供 K-1 选项。K-1 的四季滤镜与工程模式资料仍保留。

K12 是项目内部对 K-1 II 平台研究线的简称，公开界面统一使用 K-1 II。选择正确机型后，选择要写入的槽位并导出。程序会按目标平台生成所需资源；不要自行替换不同机型的运行时文件。

**实机验证原则：** K-1 II 使用独立 P286/R367 底座。R369 是 K-1 II 的原生 Matrix/Gamma LUT 拟合模型，Web 使用 JS 分块优化器，桌面使用 SciPy 优化器，两者共用校准样本与目标函数但 Gamma 数值可能存在小幅差异。每一组新编辑参数仍需在目标机身上检查槽位显示、切换、拍摄和重启后的行为。不要把“脚本成功导出”理解为“所有机型和参数组合都已实机验证”。

## 6. 正负逆冲

1. 进入「正负逆冲」，选择一张预览照片。
2. 在「色彩调节」页选择 Random 或 Extended 生成模式和原厂矩阵基底。
3. 调整饱和度、色相、影调、对比度、锐度等可用参数。
4. 切换到「通道曲线」查看 R/G/B 三路原厂 ROM 曲线，并分别选择通道曲线编号。
5. 导出机内 10B 配方，或导出当前预览 PNG。

此页面使用有限的原厂矩阵银行。矩阵数值编辑面板已移除，不提供自由编辑矩阵；矩阵仅作为原厂内部处理基底参与成像。

## 7. 工程模式

工程模式资料按机型列出入口类型、文件和教程。请严格按照相机型号及固件版本选择，不要仅凭外观相似就套用其他机型方案。

### 操作步骤

1. 进入「工程模式」，选择准确机型。
2. 选择该机型对应的入口类型（例如 Service、Factory 或对应的按键教程）。
3. 阅读页面中的适用固件、验证状态和退出方式。
4. 选择 SD 卡根目录或测试目录，导出入口文件。
5. 安全弹出 SD 卡，按照页面教程进入相机菜单。
6. 完成操作后按对应教程关闭入口或恢复原设置。

### 证据等级

工程资料库并非所有条目都达到相同验证程度。条目可能属于公开教程整理、公开文件重建、固件元数据核验、固件原始函数离线验证或用户实机确认。只有明确标注实机确认的内容才代表对应设备上已有实际操作证据；仍标注待实机的项目应谨慎处理。

特别注意：K-3 III 的 Service Menu 和 Factory Menu 是不同入口；脚本开关位于 Factory 菜单对应路径。不要把 Service 菜单误认为 Factory 菜单。

## 8. 四季滤镜启用

### 适配范围

- PENTAX K-1
- PENTAX K-1 II（项目内部简称 K12）
- PENTAX K-3 III 彩色版
- PENTAX KF

K-3 III Monochrome 不在本功能适配范围。不同机型使用的入口文件名、菜单路径和季节命令后缀可能不同，必须在四季页面选择准确型号。

### 推荐步骤

1. 选择机型并阅读该机型专属教程。
2. 导出对应的工程菜单入口文件，按说明在机身打开 Script Mode。
3. 如果页面提供脚本探测选项，先导出探测脚本并确认机身确实执行。
4. 回到四季滤镜页面，选择春、夏、秋、冬中的目标项目，或使用全选。
5. 导出启用包到 SD 卡根目录，安全弹出后装回相机。
6. 正常启动相机，在自定义影像菜单中检查对应季节项目，并拍摄 RAW+JPEG 验证。

### 撤销与持久性

「撤销选中四季」只撤销当前选中的季节；若要清除全部强制标志，按页面说明全选后撤销。部分机型在没有启动脚本的情况下重启后，强制启用状态可能消失；K-1 II / K12 已有相关实测记录。请遵循具体机型教程决定是否保留启动脚本。

脚本写入成功、脚本返回标记出现，都不能单独证明相机菜单已启用或拍摄结果正确。最终必须以机身菜单和实拍为准。

## 9. *ist D 工具箱

### 中文固件

工具提供 Firmware 1.12 中文固件文件导出，文件名固定为 `FWDC112B.BIN`。软件只负责生成文件，不会直接刷写机身。升级前确认设备型号、电池电量和文件完整性，并严格遵循相机自身固件升级流程。

### AF Fine Adjustment

调焦补偿范围为 −64 至 +64，默认 +32。该数值应依据当前机身和镜头组合的实际对焦测试决定，不应将其他机身的结果直接套用。

## 10. 多语言、预览与文件管理

- 语言选项：系统自动、简体中文、繁体中文、English、日本語、Español、Français、Deutsch、Italiano、Português、한국어、Русский、Tiếng Việt。
- 系统自动会读取浏览器或系统语言；也可以在设置中手动切换，选择会被记忆。
- 照片预览在本地浏览器或桌面程序内处理；Web 预览不需要将照片上传到服务器。
- 预览区支持缩放、平移、适配和原图对比；具体手势按当前界面提示操作。
- Web 写入目录必须由用户通过浏览器系统选择器授权；桌面端可直接选择本地文件夹。
- 导出时建议选择 SD 卡根目录，不要选择卡内的 `script` 子目录作为根目录。

## 11. 常见问题与安全检查

**导出完成但相机没有出现滤镜？** 先检查机型选择、固件版本、卡槽、SD 卡根目录、脚本模式是否开启，以及是否按要求普通开机执行启动脚本。不要重复混写其他机型的文件。

**Web 无法直接写入 SD 卡？** 检查浏览器是否为 Edge / Chrome、是否允许目录访问，以及是否在目录选择器中主动授权。浏览器不支持目录 API 时会使用文件下载回退流程。

**预览与机内 JPEG 不完全一致？** 预览模型、外部 LUT 拟合和机身完整 ISP 管线不是同一层级。请使用固定光线、固定白平衡、固定曝光和同一测试场景拍摄对照，避免仅凭屏幕观感判定算法误差。

**曲线点不好抓或拖动中断？** 使用控制点附近更大的可见命中范围；触屏时避免浏览器页面滚动手势覆盖画布。桌面端可用鼠标精细拖动。

**操作前检查清单：**

- [ ] 已确认相机型号和固件版本。
- [ ] 已备份 SD 卡重要文件。
- [ ] 已确认写入的是 SD 卡根目录，而非 `script` 子目录。
- [ ] 没有混入其他机型的工程入口或启动脚本。
- [ ] 已阅读该功能对应机型的验证状态和退出说明。
- [ ] 写卡后已安全弹出，并在相机菜单及实拍中验证结果。

---

## English quick reference

Pentax Labs is an independent toolkit for Pentax camera users. The Web edition provides browser-based filter editing, photo preview, matrix and curve controls, LUT/CUBE fitting, cross-processing recipes, engineering-entry resources, Four Seasons script packages, and *ist D utilities. The Windows desktop edition adds a fuller local file workflow and direct folder export.

Custom-filter script profiles currently cover the *ist D and K-1 II (P286/R367 runtime). K-1 II LUT imports use the R369 native Matrix/Gamma fit; Web and desktop share its calibration basis, with a JavaScript block optimizer in Web and SciPy on desktop. These camera runtimes are not interchangeable. Original K-1 custom-filter web export was removed in Beta88 (in-camera radar/Info does not follow custom matrices and the P317 path shows stronger shadow banding on some LUTs); K-1 Four Seasons and engineering resources remain available. Four Seasons packages target the K-1, K-1 II, colour K-3 III, and KF; the K-3 III Monochrome is excluded. Engineering resources cover additional models, but each entry has its own evidence and firmware scope. A model appearing in the database does not mean every firmware revision has been camera-tested.

Always select the exact camera model, back up the SD card, export to the card root, safely eject it, and follow the model-specific instructions. A successful file export does not prove that a camera feature has been activated. Verify the camera menu and actual RAW/JPEG captures. Complex 3D LUTs cannot be losslessly represented by a camera matrix and tone curves. Pentax Labs is unofficial and is not affiliated with or endorsed by RICOH IMAGING or PENTAX.
