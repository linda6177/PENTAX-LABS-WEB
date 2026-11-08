# Pentax Labs Web

**在线使用：** [打开 Pentax Labs Web 编辑器](https://linda6177.github.io/PENTAX-LABS-WEB/)

Pentax Labs 的浏览器版。桌面程序仍是算法和机内脚本真源；Web 使用同一生产滤镜库、P317/DCU5 显示模型、CP ROM 数据与相机运行模板。

## 当前功能

- 曲线编辑改为 Lightroom 风格点曲线：单击曲线即可添加并立即拖动控制点；控制点命中半径扩大，鼠标偏心抓取保留指针偏移；触屏禁用浏览器默认平移手势，避免拖动中途取消；触屏双击删除控制点。桌面端与网页端均保留平滑意图模型，Alt+拖动可继续进行整体曲线形变，底层机内 256 节点 Gamma 不变。

- 正负逆冲曲线图现在同时叠加显示 R/G/B 三条原厂 ROM 曲线；移除重复的上方 RGB 切换，保留下方 R/G/B 各自的 0/1/2 编号选择。
- 正负逆冲矩阵来自有限的原厂 ROM 银行，不支持自由编辑。页面不再显示矩阵数值面板，原厂矩阵基底选择与内部成像处理保留；桌面端同步采用同一规则。
- 照片输入统一为 sRGB Canvas、浏览器默认 ICC 色彩转换、EXIF 方向校正和最长边 2560px 高质量缩放，靠近桌面端的照片输入规格。滤镜参数内核未因视觉观感而擅自增加饱和度。
- 导入或应用滤镜时，顶部槽位名称同步为当前滤镜名，自动截取前 6 个字符。
- 浏览器标签图标使用桌面程序的正式 Pentax Labs 图标。
- 右下角只显示「下载桌面版」。链接固定指向公开 GitHub Releases 的 `latest/download/PentaxLabs_Lite_Latest.tar.xz`；每次发布新桌面版时，将新归档以同一资产名上传到新 Release 即可自动更新下载目标，不在网页按钮显示具体版本。

## Beta81 保留功能

- 自定义滤镜预览不再使用 `RGB + style - natural` 简化代理。Web 已移植桌面 `preview.py` 的 Natural 反变换、hardware Matrix 相对变换和 16381 点 P317/DCU5 tone；Natural/Bright/Monochrome/GOLD 的 RGB8 定向样本与桌面逐通道最大差 `0/255`。
- 通道曲线改成平滑显示与平滑局部编辑；“加点”现在是真节点，支持新增、拖动和右键删除。最终仍写回机内 256 点（*ist D 为共享 4096 点）曲线。
- 自定义滤镜相机型号恢复 `PENTAX *ist D / PENTAX K-1 II / PENTAX K-1`。*ist D 使用 signed10 Q8 Matrix + 一条 4096 U8 Gamma，并可直接导出五 TXT。
- K-1 II Web runtime 修正为桌面实际使用的 `assets/p286/P.BIN + R.BIN + startup.ttl`，并在浏览器加载时校验固定 SHA256；不再发布错误的上一级 P/R。K-1 继续使用 R29 专属底座。
- 正负逆冲页面保留 Pentax 原生控制：Random/Extended、原厂 3×3 Matrix 银行、五项参数、RGB 0/1/2 ROM 曲线和 10B 配方。
- 工程模式在 Edge/Chrome 支持 File System Access API 时直接选择目录并写入工程文件；不再把 ZIP 作为主路径。浏览器不支持目录 API 时才回退下载 ZIP。
- 四季滤镜、*ist D 中文固件和 AF 调焦同步采用相同目录选择流程；每次点击都会打开目录选择器，上次目录只作为起始位置。
- *ist D 预览修复逆矩阵转置错误，并加入桌面/Web parity；Natural/Monochrome/Kyushu 与桌面 RGB8 逐值 `max=0/255`。
- Web CUBE 拟合升级为与桌面 R367 对齐的 25³ solver，并改用 canonical Natural。17 个 `PENTAX LUT_33` 生产 LUT 与桌面 final ΔE 平均绝对差约 `0.039`。
- 生产工厂库已从 `PENTAX LUT_33` 重新生成；网页不再展示旧库中遗留的过时模型色差。
- 多语言改为与桌面同源：Web 构建从 `I18n.js + HantData.js` 生成 `i18n.js`，支持 system/简中/繁中/English/日/西/法/德/意/葡/韩/俄/越；system 自动读取浏览器语言。右下角设置可手动切换并记忆，同时提供桌面同组六种强调色 + 自定义颜色入口；使用指南扩展为 10 个详细章节。
- 正负逆冲右侧改为桌面 `CpWorkbench` 的“色彩调节 / 通道曲线”两页结构；Matrix、五项机内参数与 RGB ROM 曲线不再混在一根滚动条。
- 自定义滤镜曲线改为桌面 smooth-intent：先平滑拟合可见曲线，默认只显示端点；可直接拖曲线主体做大范围平滑形变；控制点拖动使用横向 warp + relative deformation + monotone Hermite，双击/加点增加用户手柄，右键删除手柄不改当前效果。
- 照片中央拖入提示已删除；顶部槽位勾选、滑杆、强调色等细节继续向桌面 Beta81 对齐。

## SD 写入

GitHub Pages 无权静默枚举 Windows 盘符或读取全部卷标。第一次点击“导出脚本”仍需要用户在系统 picker 中授权一次 SD 根目录；授权的目录句柄保存在 IndexedDB。若目录名含 `DCRAM`，状态栏会识别为 DCRAM SD 卡，后续导出优先复用该目录。

## 定向验证

    python tools/make_web_preview_parity_fixture.py
    node web_preview/preview_parity_verify.mjs
    node web_preview/runtime_verify.mjs k1ii
    node web_preview/runtime_verify.mjs k1

Web 预览 parity：`max=0/255`。K-1 II P286 与 K-1 R29 runtime build 均 PASS。*ist D 五 TXT 结构 PASS；平滑曲线定向测试单节点编辑最大相邻步长约 `0.00869`。

## 发布

    python tools/publish_web_public.py --push

公开仓库只同步显式白名单，包括 Web 静态文件、生产参数、显示内核、CP ROM 数据、K-1/K-1 II Web runtime 和 *ist D 所需资源；不发布 NAND、ROM 研究镜像或私人样张。
