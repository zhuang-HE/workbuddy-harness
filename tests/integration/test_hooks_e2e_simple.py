"""HERMES Hooks系统端到端集成测试

简化版E2E测试，不依赖pytest框架
"""

import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from hermes_cli import plugins as plugins_mod
from hermes_cli.plugins import PluginManager, PluginContext, invoke_hook
from agent import shell_hooks


def setup_env():
    """设置测试环境"""
    test_home = tempfile.mkdtemp(prefix="hermes_e2e_")
    os.environ["HERMES_HOME"] = test_home
    os.environ["HERMES_ACCEPT_HOOKS"] = "1"
    plugins_mod._plugin_manager = PluginManager()
    shell_hooks.reset_for_tests()
    return test_home


def test_lifecycle_hooks():
    """测试会话生命周期hooks"""
    print("\n[1] 测试生命周期Hooks...")

    manager = plugins_mod.get_plugin_manager()
    execution_log = []

    # 注册hooks
    manager._hooks["on_session_start"] = [lambda **kw: execution_log.append("start")]
    manager._hooks["on_session_end"] = [lambda **kw: execution_log.append("end")]
    manager._hooks["on_session_reset"] = [lambda **kw: execution_log.append("reset")]

    # 模拟会话
    invoke_hook("on_session_start", session_id="s1")
    invoke_hook("on_session_end", session_id="s1")
    invoke_hook("on_session_reset", session_id="s1")

    assert execution_log == ["start", "end", "reset"], f"顺序错误: {execution_log}"
    print("   ✅ 生命周期Hooks按正确顺序执行")


def test_tool_call_hooks():
    """测试工具调用hooks"""
    print("\n[2] 测试工具调用Hooks...")

    manager = plugins_mod.get_plugin_manager()
    captured = []

    def pre_tool(**kw):
        captured.append(("pre", kw))
        return None

    def post_tool(**kw):
        captured.append(("post", kw))

    manager._hooks["pre_tool_call"] = [pre_tool]
    manager._hooks["post_tool_call"] = [post_tool]

    invoke_hook("pre_tool_call", tool_name="terminal", args={"cmd": "ls"}, session_id="s1")
    invoke_hook("post_tool_call", tool_name="terminal", args={"cmd": "ls"}, result="ok", session_id="s1")

    assert len(captured) == 2
    assert captured[0][0] == "pre"
    assert captured[0][1]["tool_name"] == "terminal"
    assert captured[1][0] == "post"
    print("   ✅ 工具调用Hooks正确传递参数")


def test_transform_semantics():
    """测试transform_llm_output语义"""
    print("\n[3] 测试LLM输出转换语义...")

    manager = plugins_mod.get_plugin_manager()

    manager._hooks["transform_llm_output"] = [
        lambda **kw: "first",
        lambda **kw: "second",
        lambda **kw: "",  # 空字符串不替换
        lambda **kw: "fourth",
    ]

    results = invoke_hook("transform_llm_output", response_text="original")

    # 模拟run_agent.py逻辑：第一个非空字符串胜出
    final = "original"
    for r in results:
        if isinstance(r, str) and r:
            final = r
            break

    assert final == "first", f"期望'first'，实际'{final}'"
    print("   ✅ transform_llm_output遵循'第一个非空字符串胜出'语义")


def test_block_message_flow():
    """测试阻止消息流程"""
    print("\n[4] 测试阻止消息流程...")

    manager = plugins_mod.get_plugin_manager()

    def block_terminal(**kw):
        if kw.get("tool_name") == "terminal":
            return {"action": "block", "message": "Terminal blocked"}
        return None

    def allow_all(**kw):
        return None

    manager._hooks["pre_tool_call"] = [block_terminal, allow_all]

    # 测试阻止
    msg = plugins_mod.get_pre_tool_call_block_message(
        tool_name="terminal",
        args={"command": "rm -rf /"},
        session_id="s1"
    )
    assert msg == "Terminal blocked", f"阻止失败: {msg}"

    # 测试放行
    msg = plugins_mod.get_pre_tool_call_block_message(
        tool_name="file_read",
        args={"path": "/tmp"},
        session_id="s1"
    )
    assert msg is None, f"意外阻止: {msg}"

    print("   ✅ 阻止消息流程正确工作")


