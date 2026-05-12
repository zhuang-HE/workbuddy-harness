# ═══════════════════════════════════════════════════════════════════════════
# TokenBudgetManager — HERMES Agent Token 预算管理器 (P0-2)
# ═══════════════════════════════════════════════════════════════════════════
# 渐进式优化策略：
#   Phase 1: 监控+提醒（只观测，不介入）
#   Phase 2: 按需分配（动态调整预算）
#   Phase 3: 超时介入（自动压缩或分段）
# ═══════════════════════════════════════════════════════════════════════════

import time
import sys
import logging
from typing import Optional, Dict, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class AlertLevel(Enum):
    """预警级别"""
    SAFE = "safe"           # 安全，无需干预
    WARNING = "warning"     # 警告，建议关注
    DANGER = "danger"       # 危险，即将超限
    CRITICAL = "critical"  # 临界，需要介入


@dataclass
class TokenSnapshot:
    """Token 使用快照"""
    timestamp: float
    context_tokens: int
    context_limit: int
    output_budget: int
    used_output: int
    model_name: str
    
    @property
    def context_percent(self) -> float:
        """上下文使用百分比"""
        if self.context_limit <= 0:
            return 0.0
        return min(100.0, (self.context_tokens / self.context_limit) * 100)
    
    @property
    def output_percent(self) -> float:
        """输出预算使用百分比"""
        if self.output_budget <= 0:
            return 0.0
        return min(100.0, (self.used_output / self.output_budget) * 100)
    
    @property
    def remaining_output(self) -> int:
        """剩余输出预算"""
        return max(0, self.output_budget - self.used_output)
    
    @property
    def effective_limit(self) -> int:
        """实际有效的 token 上限"""
        return min(self.context_limit, self.context_tokens + self.output_budget)


@dataclass
class BudgetThresholds:
    """预算阈值配置"""
    # 上下文预警阈值（百分比）
    context_warning: float = 70.0    # 70% 上下文使用 → 警告
    context_danger: float = 85.0    # 85% → 危险
    context_critical: float = 92.0  # 92% → 临界
    
    # 输出预警阈值（百分比）
    output_warning: float = 60.0    # 60% 输出使用 → 警告
    output_danger: float = 80.0    # 80% → 危险
    output_critical: float = 95.0   # 95% → 临界
    
    # 绝对值阈值（tokens）
    min_output_reserve: int = 500   # 输出端最少保留 500 tokens
    
    def __post_init__(self):
        """验证阈值合理性"""
        assert 0 <= self.context_warning <= 100
        assert self.context_warning <= self.context_danger <= self.context_critical <= 100
        assert 0 <= self.output_warning <= 100
        assert self.output_warning <= self.output_danger <= self.output_critical <= 100


@dataclass 
class TokenAlert:
    """Token 预警信息"""
    level: AlertLevel
    message: str
    snapshot: TokenSnapshot
    suggestions: list = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)


