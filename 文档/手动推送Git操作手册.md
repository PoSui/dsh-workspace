# 手动推送 Git 操作手册（Windows）

> 写于 2026-11-04 早上，起因：昨晚（11-03 18:06~18:20）在 DSH 里连续推送失败，DSH 服务随后崩溃。
> 本手册的目标：**不依赖 DSH，你自己在 PowerShell / CMD 里就能把 `D:\dsh-workspace` 推到 `PoSui/dsh-workspace`。**

---

## 〇、先说结论（昨晚的两个真实故障）

**故障 1：git push 报 `cannot create standard input pipe for remote-https: Permission denied`**

```
error: cannot create standard input pipe for remote-https: Permission denied
```

这不是 token 错、不是网络错，是 **DSH 的沙箱不允许 git 创建管道给 `git-remote-https` 子进程**。
所以只要在 DSH 里跑，换什么参数都会失败（我昨晚试过 3 次，包括把 TMP 指到工作区）。
→ **解法：关掉/最小化 DSH 这个终端，自己开一个 PowerShell 窗口执行**（见第三节）。

**故障 2：后台装 dulwich 的任务失败**

```
bash could not be started: subprocess-local: Windows Job runner exited with exit code 1073807364
```

DSH 的 Windows Job 运行器崩了（值等于 `0xC0000142`），跟 git 无关，是 DSH 服务本身的问题。
→ 结论：**别在 DSH 里搞“后台装包再推送”这种事**，直接手动推最省事。

---

## 一、推送前检查（30 秒）

### 1. 确认代理开着

梯子（vpb）必须在跑，本地 4780 端口有监听：

```powershell
netstat -ano | Select-String ":4780"
```

看到 **LISTENING** 才算开着。只看得到 `SYN_SENT` 说明客户端在连、但代理没起来（昨晚 08:30 就是这样）。

> 不要用 `Get-NetTCPConnection` 判断——那玩意儿在这台机器上返回空，会误判成"代理没开"。用 netstat。

### 2. 确认仓库状态

```powershell
cd D:\dsh-workspace
git status
git log --oneline -3
```

### 3. 确认 token 还在

GitHub → 右上头像 → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → 看名字 `dsh用` 那一条，权限要含 `repo`，没过期（有效期到 2027-10-27）。

---

## 二、提交（先本地提交，再推）

```powershell
cd D:\dsh-workspace

# 1. 看改了什么
git status

# 2. 加文件（按需，别无脑 git add .）
git add 个人工具 对话记录 文档
git add 个人工作台/某某.md

# 3. 提交
git commit -m "feat: 一句话说明这次改了什么"
```

**昨晚的遗留**：有一个提交已经做好但没推出去：

```
7f3a6dc feat(牛马计时器): v19 单文件计时器 + 测试台(100条全绿) + 交接文档
```

所以你现在只需要**推**，不用重新 commit（除非你还想补交新文件，比如 `个人工具/docs/需求与规划.md`）。

---

## 三、推送（核心步骤）

### 方式 A：一次性带 token 的推送（推荐，最省事）

在**普通 PowerShell 窗口**（不是 DSH 里）执行：

```powershell
cd D:\dsh-workspace

git -c http.proxy=http://127.0.0.1:4780 `
    -c https.proxy=http://127.0.0.1:4780 `
    -c http.sslBackend=openssl `
    push "https://<你的TOKEN>@github.com/PoSui/dsh-workspace.git" HEAD:main
```

把 `<你的TOKEN>` 换成 `ghp_` 开头的那串（就是 `dsh用` 那个）。
成功会看到 `xxxx..yyyy  HEAD -> main`。

PowerShell 里换行用反引号 `` ` ``；嫌麻烦就写成一整行：

```powershell
git -c http.proxy=http://127.0.0.1:4780 -c https.proxy=http://127.0.0.1:4780 -c http.sslBackend=openssl push "https://<TOKEN>@github.com/PoSui/dsh-workspace.git" HEAD:main
```

### 方式 B：先把代理写进仓库配置，再普通 push

```powershell
cd D:\dsh-workspace
git config http.proxy http://127.0.0.1:4780
git config https.proxy http://127.0.0.1:4780
git config http.sslBackend openssl

git push "https://<TOKEN>@github.com/PoSui/dsh-workspace.git" HEAD:main
```

以后在这个仓库里 `git pull` / `git push` 都自动走代理。**注意**：代理没开的时候这些命令会卡住报 `Failed to connect to 127.0.0.1 port 4780`，那就先把梯子打开。

### 方式 C：让 Git 记住 token（免每次输）

Windows 自带凭据管理器，第一次输 token 时会弹窗，输一次就存住了：

```powershell
cd D:\dsh-workspace
git config credential.helper manager
git push
```

然后按提示输入用户名 `PoSui`、密码处粘贴 token。之后 `git push` 就不用再带 token 了。

---

## 四、推完必须做的三件事

```powershell
# 1. 确认远端引用真的更新了
git ls-remote --heads "https://<TOKEN>@github.com/PoSui/dsh-workspace.git"
# 看 main 那一行的 hash，应该等于本地 git rev-parse HEAD

