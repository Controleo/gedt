#!/usr/bin/env python3
"""
Analyse the practitioner evaluation responses (for Chapter Five).

Usage:   python3 evaluation/analyse_responses.py responses.csv [--out results]

Input: a CSV exported from the online questionnaire. Each column heading must start with the question ID,
for example "US1. I was able to complete the tasks..." (see questionnaire_items.csv). Likert answers may be
numbers 1 to 5 or the words Strongly disagree, Disagree, Neutral, Agree, Strongly agree.

Output: tables printed on screen, plus results_scales.csv, results_items.csv and results_respondents.csv in the --out folder.
Uses only the Python standard library.
"""
import csv, os, re, statistics, sys
from collections import Counter

CRITERIA = {
    'Usability': ['US1', 'US2', 'US3', 'US4'],
    'Applicability': ['AP1', 'AP2', 'AP3', 'AP4'],
    'Data integration capability': ['DI1', 'DI2', 'DI3', 'DI4'],
    'Decision-support relevance': ['DS1', 'DS2', 'DS3', 'DS4'],
    'Implementation feasibility': ['IF1', 'IF2', 'IF3', 'IF4'],
}
TOE = {'Technology': ['T1', 'T2'], 'Organisation': ['O1', 'O2'], 'Environment': ['E1', 'E2']}
WORDS = {'strongly disagree': 1, 'disagree': 2, 'neutral': 3, 'neither agree nor disagree': 3, 'agree': 4, 'strongly agree': 5}
MEAN_TARGET, ALPHA_TARGET = 3.5, 0.70     # success criteria set in Section 3.10.2


def likert(value):
    """Returns 1 to 5, or None when blank. Raises ValueError for anything else."""
    v = str(value).strip()
    if v == '':
        return None
    if v.lower() in WORDS:
        return WORDS[v.lower()]
    n = float(v)
    if n != int(n) or not 1 <= n <= 5:
        raise ValueError(v)
    return int(n)


def cronbach_alpha(matrix):
    """matrix: one list of item scores per respondent (complete cases only). Returns None if it cannot be computed."""
    n = len(matrix)
    k = len(matrix[0]) if n else 0
    if n < 2 or k < 2:
        return None
    totals = [sum(r) for r in matrix]
    var_total = statistics.variance(totals)
    if var_total == 0:
        return None
    item_vars = sum(statistics.variance([r[i] for r in matrix]) for i in range(k))
    return (k / (k - 1)) * (1 - item_vars / var_total)


def normalise_headers(fieldnames):
    mapping = {}
    for h in fieldnames:
        m = re.match(r'^\s*([A-Z]{1,2}\d)\b', h)
        if m:
            mapping[h] = m.group(1)
    return mapping


