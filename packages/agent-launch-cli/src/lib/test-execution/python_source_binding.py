"""Bind local editable imports before the existing pytest entry starts.

Only this process changes: installation paths for third parties are retained.
Path-based editables and setuptools' generated MAPPING/NAMESPACES are supported.
An unrecognized local editable or preloaded original module refuses explicitly.
"""
import importlib.machinery
import importlib.metadata
import importlib.util
import json
import os
import pkgutil
import runpy
import sys
import sysconfig
from urllib.parse import unquote, urlparse


def within(file, root):
    return file == root or file.startswith(root + os.sep)


def fail(code, **facts):
    # Keep the caller's cause-first ordering in bounded native diagnostics.
    raise ImportError(code + ': ' + json.dumps(facts))


def bind(original, candidate):
    original, candidate = os.path.realpath(original), os.path.realpath(candidate)
    if original == candidate:
        sys.path.insert(0, os.getcwd())
        return

    installations = {os.path.realpath(sysconfig.get_path(name)) for name in ('purelib', 'platlib')}
    if sys.prefix != sys.base_prefix:
        installations.add(os.path.realpath(sys.prefix))

    def local(file):
        real = os.path.realpath(file)
        return within(real, original) and not within(real, candidate) and not any(
            within(real, root) for root in installations)

    def mapped(file, require_exists=True):
        if not local(file):
            return file
        selected = os.path.join(candidate, os.path.relpath(os.path.realpath(file), original))
        if not within(os.path.realpath(selected), candidate):
            fail('python_candidate_source_escapes', original=file, candidate=selected)
        if require_exists and not os.path.exists(selected):
            fail('python_candidate_source_missing', original=file, candidate=selected)
        return selected

    # .pth startup has already run, even under -I. Never let a startup import
    # preserve original application objects in sys.modules.
    for name, module in list(sys.modules.items()):
        origin = getattr(module, '__file__', None)
        if isinstance(origin, str) and local(origin):
            fail('python_editable_mechanism_unsupported', mechanism='startup_application_import',
                 module=name, origin=origin)

    roots = [entry for entry in sys.path if entry and local(entry)]
    locations = {}
    for root in roots:
        for item in pkgutil.iter_modules([root]):
            spec = importlib.machinery.PathFinder.find_spec(item.name, [root])
            if spec is not None and spec.origin is not None:
                locations[item.name] = os.path.join(root, item.name) if item.ispkg else spec.origin
    # Setuptools' finder retains absolute paths in its generated module rather
    # than sys.path. Read and rebind those in memory; never rewrite its asset.
    for name, module in list(sys.modules.items()):
        if not name.startswith('__editable__') or not name.endswith('_finder'):
            continue
        mapping = getattr(module, 'MAPPING', None)
        if not isinstance(mapping, dict) or any(not isinstance(value, str) for value in mapping.values()):
            fail('python_editable_mechanism_unsupported', mechanism=name, detail='invalid MAPPING')
        local_entries = {key: value for key, value in mapping.items() if local(value)}
        if not local_entries:
            continue
        finder = getattr(module, '_EditableFinder', None)
        if finder is None or not hasattr(finder, 'find_spec'):
            fail('python_editable_mechanism_unsupported', mechanism=name, detail='missing _EditableFinder')
        for key, value in local_entries.items():
            spec = finder.find_spec(key)
            if spec is not None and spec.origin is not None:
                # A py_module mapping may be a stem with no suffix. The
                # installed finder owns its actual import location.
                locations[key] = os.path.dirname(spec.origin) if spec.submodule_search_locations is not None else spec.origin
                mapped(locations[key])
            else:
                locations[key] = value
                mapped(value)
            mapping[key] = mapped(value, require_exists=False)
        namespaces = getattr(module, 'NAMESPACES', {})
        if not isinstance(namespaces, dict):
            fail('python_editable_mechanism_unsupported', mechanism=name, detail='invalid NAMESPACES')
        for key, values in namespaces.items():
            namespaces[key] = [mapped(value) for value in values]

    # A local editable whose backend exposes neither source paths nor a known
    # finder cannot be executed against a different checkout safely.
    for distribution in importlib.metadata.distributions():
        text = distribution.read_text('direct_url.json')
        if text is None:
            continue
        record = json.loads(text)
        url = urlparse(record.get('url', ''))
        if url.scheme == 'file' and record.get('dir_info', {}).get('editable') is True:
            source = unquote(url.path)
            if local(source) and not any(within(os.path.realpath(root), os.path.realpath(source))
                                         for root in roots + list(locations.values())):
                fail('python_editable_mechanism_unsupported', distribution=distribution.metadata['Name'],
                     mechanism='editable_without_source_path_or_setuptools_mapping',
                     origin=source, finders=[getattr(finder, '__module__', type(finder).__module__)
                                             for finder in sys.meta_path])

    sys.path[:] = [mapped(entry) if entry else entry for entry in sys.path]
    sys.path.insert(0, os.getcwd())
    sys.path_importer_cache.clear()

    class CandidateFinder:
        def find_spec(self, fullname, path=None, target=None):
            if fullname not in locations:
                return None
            location = mapped(locations[fullname])
            if os.path.isdir(location):
                origin = os.path.join(location, '__init__.py')
                if not os.path.isfile(origin):
                    if os.path.isfile(os.path.join(locations[fullname], '__init__.py')):
                        fail('python_candidate_source_missing', module=fullname, candidate=origin)
                    spec = importlib.machinery.ModuleSpec(fullname, loader=None, is_package=True)
                    spec.submodule_search_locations = [location]
                    return spec
                search = [location]
            else:
                origin, search = location, None
            if not origin.endswith('.py'):
                fail('python_editable_mechanism_unsupported', mechanism='non_python_source',
                     module=fullname, origin=origin)
            return importlib.util.spec_from_file_location(fullname, origin,
                                                         submodule_search_locations=search)

    sys.meta_path.insert(0, CandidateFinder())
    finders = tuple(sys.meta_path)

    class BindingGuard:
        def find_spec(self, fullname, path=None, target=None):
            for finder in finders:
                if not hasattr(finder, 'find_spec'):
                    continue
                spec = finder.find_spec(fullname, path, target)
                if spec is None:
                    continue
                if spec.origin and local(spec.origin):
                    if type(spec.loader) is not importlib.machinery.SourceFileLoader:
                        fail('python_editable_mechanism_unsupported', mechanism='unsupported_local_source_loader',
                             loader=type(spec.loader).__name__,
                             finder=getattr(finder, '__module__', type(finder).__module__),
                             module=fullname, origin=spec.origin)
                    origin = mapped(spec.origin)
                    search = None if spec.submodule_search_locations is None else [
                        mapped(entry) for entry in spec.submodule_search_locations]
                    return importlib.util.spec_from_file_location(fullname, origin,
                                                                 submodule_search_locations=search)
                if spec.submodule_search_locations is not None and any(
                        local(entry) for entry in spec.submodule_search_locations):
                    spec.submodule_search_locations = [mapped(entry) for entry in spec.submodule_search_locations]
                return spec
            return None

    sys.meta_path.insert(0, BindingGuard())


def main():
    original, candidate = sys.argv[1:3]
    args = sys.argv[3:]
    bind(original, candidate)
    if args[0] == '-m':
        sys.argv = [args[1], *args[2:]]
        runpy.run_module(args[1], run_name='__main__', alter_sys=True)
    else:
        sys.argv = args
        runpy.run_path(args[0], run_name='__main__')


if __name__ == '__main__':
    main()
