import unittest
from datetime import date
from zoneinfo import ZoneInfo

from ai.brief import MAX_TASKS, SYSTEM, Brief, build_prompt, sections, task_day, task_sections
from ai.fields import TASK_TITLE
from tests.test_brief import NOW, FakeDb, FakeGemini

JHB = ZoneInfo("Africa/Johannesburg")
TODAY = date(2026, 10, 23)


def task(title, due_at, all_day=True, status="open"):
    return {"title": title, "due_at": due_at, "due_all_day": all_day, "status": status}


class TaskSections(unittest.TestCase):
    def test_due_today_and_overdue_in_their_zone(self):
        tasks = [
            task("Send the offer", "2026-10-23T00:00:00+00:00"),
            task("Call the bank", "2026-10-23T07:30:00+00:00", all_day=False),  # 09:30 in Johannesburg
            task("Late night", "2026-10-22T22:30:00+00:00", all_day=False),  # 00:30 on the 23rd there: today's
            task("File the return", "2026-10-20T00:00:00+00:00"),
            task("Sign the lease", "2026-10-22T00:00:00+00:00"),
            task("Done already", "2026-10-21T00:00:00+00:00", status="completed"),
            task("Next week", "2026-10-30T00:00:00+00:00"),
            task("Someday", None),
        ]
        got = task_sections(tasks, TODAY, JHB)
        self.assertEqual([t["title"] for t in got["today"]], ["Send the offer", "Late night", "Call the bank"])
        self.assertEqual([t["title"] for t in got["overdue"]], ["Sign the lease", "File the return"])

    def test_an_all_day_task_is_its_date_as_written(self):
        # Midnight UTC is 02:00 in Johannesburg and the evening before in New York: the date stays the same.
        t = task("Send the offer", "2026-10-23T00:00:00Z")
        self.assertEqual(task_day(t, JHB), TODAY)
        self.assertEqual(task_day(t, ZoneInfo("America/New_York")), TODAY)


class TaskPrompt(unittest.TestCase):
    def prompt(self, tasks):
        return build_prompt("Matthew", TODAY, JHB, [], sections([], NOW), NOW, task_sections(tasks, TODAY, JHB))

    def test_tasks_carry_their_title_and_when_they_were_due(self):
        p = self.prompt([
            task("Send the offer", "2026-10-23T00:00:00+00:00"),
            task("Call the bank", "2026-10-23T07:30:00+00:00", all_day=False),
            task("Sign the lease", "2026-10-22T00:00:00+00:00"),
            task("File the return", "2026-10-20T00:00:00+00:00"),
        ])
        self.assertIn("Overdue tasks:\n- Sign the lease (due yesterday)\n- File the return (due 3 days ago)", p)
        self.assertIn("Tasks due today:\n- all day: Send the offer\n- 09:30: Call the bank", p)

    def test_no_tasks_say_none(self):
        p = self.prompt([])
        self.assertIn("Overdue tasks:\n(none)", p)
        self.assertIn("Tasks due today:\n(none)", p)
        # An older caller without tasks gets the same.
        self.assertIn("Tasks due today:\n(none)", build_prompt("Matthew", TODAY, JHB, [], sections([], NOW), NOW))

    def test_a_long_list_is_cut_and_counted_and_titles_are_kept_short(self):
        tasks = [task(f"Task {i}", "2026-10-23T00:00:00+00:00") for i in range(MAX_TASKS + 4)] + [task("x" * 500, "2026-10-22T00:00:00+00:00"), task("  ", "2026-10-22T00:00:00+00:00")]
        p = self.prompt(tasks)
        self.assertIn(f"Tasks due today ({MAX_TASKS + 4} in all):", p)
        self.assertEqual(sum(1 for line in p.splitlines() if line.startswith("- all day: Task ")), MAX_TASKS)
        self.assertIn("- " + "x" * 200 + " (due yesterday)", p)
        self.assertNotIn("x" * 201, p)
        self.assertNotIn("-  (due", p)  # no title, nothing to say

    def test_the_script_is_told_where_tasks_go_and_how_to_say_them(self):
        self.assertIn("then their tasks", SYSTEM)
        self.assertIn("overdue ones first", SYSTEM)


class TaskDb(FakeDb):
    def __init__(self, tasks, **kw):
        super().__init__(**kw)
        self.tasks = tasks
        self.task_queries = []

    def select(self, table, params):
        if table == "tasks":
            self.task_queries.append(params)
            return [dict(t) for t in self.tasks]
        return super().select(table, params)


class Sealing:
    """Seals as "enc:<field>:<value reversed>", so a test sees what was opened and under which field."""

    def __init__(self):
        self.opened = []

    def seal(self, user_id, field, value):
        return None if value is None else f"enc:{field}:{value[::-1]}"

    def open(self, user_id, field, value):
        if not str(value).startswith("enc:"):
            return value
        sealed_as, _, text = str(value)[4:].partition(":")
        self.opened.append(field)
        return text[::-1] if sealed_as == field else ""


class TaskWriting(unittest.TestCase):
    def test_sealed_task_titles_are_opened_and_reach_the_prompt(self):
        vault = Sealing()
        today = date.fromisoformat(FakeDb().today)  # run_once writes for the real date
        db = TaskDb([{**task("", f"{today.isoformat()}T00:00:00+00:00"), "title": vault.seal("u1", TASK_TITLE, "Send the offer to Sam")}])
        gemini = FakeGemini()
        self.assertEqual(Brief(db, gemini, "m", "tts", "Kore", vault).run_once(), 1)
        self.assertIn("Tasks due today:\n- all day: Send the offer to Sam", gemini.prompts[0])
        self.assertIn(TASK_TITLE, vault.opened)

    def test_only_open_tasks_due_by_the_end_of_the_day_are_read_and_only_their_titles(self):
        db = TaskDb([])
        Brief(db, FakeGemini(), "m", "tts", "Kore").run_once()
        q = db.task_queries[0]
        self.assertEqual((q["user_id"], q["status"]), ("eq.u1", "eq.open"))
        self.assertTrue(q["due_at"].startswith("lt."))
        self.assertEqual(q["select"], "title,due_at,due_all_day,status")  # never notes or list names


if __name__ == "__main__":
    unittest.main()
