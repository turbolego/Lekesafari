#!/usr/bin/env python3
"""Unit tests for tools/fetch_playgrounds.py (stdlib only, no network).

Verifies the municipality fix: the per-bbox city must reach each record
instead of a hardcoded "os". Also pins the boolean semantics of parking/dogs,
which the frontend coerces with `=== true`.

Run:  python3 tools/test_fetch_playgrounds.py
"""
import importlib.util
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))


def _stub_requests():
    """The baker imports `requests` at module scope for live Overpass calls.

    These tests never touch the network, and `requests` is a third-party
    dependency the test environment may not have. Register a throwaway stub so
    the module imports stay stdlib-only. If the real module is present it is
    left untouched.
    """
    if "requests" in sys.modules:
        return
    try:
        import requests  # noqa: F401  (real one available — use it)
        return
    except Exception:
        pass
    stub = types.ModuleType("requests")

    def _unavailable(*a, **k):
        raise RuntimeError("network disabled in tests")

    # ModuleType's type stub declares no `get`/`post`, so assign via setattr.
    setattr(stub, "get", _unavailable)
    setattr(stub, "post", _unavailable)
    setattr(stub, "exceptions", types.SimpleNamespace(RequestException=Exception))
    sys.modules["requests"] = stub


def load_baker():
    path = os.path.join(HERE, "fetch_playgrounds.py")
    spec = importlib.util.spec_from_file_location("fetch_playgrounds", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load module spec from {path}")
    mod = importlib.util.module_from_spec(spec)
    # The module only reads network/config constants at import time, so this
    # is safe and avoids executing main().
    _stub_requests()
    spec.loader.exec_module(mod)
    return mod


baker = load_baker()
NOW = "2026-10-11"

FAILURES = []


def check(label, cond, detail=""):
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label} {detail}")
        FAILURES.append(label)


def test_municipality_comes_from_the_tile_city():
    """The regression: every record used to be labelled "os"."""
    el = {"type": "node", "id": 1, "lat": 60.39, "lon": 5.32,
          "tags": {"name": "Testplass", "leisure": "playground"}}
    rec = baker.normalize(el, "bergen", NOW)
    check("municipality uses the tile city, not 'os'",
          rec["municipality"] == "bergen", f"got {rec['municipality']!r}")


def test_explicit_addr_city_wins_over_tile():
    """addr:city is more precise than the coarse bbox label."""
    el = {"type": "node", "id": 2, "lat": 60.39, "lon": 5.32,
          "tags": {"name": "Testplass", "addr:city": "Oslo"}}
    rec = baker.normalize(el, "bergen", NOW)
    check("addr:city takes precedence over the tile city",
          rec["municipality"] == "Oslo", f"got {rec['municipality']!r}")


def test_missing_coords_is_skipped_not_crashed():
    el = {"type": "node", "id": 3, "tags": {"name": "Ingen koordinater"}}
    check("element without coords returns None", baker.normalize(el, "oslo", NOW) is None)


def test_way_with_center_point():
    """Ways have no lat/lon of their own; their center is used."""
    el = {"type": "way", "id": 4, "center": {"lat": 59.91, "lon": 10.75},
          "tags": {"name": "Veilekeplass"}}
    rec = baker.normalize(el, "oslo", NOW)
    check("way center coords are used", rec is not None and rec["location"]["lat"] == 59.91)
    check("way sourceId keeps its osm type", rec["sourceId"] == "way/4")


def test_parking_free_is_true_only_when_tagged():
    """parking_from_osm must not claim free parking by default."""
    el_yes = {"type": "node", "id": 5, "lat": 1.0, "lon": 1.0,
              "tags": {"name": "A", "parking": "yes"}}
    el_no = {"type": "node", "id": 6, "lat": 1.0, "lon": 1.0,
             "tags": {"name": "B"}}
    rec_yes = baker.normalize(el_yes, "oslo", NOW)
    rec_no = baker.normalize(el_no, "oslo", NOW)
    if rec_yes is None or rec_no is None:
        check("parking records normalized", False, "normalize returned None")
        return
    check("parking=yes yields free=True", rec_yes["parking"]["free"] is True)
    check("no parking tag does NOT default to free",
          rec_no["parking"]["free"] is not True)


def test_dogs_unknown_is_not_yes():
    """'unknown' must not be truthy — the frontend filter relies on this."""
    el = {"type": "node", "id": 7, "lat": 1.0, "lon": 1.0, "tags": {"name": "C"}}
    d = baker.normalize(el, "oslo", NOW)["dogs"]
    check("dogs.allowed is 'unknown' by default", d["allowed"] == "unknown",
          f"got {d['allowed']!r}")
    check("dogs.allowed is not the boolean True", d["allowed"] is not True)


def test_equipment_parsed_from_playground_tags():
    el = {"type": "node", "id": 8, "lat": 1.0, "lon": 1.0,
          "tags": {"name": "D", "playground:swing": "yes", "playground:slide": "yes"}}
    rec = baker.normalize(el, "oslo", NOW)
    names = {e["name"] for e in rec["equipment"]}
    check("equipment labels are Norwegian", names == {"Gynge", "Rutschbane"},
          f"got {names!r}")


def test_source_id_and_internal_id_differ():
    """The OSM deep link needs node/123; the internal id cannot serve."""
    el = {"type": "node", "id": 12345, "lat": 1.0, "lon": 1.0, "tags": {"name": "E"}}
    rec = baker.normalize(el, "oslo", NOW)
    check("sourceId is the OSM path form", rec["sourceId"] == "node/12345")
    check("internal id is namespaced differently", rec["id"] == "osm-node-12345")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"\n{name}")
            fn()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} test(s) FAILED")
        sys.exit(1)
    print("All baker tests passed")
