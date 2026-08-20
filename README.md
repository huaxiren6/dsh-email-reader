<div align="center">

# ✉️ dsh-email-reader

**DeepSeek Harness IMAP 邮件读取插件**

[![npm version](https://img.shields.io/npm/v/dsh-email-reader?color=blue)](https://www.npmjs.com/package/dsh-email-reader)
[![license](https://img.shields.io/npm/l/dsh-email-reader)](https://github.com/huaxiren6/dsh-email-reader/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/huaxiren6/dsh-email-reader?style=social)](https://github.com/huaxiren6/dsh-email-reader)

基于 [imapflow](https://www.npmjs.com/package/imapflow) 连接任意 IMAP 邮箱，让模型具备读邮件的能力。

</div>

---

## 简介

给 DeepSeek Harness 提供三个模型可调用的邮件工具：列邮件、读全文、服务端搜索。支持多账号、OAuth2 与代理。

> npm 包名 `dsh-email-reader`（`dsh-email` 已被其他作者占用）。

## 功能特性

- ✉️ `email_list` — 列出收件箱最近邮件（发件人 / 主题 / 时间 / 旗标）
- 📄 `email_read` — 读取单封邮件全文（含正文，自动解析 MIME）
- 🔍 `email_search` — 服务端 IMAP 全文搜索，最新优先
- 👥 多账号：`accounts[]` 配置，`account` 参数切换
- 🔐 OAuth2：refreshToken + clientId 自动换 access token（Microsoft / 任意端点）
- 🌐 可选 HTTP/SOCKS 代理（教育网 / 企业网访问 Google 等被屏蔽服务时使用）
- 🛡️ 全部工具返回 `{ ok, ... }`，绝不抛异常，配置错误不会拖垮宿主

## 安装

```sh
dsh plugin --profile web add dsh-email-reader
```

## 配置

连接凭据**不写进 profile yaml**，用环境变量（启动 DSH 前设置）：

| 环境变量 | 含义 | 默认 |
|---|---|---|
| `DSH_IMAP_HOST` | IMAP 服务器（必填） | — |
| `DSH_IMAP_PORT` | 端口 | `993` |
| `DSH_IMAP_USER` | 用户名 | — |
| `DSH_IMAP_PASS` | 密码 / App 专用密码 | — |
| `DSH_IMAP_TLS` | 是否 TLS | `true` |
| `DSH_IMAP_MAILBOX` | 默认邮箱 | `INBOX` |

也可以在 profile 的 `cordis.patch.yml` 里给 `email-reader` 服务写 `config`，环境变量作为兜底：

```yaml
- insert:
    - id: email-reader
      name: dsh-email-reader
      config:
        host: imap.example.com
        port: 993
        user: you@example.com
        pass: your-app-password
        tls: true
        mailbox: INBOX
```

> 邮箱开启两步验证时，请用「应用专用密码」而不是登录密码。QQ / 163 / Outlook 等都有专门的 IMAP 授权码，需先在网页端开启 IMAP/SMTP 服务。

## 使用示例

对模型说：

- 「看下收件箱最近 5 封邮件」
- 「读第 12 封邮件的内容」
- 「搜一下主题里含 'invoice' 的邮件」

每个工具都支持可选的 `connection` 覆盖对象（`{host, port, user, pass, tls, mailbox}`），一个插件可访问多个邮箱。

## License

[MIT](LICENSE)
