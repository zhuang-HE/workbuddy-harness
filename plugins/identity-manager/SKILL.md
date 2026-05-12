# Identity Manager (D1 身份层)

> WorkBuddy Agent 身份管理系统 - 九维架构 D1 层

## 核心功能

- **身份配置管理**: Agent 身份信息配置、验证、更新
- **多身份切换**: 支持多个预设身份快速切换
- **身份认证**: Token 生成与验证机制
- **权限控制**: 基于身份的能力边界管理
- **持久化存储**: 自动保存到本地文件
- **数据加密**: Token 和敏感数据 AES-256-GCM 加密

## 安全特性

### 加密方案

| 加密项 | 算法 | 说明 |
|--------|------|------|
| Token | AES-256-GCM | 实时加密存储 |
| 配置导出 | AES-256-GCM | 可选密码保护 |
| 密钥派生 | PBKDF2 | 100,000 次迭代 |

### 安全建议

1. 使用强密码导出配置
2. 定期清理过期 Token
3. 不在代码中硬编码密码

## 架构

```
IdentityManager
├── identities: Map<id, Identity>
├── currentId: string
├── tokens: Map<token, TokenInfo>
├── capabilities: Map<id, Set>
└── encryptionKey: Buffer
```

## API

### init(config)
初始化身份管理器，加载配置

### registerIdentity(identity)
注册新身份

### getCurrentIdentity()
获取当前激活身份

### switchIdentity(id)
切换到指定身份

### checkCapability(capability)
检查当前身份是否具备某能力

### generateToken(identityId, scopes)
为指定身份生成 Token

### validateToken(token)
验证认证 Token

### revokeToken(token)
撤销 Token

### updateIdentity(id, updates)
更新身份信息

### exportEncrypted(password)
导出加密配置

### importEncrypted(data, password)
导入加密配置

### save()
强制保存

### clear()
清除所有数据

## 使用示例

```javascript
const IdentityManager = require('./index.js');
const im = new IdentityManager();

// 初始化（启用加密和自动保存）
await im.init({
  defaultId: 'assistant',
  encryptionEnabled: true,
  encryptionPassword: 'your-secure-password',
  identities: [...]
});

// 身份管理
await im.switchIdentity('coder');
const canExecute = await im.checkCapability('code-generation');

// Token 管理
const token = await im.generateToken('assistant', ['read', 'write']);
const valid = await im.validateToken(token);

// 加密导出
const encrypted = im.exportEncrypted('export-password');
im.importEncrypted(encrypted, 'export-password');

// 强制保存
im.save();

// 清除所有数据
im.clear();
```

## 持久化文件

| 文件 | 内容 | 加密 |
|------|------|------|
| `config.json` | 配置、历史 | 否 |
| `identities.json` | 身份数据 | 否 |
| `tokens.enc` | Token 数据 | AES-256-GCM |
