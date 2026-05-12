# API Gateway - API 安全与限流系统

> **版本**: 1.0.0  
> **类型**: P3 系统插件  
> **依赖**: 无

---

## 概述

API Gateway 提供 API 认证、请求限流、安全检查和日志审计功能，保护 WorkBuddy 插件系统安全。

## 核心功能

### 1. API Key 管理

| 功能 | 说明 |
|------|------|
| 创建 Key | 生成唯一的 API Key |
| 撤销 Key | 禁用无效 Key |
| 权限控制 | read/write/admin |
| 过期时间 | 可设置的失效时间 |

### 2. 限流策略

| 策略 | 说明 |
|------|------|
| 按 IP | 限制每个 IP 的请求 |
| 按用户 | 限制每个用户的请求 |
| 按 API Key | 限制每个 Key 的请求 |

默认限制: 100 请求 / 60 秒

### 3. 安全检查

| 检查 | 说明 |
|------|------|
| XSS 检测 | 检测 `<script>` 等危险标签 |
| 请求大小 | 限制最大请求体 |
| 方法限制 | 只允许 GET/POST/PUT/DELETE |

## 使用方法

### CLI 命令

```bash
# 创建 API Key
node api-gateway.js create-key "My Application"

# 列出所有 Key
node api-gateway.js list-keys

# 撤销 Key
node api-gateway.js revoke abc123

# 检查限流状态
node api-gateway.js check-limit ip:192.168.1.1

# 重置限流
node api-gateway.js reset-limit ip:192.168.1.1

# 查看统计
node api-gateway.js stats

# 查看配置
node api-gateway.js config show
```

### Node.js API

```javascript
const APIGateway = require('~/.workbuddy/plugins/api-gateway');

const gateway = new APIGateway();

// 创建 API Key
const key = gateway.createAPIKey({
  name: 'My App',
  permissions: ['read', 'write'],
  expiresIn: 7 * 24 * 60 * 60 * 1000 // 7 天
});

// 验证 Key
const valid = gateway.validateAPIKey('keyId.secret');
if (valid.valid) {
  console.log('权限:', valid.permissions);
}

// 处理请求
const result = gateway.processRequest({
  method: 'POST',
  path: '/api/data',
  ip: '192.168.1.1',
  apiKey: 'keyId.secret',
  body: JSON.stringify({ data: 'test' })
}, (req) => {
  return { success: true, data: req.body };
});

// 检查限流
const limit = gateway.checkRateLimit('user:123', 100, 60000);
console.log(`剩余: ${limit.remaining}/${limit.limit}`);
```

## 请求处理流程

```
请求 → 认证 → 限流 → 安全检查 → 处理 → 日志 → 响应
```

## 响应格式

### 成功响应
```json
{
  "status": 200,
  "data": { "result": "..." },
  "headers": {
    "X-RateLimit-Limit": 100,
    "X-RateLimit-Remaining": 99
  }
}
```

### 错误响应
```json
{
  "status": 429,
  "error": "请求过于频繁",
  "headers": {
    "Retry-After": 30
  }
}
```

## 数据存储

```
~/.workbuddy/api-gateway/
├── api-keys.json           # API Key 元数据
├── api-keys.keys.json      # 完整密钥
├── rate-limits.json       # 限流记录
├── access.log             # 访问日志
└── config.json           # 配置
```

## 配置示例

```javascript
{
  "rateLimit": {
    "enabled": true,
    "defaultLimit": 100,
    "defaultWindow": 60000,
    "perIP": true,
    "whitelist": ["127.0.0.1"]
  },
  "auth": {
    "enabled": false,
    "allowAnonymous": true
  },
  "security": {
    "sanitizeInput": true,
    "maxRequestSize": 1048576,
    "allowedMethods": ["GET", "POST"]
  }
}
```

---

**维护**: CodeBuddy AI Engineer  
**更新**: 2026-05-11
