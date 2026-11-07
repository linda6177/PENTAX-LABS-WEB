# Pentax Labs Web

Pentax Labs 的公开 Web 发布仓库。这里只保留 GitHub Pages 运行所需的安全静态文件，不包含 Windows 主程序源码、P.BIN / R.BIN、startup.ttl、ROM、NAND、固件镜像或私人实拍文件。

当前 Web 基线来自 Pentax Labs beta80 主线，核心功能：

- 三个自定义滤镜槽；
- K12 当前 17 个生产滤镜；
- 本地照片 / 色卡预览与原图对比；
- 3D CUBE 导入和原始 LUT 预览；
- Natural-relative Q8 Matrix + RGB U14 浏览器参数拟合；
- 3×3 Matrix、RGB 256 节点 Gamma、亮度与对比度编辑；
- CUBE、参数 JSON、桌面兼容 Pentax Labs Project JSON 导出。

所有照片和 LUT 都在浏览器本地处理。

完整相机脚本仍由 Windows Pentax Labs 使用本地原生运行底座生成。

Source baseline: private PENTAX-LABS main. The exact synchronized source commit is recorded in version.json.
