<div align="center">

# ✉️ dsh-email-reader

**DeepSeek Harness IMAP 邮件读取插件（OAuth2 版）**

[![npm version](https://img.shields.io/npm/v/dsh-email-reader?color=blue)](https://www.npmjs.com/package/dsh-email-reader)
[![license](https://img.shields.io/npm/l/dsh-email-reader)](https://github.com/huaxiren6/dsh-email-reader/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/huaxiren6/dsh-email-reader?style=social)](https://github.com/huaxiren6/dsh-email-reader)

基于 [imapflow](https://www.npmjs.com/package/imapflow) 连接任意 IMAP 邮箱，让模型具备读邮件的能力。

</div>

---

## 简介

给 DeepSeek Harness 提供三个模型可调用的邮件工具：列邮件、读全文、服务端搜索。支持多账号、OAuth2 与代理。

> npm 包名 `dsh-email-reader`（`dsh-email` 已被其他作者占用）。

## 解决的实际问题

**微软从 2024 年 9 月起停止了对个人 Outlook.com 账号 IMAP 的基本认证（用户名+密码，含应用密码），只接受 OAuth2。** 市面上多数邮件插件（含市场版 dsh-email）仍只支持密码登录，导致 Outlook 账号无法读取。本插件补上了这个缺口：

- 🔐 **OAuth2 / XOAUTH2**：`refreshToken + clientId` 自动换取 access token，无需手动授权，微软禁用密码认证的账号也能读
- 🌐 **HTTP/SOCKS 代理**：教育网 / 企业网直连 Google 被屏蔽时，可指定本地代理（如 `http://127.0.0.1:7892`）访问 Gmail
- 🧩 **与市场版 dsh-email 共存**：工具注册为 `ol_email_*`（ol = Outlook）前缀，不与市场版的 `email_*` 撞名，两个插件可同时安装——市场版管 Gmail，本插件管 Outlook

## 功能特性

- ✉️ `ol_email_list` — 列出收件箱最近邮件（发件人 / 主题 / 时间 / 旗标）
- 📄 `ol_email_read` — 读取单封邮件全文（含正文，自动解析 MIME，兼容 Outlook 服务器）
- 🔍 `ol_email_search` — 服务端 IMAP 全文搜索，最新优先
- 👥 多账号：`accounts[]` 配置，`account` 参数切换
- 🔐 OAuth2：refreshToken + clientId 自动换 access token（Microsoft / 任意端点）
- 🌐 可选 HTTP/SOCKS 代理（教育网 / 企业网访问 Google 等被屏蔽服务时使用）
- 🛡️ 全部工具返回 `{ ok, ... }`，绝不抛异常，配置错误不会拖垮宿主

## 安装

```sh
dsh plugin --profile web add dsh-email-reader
```

## 配置

### 方式一：OAuth2（推荐，Outlook 等强制 OAuth 的邮箱）

```yaml
- insert:
    - id: email-reader
      name: dsh-email-reader
      config:
        accounts:
          - id: outlook
            host: outlook.office365.com
            port: 993
            user: you@outlook.com
            refreshToken: "从 OAuth 授权流程获取"
            clientId: "你的应用 Client ID"
            tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token"
            mailbox: INBOX
```

### 方式二：密码 / 应用专用密码

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

### 方式三：环境变量（凭据不落盘）

| 环境变量 | 含义 | 默认 |
|---|---|---|
| `DSH_IMAP_HOST` | IMAP 服务器（必填） | — |
| `DSH_IMAP_PORT` | 端口 | `993` |
| `DSH_IMAP_USER` | 用户名 | — |
| `DSH_IMAP_PASS` | 密码 / App 专用密码 | — |
| `DSH_IMAP_TLS` | 是否 TLS | `true` |
| `DSH_IMAP_MAILBOX` | 默认邮箱 | `INBOX` |
| `DSH_IMAP_OAUTH_REFRESH` | OAuth refresh token | — |
| `DSH_IMAP_CLIENT_ID` | OAuth client id | — |
| `DSH_IMAP_TOKEN_URL` | OAuth token 端点 | — |
| `DSH_IMAP_PROXY` | 代理地址（如 `http://127.0.0.1:7892`） | — |

### 走代理访问 Gmail 的示例

```yaml
- insert:
    - id: email-reader
      name: dsh-email-reader
      config:
        accounts:
          - id: gmail
            host: imap.gmail.com
            port: 993
            user: you@gmail.com
            pass: your-app-password
            proxy: "http://127.0.0.1:7892"
            mailbox: INBOX
```

## 使用示例

对模型说：

- 「看下收件箱最近 5 封邮件」→ `ol_email_list`
- 「读第 12 封邮件的内容」→ `ol_email_read`
- 「搜一下主题里含 'invoice' 的邮件」→ `ol_email_search`

每个工具都支持可选的 `connection` 覆盖对象（`{host, port, user, pass, tls, mailbox}`），一个插件可访问多个邮箱。

## License

[MIT](LICENSE)