def test_exception_isolation():
    """测试Hook异常隔离"""
    print("\n[5] 测试异常隔离...")

    manager = plugins_mod.get_plugin_manager()

    def raising_hook(**kw):
        raise RuntimeError("Test error")

    def normal_hook(**kw):
        return {"context": "normal"}

    manager._hooks["pre_llm_call"] = [raising_hook, normal_hook]

    results = manager.invoke_hook("pre_llm_call", session_id="test")

    # 正常hook应该返回结果
    assert any(r.get("context") == "normal" for r in results if isinstance(r, dict))
    print("   ✅ 异常Hook不阻断其他Hooks")


def test_concurrent_invocation():
    """测试并发调用"""
    print("\n[6] 测试并发调用...")

    manager = plugins_mod.get_plugin_manager()
    counter = {"value": 0}
    lock = threading.Lock()

    def counting_hook(**kw):
        with lock:
            counter["value"] += 1
        return None

    # 注册100个hooks
    for _ in range(100):
        manager._hooks.setdefault("on_session_start", []).append(counting_hook)

    # 并发调用
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(invoke_hook, "on_session_start", session_id=f"s{i}")
            for i in range(50)
        ]
        for f in as_completed(futures):
            f.result()

    # 每个hook应该被调用50次
    assert counter["value"] == 5000, f"期望5000，实际{counter['value']}"
    print("   ✅ 并发调用正确工作 (100 hooks × 50 calls = 5000)")


def test_hook_scaling():
    """测试Hook扩展性"""
    print("\n[7] 测试Hook扩展性...")

    import time

    manager = plugins_mod.get_plugin_manager()

    for count in [1, 10, 50, 100]:
        manager._hooks.clear()
        for _ in range(count):
            manager._hooks.setdefault("pre_llm_call", []).append(lambda **kw: None)

        iterations = 1000
        t0 = time.perf_counter()
        for _ in range(iterations):
            manager.invoke_hook("pre_llm_call", session_id="test")
        elapsed = (time.perf_counter() - t0) * 1000

        avg_ms = elapsed / iterations
        print(f"   {count:3d} hooks: {avg_ms:.4f}ms/调用")

    print("   ✅ Hook扩展性测试完成")


def test_python_hook_integration():
    """测试Python Hook完整集成"""
    print("\n[8] 测试Python Hook集成...")

    manager = plugins_mod.get_plugin_manager()

    # 模拟词汇过滤器
    vocabulary = {"SENSITIVE": "REDACTED"}

    def vocab_filter(**kw):
        text = kw.get("response_text", "")
        for old, new in vocabulary.items():
            text = text.replace(old, new)
        return text

    manager._hooks["transform_llm_output"] = [vocab_filter]

    results = invoke_hook("transform_llm_output", response_text="Contains SENSITIVE data")
    final = results[0] if results else "original"

    assert final == "Contains REDACTED data"
    print("   ✅ Python Hook集成工作正常")


def test_pre_llm_context_injection():
    """测试上下文注入"""
    print("\n[9] 测试上下文注入...")

    manager = plugins_mod.get_plugin_manager()

    def context_injector(**kw):
        return {"context": "Today is a good day"}

    manager._hooks["pre_llm_call"] = [context_injector]

    results = invoke_hook("pre_llm_call",
        session_id="s1",
        user_message="hello",
        model="gpt-4",
        platform="cli"
    )

    contexts = [r.get("context") for r in results if isinstance(r, dict) and r.get("context")]
    assert "Today is a good day" in contexts
    print("   ✅ 上下文注入功能正常")


def main():
    print("=" * 70)
    print("HERMES HOOKS 端到端集成测试")
    print("=" * 70)

    test_home = setup_env()
    print(f"测试环境: {test_home}")

    tests = [
        test_lifecycle_hooks,
        test_tool_call_hooks,
        test_transform_semantics,
        test_block_message_flow,
        test_exception_isolation,
        test_concurrent_invocation,
        test_hook_scaling,
        test_python_hook_integration,
        test_pre_llm_context_injection,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"   ❌ {e}")
            failed += 1

    print("\n" + "=" * 70)
    print("测试汇总")
    print("=" * 70)
    print(f"通过: {passed}")
    print(f"失败: {failed}")
    print(f"总计: {passed + failed}")

    if failed == 0:
        print("\n🎉 所有E2E测试通过！")
        return 0
    else:
        print(f"\n⚠️  {failed}个测试失败")
        return 1


if __name__ == "__main__":
    sys.exit(main())