class TokenBudgetManager:
    """
    Token 预算管理器
    
    渐进式策略：
    - Phase 1: 监控+提醒（mode=observe）
    - Phase 2: 按需分配（mode=adaptive）
    - Phase 3: 超时介入（mode=intervene）
    
    使用方式：
    ```python
    # 初始化
    manager = TokenBudgetManager(
        mode="observe",  # 渐进式: observe → adaptive → intervene
        context_limit=16384,
        output_budget=4096
    )
    
    # 监控（Phase 1）
    snapshot = manager.sample(context_tokens=8000, output_used=2000)
    if alert := manager.check_thresholds(snapshot):
        manager.alert(alert)  # 打印提醒
    ```
    """
    
    # 模式定义
    MODE_OBSERVE = "observe"      # 仅监控+提醒
    MODE_ADAPTIVE = "adaptive"    # 监控+动态分配
    MODE_INTERVENE = "intervene"  # 监控+分配+介入
    
    def __init__(
        self,
        mode: str = MODE_OBSERVE,
        context_limit: int = 16384,
        output_budget: int = 4096,
        thresholds: Optional[BudgetThresholds] = None,
        model_name: str = "unknown"
    ):
        self.mode = mode
        self.context_limit = context_limit
        self.base_output_budget = output_budget
        self.current_output_budget = output_budget
        self.thresholds = thresholds or BudgetThresholds()
        self.model_name = model_name
        
        # 状态跟踪
        self._history: list[TokenSnapshot] = []
        self._max_history = 100
        self._last_alert_time: float = 0
        self._alert_cooldown: float = 30.0  # 30秒内不重复警告
        
        # 统计
        self._stats = {
            "total_samples": 0,
            "alerts_generated": 0,
            "budget_adjustments": 0,
            "compressions_triggered": 0
        }
    
    @property
    def mode(self) -> str:
        return self._mode
    
    @mode.setter
    def mode(self, value: str):
        """设置模式，支持渐进式升级"""
        valid_modes = [self.MODE_OBSERVE, self.MODE_ADAPTIVE, self.MODE_INTERVENE]
        if value not in valid_modes:
            raise ValueError(f"Invalid mode: {value}. Valid: {valid_modes}")
        if hasattr(self, "_mode") and self._mode != value:
            logger.info(f"TokenBudgetManager: mode changed {self._mode} → {value}")
        self._mode = value
    
    def sample(
        self,
        context_tokens: int,
        output_used: int = 0,
        model_name: Optional[str] = None
    ) -> TokenSnapshot:
        """
        采样当前 token 使用状态
        
        Args:
            context_tokens: 当前上下文使用的 tokens
            output_used: 已使用的输出 tokens
            model_name: 可选的模型名称覆盖
            
        Returns:
            TokenSnapshot: 当前快照
        """
        snapshot = TokenSnapshot(
            timestamp=time.time(),
            context_tokens=context_tokens,
            context_limit=self.context_limit,
            output_budget=self.current_output_budget,
            used_output=output_used,
            model_name=model_name or self.model_name
        )
        
        # 记录历史
        self._history.append(snapshot)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]
        
        self._stats["total_samples"] += 1
        
        return snapshot
    
    def check_thresholds(self, snapshot: TokenSnapshot) -> Optional[TokenAlert]:
        """
        检查是否触发预警阈值
        
        Returns:
            TokenAlert: 如果触发阈值则返回预警，否则 None
        """
        ctx_pct = snapshot.context_percent
        out_pct = snapshot.output_percent
        
        # 确定预警级别
        level = AlertLevel.SAFE
        
        if ctx_pct >= self.thresholds.context_critical or out_pct >= self.thresholds.output_critical:
            level = AlertLevel.CRITICAL
        elif ctx_pct >= self.thresholds.context_danger or out_pct >= self.thresholds.output_danger:
            level = AlertLevel.DANGER
        elif ctx_pct >= self.thresholds.context_warning or out_pct >= self.thresholds.output_warning:
            level = AlertLevel.WARNING
        
        if level == AlertLevel.SAFE:
            return None
        
        # 构建预警信息
        message_parts = []
        suggestions = []
        
        if ctx_pct >= self.thresholds.context_warning:
            message_parts.append(
                f"上下文使用 {ctx_pct:.1f}% ({snapshot.context_tokens:,}/{snapshot.context_limit:,})"
            )
            suggestions.append("考虑压缩上下文历史")
            suggestions.append("精简系统提示词")
        
        if out_pct >= self.thresholds.output_warning:
            message_parts.append(
                f"输出预算使用 {out_pct:.1f}% ({snapshot.used_output:,}/{snapshot.output_budget:,})"
            )
            suggestions.append("减少单次输出的详细程度")
            
        if snapshot.remaining_output < self.thresholds.min_output_reserve:
            suggestions.append("输出即将超限，可能被截断")
        
        message = " | ".join(message_parts) if message_parts else "Token 使用率较高"
        
        return TokenAlert(
            level=level,
            message=message,
            snapshot=snapshot,
            suggestions=list(set(suggestions))  # 去重
        )
    
    def alert(self, alert: TokenAlert) -> None:
        """
        输出预警信息
        
        Args:
            alert: TokenAlert 实例
        """
        # 冷却期检查
        if time.time() - self._last_alert_time < self._alert_cooldown:
            return
        
        self._last_alert_time = time.time()
        self._stats["alerts_generated"] += 1
        
        # ANSI 颜色码
        colors = {
            AlertLevel.WARNING: "\033[93m",   # 黄色
            AlertLevel.DANGER: "\033[91m",    # 红色
            AlertLevel.CRITICAL: "\033[91;1m", # 加粗红色
        }
        reset = "\033[0m"
        
        emoji = {
            AlertLevel.WARNING: "⚠️",
            AlertLevel.DANGER: "🚨",
            AlertLevel.CRITICAL: "🔴"
        }.get(alert.level, "ℹ️")
        
        color = colors.get(alert.level, "")
        
        # 输出到控制台
        msg = f"{color}{emoji} Token Budget Alert ({alert.level.value.upper()}): {alert.message}{reset}"
        print(msg, file=sys.stderr)
        
        if alert.suggestions:
            for i, suggestion in enumerate(alert.suggestions, 1):
                print(f"  💡 {i}. {suggestion}", file=sys.stderr)
        
        # 同时记录到日志
        logger.warning(msg)
    
    def calculate_output_budget(self, snapshot: TokenSnapshot) -> int:
        """
        计算输出预算（Phase 2: 按需分配）
        
        根据当前上下文使用情况，动态计算合适的输出预算。
        保留足够的安全边际，防止截断。
        
        Args:
            snapshot: 当前 token 快照
            
        Returns:
            int: 建议的输出预算
        """
        if self.mode == self.MODE_OBSERVE:
            # Phase 1: 不改变行为
            return self.current_output_budget
        
        # 计算可用空间
        available = self.context_limit - snapshot.context_tokens
        
        # 安全边际
        safety_margin = max(
            self.thresholds.min_output_reserve,
            int(self.context_limit * 0.05)  # 至少保留 5%
        )
        
        # 理论最大输出
        theoretical_max = max(0, available - safety_margin)
        
        if self.mode == self.MODE_ADAPTIVE:
            # Phase 2: 按需分配，但不超过理论最大值
            recommended = min(theoretical_max, self.base_output_budget)
            recommended = max(recommended, 1024)  # 最少 1024
            
            if recommended != self.current_output_budget:
                logger.debug(
                    f"TokenBudgetManager: output_budget adjusted "
                    f"{self.current_output_budget} → {recommended} "
                    f"(context: {snapshot.context_percent:.1f}%)"
                )
                self.current_output_budget = recommended
                self._stats["budget_adjustments"] += 1
            
            return recommended
        
        # Phase 3: intervene 模式使用 adaptive 的计算，但触发额外动作
        recommended = self.calculate_output_budget(
            TokenSnapshot(
                timestamp=snapshot.timestamp,
                context_tokens=snapshot.context_tokens,
                context_limit=snapshot.context_limit,
                output_budget=self.base_output_budget,
                used_output=snapshot.used_output,
                model_name=snapshot.model_name
            )
        )
        
        # 检查是否需要介入
        if snapshot.context_percent >= self.thresholds.context_critical:
            self._trigger_compression(snapshot)
        
        return recommended
    
    def should_trigger_compression(self, snapshot: TokenSnapshot) -> bool:
        """
        检查是否应该触发压缩（Phase 3）
        
        Returns:
            bool: 如果应该触发压缩返回 True
        """
        if self.mode != self.MODE_INTERVENE:
            return False
        
        # 上下文使用率超过临界阈值
        if snapshot.context_percent >= self.thresholds.context_critical:
            return True
        
        # 输出预算不足
        if snapshot.remaining_output < self.thresholds.min_output_reserve:
            return True
        
        return False
    
    def _trigger_compression(self, snapshot: TokenSnapshot) -> None:
        """
        触发上下文压缩（Phase 3）
        
        这是一个 hook 点，可以集成 HERMES 的 context_compressor
        """
        self._stats["compressions_triggered"] += 1
        logger.info(
            f"TokenBudgetManager: compression triggered "
            f"(context: {snapshot.context_percent:.1f}%)"
        )
        # 压缩逻辑由调用方执行（CLI 的 _manual_compress 方法）
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            **self._stats,
            "mode": self.mode,
            "current_output_budget": self.current_output_budget,
            "context_limit": self.context_limit,
            "history_size": len(self._history)
        }
    
    def reset(self) -> None:
        """重置管理器状态"""
        self._history.clear()
        self.current_output_budget = self.base_output_budget
        self._stats = {
            "total_samples": 0,
            "alerts_generated": 0,
            "budget_adjustments": 0,
            "compressions_triggered": 0
        }
    
    def __repr__(self) -> str:
        return (
            f"TokenBudgetManager(mode={self.mode}, "
            f"context={self.context_limit}, "
            f"output={self.current_output_budget})"
        )