def load(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        mapping = normalise_headers(reader.fieldnames or [])
        rows = [{mapping[k]: v for k, v in r.items() if k in mapping} for r in reader]
    return rows


def analyse(rows):
    all_ids = [i for ids in CRITERIA.values() for i in ids] + [i for ids in TOE.values() for i in ids]
    problems, parsed = [], []
    for n, r in enumerate(rows, 1):
        scores = {}
        for i in all_ids:
            try:
                scores[i] = likert(r.get(i, ''))
            except ValueError:
                scores[i] = None
                problems.append(f'Respondent {n}, {i}: "{r.get(i)}" is not a rating from 1 to 5')
        if all(v is None for v in scores.values()):
            problems.append(f'Respondent {n}: no ratings, ignored')
            continue
        parsed.append((n, r, scores))

    def block(groups):
        out = []
        for name, ids in groups.items():
            per_person = []
            for _, _, s in parsed:
                vals = [s[i] for i in ids if s[i] is not None]
                if vals:
                    per_person.append(sum(vals) / len(vals))
            complete = [[s[i] for i in ids] for _, _, s in parsed if all(s[i] is not None for i in ids)]
            alpha = cronbach_alpha(complete) if len(ids) >= 3 else None
            out.append({'scale': name, 'items': len(ids), 'n': len(per_person),
                        'mean': statistics.mean(per_person) if per_person else None,
                        'sd': statistics.stdev(per_person) if len(per_person) > 1 else None,
                        'alpha': alpha, 'n_complete': len(complete)})
        return out

    items = []
    for crit, ids in {**CRITERIA, **TOE}.items():
        for i in ids:
            vals = [s[i] for _, _, s in parsed if s[i] is not None]
            items.append({'scale': crit, 'item': i, 'n': len(vals), 'mean': statistics.mean(vals) if vals else None,
                          'sd': statistics.stdev(vals) if len(vals) > 1 else None,
                          'pct_agree': 100 * sum(v >= 4 for v in vals) / len(vals) if vals else None})
    straight = sum(1 for _, _, s in parsed if len({v for k, v in s.items() if v is not None and k in sum(CRITERIA.values(), [])}) == 1)
    return {'scales': block(CRITERIA), 'toe': block(TOE), 'items': items, 'valid': len(parsed), 'received': len(rows), 'problems': problems, 'straight': straight, 'parsed': parsed}


def f(x, d=2):
    return '' if x is None else f'{x:.{d}f}'


def report(res, rows, out):
    print(f"\nResponses received: {res['received']}   used: {res['valid']}")
    for p in res['problems']:
        print('  Note:', p)
    if res['straight']:
        print(f"  Note: {res['straight']} respondent(s) gave the same rating to every criterion item. Check these.")
    print('\nCriteria (5-point scale; targets: mean >= %.1f, alpha >= %.2f)' % (MEAN_TARGET, ALPHA_TARGET))
    print(f"{'Criterion':32}{'n':>4}{'Mean':>7}{'SD':>7}{'Alpha':>8}   Result")
    for s in res['scales']:
        met = s['mean'] is not None and s['mean'] >= MEAN_TARGET and s['alpha'] is not None and s['alpha'] >= ALPHA_TARGET
        print(f"{s['scale']:32}{s['n']:>4}{f(s['mean']):>7}{f(s['sd']):>7}{f(s['alpha']):>8}   {'target met' if met else 'target NOT met or not computable'}")
    print('\nTechnology, Organisation, Environment (2 items each, so no alpha)')
    for s in res['toe']:
        print(f"{s['scale']:32}{s['n']:>4}{f(s['mean']):>7}{f(s['sd']):>7}")
    for key in ('A1', 'A2', 'A3'):
        c = Counter(r.get(key, '').strip() for _, r, _ in res['parsed'] if r.get(key, '').strip())
        if c:
            print(f'\n{key}:', ', '.join(f'{k} ({v})' for k, v in c.most_common()))
    os.makedirs(out, exist_ok=True)
    for name, data, cols in (('results_scales.csv', res['scales'] + res['toe'], ['scale', 'items', 'n', 'mean', 'sd', 'alpha', 'n_complete']),
                             ('results_items.csv', res['items'], ['scale', 'item', 'n', 'mean', 'sd', 'pct_agree'])):
        with open(os.path.join(out, name), 'w', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore')
            w.writeheader()
            for d in data:
                w.writerow({k: (round(v, 3) if isinstance(v, float) else v) for k, v in d.items()})
    with open(os.path.join(out, 'results_respondents.csv'), 'w', newline='') as fh:
        ids = [i for ids in {**CRITERIA, **TOE}.values() for i in ids]
        w = csv.writer(fh); w.writerow(['respondent'] + ids)
        for n, _, s in res['parsed']:
            w.writerow([n] + [s[i] if s[i] is not None else '' for i in ids])
    print(f'\nFiles written to {out}/')


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0].startswith('-'):
        print(__doc__); sys.exit(1)
    out = args[args.index('--out') + 1] if '--out' in args else 'results'
    data = load(args[0])
    report(analyse(data), data, out)