# 2. 把带 token 的 URL 从 remote 里清掉（防止泄露）
git remote -v                 # 如果显示带 token 的地址，改回干净的
git remote set-url origin https://github.com/PoSui/dsh-workspace.git

# 3. 看工作区是否干净
git status
```

另外：把 DSH 的输出里出现过的 token 当作“已泄露”处理更安全——GitHub → 该 token → Delete，重新生成一个，改到凭据管理器里。

---

## 五、错误对照表（按症状查）

| 报错文本 | 原因 | 怎么办 |
|---|---|---|
| `cannot create standard input pipe for remote-https: Permission denied` | DSH 沙箱禁止创建子进程管道 | **换普通 PowerShell/CMD 窗口执行**，DSH 里永远不行 |
| `Failed to connect to 127.0.0.1 port 4780: Connection refused` | 代理没开 | 打开 vpb，`netstat -ano \| Select-String ":4780"` 看到 LISTENING |
| `SSL_ERROR_SYSCALL` / `OpenSSL SSL_read: Connection reset` | 代理不稳 / 被墙中途掐断 | 重试一次；仍不行换 `http.sslBackend=schannel` 试试 |
| `Could not resolve host: github.com` | DNS 被污染 / 代理没生效 | 确认 `https.proxy` 配了；换 `--resolve` 或 hosts |
| `remote: Permission to PoSui/dsh-workspace.git denied to xxx` | token 没权限或过期 | 重新生成 classic token，勾 `repo` |
| `fatal: Authentication failed` | token 粘贴错（多了空格/换行） | 重新粘贴，注意只贴 `ghp_` 到结尾 |
| `! [rejected] ... (non-fast-forward)` | 远端有你本地没有的提交（比如家里电脑推过） | `git pull --rebase "https://<TOKEN>@github.com/PoSui/dsh-workspace.git" main` 再推 |
| `error: src refspec main does not match any` | 本地还没有提交 / 分支名不是 main | `git log` 确认有提交；`git branch -M main` |
| `unable to unlink old 'xxx': Invalid argument` | 文件被别的程序（编辑器/DSH）占用 | 关掉占用程序；或先 `git reset --hard` 前先提交 |
| `error: RPC failed; HTTP 413 / 远端断开` | 单次推太多或大文件 | `git config http.postBuffer 524288000`；大文件别进仓库 |
| `index.lock` 已存在 | 上次 git 被强杀 | 确认没有 git 进程后删 `.git\index.lock` |

---

## 六、完全不想用命令行时的备用方案

1. **GitHub Desktop**（最稳）：Add local repository → 选 `D:\dsh-workspace` → 填 commit message → Push origin。代理在 Desktop 设置里配（Settings → Network → HTTP proxy）。
2. **VS Code 内置 Git**：打开文件夹 → 源代码管理 → 提交 → 同步（右上角循环箭头）。同样需要代理。
3. **网页上传**（只适合少量文件）：GitHub 仓库页 → Add file → Upload files → 拖进去 → Commit。大文件/多文件很痛苦。
4. **SSH 方式**（长期最省心，但要先生成密钥并加到 GitHub）：
   ```powershell
   ssh-keygen -t ed25519 -C "posui@local"
   # 把 ~/.ssh/id_ed25519.pub 内容贴到 GitHub → Settings → SSH and GPG keys
   # 然后 remote 改成 git@github.com:PoSui/dsh-workspace.git
   ```
   SSH 走 22 端口，被墙时需要代理的 SSH 转发或者用 443 端口的 `ssh.github.com`。

---

## 七、每次推送的检查清单（照着勾）

- [ ] 梯子开着，`netstat -ano | Select-String ":4780"` 有 LISTENING
- [ ] `cd D:\dsh-workspace`，`git status` 看看有什么要提交
- [ ] `git add` 具体文件（别 `git add .`，会带进 `.tmp`、`_tmp_diff.txt` 这类垃圾）
- [ ] `git commit -m "..."`（说明白改了什么）
- [ ] 用**普通 PowerShell 窗口**执行带 token 的 push 命令
- [ ] 看到 `HEAD -> main` 才算成功
- [ ] `git remote -v` 确认地址里没有 token
- [ ] `git status` 干净

---

## 八、给这个仓库的专用备注

- **远端**：`https://github.com/PoSui/dsh-workspace.git`（私有），分支 `main`
- **两台机器同路径**：家里和工作机都是 `D:\dsh-workspace`，所以路径不用改，直接 pull 就能接着干
- **不要提交的东西**：`.tmp/`、`*.zip`、`node_modules/`、`_tmp_diff*.txt`、`.tmp-review/`、任何带 token 的文件
- **昨晚待推的提交**：`7f3a6dc`（牛马计时器 v19 + 测试台 + 交接文档）
- **今天新增未提交**：`个人工具/docs/需求与规划.md`（pm 写的产品规划），可选一起提交：

  ```powershell
  git add 个人工具/docs
  git commit -m "docs: 补产品规划"
  git push "https://<TOKEN>@github.com/PoSui/dsh-workspace.git" HEAD:main
  ```
