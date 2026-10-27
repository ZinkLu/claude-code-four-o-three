# CC Four-O-Three 0.3.3 安装说明

这个 ZIP 是包含原生 Claude Code Mod 的完整插件包，包含本地 marketplace，不需要从 GitHub 下载，也不包含开发机的 IP 历史、配置或 API Key。

## 1. 安装前检查

在目标机器上确认：

```bash
claude --version
python3 --version
```

要求：

- Claude Code 2.1.287 或更高版本。
- Python 3.9 或更高版本，并且 `python3` 命令在 PATH 中。
- 未通过 `--safe-mode`、`--bare`、`disableAllHooks` 或组织策略禁用 Mod。
- 不需要 Node.js、npm 安装或构建。

## 2. 解压到永久目录

把 `cc-four-o-three-0.3.3.zip` 复制到目标机器，解压到一个**没有空格、以后不会删除的目录**。

例如：

- Linux：`/home/USERNAME/ClaudePlugins/cc-four-o-three-0.3.3/`
- macOS：`/Users/USERNAME/ClaudePlugins/cc-four-o-three-0.3.3/`
- Windows：`C:/Users/USERNAME/ClaudePlugins/cc-four-o-three-0.3.3/`

把 `USERNAME` 换成实际用户名。解压后，该目录下应直接看到：

```text
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
hooks/register.js
scripts/ip_cli.py
README.md
INSTALL.md
```

**不要在安装后删除或移动这个解压目录。** 本地 marketplace 可能直接从源目录加载插件，而不一定复制全部文件。

Linux/macOS 可在放有 ZIP 的目录执行（目标目录可按需调整）：

```bash
mkdir -p "$HOME/ClaudePlugins/cc-four-o-three-0.3.3"
unzip cc-four-o-three-0.3.3.zip -d "$HOME/ClaudePlugins/cc-four-o-three-0.3.3"
```

## 3. 在 Claude Code 中安装

启动目标机器上的 Claude Code，输入下面的一条命令，把路径换成实际解压目录的**绝对路径**：

```text
/plugin install cc-four-o-three --marketplace /home/USERNAME/ClaudePlugins/cc-four-o-three-0.3.3
```

macOS 示例：

```text
/plugin install cc-four-o-three --marketplace /Users/USERNAME/ClaudePlugins/cc-four-o-three-0.3.3
```

Windows 示例（使用正斜杠）：

```text
/plugin install cc-four-o-three --marketplace C:/Users/USERNAME/ClaudePlugins/cc-four-o-three-0.3.3
```

Claude 会要求确认添加本地 marketplace，然后打开插件详情。建议选择 **Install for you (user scope)**，让插件在所有项目中可用。

如果安装摘要要求重新加载，再执行：

```text
/reload-plugins
```

也可以分两步安装：

```text
/plugin marketplace add <解压目录的绝对路径>
/plugin install cc-four-o-three@zinklu
```

## 4. 配置翻译

默认配置：

- 双向翻译开启。
- 翻译提供商为 `claude`，模型为 `haiku`。
- 输入目标语言为 `auto`，按 IP 所在国家或地区推断。
- 回复在原文下显示简体中文译文。
- 显示 IP 的 AS 编号和 ASN 组织名；没有 ASN 时回退到数据源提供的域名，缺失时显示 `unknown`。
- IP 与本机时区不一致时，信息栏和设置面板显示黄色提醒，不阻断操作。
- 深夜提醒为 IP 当地 `00:00–06:00`。

真实发送中文 Prompt 或执行 `/cc-four-o-three test` 会调用配置的翻译模型，可能消耗额度或产生费用。

如需使用独立的 OpenAI 兼容提供商，在插件安装后执行：

```text
/plugin configure cc-four-o-three@zinklu
```

配置 `translation_provider`、`translation_model`、`translation_base_url` 和敏感项 `translation_api_key`。也可以输入 `/cc-four-o-three` 打开面板修改非敏感设置，或点击“配置 API Key（安全存储）”打开同一原生配置页面。API Key 由 Claude Code 保存在系统安全凭据存储中，保存后按提示重载插件或重启 Claude Code。

## 5. 检查安装

在 Claude Code 中检查：

1. `/plugin` 的 Installed 页面显示 `cc-four-o-three`，且 Mod 已启用。
2. 输入框上方显示 IP、ASN / 域名、时区、目标时间和本机时区，信息栏左侧有随状态变化的彩色条；无法获取时应显示 `unknown`。
3. 当 IP 与本机时区不一致时，信息栏和 `/cc-four-o-three` 面板显示黄色“时区提醒”；该提示不应阻断操作。
4. `/cc-four-o-three` 能打开设置面板，分别显示 ASN 和域名，标题、状态行和“翻译与语言 / IP 与深夜提醒”分区有配色；实际颜色受终端主题影响。
5. 配置翻译提供商后，可用 `/cc-four-o-three test` 做真实双向翻译自检。
6. 发送中文 Prompt，检查输入双语展示和回复中文译文。

如果插件未加载，先看 `/plugin` 的 Errors 页面，并确认 Claude Code 版本、`python3` 命令和 Mod 策略。

## 6. 更新与卸载

这个 ZIP 是离线发行包，不会自动获得新版本。更新时先安装新版，再按 Claude 的提示重新加载；保留配置时不要删除插件数据目录。

卸载插件：

```text
/plugin uninstall cc-four-o-three@zinklu
```

如不再需要本地 marketplace，可在卸载后执行：

```text
/plugin marketplace remove zinklu
```
