"""Launcher stestr worker observer.

stestr starts its test workers through ``$PYTHON``. For a proof attempt the
launcher sets it to ``<prepared python> -B <this file> <configuration file>``,
so every worker command becomes::

    <python> -B stestr_observer.py <config> -m stestr.subunit_runner.run discover ...

The discovery (``--list``) worker runs unchanged. The test worker records the
selected module's collected tests, the selected test's lifecycle, its test
method window and its unittest outcome, and appends framed
``launcher-test-proof-native-events.v1`` records to the attempt channel. When
the attempt declares a module, an import hook compiles that module from its
authenticated source with an entry probe at the start of every function body
and, for a falsifier, the declared scalar return replaced. The probe
credentials and the substitution come only from the launcher directive line
appended to the working-copy module, never from the observer configuration.
"""

import ast
import atexit
import builtins
import hashlib
import importlib.abc
import importlib.machinery
import importlib.util
import json
import os
import runpy
import secrets
import sys
import threading
import traceback
import unittest

CONFIG_SCHEMA = "launcher-test-proof-observer-config.v1"
REACH_NAME = "__launcher_test_proof_reach__"
DIRECTIVE_MARKER = b"#__launcher_test_proof__ "
MAX_TEXT = 64 * 1024


class Channel:
    def __init__(self, config, role):
        self.path = config["channel"]
        self.nonce = config["nonce"]
        self.source = "%s.%d.%s" % (role, os.getpid(), secrets.token_hex(4))
        self.sequence = 0
        self.lock = threading.Lock()

    def emit(self, kind, **fields):
        with self.lock:
            record = {"v": 1, "nonce": self.nonce, "src": self.source, "seq": self.sequence,
                      "kind": kind}
            record.update(fields)
            line = (json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii")
            descriptor = os.open(self.path, os.O_WRONLY | os.O_APPEND)
            try:
                view = memoryview(line)
                while view:
                    written = os.write(descriptor, view)
                    view = view[written:]
            finally:
                os.close(descriptor)
            self.sequence += 1


def _text(value):
    try:
        return str(value)[:MAX_TEXT]
    except Exception:  # noqa: BLE001 - diagnostics must not raise
        return None


def _error_facts(err, assertion):
    if not err:
        return None
    kind, value, trace = err
    facts = {"name": getattr(kind, "__name__", "Error"), "assertion": bool(assertion)}
    message = _text(value)
    if message is not None:
        facts["message"] = message
    try:
        facts["stack"] = "".join(traceback.format_exception(kind, value, trace))[:MAX_TEXT]
    except Exception:  # noqa: BLE001
        pass
    return facts


class ModuleInstrumentation(ast.NodeTransformer):
    """Entry probes in every function body, and the declared scalar substitution."""

    def __init__(self, probes, mutation):
        self.probes = probes
        self.mutation = mutation
        self.substituted = False
        self.unprobed = []

    def _probe(self, node):
        token = self.probes.get("%d:%s" % (node.lineno, node.name))
        if not isinstance(token, str):
            self.unprobed.append(node.name)
            return
        first = node.body[0]
        call = ast.Expr(ast.Call(
            func=ast.Name(id=REACH_NAME, ctx=ast.Load()),
            args=[ast.Constant(token)],
            keywords=[]))
        ast.copy_location(call, first)
        ast.copy_location(call.value, first)
        index = 1 if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                      and isinstance(first.value.value, str) and len(node.body) > 1) else 0
        node.body.insert(index, call)

    def _function(self, node, top_level):
        self.generic_visit(node)
        mutation = self.mutation
        if (top_level and mutation is not None and isinstance(node, ast.FunctionDef)
                and node.name == mutation["function_name"] and node.lineno == mutation["line"]):
            body = [statement for statement in node.body
                    if not (isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant)
                            and isinstance(statement.value.value, str))]
            if len(body) == 1 and isinstance(body[0], ast.Return) and isinstance(body[0].value, ast.Constant):
                body[0].value = ast.copy_location(ast.Constant(mutation["replacement"]), body[0].value)
                self.substituted = True
        self._probe(node)
        return node

    def visit_Module(self, node):
        for index, statement in enumerate(node.body):
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                node.body[index] = self._function(statement, True)
            else:
                node.body[index] = self.visit(statement)
        return node

    def visit_FunctionDef(self, node):
        return self._function(node, False)

    def visit_AsyncFunctionDef(self, node):
        return self._function(node, False)


def split_directive(data):
    """The authenticated module bytes and the launcher directive appended to them."""
    body = data[:-1] if data.endswith(b"\n") else data
    start = body.rfind(b"\n") + 1
    if not body[start:].startswith(DIRECTIVE_MARKER):
        return None, None
    directive = json.loads(body[start + len(DIRECTIVE_MARKER):].decode("utf-8"))
    original = data[:directive["original_bytes"]]
    if len(original) != directive["original_bytes"] or start < len(original):
        return None, None
    return original, directive


