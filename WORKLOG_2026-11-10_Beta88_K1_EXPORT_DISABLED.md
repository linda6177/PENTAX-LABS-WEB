# Pentax Labs Web Beta88 — 取消 K-1 自定义滤镜网页导出

日期：2026-11-10
仓库：`linda6177/PENTAX-LABS-WEB`
基线：`731bc90`（Beta87 Web）

## 决定

K-1 用户反馈机内色相/饱和度雷达图不随自定义滤镜改变，且部分 LUT 出现暗部色彩断层。Beta87 只同步了 K-1 启动器和图标，没有解决这两条链。经复核：

- K-1 R29 R.BIN 只有一个 UI 矩阵源 bank（`0x4125A1CC`），没有 K-1 II R367 中的 Natural/Bright 双 bank 同步 stub；K-1 的 OEM 雷达图/Info 不读取自定义槽矩阵。
- K-1 仍使用 P317 显示域拟合；同一 LUT 的 256 点 U14 曲线量化到 8-bit 后，暗部最大相邻阶跃约 7–9/255，K-1 II 的 R369 路径为 5–7/255 且更靠近纯黑。

在 K-1 专用雷达图消费者和暗部拟合问题闭环前，网页端不再提供 K-1 自定义滤镜导出。

## 变更

1. 相机型号选择器移除 `PENTAX K-1`，只保留 `*ist D` 与 `K-1 II`。
2. 旧本地状态中的 `cameraModel=k1` 自动回退到 `k1ii`；切换函数与导出入口显式拒绝 `k1`。
3. `runtime.js` 删除 K-1 runtime 加载、K1N29 分支、R30 启动器生成与 K-1 SHA 校验；`compileCameraScriptFiles` 只接受 K-1 II。
4. 删除 `assets/runtime/k1/` 与 `k1_r30_verify.mjs`。
5. 使用指南、README、关于页更新为 Beta88，并说明取消原因。
6. K-1 的四季滤镜与工程模式资料保留，不受本次取消影响。

## 验证

- `node --check runtime.js app.js` PASS。
- Edge headless + CDP：页面 0 个 JS 异常；17 个原厂滤镜正常；机型下拉只有 `istd` 与 `k1ii`；关于页显示 Beta88。
- 页面内调用 `loadBuiltinRuntime('k1')` 返回 `K-1 网页自定义滤镜导出已取消`。
- `loadBuiltinRuntime('k1ii')` PASS：startup 6,209 B、R.BIN 114,176 B。
- K-1 II 三槽脚本编译 PASS；*ist D 五 TXT 编译 PASS。
- 未进行相机实机验证。

## 回滚

回退本提交即可恢复 Beta87 的 K-1 导出与 runtime 资源；不影响 K-1 II、*ist D、四季滤镜和工程模式。
