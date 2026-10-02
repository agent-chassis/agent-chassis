"""Launcher-installed pytest proof process entry.

The launcher's confined proof runner is the only intended caller:

    <interpreter> -I -B <this installed file> <base64url configuration>

The configuration is launcher-minted closed data. This entry never consults
caller environment, consumer-relative launcher assets, or a node identity
parsed as shell text. It runs exactly one literal pytest node identity, keeps
every other collected item deselected, and reports collection plus every
selected-item phase observation as one digest-bound envelope on launcher-owned
file descriptor 3. Standard output and error remain diagnostics only.

Two optional installed mechanisms are available:

* ``falsifier`` mode applies one isolated scalar-return substitution to a
  synchronous, undecorated top-level function whose executable body is one
  scalar literal return (optionally after a docstring). Every other function
  shape is reported as an unsupported capability before any test executes.
* ``falsifier`` and ``traversal`` modes trace function code objects of the
  declared module source only while the selected item's call phase runs, so
  module and class bodies (a lazy import), collection, setup and teardown never
  count as traversal.

A failure's diagnosis is the launcher diagnostic graph of the phase's original
exception (and of a collector's original exception), encoded by the shared
``workspace_agent_test_proof_diagnostic_graph.py`` owner installed beside this
file and loaded from that exact path without changing ``sys.path``.

Every mode ignores cached bytecode through a private empty ``pycache_prefix``,
loads no sourceless bytecode, and reports the top-level modules it imported
after startup from outside the consumer root, the installed runtime packages
and the standard library as its application dependency population.

Tracing uses ``sys.settrace`` on the executing thread; code run by other
threads, subprocesses or native extensions is outside this mechanism.
"""

import ast
import base64
import hashlib
import importlib.abc
import importlib.machinery
import importlib.util
import inspect
import json
import os
import platform
import shutil
import sys
import sysconfig
import tempfile


