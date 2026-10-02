"""The one Python owner of the launcher-test-failure-diagnostic.v1 graph.

Both launcher Python observers (the installed pytest entry and the stestr
worker observer) load this exact file by its installed path, explicitly and
without adding any directory to ``sys.path``. It encodes one exception chain
as the launcher graph: each exception's name, message, code, traceback text,
the native source location of its deepest traceback frame, its arguments, its
cause or context and an exception group's members. The origin of a failure (a
pytest phase, a unittest subtest, a runner condition) travels beside the root
error. Capture limits and every loss are explicit issues; nothing is guessed.
"""

import json
import math
import os
import traceback

DIAGNOSTIC_SCHEMA = "launcher-test-failure-diagnostic.v1"
MAX_DIAGNOSTIC_VALUES = 4096
MAX_DIAGNOSTIC_DEPTH = 32
MAX_TEXT = 1024 * 1024
# The serialized ceiling of one graph (the JavaScript leaf's own bound).
MAX_DIAGNOSTIC_BYTES = 256 * 1024
SAFE_INTEGER = 2 ** 53 - 1
ORIGIN_KINDS = ("condition", "hook", "phase", "step", "subtest")


def type_name(value):
    if value is None:
        return "NoneType"
    return type(value).__name__


def safe_text(value):
    try:
        text = str(value)
    except Exception:  # noqa: BLE001 - diagnostics must not raise
        return None
    return text[:MAX_TEXT]


def _origin(kind, name=None):
    if kind not in ORIGIN_KINDS:
        raise ValueError("unsupported diagnostic origin")
    origin = {"kind": kind}
    if isinstance(name, str) and name:
        origin["name"] = name
    return origin


def _serialized_bytes(value):
    return len(json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii"))


class DiagnosticGraph:
    """Encode one exception chain as a launcher-test-failure-diagnostic.v1 graph.

    ``root`` is the directory a native source location is reported relative to
    when the file lies inside it.
    """

    def __init__(self, root=None):
        self.errors = []
        self.values = []
        self.issues = []
        self._error_ids = {}
        self._root = os.path.realpath(root) if root else None

    def value(self, item, path, depth=0):
        value_id = "value-%d" % len(self.values)
        if len(self.values) >= MAX_DIAGNOSTIC_VALUES or depth > MAX_DIAGNOSTIC_DEPTH:
            self.issues.append({"path": path, "reason": "unsupported_value_type"})
            self.values.append({"id": value_id, "type": "unavailable", "reason": "unsupported_value_type",
                                "source_type": type_name(item)})
            return value_id
        entry = {"id": value_id}
        self.values.append(entry)
        if item is None:
            entry["type"] = "null"
        elif isinstance(item, bool):
            entry.update(type="boolean", value=item)
        elif isinstance(item, int):
            if abs(item) <= SAFE_INTEGER:
                entry.update(type="number", value=item)
            else:
                entry.update(type="bigint", value=str(item))
        elif isinstance(item, float):
            if math.isfinite(item):
                entry.update(type="number", value=item)
            else:
                entry.update(type="nonfinite_number",
                             value="NaN" if math.isnan(item) else ("Infinity" if item > 0 else "-Infinity"))
        elif isinstance(item, str):
            entry.update(type="string", value=item)
        elif isinstance(item, (list, tuple)):
            entry.update(type="array", length=len(item), elements=[], properties=[])
            for index, element in enumerate(item):
                entry["elements"].append({"index": index,
                                          "value": self.value(element, "%s[%d]" % (path, index), depth + 1)})
        elif isinstance(item, dict):
            entry.update(type="object", properties=[])
            for key, element in item.items():
                if not isinstance(key, str):
                    self.issues.append({"path": path, "reason": "unsupported_symbol_key"})
                    continue
                entry["properties"].append({"key": key,
                                            "value": self.value(element, "%s.%s" % (path, key), depth + 1)})
        else:
            text = safe_text(item)
            if text is None:
                self.issues.append({"path": path, "reason": "source_value_unreadable"})
                entry.update(type="unavailable", reason="source_value_unreadable", source_type=type_name(item))
            else:
                entry.update(type="unavailable", reason="unsupported_value_type", source_type=type_name(item))
        return value_id

    def _relative(self, filename):
        if self._root is None:
            return filename
        real = os.path.realpath(filename)
        if real.startswith(self._root.rstrip(os.sep) + os.sep):
            return os.path.relpath(real, self._root).replace(os.sep, "/")
        return filename

    @staticmethod
    def _hidden(frame):
        """A frame its runner hides from its own failure report (unittest, pytest)."""
        try:
            return bool(frame.f_globals.get("__unittest")) or \
                bool(frame.f_locals.get("__tracebackhide__")) or bool(frame.f_globals.get("__tracebackhide__"))
        except Exception:  # noqa: BLE001
            return False

    def _location(self, exc):
        """The exception's native source location.

        A syntax error names its own file, line and offset. Any other exception
        is located at its deepest traceback frame that its runner does not hide.
        """
        if isinstance(exc, SyntaxError) and isinstance(exc.filename, str) and exc.filename and \
                isinstance(exc.lineno, int) and exc.lineno >= 1:
            location = {"file": self._relative(exc.filename), "line": exc.lineno}
            if isinstance(exc.offset, int) and exc.offset >= 1:
                location["column"] = exc.offset
            return location
        try:
            frames = []
            tb = exc.__traceback__
            while tb is not None:
                frames.append(tb.tb_frame)
                tb = tb.tb_next
            summaries = traceback.extract_tb(exc.__traceback__)
        except Exception:  # noqa: BLE001
            return None
        if not summaries or len(summaries) != len(frames):
            return None
        visible = [index for index, frame in enumerate(frames) if not self._hidden(frame)]
        summary = summaries[visible[-1] if visible else -1]
        if not isinstance(summary.filename, str) or not summary.filename or \
                not isinstance(summary.lineno, int) or summary.lineno < 1:
            return None
        location = {"file": self._relative(summary.filename), "line": summary.lineno}
        column = getattr(summary, "colno", None)
        if isinstance(column, int) and column >= 0:
            location["column"] = column + 1
        return location

    def error(self, exc, path="root_error"):
        key = id(exc)
        if key in self._error_ids:
            return self._error_ids[key]
        error_id = "error-%d" % len(self.errors)
        self._error_ids[key] = error_id
        entry = {"id": error_id, "name": type(exc).__qualname__}
        self.errors.append(entry)
        message = safe_text(exc)
        if message is None:
            self.issues.append({"path": path + ".message", "reason": "source_value_unreadable"})
        else:
            entry["message"] = message
        try:
            entry["stack"] = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__,
                                                                chain=False))[:MAX_TEXT]
        except Exception:  # noqa: BLE001
            self.issues.append({"path": path + ".stack", "reason": "source_value_unreadable"})
        location = self._location(exc)
        if location is not None:
            entry["location"] = location
        code = getattr(exc, "code", None)
        if isinstance(code, str):
            entry["code"] = code
        if isinstance(exc, AssertionError):
            entry["operator"] = "assert"
        if exc.args:
            entry["value"] = self.value(list(exc.args) if len(exc.args) > 1 else exc.args[0],
                                        path + ".args")
        cause = exc.__cause__
        if cause is None and not exc.__suppress_context__:
            cause = exc.__context__
        if isinstance(cause, BaseException):
            entry["cause"] = self.error(cause, path + ".cause")
        nested = getattr(exc, "exceptions", None)
        if isinstance(exc, BaseExceptionGroup) and isinstance(nested, tuple):  # noqa: F821
            entry["aggregate_errors"] = [self.error(child, "%s.exceptions[%d]" % (path, index))
                                         for index, child in enumerate(nested)]
        return error_id

    def project(self, root_error, origin=None):
        graph = {"schema_version": DIAGNOSTIC_SCHEMA, "status": "captured", "root_error": root_error,
                 "errors": self.errors, "values": self.values, "issues": self.issues}
        if origin is not None:
            graph["origin"] = origin
        return bounded(graph)


