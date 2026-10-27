# cc-four-o-three

原生 Claude Code Mod：常驻显示 IP、ASN 与域名、IP 时区和目标时间；检测 IP 变化并确认；中文输入双向翻译；按 IP 所在时区做深夜操作提醒。

## 安装

要求 Claude Code 2.1.287 或更高版本，Python 3.9+，未禁用 Mod。无需 npm 安装或构建。

```text
/plugin marketplace add https://github.com/ZinkLu/claude-code-four-o-three
/plugin install cc-four-o-three@zinklu
```

开发时直接加载本目录：

```bash
claude --plugin-dir <本仓库绝对路径>
```

## 命令

```text
/cc-four-o-three          打开状态与设置面板
/cc-four-o-three refresh  强制重新检测 IP
/cc-four-o-three accept   接受当前 IP
/cc-four-o-three test     双向翻译自检（会真实调用模型）
```

## 说明

- IP 数据默认保存在 `~/.claude/plugins/data/cc-four-o-three/`，可用 `CC_FOUR_O_THREE_DATA_DIR` 指定其他目录。
- 翻译默认走 Claude Code 自身的模型，也可切换到独立的 OpenAI 兼容端点，需要单独配置 API Key。
- 在 `/cc-four-o-three` 面板点击“配置 API Key（安全存储）”，可打开原生配置页面补配或修改密钥。
- 离线安装包说明见 `INSTALL.md`，发行包用 `./scripts/build-release.sh` 构建。

MIT
