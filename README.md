# dsh-email-reader

IMAP 邮件读取插件（DeepSeek Harness）。用 [imapflow](https://www.npmjs.com/package/imapflow) 连接任意 IMAP 邮箱，给模型提供三个工具。

> npm 包名 `dsh-email-reader`（`dsh-email` 已被其他作者占用）。

## 安装

```bash
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

也可以在 profile 的 `cordis.patch.yml` 里直接给 `email-reader` 服务写 `config`（host/port/user/pass/tls/mailbox），此时环境变量作为兜底。

> 邮箱开启两步验证时，请用「应用专用密码」而不是登录密码。QQ/163/Outlook 等都有专门的 IMAP 授权码，需先在网页端开启 IMAP/SMTP 服务。

## 工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `email_list` | 列出最近邮件（发件人/主题/时间/旗标） | `limit`(默认20, ≤100), `mailbox` |
| `email_read` | 读单封邮件全文（含正文） | `seq` 或 `uid`, `mailbox` |
| `email_search` | 服务端全文搜索（主题/正文/发件人） | `query`, `limit`, `mailbox` |

每个工具都支持可选的 `connection` 覆盖对象（`{host,port,user,pass,tls,mailbox}`），一个插件可访问多个邮箱。

## 示例（对模型说）

- 「看下收件箱最近 5 封邮件」
- 「读第 12 封邮件的内容」
- 「搜一下主题里含 'invoice' 的邮件」

## 安全

- 密码只从环境变量或 config 读取，绝不写入日志。
- 默认只读操作，不发送、不删除邮件。
