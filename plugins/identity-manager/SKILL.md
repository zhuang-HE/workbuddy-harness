# Identity Manager (D1 身份层)

> WorkBuddy Agent 身份管理系统 - 九维架构 D1 层

## 核心功能

- **身份配置管理**: Agent 身份信息配置、验证、更新
- **多身份切换**: 支持多个预设身份快速切换
- **身份认证**: Token 生成与验证机制
- **权限控制**: 基于身份的能力边界管理

## 架构

```
IdentityManager
├── identities: Map<id, Identity>
├── currentId: string
├── tokens: Map<token, TokenInfo>
└── capabilities: Map<id, Capability[]>
```

## API

### init(config)
初始化身份管理器，加载配置

### getCurrentIdentity()
获取当前激活身份

### switchIdentity(id)
切换到指定身份

### validateToken(token)
验证认证 Token

### generateToken(id, scope)
为指定身份生成 Token

### checkCapability(capability)
检查当前身份是否具备某能力

### updateIdentity(id, updates)
更新身份信息

## 使用示例

```javascript
const IdentityManager = require('./index.js');
const im = new IdentityManager();

// 初始化
await im.init({
  defaultId: 'assistant',
  identities: [...]
});

// 切换身份
await im.switchIdentity('coder');

// 验证权限
const canExecute = await im.checkCapability('code-generation');

// 生成 Token
const token = await im.generateToken('assistant', ['read', 'write']);
```

## 配置示例

```javascript
{
  "defaultId": "assistant",
  "identities": [
    {
      "id": "assistant",
      "name": "AI 助手",
      "role": "general",
      "capabilities": ["code-generation", "analysis", "writing"],
      "limits": { "maxTokens": 100000, "rateLimit": 60 }
    },
    {
      "id": "coder",
      "name": "编程专家",
      "role": "specialist",
      "capabilities": ["code-generation", "code-review", "debugging"],
      "limits": { "maxTokens": 150000, "rateLimit": 30 }
    }
  ]
}
```