# ═══════════════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════════════

def create_budget_manager(
    config: Dict[str, Any],
    model_name: Optional[str] = None
) -> TokenBudgetManager:
    """
    从 HERMES 配置创建 TokenBudgetManager
    
    Args:
        config: HERMES config.yaml 解析后的字典
        model_name: 可选的模型名称
        
    Returns:
        TokenBudgetManager: 配置好的实例
    """
    context_length = config.get("model_context_length", 16384)
    max_tokens = config.get("model_max_tokens", 4096)
    
    return TokenBudgetManager(
        mode=TokenBudgetManager.MODE_OBSERVE,  # Phase 1: 仅监控
        context_limit=context_length,
        output_budget=max_tokens,
        model_name=model_name or config.get("model", "unknown")
    )


def format_budget_status(snapshot: TokenSnapshot) -> str:
    """
    格式化 Token 状态为可读字符串
    
    Args:
        snapshot: TokenSnapshot 实例
        
    Returns:
        str: 格式化的状态字符串
    """
    ctx_bar = _make_progress_bar(snapshot.context_percent)
    out_bar = _make_progress_bar(snapshot.output_percent)
    
    return (
        f"Token Status:\n"
        f"  上下文 {ctx_bar} {snapshot.context_percent:.1f}% "
        f"({snapshot.context_tokens:,}/{snapshot.context_limit:,})\n"
        f"  输出   {out_bar} {snapshot.output_percent:.1f}% "
        f"({snapshot.used_output:,}/{snapshot.output_budget:,})"
    )


def _make_progress_bar(percent: float, width: int = 20) -> str:
    """创建简单的进度条"""
    filled = int(percent / 100 * width)
    empty = width - filled
    bar = "█" * filled + "░" * empty
    return f"[{bar}]"
