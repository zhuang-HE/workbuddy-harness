"""Hooks系统性能基准测试

这个模块测试HERMES CLI Hooks系统的性能特征：
1. 不同hooks数量下的invoke_hook延迟
2. Shell script hooks的执行开销
3. 各种hook事件类型的性能对比
4. 并发场景下的性能表现
5. 内存使用情况
"""

from __future__ import annotations

import gc
import json
import os
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from unittest.mock import MagicMock

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False
    psutil = None

# 项目路径设置
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT))

from hermes_cli import plugins as plugins_mod
from hermes_cli.plugins import PluginManager, PluginContext, VALID_HOOKS, invoke_hook
from agent import shell_hooks


# ─────────────────────────────────────────────────────────────────────────────
# 数据结构
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class BenchmarkResult:
    """单个基准测试结果"""
    name: str
    iterations: int
    min_ms: float
    max_ms: float
    avg_ms: float
    median_ms: float
    p95_ms: float
    p99_ms: float
    std_dev_ms: float
    total_ms: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "iterations": self.iterations,
            "min_ms": round(self.min_ms, 4),
            "max_ms": round(self.max_ms, 4),
            "avg_ms": round(self.avg_ms, 4),
            "median_ms": round(self.median_ms, 4),
            "p95_ms": round(self.p95_ms, 4),
            "p99_ms": round(self.p99_ms, 4),
            "std_dev_ms": round(self.std_dev_ms, 4),
            "total_ms": round(self.total_ms, 4),
        }


@dataclass
class BenchmarkSuite:
    """基准测试套件"""
    name: str
    results: List[BenchmarkResult] = field(default_factory=list)
    start_time: float = 0.0
    end_time: float = 0.0

    def add_result(self, result: BenchmarkResult):
        self.results.append(result)

    def total_time(self) -> float:
        return self.end_time - self.start_time

    def summary(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "total_time_seconds": round(self.total_time(), 2),
            "test_count": len(self.results),
            "results": [r.to_dict() for r in self.results]
        }


# ─────────────────────────────────────────────────────────────────────────────
# 基准测试工具
# ─────────────────────────────────────────────────────────────────────────────


