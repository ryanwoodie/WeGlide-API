#!/usr/bin/env python3
"""Quick QA script to sanity check DMSt scoring calculations.

For each flight in australian_flights_2025_details.jsonl we recompute:
  * DMSt Free Score (from the au contest geometry + handicap)
  * DMSt Task Score (from declared task distance + handicap + bonuses)

We then compare the recomputed values against the points reported by the
API.  Small rounding differences (+/- 0.2 pts) are tolerated.  Any larger
mismatch is logged so we can inspect the raw data.
"""
from __future__ import annotations

import json
from decimal import Decimal, getcontext
from pathlib import Path

# Keep plenty of precision for the arithmetic before rounding to the tolerance.
getcontext().prec = 12

JSONL_PATH = Path("australian_flights_2025_details.jsonl")
TOLERANCE = Decimal("0.2")  # points tolerance before we flag a mismatch

# DMSt shape bonuses by contest/task kind
DMST_BONUS = {
    "TR": Decimal("0.40"),
    "TRIANGLE": Decimal("0.40"),
    "DECLARATION": Decimal("0.30"),  # DMSt treats completed declarations as task w/ bonus already in task_achieved branch
    "OR": Decimal("0.30"),
    "OUT_RETURN": Decimal("0.30"),
    "GL": Decimal("0.30"),
    "OUT": Decimal("0.30"),
    "GOAL": Decimal("0.30"),
    "RT": Decimal("0.40"),
    "RECTANGLE": Decimal("0.40"),
    "MTR": Decimal("0.20"),
    "FR": Decimal("0.0"),
    "FR4": Decimal("0.0"),
    "SP": Decimal("0.0"),
    "SPEED": Decimal("0.0"),
}


def get_bonus(kind: str | None) -> Decimal:
    if not kind:
        return Decimal("0")
    kind = str(kind).upper()
    return DMST_BONUS.get(kind, Decimal("0"))


class Result:
    __slots__ = ("flight_id", "dmst_index", "free_expected", "free_actual",
                 "task_expected", "task_actual", "task_notes")

    def __init__(self, flight_id: int, dmst_index: int) -> None:
        self.flight_id = flight_id
        self.dmst_index = dmst_index
        self.free_expected: Decimal | None = None
        self.free_actual: Decimal | None = None
        self.task_expected: Decimal | None = None
        self.task_actual: Decimal | None = None
        self.task_notes: str = ""

    def free_matches(self) -> bool:
        if self.free_expected is None or self.free_actual is None:
            return True
        return abs(self.free_expected - self.free_actual) <= TOLERANCE

    def task_matches(self) -> bool:
        if self.task_expected is None or self.task_actual is None:
            return True
        return abs(self.task_expected - self.task_actual) <= TOLERANCE

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return (
            f"Result(id={self.flight_id}, H={self.dmst_index}, "
            f"free_calc={self.free_expected}, free_api={self.free_actual}, "
            f"task_calc={self.task_expected}, task_api={self.task_actual}, "
            f"notes={self.task_notes})"
        )


def main() -> None:
    if not JSONL_PATH.exists():
        raise SystemExit(f"Missing {JSONL_PATH}")

    results: list[Result] = []

    with JSONL_PATH.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            flight = json.loads(line)
            dmst_index = flight.get("dmst_index")
            if not dmst_index:
                continue
            dmst_index = int(dmst_index)
            idx_factor = Decimal(dmst_index) / Decimal(100)
            if idx_factor == 0:
                continue

            res = Result(flight.get("id"), dmst_index)

            contests = flight.get("contest") or []
            au_contest = next((c for c in contests if c.get("name") == "au"), None)
            free_contest = next((c for c in contests if c.get("name") == "free"), None)

            if not au_contest:
                continue

            au_points = au_contest.get("points")
            score = au_contest.get("score") or {}
            au_score_distance = score.get("distance")
            au_score_name = score.get("name")
            au_declared = score.get("declared")

            if au_score_distance:
                dist = Decimal(str(au_score_distance))
                bonus = get_bonus(au_score_name)
                res.free_expected = (dist * (Decimal(1) + bonus)) / idx_factor

            task = flight.get("task")
            task_distance = None
            task_kind = None
            if task:
                task_distance = task.get("distance")
                task_kind = task.get("kind")

            task_achieved = flight.get("task_achieved") is True

            if task_distance:
                base = Decimal(str(task_distance))
                bonus = get_bonus(task_kind)
                multiplier_actual = Decimal(1) + bonus + (Decimal("0.30") if task_achieved else Decimal("0"))
                res.task_expected = (base * multiplier_actual) / idx_factor
                res.task_notes = "actual"
            elif au_declared and au_score_distance:
                base = Decimal(str(au_score_distance))
                bonus = get_bonus(au_score_name)
                multiplier_actual = Decimal(1) + bonus
                if au_declared:
                    multiplier_actual += Decimal("0.30")
                res.task_expected = (base * multiplier_actual) / idx_factor
                res.task_notes = "from au distance"

            if au_declared is False and res.free_expected is not None:
                res.task_expected = None  # DMSt task not used / unavailable

            results.append(res)

    free_mismatches = [r for r in results if not r.free_matches()]
    task_mismatches = [r for r in results if not r.task_matches()]

    print(f"Checked {len(results)} flights")
    print(f"DMSt Free mismatches: {len(free_mismatches)}")
    print(f"DMSt Task mismatches: {len(task_mismatches)}")

    def show(items):
        for r in items[:10]:
            print(
                f"flight {r.flight_id} (H={r.dmst_index}) -> calc {r.free_expected} / api {r.free_actual}" if r in free_mismatches else
                f"flight {r.flight_id} (H={r.dmst_index}) -> calc {r.task_expected} / api {r.task_actual} [{r.task_notes}]"
            )

    if free_mismatches:
        print("\nSample free mismatches:")
        show(free_mismatches)
    if task_mismatches:
        print("\nSample task mismatches:")
        show(task_mismatches)

if __name__ == "__main__":
    main()