def unavailable(issues=None, origin=None):
    """An explicit unavailable diagnosis: no error was supplied, or none could be captured."""
    graph = {"schema_version": DIAGNOSTIC_SCHEMA, "status": "unavailable", "root_error": None,
             "errors": [], "values": [],
             "issues": list(issues) if issues else [{"path": "/error", "reason": "error_not_supplied"}]}
    if origin is not None:
        graph["origin"] = origin
    return graph


def bounded(graph, max_bytes=MAX_DIAGNOSTIC_BYTES):
    """Keep one graph within its ceiling: values first, then the whole capture."""
    if _serialized_bytes(graph) <= max_bytes:
        return graph
    if graph["status"] == "captured" and graph["values"]:
        issues = list(graph["issues"])
        errors = []
        for index, entry in enumerate(graph["errors"]):
            kept = dict(entry)
            for field in ("expected", "actual", "value"):
                if field in kept:
                    del kept[field]
                    issues.append({"path": "/errors/%d/%s" % (index, field), "reason": "capture_budget_exceeded"})
            errors.append(kept)
        reduced = dict(graph, errors=errors, values=[], issues=issues)
        if _serialized_bytes(reduced) <= max_bytes:
            return reduced
    return unavailable([{"path": "/error", "reason": "capture_budget_exceeded"}], graph.get("origin"))


def failure_diagnostic(exc, root=None, origin_kind=None, origin_name=None):
    """The diagnostic graph of one exception, with its native origin when known."""
    origin = None if origin_kind is None else _origin(origin_kind, origin_name)
    if not isinstance(exc, BaseException):
        return unavailable(origin=origin)
    graph = DiagnosticGraph(root)
    try:
        return graph.project(graph.error(exc), origin)
    except Exception:  # noqa: BLE001 - a capture failure is an explicit loss
        return unavailable([{"path": "/error", "reason": "source_value_unreadable"}], origin)


def condition_diagnostic(kind, name, issues=None):
    """A native runner condition that supplies no exception (for example an unexpected success)."""
    return unavailable(issues, _origin(kind, name))
