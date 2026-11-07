# Pentax Labs Web

Pentax Labs beta80 的浏览器版。Windows 主程序仍是研发真源；Web 从同一生产滤镜库、相对曲线模型与机内运行模板构建，通过 `tools/publish_web_public.py` 同步到公开 Pages 仓库。

## beta80 Web parity

- 自定义滤镜页按桌面 `Main.qml` 复刻：82px 顶栏、三槽居中、顶部“导出脚本”、左侧滤镜库、中间纯预览画布 + 52px 工具条、右侧“色彩矩阵 / 通道曲线”、47px 底栏。
- 保留 beta80 Lite 页面：自定义滤镜、正负逆冲、工程模式、四季滤镜、*ist D 工具箱；不提供脚本模块和快门查询。
- K12 当前 17 个生产滤镜与用户 CUBE 导入均可用。
- 导入 JPG / PNG / WebP / AVIF 后，中间主预览与左侧全部 76×56 滤镜缩略图使用同一张照片同步重算；切回色卡同理。
- Matrix 使用桌面相同 Natural-relative 显示/回写，9 格可编辑。
- Master / R / G / B 曲线使用桌面 P317/DCU5 Natural-relative 显示模型，不显示裸 U14 绝对值。
- 亮度、对比度、饱和度、色相与最终 RGB 曲线都会进入机内脚本编译。
- K-1 II 与 K-1 正式 beta80 运行模板随 Web 发布，不再要求用户选择 P.BIN / R.BIN / startup.ttl 底座。
- 顶部“导出脚本”在支持 File System Access API 的浏览器中直接写入所选 SD 根目录的 `script/`。目录句柄保存在 IndexedDB，后续优先复用；若目录名为 DCRAM，会标记为 DCRAM SD 卡。

浏览器安全模型不允许网页静默枚举 Windows 盘符或读取所有卷标，因此第一次无法在没有用户授权的情况下自动扫描并选中 DCRAM。第一次点击“导出脚本”需要在系统目录选择器中选一次 SD 卡根目录；之后 Edge/Chrome 会复用该授权目录。无法使用目录写入 API 的浏览器回退为 script ZIP 下载。

## *ist D

Web 同步 beta80 Lite 的中文固件与焦点补偿入口：中文固件固定输出 `FWDC112B.BIN`；AF Fine Adjustment 输出 `KB321.EEP + MODSET.TXT`。

## 定向验证

    node web_preview/verify.mjs
    node web_preview/runtime_verify.mjs k1ii
    node web_preview/runtime_verify.mjs k1

K-1 / K-1 II 运行时编译器已与桌面核心交叉核对 Matrix 源 Q13、最终 RGB U14、槽位 mask 与 R/P CRC。Edge 1120×690 与 1380×835 本地 HTTP 首屏均能加载 17 个生产滤镜和完整自定义滤镜 UI。

## 发布

    python tools/publish_web_public.py --push

公开仓库只同步明确白名单：Web 静态文件、生产滤镜/曲线/工程数据、K-1/K-1 II Web 运行模板和 *ist D 中文固件，不同步 NAND、ROM、研究样张或私有研究目录。
