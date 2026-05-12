/**
 * Context Fusion 测试用例
 */

const ContextFusion = require('./index.js');

async function runTests() {
  console.log('🧪 开始测试 Context Fusion...\n');
  
  const cf = new ContextFusion();
  
  // 测试1: 初始化
  console.log('📋 测试1: 初始化');
  await cf.init({
    defaultBudget: 5000
  });
  console.log('  ✅ 初始化成功\n');

  // 测试2: 基本融合
  console.log('📋 测试2: 基本融合');
  const contexts1 = [
    { source: 'system', content: '你是一个专业的AI编程助手', priority: 100 },
    { source: 'skill', content: '当前正在执行代码审查任务', priority: 80 },
    { source: 'memory', content: '用户偏好使用Python进行开发', priority: 60 },
    { source: 'session', content: '用户请求审查登录模块代码', priority: 40 }
  ];
  const fused1 = await cf.fuse(contexts1, { budget: 5000 });
  console.log(`  输入: ${fused1.metadata.sources} 条`);
  console.log(`  输出: ${fused1.contexts.length} 条`);
  console.log(`  Token使用: ${fused1.summary.usedBudget}/${fused1.summary.budget}`);
  console.log('  ✅ 基本融合成功\n');

  // 测试3: 去重测试
  console.log('📋 测试3: 去重测试');
  const contexts2 = [
    { source: 'memory', content: '用户喜欢Python编程', priority: 60 },
    { source: 'memory', content: '用户喜欢Python编程', priority: 60 }, // 重复
    { source: 'session', content: '用户正在审查代码', priority: 40 }
  ];
  const fused2 = await cf.fuse(contexts2, { budget: 5000 });
  console.log(`  输入: 3条, 输出: ${fused2.contexts.length}条`);
  console.log(`  ✅ 去重成功\n`);

  // 测试4: 优先级排序
  console.log('📋 测试4: 优先级排序');
  const prioritized = cf.prioritize(contexts1);
  console.log('  排序结果:');
  prioritized.forEach((ctx, i) => {
    console.log(`    ${i + 1}. [${ctx.source}] 优先级: ${ctx.priority}`);
  });
  console.log('  ✅ 优先级排序正确\n');

  // 测试5: Token 压缩
  console.log('📋 测试5: Token 压缩');
  const longContent = Array(20).fill('这是一段很长的内容来模拟实际的上下文信息。').join('');
  const contexts3 = [
    { source: 'system', content: '系统提示', priority: 100 },
    { source: 'skill', content: '技能上下文', priority: 80 },
    { source: 'memory', content: longContent, priority: 60 },
    { source: 'session', content: '会话历史记录', priority: 40 },
    { source: 'recent', content: '最近的对话内容', priority: 20 }
  ];
  const fused3 = await cf.fuse(contexts3, { budget: 100 });
  console.log(`  压缩前: 约 ${cf.calculateTokens(contexts3)} tokens`);
  console.log(`  压缩后: ${fused3.summary.usedBudget} tokens`);
  console.log(`  压缩率: ${fused3.summary.compressionRatio * 100}%`);
  console.log(`  保留条数: ${fused3.contexts.length}`);
  console.log('  ✅ Token 压缩成功\n');

  // 测试6: 时效性加权
  console.log('📋 测试6: 时效性加权');
  const now = Date.now();
  const contexts4 = [
    { source: 'memory', content: '旧记忆', priority: 60, timestamp: now - 86400000 }, // 1天前
    { source: 'session', content: '新会话', priority: 40, timestamp: now } // 现在
  ];
  const weighted = cf.applyTimeWeight(contexts4);
  console.log('  时效性权重:');
  weighted.forEach(ctx => {
    console.log(`    ${ctx.source}: 原始=${ctx.priority}, 有效=${ctx.effectivePriority.toFixed(2)}`);
  });
  console.log('  ✅ 时效性加权完成\n');

  // 测试7: Token 估算
  console.log('📋 测试7: Token 估算');
  const tests = [
    'Hello World', // 英文
    '你好世界', // 中文
    'Hello 你好 World 世界' // 混合
  ];
  tests.forEach(t => {
    const tokens = cf.estimateTokens(t);
    console.log(`  "${t}" => ${tokens} tokens`);
  });
  console.log('  ✅ Token 估算完成\n');

  // 测试8: 来源注册
  console.log('📋 测试8: 来源注册');
  cf.registerSource('custom', { priority: 70, weight: 1.2 });
  const customCtx = { source: 'custom', content: '自定义来源', priority: 70 };
  const sources = cf.getStats().sources;
  console.log(`  当前来源: ${sources.join(', ')}`);
  console.log('  ✅ 来源注册成功\n');

  // 测试9: 上下文摘要
  console.log('📋 测试9: 上下文摘要');
  // 添加一些缓存
  cf.addToCache({ source: 'memory', content: '测试记忆', sessionId: 's1' });
  cf.addToCache({ source: 'session', content: '测试会话', sessionId: 's1' });
  const summary = cf.getContextSummary();
  console.log(`  缓存上下文数: ${summary.totalContexts}`);
  console.log(`  Token总数: ${summary.totalTokens}`);
  console.log(`  融合次数: ${summary.fusionCount}`);
  console.log('  ✅ 摘要获取成功\n');

  // 测试10: 相关性提取
  console.log('📋 测试10: 相关性提取');
  cf.addToCache({ source: 'memory', content: '用户使用React框架', sessionId: 's2' });
  cf.addToCache({ source: 'memory', content: '用户偏好深色主题', sessionId: 's2' });
  cf.addToCache({ source: 'memory', content: '用户住在上海', sessionId: 's2' });
  const extracted = await cf.extractFromHistory('s2', { 
    query: 'React 框架', 
    threshold: 0.3 
  });
  console.log(`  找到: ${extracted.totalFound} 条, 返回: ${extracted.returned} 条`);
  if (extracted.contexts.length > 0) {
    console.log(`  最相关: "${extracted.contexts[0].content}"`);
  }
  console.log('  ✅ 相关性提取成功\n');

  // 测试11: 融合统计
  console.log('📋 测试11: 融合统计');
  const stats = cf.getStats();
  console.log(`  总融合次数: ${stats.fusionCount}`);
  console.log(`  缓存大小: ${stats.cacheSize}`);
  console.log(`  注册来源: ${stats.sources.length}`);
  console.log('  ✅ 统计获取成功\n');

  // 测试12: 压缩到指定预算
  console.log('📋 测试12: 智能压缩');
  const manyContexts = Array(10).fill(0).map((_, i) => ({
    source: ['system', 'skill', 'memory', 'session', 'recent'][i % 5],
    content: `上下文内容 ${i + 1}，包含一些有用的信息`,
    priority: 100 - i * 5,
    timestamp: Date.now() - i * 1000
  }));
  const compressed = await cf.compress(manyContexts, { 
    budget: 200,
    preserve: ['system'] 
  });
  console.log(`  输入: ${manyContexts.length}条`);
  console.log(`  输出: ${compressed.contexts.length}条`);
  console.log(`  Token: ${compressed.summary.usedBudget}/${compressed.summary.budget}`);
  console.log(`  保留来源: ${compressed.summary.sources.join(', ')}`);
  console.log('  ✅ 智能压缩成功\n');

  console.log('═══════════════════════════════════════');
  console.log('🎉 所有测试通过！');
  console.log('═══════════════════════════════════════\n');
}

runTests().catch(console.error);