def run_benchmark(
    name: str,
    fn: Callable,
    iterations: int = 1000,
    warmup: int = 100,
    warmup_iterations: int = 10,
) -> BenchmarkResult:
    """运行单个基准测试"""
    # 热身
    for _ in range(warmup):
        for _ in range(warmup_iterations):
            fn()

    # 实际测量
    times: List[float] = []
    for _ in range(iterations):
        gc.disable()
        t0 = time.perf_counter()
        fn()
        elapsed = (time.perf_counter() - t0) * 1000  # ms
        gc.enable()
        times.append(elapsed)

    times.sort()
    n = len(times)

    import statistics
    return BenchmarkResult(
        name=name,
        iterations=iterations,
        min_ms=times[0],
        max_ms=times[-1],
        avg_ms=sum(times) / n,
        median_ms=times[n // 2],
        p95_ms=times[int(n * 0.95)],
        p99_ms=times[int(n * 0.99)],
        std_dev_ms=statistics.stdev(times) if n > 1 else 0,
        total_ms=sum(times),
    )


def measure_memory() -> Dict[str, int]:
    """测量当前内存使用"""
    if not HAS_PSUTIL:
        return {"rss_mb": 0, "vms_mb": 0, "note": "psutil not available"}

    process = psutil.Process()
    return {
        "rss_mb": process.memory_info().rss / 1024 / 1024,
        "vms_mb": process.memory_info().vms / 1024 / 1024,
    }


def create_empty_hooks(n: int, manager: PluginManager):
    """创建N个空hooks"""
    for i in range(n):
        def empty_hook(**kw):
            return None
        manager._hooks.setdefault("pre_llm_call", []).append(empty_hook)


# ─────────────────────────────────────────────────────────────────────────────
# 基准测试套件
# ─────────────────────────────────────────────────────────────────────────────


def benchmark_invoke_hook_scaling():
    """测试invoke_hook调用次数对性能的影响"""
    suite = BenchmarkSuite(name="invoke_hook_scaling")

    # 重置manager
    plugins_mod._plugin_manager = PluginManager()
    manager = plugins_mod.get_plugin_manager()

    # 测试不同hooks数量
    hook_counts = [1, 10, 50, 100, 200]

    for count in hook_counts:
        # 清除现有hooks
        manager._hooks.clear()
        # 添加指定数量的空hooks
        create_empty_hooks(count, manager)

        # 测量
        result = run_benchmark(
            name=f"invoke_hook({count}_hooks)",
            fn=lambda: manager.invoke_hook("pre_llm_call", session_id="test"),
            iterations=500,
            warmup=10,
        )
        suite.add_result(result)

    return suite


def benchmark_hook_types():
    """测试不同hook事件类型的性能"""
    suite = BenchmarkSuite(name="hook_types")

    plugins_mod._plugin_manager = PluginManager()
    manager = plugins_mod.get_plugin_manager()

    # 注册一个空hook用于所有事件类型
    def empty_hook(**kw):
        return None

    events = [
        "on_session_start",
        "on_session_end",
        "pre_llm_call",
        "post_llm_call",
        "pre_tool_call",
        "post_tool_call",
        "pre_api_request",
        "post_api_request",
    ]

    for event in events:
        manager._hooks.clear()
        manager._hooks.setdefault(event, []).append(empty_hook)

        result = run_benchmark(
            name=f"hook_event({event})",
            fn=lambda e=event: manager.invoke_hook(e, session_id="test"),
            iterations=1000,
        )
        suite.add_result(result)

    return suite


def benchmark_shell_hook_overhead():
    """测试Shell Hook的执行开销"""
    suite = BenchmarkSuite(name="shell_hook_overhead")

    # 创建临时目录
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # 创建空脚本（最小开销）
        empty_script = tmp_path / "empty.sh"
        empty_script.write_text('#!/bin/bash\nexit 0\n')
        empty_script.chmod(0o755)

        # 创建输出脚本
        output_script = tmp_path / "output.sh"
        output_script.write_text('#!/bin/bash\necho "{}"\n')
        output_script.chmod(0o755)

        # 创建JSON输出脚本
        json_script = tmp_path / "json.sh"
        json_script.write_text('#!/bin/bash\necho \'{"context": "test"}\'\n')
        json_script.chmod(0o755)

        # 测试空脚本
        spec = shell_hooks.ShellHookSpec(
            event="pre_llm_call",
            command=str(empty_script),
            timeout=5
        )

        def run_shell_empty():
            return shell_hooks.run_once(spec, {"session_id": "test"})

        result = run_benchmark(
            name="shell_hook(empty)",
            fn=run_shell_empty,
            iterations=100,
            warmup=5,
        )
        suite.add_result(result)

        # 测试JSON输出脚本
        spec2 = shell_hooks.ShellHookSpec(
            event="pre_llm_call",
            command=str(json_script),
            timeout=5
        )

        def run_shell_json():
            return shell_hooks.run_once(spec2, {"session_id": "test"})

        result2 = run_benchmark(
            name="shell_hook(json)",
            fn=run_shell_json,
            iterations=100,
            warmup=5,
        )
        suite.add_result(result2)

    # 与Python hook对比
    plugins_mod._plugin_manager = PluginManager()
    manager = plugins_mod.get_plugin_manager()

    def python_hook(**kw):
        return {"context": "test"}

    manager._hooks["pre_llm_call"] = [python_hook]

    result3 = run_benchmark(
        name="python_hook(same_logic)",
        fn=lambda: manager.invoke_hook("pre_llm_call", session_id="test"),
        iterations=1000,
    )
    suite.add_result(result3)

    return suite


def benchmark_transform_semantics():
    """测试transform_llm_output的语义性能"""
    suite = BenchmarkSuite(name="transform_semantics")

    plugins_mod._plugin_manager = PluginManager()
    manager = plugins_mod.get_plugin_manager()

    # 测试不同返回值数量的性能
    for return_count in [1, 5, 10, 20]:
        manager._hooks["transform_llm_output"] = [
            lambda **kw: f"transform_{i}"
            for i in range(return_count)
        ]

        # 模拟run_agent.py的语义
        def invoke_with_semantics():
            results = manager.invoke_hook("transform_llm_output", response_text="original")
            final = "original"
            for r in results:
                if isinstance(r, str) and r:
                    final = r
                    break
            return final

        result = run_benchmark(
            name=f"transform_semantics({return_count}_hooks)",
            fn=invoke_with_semantics,
            iterations=500,
        )
        suite.add_result(result)

    return suite


def benchmark_concurrent_invocation():
    """测试并发调用的性能"""
    suite = BenchmarkSuite(name="concurrent_invocation")

    plugins_mod._plugin_manager = PluginManager()
    manager = plugins_mod.get_plugin_manager()

    # 注册固定数量的hooks
    create_empty_hooks(10, manager)

    def invoke_in_thread():
        manager.invoke_hook("pre_llm_call", session_id="test")

    # 测试不同并发度
    for concurrency in [1, 5, 10, 20]:
        iterations = 100

        def run_concurrent():
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = [executor.submit(invoke_in_thread) for _ in range(iterations)]
                for f in as_completed(futures):
                    f.result()

        # 测量并发调用的总时间
        t0 = time.perf_counter()
        run_concurrent()
        total_ms = (time.perf_counter() - t0) * 1000

        per_call_ms = total_ms / iterations

        result = BenchmarkResult(
            name=f"concurrent({concurrency}_workers)_per_call",
            iterations=iterations,
            min_ms=per_call_ms,
            max_ms=per_call_ms,
            avg_ms=per_call_ms,
            median_ms=per_call_ms,
            p95_ms=per_call_ms,
            p99_ms=per_call_ms,
            std_dev_ms=0,
            total_ms=total_ms,
        )
        suite.add_result(result)

    return suite


def benchmark_memory_usage():
    """测试不同hooks数量下的内存使用"""
    suite = BenchmarkSuite(name="memory_usage")

    # 基线内存
    gc.collect()
    baseline = measure_memory()

    for hook_count in [0, 100, 500, 1000, 2000]:
        plugins_mod._plugin_manager = PluginManager()
        manager = plugins_mod.get_plugin_manager()

        gc.collect()

        # 创建指定数量的hooks
        for i in range(hook_count):
            def empty_hook(**kw):
                return None
            manager._hooks.setdefault("pre_llm_call", []).append(empty_hook)

        gc.collect()
        after = measure_memory()

        # 测量invoke_hook的内存分配
        for _ in range(10):
            manager.invoke_hook("pre_llm_call", session_id="test")

        gc.collect()
        final = measure_memory()

        result = BenchmarkResult(
            name=f"memory({hook_count}_hooks)",
            iterations=1,
            min_ms=0,
            max_ms=0,
            avg_ms=0,
            median_ms=0,
            p95_ms=0,
            p99_ms=0,
            std_dev_ms=0,
            total_ms=0,
        )
        # 存储在额外字段
        result._extra = {
            "baseline_mb": baseline["rss_mb"],
            "after_hooks_mb": after["rss_mb"],
            "final_mb": final["rss_mb"],
            "delta_mb": final["rss_mb"] - baseline["rss_mb"],
        }
        suite.add_result(result)

    return suite


# ─────────────────────────────────────────────────────────────────────────────
# 报告生成
# ─────────────────────────────────────────────────────────────────────────────


def print_benchmark_report(suites: List[BenchmarkSuite]):
    """打印格式化的基准测试报告"""

    print("\n" + "=" * 80)
    print("HERMES HOOKS 系统性能基准测试报告")
    print("=" * 80)
    print(f"\n生成时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Python版本: {sys.version}")
    print(f"平台: {sys.platform}")

    for suite in suites:
        print(f"\n{'='*80}")
        print(f"测试套件: {suite.name}")
        print(f"总耗时: {suite.total_time():.2f}秒")
        print(f"测试数量: {len(suite.results)}")
        print("-" * 80)

        # 表头
        print(f"{'测试名称':<45} {'平均':>10} {'中位数':>10} {'P95':>10} {'P99':>10}")
        print("-" * 80)

        for result in suite.results:
            extra = getattr(result, '_extra', {})
            if extra:
                # 内存测试特殊格式
                print(f"{result.name:<45} {extra['delta_mb']:>9.1f}MB")
            else:
                print(
                    f"{result.name:<45} "
                    f"{result.avg_ms:>9.3f}ms "
                    f"{result.median_ms:>9.3f}ms "
                    f"{result.p95_ms:>9.3f}ms "
                    f"{result.p99_ms:>9.3f}ms"
                )

    # 性能摘要
    print("\n" + "=" * 80)
    print("性能摘要")
    print("=" * 80)

    # 找出最佳和最差的测试
    all_results = []
    for suite in suites:
        for r in suite.results:
            if hasattr(r, '_extra'):
                continue
            all_results.append(r)

    if all_results:
        best = min(all_results, key=lambda x: x.avg_ms)
        worst = max(all_results, key=lambda x: x.avg_ms)

        print(f"\n最佳性能: {best.name}")
        print(f"  平均延迟: {best.avg_ms:.4f}ms")

        print(f"\n最差性能: {worst.name}")
        print(f"  平均延迟: {worst.avg_ms:.4f}ms")

        # 性能建议
        print("\n性能建议:")

        # 建议1: Hooks数量控制
        invoke_suite = next((s for s in suites if s.name == "invoke_hook_scaling"), None)
        if invoke_suite:
            r1 = next((r for r in invoke_suite.results if "1_hooks" in r.name), None)
            r100 = next((r for r in invoke_suite.results if "100_hooks" in r.name), None)
            if r1 and r100:
                overhead = r100.avg_ms / r1.avg_ms
                if overhead > 10:
                    print(f"  ⚠️  Hook数量对性能影响较大 (100hooks/{r100.avg_ms:.2f}ms vs 1hook/{r1.avg_ms:.2f}ms)")
                    print("     建议: 合并相似功能的hooks，减少hooks总数")
                else:
                    print(f"  ✅ Hooks数量对性能影响可控 (比例: {overhead:.1f}x)")

        # 建议2: Shell vs Python Hooks
        shell_suite = next((s for s in suites if s.name == "shell_hook_overhead"), None)
        if shell_suite:
            shell_r = next((r for r in shell_suite.results if "shell_hook(empty)" in r.name), None)
            python_r = next((r for r in shell_suite.results if "python_hook" in r.name), None)
            if shell_r and python_r:
                ratio = shell_r.avg_ms / python_r.avg_ms if python_r.avg_ms > 0 else float('inf')
                print(f"\n  Shell Hook vs Python Hook: {ratio:.0f}x 延迟开销")
                if ratio > 100:
                    print("  ⚠️  Shell hooks有明显性能开销")
                    print("     建议: 对延迟敏感的场景使用Python hooks")
                else:
                    print("  ✅ Shell hooks性能可接受")

    print("\n" + "=" * 80)


def save_results_to_json(suites: List[BenchmarkSuite], path: Path):
    """保存结果到JSON文件"""
    data = {
        "generated_at": time.strftime('%Y-%m-%d %H:%M:%S'),
        "python_version": sys.version,
        "platform": sys.platform,
        "suites": [s.summary() for s in suites]
    }

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n结果已保存到: {path}")


# ─────────────────────────────────────────────────────────────────────────────
# 主函数
# ─────────────────────────────────────────────────────────────────────────────


def run_all_benchmarks() -> List[BenchmarkSuite]:
    """运行所有基准测试"""
    suites = []

    print("开始运行基准测试...")

    # 1. Hooks数量扩展性测试
    print("\n[1/6] 测试invoke_hook扩展性...")
    suite = benchmark_invoke_hook_scaling()
    suite.end_time = time.time()
    suite.start_time = suite.end_time - sum(r.total_ms for r in suite.results) / 1000
    suites.append(suite)

    # 2. Hook类型测试
    print("[2/6] 测试不同Hook事件类型...")
    suite = benchmark_hook_types()
    suite.end_time = time.time()
    suite.start_time = suite.end_time - sum(r.total_ms for r in suite.results) / 1000
    suites.append(suite)

    # 3. Shell Hook开销测试
    print("[3/6] 测试Shell Hook执行开销...")
    suite = benchmark_shell_hook_overhead()
    suite.end_time = time.time()
    suite.start_time = suite.end_time - sum(r.total_ms for r in suite.results) / 1000
    suites.append(suite)

    # 4. Transform语义测试
    print("[4/6] 测试transform_llm_output语义...")
    suite = benchmark_transform_semantics()
    suite.end_time = time.time()
    suite.start_time = suite.end_time - sum(r.total_ms for r in suite.results) / 1000
    suites.append(suite)

    # 5. 并发测试
    print("[5/6] 测试并发调用性能...")
    suite = benchmark_concurrent_invocation()
    suite.end_time = time.time()
    suite.start_time = suite.end_time - sum(r.total_ms for r in suite.results) / 1000
    suites.append(suite)

    # 6. 内存测试
    print("[6/6] 测试内存使用...")
    suite = benchmark_memory_usage()
    suite.end_time = time.time()
    suite.start_time = suite.end_time
    suites.append(suite)

    return suites


def main():
    """主函数"""
    # 设置环境
    test_home = tempfile.mkdtemp(prefix="hermes_hooks_bench_")
    os.environ["HERMES_HOME"] = test_home
    os.environ["HERMES_ACCEPT_HOOKS"] = "1"

    try:
        # 运行所有基准测试
        suites = run_all_benchmarks()

        # 打印报告
        print_benchmark_report(suites)

        # 保存JSON结果
        output_path = Path(test_home) / "hooks_benchmark_results.json"
        save_results_to_json(suites, output_path)

        return 0

    finally:
        # 清理
        if "HERMES_HOME" in os.environ:
            del os.environ["HERMES_HOME"]


if __name__ == "__main__":
    sys.exit(main())
