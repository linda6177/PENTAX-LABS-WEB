# Pentax Labs Web

Pentax Labs 的浏览器版。Windows 主程序仍是功能真源；Web 与主源码同仓库维护，通过安全白名单同步到公开的 linda6177/PENTAX-LABS-WEB GitHub Pages 仓库。

## beta81 Web

这一版不再是早期的 CUBE/Project 导出演示页，核心目标改为“浏览器里直接完成机内滤镜编辑并导出相机脚本”。

- 响应式复刻桌面 beta80 的 1380×835 三栏布局；1120×690 仍可完整显示。
- 三个自定义槽、K12 当前 17 个生产滤镜、用户 CUBE 导入、本地照片/24 色卡预览、原图按住对比。
- Matrix UI 使用与桌面相同的 Natural-relative 显示/回写基准，9 格全部可编辑且行和保持 256。
- 曲线 UI 使用桌面 relative_curves.py 同一套 P317/DCU5 Natural-relative 显示模型，提供 Master / R / G / B 四通道，不显示裸 U14 绝对数组。
- 饱和度、色相、亮度、对比度、Master/RGB 曲线都进入最终机内参数。
- 主导出为真正的相机 script/ ZIP，不再把 CUBE / 参数 JSON / Project JSON 当成交付目标。
- K-1 / K-1 II 脚本编译会重写三槽 Q13 Matrix、最终 3×256 U14、标题、图标、槽位计数、Natural ID、R/P CRC。
- 为避免公开分发 P.BIN / R.BIN / startup.ttl，首次使用时选择桌面 Pentax Labs 已导出的同机型 script 文件夹一次；底座只保存在当前浏览器 IndexedDB，之后可直接反复导出。

侧栏同时恢复桌面主程序的页面结构：

- 脚本模块：M1 自定义滤镜可直接构建；桌面端仍处于研究状态的 M2/M3 不伪装成正式功能。
- 正负逆冲：本地照片预览、基础影调/去色罩和 PNG 导出。
- 工程模式：读取当前 engineering_payload.json，浏览器本地打包工程入口文件。
- 四季滤镜：按桌面双次开机逻辑生成工程触发文件 + script/startup.ttl。
- 快门查询：Web 本地读取明确的计数字段；桌面 ExifTool 版本仍是完整兼容实现。
- *ist D 工具箱：AF Fine Adjustment 可直接生成 KB321.EEP + MODSET.TXT；中文固件二进制不进入公开 Pages。

## 相对曲线数据

web_preview/assets/relative_curve_profiles.json 是从桌面端当前 P317/DCU5 实测模型抽出的 UI 所需 257 点显示数据和原生 Natural 参考，不包含原始 1 MB NPZ 研究包。Web Bright/R 定向交叉验证与桌面 relative_curves.response() 最大显示差约 7.7e-8 / 255。

## 相机脚本底座

公开 Pages 不会携带 P.BIN、R.BIN、ROM/NAND、原厂固件或私人样张。首次点击“选择 script 底座”时，直接选择桌面版已经导出的整个 script 文件夹即可。浏览器自动识别：

- script/startup.ttl
- script/T/P.BIN
- script/T/R.BIN

这些字节只进入本机浏览器存储，不上传服务器。K-1 与 K-1 II 分开保存。

## 定向验证

    node web_preview/verify.mjs
    node web_preview/runtime_verify.mjs k1ii
    node web_preview/runtime_verify.mjs k1

运行时编译器已经与桌面 native.compile_slot() 交叉核对 Matrix 源 Q13、最终 RGB U14、槽位 mask 和 CRC。

## 发布

私有 monorepo 是唯一研发真源。公开 Pages 只同步白名单文件：

    python tools/publish_web_public.py --push

同步内容包括 Web HTML/CSS/JS、相对曲线 UI 数据、当前生产滤镜库和工程模式数据；不会复制整个私有仓库。
