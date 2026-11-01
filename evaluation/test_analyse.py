"""Checks the analysis script against hand-worked answers. Run:  python3 evaluation/test_analyse.py"""
import csv, os, random, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyse_responses as A


class Tests(unittest.TestCase):
    def test_alpha_hand_worked(self):
        # x = 1,2,3,4 and y = 2,1,4,3: each variance 5/3, variance of totals 16/3, so alpha = 2 * (1 - (10/3) / (16/3)) = 0.75
        self.assertAlmostEqual(A.cronbach_alpha([[1, 2], [2, 1], [3, 4], [4, 3]]), 0.75, places=9)

    def test_alpha_identical_items_is_one(self):
        self.assertAlmostEqual(A.cronbach_alpha([[1, 1, 1], [2, 2, 2], [4, 4, 4], [5, 5, 5]]), 1.0, places=9)

    def test_alpha_cannot_be_computed(self):
        self.assertIsNone(A.cronbach_alpha([[3, 3, 3], [3, 3, 3]]))
        self.assertIsNone(A.cronbach_alpha([[1, 2, 3]]))

    def test_likert_parsing(self):
        self.assertEqual(A.likert('4'), 4); self.assertEqual(A.likert(' Strongly agree '), 5); self.assertIsNone(A.likert(''))
        for bad in ('6', '0', '2.5', 'maybe'):
            with self.assertRaises(ValueError):
                A.likert(bad)

    def test_headers_are_matched_by_id(self):
        m = A.normalise_headers(['Timestamp', 'US1. I was able to complete', 'IF4 Current regulation', 'A1. Role', 'Random'])
        self.assertEqual(sorted(m.values()), ['A1', 'IF4', 'US1'])

    def test_full_run_on_made_up_data(self):
        # Made-up numbers used only to check the arithmetic. They are NOT evaluation results.
        random.seed(1)
        ids = [r['id'] for r in csv.DictReader(open(os.path.join(os.path.dirname(__file__), 'questionnaire_items.csv')))]
        rows = []
        for _ in range(30):
            base = random.choice([3, 4, 4, 5])
            row = {i: '' for i in ids}
            for i in ids:
                if i[0] in 'UADIT' or i[:2] in ('IF',) or i[0] in 'OE':
                    row[i] = str(min(5, max(1, base + random.choice([-1, 0, 0, 1]))))
            row['A1'] = 'GIS specialist'
            rows.append(row)
        rows.append({**{i: '' for i in ids}, 'US1': '7'})                 # one bad value, no other ratings: ignored
        res = A.analyse(rows)
        self.assertEqual(res['valid'], 30); self.assertEqual(res['received'], 31)
        self.assertEqual(len(res['scales']), 5); self.assertTrue(all(s['n'] == 30 for s in res['scales']))
        s = res['scales'][0]
        manual = [sum(int(r[i]) for i in ('US1', 'US2', 'US3', 'US4')) / 4 for r in rows[:30]]
        self.assertAlmostEqual(s['mean'], sum(manual) / 30, places=9)
        self.assertGreater(s['alpha'], 0.5)
        with tempfile.TemporaryDirectory() as d:
            A.report(res, rows, d)
            self.assertTrue(all(os.path.exists(os.path.join(d, n)) for n in ('results_scales.csv', 'results_items.csv', 'results_respondents.csv')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
