# DSH 插件与模型接入

> 记录 DSH（办公室机）当前装了哪些插件、模型从哪来、凭据放哪、换机器怎么恢复。
> 更新：2026-10-28

## 1. 当前插件清单（desktop 配置档）

`C:\Users\<你>\.dsh\profiles\desktop\package.json` 里登记的依赖与 bundle：

| 插件 | 版本 | 作用 |
|---|---|---|
| `@vectorize-io/hindsight-coding-agents` | 0.8.2 | 会话记忆 / 知识页（🧠 Hindsight） |
| `billion-context` | ^0.1.208 | 长会话上下文压缩（compress / decompress） |
| `dsh-connect-workbuddy` | 5.12.1 | 把 WorkBuddy 模型接进 DSH（也带 CodeBuddy CLI 桥、生图/生视频工具） |
| `dsh-context` | 0.77.0 | 上下文/成本统计 |
| `dsh-ops` | 0.4.1 | 文件、命令、沙箱等基础工具 |
| `dshmarket` | ^1.70.2 | 插件市场 |

> 这些是 **DSH 程序本体**的依赖，装在用户目录，**不在工作区仓库里**。换机器时按第 4 节重装即可。

工作区内另有 `.dsh/skills/`（技能包，约 1.7MB），已入库，两台机器共用。

## 2. WorkBuddy 接入（dsh-connect-workbuddy）

### 2.1 方向

插件支持两个方向，互不冲突：

- **正向（默认，正在用）**：WorkBuddy 的模型 → 接进 DSH 当模型提供商。在 DSH 里对话，走 WorkBuddy 云端推理，**扣 WorkBuddy 积分**。
- **反向（可选，默认关闭）**：插件里叫 `cliBridge`，打开后 DSH 多出 `codebuddy_ask` 工具和 `/codebuddy` 指令，把任务交给本机已登录的 **CodeBuddy CLI** 去读文件/改代码/跑命令。默认只读，工作目录受限。
- 另有 `workbuddy_draw_image` / `workbuddy_draw_video` 两个工具（默认关闭），让 DSH 直接调用 WorkBuddy 的生成能力。

### 2.2 当前登录状态（2026-10-28 实测）

```
CN (domestic): signed in as DLP
  Access token expires 2026-11-25T02:57:11.000Z (refresh is automatic)
  Local accounts: 1
  Remaining credit: 2117.88
Global: signed out
```

- 国内版已登录（账号池 1 个），积分约 2118；
- 国际版未登录；
- 会话里模型已切到 `workbuddy/glm-5v-turbo`，证明这条链路是通的。

查状态命令：

```powershell
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-connect-workbuddy\lib\bin.js" status
```

### 2.3 登录方式（三种，任选）

1. **插件卡片扫码/网页登录**（最省事，不用装桌面 App）：DSH 设置 → DSH Connect WorkBuddy → 国内版「扫码登录」/ 国际版「网页登录」。
2. **WorkBuddy 桌面 App 登录**：装好并登录一次，插件读 `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info`。
3. **搬凭据**：从已登录机器把 `%LOCALAPPDATA%\CodeBuddyExtension` 整目录拷过来（加密字段需能定位到 App 可执行文件，必要时设 `WORKBUDDY_APP_EXECUTABLE`）。

国内版与国际版账号、积分池**不通用**，登录入口也不同（国内版是腾讯 copilot 网关，国际版是 workbuddy.ai / codebuddy.ai）。

### 2.4 凭据位置（**绝不入库**）

| 文件 | 说明 |
|---|---|
| `C:\Users\<你>\.dsh\.workbuddy-auth.cn.json` | 插件自己存的国内版账号凭据（含 token） |
| `C:\Users\<你>\.dsh\.workbuddy-auth.global.json` | 国际版凭据 |
| `%LOCALAPPDATA%\CodeBuddyExtension\...\workbuddy-desktop.info` | 桌面 App 的登录信息（加密） |
| `C:\Users\<你>\.dsh\.workbuddy-host-heartbeat.json` | 插件宿主心跳（可删，自动重建） |

这些都在用户目录，不在工作区，正常不会被 git 跟踪；**别手动拷进 `D:\dsh-workspace`**。

### 2.5 在 DSH 里切换模型

模型选择器里会出现 `WB CN` / `WB AI` 两组（静态兜底：国内 11 个、国际 19 个，登录后按上游目录刷新）。选中即用；输入框会显示积分读数，可开账号池自动换号、每日签到。

## 3. 2026-10-28 这天的变化

- 解决「DSH 里用 WorkBuddy 对话」：确认插件已装 → 国内版扫码登录 → 模型切到 `workbuddy/glm-5v-turbo`，对话正常，扣 WB 积分。
- 中途切换过一次模型（deepseek-flash ↔ glm-5v-turbo），用于验证两条通道都可用。

## 4. 换机器 / 重装怎么恢复

```powershell
# 1) 装回插件（版本对齐 5.12.1）
dsh plugin --profile desktop add dsh-connect-workbuddy@5.12.1

# 2) 重启 DSH，进设置 → DSH Connect WorkBuddy → 扫码登录（国内版）

# 3) 验证
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-connect-workbuddy\lib\bin.js" status
```

其余插件同理：`dsh plugin --profile desktop add <包名>@<版本>`，或直接在插件市场里装。

## 5. 注意事项

- 走 WorkBuddy 模型时，**推理在 WB 云端、工具执行在本地**，工作区文件不会被传到 WB（除对话内容本身）。
- 积分有限（当前约 2118），重度任务注意消耗；插件支持账号池自动换号。
- 第三方封装调用 WB 存在被平台限制的风险，账号问题自行承担。
- `cliBridge` 反向能力需要本机装 **CodeBuddy CLI** 并登录，办公室机目前没装；要用时先装 CLI，再在插件卡片「能力」栏打开。