def install_module_hook(config, channel):
    target = config.get("instrumentation")
    if not target:
        return
    absolute = os.path.realpath(target["file"])
    expected = target["source_digest"]

    def refuse(fullname, message):
        channel.emit("runtime_error", code="test_proof_native_selection_unsupported", message=message)
        raise ImportError("launcher declared module: " + message, name=fullname)

    class InstrumentedLoader(importlib.machinery.SourceFileLoader):
        def get_code(self, fullname):
            try:
                source, directive = split_directive(self.get_data(self.path))
            except (ValueError, KeyError, TypeError):
                source, directive = None, None
            if source is None:
                refuse(fullname, "the declared module lacks its launcher instrumentation")
            if "sha256:" + hashlib.sha256(source).hexdigest() != expected:
                refuse(fullname, "the declared module source moved before it was imported")
            tree = ast.parse(source, self.path)
            transformer = ModuleInstrumentation(directive.get("probes") or {}, directive.get("mutation"))
            tree = ast.fix_missing_locations(transformer.visit(tree))
            if transformer.unprobed:
                refuse(fullname, "a declared module function has no launcher probe")
            if directive.get("mutation") is not None and not transformer.substituted:
                refuse(fullname, "the declared scalar return was not found")
            return compile(tree, self.path, "exec", dont_inherit=True)

    class InstrumentedFinder(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path, target_=None):
            spec = importlib.machinery.PathFinder.find_spec(fullname, path)
            if spec is None or not spec.has_location or spec.origin is None:
                return None
            if os.path.realpath(spec.origin) != absolute:
                return None
            return importlib.util.spec_from_file_location(
                fullname, spec.origin, loader=InstrumentedLoader(fullname, spec.origin),
                submodule_search_locations=spec.submodule_search_locations)

    sys.meta_path.insert(0, InstrumentedFinder())


class RecordingResult:
    """Forward every call to the runner's result while recording the outcome."""

    def __init__(self, inner, failure_exception):
        self._inner = inner
        self._failure_exception = failure_exception
        self.outcome = None
        self.assertion = False
        self.error = None

    def _failed(self, err, assertion):
        self.outcome = "failed"
        self.assertion = self.assertion or assertion
        if self.error is None:
            self.error = _error_facts(err, assertion)

    def addSuccess(self, test, *args, **kwargs):
        if self.outcome is None:
            self.outcome = "passed"
        return self._inner.addSuccess(test, *args, **kwargs)

    def addExpectedFailure(self, test, *args, **kwargs):
        if self.outcome is None:
            self.outcome = "passed"
        return self._inner.addExpectedFailure(test, *args, **kwargs)

    def addSkip(self, test, *args, **kwargs):
        if self.outcome is None:
            self.outcome = "skipped"
        return self._inner.addSkip(test, *args, **kwargs)

    def addFailure(self, test, err, *args, **kwargs):
        self._failed(err, True)
        return self._inner.addFailure(test, err, *args, **kwargs)

    def addError(self, test, err, *args, **kwargs):
        self._failed(err, False)
        self.assertion = False
        return self._inner.addError(test, err, *args, **kwargs)

    def addUnexpectedSuccess(self, test, *args, **kwargs):
        self._failed(None, False)
        return self._inner.addUnexpectedSuccess(test, *args, **kwargs)

    def addSubTest(self, test, subtest, err, *args, **kwargs):
        if err is not None:
            self._failed(err, issubclass(err[0], self._failure_exception))
        return self._inner.addSubTest(test, subtest, err, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def install_observer(config, channel):
    selected = config["selected"]
    selected_id = selected["test_id"]
    selected_file = selected["file"]
    selected_test = selected["test"]
    selected_path = os.path.realpath(config["test_file"])
    collected = set()
    original_init = unittest.TestCase.__init__
    original_run = unittest.TestCase.run
    original_call = unittest.TestCase._callTestMethod

    def in_selected_file(test):
        module = sys.modules.get(type(test).__module__)
        origin = getattr(module, "__file__", None)
        return isinstance(origin, str) and os.path.realpath(origin) == selected_path

    def identity(test):
        return [type(test).__qualname__, getattr(test, "_testMethodName", "")]

    def observed_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        try:
            if in_selected_file(self):
                key = self.id()
                if key not in collected:
                    collected.add(key)
                    channel.emit("collected", file=selected_file, test=identity(self))
        except Exception:  # noqa: BLE001 - collection facts must not break loading
            pass

    def observed_run(self, result=None):
        if self.id() != selected_id:
            if in_selected_file(self):
                channel.emit("test_start", file=selected_file, test=identity(self))
            return original_run(self, result)
        channel.emit("test_start", file=selected_file, test=selected_test)
        recording = RecordingResult(result, self.failureException)
        try:
            return original_run(self, recording)
        finally:
            outcome = recording.outcome or "failed"
            channel.emit("test_result", file=selected_file, test=selected_test, outcome=outcome,
                         assertion_failure=outcome == "failed" and recording.assertion,
                         error=recording.error if outcome == "failed" else None)

    def observed_call(self, method):
        if self.id() != selected_id:
            return original_call(self, method)
        channel.emit("window_start", file=selected_file, test=selected_test)
        try:
            return original_call(self, method)
        finally:
            channel.emit("window_end", file=selected_file, test=selected_test)

    unittest.TestCase.__init__ = observed_init
    unittest.TestCase.run = observed_run
    unittest.TestCase._callTestMethod = observed_call


def main(argv):
    if len(argv) < 4 or argv[2] != "-m":
        return 64
    with open(argv[1], "r", encoding="utf-8") as handle:
        config = json.load(handle)
    if config.get("schema_version") != CONFIG_SCHEMA:
        return 64
    module = argv[3]
    arguments = argv[4:]
    sys.argv = [module] + arguments
    sys.path[0] = os.getcwd()
    if "--list" not in arguments:
        channel = Channel(config, "stestr.worker")
        channel.emit("session_start", runner={"name": "stestr", "version": None})
        builtins.__dict__[REACH_NAME] = lambda token: channel.emit("reach", token=str(token)[:64])
        install_module_hook(config, channel)
        install_observer(config, channel)
        atexit.register(lambda: channel.emit("session_end"))
    runpy.run_module(module, run_name="__main__", alter_sys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
