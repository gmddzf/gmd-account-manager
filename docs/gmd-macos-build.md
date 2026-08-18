# GMD macOS Universal 构建

本项目使用 GitHub Actions 的 macOS runner 构建 Universal macOS 安装包。Windows 机器不需要、也不应该安装 Xcode 或 macOS SDK。Windows NSIS 包也提供了独立的 GitHub runner 工作流，避免本机下载 WiX/NSIS 工具失败。

## 需要准备的 GitHub 配置

1. 创建一个 GitHub 仓库，建议设为 Private。
2. 将本项目源码推送到仓库。`.gitignore` 已排除 `node_modules`、`target`、`.cache`、`.tools`、构建产物和本地运行数据。
3. 在仓库的 `Settings -> Secrets and variables -> Actions` 添加两个 Repository secret：
   - `TAURI_SIGNING_PRIVATE_KEY`：本机 `.tools/gmd-updater.key` 的完整内容
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：本机 `.tools/gmd-updater.password` 的内容

私钥只能通过 Secrets 提供，不能提交到 Git、Release 资产或日志。Updater 私钥用于 Tauri 更新包签名，不等于 Apple Developer ID 证书。

## 生成 Mac 包

1. 打开仓库的 `Actions` 页面。
2. 选择 `Build GMD macOS Universal`。
3. 点击 `Run workflow`，等待 `Build GMD macOS Universal DMG` 完成。
4. 在该次运行页面的 `Artifacts` 区下载 `gmd-account-manager-macos-universal-*`。

下载包中包含：

- Universal `.dmg`：Intel 和 Apple Silicon 都可以安装
- Tauri updater 的 `.app.tar.gz` 及 `.sig`（用于后续自动更新链路）

工作流文件：`.github/workflows/build-macos-gmd.yml`。

Windows 安装包工作流：`.github/workflows/build-windows-gmd.yml`。它会生成 x64 NSIS 安装包和对应的 updater `.sig`。

## 客户安装提示

没有 Apple Developer ID 签名和公证时，客户第一次打开可能被 Gatekeeper 拦截：在 Finder 中右键应用选择 `Open`，或在“系统设置 -> 隐私与安全性”中选择“仍要打开”。正式对外分发前，应增加 Developer ID Application 签名、`notarytool` 公证和 `stapler` 固定票据；这些需要 Apple 开发者账号和证书，不能由 Windows 本机生成。

## 发布边界

该工作流只构建并上传 GitHub Actions artifact，不会自动覆盖 `subapi.gmd.ink` 的更新清单，也不会调用旧的 Cockpit/Homebrew 发布脚本。确认 Mac 包可安装后，再把对应包和签名归档到 GMD 更新服务器，并单独发布 Mac target manifest。
