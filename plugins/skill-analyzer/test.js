module.exports = [
  { id:'sa-import', name:'导入', type:'unit', fn:({assert,require})=>{const S=require('skill-analyzer');assert.truthy(typeof S==='function');}},
  { id:'sa-scan', name:'技能扫描', type:'integration', fn:({assert,require})=>{const s=new (require('skill-analyzer'))();const skills=s.scan(true);assert.truthy(Array.isArray(skills));assert.truthy(skills.length>0);}},
  { id:'sa-score', name:'质量评分', type:'unit', fn:({assert,require})=>{const s=new (require('skill-analyzer'))();s.scan(true);const scores=s.scoreSkills();assert.truthy(scores.length>0);assert.truthy(scores[0].grade==='A'||scores[0].grade==='B'||scores[0].grade==='C'||scores[0].grade==='D');}},
  { id:'sa-cycles', name:'循环检测', type:'unit', fn:({assert,require})=>{const s=new (require('skill-analyzer'))();s.scan(true);const c=s.findCircularDeps();assert.truthy(Array.isArray(c));}},
  { id:'sa-report', name:'报告生成', type:'unit', fn:({assert,require})=>{const s=new (require('skill-analyzer'))();const r=s.generateReport();assert.truthy(r.includes('Skill'));assert.truthy(r.includes('质量'));}},
  { id:'sa-dead', name:'死技能', type:'unit', fn:({assert,require})=>{const s=new (require('skill-analyzer'))();s.scan(true);const d=s.findDeadSkills();assert.truthy(Array.isArray(d));}},
];