def _load_diagnostic_graph():
    """The shared diagnostic graph owner, loaded from its installed sibling path."""
    path = os.path.join(os.path.dirname(os.path.realpath(__file__)),
                        "workspace_agent_test_proof_diagnostic_graph.py")
    spec = importlib.util.spec_from_file_location("launcher_test_proof_diagnostic_graph", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


diagnostic_graph = _load_diagnostic_graph()

PROTOCOL_SCHEMA = "workspace-agent-test-proof-pytest-events.v1"
CONFIG_SCHEMA = "workspace-agent-test-proof-pytest-configuration.v1"
PROTOCOL_FD = 3
MODES = ("probe", "candidate", "falsifier", "traversal")
FUNCTION_CODE_FLAGS = inspect.CO_OPTIMIZED | inspect.CO_NEWLOCALS
SOURCE_ONLY_LOADERS = (
    (importlib.machinery.ExtensionFileLoader, importlib.machinery.EXTENSION_SUFFIXES),
    (importlib.machinery.SourceFileLoader, importlib.machinery.SOURCE_SUFFIXES),
)


def _sha256_bytes(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _decode_configuration(encoded):
    padded = encoded + "=" * (-len(encoded) % 4)
    configuration = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    if not isinstance(configuration, dict) or configuration.get("schema_version") != CONFIG_SCHEMA:
        raise ValueError("unsupported launcher pytest configuration")
    if configuration.get("mode") not in MODES:
        raise ValueError("unsupported launcher pytest mode")
    return configuration


def _error_codes(exc, when):
    codes = ["pytest.phase." + when]
    seen = set()
    current = exc
    while isinstance(current, BaseException) and id(current) not in seen:
        seen.add(id(current))
        codes.append(type(current).__qualname__)
        code = getattr(current, "code", None)
        if isinstance(code, str):
            codes.append(code)
        nxt = current.__cause__
        if nxt is None and not current.__suppress_context__:
            nxt = current.__context__
        current = nxt
    unique = []
    for code in codes:
        if code not in unique:
            unique.append(code)
    return unique


class ScalarReturnFault:
    """One isolated result_inversion substitution of a scalar literal return."""

    def __init__(self, root, specification):
        self.module_path = specification["module_path"]
        self.function_name = specification["function_name"]
        self.replacement = specification["replacement"]
        self.absolute = os.path.realpath(os.path.join(root, self.module_path))
        self.status = "not_imported"
        self.reason = None
        self.original = None
        self.lineno = None
        self.source_digest = None
        self.mutated_code = None
        self.compilations = 0

    def _eligible_function(self, tree):
        matches = [node for node in tree.body
                   if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and node.name == self.function_name]
        if not matches:
            return None, "function_absent"
        if len(matches) != 1:
            return None, "function_not_unique"
        node = matches[0]
        if isinstance(node, ast.AsyncFunctionDef):
            return None, "async_function_unsupported"
        if node.decorator_list:
            return None, "decorated_function_unsupported"
        body = list(node.body)
        if len(body) > 1 and isinstance(body[0], ast.Expr) and \
                isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            body = body[1:]
        if len(body) != 1 or not isinstance(body[0], ast.Return) or \
                not isinstance(body[0].value, ast.Constant):
            return None, "body_not_single_scalar_return"
        original = body[0].value.value
        if original is not None and type(original) not in (bool, int, float, str):
            return None, "return_not_scalar"
        if type(original) is type(self.replacement) and original == self.replacement:
            return None, "replacement_not_distinct"
        return (node, body[0]), None

    def prevalidate(self):
        try:
            with open(self.absolute, "rb") as handle:
                source = handle.read()
        except OSError:
            self.status, self.reason = "unsupported", "module_source_absent"
            return False
        self.source_digest = _sha256_bytes(source)
        if self.replacement is not None and type(self.replacement) not in (bool, int, float, str):
            self.status, self.reason = "unsupported", "replacement_not_scalar"
            return False
        try:
            tree = ast.parse(source, self.absolute)
        except SyntaxError:
            self.status, self.reason = "unsupported", "module_source_unparsable"
            return False
        selected, reason = self._eligible_function(tree)
        if selected is None:
            self.status, self.reason = "unsupported", reason
            return False
        self.original = selected[1].value.value
        self.lineno = selected[0].lineno
        return True

    def compile_mutated(self, source, filename):
        tree = ast.parse(source, filename)
        selected, reason = self._eligible_function(tree)
        if selected is None or _sha256_bytes(source) != self.source_digest:
            self.status, self.reason = "unsupported", reason or "module_source_moved"
            return compile(tree, filename, "exec", dont_inherit=True)
        node, statement = selected
        statement.value = ast.copy_location(ast.Constant(self.replacement), statement.value)
        self.compilations += 1
        self.status = "applied"
        return compile(tree, filename, "exec", dont_inherit=True)

    def projection(self, calls):
        mutated = [call for call in calls if call.get("mutated_code")]
        return {
            "status": self.status,
            "reason": self.reason,
            "module_path": self.module_path,
            "function_name": self.function_name,
            "replacement": self.replacement,
            "replacement_type": diagnostic_graph.type_name(self.replacement),
            "original": self.original,
            "original_type": diagnostic_graph.type_name(self.original) if self.lineno is not None else None,
            "source_digest": self.source_digest,
            "compilations": self.compilations,
            "mutated_code": None if self.mutated_code is None else {
                "filename": self.module_path, "name": self.mutated_code.co_name,
                "firstlineno": self.mutated_code.co_firstlineno},
            "mutated_entries_in_call": sum(call["entries"] for call in mutated),
            "mutated_returns_in_call": sum(call["mutated_returns"] for call in mutated),
        }


def _install_fault(fault):
    class FaultLoader(importlib.machinery.SourceFileLoader):
        def get_code(self, fullname):
            # Always compile the authenticated source; never reuse cached bytecode.
            return fault.compile_mutated(self.get_data(self.path), self.path)

        def exec_module(self, module):
            super().exec_module(module)
            function = module.__dict__.get(fault.function_name)
            code = getattr(function, "__code__", None)
            if code is not None and os.path.realpath(code.co_filename) == fault.absolute and \
                    code.co_name == fault.function_name and fault.status == "applied":
                fault.mutated_code = code

    class FaultFinder(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path, target=None):
            spec = importlib.machinery.PathFinder.find_spec(fullname, path)
            if spec is None or not spec.has_location or spec.origin is None:
                return None
            if os.path.realpath(spec.origin) != fault.absolute:
                return None
            return importlib.util.spec_from_file_location(
                fullname, spec.origin, loader=FaultLoader(fullname, spec.origin),
                submodule_search_locations=spec.submodule_search_locations)

    sys.meta_path.insert(0, FaultFinder())


class SelectedCallTracer:
    """Record declared-module function code objects entered during the selected call."""

    def __init__(self, root, module_path, node_id, fault):
        self.module_path = module_path
        self.absolute = os.path.realpath(os.path.join(root, module_path))
        self.node_id = node_id
        self.fault = fault
        self.records = {}
        self._filenames = {}
        try:
            with open(self.absolute, "rb") as handle:
                self.source_digest = _sha256_bytes(handle.read())
        except OSError:
            self.source_digest = None

    def _matches(self, code):
        filename = code.co_filename
        cached = self._filenames.get(filename)
        if cached is None:
            cached = os.path.realpath(filename) == self.absolute
            self._filenames[filename] = cached
        return cached

    def trace(self, frame, event, arg):
        code = frame.f_code
        # Module and class bodies (for example a lazy import) are not function calls.
        is_function = (code.co_flags & FUNCTION_CODE_FLAGS) == FUNCTION_CODE_FLAGS
        if event != "call" or not is_function or not self._matches(code):
            return None
        key = (code.co_name, code.co_firstlineno)
        record = self.records.get(key)
        if record is None:
            record = {"phase": "call", "code": {"filename": self.module_path, "name": code.co_name,
                                                "firstlineno": code.co_firstlineno, "kind": "function"},
                      "source_digest": self.source_digest, "entries": 0, "returns": 0,
                      "mutated_returns": 0,
                      "mutated_code": self.fault is not None and code is self.fault.mutated_code}
            self.records[key] = record
        record["entries"] += 1
        state = {"raised": False}
        replacement = None if self.fault is None else self.fault.replacement
        mutated = record["mutated_code"]

        def local(inner_frame, inner_event, inner_arg):
            if inner_event == "exception":
                state["raised"] = True
            elif inner_event == "line":
                state["raised"] = False
            elif inner_event == "return" and not state["raised"]:
                record["returns"] += 1
                if mutated and type(inner_arg) is type(replacement) and inner_arg == replacement:
                    record["mutated_returns"] += 1
            return local

        return local

    def calls(self):
        return [dict(record, test_node_id=self.node_id) for record in self.records.values()]


def _plugin(pytest, configuration, fault, tracer):
    node_id = configuration["node_id"]
    root = configuration["root"]

    class LauncherProofPlugin:
        def __init__(self):
            self.collected = []
            self.selected = []
            self.collect_errors = []
            self.collect_causes = {}
            self.phases = []
            self.pending = {}

        @pytest.hookimpl(trylast=True)
        def pytest_collection_modifyitems(self, session, config, items):
            self.collected.extend(item.nodeid for item in items)
            selected = [item for item in items if item.nodeid == node_id]
            deselected = [item for item in items if item.nodeid != node_id]
            if deselected:
                config.hook.pytest_deselected(items=deselected)
            items[:] = selected
            self.selected = [item.nodeid for item in selected]

        def pytest_exception_interact(self, node, call, report):
            # A collector that failed: its original exception, before pytest
            # renders it into report text.
            if call.when == "collect" and call.excinfo is not None:
                self.collect_causes[report.nodeid] = diagnostic_graph.failure_diagnostic(
                    call.excinfo.value, root, "phase", "collect")

        def pytest_collectreport(self, report):
            if report.failed:
                self.collect_errors.append({"nodeid": report.nodeid, "report": report})

        @pytest.hookimpl(wrapper=True)
        def pytest_runtest_call(self, item):
            if tracer is None or item.nodeid != node_id:
                return (yield)
            previous = sys.gettrace()
            sys.settrace(tracer.trace)
            try:
                return (yield)
            finally:
                sys.settrace(previous)

        @pytest.hookimpl(wrapper=True)
        def pytest_runtest_makereport(self, item, call):
            report = yield
            if call.excinfo is not None:
                exc = call.excinfo.value
                self.pending[(item.nodeid, call.when)] = {
                    "assertion_failure": isinstance(exc, AssertionError),
                    "failure_diagnostic": diagnostic_graph.failure_diagnostic(exc, root, "phase", call.when),
                    "error_codes": _error_codes(exc, call.when),
                }
            return report

        def pytest_runtest_logreport(self, report):
            observation = {"nodeid": report.nodeid, "when": report.when, "outcome": report.outcome}
            detail = self.pending.pop((report.nodeid, report.when), None)
            if report.failed:
                observation["assertion_failure"] = bool(detail and detail["assertion_failure"])
                observation["error_codes"] = detail["error_codes"] if detail else ["pytest.phase." + report.when]
                observation["failure_diagnostic"] = detail["failure_diagnostic"] if detail else \
                    diagnostic_graph.unavailable(origin={"kind": "phase", "name": report.when})
            self.phases.append(observation)

        def collection_errors(self):
            # Every failed collector, with its captured original exception or an
            # explicit statement that pytest supplied none.
            return [{"nodeid": entry["nodeid"],
                     "failure_diagnostic": self.collect_causes.get(entry["nodeid"]) or
                     diagnostic_graph.unavailable(origin={"kind": "phase", "name": "collect"})}
                    for entry in self.collect_errors]

    return LauncherProofPlugin()


def _install_import_policy():
    """Ignore cached bytecode and refuse sourceless bytecode for every later import."""
    private = tempfile.mkdtemp(prefix="launcher-pycache-")
    sys.pycache_prefix = os.path.join(private, "absent")
    sys.dont_write_bytecode = True
    hook = importlib.machinery.FileFinder.path_hook(*SOURCE_ONLY_LOADERS)
    hook.launcher_source_only = True
    sys.path_hooks[:] = [entry for entry in sys.path_hooks
                         if getattr(entry, "__name__", "") != hook.__name__] + [hook]
    sys.path_importer_cache.clear()
    return private


def _import_policy(private):
    absent = os.path.join(private, "absent")
    file_hooks = [entry for entry in sys.path_hooks
                  if getattr(entry, "__name__", "") == "path_hook_for_FileFinder"]
    return {
        "cached_bytecode": "ignored" if sys.pycache_prefix == absent and not os.path.exists(absent)
        else "consulted",
        "sourceless_bytecode": "refused" if file_hooks and all(
            getattr(entry, "launcher_source_only", False) for entry in file_hooks) else "loadable",
    }


def _within(candidate, roots):
    return any(candidate == root or candidate.startswith(root.rstrip(os.sep) + os.sep) for root in roots)


def _dependency_population(root, runtime_packages, startup_modules, dependency_roots=()):
    """Top-level modules imported after startup from outside every bound input.

    A readiness-prepared project environment is a bound, authenticated input.
    """
    bound = [os.path.realpath(root)]
    bound.extend(os.path.realpath(entry) for entry in runtime_packages)
    bound.extend(os.path.realpath(entry) for entry in dependency_roots)
    bound.extend({os.path.realpath(sysconfig.get_path(name)) for name in ("stdlib", "platstdlib")})
    own = os.path.realpath(__file__)
    members = set()
    for name, module in list(sys.modules.items()):
        origin = getattr(module, "__file__", None)
        if name in startup_modules or not isinstance(origin, str):
            continue
        real = os.path.realpath(origin)
        if real != own and not _within(real, bound):
            members.add(name.partition(".")[0])
    return {"count": len(members), "members": sorted(members)}


def _emit(payload):
    text = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False)
    data = text.encode("ascii")
    envelope = json.dumps({"schema_version": PROTOCOL_SCHEMA, "payload": text,
                           "payload_sha256": hashlib.sha256(data).hexdigest()},
                          ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
    view = memoryview(envelope)
    while view:
        written = os.write(PROTOCOL_FD, view)
        view = view[written:]
    os.close(PROTOCOL_FD)


def main(argv):
    if len(argv) != 2:
        return 64
    configuration = _decode_configuration(argv[1])
    root = configuration["root"]
    mode = configuration["mode"]
    startup_modules = set(sys.modules)
    os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    private_cache = _install_import_policy()
    sys.path.insert(0, root)
    for runtime_path in reversed(configuration.get("runtime_paths", [])):
        sys.path.insert(0, runtime_path)
    payload = {
        "schema_version": PROTOCOL_SCHEMA,
        "attempt_nonce": configuration["attempt_nonce"],
        "mode": mode,
        "node_id": configuration.get("node_id"),
        "target_path": configuration.get("target_path"),
        "python": {"implementation": sys.implementation.name, "version": platform.python_version()},
        "pytest_version": None,
        "runtime_error": None,
        "collection": {"collected_node_ids": [], "selected_node_ids": [], "errors": []},
        "phases": [],
        "fault": None,
        "trace": None,
        "import_policy": None,
        "dependency_population": None,
        "session": {"exit_status": None},
    }

    def settle():
        payload["import_policy"] = _import_policy(private_cache)
        payload["dependency_population"] = _dependency_population(
            root, configuration.get("runtime_packages", []), startup_modules,
            configuration.get("dependency_roots", []))
        shutil.rmtree(private_cache, ignore_errors=True)
        _emit(payload)

    try:
        import pytest  # noqa: PLC0415 - installed runtime path is configured above
    except Exception as error:  # noqa: BLE001
        payload["runtime_error"] = {"code": "pytest_unavailable", "message": diagnostic_graph.safe_text(error),
                                    "failure_diagnostic": diagnostic_graph.failure_diagnostic(error, root)}
        settle()
        return 3
    payload["pytest_version"] = pytest.__version__
    if mode == "probe":
        settle()
        return 0
    fault = None
    if mode == "falsifier":
        fault = ScalarReturnFault(root, configuration["fault"])
        if not fault.prevalidate():
            payload["fault"] = fault.projection([])
            settle()
            return 4
        _install_fault(fault)
    tracer = None
    trace_module = configuration.get("trace_module_path")
    if trace_module is not None:
        tracer = SelectedCallTracer(root, trace_module, configuration["node_id"], fault)
    plugin = _plugin(pytest, configuration, fault, tracer)
    arguments = [configuration["target_path"], "--rootdir", root, "-p", "no:cacheprovider",
                 "-o", "addopts=", "-q"]
    try:
        status = int(pytest.main(arguments, plugins=[plugin]))
    except BaseException as error:  # noqa: BLE001 - reported, never swallowed silently
        payload["runtime_error"] = {"code": "pytest_session_crashed", "message": diagnostic_graph.safe_text(error),
                                    "failure_diagnostic": diagnostic_graph.failure_diagnostic(error, root)}
        status = 3
    calls = tracer.calls() if tracer is not None else []
    payload["collection"] = {"collected_node_ids": plugin.collected,
                             "selected_node_ids": plugin.selected, "errors": plugin.collection_errors()}
    payload["phases"] = plugin.phases
    payload["fault"] = None if fault is None else fault.projection(calls)
    payload["trace"] = None if tracer is None else {"module_path": tracer.module_path,
                                                    "source_digest": tracer.source_digest,
                                                    "calls": calls}
    payload["session"] = {"exit_status": status}
    settle()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv))
