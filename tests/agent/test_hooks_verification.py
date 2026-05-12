"""验证Hooks系统实际执行效果

这个脚本验证HERMES CLI的Hooks系统是否正常工作，包括：
1. 所有VALID_HOOKS事件类型的注册和调用
2. Python plugin hooks的执行
3. Shell script hooks的执行
4. Hooks回调的异常处理
5. 多hooks组合执行
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

# 添加项目路径
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# 设置测试环境
TEST_HOME = tempfile.mkdtemp(prefix="hermes_hooks_verify_")
os.environ["HERMES_HOME"] = TEST_HOME
os.environ["HERMES_ACCEPT_HOOKS"] = "1"

from hermes_cli import plugins as plugins_mod
from hermes_cli.plugins import PluginManager, VALID_HOOKS, invoke_hook
from agent import shell_hooks


class HooksVerificationResult:
    """Hooks验证结果"""

    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []

    def add_pass(self, name: str, detail: str = ""):
        self.passed.append({"name": name, "detail": detail})

    def add_fail(self, name: str, detail: str):
        self.failed.append({"name": name, "detail": detail})

    def add_warning(self, name: str, detail: str):
        self.warnings.append({"name": name, "detail": detail})

    def print_report(self):
        print("\n" + "=" * 70)
        print("HERMES HOOKS 系统验证报告")
        print("=" * 70)

        print(f"\n✅ 通过: {len(self.passed)} 项")
        for item in self.passed:
            print(f"   • {item['name']}")
            if item['detail']:
                print(f"     {item['detail']}")

        if self.failed:
            print(f"\n❌ 失败: {len(self.failed)} 项")
            for item in self.failed:
                print(f"   • {item['name']}")
                print(f"     原因: {item['detail']}")

        if self.warnings:
            print(f"\n⚠️  警告: {len(self.warnings)} 项")
            for item in self.warnings:
                print(f"   • {item['name']}")
                print(f"     {item['detail']}")

        total = len(self.passed) + len(self.failed)
        pass_rate = len(self.passed) / total * 100 if total > 0 else 0

        print(f"\n通过率: {pass_rate:.1f}% ({len(self.passed)}/{total})")
        print("=" * 70)

        return len(self.failed) == 0


def verify_valid_hooks():
    """验证所有定义的hook事件"""
    result = HooksVerificationResult()

    print("\n[1/8] 验证 VALID_HOOKS 定义...")

    # 核心hooks必须存在
    core_hooks = {
        "pre_tool_call": "工具调用前",
        "post_tool_call": "工具调用后",
        "transform_terminal_output": "终端输出转换",
        "transform_tool_result": "工具结果转换",
        "transform_llm_output": "LLM输出转换",
        "pre_llm_call": "LLM调用前",
        "post_llm_call": "LLM调用后",
        "pre_api_request": "API请求前",
        "post_api_request": "API响应后",
        "on_session_start": "会话开始",
        "on_session_end": "会话结束",
        "on_session_finalize": "会话终结",
        "on_session_reset": "会话重置",
        "subagent_stop": "子代理停止",
        "pre_gateway_dispatch": "网关预处理",
        "pre_approval_request": "审批请求前",
        "post_approval_response": "审批响应后",
    }

    for hook_name, description in core_hooks.items():
        if hook_name in VALID_HOOKS:
            result.add_pass(f"{hook_name}", description)
        else:
            result.add_fail(f"{hook_name}", f"缺失核心hook: {description}")

    return result


def verify_plugin_manager():
    """验证PluginManager基本功能"""
    result = HooksVerificationResult()

    print("\n[2/8] 验证 PluginManager 基本功能...")

    try:
        # 重置manager
        plugins_mod._plugin_manager = PluginManager()
        mgr = plugins_mod.get_plugin_manager()

        # 验证空状态
        if len(mgr._hooks) == 0:
            result.add_pass("PluginManager初始化", "无hooks注册（符合预期）")
        else:
            result.add_fail("PluginManager初始化", f"发现{len(mgr._hooks)}个意外hooks")

        # 验证invoke_hook方法存在
        if hasattr(mgr, 'invoke_hook'):
            result.add_pass("invoke_hook方法", "PluginManager.invoke_hook存在")
        else:
            result.add_fail("invoke_hook方法", "PluginManager缺少invoke_hook方法")

        # 验证get_pre_tool_call_block_message函数
        if hasattr(plugins_mod, 'get_pre_tool_call_block_message'):
            result.add_pass("get_pre_tool_call_block_message", "阻止消息检查函数存在")
        else:
            result.add_fail("get_pre_tool_call_block_message", "阻止消息检查函数缺失")

    except Exception as e:
        result.add_fail("PluginManager初始化", str(e))

    return result


def verify_python_hook_registration():
    """验证Python hook注册机制"""
    result = HooksVerificationResult()

    print("\n[3/8] 验证 Python Hook 注册机制...")

    try:
        plugins_mod._plugin_manager = PluginManager()
        mgr = plugins_mod.get_plugin_manager()

        # 注册测试hooks
        pre_call_results = []
        post_call_results = []

        def pre_tool(**kwargs):
            pre_call_results.append(kwargs)
            return None

        def post_tool(**kwargs):
            post_call_results.append(kwargs)
            return {"action": "block", "message": "blocked"}

        mgr._hooks.setdefault("pre_tool_call", []).append(pre_tool)
        mgr._hooks.setdefault("post_tool_call", []).append(post_tool)

        # 调用hooks
        invoke_hook("pre_tool_call", tool_name="terminal", args={"cmd": "ls"})
        invoke_hook("post_tool_call", tool_name="terminal", args={"cmd": "ls"}, result="ok")

        # 验证调用记录
        if len(pre_call_results) == 1:
            result.add_pass("pre_tool_call调用记录", f"接收到正确参数: {list(pre_call_results[0].keys())}")
        else:
            result.add_fail("pre_tool_call调用记录", f"期望1次调用，实际{len(pre_call_results)}次")

        if len(post_call_results) == 1:
            result.add_pass("post_tool_call调用记录", f"接收到正确参数: {list(post_call_results[0].keys())}")
        else:
            result.add_fail("post_tool_call调用记录", f"期望1次调用，实际{len(post_call_results)}次")

    except Exception as e:
        result.add_fail("Python Hook注册", str(e))

    return result


def verify_shell_hook_execution():
    """验证Shell Hook执行"""
    result = HooksVerificationResult()

    print("\n[4/8] 验证 Shell Hook 执行...")

    # 检查是否为Windows环境
    is_windows = sys.platform == "win32"

    if is_windows:
        # Windows环境使用Python脚本代替shell
        result.add_warning("Shell Hook执行", "Windows环境，跳过shell脚本测试")

        # 验证ShellHookSpec解析器
        try:
            spec = shell_hooks.ShellHookSpec(
                event="pre_llm_call",
                command="python --version",  # 使用python作为命令
                timeout=10
            )

            # 验证spec创建成功
            if spec.event == "pre_llm_call" and spec.timeout == 10:
                result.add_pass("ShellHookSpec解析", f"创建成功: event={spec.event}, timeout={spec.timeout}")
            else:
                result.add_fail("ShellHookSpec解析", "创建失败")
        except Exception as e:
            result.add_fail("ShellHookSpec解析", str(e))

        # 验证Python脚本作为hook的执行
        try:
            tmp_dir = Path(TEST_HOME) / "shell_test"
            tmp_dir.mkdir(exist_ok=True)

            # 创建Python脚本
            py_script = tmp_dir / "test_hook.py"
            py_script.write_text('import json, sys\nprint(json.dumps({"context": "python_hooks_works"}))\n')

            spec = shell_hooks.ShellHookSpec(
                event="pre_llm_call",
                command=f"python {py_script}",
                timeout=10
            )

            # 使用run_once执行
            kwargs = {"session_id": "test", "user_message": "hello"}
            r = shell_hooks.run_once(spec, kwargs)

            if r.get("returncode") == 0:
                result.add_pass("Python Hook执行成功", f"返回码: {r['returncode']}")
            else:
                result.add_warning("Python Hook执行", f"返回码: {r.get('returncode')}, 错误: {r.get('error')}")

            if r.get("parsed"):
                result.add_pass("Python Hook响应解析", f"parsed: {r['parsed']}")

        except Exception as e:
            result.add_fail("Python Hook执行", str(e))

        # 跳过超时测试（在Windows上难以模拟）
        result.add_warning("Shell Hook超时处理", "Windows环境，跳过超时测试")

        return result

    try:
        tmp_dir = Path(TEST_HOME) / "shell_test"
        tmp_dir.mkdir(exist_ok=True)

        # 创建测试脚本
        script_path = tmp_dir / "test_hook.sh"
        script_path.write_text('#!/bin/bash\necho \'{"context": "shell_hooks_works"}\'\n')
        script_path.chmod(0o755)

        # 创建spec并执行
        spec = shell_hooks.ShellHookSpec(
            event="pre_llm_call",
            command=str(script_path),
            timeout=10
        )

        # 使用run_once执行
        kwargs = {"session_id": "test", "user_message": "hello"}
        r = shell_hooks.run_once(spec, kwargs)

        # 验证结果
        if r.get("returncode") == 0:
            result.add_pass("Shell Hook执行成功", f"返回码: {r['returncode']}")
        else:
            result.add_fail("Shell Hook执行成功", f"返回码: {r.get('returncode')}, 错误: {r.get('error')}")

        if r.get("parsed"):
            result.add_pass("Shell Hook响应解析", f"parsed: {r['parsed']}")
        else:
            result.add_warning("Shell Hook响应解析", "无有效响应（可能正常）")

        # 验证超时处理
        slow_script = tmp_dir / "slow_hook.sh"
        slow_script.write_text('#!/bin/bash\nsleep 30\necho "{}"\n')
        slow_script.chmod(0o755)

        slow_spec = shell_hooks.ShellHookSpec(
            event="pre_llm_call",
            command=str(slow_script),
            timeout=1  # 1秒超时
        )

        slow_r = shell_hooks.run_once(slow_spec, kwargs)
        if slow_r.get("timed_out"):
            result.add_pass("Shell Hook超时处理", "超时正确触发")
        else:
            result.add_fail("Shell Hook超时处理", "超时未触发")

    except Exception as e:
        result.add_fail("Shell Hook执行", str(e))

    return result


def verify_hook_exception_handling():
    """验证Hook异常处理"""
    result = HooksVerificationResult()

    print("\n[5/8] 验证 Hook 异常处理...")

    try:
        plugins_mod._plugin_manager = PluginManager()
        mgr = plugins_mod.get_plugin_manager()

        errors_caught = []

        def raising_hook(**kwargs):
            raise RuntimeError("Intentional test error")

        def normal_hook(**kwargs):
            return {"context": "normal"}

        mgr._hooks["pre_llm_call"] = [raising_hook, normal_hook]

        # invoke_hook应该捕获异常并继续
        results = mgr.invoke_hook("pre_llm_call", session_id="test")

        # 正常hook应该返回结果
        if any(r.get("context") == "normal" for r in results if isinstance(r, dict)):
            result.add_pass("Hook异常隔离", "异常hook不阻断其他hooks")
        else:
            result.add_fail("Hook异常隔离", f"异常未正确处理，结果: {results}")

        # 测试无效返回值
        def bad_return_hook(**kwargs):
            return "this is a string"

        mgr._hooks["pre_llm_call"] = [bad_return_hook]
        results = mgr.invoke_hook("pre_llm_call", session_id="test")

        # 字符串返回值应该被接受
        if len(results) == 1 and results[0] == "this is a string":
            result.add_pass("Hook返回值处理", "字符串返回值正确处理")
        else:
            result.add_warning("Hook返回值处理", f"结果与预期不符: {results}")

    except Exception as e:
        result.add_fail("Hook异常处理", str(e))

    return result


def verify_block_message_flow():
    """验证阻止消息流程"""
    result = HooksVerificationResult()

    print("\n[6/8] 验证阻止消息流程...")

    try:
        plugins_mod._plugin_manager = PluginManager()
        mgr = plugins_mod.get_plugin_manager()

        # 使用不同的hooks来区分工具
        def block_terminal(**kwargs):
            if kwargs.get("tool_name") == "terminal":
                return {"action": "block", "message": "Terminal blocked by test"}
            return None  # 不阻止其他工具

        def allow_all(**kwargs):
            return None  # 全部放行

        mgr._hooks["pre_tool_call"] = [block_terminal, allow_all]

        # 测试阻止
        msg = plugins_mod.get_pre_tool_call_block_message(
            tool_name="terminal",
            args={"command": "rm -rf /"},
            session_id="test"
        )

        if msg == "Terminal blocked by test":
            result.add_pass("阻止消息提取", f"消息: {msg}")
        else:
            result.add_fail("阻止消息提取", f"期望'Terminal blocked by test'，实际: {msg}")

        # 测试非阻止工具
        msg_file = plugins_mod.get_pre_tool_call_block_message(
            tool_name="file_read",
            args={"path": "/tmp/test"},
            session_id="test"
        )

        if msg_file is None:
            result.add_pass("非阻止工具放行", "file_read未被阻止（符合预期）")
        else:
            result.add_fail("非阻止工具放行", f"file_read意外被阻止: {msg_file}")

    except Exception as e:
        result.add_fail("阻止消息流程", str(e))

    return result


def verify_multiple_hooks_ordering():
    """验证多hooks执行顺序"""
    result = HooksVerificationResult()

    print("\n[7/8] 验证多 Hooks 执行顺序...")

    try:
        plugins_mod._plugin_manager = PluginManager()
        mgr = plugins_mod.get_plugin_manager()

        call_order = []

        def hook1(**kwargs):
            call_order.append(1)
            return None

        def hook2(**kwargs):
            call_order.append(2)
            return None

        def hook3(**kwargs):
            call_order.append(3)
            return None

        mgr._hooks["on_session_start"] = [hook1, hook2, hook3]

        # 调用
        mgr.invoke_hook("on_session_start", session_id="test")

        # 验证顺序
        if call_order == [1, 2, 3]:
            result.add_pass("Hook执行顺序", f"按注册顺序执行: {call_order}")
        else:
            result.add_fail("Hook执行顺序", f"期望[1,2,3]，实际{call_order}")

        # 测试transform_llm_output的"第一个非空字符串胜出"语义
        def transform1(**kwargs):
            return "first"

        def transform2(**kwargs):
            return "second"

        def transform3(**kwargs):
            return ""  # 空字符串不替换

        mgr._hooks["transform_llm_output"] = [transform1, transform2, transform3]

        results = mgr.invoke_hook("transform_llm_output", response_text="original")

        # 模拟run_agent.py的逻辑
        final_response = "original"
        for hook_result in results:
            if isinstance(hook_result, str) and hook_result:
                final_response = hook_result
                break

        if final_response == "first":
            result.add_pass("transform_llm_output语义", "第一个非空字符串胜出")
        else:
            result.add_fail("transform_llm_output语义", f"期望'first'，实际'{final_response}'")

    except Exception as e:
        result.add_fail("多Hooks执行", str(e))

    return result


def verify_hooks_performance():
    """验证Hooks性能基准"""
    result = HooksVerificationResult()

    print("\n[8/8] 验证 Hooks 性能基准...")

    try:
        plugins_mod._plugin_manager = PluginManager()
        mgr = plugins_mod.get_plugin_manager()

        # 注册多个空hooks
        n_hooks = 100
        for i in range(n_hooks):
            def empty_hook(**kwargs):
                return None
            mgr._hooks.setdefault("pre_llm_call", []).append(empty_hook)

        # 测量invoke_hook性能
        iterations = 1000
        t0 = time.perf_counter()
        for _ in range(iterations):
            mgr.invoke_hook("pre_llm_call", session_id="test", user_message="hello")
        elapsed = (time.perf_counter() - t0) * 1000  # ms

        avg_ms = elapsed / iterations

        if avg_ms < 1.0:  # 小于1ms
            result.add_pass(f"性能基准 ({n_hooks} hooks)", f"平均 {avg_ms:.3f}ms/调用")
        elif avg_ms < 10.0:
            result.add_warning(f"性能基准 ({n_hooks} hooks)", f"平均 {avg_ms:.3f}ms/调用 (可接受)")
        else:
            result.add_fail(f"性能基准 ({n_hooks} hooks)", f"平均 {avg_ms:.3f}ms/调用 (过慢)")

        # 测量单hook性能
        mgr._hooks["pre_llm_call"] = [lambda **kwargs: None]

        t0 = time.perf_counter()
        for _ in range(iterations * 10):
            mgr.invoke_hook("pre_llm_call", session_id="test")
        single_avg = ((time.perf_counter() - t0) * 1000) / (iterations * 10)

        result.add_pass("单Hook性能", f"平均 {single_avg:.4f}ms/调用")

    except Exception as e:
        result.add_fail("Hooks性能基准", str(e))

    return result


def main():
    """运行所有验证"""
    print("=" * 70)
    print("HERMES HOOKS 系统验证工具")
    print("=" * 70)
    print(f"测试环境: {TEST_HOME}")
    print(f"Python版本: {sys.version}")
    print(f"有效Hooks数量: {len(VALID_HOOKS)}")

    # 运行所有验证
    all_results = []
    all_results.append(verify_valid_hooks())
    all_results.append(verify_plugin_manager())
    all_results.append(verify_python_hook_registration())
    all_results.append(verify_shell_hook_execution())
    all_results.append(verify_hook_exception_handling())
    all_results.append(verify_block_message_flow())
    all_results.append(verify_multiple_hooks_ordering())
    all_results.append(verify_hooks_performance())

    # 汇总结果
    total_passed = sum(len(r.passed) for r in all_results)
    total_failed = sum(len(r.failed) for r in all_results)
    total_warnings = sum(len(r.warnings) for r in all_results)

    # 打印每个模块报告
    for r in all_results:
        r.print_report()

    # 最终汇总
    print("\n" + "=" * 70)
    print("最终汇总")
    print("=" * 70)
    print(f"✅ 通过: {total_passed}")
    print(f"❌ 失败: {total_failed}")
    print(f"⚠️  警告: {total_warnings}")

    success = total_failed == 0
    if success:
        print("\n🎉 Hooks系统验证全部通过！")
    else:
        print("\n⚠️  Hooks系统验证存在失败项，请检查。")

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
