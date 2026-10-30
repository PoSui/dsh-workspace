# 家里电脑：一次装齐 DSH 插件

把本文件拷到家里电脑（或从 GitHub 仓库 pull 本文件），用 PowerShell 运行。
前提：DSH 已装好、`dsh` 命令可用（DSH 安装目录下的 cli）。

## 用法

```powershell
# 1) 进入本文件所在目录
cd <本文件所在目录>

# 2) 按需修改第一行的 dsh 调用方式（若 dsh 不在 PATH，写成完整路径）
# 3) 运行
pwsh -ExecutionPolicy Bypass -File .\install-dsh-plugins.ps1
```

## 说明

- 脚本会逐个执行 `dsh plugin --profile desktop add 包名@版本`；
- 已装过的包会跳过（脚本先查 node_modules）；
- 全部装完提示重启 DSH；
- 第 4 个（WorkBuddy）、第 2 个（Hindsight）装完还要在插件设置里登录/选库，见 `插件清单.md`。
